import { compareVersions, HARDENING_SINCE, SECURITY_SINCE } from "../../shared/plugin-version.ts";
import { SECURITY_FIXES } from "../../shared/security-fixes.ts";
import type {
  SecurityCheck,
  SecurityFix,
  SiteSecurity,
  SiteVulnerability,
  SiteSummary,
  VulnSeverity,
} from "../../shared/types.ts";
import { callSite, type SiteCredentials, SiteRequestError } from "./client.ts";
import { REST_NAMESPACE } from "../../shared/protocol.ts";

/**
 * Known vulnerabilities, from the free Wordfence Intelligence feed. The
 * scanner feed is one large JSON object keyed by vulnerability id, so it is
 * read as a stream and only the entries for WordPress core and for plugins
 * some connected site has installed are kept, in D1. A site is matched against
 * them when its Security tab opens. Themes are not matched: sites do not
 * report their installed themes.
 */

export const FEED_URL = "https://www.wordfence.com/api/intelligence/v2/vulnerabilities/scanner";
const DAY = 86400;
/** After a failed refresh, wait this long before trying again. */
const RETRY_AFTER = 3600;
/** The oldest PHP version still getting security fixes (8.1 ended in December 2025). */
export const MIN_SUPPORTED_PHP = "8.2";
const SEVERITIES: VulnSeverity[] = ["critical", "high", "medium", "low"];

export interface VulnRow {
  vuln_id: string;
  kind: "core" | "plugin";
  slug: string;
  title: string;
  cve: string | null;
  cvss: number | null;
  severity: VulnSeverity;
  from_version: string;
  from_inclusive: number;
  to_version: string;
  to_inclusive: number;
  patched_in: string | null;
}

/** The plugin's directory name ("akismet/akismet.php" is "akismet"; "hello.php" is "hello"). */
export function pluginSlug(file: string): string {
  return file.includes("/") ? file.slice(0, file.indexOf("/")) : file.replace(/\.php$/, "");
}

/**
 * The values of the top-level object's members as JSON text, one at a time, so
 * a feed far larger than the Worker's memory can be read. Members that are
 * not objects are skipped.
 */
export async function* topLevelEntries(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let depth = 0;
  let inString = false;
  let escaped = false;
  let parts: string[] = [];
  let start = -1;

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (start !== -1) start = 0;
      for (let i = 0; i < chunk.length; i++) {
        const code = chunk.charCodeAt(i);
        if (inString) {
          if (escaped) escaped = false;
          else if (code === 92) escaped = true;
          else if (code === 34) inString = false;
          continue;
        }
        if (code === 34) inString = true;
        else if (code === 123 || code === 91) {
          depth++;
          if (depth === 2 && code === 123) start = i;
        } else if (code === 125 || code === 93) {
          depth--;
          if (depth === 1 && start !== -1) {
            yield parts.join("") + chunk.slice(start, i + 1);
            parts = [];
            start = -1;
          }
        }
      }
      if (done) break;
      if (start !== -1) parts.push(chunk.slice(start));
    }
  } finally {
    reader.releaseLock();
  }
}

function severityOf(cvss: unknown): { score: number | null; severity: VulnSeverity } {
  const record = (cvss ?? {}) as { score?: unknown; rating?: unknown };
  const score = typeof record.score === "number" ? record.score : null;
  const rating = typeof record.rating === "string" ? record.rating.toLowerCase() : "";
  const severity = (SEVERITIES as string[]).includes(rating)
    ? (rating as VulnSeverity)
    : score === null
      ? "unknown"
      : score >= 9
        ? "critical"
        : score >= 7
          ? "high"
          : score >= 4
            ? "medium"
            : "low";
  return { score, severity };
}

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** The rows one feed entry adds for WordPress core and for the plugin slugs in `wanted`. */
export function rowsFromEntry(entry: unknown, wanted: Set<string>): VulnRow[] {
  const record = entry as Record<string, unknown> | null;
  const id = text(record?.id);
  if (!record || !id || !Array.isArray(record.software)) return [];
  const { score, severity } = severityOf(record.cvss);
  const rows: VulnRow[] = [];
  for (const item of record.software as Array<Record<string, unknown>>) {
    const kind = item?.type === "core" ? "core" : item?.type === "plugin" ? "plugin" : null;
    if (!kind) continue;
    const slug = kind === "core" ? "wordpress" : text(item.slug);
    if (!slug || (kind === "plugin" && !wanted.has(slug))) continue;
    const patched = Array.isArray(item.patched_versions) ? text(item.patched_versions[0]) : null;
    const ranges = Object.values((item.affected_versions ?? {}) as Record<string, Record<string, unknown>>);
    for (const range of ranges) {
      rows.push({
        vuln_id: id,
        kind,
        slug,
        title: text(record.title) ?? "Vulnerability",
        cve: text(record.cve),
        cvss: score,
        severity,
        from_version: text(range.from_version) ?? "*",
        from_inclusive: range.from_inclusive === false ? 0 : 1,
        to_version: text(range.to_version) ?? "*",
        to_inclusive: range.to_inclusive === false ? 0 : 1,
        patched_in: patched,
      });
    }
  }
  return rows;
}

/** Whether `version` falls inside the row's affected range. "*" leaves that end open. */
export function isAffected(
  version: string,
  row: Pick<VulnRow, "from_version" | "from_inclusive" | "to_version" | "to_inclusive">,
): boolean {
  if (!version) return false;
  if (row.from_version !== "*") {
    const diff = compareVersions(version, row.from_version);
    if (diff < 0 || (diff === 0 && !row.from_inclusive)) return false;
  }
  if (row.to_version !== "*") {
    const diff = compareVersions(version, row.to_version);
    if (diff > 0 || (diff === 0 && !row.to_inclusive)) return false;
  }
  return true;
}

interface FeedState {
  updated_at: number | null;
  attempted_at: number;
  error: string | null;
}

async function feedState(env: Env): Promise<FeedState | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'vuln_feed'").first<{ value: string }>();
  try {
    return row ? (JSON.parse(row.value) as FeedState) : null;
  } catch {
    return null;
  }
}

async function saveFeedState(env: Env, state: FeedState): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('vuln_feed', ?)")
    .bind(JSON.stringify(state))
    .run();
}

/** Download the feed and replace the stored vulnerabilities. Throws when the feed cannot be read. */
async function loadFeed(env: Env, now: number, fetcher: typeof fetch): Promise<void> {
  const { results } = await env.DB.prepare("SELECT DISTINCT file FROM site_plugins").all<{ file: string }>();
  const wanted = new Set(results.map((row) => pluginSlug(row.file)));
  const response = await fetcher(FEED_URL, { headers: { Accept: "application/json", "User-Agent": "KontrolWP" } });
  if (!response.ok || !response.body) throw new Error(`The vulnerability feed answered ${response.status}`);

  const rows: VulnRow[] = [];
  let entries = 0;
  for await (const entry of topLevelEntries(response.body)) {
    entries++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry);
    } catch {
      continue;
    }
    rows.push(...rowsFromEntry(parsed, wanted));
  }
  // An empty or unrecognised feed must not wipe what is stored.
  if (!entries) throw new Error("The vulnerability feed had no entries");

  const insert = `INSERT OR REPLACE INTO vulnerabilities
    (vuln_id, kind, slug, title, cve, cvss, severity, from_version, from_inclusive, to_version, to_inclusive, patched_in, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  for (let i = 0; i < rows.length; i += 50) {
    await env.DB.batch(
      rows
        .slice(i, i + 50)
        .map((r) =>
          env.DB.prepare(insert).bind(
            r.vuln_id,
            r.kind,
            r.slug,
            r.title,
            r.cve,
            r.cvss,
            r.severity,
            r.from_version,
            r.from_inclusive,
            r.to_version,
            r.to_inclusive,
            r.patched_in,
            now,
          ),
        ),
    );
  }
  await env.DB.prepare("DELETE FROM vulnerabilities WHERE refreshed_at <> ?").bind(now).run();
}

/** Refresh the stored feed now. The returned state says when it last worked and why it did not. */
export async function refreshFeed(
  env: Env,
  now = Math.floor(Date.now() / 1000),
  fetcher: typeof fetch = fetch,
): Promise<FeedState> {
  const previous = await feedState(env);
  let state: FeedState;
  try {
    await loadFeed(env, now, fetcher);
    state = { updated_at: now, attempted_at: now, error: null };
  } catch (error) {
    state = {
      updated_at: previous?.updated_at ?? null,
      attempted_at: now,
      error: error instanceof Error ? error.message : "The vulnerability feed could not be read",
    };
  }
  await saveFeedState(env, state);
  return state;
}

/** Called by the cron trigger: refreshes the feed once a day, and an hour after a failure. */
export async function runScheduledFeedRefresh(
  env: Env,
  now = Math.floor(Date.now() / 1000),
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const state = await feedState(env);
  const wait = state?.error || !state?.updated_at ? RETRY_AFTER : DAY;
  if (state && now - (state.error || !state.updated_at ? state.attempted_at : state.updated_at) < wait) return false;
  const sites = await env.DB.prepare("SELECT COUNT(*) AS n FROM sites WHERE kind = 'wordpress'").first<{ n: number }>();
  if (!sites?.n) return false;
  await refreshFeed(env, now, fetcher);
  return true;
}

const SEVERITY_ORDER: Record<VulnSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };

/** The stored vulnerabilities that affect the WordPress version and plugins the site last reported. */
export async function siteVulnerabilities(env: Env, site: SiteSummary): Promise<SiteVulnerability[]> {
  const { results: plugins } = await env.DB.prepare(
    "SELECT file, name, version, active, network_active FROM site_plugins WHERE site_id = ?",
  )
    .bind(site.id)
    .all<{ file: string; name: string; version: string; active: number; network_active: number }>();
  const installed = new Map<string, { name: string; version: string; active: boolean }>();
  for (const plugin of plugins) {
    installed.set(`plugin:${pluginSlug(plugin.file)}`, {
      name: plugin.name,
      version: plugin.version,
      active: Boolean(plugin.active || plugin.network_active),
    });
  }
  if (site.wp_version) installed.set("core:wordpress", { name: "WordPress", version: site.wp_version, active: true });
  if (!installed.size) return [];

  const { results: rows } = await env.DB.prepare("SELECT * FROM vulnerabilities").all<VulnRow>();
  const found = new Map<string, SiteVulnerability>();
  for (const row of rows) {
    const item = installed.get(`${row.kind}:${row.slug}`);
    if (!item || !isAffected(item.version, row)) continue;
    const key = `${row.vuln_id}:${row.kind}:${row.slug}`;
    if (found.has(key)) continue;
    found.set(key, {
      id: row.vuln_id,
      kind: row.kind,
      slug: row.slug,
      name: item.name,
      installed_version: item.version,
      active: item.active,
      title: row.title,
      cve: row.cve,
      cvss: row.cvss,
      severity: row.severity,
      patched_in: row.patched_in,
      url: `https://www.wordfence.com/threat-intel/vulnerabilities/id/${row.vuln_id}`,
    });
  }
  return [...found.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (b.cvss ?? 0) - (a.cvss ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

/** What KontrolWP Connect reports about the site's configuration. */
export interface SecurityReport {
  debug_display?: boolean;
  file_edit_allowed?: boolean;
  admin_user_exists?: boolean;
  xmlrpc_enabled?: boolean;
  fixes?: FixStates;
}

export type FixStates = Record<string, { enabled?: boolean; applied?: boolean }>;

/** The catalog of fixes with the states the plugin reported. */
export function fixesFrom(states: FixStates): SecurityFix[] {
  return SECURITY_FIXES.map((fix) => ({
    ...fix,
    enabled: Boolean(states[fix.id]?.enabled),
    applied: Boolean(states[fix.id]?.applied),
  }));
}

/** Switch fixes on or off on one site; returns the new state of every fix. */
export async function setSiteFixes(
  credentials: SiteCredentials,
  ids: string[],
  enabled: boolean,
): Promise<SecurityFix[]> {
  const result = await callSite<{ fixes: FixStates }>(credentials, "POST", `${REST_NAMESPACE}/security/fixes`, {
    ids,
    enabled,
  });
  return fixesFrom(result.fixes ?? {});
}

const check = (id: string, bad: boolean, title: string, problem: string, fine: string): SecurityCheck => ({
  id,
  status: bad ? "warning" : "ok",
  title,
  detail: bad ? problem : fine,
});

/** The configuration findings the dashboard can work out from what it already stores. */
export async function derivedChecks(env: Env, site: SiteSummary): Promise<SecurityCheck[]> {
  const checks: SecurityCheck[] = [
    check(
      "https",
      !site.url.startsWith("https://"),
      "Uses HTTPS",
      "The site address starts with http://, so logins and form data travel unencrypted.",
      "The site address uses HTTPS.",
    ),
  ];
  if (site.php_version) {
    checks.push(
      check(
        "php",
        compareVersions(site.php_version, MIN_SUPPORTED_PHP) < 0,
        "Supported PHP version",
        `PHP ${site.php_version} no longer gets security fixes. Ask the host to move the site to PHP ${MIN_SUPPORTED_PHP} or newer.`,
        `PHP ${site.php_version} still gets security fixes.`,
      ),
    );
  }
  const core = await env.DB.prepare("SELECT new_version FROM site_updates WHERE site_id = ? AND kind = 'core'")
    .bind(site.id)
    .first<{ new_version: string }>();
  checks.push(
    check(
      "core",
      Boolean(core),
      "WordPress is up to date",
      `WordPress ${core?.new_version} is available. Updates carry security fixes.`,
      "No WordPress update is waiting.",
    ),
  );
  const inactive = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM site_plugins WHERE site_id = ? AND active = 0 AND network_active = 0",
  )
    .bind(site.id)
    .first<{ n: number }>();
  checks.push(
    check(
      "inactive-plugins",
      (inactive?.n ?? 0) > 0,
      "No unused plugins",
      `${inactive?.n} inactive plugin${inactive?.n === 1 ? "" : "s"} still sit on the site. Their files can be attacked even when switched off, so remove the ones you do not use.`,
      "Every installed plugin is active.",
    ),
  );
  return checks;
}

export function reportChecks(report: SecurityReport): SecurityCheck[] {
  return [
    check(
      "debug-display",
      Boolean(report.debug_display),
      "Errors are hidden from visitors",
      "WordPress prints errors into pages (WP_DEBUG_DISPLAY), which shows visitors file paths and code. Turn it off on a live site.",
      "Errors are not shown to visitors.",
    ),
    check(
      "file-edit",
      Boolean(report.file_edit_allowed),
      "Plugin and theme editor is off",
      "Administrators can edit plugin and theme code from wp-admin, so one stolen login can plant code. Add define('DISALLOW_FILE_EDIT', true) to wp-config.php.",
      "The code editor in wp-admin is disabled.",
    ),
    check(
      "admin-user",
      Boolean(report.admin_user_exists),
      "No user named admin",
      'A user named "admin" exists. It is the first name password guessing tries; create another administrator and remove it.',
      'No user is named "admin".',
    ),
    check(
      "xmlrpc",
      Boolean(report.xmlrpc_enabled),
      "XML-RPC is off",
      "XML-RPC is enabled. It lets a password be guessed many times in one request. Turn it off unless an app you use needs it.",
      "XML-RPC is disabled.",
    ),
  ];
}

/** Vulnerabilities and configuration findings for one WordPress site. */
export async function siteSecurity(env: Env, site: SiteSummary, credentials: SiteCredentials): Promise<SiteSecurity> {
  const [vulnerabilities, derived, state] = await Promise.all([
    siteVulnerabilities(env, site),
    derivedChecks(env, site),
    feedState(env),
  ]);
  let checks = derived;
  let note: string | null = null;
  let fixes: SecurityFix[] | null = null;
  if (!site.plugin_version || compareVersions(site.plugin_version, SECURITY_SINCE) < 0) {
    note =
      "KontrolWP Connect on this site is too old to report its settings. It updates automatically; select Sync now to check.";
  } else {
    try {
      const report = await callSite<SecurityReport>(credentials, "GET", `${REST_NAMESPACE}/security`);
      checks = [...reportChecks(report), ...derived];
      if (report.fixes && compareVersions(site.plugin_version, HARDENING_SINCE) >= 0) fixes = fixesFrom(report.fixes);
    } catch (error) {
      if (!(error instanceof SiteRequestError)) throw error;
      note = `The site's own settings could not be read: ${error.message}`;
    }
  }
  return {
    vulnerabilities,
    checks,
    checks_note: note,
    fixes,
    feed: { updated_at: state?.updated_at ?? null, error: state?.error ?? null },
  };
}

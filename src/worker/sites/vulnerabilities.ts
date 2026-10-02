import { compareVersions, HARDENING_SINCE, SECURITY_SINCE } from "../../shared/plugin-version.ts";
import { SECURITY_FIXES } from "../../shared/security-fixes.ts";
import type {
  SecurityCheck,
  SecurityFix,
  SecurityItem,
  SiteSecurity,
  SiteVulnerability,
  SiteSummary,
  VulnSeverity,
} from "../../shared/types.ts";
import { decryptSetting, encryptSetting } from "./secrets.ts";
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

// Version 2 of this feed, which needed no key, was retired in 2026 and now answers 410.
// Version 3 needs a free Wordfence Intelligence API key, sent as a bearer token.
// The production feed carries each vulnerability's CVSS score; the smaller scanner feed left it out.
export const FEED_URL = "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production";
const SETTING = "wordfence";
const DAY = 86400;
/** After a failed refresh, wait this long before trying again. */
const RETRY_AFTER = 3600;
/** Wordfence allows one download every 30 minutes; never come back sooner than this after any attempt. */
const MIN_GAP = 31 * 60;
/**
 * Bumped when the stored rows change shape, so the next scheduled run downloads again: 1 stored the scanner feed's
 * rows, which have no scores.
 */
const FEED_VERSION = 2;
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

/** The standard CVSS bands: 0.1 to 3.9 low, 4.0 to 6.9 medium, 7.0 to 8.9 high, 9.0 to 10 critical. */
export function severityFromScore(score: number | null): VulnSeverity {
  if (score === null || !(score > 0)) return "unknown";
  return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low";
}

/** The CVSS score from the feed, and its rating; the score decides, and the feed's own rating is the fallback. */
export function severityOf(cvss: unknown): { score: number | null; severity: VulnSeverity } {
  // The score is an object member in the feed; a bare number or string is accepted too.
  const record = (typeof cvss === "object" && cvss !== null ? cvss : { score: cvss }) as {
    score?: unknown;
    rating?: unknown;
  };
  const parsed = typeof record.score === "string" ? Number.parseFloat(record.score) : record.score;
  const score = typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
  const rating = typeof record.rating === "string" ? record.rating.toLowerCase() : "";
  const severity =
    score !== null
      ? severityFromScore(score)
      : (SEVERITIES as string[]).includes(rating)
        ? (rating as VulnSeverity)
        : "unknown";
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

export class FeedKeyError extends Error {}

export async function loadFeedKey(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?")
    .bind(SETTING)
    .first<{ value: string }>();
  return row ? decryptSetting(env.SITE_SECRETS_KEY, SETTING, row.value) : null;
}

export async function saveFeedKey(env: Env, key: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)")
    .bind(SETTING, await encryptSetting(env.SITE_SECRETS_KEY, SETTING, key))
    .run();
}

export async function deleteFeedKey(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE name = ?").bind(SETTING).run();
}

interface FeedState {
  updated_at: number | null;
  attempted_at: number;
  error: string | null;
  /** The FEED_VERSION of the rows stored at `updated_at`. */
  version?: number;
  /** Something odd about the last good download, such as no scores in it. */
  note?: string | null;
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
async function loadFeed(env: Env, now: number, fetcher: typeof fetch, key: string): Promise<string | null> {
  const { results } = await env.DB.prepare("SELECT DISTINCT file FROM site_plugins").all<{ file: string }>();
  const wanted = new Set(results.map((row) => pluginSlug(row.file)));
  wanted.add("wordpress");
  const response = await fetcher(FEED_URL, {
    headers: { Accept: "application/json", "User-Agent": "KontrolWP", Authorization: `Bearer ${key}` },
  });
  if (!response.ok || !response.body) throw new Error(feedFailure(response.status));

  const rows: VulnRow[] = [];
  let entries = 0;
  let recognised = 0;
  for await (const entry of topLevelEntries(response.body)) {
    entries++;
    // Most of the feed is plugins no site has; skip parsing those entries.
    if (!mentionsWanted(entry, wanted)) {
      recognised += entry.includes('"software"') ? 1 : 0;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry);
    } catch {
      continue;
    }
    if (Array.isArray((parsed as { software?: unknown } | null)?.software)) recognised++;
    rows.push(...rowsFromEntry(parsed, wanted));
  }
  // An empty or unrecognised feed must not wipe what is stored.
  if (!entries) throw new Error("The vulnerability feed had no entries");
  if (!recognised) throw new Error("The vulnerability feed was not in the expected format");

  const scored = rows.filter((row) => row.cvss !== null).length;
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
  return rows.length && !scored ? "The feed carried no CVSS scores." : null;
}

/** Whether a feed entry names core or a plugin some site has, without parsing it. */
export function mentionsWanted(entry: string, wanted: Set<string>): boolean {
  for (const match of entry.matchAll(/"slug"\s*:\s*"([^"]*)"/g)) if (wanted.has(match[1])) return true;
  return false;
}

/** What an HTTP failure from the feed means for the person reading the Security tab. */
export function feedFailure(status: number): string {
  if (status === 401 || status === 403) {
    return `Wordfence did not accept the API key (HTTP ${status}). Check it in Settings.`;
  }
  if (status === 429) return "Wordfence allows one download every 30 minutes (HTTP 429). Try again later.";
  return `The vulnerability feed answered HTTP ${status}`;
}

/**
 * Refresh the stored feed with `key`, or the saved one. The returned state says when it last worked and why it
 * did not. Throws FeedKeyError when there is no key. Within 31 minutes of any earlier attempt nothing is
 * downloaded, because Wordfence would refuse it.
 */
export async function refreshFeed(
  env: Env,
  now = Math.floor(Date.now() / 1000),
  fetcher: typeof fetch = fetch,
  key?: string,
): Promise<FeedState> {
  const feedKey = key ?? (await loadFeedKey(env));
  if (!feedKey) throw new FeedKeyError("Add a Wordfence API key in Settings first.");
  const previous = await feedState(env);
  if (previous && now - previous.attempted_at < MIN_GAP) {
    const minutes = Math.max(1, Math.ceil((MIN_GAP - (now - previous.attempted_at)) / 60));
    return { ...previous, error: `Wordfence allows one download every 30 minutes. Try again in ${minutes} minutes.` };
  }
  // Claim the attempt first, so a second run starting now does not download too.
  await saveFeedState(env, { ...(previous ?? { updated_at: null, error: null }), attempted_at: now });
  let state: FeedState;
  try {
    const note = await loadFeed(env, now, fetcher, feedKey);
    state = { updated_at: now, attempted_at: now, error: null, version: FEED_VERSION, note };
  } catch (error) {
    state = {
      ...(previous ?? { updated_at: null }),
      attempted_at: now,
      error: error instanceof Error ? error.message : "The vulnerability feed could not be read",
    };
  }
  await saveFeedState(env, state);
  return state;
}

/**
 * Called by the cron trigger: downloads the feed once a day, an hour after a failure, and when the stored rows
 * are from an older format. Never sooner than 31 minutes after the last attempt.
 */
export async function runScheduledFeedRefresh(
  env: Env,
  now = Math.floor(Date.now() / 1000),
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const state = await feedState(env);
  if (state) {
    const failed = Boolean(state.error) || !state.updated_at;
    const outdated = (state.version ?? 1) < FEED_VERSION;
    const since = failed || outdated ? now - state.attempted_at : now - state.updated_at!;
    const wait = failed ? RETRY_AFTER : outdated ? MIN_GAP : DAY;
    if (since < wait || now - state.attempted_at < MIN_GAP) return false;
  }
  const sites = await env.DB.prepare("SELECT COUNT(*) AS n FROM sites WHERE kind = 'wordpress'").first<{ n: number }>();
  if (!sites?.n || !(await loadFeedKey(env))) return false;
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
      // From the stored score, so a change to the bands applies without another download.
      severity: row.cvss !== null ? severityFromScore(row.cvss) : row.severity,
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

/** Apply or undo fixes on one site; returns the new state of every fix. */
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

/** A fix and the finding that reports the same problem, which share one line. */
const FIX_CHECKS: Record<string, string> = { file_edit: "file-edit", xmlrpc: "xmlrpc", php_errors: "debug-display" };

/**
 * One list from the findings and the fixes: a fix takes over the finding it
 * clears, so nothing shows twice. Open items come first.
 */
export function securityItems(checks: SecurityCheck[], fixes: SecurityFix[] | null): SecurityItem[] {
  const paired = new Set<string>();
  const items: SecurityItem[] = [];
  for (const fix of fixes ?? []) {
    const check = checks.find((c) => c.id === FIX_CHECKS[fix.id]);
    if (check) paired.add(check.id);
    items.push({
      id: fix.id,
      status: fix.applied || check?.status === "ok" ? "ok" : "warning",
      title: fix.title,
      detail: fix.detail,
      fix: { id: fix.id, enabled: fix.enabled },
    });
  }
  for (const check of checks) {
    if (!paired.has(check.id))
      items.push({ id: check.id, status: check.status, title: check.title, detail: check.detail, fix: null });
  }
  // Array.sort is stable, so each group keeps its order.
  return items.sort((a, b) => Number(b.status === "warning") - Number(a.status === "warning"));
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
    items: securityItems(checks, fixes),
    checks_note: note,
    feed: {
      configured: Boolean(await loadFeedKey(env).catch(() => null)),
      updated_at: state?.updated_at ?? null,
      error: state?.error ?? null,
      note: state?.note ?? null,
    },
  };
}

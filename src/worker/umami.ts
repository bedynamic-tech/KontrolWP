import type {
  AnalyticsBreakdown,
  AnalyticsRange,
  AnalyticsStat,
  SiteAnalytics,
  SiteAnalyticsDetails,
  UmamiMode,
  UmamiWebsite,
} from "../shared/types.ts";
import { decryptSetting, encryptSetting } from "./sites/secrets.ts";

/**
 * Umami analytics (https://docs.umami.is/docs/api). Umami Cloud takes an API
 * key as a bearer token at api.umami.is/v1; a self-hosted Umami takes a login
 * whose token is sent the same way.
 */

export const UMAMI_CLOUD_API = "https://api.umami.is/v1";
const SETTING = "umami";
const TIMEOUT_MS = 15_000;

export interface UmamiConfig {
  mode: UmamiMode;
  /** Self-hosted Umami address, such as https://analytics.example.com. */
  url: string;
  username: string;
  /** API key (Cloud) or password (self-hosted). */
  secret: string;
}

export class UmamiError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

type Stored = Omit<UmamiConfig, "secret"> & { secret: string };

export async function loadUmamiConfig(env: Env): Promise<UmamiConfig | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?").bind(SETTING).first<{ value: string }>();
  if (!row) return null;
  const stored = JSON.parse(row.value) as Stored;
  return { ...stored, secret: await decryptSetting(env.SITE_SECRETS_KEY, SETTING, stored.secret) };
}

export async function saveUmamiConfig(env: Env, config: UmamiConfig): Promise<void> {
  const stored: Stored = { ...config, secret: await encryptSetting(env.SITE_SECRETS_KEY, SETTING, config.secret) };
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)").bind(SETTING, JSON.stringify(stored)).run();
}

export async function deleteUmamiConfig(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE name = ?").bind(SETTING).run();
}

/** The API root: Umami Cloud's, or /api on a self-hosted Umami. */
export function umamiApiBase(config: Pick<UmamiConfig, "mode" | "url">): string {
  return config.mode === "cloud" ? UMAMI_CLOUD_API : `${config.url.replace(/\/+$/, "")}/api`;
}

export type UmamiClient = <T>(path: string, params?: Record<string, string | number>) => Promise<T>;

/** A client for one request's worth of calls; a self-hosted Umami is logged in to once. */
export async function umamiClient(config: UmamiConfig): Promise<UmamiClient> {
  const base = umamiApiBase(config);
  let token = config.secret;
  if (config.mode === "self-hosted") {
    const login = await call<{ token?: string }>(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: config.username, password: config.secret }),
    }, "Umami did not accept that username and password.");
    if (!login.token) throw new UmamiError("Umami did not return a login token. Check the Umami address.");
    token = login.token;
  }
  return <T>(path: string, params: Record<string, string | number> = {}) => {
    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const qs = query.size ? `?${query}` : "";
    return call<T>(`${base}${path}${qs}`, { headers: { Authorization: `Bearer ${token}` } }, "Umami did not accept the API key.");
  };
}

async function call<T>(url: string, init: RequestInit, unauthorized: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
    throw new UmamiError(`Umami ${reason} at ${new URL(url).origin}.`);
  }
  if (res.status === 401 || res.status === 403) throw new UmamiError(unauthorized, 400);
  if (res.status === 429) throw new UmamiError("Umami is rate limiting requests. Try again in a moment.");
  if (!res.ok) throw new UmamiError(`Umami answered ${res.status} for ${new URL(url).pathname}.`, res.status === 400 ? 400 : 502);
  try {
    return (await res.json()) as T;
  } catch {
    throw new UmamiError(`Umami sent something other than JSON from ${new URL(url).origin}. Check the Umami address.`);
  }
}

/** Every website the account can see (its own and its teams'). */
export async function listUmamiWebsites(client: UmamiClient): Promise<UmamiWebsite[]> {
  const body = await client<unknown>("/websites", { pageSize: 500, includeTeams: "true" });
  // Umami 2+ pages its lists as {data}; older versions return an array.
  const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data : [];
  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string")
    .map((row) => ({ id: String(row.id), name: String(row.name ?? ""), domain: String(row.domain ?? "") }));
}

/** Host without "www." or a port, for matching a site to its Umami website. */
export function bareHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  let host = trimmed;
  try {
    host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    // Keep what was given.
  }
  return host.replace(/^www\./, "");
}

export function matchWebsite(websites: UmamiWebsite[], siteUrl: string): UmamiWebsite | null {
  const host = bareHost(siteUrl);
  return websites.find((website) => website.domain && bareHost(website.domain) === host) ?? null;
}

const RANGES: Record<AnalyticsRange, { days: number; unit: "hour" | "day" }> = {
  "24h": { days: 1, unit: "hour" },
  "7d": { days: 7, unit: "day" },
  "30d": { days: 30, unit: "day" },
  "90d": { days: 90, unit: "day" },
};

/** Milliseconds to add to UTC to get the wall time in timeZone at that instant. */
export function zoneOffset(ms: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
}

/** "YYYY-MM-DD HH" in timeZone, the key each chart bucket is matched on. */
export function bucketKey(ms: number, timeZone: string, unit: "hour" | "day"): string {
  const local = new Date(ms + zoneOffset(ms, timeZone)).toISOString();
  return unit === "hour" ? `${local.slice(0, 10)} ${local.slice(11, 13)}` : local.slice(0, 10);
}

/** Umami's bucket labels ("2026-10-01 14:00:00", or ISO from older versions) as bucket keys. */
function labelKey(x: unknown, unit: "hour" | "day"): string {
  const text = String(x ?? "").replace("T", " ");
  return unit === "hour" ? text.slice(0, 13) : text.slice(0, 10);
}

/** The period to show: the last 24 hours by the hour, or the last N days from local midnight. */
export function analyticsWindow(range: AnalyticsRange, timeZone: string, now = Date.now()) {
  const { days, unit } = RANGES[range];
  let startAt: number;
  if (unit === "hour") {
    startAt = Math.floor(now / 3_600_000) * 3_600_000 - 23 * 3_600_000;
  } else {
    // Local midnight days - 1 days ago.
    const local = now + zoneOffset(now, timeZone);
    const midnight = Math.floor(local / 86_400_000) * 86_400_000 - (days - 1) * 86_400_000;
    startAt = midnight - zoneOffset(midnight, timeZone);
  }
  const keys: string[] = [];
  // Hourly steps find every local day too, even across a daylight saving change.
  for (let t = startAt; t <= now; t += 3_600_000) {
    const key = bucketKey(t, timeZone, unit);
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return { startAt, endAt: now, unit, keys };
}

function stat(data: Record<string, unknown>, key: string): AnalyticsStat {
  const raw = data[key];
  // Umami 2 reported {value, prev}; later versions report a number and a comparison object.
  if (raw && typeof raw === "object") {
    const { value, prev } = raw as { value?: unknown; prev?: unknown };
    return { value: Number(value) || 0, previous: prev === undefined ? null : Number(prev) || 0 };
  }
  const comparison = data.comparison as Record<string, unknown> | undefined;
  return {
    value: Number(raw) || 0,
    previous: comparison && comparison[key] !== undefined ? Number(comparison[key]) || 0 : null,
  };
}

type Point = { x?: unknown; y?: unknown };

function topList(rows: unknown, fallback: string): { label: string; count: number }[] {
  return (Array.isArray(rows) ? (rows as Point[]) : [])
    .map((row) => ({ label: row.x === null || row.x === "" || row.x === undefined ? fallback : String(row.x), count: Number(row.y) || 0 }))
    .slice(0, 10);
}

export async function siteAnalytics(
  client: UmamiClient,
  website: UmamiWebsite,
  range: AnalyticsRange,
  timeZone: string,
  now = Date.now(),
): Promise<Omit<SiteAnalytics, "website" | "chosen">> {
  const window = analyticsWindow(range, timeZone, now);
  const params = { startAt: window.startAt, endAt: window.endAt };
  const base = `/websites/${encodeURIComponent(website.id)}`;
  // Umami 3 names the page metric "path"; Umami 2 called it "url".
  const pagesMetric = () =>
    client<unknown>(`${base}/metrics`, { ...params, type: "path", limit: 10 }).catch((error) => {
      if (error instanceof UmamiError && error.status === 400) {
        return client<unknown>(`${base}/metrics`, { ...params, type: "url", limit: 10 });
      }
      throw error;
    });
  const [stats, pageviews, pages, referrers] = await Promise.all([
    client<Record<string, unknown>>(`${base}/stats`, params),
    client<{ pageviews?: Point[]; sessions?: Point[] }>(`${base}/pageviews`, { ...params, unit: window.unit, timezone: timeZone }),
    pagesMetric(),
    client<unknown>(`${base}/metrics`, { ...params, type: "referrer", limit: 10 }),
  ]);

  const series = new Map(window.keys.map((key) => [key, { pageviews: 0, visitors: 0 }]));
  for (const [field, points] of [["pageviews", pageviews.pageviews], ["visitors", pageviews.sessions]] as const) {
    for (const point of Array.isArray(points) ? points : []) {
      const bucket = series.get(labelKey(point.x, window.unit));
      if (bucket) bucket[field] += Number(point.y) || 0;
    }
  }

  return {
    range,
    stats: {
      visitors: stat(stats, "visitors"),
      visits: stat(stats, "visits"),
      pageviews: stat(stats, "pageviews"),
      bounces: stat(stats, "bounces"),
      totaltime: stat(stats, "totaltime"),
    },
    series: [...series].map(([label, values]) => ({ label, ...values })),
    pages: topList(pages, "(unknown)"),
    referrers: topList(referrers, "Direct"),
  };
}

/** Umami's metric type for each breakdown, and the label for an empty value. */
const BREAKDOWN_METRICS: Record<Exclude<AnalyticsBreakdown, "pages" | "referrers">, { type: string; fallback: string }> = {
  entry: { type: "entry", fallback: "(unknown)" },
  exit: { type: "exit", fallback: "(unknown)" },
  countries: { type: "country", fallback: "Unknown" },
  cities: { type: "city", fallback: "Unknown" },
  browsers: { type: "browser", fallback: "Unknown" },
  os: { type: "os", fallback: "Unknown" },
  devices: { type: "device", fallback: "Unknown" },
  events: { type: "event", fallback: "(no name)" },
};

/**
 * The Analytics tab: the summary plus Umami's other breakdowns and the
 * visitors online now. A breakdown this Umami version rejects (entry and exit
 * pages came in Umami 3) is null rather than an error.
 */
export async function siteAnalyticsDetails(
  client: UmamiClient,
  website: UmamiWebsite,
  range: AnalyticsRange,
  timeZone: string,
  now = Date.now(),
): Promise<Omit<SiteAnalyticsDetails, "website" | "chosen">> {
  const window = analyticsWindow(range, timeZone, now);
  const base = `/websites/${encodeURIComponent(website.id)}`;
  const metric = (type: string, fallback: string) =>
    client<unknown>(`${base}/metrics`, { startAt: window.startAt, endAt: window.endAt, type, limit: 10 })
      .then((rows) => topList(rows, fallback))
      .catch((error) => {
        if (error instanceof UmamiError && error.status === 400) return null;
        throw error;
      });
  const entries = Object.entries(BREAKDOWN_METRICS) as [keyof typeof BREAKDOWN_METRICS, { type: string; fallback: string }][];
  const [summary, active, ...lists] = await Promise.all([
    siteAnalytics(client, website, range, timeZone, now),
    client<Record<string, unknown>>(`${base}/active`).then(activeVisitors).catch(() => null),
    ...entries.map(([, { type, fallback }]) => metric(type, fallback)),
  ]);
  const extra = Object.fromEntries(entries.map(([key], index) => [key, lists[index]]));
  return {
    ...summary,
    active,
    breakdowns: { pages: summary.pages, referrers: summary.referrers, ...extra } as SiteAnalyticsDetails["breakdowns"],
  };
}

/** Umami 3 answers {visitors}; Umami 2 answered {x}. */
function activeVisitors(body: Record<string, unknown>): number | null {
  const value = body.visitors ?? body.x;
  return value === undefined || value === null ? null : Number(value) || 0;
}

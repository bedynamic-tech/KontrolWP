import type {
  AnalyticsBreakdown,
  AnalyticsRange,
  AnalyticsStat,
  SiteAnalytics,
  SiteAnalyticsDetails,
  UmamiWebsite,
} from "../shared/types.ts";
import { call, CloudflareError } from "./cloudflare.ts";
import { analyticsWindow, bareHost, bucketKey } from "./umami.ts";

/**
 * Cloudflare Web Analytics, read through the GraphQL Analytics API
 * (https://developers.cloudflare.com/analytics/graphql-api). It counts page
 * loads and visits; it has no unique visitors, bounce rate or visit duration,
 * so those figures are left out. The API token needs "Account Analytics: Read".
 *
 * A source is a Web Analytics site, addressed as "<account id>:<site tag>".
 */

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const TIMEOUT_MS = 20_000;

/** Every Web Analytics site the token can see, across its accounts. */
export async function listWebAnalyticsSites(token: string): Promise<UmamiWebsite[]> {
  const accounts = (await call<{ id: string; name: string }[]>(token, "/accounts", { per_page: 20 })) ?? [];
  if (!accounts.length) throw new CloudflareError("That API token cannot see any Cloudflare account.", 400);
  const lists = await Promise.allSettled(
    accounts.map(async (account) => {
      const rows = await call<unknown>(token, `/accounts/${account.id}/rum/site_info/list`, { per_page: 100 });
      return (Array.isArray(rows) ? rows : []).flatMap((row): UmamiWebsite[] => {
        const site = row as { site_tag?: unknown; host?: unknown; ruleset?: { zone_name?: unknown } };
        if (typeof site.site_tag !== "string" || !/^[a-z0-9]+$/i.test(site.site_tag)) return [];
        const domain =
          typeof site.host === "string" && site.host
            ? site.host
            : typeof site.ruleset?.zone_name === "string"
              ? site.ruleset.zone_name
              : "";
        return [{ id: `${account.id}:${site.site_tag}`, name: domain || site.site_tag, domain }];
      });
    }),
  );
  const failed = lists.find((list): list is PromiseRejectedResult => list.status === "rejected");
  if (failed && lists.every((list) => list.status === "rejected")) throw failed.reason;
  return lists.flatMap((list) => (list.status === "fulfilled" ? list.value : [])).sort((a, b) => a.name.localeCompare(b.name));
}

export function matchWebAnalyticsSite(sites: UmamiWebsite[], siteUrl: string): UmamiWebsite | null {
  const host = bareHost(siteUrl);
  return sites.find((site) => site.domain && bareHost(site.domain) === host) ?? null;
}

interface Row {
  count?: number;
  sum?: { visits?: number };
  dimensions?: Record<string, string | null>;
}

async function graphql<T>(token: string, query: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
    throw new CloudflareError(`Cloudflare ${reason}.`);
  }
  if (res.status === 401) throw new CloudflareError("Cloudflare did not accept that API token.", 400);
  if (res.status === 429) throw new CloudflareError("Cloudflare is rate limiting requests. Try again in a moment.");
  let body = null as { data?: T | null; errors?: { message?: string }[] } | null;
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Handled below with the status.
  }
  const message = body?.errors?.[0]?.message;
  if (res.status === 403 || (message && /authoriz|permission|access/i.test(message))) {
    throw new CloudflareError(
      "The Cloudflare API token cannot read Web Analytics. Edit it and add Account Analytics: Read.",
      400,
    );
  }
  if (!res.ok || !body?.data) {
    throw new CloudflareError(`Cloudflare answered ${res.status}${message ? `: ${message}` : ""}.`);
  }
  if (message) throw new CloudflareError(`Cloudflare Web Analytics: ${message}`);
  return body.data;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

/** One aliased page-load query: the rows grouped by `dimension` (or one total row when it is null). */
function field(alias: string, siteTag: string, from: number, to: number, dimension: string | null, limit: number, order: string): string {
  const filter = `{AND: [{datetime_geq: "${iso(from)}"}, {datetime_lt: "${iso(to)}"}, {siteTag: ${JSON.stringify(siteTag)}}]}`;
  const dims = dimension ? `dimensions { value: ${dimension} }` : "";
  return `${alias}: rumPageloadEventsAdaptiveGroups(filter: ${filter}, limit: ${limit}, orderBy: [${order}]) { count sum { visits } ${dims} }`;
}

const BREAKDOWN_DIMENSIONS: Partial<Record<AnalyticsBreakdown, { dimension: string; fallback: string }>> = {
  pages: { dimension: "requestPath", fallback: "(unknown)" },
  referrers: { dimension: "refererHost", fallback: "Direct" },
  countries: { dimension: "countryName", fallback: "Unknown" },
  browsers: { dimension: "userAgentBrowser", fallback: "Unknown" },
  os: { dimension: "userAgentOS", fallback: "Unknown" },
  devices: { dimension: "deviceType", fallback: "Unknown" },
};

function top(rows: Row[] | undefined, fallback: string): { label: string; count: number }[] {
  return (rows ?? []).map((row) => ({ label: row.dimensions?.value || fallback, count: Number(row.count) || 0 })).slice(0, 10);
}

function parseRef(ref: string): { account: string; tag: string } {
  const [account, tag] = ref.split(":");
  if (!account || !tag || !/^[a-z0-9]+$/i.test(account) || !/^[a-z0-9]+$/i.test(tag)) {
    throw new CloudflareError("That Web Analytics site is not valid.", 400);
  }
  return { account, tag };
}

async function read(token: string, ref: string, fields: (tag: string) => string[]): Promise<Record<string, Row[]>> {
  const { account, tag } = parseRef(ref);
  const query = `{ viewer { accounts(filter: {accountTag: ${JSON.stringify(account)}}) { ${fields(tag).join(" ")} } } }`;
  const data = await graphql<{ viewer?: { accounts?: Record<string, Row[]>[] } }>(token, query);
  return data.viewer?.accounts?.[0] ?? {};
}

const stat = (value: number, previous: number): AnalyticsStat => ({ value, previous });
const total = (rows: Row[] | undefined, key: "count" | "visits"): number =>
  key === "count" ? Number(rows?.[0]?.count) || 0 : Number(rows?.[0]?.sum?.visits) || 0;

/** Page loads and visits for the period, against the one before, with the top pages and referrers. */
export async function webAnalytics(
  token: string,
  source: UmamiWebsite,
  range: AnalyticsRange,
  timeZone: string,
  now = Date.now(),
): Promise<Omit<SiteAnalytics, "chosen">> {
  const window = analyticsWindow(range, timeZone, now);
  const length = window.endAt - window.startAt;
  const rows = await read(token, source.id, (tag) => [
    field("series", tag, window.startAt, window.endAt, "datetimeHour", 10000, "datetimeHour_ASC"),
    field("current", tag, window.startAt, window.endAt, null, 1, "count_DESC"),
    field("previous", tag, window.startAt - length, window.startAt, null, 1, "count_DESC"),
    field("pages", tag, window.startAt, window.endAt, "requestPath", 10, "count_DESC"),
    field("referrers", tag, window.startAt, window.endAt, "refererHost", 10, "count_DESC"),
  ]);

  const series = new Map(window.keys.map((key) => [key, { pageviews: 0, visitors: 0 }]));
  for (const row of rows.series ?? []) {
    const at = Date.parse(String(row.dimensions?.value ?? ""));
    const bucket = Number.isFinite(at) ? series.get(bucketKey(at, timeZone, window.unit)) : undefined;
    if (!bucket) continue;
    bucket.pageviews += Number(row.count) || 0;
    // Cloudflare counts visits, not visitors, so the darker share of each bar is its visits.
    bucket.visitors += Number(row.sum?.visits) || 0;
  }

  return {
    provider: "cloudflare",
    website: source,
    range,
    stats: {
      visitors: null,
      visits: stat(total(rows.current, "visits"), total(rows.previous, "visits")),
      pageviews: stat(total(rows.current, "count"), total(rows.previous, "count")),
      bounces: null,
      totaltime: null,
    },
    series: [...series].map(([label, values]) => ({ label, ...values })),
    pages: top(rows.pages, "(unknown)"),
    referrers: top(rows.referrers, "Direct"),
  };
}

/** The Analytics tab: the summary plus the breakdowns Cloudflare has. Entry and exit pages, cities and events it does not. */
export async function webAnalyticsDetails(
  token: string,
  source: UmamiWebsite,
  range: AnalyticsRange,
  timeZone: string,
  now = Date.now(),
): Promise<Omit<SiteAnalyticsDetails, "chosen">> {
  const window = analyticsWindow(range, timeZone, now);
  const wanted = (Object.keys(BREAKDOWN_DIMENSIONS) as AnalyticsBreakdown[]).filter((key) => key !== "pages" && key !== "referrers");
  const [summary, rows] = await Promise.all([
    webAnalytics(token, source, range, timeZone, now),
    read(token, source.id, (tag) =>
      wanted.map((key) => field(key, tag, window.startAt, window.endAt, BREAKDOWN_DIMENSIONS[key]!.dimension, 10, "count_DESC")),
    ),
  ]);
  const breakdowns: Record<AnalyticsBreakdown, { label: string; count: number }[] | null> = {
    pages: summary.pages,
    referrers: summary.referrers,
    entry: null,
    exit: null,
    countries: null,
    cities: null,
    browsers: null,
    os: null,
    devices: null,
    events: null,
  };
  for (const key of wanted) breakdowns[key] = top(rows[key], BREAKDOWN_DIMENSIONS[key]!.fallback);
  return { ...summary, breakdowns, active: null };
}

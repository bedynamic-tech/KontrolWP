import type { AnalyticsStat, SearchConsoleRange, SearchConsoleRow, SiteSearchConsole, UmamiWebsite } from "../shared/types.ts";
import { googleCall } from "./google.ts";
import { bareHost } from "./umami.ts";

/**
 * Google Search Console through the Search Analytics API, read with the same
 * service account as Google Analytics. The service account's email must be
 * added as a user of the property in Search Console. A property is a URL
 * prefix ("https://example.com/") or a domain property ("sc-domain:example.com").
 */

const API = "https://www.googleapis.com/webmasters/v3";
/** Search Console data lags by about two days, so the period ends then. */
const LAG_DAYS = 2;
const DAYS: Record<SearchConsoleRange, number> = { "7d": 7, "28d": 28, "90d": 90 };

/** Every property the service account can read. */
export async function listSearchConsoleProperties(token: string): Promise<UmamiWebsite[]> {
  const body = await googleCall<{ siteEntry?: { siteUrl?: string; permissionLevel?: string }[] }>(token, `${API}/sites`);
  return (body.siteEntry ?? [])
    .filter((entry) => entry.siteUrl && entry.permissionLevel !== "siteUnverifiedUser")
    .map((entry): UmamiWebsite => {
      const url = entry.siteUrl!;
      const domain = url.startsWith("sc-domain:") ? url.slice("sc-domain:".length) : bareHost(url);
      return { id: url, name: url.startsWith("sc-domain:") ? domain : url, domain };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The domain property for the site's host if there is one, else a URL-prefix property on that host. */
export function matchSearchConsoleProperty(properties: UmamiWebsite[], siteUrl: string): UmamiWebsite | null {
  const host = bareHost(siteUrl);
  const same = properties.filter((property) => property.domain === host);
  return same.find((property) => property.id.startsWith("sc-domain:")) ?? same[0] ?? null;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface ApiRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

const query = (token: string, property: string, body: Record<string, unknown>) =>
  googleCall<{ rows?: ApiRow[] }>(token, `${API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: "POST",
    body,
  }).then((result) => result.rows ?? []);

const listRow = (row: ApiRow): SearchConsoleRow => ({
  label: row.keys?.[0] ?? "",
  clicks: Number(row.clicks) || 0,
  impressions: Number(row.impressions) || 0,
  ctr: Number(row.ctr) || 0,
  position: Number(row.position) || 0,
});

const stat = (value: number, previous: number | null): AnalyticsStat => ({ value, previous });

/** Clicks, impressions, click-through rate and position for the period against the one before, with its top queries and pages. */
export async function searchConsole(
  token: string,
  property: UmamiWebsite,
  range: SearchConsoleRange,
  now = Date.now(),
): Promise<Omit<SiteSearchConsole, "chosen">> {
  const days = DAYS[range];
  const end = now - LAG_DAYS * 86_400_000;
  const current = { startDate: day(end - (days - 1) * 86_400_000), endDate: day(end) };
  const previous = { startDate: day(end - (2 * days - 1) * 86_400_000), endDate: day(end - days * 86_400_000) };
  const [totals, before, series, queries, pages] = await Promise.all([
    query(token, property.id, { ...current }),
    query(token, property.id, { ...previous }),
    query(token, property.id, { ...current, dimensions: ["date"], rowLimit: 100 }),
    query(token, property.id, { ...current, dimensions: ["query"], rowLimit: 10 }),
    query(token, property.id, { ...current, dimensions: ["page"], rowLimit: 10 }),
  ]);
  const now_ = totals[0] ?? {};
  const was = before[0] ?? null;
  return {
    property,
    range,
    totals: {
      clicks: stat(Number(now_.clicks) || 0, was ? Number(was.clicks) || 0 : null),
      impressions: stat(Number(now_.impressions) || 0, was ? Number(was.impressions) || 0 : null),
      ctr: stat(Number(now_.ctr) || 0, was ? Number(was.ctr) || 0 : null),
      position: stat(Number(now_.position) || 0, was ? Number(was.position) || 0 : null),
    },
    series: series.map((row) => ({
      label: row.keys?.[0] ?? "",
      clicks: Number(row.clicks) || 0,
      impressions: Number(row.impressions) || 0,
    })),
    queries: queries.map(listRow),
    pages: pages.map(listRow),
  };
}

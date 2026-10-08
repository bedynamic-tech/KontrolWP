import type {
  AnalyticsBreakdown,
  AnalyticsRange,
  AnalyticsStat,
  SiteAnalytics,
  SiteAnalyticsDetails,
  UmamiWebsite,
} from "../shared/types.ts";
import { googleCall } from "./google.ts";
import { analyticsWindow, bareHost, bucketKey, zoneOffset } from "./umami.ts";

/**
 * Google Analytics 4 through the Analytics Data and Admin APIs, read with a
 * service account that has Viewer access to the property. A source is the
 * numeric property id.
 */

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";
/** Properties looked at when matching a site by domain, so a large account does not take long. */
const MAX_PROPERTIES = 30;

/** Every GA4 property the service account can see, with the address of its first web stream. */
export async function listGa4Properties(token: string): Promise<UmamiWebsite[]> {
  const summaries = await googleCall<{ accountSummaries?: { propertySummaries?: { property?: string; displayName?: string }[] }[] }>(
    token,
    `${ADMIN}/accountSummaries?pageSize=200`,
  );
  const properties = (summaries.accountSummaries ?? [])
    .flatMap((account) => account.propertySummaries ?? [])
    .flatMap((property) => {
      const id = /^properties\/(\d+)$/.exec(property.property ?? "")?.[1];
      return id ? [{ id, name: property.displayName ?? id }] : [];
    })
    .slice(0, MAX_PROPERTIES);
  return Promise.all(
    properties.map(async (property): Promise<UmamiWebsite> => {
      const streams = await googleCall<{ dataStreams?: { webStreamData?: { defaultUri?: string } }[] }>(
        token,
        `${ADMIN}/properties/${property.id}/dataStreams?pageSize=20`,
      ).catch(() => ({ dataStreams: [] }));
      const uri = (streams.dataStreams ?? []).map((stream) => stream.webStreamData?.defaultUri).find((value) => !!value) ?? "";
      return { id: property.id, name: property.name, domain: uri ? bareHost(uri) : "" };
    }),
  );
}

export function matchGa4Property(properties: UmamiWebsite[], siteUrl: string): UmamiWebsite | null {
  const host = bareHost(siteUrl);
  return properties.find((property) => property.domain && property.domain === host) ?? null;
}

interface Report {
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
}

const METRICS = ["totalUsers", "sessions", "screenPageViews", "bounceRate", "averageSessionDuration"] as const;

const run = (token: string, property: string, body: Record<string, unknown>) =>
  googleCall<Report>(token, `${DATA}/properties/${property}:runReport`, { method: "POST", body });

interface Totals {
  users: number;
  sessions: number;
  views: number;
  bounces: number;
  seconds: number;
}

const empty = (): Totals => ({ users: 0, sessions: 0, views: 0, bounces: 0, seconds: 0 });

function totalsOf(values: (string | undefined)[]): Totals {
  const [users, sessions, views, bounceRate, average] = values.map((value) => Number(value) || 0);
  return { users, sessions, views, bounces: bounceRate * sessions, seconds: average * sessions };
}

function add(into: Totals, from: Totals) {
  into.users += from.users;
  into.sessions += from.sessions;
  into.views += from.views;
  into.bounces += from.bounces;
  into.seconds += from.seconds;
}

/** The property's own time zone; GA reports every date and hour in it. */
async function propertyZone(token: string, property: string): Promise<string> {
  const body = await googleCall<{ timeZone?: string }>(token, `${ADMIN}/properties/${property}`).catch(() => ({}) as { timeZone?: string });
  return body.timeZone || "UTC";
}

/** The instant a GA wall time ("YYYYMMDDHH" or "YYYYMMDD") is in the property's zone. */
function instantOf(wall: string, zone: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})?$/.exec(wall);
  if (!match) return null;
  const asUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), match[4] ? Number(match[4]) : 12);
  return asUtc - zoneOffset(asUtc, zone);
}

const stat = (value: number, previous: number): AnalyticsStat => ({ value, previous });

function top(report: Report): { label: string; count: number }[] {
  return (report.rows ?? [])
    .map((row) => ({ label: row.dimensionValues?.[0]?.value || "(unknown)", count: Number(row.metricValues?.[0]?.value) || 0 }))
    .slice(0, 10);
}

const topReport = (token: string, property: string, ranges: unknown, dimension: string, metric: string) =>
  run(token, property, {
    dateRanges: ranges,
    dimensions: [{ name: dimension }],
    metrics: [{ name: metric }],
    orderBys: [{ metric: { metricName: metric }, desc: true }],
    limit: 10,
  });

/** The summary for the period against the one before, with the top pages and referrers. */
export async function ga4Analytics(
  token: string,
  property: UmamiWebsite,
  range: AnalyticsRange,
  timeZone: string,
  now = Date.now(),
): Promise<Omit<SiteAnalytics, "chosen">> {
  const window = analyticsWindow(range, timeZone, now);
  const zone = await propertyZone(token, property.id);
  const hourly = window.unit === "hour";
  const length = window.endAt - window.startAt;
  const day = (ms: number) => bucketKey(ms, zone, "day");
  const current = { startDate: day(window.startAt), endDate: day(window.endAt - 1) };
  const previous = { startDate: day(window.startAt - length), endDate: day(window.startAt - 1) };
  // A 24 hour period is not whole days, so it is added up from hours; longer ones use GA's own totals.
  const spanFrom = hourly ? day(window.startAt - length) : current.startDate;
  const [series, totals, pages, referrers] = await Promise.all([
    run(token, property.id, {
      dateRanges: [{ startDate: spanFrom, endDate: current.endDate }],
      dimensions: [{ name: hourly ? "dateHour" : "date" }],
      metrics: METRICS.map((name) => ({ name })),
      limit: 10000,
    }),
    hourly
      ? Promise.resolve<Report>({})
      : run(token, property.id, {
          dateRanges: [
            { ...current, name: "current" },
            { ...previous, name: "previous" },
          ],
          metrics: METRICS.map((name) => ({ name })),
        }),
    topReport(token, property.id, [{ ...current }], "pagePath", "screenPageViews"),
    topReport(token, property.id, [{ ...current }], "sessionSource", "sessions"),
  ]);

  const buckets = new Map(window.keys.map((key) => [key, { pageviews: 0, visitors: 0 }]));
  const now24 = { current: empty(), previous: empty() };
  for (const row of series.rows ?? []) {
    const at = instantOf(row.dimensionValues?.[0]?.value ?? "", zone);
    if (at === null) continue;
    const values = totalsOf((row.metricValues ?? []).map((metric) => metric.value));
    const bucket = buckets.get(bucketKey(at, timeZone, window.unit));
    if (bucket) {
      bucket.pageviews += values.views;
      bucket.visitors += values.users;
    }
    if (hourly) add(at >= window.startAt && at < window.endAt ? now24.current : at >= window.startAt - length && at < window.startAt ? now24.previous : empty(), values);
  }

  let cur = now24.current;
  let prev = now24.previous;
  if (!hourly) {
    cur = empty();
    prev = empty();
    for (const row of totals.rows ?? []) {
      const name = row.dimensionValues?.[0]?.value;
      const values = totalsOf((row.metricValues ?? []).map((metric) => metric.value));
      if (name === "current") cur = values;
      else if (name === "previous") prev = values;
    }
  }

  return {
    provider: "ga4",
    website: property,
    range,
    stats: {
      visitors: stat(cur.users, prev.users),
      visits: stat(cur.sessions, prev.sessions),
      pageviews: stat(cur.views, prev.views),
      bounces: stat(cur.bounces, prev.bounces),
      totaltime: stat(cur.seconds, prev.seconds),
    },
    series: [...buckets].map(([label, values]) => ({ label, ...values })),
    pages: top(pages),
    referrers: top(referrers).map((row) => ({ ...row, label: row.label === "(direct)" ? "Direct" : row.label })),
  };
}

const BREAKDOWNS: Partial<Record<AnalyticsBreakdown, { dimension: string; metric: string }>> = {
  entry: { dimension: "landingPage", metric: "sessions" },
  countries: { dimension: "country", metric: "totalUsers" },
  cities: { dimension: "city", metric: "totalUsers" },
  browsers: { dimension: "browser", metric: "totalUsers" },
  os: { dimension: "operatingSystem", metric: "totalUsers" },
  devices: { dimension: "deviceCategory", metric: "totalUsers" },
  events: { dimension: "eventName", metric: "eventCount" },
};

/** The Analytics tab: the summary, GA's other breakdowns, and the people on the site now. GA has no exit pages. */
export async function ga4Details(
  token: string,
  property: UmamiWebsite,
  range: AnalyticsRange,
  timeZone: string,
  now = Date.now(),
): Promise<Omit<SiteAnalyticsDetails, "chosen">> {
  const window = analyticsWindow(range, timeZone, now);
  const zone = await propertyZone(token, property.id);
  const ranges = [{ startDate: bucketKey(window.startAt, zone, "day"), endDate: bucketKey(window.endAt - 1, zone, "day") }];
  const keys = Object.keys(BREAKDOWNS) as AnalyticsBreakdown[];
  const [summary, active, ...lists] = await Promise.all([
    ga4Analytics(token, property, range, timeZone, now),
    googleCall<Report>(token, `${DATA}/properties/${property.id}:runRealtimeReport`, {
      method: "POST",
      body: { metrics: [{ name: "activeUsers" }] },
    })
      .then((report) => Number(report.rows?.[0]?.metricValues?.[0]?.value) || 0)
      .catch(() => null),
    ...keys.map((key) => topReport(token, property.id, ranges, BREAKDOWNS[key]!.dimension, BREAKDOWNS[key]!.metric).then(top, () => null)),
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
  keys.forEach((key, index) => (breakdowns[key] = lists[index]));
  return { ...summary, breakdowns, active };
}

import type { AnalyticsRange, AnalyticsStat, GoogleAdsAccount, SiteGoogleAds } from "../shared/types.ts";
import { googleCall } from "./google.ts";
import { decryptSetting, encryptSetting } from "./sites/secrets.ts";

/**
 * Google Ads through the Google Ads API (REST), read with the same Google
 * sign-in as Analytics and Search Console. The API also needs a developer
 * token, which Google issues to the owner's Ads manager account (API Center);
 * until Google approves "Basic access" it only works on test accounts.
 */

const SETTING = "google_ads";
/** Google retires API versions after about a year, so this is the one place to bump. */
export const ADS_API_VERSION = "v23";
const API = `https://googleads.googleapis.com/${ADS_API_VERSION}`;
const REFUSAL = "Google Ads needs a developer token that Google has approved (Basic access, or a test account) and the connected account must be a user of the Ads account.";
const DAYS: Record<AnalyticsRange, number> = { "24h": 7, "7d": 7, "30d": 30, "90d": 90 };

/** The digits of an Ads customer ID; Google shows them as 123-456-7890. */
export const adsCustomerId = (value: string): string => value.replace(/\D/g, "");

export async function loadAdsToken(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?").bind(SETTING).first<{ value: string }>();
  if (!row) return null;
  const stored = JSON.parse(row.value) as { token: string };
  return decryptSetting(env.SITE_SECRETS_KEY, SETTING, stored.token);
}

export async function saveAdsToken(env: Env, token: string): Promise<void> {
  const value = JSON.stringify({ token: await encryptSetting(env.SITE_SECRETS_KEY, SETTING, token) });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)").bind(SETTING, value).run();
}

export async function deleteAdsToken(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE name = ?").bind(SETTING).run();
}

interface Search<T> {
  results?: T[];
}

/** A GAQL query against one customer, acting through the manager account when there is one. */
function search<T>(token: string, developerToken: string, customer: string, login: string | null, query: string): Promise<T[]> {
  return googleCall<Search<T>>(token, `${API}/customers/${customer}/googleAds:search`, {
    method: "POST",
    body: { query },
    headers: { "developer-token": developerToken, ...(login ? { "login-customer-id": login } : {}) },
    refusal: REFUSAL,
  }).then((body) => body.results ?? []);
}

/** The Ads accounts the connected Google account can see, including the clients under any manager account. */
export async function listAdsAccounts(token: string, developerToken: string): Promise<GoogleAdsAccount[]> {
  const listed = await googleCall<{ resourceNames?: string[] }>(token, `${API}/customers:listAccessibleCustomers`, {
    headers: { "developer-token": developerToken },
    refusal: REFUSAL,
  });
  const roots = (listed.resourceNames ?? []).map((name) => adsCustomerId(name));
  type Row = { customerClient?: { id?: string; descriptiveName?: string; manager?: boolean; status?: string } };
  const lists = await Promise.all(
    roots.map((root) =>
      search<Row>(
        token,
        developerToken,
        root,
        root,
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level <= 1",
      ).then(
        (rows) => ({ root, rows }),
        (error: unknown) => ({ root, rows: [] as Row[], error }),
      ),
    ),
  );
  // An account that cannot be read (cancelled, no access) is skipped; if none can be, say why.
  const failed = lists.find((entry) => "error" in entry);
  if (failed && lists.every((entry) => "error" in entry)) throw (failed as { error: unknown }).error;
  const accounts = new Map<string, GoogleAdsAccount>();
  for (const { root, rows } of lists) {
    for (const { customerClient: client } of rows) {
      if (!client?.id || client.manager || (client.status && client.status !== "ENABLED")) continue;
      const id = adsCustomerId(client.id);
      if (accounts.has(id)) continue;
      accounts.set(id, { id: id === root ? id : `${root}/${id}`, name: client.descriptiveName || id, customer: id });
    }
  }
  return [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const stat = (value: number, previous: number | null): AnalyticsStat => ({ value, previous });

type MetricRow = {
  segments?: { date?: string };
  metrics?: { clicks?: string | number; impressions?: string | number; costMicros?: string | number; conversions?: string | number };
};

const sum = (rows: MetricRow[], pick: (row: MetricRow) => unknown) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Clicks, impressions, cost and conversions per day for the period, against the one before. */
export async function googleAds(
  token: string,
  developerToken: string,
  account: GoogleAdsAccount,
  range: AnalyticsRange,
  now = Date.now(),
): Promise<Omit<SiteGoogleAds, "chosen" | "accounts">> {
  const [login, customer] = account.id.includes("/") ? account.id.split("/") : [null, account.id];
  const days = DAYS[range];
  const end = now;
  const current = { start: day(end - (days - 1) * 86_400_000), end: day(end) };
  const previous = { start: day(end - (2 * days - 1) * 86_400_000), end: day(end - days * 86_400_000) };
  const metrics = (period: { start: string; end: string }) =>
    search<MetricRow>(
      token,
      developerToken,
      customer,
      login,
      `SELECT segments.date, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions FROM customer WHERE segments.date BETWEEN '${period.start}' AND '${period.end}' ORDER BY segments.date`,
    );
  const [now_, before, currency] = await Promise.all([
    metrics(current),
    metrics(previous),
    search<{ customer?: { currencyCode?: string } }>(token, developerToken, customer, login, "SELECT customer.currency_code FROM customer LIMIT 1"),
  ]);
  const rowsOf = (list: { metrics?: MetricRow["metrics"]; segments?: MetricRow["segments"] }[]) => list as MetricRow[];
  const cost = (rows: MetricRow[]) => sum(rows, (row) => row.metrics?.costMicros) / 1_000_000;
  const hadBefore = before.length > 0;
  return {
    account,
    range,
    currency: currency[0]?.customer?.currencyCode ?? "",
    totals: {
      clicks: stat(sum(now_, (row) => row.metrics?.clicks), hadBefore ? sum(before, (row) => row.metrics?.clicks) : null),
      impressions: stat(sum(now_, (row) => row.metrics?.impressions), hadBefore ? sum(before, (row) => row.metrics?.impressions) : null),
      cost: stat(cost(rowsOf(now_)), hadBefore ? cost(rowsOf(before)) : null),
      conversions: stat(sum(now_, (row) => row.metrics?.conversions), hadBefore ? sum(before, (row) => row.metrics?.conversions) : null),
    },
    series: now_.map((row) => ({
      label: row.segments?.date ?? "",
      clicks: Number(row.metrics?.clicks) || 0,
      impressions: Number(row.metrics?.impressions) || 0,
      cost: (Number(row.metrics?.costMicros) || 0) / 1_000_000,
      conversions: Number(row.metrics?.conversions) || 0,
    })),
  };
}

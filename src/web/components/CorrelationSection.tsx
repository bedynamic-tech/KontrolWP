import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { correlate, describe, toDaily, type DailySeries } from "../../shared/correlation";
import type { AnalyticsRange, SearchConsoleRange, SiteSummary } from "../../shared/types";
import { fetchGoogleAds, fetchGoogleSettings, fetchSearchConsole, fetchSiteAnalytics } from "../api";
import { useAnalyticsProvider, useAnalyticsRange } from "./AnalyticsSection";
import { EmptyRow, Section } from "./Section";

const SEARCH_CONSOLE_RANGE: Record<AnalyticsRange, SearchConsoleRange> = {
  "24h": "7d",
  "7d": "7d",
  "30d": "28d",
  "90d": "90d",
};

/** How the sources move together: each pair of daily measures from the connected sources, with a correlation score. */
export function CorrelationSection(props: { site: SiteSummary }) {
  const { site } = props;
  const [range] = useAnalyticsRange();
  const source = useAnalyticsProvider(site);
  const google = useQuery({ queryKey: ["settings", "google"], queryFn: fetchGoogleSettings, refetchInterval: false });
  // The same keys the modules above use, so this reads their cached answers.
  const analytics = useQuery({
    queryKey: ["site", site.id, "analytics", range, source.provider],
    queryFn: () => fetchSiteAnalytics(site.id, range),
    enabled: source.configured,
    refetchInterval: false,
  });
  const searchConsole = useQuery({
    queryKey: ["site", site.id, "search-console", SEARCH_CONSOLE_RANGE[range]],
    queryFn: () => fetchSearchConsole(site.id, SEARCH_CONSOLE_RANGE[range]),
    enabled: !!google.data?.configured,
    refetchInterval: false,
  });

  const adsReady = !!google.data?.configured && google.data.can_use_ads && google.data.ads_token_configured;
  const ads = useQuery({
    queryKey: ["site", site.id, "google-ads", range],
    queryFn: () => fetchGoogleAds(site.id, range),
    enabled: adsReady,
    refetchInterval: false,
    retry: false,
  });

  const series = useMemo(() => {
    const out: DailySeries[] = [];
    const web = analytics.data?.website ? analytics.data : null;
    const sc = searchConsole.data?.property ? searchConsole.data : null;
    if (web) {
      const name = source.label;
      out.push({ name: `${name} visitors`, source: name, days: toDaily(web.series, (p: { visitors: number }) => p.visitors) });
      out.push({ name: `${name} pageviews`, source: name, days: toDaily(web.series, (p: { pageviews: number }) => p.pageviews) });
    }
    if (sc) {
      out.push({ name: "Search Console clicks", source: "Search Console", days: toDaily(sc.series, (p: { clicks: number }) => p.clicks) });
      out.push({ name: "Search Console impressions", source: "Search Console", days: toDaily(sc.series, (p: { impressions: number }) => p.impressions) });
    }
    const gads = ads.data?.account ? ads.data : null;
    if (gads) {
      out.push({ name: "Ads clicks", source: "Google Ads", days: toDaily(gads.series, (p: { clicks: number }) => p.clicks) });
      out.push({ name: "Ads cost", source: "Google Ads", days: toDaily(gads.series, (p: { cost: number }) => p.cost) });
      out.push({ name: "Ads conversions", source: "Google Ads", days: toDaily(gads.series, (p: { conversions: number }) => p.conversions) });
    }
    return out;
  }, [analytics.data, searchConsole.data, ads.data, source.label]);

  // Only pairs from different sources say anything; two measures of one source move together by definition.
  const pairs = useMemo(() => correlate(series).filter((pair) => !pair.same), [series]);
  const loading =
    (analytics.isPending && source.configured) ||
    (searchConsole.isPending && !!google.data?.configured) ||
    (ads.isPending && adsReady);

  return (
    <Section
      title="Correlation"
      hint="How closely two measures rise and fall together day by day over the chosen range. 1 means they move in step, 0 means no link, and negative means one rises as the other falls. A link is not proof one causes the other."
    >
      {loading ? (
        <EmptyRow>Loading...</EmptyRow>
      ) : new Set(series.map((item) => item.source)).size < 2 ? (
        <EmptyRow>Connect two or more of Analytics, Search Console and Google Ads to see how they line up for this site.</EmptyRow>
      ) : pairs.length === 0 ? (
        <EmptyRow>Not enough overlapping days yet. Pick a longer range.</EmptyRow>
      ) : (
        <ul className="divide-y">
          {pairs.map((pair) => (
            <li key={`${pair.a}|${pair.b}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                {pair.a} and {pair.b}
              </span>
              <span className="flex items-center gap-3 text-muted-foreground">
                <span>{describe(pair.r)}</span>
                <span className="w-12 text-right font-medium tabular-nums text-foreground">{pair.r.toFixed(2)}</span>
              </span>
            </li>
          ))}
          <li className="px-4 py-2 text-xs text-muted-foreground">Based on {pairs[0].days} days of data.</li>
        </ul>
      )}
    </Section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AnalyticsBreakdown, SiteAnalyticsDetails, SiteSummary } from "../../shared/types";
import { fetchSiteAnalyticsDetails } from "../api";
import { hostname } from "../format";
import {
  AnalyticsFooter,
  count,
  RangeSelect,
  SELECT_CLASS,
  StatsRow,
  TopList,
  TrendChart,
  useAnalyticsProvider,
  useAnalyticsRange,
  WebsitePicker,
} from "./AnalyticsSection";
import { GoogleAdsSection } from "./GoogleAdsSection";
import { ErrorBoundary } from "./ErrorBoundary";
import { CorrelationSection } from "./CorrelationSection";
import { SearchConsoleSection } from "./SearchConsoleSection";
import { EmptyRow, Section } from "./Section";

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" });
  } catch {
    return null;
  }
})();

/** "US" as "United States"; anything else as it is. */
function countryName(code: string): string {
  if (!/^[A-Z]{2}$/i.test(code) || !regionNames) return code;
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Each breakdown's card, in the order they appear. */
const CARDS: {
  key: AnalyticsBreakdown;
  title: string;
  unit: string;
  empty: string;
  format?: (label: string) => string;
}[] = [
  { key: "pages", title: "Pages", unit: "Views", empty: "No pageviews in this period." },
  { key: "entry", title: "Entry pages", unit: "Visits", empty: "No visits in this period." },
  { key: "exit", title: "Exit pages", unit: "Visits", empty: "No visits in this period." },
  { key: "referrers", title: "Referrers", unit: "Visitors", empty: "No referrers in this period." },
  { key: "countries", title: "Countries", unit: "Visitors", empty: "No visitors in this period.", format: countryName },
  { key: "cities", title: "Cities", unit: "Visitors", empty: "No visitors in this period." },
  { key: "browsers", title: "Browsers", unit: "Visitors", empty: "No visitors in this period.", format: capitalize },
  { key: "os", title: "Operating systems", unit: "Visitors", empty: "No visitors in this period." },
  { key: "devices", title: "Devices", unit: "Visitors", empty: "No visitors in this period.", format: capitalize },
  { key: "events", title: "Events", unit: "Count", empty: "No events in this period." },
];

const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "search-console", label: "Search Console" },
  { id: "analytics", label: "Analytics" },
  { id: "google-ads", label: "Google Ads" },
] as const;
type View = (typeof VIEWS)[number]["id"];

/** The shortcut links on the site Overview point at these. */
const HASH_VIEWS: Record<string, View> = { "site-search-console": "search-console", "site-analytics": "analytics" };

/** The Analytics tab: a view menu, with the correlation report as its Overview. */
export function AnalyticsTab(props: { site: SiteSummary }) {
  const { site } = props;
  const source = useAnalyticsProvider(site);
  const { hash } = useLocation();
  const [view, setView] = useState<View>(HASH_VIEWS[hash.slice(1)] ?? "overview");
  const [range, chooseRange] = useAnalyticsRange();
  useEffect(() => {
    const requested = HASH_VIEWS[hash.slice(1)];
    if (requested) setView(requested);
  }, [hash]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          aria-label="View"
          value={view}
          onChange={(event) => setView(event.target.value as View)}
          className={`${SELECT_CLASS} w-auto!`}
        >
          {VIEWS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <RangeSelect range={range} onChange={chooseRange} />
      </div>
      {view === "overview" && (
        <div className="mt-3">
          <ErrorBoundary label="Correlation">
            <CorrelationSection site={site} />
          </ErrorBoundary>
        </div>
      )}
      {view === "search-console" && (
        <div id="site-search-console" className="mt-3">
          <ErrorBoundary label="Search Console">
            <SearchConsoleSection site={site} linked />
          </ErrorBoundary>
        </div>
      )}
      {view === "google-ads" && (
        <div id="site-google-ads" className="mt-3">
          <ErrorBoundary label="Google Ads">
            <GoogleAdsSection site={site} />
          </ErrorBoundary>
        </div>
      )}
      {view === "analytics" && (
        <div id="site-analytics">
          {source.configured ? (
            <AnalyticsContent site={site} />
          ) : (
            source.loaded && (
              <Section title="Analytics">
                <EmptyRow>
                  Connect {source.label} in{" "}
                  <Link to="/settings?tab=integrations" className="underline underline-offset-4">
                    Settings
                  </Link>{" "}
                  to show this site's analytics.
                </EmptyRow>
              </Section>
            )
          )}
        </div>
      )}
    </>
  );
}

function AnalyticsContent(props: { site: SiteSummary }) {
  const { site } = props;
  const { label } = useAnalyticsProvider(site);
  const [range] = useAnalyticsRange();
  const details = useQuery({
    queryKey: ["site", site.id, "analytics-details", range, site.analytics_provider],
    queryFn: () => fetchSiteAnalyticsDetails(site.id, range),
    refetchInterval: 5 * 60_000,
    placeholderData: (previous) => previous,
  });

  const header = (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <ActiveNow data={details.data} />
    </div>
  );

  if (details.isPending) {
    return (
      <>
        {header}
        <div className="mt-3 space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        </div>
      </>
    );
  }
  if (details.error) {
    return (
      <>
        {header}
        <p className="mt-3 rounded-xl border bg-background px-4 py-6 text-center text-sm text-destructive">
          {details.error.message}
        </p>
      </>
    );
  }

  const data = details.data;
  if (!data.website || !data.breakdowns) {
    return (
      <Section title="Analytics">
        <div className="space-y-3 px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {data.chosen
              ? `The ${label} source chosen for this site is no longer there.`
              : `${label} has nothing for the domain ${hostname(site.url)}.`}{" "}
            Choose the one to show.
          </p>
          <WebsitePicker site={site} current={null} chosen={data.chosen} />
        </div>
      </Section>
    );
  }

  const breakdowns = data.breakdowns;
  return (
    <div className={cn(details.isPlaceholderData && "opacity-60 transition-opacity")}>
      {header}
      <div className="@container mt-3 overflow-hidden rounded-xl border bg-background">
        <StatsRow data={data} />
        <TrendChart data={data} tall />
        <AnalyticsFooter site={site} data={data} />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {CARDS.filter((card) => breakdowns[card.key] !== null).map((card) => (
          <div key={card.key} className="overflow-hidden rounded-xl border bg-background">
            <TopList
              title={card.title}
              unit={card.unit}
              rows={breakdowns[card.key]!}
              empty={card.empty}
              format={card.format}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** "3 visitors right now", with a soft pulse while anyone is on the site. */
function ActiveNow(props: { data: SiteAnalyticsDetails | undefined }) {
  const active = props.data?.active;
  if (active === null || active === undefined) return <span />;
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground" title="Visitors in the last five minutes">
      <span className="relative flex size-2">
        {active > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            active > 0 ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
      </span>
      <span>
        <span className="font-medium text-foreground tabular-nums">{count(active)}</span>{" "}
        {active === 1 ? "visitor" : "visitors"} right now
      </span>
    </span>
  );
}

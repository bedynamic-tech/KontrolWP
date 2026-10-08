import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AnalyticsProvider, AnalyticsRange, AnalyticsStat, SiteAnalytics, SiteSummary } from "../../shared/types";
import {
  fetchCloudflareSettings,
  fetchGa4Properties,
  fetchGoogleSettings,
  fetchSiteAnalytics,
  fetchUmamiSettings,
  fetchUmamiWebsites,
  fetchWebAnalyticsSites,
  setSiteAnalyticsSource,
  setSiteUmamiWebsite,
} from "../api";
import { hostname } from "../format";
import { CloudflareSetup, cloudflareSetupState } from "./AnalyticsSetup";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export const PROVIDER_LABELS: Record<AnalyticsProvider, string> = {
  umami: "Umami",
  cloudflare: "Cloudflare Web Analytics",
  ga4: "Google Analytics",
};

/** Whether the provider this site reads its analytics from is connected in Settings; `loaded` is false until that is known. */
export function useAnalyticsProvider(site: SiteSummary) {
  const provider = site.analytics_provider ?? "umami";
  const umami = useQuery({ queryKey: ["settings", "umami"], queryFn: fetchUmamiSettings, refetchInterval: false });
  const cloudflare = useQuery({ queryKey: ["settings", "cloudflare"], queryFn: fetchCloudflareSettings, refetchInterval: false });
  const google = useQuery({ queryKey: ["settings", "google"], queryFn: fetchGoogleSettings, refetchInterval: false });
  const connected: Record<AnalyticsProvider, boolean | undefined> = {
    umami: umami.data?.configured,
    cloudflare: cloudflare.data?.configured,
    ga4: google.data?.configured,
  };
  return {
    provider,
    label: PROVIDER_LABELS[provider],
    configured: !!connected[provider],
    loaded: connected[provider] !== undefined,
    connected,
  };
}

export const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm sm:w-auto outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** The site's Umami analytics; shows nothing until Umami is connected in Settings. */
/** The chosen date range, remembered in this browser and shared by the Overview card and the Analytics tab. */
export function useAnalyticsRange(): [AnalyticsRange, (next: AnalyticsRange) => void] {
  const [range, setRange] = useState<AnalyticsRange>(() => {
    try {
      const saved = localStorage.getItem("kontrolwp:analytics-range");
      return saved && saved in RANGE_LABELS ? (saved as AnalyticsRange) : "7d";
    } catch {
      return "7d";
    }
  });
  const choose = (next: AnalyticsRange) => {
    setRange(next);
    try {
      localStorage.setItem("kontrolwp:analytics-range", next);
    } catch {
      // Remembering the range is only a convenience.
    }
  };
  return [range, choose];
}

export function RangeSelect(props: { range: AnalyticsRange; onChange: (next: AnalyticsRange) => void }) {
  return (
    <select
      aria-label="Date range"
      value={props.range}
      onChange={(event) => props.onChange(event.target.value as AnalyticsRange)}
      className={`${SELECT_CLASS} w-auto!`}
    >
      {(Object.keys(RANGE_LABELS) as AnalyticsRange[]).map((value) => (
        <option key={value} value={value}>
          {RANGE_LABELS[value]}
        </option>
      ))}
    </select>
  );
}

export function AnalyticsSection(props: { site: SiteSummary }) {
  const { site } = props;
  const [range, chooseRange] = useAnalyticsRange();
  const source = useAnalyticsProvider(site);
  const analytics = useQuery({
    queryKey: ["site", site.id, "analytics", range, source.provider],
    queryFn: () => fetchSiteAnalytics(site.id, range),
    enabled: source.configured,
    refetchInterval: 5 * 60_000,
    placeholderData: (previous) => previous,
  });

  // Umami is the default and stays hidden until connected; a site that chose another provider shows how to set it up.
  if (!source.configured && (source.provider === "umami" || !source.loaded)) return null;

  const setup =
    source.provider !== "cloudflare"
      ? null
      : !source.configured
        ? "not-connected"
        : cloudflareSetupState({
            error: analytics.error,
            website: analytics.data?.website,
            sources: analytics.data?.sources,
            chosen: analytics.data?.chosen,
          });
  let body;
  if (!source.configured && !setup) {
    body = (
      <EmptyRow>
        Connect {source.label} in{" "}
        <Link to="/settings?tab=integrations" className="underline underline-offset-4">
          Settings
        </Link>{" "}
        to show this site's analytics.
      </EmptyRow>
    );
  } else if (setup) {
    body = (
      <CloudflareSetup site={site} state={setup} sources={analytics.data?.sources}>
        {setup === "no-match" && (
          <WebsitePicker site={site} current={null} chosen={analytics.data?.chosen ?? false} />
        )}
      </CloudflareSetup>
    );
  } else if (analytics.isPending) {
    body = (
      <div className="space-y-3 p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  } else if (analytics.error) {
    body = <p className="px-4 py-6 text-center text-sm text-destructive">{analytics.error.message}</p>;
  } else if (!analytics.data.website) {
    body = (
      <div className="space-y-3 px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          {analytics.data.chosen
            ? `The ${source.label} source chosen for this site is no longer there.`
            : `${source.label} has nothing for the domain ${hostname(site.url)}.`}{" "}
          Choose the one to show.
        </p>
        <WebsitePicker site={site} current={null} chosen={analytics.data.chosen} />
      </div>
    );
  } else {
    body = <AnalyticsBody data={analytics.data} />;
  }

  return (
    <Section
      title="Analytics"
      action={<RangeSelect range={range} onChange={chooseRange} />}
    >
      <div className={cn("@container", analytics.isPlaceholderData && "opacity-60 transition-opacity")}>{body}</div>
    </Section>
  );
}

function AnalyticsBody(props: { data: SiteAnalytics }) {
  const { data } = props;
  return (
    <div>
      <StatsRow data={data} />
    </div>
  );
}

/** Which source is shown, with the pencil to change it and a link to Settings. */
export function AnalyticsFooter(props: { site: SiteSummary; data: SiteAnalytics; children?: ReactNode }) {
  const { data } = props;
  const { label } = useAnalyticsProvider(props.site);
  return (
    <div className="group flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
      <span>Connected to {data.website!.name || data.website!.domain}</span>
      <WebsitePicker site={props.site} current={data.website!.id} chosen={data.chosen} compact />
      <span className="ml-auto flex items-center gap-3">
        {props.children}
        <Link to="/settings" className="hover:text-foreground hover:underline">
          {label} settings
        </Link>
      </span>
    </div>
  );
}

/** Visitors, visits, pageviews, bounce rate and visit duration, each against the period before. */
export function StatsRow(props: { data: SiteAnalytics }) {
  const stats = props.data.stats!;
  const rate = (stat: AnalyticsStat, of: AnalyticsStat): AnalyticsStat => ({
    value: of.value ? stat.value / of.value : 0,
    previous: stat.previous !== null && of.previous ? stat.previous / of.previous : null,
  });
  const bounceRate = stats.bounces ? rate(stats.bounces, stats.visits) : null;
  const visitTime = stats.totaltime ? rate(stats.totaltime, stats.visits) : null;
  // A provider that does not report a figure (Cloudflare has no visitors, bounces or duration) leaves it out.
  const cards = [
    stats.visitors && { label: "Visitors", stat: stats.visitors, format: count },
    { label: "Visits", stat: stats.visits, format: count },
    { label: "Pageviews", stat: stats.pageviews, format: count },
    bounceRate && { label: "Bounce rate", stat: bounceRate, format: percent, lowerIsBetter: true },
    visitTime && { label: "Visit duration", stat: visitTime, format: duration },
  ].filter((card): card is NonNullable<typeof card> => !!card);

  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-px border-b bg-border [&>*:last-child]:col-span-2 @2xl:[&>*:last-child]:col-span-1",
        cards.length === 5 ? "@2xl:grid-cols-5" : cards.length === 4 ? "@2xl:grid-cols-4" : "@2xl:grid-cols-3",
        cards.length % 2 === 0 && "[&>*:last-child]:col-span-1",
      )}
    >
      {cards.map((card) => (
        <Stat key={card.label} {...card} />
      ))}
    </dl>
  );
}

export const count = (value: number) => Math.round(value).toLocaleString();
const percent = (value: number) => `${Math.round(value * 100)}%`;
function duration(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}m ${total % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function Stat(props: { label: string; stat: AnalyticsStat; format: (value: number) => string; lowerIsBetter?: boolean }) {
  const { value, previous } = props.stat;
  let change = null;
  if (previous !== null && previous > 0) {
    const ratio = (value - previous) / previous;
    const better = props.lowerIsBetter ? ratio < 0 : ratio > 0;
    if (Math.round(ratio * 100) !== 0) {
      change = (
        <span className={cn("text-xs", better ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
          {ratio > 0 ? "+" : ""}
          {Math.round(ratio * 100)}%
        </span>
      );
    }
  }
  return (
    <div className="bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{props.format(value)}</span>
        {change}
      </dd>
    </div>
  );
}

/** Pageviews as bars, with the visitors share drawn darker inside each one. */
export function TrendChart(props: { data: SiteAnalytics; tall?: boolean }) {
  const { series, range } = props.data;
  // Cloudflare counts visits, not visitors.
  const visitorsLabel = props.data.provider === "cloudflare" ? "visits" : "visitors";
  const max = Math.max(1, ...series.map((point) => point.pageviews));
  const hourly = range === "24h";
  const label = (key: string) => {
    if (hourly) return `${key.slice(11, 13)}:00`;
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const ticks = series.length > 1 ? [0, Math.floor((series.length - 1) / 2), series.length - 1] : [0];

  return (
    <div className="px-4 pt-4 pb-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary/25" /> Pageviews
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" /> {visitorsLabel === "visits" ? "Visits" : "Visitors"}
        </span>
      </div>
      <div className={cn("mt-3 flex items-end gap-[2px]", props.tall ? "h-64" : "h-40")} role="img" aria-label="Pageviews and visitors over time">
        {series.map((point) => (
          <div
            key={point.label}
            className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${label(point.label)}: ${count(point.pageviews)} pageviews, ${count(point.visitors)} ${visitorsLabel}`}
          >
            <div
              className="relative w-full rounded-t-sm bg-primary/25 group-hover:bg-primary/35"
              style={{ height: `${(point.pageviews / max) * 100}%` }}
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-sm bg-primary"
                style={{ height: point.pageviews ? `${Math.min(1, point.visitors / point.pageviews) * 100}%` : 0 }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        {ticks.map((index) => (
          <span key={index}>{series[index] ? label(series[index].label) : ""}</span>
        ))}
      </div>
    </div>
  );
}

export function TopList(props: {
  title: string;
  rows: { label: string; count: number }[];
  empty: string;
  className?: string;
  /** The right-hand column heading. */
  unit?: string;
  format?: (label: string) => string;
}) {
  const max = Math.max(1, ...props.rows.map((row) => row.count));
  return (
    <div className={cn("min-w-0 px-4 py-3", props.className)}>
      <div className="mb-2 flex justify-between text-xs font-medium text-muted-foreground">
        <span>{props.title}</span>
        <span>{props.unit ?? "Views"}</span>
      </div>
      {props.rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{props.empty}</p>
      ) : (
        <ul className="space-y-1">
          {props.rows.map((row) => (
            <li key={row.label} className="relative flex items-center justify-between gap-3 rounded px-2 py-1 text-sm">
              <span className="absolute inset-y-0 left-0 rounded bg-muted" style={{ width: `${(row.count / max) * 100}%` }} />
              <span className="relative truncate" title={row.label}>{props.format ? props.format(row.label) : row.label}</span>
              <span className="relative shrink-0 tabular-nums text-muted-foreground">{count(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Choose the site's analytics source (an Umami website or a Web Analytics site), or go back to matching by domain. */
export function WebsitePicker(props: { site: SiteSummary; current: string | null; chosen: boolean; compact?: boolean }) {
  const queryClient = useQueryClient();
  const provider = props.site.analytics_provider ?? "umami";
  const noun = provider === "umami" ? "website" : provider === "ga4" ? "property" : "site";
  const label = PROVIDER_LABELS[provider];
  const [open, setOpen] = useState(!props.compact);
  const websites = useQuery({
    queryKey: [provider, "websites"],
    queryFn: provider === "umami" ? fetchUmamiWebsites : provider === "ga4" ? fetchGa4Properties : fetchWebAnalyticsSites,
    enabled: open,
    refetchInterval: false,
  });
  const save = useMutation({
    mutationFn: (ref: string | null) =>
      provider === "umami" ? setSiteUmamiWebsite(props.site.id, ref) : setSiteAnalyticsSource(props.site.id, ref),
    onSuccess: () => props.compact && setOpen(false),
    // The site (its chosen source) and every analytics query under it.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["site", props.site.id] }),
  });

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Change the ${label} ${noun}`}
        title={`Change the ${label} ${noun}`}
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
        onClick={() => setOpen(true)}
      >
        <PencilIcon />
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {(save.isPending || (websites.isPending && open)) && <Spinner className="size-3.5" label="Loading" />}
      <select
        aria-label={`${label} ${noun}`}
        value={props.chosen ? (props.current ?? "") : ""}
        disabled={websites.isPending || save.isPending}
        onChange={(event) => save.mutate(event.target.value || null)}
        className={SELECT_CLASS}
      >
        <option value="">{websites.isPending ? `Loading ${noun}s...` : "Match by domain"}</option>
        {websites.data?.websites.map((website) => (
          <option key={website.id} value={website.id}>
            {website.name}
            {website.domain && website.domain !== website.name ? ` (${website.domain})` : ""}
          </option>
        ))}
      </select>
      {(websites.error || save.error) && (
        <span className="text-xs text-destructive">{(websites.error ?? save.error)!.message}</span>
      )}
    </span>
  );
}

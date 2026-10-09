import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  type AnalyticsRange,
  type SearchConsoleRange,
  type SearchConsoleRow,
  type SiteSearchConsole,
  type SiteSummary,
} from "../../shared/types";
import {
  fetchGoogleSettings,
  fetchSearchConsole,
  fetchSearchConsoleProperties,
  fetchSeo,
  setSiteSearchConsoleProperty,
  setUpSearchConsole,
  startGoogleConnect,
} from "../api";
import { compareVersions, SEO_SINCE } from "../../shared/plugin-version";
import { hostname } from "../format";
import { count, JumpButton, RangeSelect, SELECT_CLASS, Stat, useAnalyticsRange } from "./AnalyticsSection";
import { EmptyRow, Section } from "./Section";
import { HelpTip } from "./HelpTip";
import { Spinner } from "./Spinner";

/** Search Console only offers 7, 28 and 90 days, so the shared range maps to the nearest of those. */
const SEARCH_CONSOLE_RANGE: Record<AnalyticsRange, SearchConsoleRange> = {
  "24h": "7d",
  "7d": "7d",
  "30d": "28d",
  "90d": "90d",
};

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const position = (value: number) => value.toFixed(1);

/** Search Console clicks, impressions, top queries and top pages, shown in the SEO tab once Google is connected. */
export function SearchConsoleSection(props: {
  site: SiteSummary;
  /** The Overview version: the stats and clicks trend, with a link to the full section. */
  onOpen?: () => void;
  /** The Analytics module beside this one already shows the date range, which changes both. Left out, the range sits in this heading. */
  linked?: boolean;
}) {
  const { site, onOpen, linked } = props;
  const [sharedRange, chooseRange] = useAnalyticsRange();
  const range = SEARCH_CONSOLE_RANGE[sharedRange];
  const google = useQuery({
    queryKey: ["settings", "google"],
    queryFn: fetchGoogleSettings,
    refetchInterval: false,
  });
  const data = useQuery({
    queryKey: ["site", site.id, "search-console", range],
    queryFn: () => fetchSearchConsole(site.id, range),
    enabled: !!google.data?.configured,
    refetchInterval: false,
    placeholderData: (previous) => previous,
  });

  // Setting a WordPress site up needs SEO Management, which prints the verification tag. The same read the SEO tab makes.
  const seo = useQuery({
    queryKey: ["site", site.id, "seo"],
    queryFn: () => fetchSeo(site.id),
    enabled:
      site.kind !== "static" &&
      !!google.data?.configured &&
      compareVersions(site.plugin_version ?? "0", SEO_SINCE) >= 0,
  });
  const seoOff = seo.data ? !seo.data.settings.enabled : false;

  if (google.isPending || google.error) return null;
  if (!google.data.configured) {
    return (
      <Section
        title="Search Console"
        action={linked || onOpen ? undefined : <RangeSelect range={sharedRange} onChange={chooseRange} />}
      >
        <EmptyRow>
          Connect Google in{" "}
          <Link
            to="/settings?tab=integrations"
            className="underline underline-offset-4"
          >
            Settings
          </Link>{" "}
          to see this site's clicks, impressions and top queries from Google
          Search Console.
        </EmptyRow>
      </Section>
    );
  }

  const select = <RangeSelect range={sharedRange} onChange={chooseRange} />;
  const picker = linked ? null : select;
  const action = onOpen ? (
    <span className="flex items-center gap-1.5">
      <JumpButton label="Open Search Console" onClick={onOpen} />
      {picker}
    </span>
  ) : (
    picker
  );

  let body;
  if (data.isPending) {
    body = (
      <div className="space-y-3 p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  } else if (data.error) {
    body = (
      <p className="px-4 py-6 text-center text-sm text-destructive">
        {data.error.message}
      </p>
    );
  } else if (!data.data.property || !data.data.totals) {
    body = (
      <div className="space-y-3 px-4 py-6 text-center">
        {seoOff && !data.data.chosen ? (
          <p className="text-sm text-muted-foreground">
            SEO Management is required to set up Google Search Console, because it prints the tag that proves you own
            the site.{" "}
            <Link to="?tab=seo" className="underline underline-offset-4">
              Open SEO settings
            </Link>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.data.chosen
              ? "The Search Console property chosen for this site is no longer available."
              : `Search Console has no property for ${hostname(site.url)} that ${google.data.account} can read. Make sure that account is a user of the property in Search Console, or choose one.`}
          </p>
        )}
        {!(seoOff && !data.data.chosen) && (
          <PropertyPicker site={site} current={null} chosen={data.data.chosen} />
        )}
        {!data.data.chosen && !seoOff && site.kind !== "static" && (
          <SetUpSearchConsole site={site} canSetUp={google.data.can_setup} />
        )}
      </div>
    );
  } else {
    body = <Body site={site} data={data.data} onOpen={onOpen} />;
  }

  return (
    <Section
      title="Search Console"
      hint="Search Console reports whole days, about two days late."
      action={action}
    >
      <div
        className={cn(
          "@container",
          data.isPlaceholderData && "opacity-60 transition-opacity",
        )}
      >
        {body}
      </div>
    </Section>
  );
}

function Body(props: {
  site: SiteSummary;
  data: SiteSearchConsole;
  onOpen?: () => void;
}) {
  const { data } = props;
  const totals = data.totals!;
  const max = Math.max(1, ...data.series.map((point) => point.clicks));
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px border-b bg-border @2xl:grid-cols-4">
        <Stat label="Clicks" stat={totals.clicks} format={count} />
        <Stat label="Impressions" stat={totals.impressions} format={count} />
        <Stat label="Click-through rate" stat={totals.ctr} format={percent} />
        <Stat
          label="Average position"
          stat={totals.position}
          format={position}
          lowerIsBetter
        />
      </dl>
      {!props.onOpen && data.series.length > 0 && (
        <div className="border-b px-4 pt-4 pb-3">
          <div
            className="flex h-24 items-end gap-[2px]"
            role="img"
            aria-label="Clicks per day"
          >
            {data.series.map((point) => (
              <div
                key={point.label}
                className="min-w-0 flex-1 rounded-t-sm bg-primary/70 hover:bg-primary"
                style={{
                  height: `${Math.max(2, (point.clicks / max) * 100)}%`,
                }}
                title={`${point.label}: ${count(point.clicks)} clicks, ${count(point.impressions)} impressions`}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{data.series[0].label}</span>
            <span>{data.series[data.series.length - 1].label}</span>
          </div>
        </div>
      )}
      {!props.onOpen && (
        <div className="grid divide-y @2xl:grid-cols-2 @2xl:divide-x @2xl:divide-y-0">
          <RowList
            title="Top queries"
            rows={data.queries}
            empty="No queries in this period."
          />
          <RowList
            title="Top pages"
            rows={data.pages}
            empty="No pages in this period."
            page
          />
        </div>
      )}
      {!props.onOpen && (
        <div className="group flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span>Connected to {data.property!.name}</span>
          <PropertyPicker
            site={props.site}
            current={data.property!.id}
            chosen={data.chosen}
            compact
          />
          <span className="ml-auto">
            Search Console reports whole days, about two days late.
          </span>
        </div>
      )}
    </div>
  );
}

function RowList(props: {
  title: string;
  rows: SearchConsoleRow[];
  empty: string;
  page?: boolean;
}) {
  const max = Math.max(1, ...props.rows.map((row) => row.clicks));
  const shown = (label: string) => {
    if (!props.page) return label;
    try {
      const url = new URL(label);
      return url.pathname === "/" ? url.host : `${url.pathname}${url.search}`;
    } catch {
      return label;
    }
  };
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="mb-2 flex justify-between text-xs font-medium text-muted-foreground">
        <span>{props.title}</span>
        <span className="flex gap-4">
          <span className="w-12 text-right">Clicks</span>
          <span className="w-16 text-right">Impressions</span>
        </span>
      </div>
      {props.rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {props.empty}
        </p>
      ) : (
        <ul className="space-y-1">
          {props.rows.map((row) => (
            <li
              key={row.label}
              className="relative flex items-center justify-between gap-3 rounded px-2 py-1 text-sm"
            >
              <span
                className="absolute inset-y-0 left-0 rounded bg-muted"
                style={{ width: `${(row.clicks / max) * 100}%` }}
              />
              <span className="relative truncate" title={row.label}>
                {shown(row.label)}
              </span>
              <span className="relative flex shrink-0 gap-4 tabular-nums text-muted-foreground">
                <span className="w-12 text-right">{count(row.clicks)}</span>
                <span className="w-16 text-right">
                  {count(row.impressions)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** An error message with its web address made into a link, so a "turn the API on" page can be opened. */
function linkify(message: string) {
  return message.split(/(https:\/\/\S+)/).map((part, index) =>
    /^https:\/\//.test(part) ? (
      <a key={index} href={part.replace(/[.,]$/, "")} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
        Open the page
      </a>
    ) : (
      part
    ),
  );
}

/**
 * Add a WordPress site to Search Console: Google's verification tag is printed
 * by KontrolWP Connect, Google checks it, and the sitemap is handed over. A
 * sign-in made before this existed has to allow it once.
 */
function SetUpSearchConsole(props: { site: SiteSummary; canSetUp: boolean }) {
  const queryClient = useQueryClient();
  const allow = useMutation({
    mutationFn: async () => {
      const { url } = await startGoogleConnect({
        setup: true,
        return_to: `${window.location.pathname}${window.location.search}`,
      });
      window.location.assign(url);
      // Keep the button busy while the browser leaves for Google.
      await new Promise(() => {});
    },
  });
  const setUp = useMutation({
    mutationFn: () => setUpSearchConsole(props.site.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site", props.site.id, "search-console"] });
      queryClient.invalidateQueries({ queryKey: ["google", "search-console", "properties"] });
    },
  });
  const run = props.canSetUp ? setUp : allow;
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Button size="sm" loading={run.isPending} onClick={() => run.mutate()}>
          {props.canSetUp ? "Set up Search Console for this site" : "Allow setup in Google"}
        </Button>
        <HelpTip>
          Adds this site to Search Console, proves you own it with a tag KontrolWP Connect prints on the home page, and
          submits the sitemap. It needs SEO Management switched on for the site.
          {props.canSetUp
            ? ""
            : " Google will ask once to also let KontrolWP add sites and verify them, which goes beyond reading."}
        </HelpTip>
      </div>
      {run.error && <p className="text-sm text-destructive">{linkify(run.error.message)}</p>}
      {setUp.data?.sitemap_error && (
        <p className="text-sm text-muted-foreground">
          The site was added, but its sitemap was not accepted: {setUp.data.sitemap_error}
        </p>
      )}
    </div>
  );
}

/** Choose the site's Search Console property, or go back to matching by domain. */
function PropertyPicker(props: {
  site: SiteSummary;
  current: string | null;
  chosen: boolean;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(!props.compact);
  const properties = useQuery({
    queryKey: ["google", "search-console", "properties"],
    queryFn: fetchSearchConsoleProperties,
    enabled: open,
    refetchInterval: false,
  });
  const save = useMutation({
    mutationFn: (property: string | null) =>
      setSiteSearchConsoleProperty(props.site.id, property),
    onSuccess: () => props.compact && setOpen(false),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["site", props.site.id, "search-console"],
      }),
  });
  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Change the Search Console property"
        title="Change the Search Console property"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
        onClick={() => setOpen(true)}
      >
        <PencilIcon />
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {(save.isPending || properties.isPending) && (
        <Spinner className="size-3.5" label="Loading" />
      )}
      <select
        aria-label="Search Console property"
        value={props.chosen ? (props.current ?? "") : ""}
        disabled={properties.isPending || save.isPending}
        onChange={(event) => save.mutate(event.target.value || null)}
        className={SELECT_CLASS}
      >
        <option value="">
          {properties.isPending ? "Loading properties..." : "Match by domain"}
        </option>
        {properties.data?.websites.map((property) => (
          <option key={property.id} value={property.id}>
            {property.name}
          </option>
        ))}
      </select>
      {(properties.error || save.error) && (
        <span className="text-xs text-destructive">
          {(properties.error ?? save.error)!.message}
        </span>
      )}
    </span>
  );
}

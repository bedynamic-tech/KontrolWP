import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  SEARCH_CONSOLE_RANGES,
  type SearchConsoleRange,
  type SearchConsoleRow,
  type SiteSearchConsole,
  type SiteSummary,
} from "../../shared/types";
import {
  fetchGoogleSettings,
  fetchSearchConsole,
  fetchSearchConsoleProperties,
  setSiteSearchConsoleProperty,
} from "../api";
import { hostname } from "../format";
import { count, SELECT_CLASS, Stat } from "./AnalyticsSection";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";

const RANGE_LABELS: Record<SearchConsoleRange, string> = {
  "7d": "Last 7 days",
  "28d": "Last 28 days",
  "90d": "Last 90 days",
};

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const position = (value: number) => value.toFixed(1);

function useRange(): [SearchConsoleRange, (next: SearchConsoleRange) => void] {
  const [range, setRange] = useState<SearchConsoleRange>(() => {
    try {
      const saved = localStorage.getItem("kontrolwp:search-console-range");
      return SEARCH_CONSOLE_RANGES.includes(saved as SearchConsoleRange)
        ? (saved as SearchConsoleRange)
        : "28d";
    } catch {
      return "28d";
    }
  });
  return [
    range,
    (next) => {
      setRange(next);
      try {
        localStorage.setItem("kontrolwp:search-console-range", next);
      } catch {
        // Remembering the range is only a convenience.
      }
    },
  ];
}

/** Search Console clicks, impressions, top queries and top pages, shown in the SEO tab once Google is connected. */
export function SearchConsoleSection(props: {
  site: SiteSummary;
  /** The Overview version: the stats and clicks trend, with a link to the full section. */
  onOpen?: () => void;
}) {
  const { site, onOpen } = props;
  const [range, chooseRange] = useRange();
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

  if (google.isPending || google.error) return null;
  if (!google.data.configured) {
    return (
      <Section title="Search Console">
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

  const action = (
    <select
      aria-label="Date range"
      value={range}
      onChange={(event) =>
        chooseRange(event.target.value as SearchConsoleRange)
      }
      className={`${SELECT_CLASS} w-auto!`}
    >
      {SEARCH_CONSOLE_RANGES.map((value) => (
        <option key={value} value={value}>
          {RANGE_LABELS[value]}
        </option>
      ))}
    </select>
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
        <p className="text-sm text-muted-foreground">
          {data.data.chosen
            ? "The Search Console property chosen for this site is no longer available."
            : `Search Console has no property for ${hostname(site.url)} that ${google.data.account} can read. Make sure that account is a user of the property in Search Console, or choose one.`}
        </p>
        <PropertyPicker site={site} current={null} chosen={data.data.chosen} />
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
      {data.series.length > 0 && (
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
      <div className="group flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <span>Connected to {data.property!.name}</span>
        <PropertyPicker
          site={props.site}
          current={data.property!.id}
          chosen={data.chosen}
          compact
        />
        {props.onOpen ? (
          <button
            type="button"
            onClick={props.onOpen}
            className="ml-auto hover:text-foreground hover:underline"
          >
            Top queries and pages
          </button>
        ) : (
          <span className="ml-auto">
            Search Console reports whole days, about two days late.
          </span>
        )}
      </div>
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

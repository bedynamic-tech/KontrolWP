import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration, formatRatio } from "../../shared/uptime";
import type { SiteSummary, UptimeCheck, UptimeDay } from "../../shared/types";
import { checkUptime, fetchUptime } from "../api";
import { plural, timeAgo } from "../format";
import { EmptyRow, Section } from "./Section";

const GOOD = "text-green-700 dark:text-green-400";
const WARN = "text-amber-700 dark:text-amber-300";
const BAD = "text-destructive";

/** Whether the site answers, how fast, its outages over 30 days, and its TLS certificate. */
export function UptimeTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const key = ["site", site.id, "uptime"];
  const uptime = useQuery({
    queryKey: key,
    queryFn: () => fetchUptime(site.id),
    staleTime: 30_000,
    // A new check lands every 15 minutes.
    refetchInterval: 5 * 60_000,
  });
  const check = useMutation({
    mutationFn: () => checkUptime(site.id),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      queryClient.invalidateQueries({ queryKey: ["site", site.id], exact: true });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const action = (
    <Button size="sm" variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
      <RefreshCwIcon className={check.isPending ? "animate-spin" : ""} />
      {check.isPending ? "Checking..." : "Check now"}
    </Button>
  );

  if (uptime.isPending) {
    return (
      <Section title="Uptime">
        <EmptyRow>Loading...</EmptyRow>
      </Section>
    );
  }
  if (uptime.error) {
    return (
      <Section title="Uptime" action={action}>
        <p className="px-4 py-6 text-center text-sm text-destructive">{uptime.error.message}</p>
      </Section>
    );
  }
  const data = uptime.data;
  const latest = data.latest;
  return (
    <div className="mt-8">
      <Section
        title="Uptime"
        hint="KontrolWP loads the home page every 15 minutes, from Cloudflare's network. A page that does not answer, or answers with an error, is tried once more before the site counts as down. Response time is how long the site took to start answering."
        action={action}
      >
        {check.error && <p className="border-b px-4 py-3 text-sm text-destructive">{check.error.message}</p>}
        {latest ? (
          <>
            {!latest.up && (
              <p className="border-b bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive">
                {latest.error ?? "The site is down."}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
              <Tile
                label="Status"
                value={latest.up ? "Up" : "Down"}
                tone={latest.up ? GOOD : BAD}
                detail={data.since ? `For ${formatDuration(latest.checked_at - data.since)}` : undefined}
              />
              <Tile
                label="Response time"
                value={latest.response_ms === null ? "No answer" : `${latest.response_ms} ms`}
                detail={data.average_ms === null ? undefined : `Average ${data.average_ms} ms today`}
              />
              <Tile
                label="Last 24 hours"
                value={data.ratios.day === null ? "No checks" : formatRatio(data.ratios.day)}
                tone={ratioTone(data.ratios.day)}
                detail={data.ratios.week === null ? undefined : `${formatRatio(data.ratios.week)} over 7 days`}
              />
              <Tile
                label="Last 30 days"
                value={data.ratios.month === null ? "No checks" : formatRatio(data.ratios.month)}
                tone={ratioTone(data.ratios.month)}
                detail={plural(data.incidents.length, "outage")}
              />
            </dl>
            <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Checked {timeAgo(latest.checked_at).toLowerCase()}</p>
          </>
        ) : (
          <EmptyRow>
            {site.uptime_excluded
              ? "Uptime checks are off for this site."
              : "The first check runs within 15 minutes. Select Check now to run it at once."}
          </EmptyRow>
        )}
      </Section>

      {data.recent.length > 1 && (
        <Section title="Response time, last 24 hours" hint="One bar per check. Red marks a check the site failed.">
          <ResponseChart checks={data.recent} />
        </Section>
      )}

      {latest && (
        <Section title="Last 30 days" hint="One bar per day. Green is no downtime, amber is some and red is more than an hour.">
          <DayStrip days={data.days} />
        </Section>
      )}

      {latest && (
        <Section title={data.incidents.length ? `Outages (${data.incidents.length})` : "Outages"}>
          {data.incidents.length ? (
            <ul className="divide-y">
              {data.incidents.map((incident) => (
                <li key={incident.started_at} className="flex flex-col gap-0.5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{formatDateTime(incident.started_at)}</span>
                    {incident.error && <span className="block text-xs text-muted-foreground">{incident.error}</span>}
                  </span>
                  <span className={cn("shrink-0 tabular-nums", incident.ended_at ? "text-muted-foreground" : BAD)}>
                    {incident.ended_at
                      ? `Down for ${formatDuration(incident.ended_at - incident.started_at)}`
                      : `Still down, ${formatDuration(latest.checked_at - incident.started_at)} so far`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyRow>No outages in the last 30 days.</EmptyRow>
          )}
        </Section>
      )}
    </div>
  );
}

function ratioTone(ratio: number | null): string | undefined {
  if (ratio === null) return undefined;
  if (ratio >= 99.9) return GOOD;
  return ratio >= 99 ? WARN : BAD;
}

function Tile(props: { label: string; value: string; detail?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className={cn("mt-0.5 text-base font-medium tabular-nums", props.tone)}>{props.value}</dd>
      {props.detail && <dd className="truncate text-xs text-muted-foreground">{props.detail}</dd>}
    </div>
  );
}

/** A bar per check, its height the response time; a failed check is a full red bar. */
function ResponseChart(props: { checks: UptimeCheck[] }) {
  const { checks } = props;
  const height = 80;
  const answered = checks.map((check) => check.response_ms ?? 0);
  const max = Math.max(...answered, 1);
  // Round the scale up to a tidy number so the label reads well.
  const step = max > 2000 ? 1000 : max > 500 ? 250 : 100;
  const top = Math.ceil(max / step) * step;
  const slot = 6;
  const width = checks.length * slot;
  return (
    <div className="px-4 py-3">
      <div className="flex items-stretch gap-2">
        <div className="flex flex-col justify-between py-0.5 text-right text-[10px] text-muted-foreground tabular-nums">
          <span>{top} ms</span>
          <span>0</span>
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-24 min-w-0 flex-1"
          role="img"
          aria-label="Response time of each check in the last 24 hours"
        >
          {checks.map((check, i) => {
            const down = !check.up;
            const value = down ? top : (check.response_ms ?? 0);
            const barHeight = Math.max(1, (value / top) * height);
            return (
              <rect
                key={check.checked_at}
                x={i * slot + 1}
                y={height - barHeight}
                width={slot - 2}
                height={barHeight}
                rx={1}
                className={down ? "fill-red-500/80 dark:fill-red-400/80" : "fill-foreground/70"}
              >
                <title>
                  {`${formatDateTime(check.checked_at)}: ${down ? (check.error ?? "Down") : `${check.response_ms} ms`}`}
                </title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex justify-between pl-10 text-[10px] text-muted-foreground">
        <span>{timeAgo(checks[0].checked_at)}</span>
        <span>Now</span>
      </div>
    </div>
  );
}

/** One bar per day, coloured by how much of it the site was down. */
function DayStrip(props: { days: UptimeDay[] }) {
  return (
    <div className="px-4 py-3">
      <div className="flex h-8 gap-0.5" role="list" aria-label="Uptime by day">
        {props.days.map((day) => {
          const share = day.checks ? (day.up / day.checks) * 100 : null;
          // A check every 15 minutes: more than four failed is more than an hour.
          const failed = day.checks - day.up;
          const tone =
            share === null
              ? "bg-muted"
              : failed === 0
                ? "bg-green-500/80 dark:bg-green-400/70"
                : failed > 4
                  ? "bg-red-500/80 dark:bg-red-400/80"
                  : "bg-amber-400/90 dark:bg-amber-300/80";
          const label = `${formatDate(day.day, "UTC")}: ${share === null ? "no checks" : `${formatRatio(share)} up`}`;
          return <div key={day.day} role="listitem" title={label} aria-label={label} className={cn("min-w-0 flex-1 rounded-sm", tone)} />;
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function formatDate(unixSeconds: number, timeZone?: string): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone });
}

function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

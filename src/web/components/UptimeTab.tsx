import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration, formatRatio } from "../../shared/uptime";
import type { SiteSummary, UptimeDay } from "../../shared/types";
import { checkUptime, fetchUptime } from "../api";
import { plural, timeAgo } from "../format";
import { EmptyRow, Section } from "./Section";
import { StatCard, StatsHeader, StatsNote } from "./StatCard";

const GOOD = "text-green-700 dark:text-green-400";
const WARN = "text-amber-700 dark:text-amber-300";
const BAD = "text-destructive";

/** Whether the site answers, and its outages over 30 days. */
export function UptimeTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const key = ["site", site.id, "uptime"];
  const uptime = useQuery({
    queryKey: key,
    queryFn: () => fetchUptime(site.id),
    staleTime: 30_000,
    // A new check lands every hour, on the hour.
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
      <StatsHeader
        title="Uptime"
        hint="KontrolWP loads the home page every hour on the hour, from Cloudflare's network. A page that does not answer, or answers with an error, is tried once more before the site counts as down."
        action={action}
      />
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Status"
          value={latest ? (latest.up ? "Up" : "Down") : "Not checked yet"}
          className={latest ? (latest.up ? GOOD : BAD) : undefined}
          detail={latest && data.since ? `For ${formatDuration(latest.checked_at - data.since)}` : undefined}
        />
        <StatCard
          label="Last 24 hours"
          value={data.ratios.day === null ? "-" : formatRatio(data.ratios.day)}
          className={ratioTone(data.ratios.day)}
          detail={data.ratios.week === null ? undefined : `${formatRatio(data.ratios.week)} over 7 days`}
        />
        <StatCard
          label="Last 30 days"
          value={data.ratios.month === null ? "-" : formatRatio(data.ratios.month)}
          className={ratioTone(data.ratios.month)}
          detail={latest ? plural(data.incidents.length, "outage") : undefined}
        />
      </dl>
      {check.error && <StatsNote tone="bad">{check.error.message}</StatsNote>}
      {latest && !latest.up && <StatsNote tone="bad">{latest.error ?? "The site is down."}</StatsNote>}
      {latest ? (
        <p className="mt-3 text-xs text-muted-foreground">Checked {timeAgo(latest.checked_at).toLowerCase()}</p>
      ) : (
        <StatsNote>
          {site.uptime_excluded
            ? "Uptime checks are off for this site."
            : "The first check runs at the top of the hour. Select Check now to run it at once."}
        </StatsNote>
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

/** One bar per day, coloured by how much of it the site was down. */
function DayStrip(props: { days: UptimeDay[] }) {
  return (
    <div className="px-4 py-3">
      <div className="flex h-8 gap-0.5" role="list" aria-label="Uptime by day">
        {props.days.map((day) => {
          const share = day.checks ? (day.up / day.checks) * 100 : null;
          // A check every hour: more than one failed is more than an hour down.
          const failed = day.checks - day.up;
          const tone =
            share === null
              ? "bg-muted"
              : failed === 0
                ? "bg-green-500/80 dark:bg-green-400/70"
                : failed > 1
                  ? "bg-red-500/80 dark:bg-red-400/80"
                  : "bg-amber-400/90 dark:bg-amber-300/80";
          const label = `${formatDate(day.day, "UTC")}: ${share === null ? "no checks" : `${formatRatio(share)} up`}`;
          return <div key={day.day} role="listitem" title={label} aria-label={label} className={cn("min-w-0 flex-1 rounded-sm", tone)} />;
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
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

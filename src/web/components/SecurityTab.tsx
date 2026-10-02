import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ExternalLinkIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  SecurityCheck,
  SecurityFix,
  SiteSecurity,
  SiteSummary,
  SiteVulnerability,
  VulnSeverity,
} from "../../shared/types";
import { fetchSecurity, refreshVulnerabilityFeed, setSecurityFixes } from "../api";
import { plural, timeAgo } from "../format";
import { EmptyRow, Section } from "./Section";

const SEVERITY_LABEL: Record<VulnSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unrated",
};

const SEVERITY_CLASS: Record<VulnSeverity, string> = {
  critical: "bg-destructive/10 text-destructive",
  high: "bg-destructive/10 text-destructive",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  low: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

function StatCard(props: { label: string; value: string; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd
        className={cn(
          "mt-1 truncate text-sm font-medium tabular-nums",
          props.tone === "bad" && "text-destructive",
          props.tone === "warn" && "text-amber-700 dark:text-amber-300",
        )}
      >
        {props.value}
      </dd>
    </div>
  );
}

function VulnerabilityRow(props: { item: SiteVulnerability }) {
  const { item } = props;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">{item.installed_version}</span>
          {!item.active && <Badge variant="secondary">Inactive</Badge>}
        </div>
        <p className="mt-0.5 text-muted-foreground">{item.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {item.patched_in ? `Fixed in ${item.patched_in}.` : "No fixed version is listed yet."}
          {item.cve ? ` ${item.cve}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", SEVERITY_CLASS[item.severity])}>
          {SEVERITY_LABEL[item.severity]}
          {item.cvss !== null ? ` ${item.cvss.toFixed(1)}` : ""}
        </span>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-muted-foreground hover:text-foreground"
          title="Read the report"
          aria-label={`Read the report on ${item.title}`}
        >
          <ExternalLinkIcon className="size-4" />
        </a>
      </div>
    </li>
  );
}

function CheckRow(props: { check: SecurityCheck }) {
  const { check } = props;
  const bad = check.status === "warning";
  return (
    <li className="flex items-start gap-3 px-4 py-3 text-sm">
      {bad ? (
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      ) : (
        <CheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <p className="font-medium">{check.title}</p>
        <p className="mt-0.5 text-muted-foreground">{check.detail}</p>
      </div>
    </li>
  );
}

function FixRow(props: { fix: SecurityFix; busy: boolean; onFix: () => void }) {
  const { fix } = props;
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{fix.title}</p>
        <p className="mt-0.5 text-muted-foreground">{fix.detail}</p>
        {fix.enabled && !fix.applied && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            Fixed, but not in effect yet. Check that the site can write to its files, then reload.
          </p>
        )}
      </div>
      {fix.applied ? (
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <CheckIcon className="size-4" />
          In place
        </span>
      ) : (
        <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onFix}>
          Fix now
        </Button>
      )}
    </li>
  );
}

/** Known vulnerabilities in the site's WordPress and plugins, and insecure settings. */
export function SecurityTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const security = useQuery({
    queryKey: ["site", site.id, "security"],
    queryFn: () => fetchSecurity(site.id),
    staleTime: 60_000,
    refetchInterval: false,
  });
  const refresh = useMutation({
    mutationFn: refreshVulnerabilityFeed,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["site", site.id, "security"] }),
  });

  const fixes = useMutation({
    mutationFn: (change: { ids: string[]; enabled: boolean }) => setSecurityFixes(site.id, change.ids, change.enabled),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["site", site.id, "security"] }),
  });

  if (security.isPending) {
    return (
      <Section title="Security">
        <EmptyRow>Checking...</EmptyRow>
      </Section>
    );
  }
  if (security.error) {
    return (
      <Section title="Security">
        <p className="px-4 py-6 text-center text-sm text-destructive">{security.error.message}</p>
      </Section>
    );
  }
  const data: SiteSecurity = security.data;
  const warnings = data.checks.filter((check) => check.status === "warning").length;
  const critical = data.vulnerabilities.filter(
    (item) => item.severity === "critical" || item.severity === "high",
  ).length;
  const feedReady = data.feed.updated_at !== null;
  const needsKey = !data.feed.configured && !feedReady;

  return (
    <div className="mt-8">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Known vulnerabilities"
          value={data.vulnerabilities.length.toLocaleString()}
          tone={data.vulnerabilities.length ? "bad" : undefined}
        />
        <StatCard label="Critical or high" value={critical.toLocaleString()} tone={critical ? "bad" : undefined} />
        <StatCard label="Settings to fix" value={warnings.toLocaleString()} tone={warnings ? "warn" : undefined} />
        <StatCard label="Vulnerability data" value={feedReady ? timeAgo(data.feed.updated_at) : "Not loaded yet"} />
      </dl>

      <Section
        title={`Vulnerabilities (${data.vulnerabilities.length})`}
        action={
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            title="Download the vulnerability data again"
            aria-label="Download the vulnerability data again"
          >
            <RefreshCwIcon className={refresh.isPending ? "animate-spin" : ""} />
          </Button>
        }
      >
        {refresh.error && <p className="border-b px-4 py-3 text-sm text-destructive">{refresh.error.message}</p>}
        {data.feed.error && !refresh.error && (
          <p className="border-b px-4 py-3 text-sm text-destructive">
            The vulnerability data could not be updated: {data.feed.error}
          </p>
        )}
        {data.vulnerabilities.length ? (
          <ul className="divide-y">
            {data.vulnerabilities.map((item) => (
              <VulnerabilityRow key={`${item.id}:${item.slug}`} item={item} />
            ))}
          </ul>
        ) : feedReady ? (
          <EmptyRow>No known vulnerabilities affect this site's WordPress or plugins.</EmptyRow>
        ) : (
          <EmptyRow>
            {needsKey
              ? "Add a free Wordfence Intelligence API key in Settings to check this site's WordPress and plugins for known vulnerabilities."
              : "The vulnerability data is downloaded in the background, within a few minutes. Select the refresh button to load it now."}
          </EmptyRow>
        )}
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          {`Matched against the Wordfence Intelligence database for ${plural(
            data.vulnerabilities.length,
            "vulnerability",
            "vulnerabilities",
          )} in WordPress and plugins as of the last sync. Themes are not checked.`}
        </p>
      </Section>

      {data.fixes && (
        <Section
          title="Hardening"
          action={
            data.fixes.some((fix) => !fix.enabled && !fix.applied) && (
              <Button
                size="sm"
                variant="outline"
                disabled={fixes.isPending}
                onClick={() =>
                  fixes.mutate({
                    ids: data.fixes!.filter((fix) => !fix.enabled && !fix.applied).map((fix) => fix.id),
                    enabled: true,
                  })
                }
              >
                Fix all
              </Button>
            )
          }
        >
          {fixes.error && <p className="border-b px-4 py-3 text-sm text-destructive">{fixes.error.message}</p>}
          <ul className="divide-y">
            {data.fixes.map((fix) => (
              <FixRow
                key={fix.id}
                fix={fix}
                busy={fixes.isPending}
                onFix={() => fixes.mutate({ ids: [fix.id], enabled: true })}
              />
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Settings (${warnings ? `${warnings} to fix` : "all good"})`}>
        {data.checks_note && <p className="border-b px-4 py-3 text-sm text-muted-foreground">{data.checks_note}</p>}
        <ul className="divide-y">
          {[...data.checks]
            .sort((a, b) => Number(b.status === "warning") - Number(a.status === "warning"))
            .map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
        </ul>
      </Section>
    </div>
  );
}

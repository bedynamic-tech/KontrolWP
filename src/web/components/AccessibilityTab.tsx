import { useEffect, useRef } from "react";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { scoreBand, type AccessibilityImpact, type ScoreBand } from "../../shared/accessibility";
import type { AccessibilityIssue, SiteAccessibility, SiteSummary } from "../../shared/types";
import { fetchAccessibility, scanAccessibility, setAccessibilityFixes } from "../api";
import { timeAgo } from "../format";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";

const IMPACT_LABEL: Record<AccessibilityImpact, string> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};

const IMPACT_CLASS: Record<AccessibilityImpact, string> = {
  critical: "bg-red-700 text-white dark:bg-red-600",
  serious: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  moderate: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  minor: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
};

const BAND_CLASS: Record<ScoreBand, string> = {
  good: "text-green-700 dark:text-green-400",
  fair: "text-yellow-700 dark:text-yellow-300",
  poor: "text-orange-700 dark:text-orange-300",
  bad: "text-destructive",
};

function StatCard(props: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className={cn("mt-1 truncate text-sm font-medium tabular-nums", props.className)}>{props.value}</dd>
    </div>
  );
}

function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" ? parsed.host : `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function IssueRow(props: { issue: AccessibilityIssue; busy: boolean; onFix: () => void }) {
  const { issue } = props;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{issue.title}</span>
          <HelpTip>{issue.help}</HelpTip>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", IMPACT_CLASS[issue.impact])}>
            {IMPACT_LABEL[issue.impact]}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Found {issue.count.toLocaleString()} {issue.count === 1 ? "time" : "times"} on {issue.pages.length}{" "}
          {issue.pages.length === 1 ? "page" : "pages"}. WCAG {issue.wcag}.
        </p>
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Where</summary>
          <ul className="mt-1 space-y-1">
            {issue.pages.map((page) => (
              <li key={page}>
                <a href={page} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                  {pagePath(page)}
                </a>
              </li>
            ))}
            {issue.examples.map((example) => (
              <li key={example}>
                <code className="block overflow-x-auto whitespace-pre rounded bg-muted px-2 py-1">{example}</code>
              </li>
            ))}
          </ul>
        </details>
        {issue.fix?.enabled && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            The fix is on, but this scan still sees the problem. A caching plugin may be serving the old page; clear its
            cache and scan again.
          </p>
        )}
      </div>
      {issue.fix && !issue.fix.enabled ? (
        <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onFix}>
          Fix now
        </Button>
      ) : !issue.fix ? (
        <TriangleAlertIcon
          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-label="Needs a manual fix"
        />
      ) : null}
    </li>
  );
}

/** One small line chart of the score over time. */
function Trend(props: { history: SiteAccessibility["history"] }) {
  const points = props.history.slice(-30);
  if (points.length < 2) return null;
  const width = 240;
  const height = 40;
  const path = points
    .map((point, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - (point.score / 100) * height;
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const first = points[0].score;
  const last = points[points.length - 1].score;
  return (
    <div className="flex items-center gap-4 px-4 py-3 text-sm">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-10 w-60 text-foreground"
        role="img"
        aria-label="Score history"
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <p className="text-muted-foreground">
        {last === first ? `Steady at ${last}` : `${last > first ? "Up" : "Down"} from ${first} to ${last}`} over{" "}
        {points.length} scans.
      </p>
    </div>
  );
}

/** The site's accessibility score and the problems a scan of its pages found, with fixes for some. */
export function AccessibilityTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const key = ["site", site.id, "accessibility"];
  const accessibility = useQuery({
    queryKey: key,
    queryFn: () => fetchAccessibility(site.id),
    staleTime: 60_000,
    refetchInterval: false,
  });
  const setData = (data: SiteAccessibility) => queryClient.setQueryData(key, data);
  const scan = useMutation({ mutationFn: () => scanAccessibility(site.id), onSuccess: setData });
  const fixes = useMutation({
    mutationFn: (change: { ids: string[]; enabled: boolean }) =>
      setAccessibilityFixes(site.id, change.ids, change.enabled),
    onSuccess: setData,
  });

  // A site that has never been scanned is scanned when its tab first opens.
  const started = useRef(false);
  const data = accessibility.data;
  useEffect(() => {
    if (data && !data.scan && !data.error && !started.current) {
      started.current = true;
      scan.mutate();
    }
  }, [data, scan]);

  if (accessibility.isPending) {
    return (
      <Section title="Accessibility">
        <EmptyRow>Checking...</EmptyRow>
      </Section>
    );
  }
  if (accessibility.error) {
    return (
      <Section title="Accessibility">
        <p className="px-4 py-6 text-center text-sm text-destructive">{accessibility.error.message}</p>
      </Section>
    );
  }
  const result = scan.data ?? data!;
  const latest = result.scan;
  const issues = latest?.issues ?? [];
  const fixable = issues.filter((issue) => issue.fix && !issue.fix.enabled);
  const error = scan.error?.message ?? fixes.error?.message ?? (latest ? null : result.error);
  const scanning = scan.isPending || fixes.isPending;

  return (
    <div className="mt-8">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Accessibility score"
          value={latest ? `${latest.score} out of 100` : scanning ? "Scanning..." : "Not scanned yet"}
          className={latest ? BAND_CLASS[scoreBand(latest.score)] : undefined}
        />
        <StatCard label="Kinds of problem" value={latest ? issues.length.toLocaleString() : "-"} />
        <StatCard label="Fixable automatically" value={latest ? fixable.length.toLocaleString() : "-"} />
        <StatCard label="Last scan" value={latest ? timeAgo(latest.scanned_at) : "-"} />
      </dl>

      <Section
        title={`Issues${latest ? ` (${issues.length})` : ""}`}
        action={
          <div className="flex gap-2">
            {fixable.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                disabled={scanning}
                onClick={() => fixes.mutate({ ids: fixable.map((issue) => issue.fix!.id), enabled: true })}
              >
                Fix all
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={scanning} onClick={() => scan.mutate()}>
              {scanning ? "Scanning..." : "Scan now"}
            </Button>
          </div>
        }
      >
        {error && <p className="border-b px-4 py-3 text-sm text-destructive">{error}</p>}
        {latest && (
          <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
            Scanned {latest.pages.length} {latest.pages.length === 1 ? "page" : "pages"}: the home page and pages it
            links to. The scan reads each page's HTML, so it finds missing text alternatives, labels, names and
            headings. It cannot judge colour contrast, keyboard use or whether alt text is good, so a clean score is not
            a full WCAG review.
          </p>
        )}
        {!latest ? (
          <EmptyRow>{scanning ? "Scanning the site's pages..." : "No scan yet."}</EmptyRow>
        ) : issues.length ? (
          <ul className="divide-y">
            {issues.map((issue) => (
              <IssueRow
                key={issue.rule}
                issue={issue}
                busy={scanning}
                onFix={() => fixes.mutate({ ids: [issue.fix!.id], enabled: true })}
              />
            ))}
          </ul>
        ) : (
          <EmptyRow>The scan found no problems it can detect.</EmptyRow>
        )}
      </Section>

      {result.history.length > 1 && (
        <Section title="Score history">
          <Trend history={result.history} />
        </Section>
      )}

      {site.kind === "wordpress" && (
        <Section
          title="Automatic fixes"
          hint="Fixes change the page as it is sent to visitors. They never edit your content or theme, and turning one off puts the page back."
        >
          {result.fixes_note && <p className="border-b px-4 py-3 text-sm text-muted-foreground">{result.fixes_note}</p>}
          {result.fixes.length ? (
            <ul className="divide-y">
              {result.fixes.map((fix) => (
                <li key={fix.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                  <div className={cn("min-w-0", !fix.enabled && "opacity-60")}>
                    <p className="flex items-center gap-1.5 font-medium">
                      {fix.title}
                      <HelpTip>{fix.detail}</HelpTip>
                    </p>
                  </div>
                  <Switch
                    aria-label={fix.title}
                    checked={fix.enabled}
                    disabled={scanning}
                    onCheckedChange={(enabled) => fixes.mutate({ ids: [fix.id], enabled })}
                  />
                </li>
              ))}
            </ul>
          ) : (
            !result.fixes_note && <EmptyRow>Fixes are not available for this site.</EmptyRow>
          )}
        </Section>
      )}
    </div>
  );
}

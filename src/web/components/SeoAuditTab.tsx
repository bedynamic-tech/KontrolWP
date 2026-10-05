import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { scoreBand, type ScoreBand } from "../../shared/accessibility";
import type { SeoImpact } from "../../shared/seo-audit";
import type {
  SeoAuditIssue,
  SiteSeoAudit,
  SiteSummary,
} from "../../shared/types";
import { fetchSeoAudit, scanSeoAudit } from "../api";
import { timeAgo } from "../format";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";

const IMPACT_LABEL: Record<SeoImpact, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const IMPACT_CLASS: Record<SeoImpact, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  medium:
    "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  low: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
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
      <dd
        className={cn(
          "mt-1 truncate text-sm font-medium tabular-nums",
          props.className,
        )}
      >
        {props.value}
      </dd>
    </div>
  );
}

function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/"
      ? parsed.host
      : `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function IssueRow(props: { issue: SeoAuditIssue }) {
  const { issue } = props;
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{issue.title}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            IMPACT_CLASS[issue.impact],
          )}
        >
          {IMPACT_LABEL[issue.impact]}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{issue.help}</p>
      {(issue.pages.length > 0 || issue.examples.length > 0) && (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            Where
            {issue.pages.length
              ? ` (${issue.pages.length} ${issue.pages.length === 1 ? "page" : "pages"})`
              : ""}
          </summary>
          <ul className="mt-1 space-y-1">
            {issue.pages.map((page) => (
              <li key={page}>
                <a
                  href={page}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-4"
                >
                  {pagePath(page)}
                </a>
              </li>
            ))}
            {issue.examples.map((example) => (
              <li key={example}>
                <code className="block overflow-x-auto whitespace-pre rounded bg-muted px-2 py-1">
                  {example}
                </code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** One small line chart of the score over time. */
function Trend(props: { history: SiteSeoAudit["history"] }) {
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
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <p className="text-muted-foreground">
        {last === first
          ? `Steady at ${last}`
          : `${last > first ? "Up" : "Down"} from ${first} to ${last}`}{" "}
        over {points.length} checks.
      </p>
    </div>
  );
}

/** A static site's SEO score and what to change on the site, found by reading its pages, robots.txt and sitemap. */
export function SeoAuditTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const key = ["site", site.id, "seo-audit"];
  const audit = useQuery({
    queryKey: key,
    queryFn: () => fetchSeoAudit(site.id),
    staleTime: 60_000,
    refetchInterval: false,
  });
  const scan = useMutation({
    mutationFn: () => scanSeoAudit(site.id),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  // A site that has never been checked is checked when its tab first opens.
  const started = useRef(false);
  const data = audit.data;
  useEffect(() => {
    if (data && !data.scan && !data.error && !started.current) {
      started.current = true;
      scan.mutate();
    }
  }, [data, scan]);

  if (audit.isPending) {
    return (
      <Section title="SEO">
        <EmptyRow>Checking...</EmptyRow>
      </Section>
    );
  }
  if (audit.error) {
    return (
      <Section title="SEO">
        <p className="px-4 py-6 text-center text-sm text-destructive">
          {audit.error.message}
        </p>
      </Section>
    );
  }
  const result = scan.data ?? data!;
  const latest = result.scan;
  const issues = latest?.issues ?? [];
  const error = scan.error?.message ?? (latest ? null : result.error);
  const scanning = scan.isPending;

  return (
    <div className="mt-8">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="SEO score"
          value={
            latest
              ? `${latest.score} out of 100`
              : scanning
                ? "Checking..."
                : "Not checked yet"
          }
          className={latest ? BAND_CLASS[scoreBand(latest.score)] : undefined}
        />
        <StatCard
          label="Kinds of problem"
          value={latest ? issues.length.toLocaleString() : "-"}
        />
        <StatCard
          label="Pages checked"
          value={latest ? latest.pages.length.toLocaleString() : "-"}
        />
        <StatCard
          label="Last check"
          value={latest ? timeAgo(latest.scanned_at) : "-"}
        />
      </dl>

      <Section
        title={`Recommendations${latest ? ` (${issues.length})` : ""}`}
        action={
          <div className="flex items-center gap-2">
            <HelpTip>
              KontrolWP reads the home page, a sample of pages from the sitemap,
              robots.txt and the sitemap itself. It cannot change a static site,
              so each recommendation says what to change in the site's own
              files. It does not judge content quality or rankings.
            </HelpTip>
            <Button
              size="sm"
              variant="outline"
              disabled={scanning}
              onClick={() => scan.mutate()}
            >
              {scanning ? "Checking..." : "Check now"}
            </Button>
          </div>
        }
      >
        {error && (
          <p className="border-b px-4 py-3 text-sm text-destructive">{error}</p>
        )}
        {!latest ? (
          <EmptyRow>
            {scanning ? "Reading the site's pages..." : "No check yet."}
          </EmptyRow>
        ) : issues.length ? (
          <ul className="divide-y">
            {issues.map((issue) => (
              <IssueRow key={issue.rule} issue={issue} />
            ))}
          </ul>
        ) : (
          <EmptyRow>The check found nothing to recommend.</EmptyRow>
        )}
      </Section>

      {result.history.length > 1 && (
        <Section title="Score history">
          <Trend history={result.history} />
        </Section>
      )}
    </div>
  );
}

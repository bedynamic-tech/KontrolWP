import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FIELD_LABELS,
  LAB_LABELS,
  formatMetric,
  labBand,
  performanceBand,
  type PerformanceBand,
} from "../../shared/performance";
import type {
  PerformanceFieldMetric,
  PerformanceScores,
  PerformanceStrategy,
  SitePerformance,
  SiteSummary,
} from "../../shared/types";
import { fetchPerformance, runPerformance } from "../api";
import { timeAgo } from "../format";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";
import { StatCard, StatsHeader, StatsNote } from "./StatCard";

const BAND_TEXT: Record<PerformanceBand, string> = {
  good: "text-green-700 dark:text-green-400",
  fair: "text-orange-700 dark:text-orange-300",
  poor: "text-destructive",
};

const FIELD_BAND: Record<PerformanceFieldMetric["category"], PerformanceBand> = {
  good: "good",
  "needs-improvement": "fair",
  poor: "poor",
};

const FIELD_WORDS: Record<PerformanceFieldMetric["category"], string> = {
  good: "Good",
  "needs-improvement": "Needs improvement",
  poor: "Poor",
};

const SCORE_LABELS: [keyof PerformanceScores, string][] = [
  ["performance", "Performance"],
  ["accessibility", "Accessibility"],
  ["best_practices", "Best practices"],
  ["seo", "SEO"],
];

/** Google's assessment: LCP, INP and CLS all good. INP is left out when Google has too little data for it. */
function corePassed(field: PerformanceFieldMetric[]): boolean | null {
  const lcp = field.find((metric) => metric.id === "lcp");
  const cls = field.find((metric) => metric.id === "cls");
  const inp = field.find((metric) => metric.id === "inp");
  if (!lcp || !cls) return null;
  return lcp.category === "good" && cls.category === "good" && (!inp || inp.category === "good");
}

/** One small line chart of the performance score over time. */
function Trend(props: { points: { scanned_at: number; performance: number | null }[] }) {
  const points = props.points.filter((point): point is { scanned_at: number; performance: number } => point.performance !== null);
  if (points.length < 2) return null;
  const width = 240;
  const height = 40;
  const path = points
    .map((point, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - (point.performance / 100) * height;
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const first = points[0].performance;
  const last = points[points.length - 1].performance;
  return (
    <div className="flex items-center gap-4 px-4 py-3 text-sm">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-10 w-60 text-foreground" role="img" aria-label="Performance score history">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <p className="text-muted-foreground">
        {last === first ? `Steady at ${last}` : `${last > first ? "Up" : "Down"} from ${first} to ${last}`} over {points.length}{" "}
        tests.
      </p>
    </div>
  );
}

/** Google's PageSpeed Insights (Lighthouse) scores for the site's home page, as a phone and as a desktop. */
export function PerformanceTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const key = ["site", site.id, "performance"];
  const [strategy, setStrategy] = useState<PerformanceStrategy>("mobile");
  const performance = useQuery({
    queryKey: key,
    queryFn: () => fetchPerformance(site.id),
    staleTime: 30_000,
    // A test takes about a minute, so check back until it is done.
    refetchInterval: (query) => (query.state.data?.running ? 5000 : false),
  });
  const run = useMutation({
    mutationFn: () => runPerformance(site.id),
    onSuccess: (data: SitePerformance) => queryClient.setQueryData(key, data),
  });

  if (performance.isPending) {
    return (
      <Section title="Performance">
        <EmptyRow>Checking...</EmptyRow>
      </Section>
    );
  }
  if (performance.error) {
    return (
      <Section title="Performance">
        <p className="px-4 py-6 text-center text-sm text-destructive">{performance.error.message}</p>
      </Section>
    );
  }
  const data = performance.data;
  const testing = run.isPending || data.running;
  const state = data[strategy];
  const result = state.result;
  const lab = result?.lab ?? [];

  return (
    <div className="mt-8">
      <StatsHeader
        title="Scores"
        hint="Google runs Lighthouse against the home page on its own servers and reports four scores out of 100. A phone test uses a slower connection and processor than the desktop test, so it scores lower."
        action={
          <div className="flex items-center gap-2">
            <div className="flex gap-2 rounded-lg border p-0.5" role="group" aria-label="Device">
              {(["mobile", "desktop"] as const).map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={strategy === value ? "secondary" : "ghost"}
                  aria-pressed={strategy === value}
                  onClick={() => setStrategy(value)}
                >
                  {value === "mobile" ? "Mobile" : "Desktop"}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="outline" disabled={testing} onClick={() => run.mutate()}>
              {testing ? (
                <>
                  <Spinner className="size-3.5" /> Testing...
                </>
              ) : (
                "Run test"
              )}
            </Button>
          </div>
        }
      />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SCORE_LABELS.map(([id, label]) => {
          const score = result?.scores[id] ?? null;
          return (
            <StatCard
              key={id}
              label={label}
              value={score === null ? "-" : `${score} out of 100`}
              className={score === null ? undefined : BAND_TEXT[performanceBand(score)]}
            />
          );
        })}
      </dl>
      {(run.error?.message ?? state.error) && <StatsNote tone="bad">{run.error?.message ?? state.error}</StatsNote>}
      {result ? (
        <p className="mt-3 wrap-break-word text-xs text-muted-foreground">
          Tested {timeAgo(result.scanned_at)}
          {result.url ? `: ${result.url}` : ""}
        </p>
      ) : (
        <StatsNote>
          {testing
            ? "Google is testing the page. This takes about a minute."
            : "No test yet. Run one to see this site's scores."}
        </StatsNote>
      )}

      {result && (
        <>
          <Section
            title="Real visitors (Core Web Vitals)"
            hint="Measured by Chrome on real visits to the page over the last 28 days, when Google has enough of them. When the page alone has too few, Google reports the whole site. The lab numbers below come from one simulated visit, so the two can differ."
          >
            {result.field.length > 0 && (
              <p className="border-b px-4 py-2.5 text-sm">
                {(() => {
                  const passed = corePassed(result.field);
                  return passed === null ? null : (
                    <span className={cn("font-medium", BAND_TEXT[passed ? "good" : "poor"])}>
                      {passed ? "Passes" : "Fails"} the Core Web Vitals assessment
                    </span>
                  );
                })()}
                {result.field_scope === "origin" && (
                  <span className="text-muted-foreground"> (whole site; too few visits to this page alone)</span>
                )}
              </p>
            )}
            {result.field.length ? (
              <ul className="divide-y">
                {result.field.map((metric) => (
                  <li key={metric.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                    <span className="font-medium">{FIELD_LABELS[metric.id]}</span>
                    <span className="flex shrink-0 items-center gap-3 tabular-nums">
                      <span className="whitespace-nowrap">{formatMetric(metric.id, metric.value)}</span>
                      <span className={cn("w-24 text-right text-xs sm:w-36", BAND_TEXT[FIELD_BAND[metric.category]])}>
                        {FIELD_WORDS[metric.category]}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyRow>Google does not have enough real visits to this page to report them.</EmptyRow>
            )}
          </Section>

          <Section
            title="Lab measurements"
            hint="From one simulated visit. Green is within Google's good range, orange needs improvement and red is poor."
          >
            {lab.length ? (
              <ul className="divide-y">
                {lab.map((metric) => (
                  <li key={metric.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                    <span className="font-medium">{LAB_LABELS[metric.id]}</span>
                    <span className={cn("tabular-nums", BAND_TEXT[labBand(metric.id, metric.value)])}>
                      {metric.display || formatMetric(metric.id, metric.value)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyRow>Google did not report any measurements.</EmptyRow>
            )}
          </Section>

          <Section
            title={`Biggest savings${result.opportunities.length ? ` (${result.opportunities.length})` : ""}`}
            hint="What Lighthouse estimates would load the page sooner, largest first."
          >
            {result.opportunities.length ? (
              <ul className="divide-y">
                {result.opportunities.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                    <span className="min-w-0 font-medium">{item.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {item.display || `${formatMetric("lcp", item.savings_ms)}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyRow>Lighthouse found nothing worth fixing for speed.</EmptyRow>
            )}
          </Section>

          {state.history.length > 1 && (
            <Section title="History">
              <Trend points={state.history} />
              <div className="overflow-x-auto border-t">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-4 py-2 text-left font-normal">Tested</th>
                      {SCORE_LABELS.map(([id, label]) => (
                        <th key={id} className="px-4 py-2 text-right font-normal">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y tabular-nums">
                    {[...state.history]
                      .reverse()
                      .slice(0, 10)
                      .map((point) => (
                        <tr key={point.scanned_at}>
                          <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{timeAgo(point.scanned_at)}</td>
                          {SCORE_LABELS.map(([id]) => {
                            const score = point[id];
                            return (
                              <td
                                key={id}
                                className={cn("px-4 py-2 text-right", score !== null && BAND_TEXT[performanceBand(score)])}
                              >
                                {score ?? "-"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

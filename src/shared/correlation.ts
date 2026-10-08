/** Daily figures from each connected source, lined up by date so they can be compared. */
export interface DailySeries {
  /** Source and measure, such as "Search Console clicks". */
  name: string;
  /** Which connected source it comes from, such as "Search Console". */
  source: string;
  /** Date (YYYY-MM-DD) to value. */
  days: Map<string, number>;
}

/** Buckets a series by calendar day, adding up hourly points. Labels start with the date. */
export function toDaily(points: { label: string }[], pick: (point: never) => number): Map<string, number> {
  const days = new Map<string, number>();
  for (const point of points) {
    const day = point.label.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    days.set(day, (days.get(day) ?? 0) + pick(point as never));
  }
  return days;
}

/** Pearson correlation of two samples, or null when there is not enough variation to say. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const meanA = a.slice(0, n).reduce((sum, x) => sum + x, 0) / n;
  const meanB = b.slice(0, n).reduce((sum, x) => sum + x, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (!varA || !varB) return null;
  return cov / Math.sqrt(varA * varB);
}

export interface Correlation {
  a: string;
  b: string;
  /** Whether both come from the same source. */
  same: boolean;
  /** -1 to 1. */
  r: number;
  /** Days both sources have figures for. */
  days: number;
}

/** Fewest shared days worth reporting a correlation for. */
export const MIN_CORRELATION_DAYS = 5;

/** The correlation of every pair of series, on the days both have, strongest first. */
export function correlate(series: DailySeries[]): Correlation[] {
  const out: Correlation[] = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const shared = [...series[i].days.keys()].filter((day) => series[j].days.has(day));
      if (shared.length < MIN_CORRELATION_DAYS) continue;
      const r = pearson(
        shared.map((day) => series[i].days.get(day)!),
        shared.map((day) => series[j].days.get(day)!),
      );
      if (r !== null) out.push({ a: series[i].name, b: series[j].name, same: series[i].source === series[j].source, r, days: shared.length });
    }
  }
  return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
}

/** A correlation in words. */
export function describe(r: number): string {
  const size = Math.abs(r);
  const strength = size >= 0.8 ? "Very strong" : size >= 0.6 ? "Strong" : size >= 0.4 ? "Moderate" : size >= 0.2 ? "Weak" : "No clear";
  if (size < 0.2) return "No clear link";
  return `${strength} ${r > 0 ? "positive" : "negative"}`;
}

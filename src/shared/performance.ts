import type { PerformanceFieldMetric, PerformanceLabMetric } from "./types.ts";

/** How Lighthouse's own colours read a category score: 90 and up good, 50 to 89 needs work, below 50 poor. */
export type PerformanceBand = "good" | "fair" | "poor";

export function performanceBand(score: number): PerformanceBand {
  return score >= 90 ? "good" : score >= 50 ? "fair" : "poor";
}

/** Google's published Core Web Vitals and Lighthouse thresholds: [good up to, poor from]. */
const LAB_LIMITS: Record<PerformanceLabMetric["id"], [number, number]> = {
  fcp: [1800, 3000],
  lcp: [2500, 4000],
  tbt: [200, 600],
  cls: [0.1, 0.25],
  si: [3400, 5800],
};

export function labBand(id: PerformanceLabMetric["id"], value: number): PerformanceBand {
  const [good, poor] = LAB_LIMITS[id];
  return value <= good ? "good" : value > poor ? "poor" : "fair";
}

export const LAB_LABELS: Record<PerformanceLabMetric["id"], string> = {
  fcp: "First Contentful Paint",
  lcp: "Largest Contentful Paint",
  tbt: "Total Blocking Time",
  cls: "Cumulative Layout Shift",
  si: "Speed Index",
};

export const FIELD_LABELS: Record<PerformanceFieldMetric["id"], string> = {
  lcp: "Largest Contentful Paint",
  inp: "Interaction to Next Paint",
  cls: "Cumulative Layout Shift",
  fcp: "First Contentful Paint",
};

/** A millisecond value as seconds, or as it is for the layout shift. */
export function formatMetric(id: string, value: number): string {
  if (id === "cls") return value.toFixed(value < 0.1 ? 3 : 2);
  if (id === "inp" || value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

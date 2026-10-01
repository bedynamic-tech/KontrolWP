import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { AnalyticsBreakdown, AnalyticsRange, SiteAnalyticsDetails, SiteSummary } from "../../shared/types";
import { hostname } from "../format";
import { RANGE_LABELS, StatsRow, TopList, TrendChart } from "./AnalyticsSection";

/** One breakdown's card, as the Analytics tab defines it. */
export interface BreakdownCard {
  key: AnalyticsBreakdown;
  title: string;
  unit: string;
  empty: string;
  format?: (label: string) => string;
}

/** "Sep 24 to Sep 30, 2026" from the first and last bucket of the chart. */
function periodLabel(data: SiteAnalyticsDetails): string {
  const day = (key: string | undefined) => {
    const [year, month, date] = (key ?? "").slice(0, 10).split("-").map(Number);
    return year ? new Date(year, month - 1, date) : null;
  };
  const first = day(data.series[0]?.label);
  const last = day(data.series[data.series.length - 1]?.label);
  if (!first || !last) return "";
  const short = (value: Date) => value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (first.getTime() === last.getTime()) return `${short(first)}, ${first.getFullYear()}`;
  return `${short(first)} to ${short(last)}, ${last.getFullYear()}`;
}

/** The file name the browser suggests when saving the print as a PDF. */
export function reportTitle(site: SiteSummary, range: AnalyticsRange): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${site.name} analytics, ${RANGE_LABELS[range].toLowerCase()}, ${today}`;
}

/**
 * The analytics as a printable report. It is drawn off screen into the page's
 * body, and print styles (src/web/index.css) show only it, so printing from
 * the Analytics tab saves a clean PDF without the dashboard around it.
 */
export function AnalyticsReport(props: {
  site: SiteSummary;
  data: SiteAnalyticsDetails;
  range: AnalyticsRange;
  cards: BreakdownCard[];
}) {
  const { site, data, range } = props;
  const breakdowns = data.breakdowns;
  if (!data.website || !breakdowns) return null;
  const period = periodLabel(data);

  return createPortal(
    <div id="print-report" className="bg-white text-neutral-900">
      <header className="border-b pb-3">
        <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Analytics report</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{site.name}</h1>
        <p className="mt-0.5 text-sm text-neutral-600">{hostname(site.url)}</p>
        <p className="mt-2 text-sm text-neutral-600">
          {RANGE_LABELS[range]}
          {period && ` (${period})`}. Generated{" "}
          {new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} from Umami website{" "}
          {data.website.name || data.website.domain}.
        </p>
      </header>
      <div className="@container mt-4 overflow-hidden rounded-xl border">
        <StatsRow data={data} />
        <TrendChart data={data} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {props.cards
          .filter((card) => breakdowns[card.key] !== null)
          .map((card) => (
            <div key={card.key} className="break-inside-avoid overflow-hidden rounded-xl border">
              <TopList
                title={card.title}
                unit={card.unit}
                rows={breakdowns[card.key]!}
                empty={card.empty}
                format={card.format}
              />
            </div>
          ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Print in the light theme whatever the dashboard uses, so a PDF never comes
 * out with a dark page. Covers the Print button and the browser's own Print.
 */
export function useLightThemeWhilePrinting(title: string) {
  useEffect(() => {
    const root = document.documentElement;
    const original = document.title;
    let printing = false;
    let wasDark = false;
    let scheme = "";
    const before = () => {
      // Some browsers announce a print twice; only the first sees the real theme.
      if (!printing) {
        wasDark = root.classList.contains("dark");
        scheme = root.style.colorScheme;
      }
      printing = true;
      root.classList.remove("dark");
      // The theme also sets the color scheme, which paints the page behind the report.
      root.style.colorScheme = "light";
      // The browser suggests the page title as the PDF's file name.
      document.title = title;
    };
    const after = () => {
      if (!printing) return;
      printing = false;
      if (wasDark) root.classList.add("dark");
      root.style.colorScheme = scheme;
      document.title = original;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [title]);
}

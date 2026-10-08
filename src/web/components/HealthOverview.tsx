import { useQuery } from "@tanstack/react-query";
import {
  AccessibilityIcon,
  Link2Icon,
  SearchIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scoreBand, type ScoreBand } from "../../shared/accessibility";
import {
  compareVersions,
  LINK_CHECK_SINCE,
  SEO_SINCE,
} from "../../shared/plugin-version";
import type { SiteSummary } from "../../shared/types";
import {
  fetchAccessibility,
  fetchGoogleSettings,
  fetchLinks,
  fetchSearchConsole,
  fetchSecurity,
  fetchSeo,
  fetchSeoAudit,
} from "../api";
import { plural, timeAgo } from "../format";

type Tone = "good" | "warn" | "bad" | undefined;

const TONE_CLASS: Record<Exclude<Tone, undefined>, string> = {
  good: "text-green-700 dark:text-green-400",
  warn: "text-amber-700 dark:text-amber-300",
  bad: "text-destructive",
};

const BAND_TONE: Record<ScoreBand, Tone> = {
  good: "good",
  fair: "warn",
  poor: "warn",
  bad: "bad",
};

interface Summary {
  value: string;
  detail: string;
  tone?: Tone;
}

/** One module: what the area found in a line or two, opening its full tab when selected. */
function HealthCard(props: {
  icon: ReactNode;
  title: string;
  tab: string;
  summary: Summary | null;
  onOpen: (tab: string) => void;
}) {
  const { summary } = props;
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.tab)}
      className="flex min-w-0 flex-col gap-1 rounded-xl border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-3.5">
        {props.icon}
        {props.title}
      </span>
      {summary ? (
        <>
          <span
            className={cn(
              "text-base font-medium tabular-nums",
              summary.tone && TONE_CLASS[summary.tone],
            )}
          >
            {summary.value}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {summary.detail}
          </span>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">Loading...</span>
      )}
    </button>
  );
}

function LinksCard(props: {
  site: SiteSummary;
  onOpen: (tab: string) => void;
}) {
  const { site } = props;
  const links = useQuery({
    queryKey: ["site", site.id, "links"],
    queryFn: () => fetchLinks(site.id),
    staleTime: 60_000,
    refetchInterval: false,
  });
  const data = links.data;
  let summary: Summary | null = null;
  if (links.error)
    summary = { value: "Unavailable", detail: "Open the tab for details" };
  else if (data) {
    const problems = data.counts.broken + data.counts.unresponsive;
    summary = !data.scan
      ? { value: "Not scanned yet", detail: "Scan the site for broken links" }
      : problems
        ? {
            value: `${plural(data.counts.broken, "broken link")}`,
            detail: data.counts.unresponsive
              ? `${data.counts.unresponsive} not responding`
              : `${data.counts.total} checked`,
            tone: data.counts.broken ? "bad" : "warn",
          }
        : {
            value: "No broken links",
            detail: `${plural(data.counts.total, "link")} checked`,
            tone: "good",
          };
  }
  return (
    <HealthCard
      icon={<Link2Icon />}
      title="Links"
      tab="links"
      summary={summary}
      onOpen={props.onOpen}
    />
  );
}

function SecurityCard(props: {
  site: SiteSummary;
  onOpen: (tab: string) => void;
}) {
  const { site } = props;
  const security = useQuery({
    queryKey: ["site", site.id, "security"],
    queryFn: () => fetchSecurity(site.id),
    staleTime: 60_000,
    refetchInterval: false,
  });
  const data = security.data;
  let summary: Summary | null = null;
  if (security.error)
    summary = { value: "Unavailable", detail: "Open the tab for details" };
  else if (data) {
    const vulnerable = data.vulnerabilities.length;
    const warnings = data.items.filter(
      (item) => item.status === "warning",
    ).length;
    summary = vulnerable
      ? {
          value: plural(
            vulnerable,
            "known vulnerability",
            "known vulnerabilities",
          ),
          detail: warnings
            ? `${plural(warnings, "setting")} to fix`
            : "Settings look fine",
          tone: "bad",
        }
      : warnings
        ? {
            value: `${plural(warnings, "setting")} to fix`,
            detail: "No known vulnerabilities",
            tone: "warn",
          }
        : {
            value: "No problems found",
            detail: "No known vulnerabilities",
            tone: "good",
          };
  }
  return (
    <HealthCard
      icon={<ShieldCheckIcon />}
      title="Security"
      tab="security"
      summary={summary}
      onOpen={props.onOpen}
    />
  );
}

function ScoreSummary(props: {
  scanned_at: number;
  score: number;
  issues: number;
}): Summary {
  return {
    value: `${props.score} out of 100`,
    detail: props.issues
      ? `${plural(props.issues, "kind", "kinds")} of problem, ${timeAgo(props.scanned_at)}`
      : `No problems, ${timeAgo(props.scanned_at)}`,
    tone: BAND_TONE[scoreBand(props.score)],
  };
}

function SeoCard(props: { site: SiteSummary; onOpen: (tab: string) => void }) {
  const { site } = props;
  const isStatic = site.kind === "static";
  const supported =
    isStatic ||
    (!!site.plugin_version &&
      compareVersions(site.plugin_version, SEO_SINCE) >= 0);
  const audit = useQuery({
    queryKey: ["site", site.id, "seo-audit"],
    queryFn: () => fetchSeoAudit(site.id),
    enabled: isStatic,
    staleTime: 60_000,
    refetchInterval: false,
  });
  const seo = useQuery({
    queryKey: ["site", site.id, "seo"],
    queryFn: () => fetchSeo(site.id),
    enabled: !isStatic && supported,
  });
  let summary: Summary | null = null;
  if (isStatic) {
    if (audit.error)
      summary = { value: "Unavailable", detail: "Open the tab for details" };
    else if (audit.data) {
      const scan = audit.data.scan;
      summary = scan
        ? ScoreSummary({
            scanned_at: scan.scanned_at,
            score: scan.score,
            issues: scan.issues.length,
          })
        : {
            value: "Not scanned yet",
            detail: audit.data.error ?? "Open the tab to scan",
          };
    }
  } else if (!supported) {
    summary = {
      value: "Needs a plugin update",
      detail: "It updates automatically",
    };
  } else if (seo.error)
    summary = { value: "Unavailable", detail: "Open the tab for details" };
  else if (seo.data) {
    const data = seo.data;
    summary = data.discouraged
      ? {
          value: "Hidden from search engines",
          detail: "WordPress asks them not to index it",
          tone: "bad",
        }
      : data.conflict
        ? {
            value: `${data.conflict} is active`,
            detail: "KontrolWP is not printing SEO tags",
            tone: "warn",
          }
        : {
            value: "Visible to search engines",
            detail: "KontrolWP is managing SEO tags",
            tone: "good",
          };
  }
  return (
    <HealthCard
      icon={<SearchIcon />}
      title="SEO"
      tab="seo"
      summary={summary}
      onOpen={props.onOpen}
    />
  );
}

function AccessibilityCard(props: {
  site: SiteSummary;
  onOpen: (tab: string) => void;
}) {
  const { site } = props;
  const accessibility = useQuery({
    queryKey: ["site", site.id, "accessibility"],
    queryFn: () => fetchAccessibility(site.id),
    staleTime: 60_000,
    refetchInterval: false,
  });
  let summary: Summary | null = null;
  if (accessibility.error)
    summary = { value: "Unavailable", detail: "Open the tab for details" };
  else if (accessibility.data) {
    const scan = accessibility.data.scan;
    summary = scan
      ? ScoreSummary({
          scanned_at: scan.scanned_at,
          score: scan.score,
          issues: scan.issues.length,
        })
      : {
          value: "Not scanned yet",
          detail: accessibility.data.error ?? "Open the tab to scan",
        };
  }
  return (
    <HealthCard
      icon={<AccessibilityIcon />}
      title="Accessibility"
      tab="accessibility"
      summary={summary}
      onOpen={props.onOpen}
    />
  );
}

/** Clicks and impressions from Search Console over the last 28 days, or a prompt to connect Google. */
function SearchConsoleCard(props: {
  site: SiteSummary;
  onOpen: (tab: string) => void;
}) {
  const { site } = props;
  const google = useQuery({
    queryKey: ["settings", "google"],
    queryFn: fetchGoogleSettings,
    refetchInterval: false,
  });
  const connected = !!google.data?.configured;
  const stats = useQuery({
    queryKey: ["site", site.id, "search-console", "28d"],
    queryFn: () => fetchSearchConsole(site.id, "28d"),
    enabled: connected,
    staleTime: 60_000,
    refetchInterval: false,
  });
  let summary: Summary | null = null;
  if (google.error)
    summary = { value: "Unavailable", detail: "Open the tab for details" };
  else if (google.data && !connected)
    summary = {
      value: "Not connected",
      detail: "Connect Google in Settings",
    };
  else if (stats.error)
    summary = { value: "Unavailable", detail: "Open the tab for details" };
  else if (stats.data) {
    const { totals } = stats.data;
    if (!stats.data.property || !totals) {
      summary = {
        value: "No property found",
        detail: "Open the tab to choose one",
        tone: "warn",
      };
    } else {
      const { value, previous } = totals.clicks;
      const change =
        previous !== null && previous > 0
          ? Math.round(((value - previous) / previous) * 100)
          : null;
      summary = {
        value: `${value.toLocaleString()} ${value === 1 ? "click" : "clicks"}`,
        detail: `${totals.impressions.value.toLocaleString()} impressions, last 28 days${
          change ? `, ${change > 0 ? "+" : ""}${change}% clicks` : ""
        }`,
        tone: change === null || change === 0 ? undefined : change > 0 ? "good" : "warn",
      };
    }
  }
  return (
    <HealthCard
      icon={<TrendingUpIcon />}
      title="Search Console"
      tab="analytics"
      summary={summary}
      onOpen={props.onOpen}
    />
  );
}

/** A basic summary of each health area the site has switched on, each opening its tab. */
export function HealthOverview(props: {
  site: SiteSummary;
  onOpen: (tab: string) => void;
}) {
  const { site, onOpen } = props;
  const wordpress = site.kind !== "static";
  const links =
    wordpress &&
    !site.links_excluded &&
    (!site.plugin_version ||
      compareVersions(site.plugin_version, LINK_CHECK_SINCE) >= 0);
  const security = wordpress && !site.security_excluded;
  const accessibility = !site.accessibility_excluded;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium">Health</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {links && <LinksCard site={site} onOpen={onOpen} />}
        {security && <SecurityCard site={site} onOpen={onOpen} />}
        <SeoCard site={site} onOpen={onOpen} />
        {accessibility && <AccessibilityCard site={site} onOpen={onOpen} />}
        {!site.analytics_excluded && <SearchConsoleCard site={site} onOpen={onOpen} />}
      </div>
    </section>
  );
}

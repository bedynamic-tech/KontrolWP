import { useQuery } from "@tanstack/react-query";
import {
  AccessibilityIcon,
  ActivityIcon,
  GaugeIcon,
  LockIcon,
  Link2Icon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scoreBand, type ScoreBand } from "../../shared/accessibility";
import { performanceBand, type PerformanceBand } from "../../shared/performance";
import {
  compareVersions,
  LINK_CHECK_SINCE,
  SEO_SINCE,
} from "../../shared/plugin-version";
import type { SiteSummary } from "../../shared/types";
import { certificateState, formatDuration, formatRatio } from "../../shared/uptime";
import {
  fetchAccessibility,
  fetchLinks,
  fetchPerformance,
  fetchSecurity,
  fetchSeo,
  fetchSeoAudit,
  fetchSsl,
  fetchUptime,
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

const PERFORMANCE_TONE: Record<PerformanceBand, Tone> = {
  good: "good",
  fair: "warn",
  poor: "bad",
};

function PerformanceCard(props: {
  site: SiteSummary;
  onOpen: (tab: string) => void;
}) {
  const { site } = props;
  const performance = useQuery({
    queryKey: ["site", site.id, "performance"],
    queryFn: () => fetchPerformance(site.id),
    staleTime: 30_000,
    refetchInterval: false,
  });
  let summary: Summary | null = null;
  if (performance.error)
    summary = { value: "Unavailable", detail: "Open the tab for details" };
  else if (performance.data) {
    const { mobile, desktop } = performance.data;
    const score = mobile.result?.scores.performance ?? null;
    const desktopScore = desktop.result?.scores.performance ?? null;
    const tested = mobile.result ?? desktop.result;
    summary =
      tested && (score !== null || desktopScore !== null)
        ? {
            value:
              score !== null
                ? `${score} on mobile`
                : `${desktopScore} on desktop`,
            detail: `${score !== null && desktopScore !== null ? `${desktopScore} on desktop, ` : ""}${timeAgo(tested.scanned_at)}`,
            tone: PERFORMANCE_TONE[performanceBand(score ?? desktopScore!)],
          }
        : {
            value: "Not tested yet",
            detail: mobile.error ?? "Open the tab to run a test",
          };
  }
  return (
    <HealthCard
      icon={<GaugeIcon />}
      title="Performance"
      tab="performance"
      summary={summary}
      onOpen={props.onOpen}
    />
  );
}

function UptimeCard(props: { site: SiteSummary; onOpen: (tab: string) => void }) {
  const { site } = props;
  const uptime = useQuery({
    queryKey: ["site", site.id, "uptime"],
    queryFn: () => fetchUptime(site.id),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  let summary: Summary | null = null;
  if (uptime.error)
    summary = { value: "Unavailable", detail: "Open the tab for details" };
  else if (uptime.data) {
    const { latest, since, ratios } = uptime.data;
    const month = ratios.month === null ? null : `${formatRatio(ratios.month)} over 30 days`;
    summary = !latest
      ? { value: "Not checked yet", detail: "The first check runs within 15 minutes" }
      : !latest.up
        ? {
            value: "Down",
            detail: since ? `For ${formatDuration(latest.checked_at - since)}: ${latest.error ?? ""}` : (latest.error ?? ""),
            tone: "bad",
          }
        : {
            value: "Up",
            detail: [month, latest.response_ms !== null ? `${latest.response_ms} ms` : null].filter(Boolean).join(", "),
            tone: ratios.month !== null && ratios.month < 99 ? "warn" : "good",
          };
  }
  return (
    <HealthCard icon={<ActivityIcon />} title="Uptime" tab="uptime" summary={summary} onOpen={props.onOpen} />
  );
}

/** The SSL certificate's state, opening the Domain & SSL tab. */
function SslCard(props: { site: SiteSummary; onOpen: (tab: string) => void }) {
  const ssl = useQuery({
    queryKey: ["site", props.site.id, "ssl"],
    queryFn: () => fetchSsl(props.site.id),
    refetchInterval: false,
    staleTime: 60 * 60 * 1000,
  });
  let summary: Summary | null = null;
  if (ssl.error) summary = { value: "Unavailable", detail: "Open the tab for details" };
  else if (ssl.data) {
    const cert = ssl.data.ssl;
    const state = cert ? certificateState(cert) : null;
    const issuer = cert?.issuer ? `Issued by ${cert.issuer}` : "";
    summary = !cert
      ? { value: "No certificate", detail: "This site does not use HTTPS", tone: "warn" }
      : state!.kind === "unknown"
        ? { value: "Could not be read", detail: state!.message }
        : state!.kind === "expired"
          ? { value: "SSL certificate expired", detail: issuer, tone: "bad" }
          : state!.kind === "mismatch"
            ? { value: "SSL certificate is for another site", detail: issuer, tone: "bad" }
            : state!.kind === "expiring"
              ? { value: `SSL expires in ${plural(state!.days, "day")}`, detail: "Not renewed yet", tone: "warn" }
              : { value: `SSL valid for ${plural(state!.days, "day")}`, detail: issuer, tone: "good" };
  }
  return <HealthCard icon={<LockIcon />} title="Domain & SSL" tab="domain" summary={summary} onOpen={props.onOpen} />;
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
  const performance = !site.performance_excluded;
  const uptime = !site.uptime_excluded;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium">Health</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {uptime && <UptimeCard site={site} onOpen={onOpen} />}
        <SslCard site={site} onOpen={onOpen} />
        {links && <LinksCard site={site} onOpen={onOpen} />}
        {security && <SecurityCard site={site} onOpen={onOpen} />}
        <SeoCard site={site} onOpen={onOpen} />
        {accessibility && <AccessibilityCard site={site} onOpen={onOpen} />}
        {performance && <PerformanceCard site={site} onOpen={onOpen} />}
      </div>
    </section>
  );
}

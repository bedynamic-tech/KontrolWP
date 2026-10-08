import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DeploymentStatus, SiteDeployment, SiteSummary } from "../../shared/types";
import { fetchBuildLog, fetchSiteDeployments } from "../api";
import { visibleDeployments } from "../../shared/deployments";
import { timeAgo } from "../format";
import { EmptyRow, Section } from "./Section";

const COMPACT_ROWS = 5;

const STATUS_LABELS: Record<DeploymentStatus | "previous", string> = {
  live: "Live",
  previous: "Deployed",
  queued: "Queued",
  building: "Building",
  success: "Build passed",
  failed: "Build failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

const STATUS_TONES: Record<DeploymentStatus | "previous", string> = {
  live: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  previous: "bg-muted text-muted-foreground",
  queued: "bg-muted text-muted-foreground",
  building: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  success: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
};

/**
 * A static site's deployments from Cloudflare (what went live) and its Workers
 * Builds runs, newest first, as of the last sync. `compact` is the Overview's
 * short list; the Deployments tab shows everything with each build's log.
 */
export function DeploymentsSection(props: { site: SiteSummary; compact?: boolean; onChooseWorker?: () => void }) {
  const { site, compact } = props;
  const query = useQuery({
    queryKey: ["site", site.id, "deployments"],
    queryFn: () => fetchSiteDeployments(site.id),
    refetchInterval: false,
  });

  let body;
  if (query.isPending) {
    body = (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (query.error) {
    body = <p className="px-4 py-6 text-center text-sm text-destructive">{query.error.message}</p>;
  } else if (!query.data.configured || !query.data.worker) {
    body = (
      <EmptyRow>
        {!query.data.configured ? (
          <>
            Connect Cloudflare in{" "}
            <Link to="/settings" className="underline underline-offset-4">
              Settings
            </Link>{" "}
            to see this site's deployments and build logs.
          </>
        ) : (
          <>
            Choose the Cloudflare Worker this site deploys from{" "}
            {props.onChooseWorker ? (
              <button type="button" className="underline underline-offset-4" onClick={props.onChooseWorker}>
                in the site's settings
              </button>
            ) : (
              "in the site's settings"
            )}
            .
          </>
        )}
      </EmptyRow>
    );
  } else {
    const { rows, live } = visibleDeployments(query.data.deployments);
    const shown = compact ? rows.slice(0, COMPACT_ROWS) : rows;
    body = (
      <>
        {query.data.error && (
          <p role="alert" className="border-b bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
            {query.data.error}
          </p>
        )}
        {shown.length === 0 ? (
          <EmptyRow>Cloudflare has not listed any deployments for {query.data.worker} yet.</EmptyRow>
        ) : (
          <ul className="divide-y">
            {shown.map((row) => (
              <DeploymentRow
                key={`${row.type} ${row.ref}`}
                site={site}
                row={row}
                live={row.ref === live}
                logs={!compact}
              />
            ))}
          </ul>
        )}
        {compact && rows.length > shown.length && (
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
            Showing {shown.length} of {rows.length}.{" "}
            <Link to={`/sites/${site.id}?tab=deployments`} className="underline underline-offset-4">
              See all deployments
            </Link>
          </p>
        )}
      </>
    );
  }

  return (
    <Section
      title={site.cf_worker ? `Deployments (${site.cf_worker})` : "Deployments"}
      action={
        !compact && site.cf_worker && site.cf_account_id ? (
          <a
            href={`https://dash.cloudflare.com/${site.cf_account_id}/workers/services/view/${encodeURIComponent(site.cf_worker)}/production/deployments`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Open in Cloudflare <ExternalLinkIcon className="size-3" />
          </a>
        ) : undefined
      }
    >
      {body}
    </Section>
  );
}

function DeploymentRow(props: { site: SiteSummary; row: SiteDeployment; live: boolean; logs: boolean }) {
  const { row } = props;
  const state = row.type === "deployment" && !props.live ? "previous" : row.status;
  // A build the live version came from keeps its own status and gets a second chip.
  const liveBuild = props.live && row.type === "build";
  const fallback = row.type === "deployment" ? "New version deployed" : "Build";
  const details = [
    row.author,
    row.type === "build" && row.source,
    row.branch && `${row.branch}${row.commit_hash ? `@${row.commit_hash.slice(0, 7)}` : ""}`,
    row.type === "deployment" && row.source,
    row.created_at ? timeAgo(row.created_at).toLowerCase() : "",
  ].filter(Boolean);
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium",
            STATUS_TONES[state],
          )}
        >
          {STATUS_LABELS[state]}
        </span>
        {liveBuild && (
          <span
            className={cn(
              "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium",
              STATUS_TONES.live,
            )}
          >
            {STATUS_LABELS.live}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.message || fallback}</span>
          <span className="block truncate text-xs text-muted-foreground">{details.join(" · ")}</span>
        </span>
      </div>
      {props.logs && row.type === "build" && row.status !== "queued" && (
        <BuildLogView siteId={props.site.id} buildId={row.ref} />
      )}
    </li>
  );
}

/** A build's log, read from Cloudflare when opened, a page at a time. */
function BuildLogView(props: { siteId: number; buildId: string }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async (from: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchBuildLog(props.siteId, props.buildId, from);
      setLines((current) => [...current, ...page.lines.map((line) => line.text)]);
      setCursor(page.cursor);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the log");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        loading={loading && !loaded}
        onClick={() => {
          setOpen(!open);
          if (!loaded && !loading) void load(null);
        }}
      >
        {open ? "Hide log" : "Show log"}
      </Button>
      {open && (
        <div className="mt-2">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {loaded && (
            <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {lines.length ? lines.join("\n") : "This build has no log lines."}
            </pre>
          )}
          {cursor && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="mt-2"
              loading={loading}
              onClick={() => void load(cursor)}
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

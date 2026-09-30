import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { fetchOverview } from "../api";
import { hostname, plural } from "../format";
import { AddSiteDialog } from "./AddSiteDialog";
import { PluginDownloadButton } from "./PluginDownload";
import { PageSkeleton } from "./OverviewPage";
import { EmptyRow } from "./Section";
import { SiteIcon } from "./SiteIcon";
import { StatusBadge } from "./StatusBadge";

export function SitesPage() {
  const { data, error, isPending } = useQuery({ queryKey: ["overview"], queryFn: fetchOverview });
  if (isPending) return <PageSkeleton />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Sites</h1>
        <div className="flex gap-2">
          <PluginDownloadButton />
          <AddSiteDialog />
        </div>
      </div>
      <div className="mt-6 overflow-hidden rounded-xl border bg-background">
        {data.sites.length === 0 ? (
          <EmptyRow>No sites yet. Add one to get started.</EmptyRow>
        ) : (
          <ul className="divide-y">
            {data.sites.map((site) => (
              <li key={site.id}>
                <Link
                  to={`/sites/${site.id}`}
                  className="flex flex-col gap-2 px-4 py-3 hover:bg-muted/50 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <SiteIcon site={site} className="size-9 text-sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{site.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{hostname(site.url)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{plural(site.update_count, "update")}</span>
                    <span>{plural(site.pending_comments, "comment")}</span>
                    {/* Version, sync time and status live on the site's page; only a problem shows here. */}
                    {site.status !== "connected" && <StatusBadge status={site.status} />}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

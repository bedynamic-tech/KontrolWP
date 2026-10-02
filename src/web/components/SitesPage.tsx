import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";
import { fetchOverview } from "../api";
import { hostname, plural, timeAgo } from "../format";
import { AddSiteDialog } from "./AddSiteDialog";
import { CoreAutoUpdateDialog } from "./CoreAutoUpdate";
import { PageSkeleton } from "./OverviewPage";
import { EmptyRow } from "./Section";
import { SiteIcon } from "./SiteIcon";
import { ConnectionBanner } from "./ConnectionBanner";

export function SitesPage() {
  const { data, error, isPending } = useQuery({ queryKey: ["overview"], queryFn: fetchOverview });
  const [autoUpdates, setAutoUpdates] = useState(false);
  if (isPending) return <PageSkeleton />;
  // A failed refresh keeps showing the last data; only a first load that failed shows the error.
  if (!data) return <p className="text-sm text-destructive">{error?.message}</p>;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Sites</h1>
        <div className="flex items-center gap-2">
          {data.sites.some((site) => site.kind === "wordpress") && (
            <Button size="sm" variant="outline" onClick={() => setAutoUpdates(true)}>
              WordPress auto-updates
            </Button>
          )}
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
                    {site.kind === "static" ? (
                      <>
                        <span>Static site</span>
                        {site.cf_hosted && (
                          <span>
                            {site.last_deployed_at
                              ? `Deployed ${timeAgo(site.last_deployed_at).toLowerCase()}`
                              : "No deployments"}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span>{site.updates_excluded ? "Updates excluded" : plural(site.update_count, "update")}</span>
                        <span>{plural(site.pending_comments, "comment")}</span>
                      </>
                    )}
                  </div>
                </Link>
                {/* Only a site KontrolWP can't reach gets a banner; a connected one shows nothing. */}
                <Link to={`/sites/${site.id}`} className="block px-4 pb-3 empty:hidden">
                  <ConnectionBanner site={site} compact />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CoreAutoUpdateDialog
        sites={data.sites.filter((site) => site.kind === "wordpress")}
        open={autoUpdates}
        onOpenChange={setAutoUpdates}
      />
    </div>
  );
}

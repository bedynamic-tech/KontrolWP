import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchOverview } from "../api";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import type { FleetLinks } from "../../shared/types";
import { plural, timeAgo } from "../format";
import { CommentsList } from "./CommentsList";
import { EmptyRow, Section } from "./Section";
import { UpdateAllButton, UpdatesList, updatesRefetchInterval } from "./UpdatesList";

export function OverviewPage() {
  const { data, error, isPending } = useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    refetchInterval: (query) => updatesRefetchInterval(query.state.data?.updates),
  });

  if (isPending) return <PageSkeleton />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  const { sites, updates, comments, links } = data;
  const pendingComments = sites.reduce((sum, site) => sum + site.pending_comments, 0);
  const attention = sites.filter((site) => site.status !== "connected").length;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Overview</h1>

      {sites.length === 0 ? (
        <div className="mt-8 rounded-xl border bg-background px-6 py-12 text-center">
          <h2 className="text-base font-medium">Add your first site</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Connect a WordPress site with the KontrolWP Connect plugin to see its updates and comments here, or add a
            static website on Cloudflare Workers to see its analytics and deployments.
          </p>
          <Link to="/sites" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
            Add a site on the Sites page
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Sites" value={sites.length} />
            <Stat label="Updates available" value={updates.length} />
            <Stat label="Comments to review" value={pendingComments} />
            <Stat label="Broken links" value={links.total} tone={links.total ? "warn" : undefined} />
            <Stat label="Sites needing attention" value={attention} tone={attention ? "warn" : undefined} />
          </div>
          <Section title="Updates" action={<UpdateAllButton updates={updates} />}>
            <UpdatesList updates={updates} showSite />
          </Section>
          <Section title="Comments awaiting review">
            <CommentsList comments={comments} showSite />
          </Section>
          <Section title={links.total ? `Broken links (${links.total})` : "Broken links"}>
            <BrokenLinksList links={links} />
          </Section>
        </>
      )}
    </div>
  );
}

/** Broken and unresponsive links across sites; each opens its site's Links tab to fix. */
function BrokenLinksList(props: { links: FleetLinks }) {
  const { links } = props;
  if (!links.items.length) {
    return (
      <EmptyRow>
        {links.scanned
          ? "No broken links found."
          : "No links have been checked yet. They are checked at midnight, or open a site's Links tab and select Scan now."}
      </EmptyRow>
    );
  }
  return (
    <>
      <ul className="divide-y">
        {links.items.map((link) => (
          <li key={`${link.site_id} ${link.url}`}>
            <Link
              to={`/sites/${link.site_id}?tab=links`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40"
              title={link.error ?? undefined}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium",
                  link.status === "broken"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                )}
              >
                {link.status === "broken" ? "Broken" : "Unresponsive"}
                {link.http_status !== null && <span className="tabular-nums opacity-80">{link.http_status}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{link.url.replace(/^https?:\/\//, "")}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    link.site_name,
                    link.post_title &&
                      `in ${link.post_title}${link.post_count > 1 ? ` and ${plural(link.post_count - 1, "more post")}` : ""}`,
                    link.checked_at && `checked ${timeAgo(link.checked_at).toLowerCase()}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {links.total > links.items.length && (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          Showing {links.items.length} of {links.total}. Open a site's Links tab for the rest.
        </p>
      )}
    </>
  );
}

function Stat(props: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${props.tone === "warn" ? "text-destructive" : ""}`}>
        {props.value}
      </p>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchOverview } from "../api";
import { Link } from "react-router";
import { CommentsList } from "./CommentsList";
import { Section } from "./Section";
import { UpdateAllButton, UpdatesList, updatesRefetchInterval } from "./UpdatesList";

export function OverviewPage() {
  const { data, error, isPending } = useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    refetchInterval: (query) => updatesRefetchInterval(query.state.data?.updates),
  });

  if (isPending) return <PageSkeleton />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  const { sites, updates, comments } = data;
  const pendingComments = sites.reduce((sum, site) => sum + site.pending_comments, 0);
  const attention = sites.filter((site) => site.status !== "connected").length;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Overview</h1>

      {sites.length === 0 ? (
        <div className="mt-8 rounded-xl border bg-background px-6 py-12 text-center">
          <h2 className="text-base font-medium">Add your first site</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Connect a WordPress site with the KontrolWP Connect plugin, from the sidebar, to see
            its updates and comments here.
          </p>
          <Link to="/sites" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
            Add a site on the Sites page
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Sites" value={sites.length} />
            <Stat label="Updates available" value={updates.length} />
            <Stat label="Comments to review" value={pendingComments} />
            <Stat label="Sites needing attention" value={attention} tone={attention ? "warn" : undefined} />
          </div>
          <Section title="Updates" action={<UpdateAllButton updates={updates} />}>
            <UpdatesList updates={updates} showSite />
          </Section>
          <Section title="Comments awaiting review">
            <CommentsList comments={comments} showSite />
          </Section>
        </>
      )}
    </div>
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

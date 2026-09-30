import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteSite, fetchSite, newConnectionKey, syncSite } from "../api";
import { timeAgo } from "../format";
import { CommentsList } from "./CommentsList";
import { ConnectionSteps } from "./ConnectionSteps";
import { PageSkeleton } from "./OverviewPage";
import { Section } from "./Section";
import { StatusBadge } from "./StatusBadge";
import { UpdatesList } from "./UpdatesList";

export function SitePage() {
  const id = Number(useParams().siteId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [connectionKey, setConnectionKey] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data, error, isPending } = useQuery({ queryKey: ["site", id], queryFn: () => fetchSite(id) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["site", id] });
    queryClient.invalidateQueries({ queryKey: ["overview"] });
  };
  // A failed sync is recorded on the site, so the refreshed page shows why.
  const sync = useMutation({ mutationFn: () => syncSite(id), onSettled: refresh });
  const rotate = useMutation({
    mutationFn: () => newConnectionKey(id),
    onSuccess: (result) => setConnectionKey(result.connection_key),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => deleteSite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      navigate("/sites");
    },
  });

  if (isPending) return <PageSkeleton />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  const { site, updates, comments } = data;

  return (
    <div>
      <Link to="/sites" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3" /> Sites
      </Link>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{site.name}</h1>
            <StatusBadge status={site.status} />
          </div>
          <a
            href={site.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            {site.url} <ExternalLinkIcon className="size-3" />
          </a>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`${site.url}/wp-admin/`} target="_blank" rel="noreferrer">
              WP Admin
            </a>
          </Button>
          <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCwIcon className={sync.isPending ? "animate-spin" : ""} />
            {sync.isPending ? "Syncing..." : "Sync now"}
          </Button>
        </div>
      </div>

      {site.last_error && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">The last sync failed</p>
          <p className="mt-1 text-muted-foreground">{site.last_error}</p>
        </div>
      )}

      {site.status === "pending" && !connectionKey && (
        <div className="mt-4 rounded-xl border bg-background px-4 py-3 text-sm">
          <p className="font-medium">This site is not connected yet</p>
          <p className="mt-1 text-muted-foreground">
            If you no longer have its Connection Key, create a new one below.
          </p>
        </div>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fact label="WordPress" value={site.wp_version} />
        <Fact label="PHP" value={site.php_version} />
        <Fact label="Theme" value={site.theme_name} />
        <Fact label="Last synced" value={timeAgo(site.last_synced_at)} />
      </dl>

      <Section title="Updates">
        <UpdatesList updates={updates} showSite={false} />
      </Section>
      <Section title={`Comments awaiting review (${site.pending_comments})`}>
        <CommentsList comments={comments} showSite={false} />
      </Section>

      <Section title="Connection">
        <div className="space-y-4 px-4 py-4">
          {connectionKey ? (
            <ConnectionSteps siteUrl={site.url} connectionKey={connectionKey} />
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                A new Connection Key replaces the current one. The site stops syncing until you
                paste it into Presser Connect.
              </p>
              <Button variant="outline" size="sm" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
                New connection key
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Removing the site deletes it from Presser. Nothing changes on the site itself.
            </p>
            <Button variant="destructive" size="sm" onClick={() => setConfirmRemove(true)}>
              Remove site
            </Button>
          </div>
        </div>
      </Section>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {site.name}?</DialogTitle>
            <DialogDescription>
              Presser forgets this site and its Connection Key. You can deactivate Presser Connect
              on the site afterwards.
            </DialogDescription>
          </DialogHeader>
          {remove.error && <p className="text-sm text-destructive">{remove.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Remove site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Fact(props: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{props.value || "Unknown"}</dd>
    </div>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SiteRollback, SiteSummary, SiteUpdate } from "../../shared/types";
import { revertUpdate } from "../api";
import { timeAgo } from "../format";
import { pluginIconSources, RemoteIcon } from "./RemoteIcon";
import { Section } from "./Section";
import { Spinner } from "./Spinner";
import { UpdateAllButton, UpdatesList } from "./UpdatesList";

/** A site's updates, with WordPress, plugins and (when there are any) themes each in their own part. */
export function SiteUpdatesSection(props: { site: SiteSummary; updates: SiteUpdate[]; rollbacks: SiteRollback[] }) {
  const { site, updates, rollbacks } = props;
  const of = (kind: SiteUpdate["kind"]) => updates.filter((update) => update.kind === kind);
  const themes = of("theme");

  // With update checks switched off in Site settings there is nothing to show; the switch there turns them back on.
  if (site.updates_excluded) return null;

  return (
    <Section title="Updates" action={<UpdateAllButton updates={updates} />}>
      <Part title="WordPress">
        <List updates={of("core")} empty="WordPress is up to date." />
      </Part>
      <Part title="Plugins">
        <List updates={of("plugin")} empty="All plugins are up to date" />
      </Part>
      {themes.length > 0 && (
        <Part title="Themes">
          <List updates={themes} empty="" />
        </Part>
      )}
      {rollbacks.length > 0 && (
        <Part title="Previous versions">
          <ul className="divide-y">
            {rollbacks.map((rollback) => (
              <RollbackRow key={`${rollback.kind}:${rollback.slug}`} rollback={rollback} />
            ))}
          </ul>
        </Part>
      )}
    </Section>
  );
}

/** Poll quickly while a revert is waiting or running. */
export function rollbacksActive(rollbacks: SiteRollback[] | undefined): boolean {
  return !!rollbacks?.some((rollback) => rollback.job_status === "queued" || rollback.job_status === "running");
}

function Part(props: { title: string; children: ReactNode }) {
  return (
    <div className="border-b last:border-b-0 [&>*:last-child]:border-b-0">
      <h3 className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">{props.title}</h3>
      {props.children}
    </div>
  );
}

function List(props: { updates: SiteUpdate[]; empty: string }) {
  if (!props.updates.length) return <p className="px-4 py-3 text-sm text-muted-foreground">{props.empty}</p>;
  return <UpdatesList updates={props.updates} showSite={false} />;
}

const REVERT_LABELS = { queued: "Queued", running: "Reverting...", done: "Reverted" } as const;

/** A plugin or theme KontrolWP updated, with the version the site kept before it. */
function RollbackRow(props: { rollback: SiteRollback }) {
  const { rollback } = props;
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () => revertUpdate(rollback.site_id, rollback),
    onSuccess: () => setConfirming(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["site", rollback.site_id] }),
  });

  const status = mutation.isSuccess && !rollback.job_status ? "queued" : rollback.job_status;
  const busy = status === "queued" || status === "running" || status === "done";
  const error = status === "failed" ? rollback.job_error : null;
  const icon = rollback.kind === "plugin" ? pluginIconSources(rollback.slug, null) : [null];

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <RemoteIcon sources={icon} name={rollback.name} className="size-9 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{rollback.name}</span>
            <Badge variant="outline" className="capitalize">{rollback.kind}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rollback.version} kept when it was updated to {rollback.current_version}, {timeAgo(rollback.created_at)}
          </p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {busy && status && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {status !== "done" && <Spinner className="size-3" />}
            {REVERT_LABELS[status]}
          </span>
        )}
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={busy}>
          Revert to {rollback.version}
        </Button>
      </div>
      <Dialog open={confirming} onOpenChange={(open) => !mutation.isPending && setConfirming(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revert {rollback.name}?</DialogTitle>
            <DialogDescription>
              WordPress replaces version {rollback.current_version} with {rollback.version}, the copy the site kept
              before the update. Settings and content stay as they are. Scheduled updates skip{" "}
              {rollback.current_version} afterward.
            </DialogDescription>
          </DialogHeader>
          {mutation.error && <p className="text-sm text-destructive">{mutation.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
              Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

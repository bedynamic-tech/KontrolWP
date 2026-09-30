import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SiteUpdate, UpdateJobStatus } from "../../shared/types";
import { applyUpdate } from "../api";
import { RemoteIcon } from "./RemoteIcon";
import { EmptyRow } from "./Section";

/** Poll quickly while an update is waiting or running, so its row follows along. */
export function updatesRefetchInterval(updates: SiteUpdate[] | undefined): number {
  const active = updates?.some((update) => update.job_status === "queued" || update.job_status === "running");
  return active ? 3_000 : 60_000;
}

const KIND_ORDER = { core: 0, plugin: 1, theme: 2 } as const;

/** One entry per plugin, theme or core, with every site that needs it. */
function groupUpdates(updates: SiteUpdate[]): SiteUpdate[][] {
  const groups = new Map<string, SiteUpdate[]>();
  for (const update of updates) {
    const key = `${update.kind}:${update.slug}`;
    groups.set(key, [...(groups.get(key) ?? []), update]);
  }
  return [...groups.values()].sort(
    (a, b) => KIND_ORDER[a[0].kind] - KIND_ORDER[b[0].kind] || a[0].name.localeCompare(b[0].name),
  );
}

/**
 * Updates across sites (showSite) list each plugin, theme or core once, with
 * the sites that need it; a single site's page lists its own updates.
 */
export function UpdatesList(props: { updates: SiteUpdate[]; showSite: boolean }) {
  if (!props.updates.length) return <EmptyRow>Everything is up to date.</EmptyRow>;
  if (!props.showSite) {
    return (
      <ul className="divide-y">
        {props.updates.map((update) => (
          <UpdateRow key={`${update.kind}:${update.slug}`} update={update} showSite={false} />
        ))}
      </ul>
    );
  }
  return (
    <ul className="divide-y">
      {groupUpdates(props.updates).map((group) => {
        const key = `${group[0].kind}:${group[0].slug}`;
        return group.length === 1 ? (
          <UpdateRow key={key} update={group[0]} showSite />
        ) : (
          <UpdateGroup key={key} updates={group} />
        );
      })}
    </ul>
  );
}

function UpdateGroup(props: { updates: SiteUpdate[] }) {
  const { updates } = props;
  const first = updates[0];
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  // Sites not already queued, running or finished; failed ones are tried again.
  const pending = updates.filter((update) => update.job_status === null || update.job_status === "failed");
  const mutation = useMutation({
    mutationFn: () => Promise.all(pending.map((update) => applyUpdate(update.site_id, update))),
    onMutate: () => setRequestError(null),
    onError: (err: Error) => setRequestError(err.message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      for (const update of updates) queryClient.invalidateQueries({ queryKey: ["site", update.site_id] });
    },
  });

  const count = (status: UpdateJobStatus) => updates.filter((update) => update.job_status === status).length;
  const failed = count("failed");
  const versions = [...new Set(updates.map((update) => update.new_version))];
  const status = mutation.isPending
    ? "Queued"
    : pending.length
      ? null
      : count("done") === updates.length
        ? "Updated"
        : count("running")
          ? "Updating..."
          : "Queued";

  return (
    <li>
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <RemoteIcon sources={[first.icon_url]} name={first.name} className="size-9 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{first.name}</span>
              <Badge variant="outline" className="capitalize">{first.kind === "core" ? "WordPress" : first.kind}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline"
              >
                {updates.length} sites
                <ChevronDownIcon className={cn("size-3 transition-transform", open && "rotate-180")} />
              </button>
              {" · "}to {versions.join(", ")}
              {failed > 0 && <span className="text-destructive">{` · ${failed} failed`}</span>}
            </p>
            {requestError && <p className="mt-1 text-xs text-destructive">{requestError}</p>}
          </div>
        </div>
        <UpdateButton
          status={status}
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !pending.length}
        />
      </div>
      {open && (
        <ul className="divide-y border-t bg-muted/30 pl-16">
          {updates.map((update) => (
            <UpdateRow key={update.site_id} update={update} showSite siteOnly />
          ))}
        </ul>
      )}
    </li>
  );
}

const JOB_LABELS: Record<UpdateJobStatus, string> = {
  queued: "Queued",
  running: "Updating...",
  done: "Updated",
  failed: "Failed",
};

/** Always reads "Update"; where the update stands shows beside it. */
function UpdateButton(props: { status: string | null; onClick: () => void; disabled: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {props.status && <span className="text-xs text-muted-foreground">{props.status}</span>}
      <Button size="sm" onClick={props.onClick} disabled={props.disabled}>
        Update
      </Button>
    </div>
  );
}

/** Queue every update that is not already queued, running or done. */
export function UpdateAllButton(props: { updates: SiteUpdate[] }) {
  const queryClient = useQueryClient();
  const pending = props.updates.filter((update) => update.job_status === null || update.job_status === "failed");
  const mutation = useMutation({
    mutationFn: () => Promise.all(pending.map((update) => applyUpdate(update.site_id, update))),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["site"] });
    },
  });
  if (!props.updates.length) return null;
  return (
    <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending || !pending.length}>
      Update all
    </Button>
  );
}

function UpdateRow(props: { update: SiteUpdate; showSite: boolean; siteOnly?: boolean }) {
  const { update } = props;
  const queryClient = useQueryClient();
  const [requestError, setRequestError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => applyUpdate(update.site_id, update),
    onMutate: () => setRequestError(null),
    onError: (err: Error) => setRequestError(err.message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["site", update.site_id] });
    },
  });

  // Until the refetch shows the job, a request that went through reads as queued.
  const status = mutation.isPending ? "queued" : (update.job_status ?? (mutation.isSuccess ? "queued" : null));
  const failed = status === "failed";
  const busy = status === "queued" || status === "running" || status === "done";
  const error = requestError ?? (failed ? update.job_error : null);
  const note = status === "queued" ? update.job_error : null;

  const button = (
    <UpdateButton
      status={status && status !== "failed" ? JOB_LABELS[status] : null}
      onClick={() => mutation.mutate()}
      disabled={busy}
    />
  );

  // One site inside a grouped update: the group row already names the update.
  if (props.siteOnly) {
    return (
      <li className="flex flex-col gap-2 py-2.5 pr-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <Link to={`/sites/${update.site_id}`} className="truncate text-sm hover:underline">
            {update.site_name}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {update.current_version} to {update.new_version}
          </p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
        </div>
        {button}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <RemoteIcon sources={[update.icon_url]} name={update.name} className="size-9 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{update.name}</span>
            <Badge variant="outline" className="capitalize">{update.kind === "core" ? "WordPress" : update.kind}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {props.showSite && (
              <>
                <Link to={`/sites/${update.site_id}`} className="hover:text-foreground hover:underline">
                  {update.site_name}
                </Link>
                {" · "}
              </>
            )}
            {update.current_version} to {update.new_version}
          </p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
        </div>
      </div>
      {button}
    </li>
  );
}

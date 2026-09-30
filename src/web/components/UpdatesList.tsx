import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SiteUpdate, UpdateJobStatus } from "../../shared/types";
import { applyUpdate } from "../api";
import { RemoteIcon } from "./RemoteIcon";
import { EmptyRow } from "./Section";

/** Poll quickly while an update is waiting or running, so its row follows along. */
export function updatesRefetchInterval(updates: SiteUpdate[] | undefined): number {
  const active = updates?.some((update) => update.job_status === "queued" || update.job_status === "running");
  return active ? 3_000 : 60_000;
}

export function UpdatesList(props: { updates: SiteUpdate[]; showSite: boolean }) {
  if (!props.updates.length) return <EmptyRow>Everything is up to date.</EmptyRow>;
  return (
    <ul className="divide-y">
      {props.updates.map((update) => (
        <UpdateRow key={`${update.site_id}:${update.kind}:${update.slug}`} update={update} showSite={props.showSite} />
      ))}
    </ul>
  );
}

const JOB_LABELS: Record<UpdateJobStatus, string> = {
  queued: "Queued",
  running: "Updating...",
  done: "Updated",
  failed: "Try again",
};

function UpdateRow(props: { update: SiteUpdate; showSite: boolean }) {
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
  const label = status ? JOB_LABELS[status] : "Update";
  const error = requestError ?? (failed ? update.job_error : null);
  const note = status === "queued" ? update.job_error : null;

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
      <Button size="sm" onClick={() => mutation.mutate()} disabled={busy} variant={failed ? "outline" : "default"}>
        {label}
      </Button>
    </li>
  );
}

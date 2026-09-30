import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SiteUpdate } from "../../shared/types";
import { applyUpdate } from "../api";
import { EmptyRow } from "./Section";

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

function UpdateRow(props: { update: SiteUpdate; showSite: boolean }) {
  const { update } = props;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => applyUpdate(update.site_id, update.kind as "plugin" | "theme", update.slug),
    onMutate: () => setError(null),
    onError: (err: Error) => setError(err.message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["site", update.site_id] });
    },
  });

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
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
      </div>
      {update.kind === "core" ? (
        <Button variant="outline" size="sm" asChild>
          <a href={`${update.site_url}/wp-admin/update-core.php`} target="_blank" rel="noreferrer">
            Update in WordPress
          </a>
        </Button>
      ) : (
        <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Updating..." : "Update"}
        </Button>
      )}
    </li>
  );
}

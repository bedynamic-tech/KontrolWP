import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PluginAction } from "../../shared/types";

export type BulkAction = PluginAction | "update";

export type BulkProgress = { done: number; total: number };

const PENDING_LABELS: Record<BulkAction, string> = {
  activate: "Activating...",
  deactivate: "Deactivating...",
  delete: "Deleting...",
  update: "Queueing updates...",
  "enable-auto-update": "Turning on auto-updates...",
  "disable-auto-update": "Turning off auto-updates...",
};

/** A checkbox that can show "some selected". */
export function SelectBox(props: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current)
      ref.current.indeterminate = !!props.indeterminate && !props.checked;
  }, [props.indeterminate, props.checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={props.className ?? "size-4 shrink-0 accent-primary"}
      checked={props.checked}
      onChange={props.onChange}
      aria-label={props.label}
      disabled={props.disabled}
    />
  );
}

/**
 * The actions for the checked plugins, at the top of a plugin list. Each
 * action shows only when it applies to something checked; counts say how
 * many it will change.
 */
export function PluginBulkBar(props: {
  /** How many plugins (or plugin and site pairs) each action would change. */
  counts: Record<BulkAction, number>;
  /** "3 plugins on 2 sites", or null when nothing is checked. */
  selection: string | null;
  allChecked: boolean;
  someChecked: boolean;
  onToggleAll: () => void;
  canSelectAll: boolean;
  onRun: (action: BulkAction) => void;
  pending: BulkAction | null;
  /** How far the running action has got, counted in plugins (or plugin and site pairs). */
  progress?: BulkProgress | null;
  /** Deleting needs confirming; this names what goes. */
  deleteTitle: string;
  error?: string | null;
}) {
  const { counts, pending, progress } = props;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = pending !== null;
  const autoUpdates =
    counts["enable-auto-update"] + counts["disable-auto-update"];
  const show = (
    action: BulkAction,
    label: string,
    variant: "outline" | "default" = "outline",
  ) =>
    counts[action] > 0 && (
      <Button
        size="sm"
        variant={variant}
        disabled={busy}
        loading={pending === action}
        onClick={() => props.onRun(action)}
      >
        {label}
      </Button>
    );

  // Close the confirmation once the delete finishes.
  useEffect(() => {
    if (pending === null) setConfirmDelete(false);
  }, [pending]);

  return (
    <div className="border-b bg-muted/40 px-4 py-2">
      <div className="flex min-h-8 items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            {busy ? (
              <>
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                {PENDING_LABELS[pending]}
                {progress && progress.total > 1 && ` ${progress.done} of ${progress.total} done`}
              </>
            ) : (
              props.selection
            )}
          </span>
          {props.selection && (
            <>
              {show("activate", `Activate (${counts.activate})`)}
              {show("deactivate", `Deactivate (${counts.deactivate})`)}
              {show("update", `Update (${counts.update})`)}
              {autoUpdates > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      loading={pending === "enable-auto-update" || pending === "disable-auto-update"}
                    >
                      Auto-updates <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!counts["enable-auto-update"]}
                      onSelect={() => props.onRun("enable-auto-update")}
                    >
                      Enable ({counts["enable-auto-update"]})
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!counts["disable-auto-update"]}
                      onSelect={() => props.onRun("disable-auto-update")}
                    >
                      Disable ({counts["disable-auto-update"]})
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {counts.delete > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  loading={pending === "delete"}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete ({counts.delete})
                </Button>
              )}
            </>
          )}
        </div>
        {props.canSelectAll && (
          <SelectBox
            className="size-4 shrink-0 accent-primary"
            checked={props.allChecked}
            indeterminate={props.someChecked}
            onChange={props.onToggleAll}
            label="Check every plugin"
            disabled={busy}
          />
        )}
      </div>
      {busy && progress && progress.total > 1 && (
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-label="Progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.max(4, (progress.done / progress.total) * 100)}%` }}
          />
        </div>
      )}
      {props.error && (
        <p className="mt-1 whitespace-pre-line text-xs text-destructive">
          {props.error}
        </p>
      )}

      <Dialog
        open={confirmDelete}
        onOpenChange={(open) => !busy && setConfirmDelete(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.deleteTitle}</DialogTitle>
            <DialogDescription>
              Presser deactivates each one where it is active, then deletes its
              files, as Delete on the Plugins screen does. Their settings may
              stay in the database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => props.onRun("delete")}
              disabled={busy}
              loading={pending === "delete"}
            >
              {pending === "delete" ? (progress && progress.total > 1 ? `Deleting ${progress.done} of ${progress.total}...` : "Deleting...") : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

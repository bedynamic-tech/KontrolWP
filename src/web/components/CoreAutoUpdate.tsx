import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AUTO_UPDATES_SINCE, compareVersions } from "../../shared/plugin-version";
import type { CoreAutoUpdate, SiteSummary } from "../../shared/types";
import { bulkCoreAutoUpdate, setCoreAutoUpdate } from "../api";
import { SitePicker } from "./SitePicker";
import { Spinner } from "./Spinner";

export const CORE_AUTO_UPDATE_LABELS: Record<CoreAutoUpdate, string> = {
  all: "All new versions",
  minor: "Maintenance and security releases only",
  off: "Off",
};

/** Presser Connect 0.7.0+ reports and changes WordPress's auto-update settings. */
export function autoUpdatesSupported(pluginVersion: string | null): boolean {
  return !!pluginVersion && compareVersions(pluginVersion, AUTO_UPDATES_SINCE) >= 0;
}

const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

function ModeSelect(props: { id?: string; value: CoreAutoUpdate | ""; onChange: (mode: CoreAutoUpdate) => void; disabled?: boolean }) {
  return (
    <select
      id={props.id}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value as CoreAutoUpdate)}
      className={SELECT_CLASS}
    >
      {props.value === "" && (
        <option value="" disabled>
          Unknown
        </option>
      )}
      {(Object.keys(CORE_AUTO_UPDATE_LABELS) as CoreAutoUpdate[]).map((mode) => (
        <option key={mode} value={mode}>
          {CORE_AUTO_UPDATE_LABELS[mode]}
        </option>
      ))}
    </select>
  );
}

/** One site's WordPress core auto-updates, for its Updates section. */
export function CoreAutoUpdateRow(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (mode: CoreAutoUpdate) => setCoreAutoUpdate(site.id, mode),
    onSuccess: (updated) => queryClient.setQueryData(["site", site.id], (old: object | undefined) => old && { ...old, site: updated }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["site", site.id] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  const supported = autoUpdatesSupported(site.plugin_version);
  const mode = save.isPending ? save.variables : site.core_auto_update;

  let note: string | null = null;
  if (!supported) note = `Needs Presser Connect ${AUTO_UPDATES_SINCE} or later, which installs itself on the next sync.`;
  else if (site.core_auto_update_locked) note = "Set in this site's wp-config.php, so Presser cannot change it.";
  else if (!site.core_auto_update) note = "Shows after the next sync.";

  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <label htmlFor="core-auto-update" className="text-sm font-medium">
          Automatic WordPress updates
        </label>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        {save.error && <p className="mt-1 text-xs text-destructive">{save.error.message}</p>}
      </div>
      <div className="flex items-center gap-2">
        {save.isPending && <Spinner className="size-4 text-muted-foreground" label="Saving" />}
        <ModeSelect
          id="core-auto-update"
          value={mode ?? ""}
          onChange={(next) => save.mutate(next)}
          disabled={!supported || site.core_auto_update_locked || !site.core_auto_update || save.isPending}
        />
      </div>
    </div>
  );
}

/** Set WordPress core auto-updates on the sites chosen here. */
export function CoreAutoUpdateDialog(props: { sites: SiteSummary[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<CoreAutoUpdate>("minor");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const sites = props.sites.filter((site) => autoUpdatesSupported(site.plugin_version) && !site.core_auto_update_locked);
  const skipped = props.sites.length - sites.length;
  const chosen = sites.filter((site) => selected.has(site.id)).map((site) => site.id);
  const names = new Map(sites.map((site) => [site.id, site.name]));

  const save = useMutation({
    mutationFn: async () => {
      const { results } = await bulkCoreAutoUpdate(chosen, mode);
      const failed = results.filter((result) => !result.ok);
      if (failed.length) {
        setSelected(new Set(failed.map((result) => result.site_id)));
        const done = results.length - failed.length;
        throw new Error(
          [
            ...(done ? [`Changed on ${done} ${done === 1 ? "site" : "sites"}. These failed:`] : []),
            ...failed.map((result) => `${names.get(result.site_id) ?? `Site ${result.site_id}`}: ${result.error}`),
          ].join("\n"),
        );
      }
    },
    onSuccess: () => close(false),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["site"] });
    },
  });

  const close = (open: boolean) => {
    props.onOpenChange(open);
    if (!open) {
      setSelected(new Set());
      save.reset();
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !save.isPending && close(open)}>
      <DialogContent className="sm:max-w-lg [&>*]:min-w-0">
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Automatic WordPress updates</DialogTitle>
            <DialogDescription>
              Sets WordPress's own auto-update setting on each site, as its Updates screen does.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Update WordPress automatically to</span>
            <ModeSelect value={mode} onChange={setMode} />
          </label>
          <SitePicker
            sites={sites}
            loading={false}
            selected={selected}
            onChange={setSelected}
            detail={(site) => (site.core_auto_update ? CORE_AUTO_UPDATE_LABELS[site.core_auto_update] : null)}
          />
          {skipped > 0 && (
            <p className="text-xs text-muted-foreground">
              {skipped === 1 ? "1 site is" : `${skipped} sites are`} not listed: they need Presser Connect{" "}
              {AUTO_UPDATES_SINCE} or set this in wp-config.php.
            </p>
          )}
          {save.error && <p className="whitespace-pre-line text-sm text-destructive">{save.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!chosen.length} loading={save.isPending}>
              {save.isPending ? "Saving..." : "Apply"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { AUTO_UPDATES_SINCE, compareVersions } from "../../shared/plugin-version";
import type { CoreAutoUpdate, SiteSummary } from "../../shared/types";
import { setCoreAutoUpdate } from "../api";
import { Spinner } from "./Spinner";

export const CORE_AUTO_UPDATE_LABELS: Record<CoreAutoUpdate, string> = {
  all: "All new versions",
  minor: "Maintenance and security releases only",
  off: "Off",
};

/** KontrolWP Connect 0.7.0+ reports and changes WordPress's auto-update settings. */
export function autoUpdatesSupported(pluginVersion: string | null): boolean {
  return !!pluginVersion && compareVersions(pluginVersion, AUTO_UPDATES_SINCE) >= 0;
}

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm sm:w-auto outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

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

/** One site's WordPress core auto-updates, for its settings. */
export function CoreAutoUpdateRow(props: { site: SiteSummary; className?: string }) {
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
  if (!supported) note = `Needs KontrolWP Connect ${AUTO_UPDATES_SINCE} or later, which installs itself on the next sync.`;
  else if (site.core_auto_update_locked) note = "Set in this site's wp-config.php, so KontrolWP cannot change it.";
  else if (!site.core_auto_update) note = "Shows after the next sync.";

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", props.className ?? "border-b px-4 py-3")}>
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

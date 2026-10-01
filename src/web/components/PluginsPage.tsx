import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PLUGIN_MANAGEMENT_SINCE } from "../../shared/plugin-version";
import type { FleetPlugin, FleetPlugins } from "../../shared/types";
import { plural } from "../format";
import { applyUpdate, bulkPluginAction, fetchFleetPlugins, fetchOverview, installPluginOnSites } from "../api";
import { autoUpdatesSupported } from "./CoreAutoUpdate";
import { Spinner } from "./Spinner";
import { PluginBulkBar, SelectBox, type BulkAction, type BulkProgress } from "./PluginBulkBar";
import { InstallDialog } from "./PluginsSection";
import { SitePicker } from "./SitePicker";
import { pluginIconSources, RemoteIcon } from "./RemoteIcon";
import { EmptyRow, Section } from "./Section";

const QUERY_KEY = ["fleet-plugins"];

/** Poll quickly while an update is queued or running, so the rows follow along. */
function refetchInterval(data: FleetPlugins | undefined): number {
  const active = data?.plugins.some((plugin) => plugin.job_status === "queued" || plugin.job_status === "running");
  return active ? 3_000 : 60_000;
}

/** One entry per plugin file, with every site that has it. */
function groupPlugins(plugins: FleetPlugin[]): FleetPlugin[][] {
  const groups = new Map<string, FleetPlugin[]>();
  for (const plugin of plugins) groups.set(plugin.file, [...(groups.get(plugin.file) ?? []), plugin]);
  return [...groups.values()].sort((a, b) => a[0].name.localeCompare(b[0].name));
}

/** An update can be queued here: offered, allowed on the site, and not already queued or done. */
function updatable(plugin: FleetPlugin): boolean {
  return (
    !!plugin.new_version &&
    !plugin.protected &&
    !plugin.updates_excluded &&
    (plugin.job_status === null || plugin.job_status === "failed")
  );
}

/** Plugins across every site, as of each site's last sync. */
export function PluginsPage() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const { data, error, isPending } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchFleetPlugins,
    refetchInterval: (query) => refetchInterval(query.state.data),
  });

  const groups = useMemo(() => groupPlugins(data?.plugins ?? []), [data]);
  const query = search.trim().toLowerCase();
  const shown = query
    ? groups.filter((group) =>
        [group[0].name, group[0].file, group[0].author].some((value) => value.toLowerCase().includes(query)),
      )
    : groups;
  const siteCount = new Set(data?.plugins.map((plugin) => plugin.site_id)).size;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Plugins</h1>
        <Button size="sm" onClick={() => setAdding(true)} disabled={!data}>
          <PlusIcon /> Add plugin
        </Button>
      </div>

      {isPending ? (
        <div className="mt-8 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : error ? (
        <p className="mt-6 text-sm text-destructive">{error.message}</p>
      ) : (
        <>
          {data.unsupported_sites.length > 0 && <UnsupportedNote sites={data.unsupported_sites} />}
          <div className="relative mt-6">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plugins"
              aria-label="Search plugins"
              className="pl-8"
            />
          </div>
          <Section title={`${plural(groups.length, "plugin")} across ${plural(siteCount, "site")}`}>
            {!groups.length ? (
              <EmptyRow>No plugins yet. Each site's plugins show here after it syncs.</EmptyRow>
            ) : !shown.length ? (
              <EmptyRow>No plugins match "{search.trim()}".</EmptyRow>
            ) : (
              <FleetPluginList plugins={data.plugins} groups={shown} />
            )}
          </Section>
        </>
      )}

      {data && <FleetInstallDialog open={adding} onOpenChange={setAdding} unsupported={data.unsupported_sites} />}
    </div>
  );
}

function UnsupportedNote(props: { sites: FleetPlugins["unsupported_sites"] }) {
  const names = props.sites.map((site) => site.name);
  return (
    <p className="mt-6 rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground">
      {names.length === 1 ? `${names[0]} is` : `${names.length} sites are`} not listed here yet. Managing plugins needs
      KontrolWP Connect {PLUGIN_MANAGEMENT_SINCE} or later, which installs itself on the next sync.
      {names.length > 1 && <span className="mt-1 block text-xs">{names.join(", ")}</span>}
    </p>
  );
}

const keyOf = (plugin: FleetPlugin) => `${plugin.site_id}|${plugin.file}`;

function autoUpdatable(plugin: FleetPlugin): boolean {
  return autoUpdatesSupported(plugin.site_plugin_version) && plugin.site_plugin_auto_updates;
}

/** Which checked plugins each action would change; KontrolWP Connect is never checked. */
const TARGETS: Record<BulkAction, (plugin: FleetPlugin) => boolean> = {
  activate: (plugin) => !plugin.active,
  deactivate: (plugin) => plugin.active,
  update: updatable,
  "enable-auto-update": (plugin) => autoUpdatable(plugin) && !plugin.auto_update,
  "disable-auto-update": (plugin) => autoUpdatable(plugin) && plugin.auto_update,
  delete: () => true,
};

/** The fleet's plugins with checkboxes, and one action bar for everything checked. */
function FleetPluginList(props: { plugins: FleetPlugin[]; groups: FleetPlugin[][] }) {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState<BulkProgress | null>(null);

  // Checked rows that still exist (a sync may have removed some).
  const selected = props.plugins.filter((plugin) => !plugin.protected && checked.has(keyOf(plugin)));
  const counts = Object.fromEntries(
    (Object.keys(TARGETS) as BulkAction[]).map((action) => [action, selected.filter(TARGETS[action]).length]),
  ) as Record<BulkAction, number>;
  const selectable = props.groups.flat().filter((plugin) => !plugin.protected);
  const allChecked = selectable.length > 0 && selectable.every((plugin) => checked.has(keyOf(plugin)));

  const toggle = (plugins: FleetPlugin[], on: boolean) => {
    const next = new Set(checked);
    for (const plugin of plugins) if (!plugin.protected) on ? next.add(keyOf(plugin)) : next.delete(keyOf(plugin));
    setChecked(next);
  };

  const action = useMutation({
    mutationFn: async (next: BulkAction): Promise<{ key: string; ok: boolean; error?: string }[]> => {
      const targets = selected.filter(TARGETS[next]);
      let done = 0;
      const advance = (count: number) => {
        done += count;
        setProgress({ done, total: targets.length });
      };
      setProgress({ done: 0, total: targets.length });
      if (next === "update") {
        // Updates go through each site's update queue, as on the Overview.
        return Promise.all(
          targets.map((plugin) =>
            applyUpdate(plugin.site_id, { kind: "plugin", slug: plugin.file, new_version: plugin.new_version! })
              .then(
                () => ({ key: keyOf(plugin), ok: true }),
                (err: Error) => ({ key: keyOf(plugin), ok: false, error: err.message }),
              )
              .finally(() => advance(1)),
          ),
        );
      }
      // One request per plugin; each works through its sites a few at a time.
      const byFile = new Map<string, FleetPlugin[]>();
      for (const plugin of targets) byFile.set(plugin.file, [...(byFile.get(plugin.file) ?? []), plugin]);
      const results: { key: string; ok: boolean; error?: string }[] = [];
      for (const [file, plugins] of byFile) {
        try {
          const { results: bySite } = await bulkPluginAction(file, next, plugins.map((plugin) => plugin.site_id));
          for (const result of bySite) results.push({ key: `${result.site_id}|${file}`, ok: result.ok, error: result.error });
        } catch (err) {
          for (const plugin of plugins) results.push({ key: keyOf(plugin), ok: false, error: (err as Error).message });
        }
        advance(plugins.length);
      }
      return results;
    },
    onMutate: () => setErrors(new Map()),
    onSuccess: (results) => {
      const failed = results.filter((result) => !result.ok);
      setErrors(new Map(failed.map((result) => [result.key, result.error ?? "Failed"])));
      // Keep only what failed checked, so trying again is one click.
      setChecked(new Set(failed.map((result) => result.key)));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["site"] });
    },
  });

  const files = new Set(selected.map((plugin) => plugin.file)).size;
  const sites = new Set(selected.map((plugin) => plugin.site_id)).size;
  const failedCount = errors.size;

  return (
    <>
      <PluginBulkBar
        counts={counts}
        selection={selected.length ? `${plural(files, "plugin")} on ${plural(sites, "site")} checked` : null}
        allChecked={allChecked}
        someChecked={selected.length > 0}
        canSelectAll={selectable.length > 0}
        onToggleAll={() => toggle(selectable, !allChecked)}
        onRun={(next) => action.mutate(next)}
        pending={action.isPending ? action.variables : null}
        progress={action.isPending ? progress : null}
        deleteTitle={`Delete ${plural(files, "plugin")} from ${plural(sites, "site")}?`}
        error={
          action.error?.message ??
          (failedCount ? `${plural(failedCount, "change")} failed. Those plugins stay checked; see each site below.` : null)
        }
      />
      <ul className="divide-y">
        {props.groups.map((group) => (
          <PluginGroup key={group[0].file} plugins={group} checked={checked} errors={errors} onToggle={toggle} />
        ))}
      </ul>
    </>
  );
}

function PluginGroup(props: {
  plugins: FleetPlugin[];
  checked: Set<string>;
  errors: Map<string, string>;
  onToggle: (plugins: FleetPlugin[], on: boolean) => void;
}) {
  const { plugins, checked, errors } = props;
  const first = plugins[0];
  const [open, setOpen] = useState(false);
  const hasErrors = plugins.some((plugin) => errors.has(keyOf(plugin)));
  const expanded = open || hasErrors;

  const isProtected = first.protected;
  const updates = plugins.filter(updatable);
  const active = plugins.filter((plugin) => plugin.active).length;
  const versions = [...new Set(plugins.map((plugin) => plugin.version).filter(Boolean))];
  const failedJobs = plugins.filter((plugin) => plugin.job_status === "failed").length;
  const autoUpdating = plugins.filter((plugin) => plugin.auto_update).length;
  const busyJobs = plugins.filter((plugin) => plugin.job_status === "queued" || plugin.job_status === "running").length;
  const checkedCount = plugins.filter((plugin) => checked.has(keyOf(plugin))).length;
  const all = checkedCount === plugins.length;

  return (
    <li>
      <div className="flex items-start gap-3 px-4 py-3 sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <RemoteIcon
            sources={isProtected ? ["/kontrolwp.svg"] : pluginIconSources(first.file, plugins.find((p) => p.icon_url)?.icon_url)}
            name={first.name}
            className="size-9 text-sm"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{first.name}</span>
              {updates.length > 0 && <Badge variant="secondary">Update available</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setOpen(!expanded)}
                aria-expanded={expanded}
                className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline"
              >
                {plural(plugins.length, "site")}
                <ChevronDownIcon className={cn("size-3 transition-transform", expanded && "rotate-180")} />
              </button>
              {` · ${active} active`}
              {versions.length > 0 && ` · ${versions.length === 1 ? "Version" : "Versions"} ${versions.join(", ")}`}
              {first.author && ` · ${first.author}`}
              {autoUpdating > 0 && ` · ${autoUpdating} auto-updating`}
              {busyJobs > 0 && (
                <>
                  {" · "}
                  <Spinner className="inline size-3 align-[-2px]" /> {busyJobs} updating
                </>
              )}
              {failedJobs > 0 && <span className="text-destructive">{` · ${failedJobs} failed`}</span>}
              {isProtected && " · Connects each site to KontrolWP"}
              {!isProtected && checkedCount > 0 && !all && ` · ${checkedCount} of ${plugins.length} sites checked`}
            </p>
          </div>
        </div>
        {!isProtected && (
          <SelectBox
            className="mt-1 size-4 shrink-0 accent-primary sm:mt-0"
            checked={all}
            indeterminate={checkedCount > 0}
            onChange={() => props.onToggle(plugins, !all)}
            label={`Check ${first.name} on every site`}
          />
        )}
      </div>

      {expanded && (
        <ul className="divide-y border-t bg-muted/30">
          {plugins.map((plugin) => (
            <SiteRow
              key={plugin.site_id}
              plugin={plugin}
              checked={checked.has(keyOf(plugin))}
              onToggle={() => props.onToggle([plugin], !checked.has(keyOf(plugin)))}
              error={errors.get(keyOf(plugin)) ?? null}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const JOB_LABELS = { queued: "Update queued", running: "Updating...", done: "Updated", failed: "Update failed" } as const;

function SiteRow(props: { plugin: FleetPlugin; checked: boolean; onToggle: () => void; error: string | null }) {
  const { plugin } = props;
  const update = plugin.new_version && !plugin.protected;
  return (
    <li className="flex items-start gap-3 py-2.5 pr-4 pl-4 sm:pl-16">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/sites/${plugin.site_id}`} className="truncate text-sm hover:underline">
            {plugin.site_name}
          </Link>
          {plugin.active ? (
            <Badge variant="secondary">{plugin.network_active ? "Network active" : "Active"}</Badge>
          ) : (
            <Badge variant="outline">Inactive</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {plugin.version ? `Version ${plugin.version}` : "No version"}
          {update && ` · ${plugin.new_version} available`}
          {update && plugin.updates_excluded && " · Excluded from updates"}
          {plugin.job_status && (
            <>
              {" · "}
              {(plugin.job_status === "queued" || plugin.job_status === "running") && (
                <Spinner className="mr-1 inline size-3 align-[-2px]" />
              )}
              {JOB_LABELS[plugin.job_status]}
            </>
          )}
          {!plugin.protected && autoUpdatesSupported(plugin.site_plugin_version) && (
            plugin.site_plugin_auto_updates
              ? ` · Auto-updates ${plugin.auto_update ? "on" : "off"}`
              : " · Auto-updates turned off in code"
          )}
        </p>
        {plugin.job_status === "failed" && plugin.job_error && (
          <p className="mt-1 text-xs text-destructive">{plugin.job_error}</p>
        )}
        {props.error && <p className="mt-1 text-xs text-destructive">{props.error}</p>}
      </div>
      {!plugin.protected && (
        <SelectBox
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={props.checked}
          onChange={props.onToggle}
          label={`Check ${plugin.name} on ${plugin.site_name}`}
        />
      )}
    </li>
  );
}

/** Install one plugin on the sites chosen here. */
function FleetInstallDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unsupported: FleetPlugins["unsupported_sites"];
}) {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview, enabled: props.open });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const unsupported = new Set(props.unsupported.map((site) => site.id));
  const sites = (overview.data?.sites ?? []).filter((site) => site.kind === "wordpress" && !unsupported.has(site.id));
  const names = new Map<number, string>(sites.map((site) => [site.id, site.name]));
  const chosen = sites.filter((site) => selected.has(site.id)).map((site) => site.id);

  const onOpenChange = (open: boolean) => {
    props.onOpenChange(open);
    if (!open) setSelected(new Set());
  };

  return (
    <InstallDialog
      title="Add a plugin"
      open={props.open}
      onOpenChange={onOpenChange}
      canSubmit={chosen.length > 0}
      install={async (request) => {
        const { results } = await installPluginOnSites(chosen, request);
        const failed = results.filter((result) => !result.ok);
        if (failed.length) {
          // Leave only the sites that failed chosen, so Install tries just those again.
          setSelected(new Set(failed.map((result) => result.site_id)));
          const done = results.length - failed.length;
          throw new Error(
            [
              ...(done ? [`Installed on ${done} ${done === 1 ? "site" : "sites"}. These failed:`] : []),
              ...failed.map((result) => `${names.get(result.site_id) ?? `Site ${result.site_id}`}: ${result.error}`),
            ].join("\n"),
          );
        }
      }}
      onSettled={() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ["overview"] });
      }}
    >
      <SitePicker
        sites={sites}
        loading={overview.isPending}
        selected={selected}
        onChange={setSelected}
      />
    </InstallDialog>
  );
}

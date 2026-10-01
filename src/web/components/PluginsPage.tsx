import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PLUGIN_MANAGEMENT_SINCE } from "../../shared/plugin-version";
import type { BulkPluginResult, FleetPlugin, FleetPlugins, PluginAction, SiteSummary } from "../../shared/types";
import { applyUpdate, bulkPluginAction, fetchFleetPlugins, fetchOverview, installPluginOnSites } from "../api";
import { InstallDialog } from "./PluginsSection";
import { RemoteIcon } from "./RemoteIcon";
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
          <Section title={`${groups.length} plugins across ${siteCount} ${siteCount === 1 ? "site" : "sites"}`}>
            {!groups.length ? (
              <EmptyRow>No plugins yet. Each site's plugins show here after it syncs.</EmptyRow>
            ) : !shown.length ? (
              <EmptyRow>No plugins match "{search.trim()}".</EmptyRow>
            ) : (
              <ul className="divide-y">
                {shown.map((group) => (
                  <PluginGroup key={group[0].file} plugins={group} />
                ))}
              </ul>
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
      Presser Connect {PLUGIN_MANAGEMENT_SINCE} or later, which installs itself on the next sync.
      {names.length > 1 && <span className="mt-1 block text-xs">{names.join(", ")}</span>}
    </p>
  );
}

const PENDING_LABELS: Record<PluginAction | "update", string> = {
  activate: "Activating...",
  deactivate: "Deactivating...",
  delete: "Deleting...",
  update: "Queueing updates...",
};

function PluginGroup(props: { plugins: FleetPlugin[] }) {
  const { plugins } = props;
  const first = plugins[0];
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isProtected = first.protected;
  const chosen = plugins.filter((plugin) => selected.has(plugin.site_id));
  const updates = plugins.filter(updatable);

  const action = useMutation({
    mutationFn: async (next: PluginAction | "update"): Promise<BulkPluginResult[]> => {
      if (next !== "update") {
        return (await bulkPluginAction(first.file, next, chosen.map((plugin) => plugin.site_id))).results;
      }
      // Updates go through each site's update queue, as on the Overview.
      const targets = (chosen.length ? chosen : plugins).filter(updatable);
      return Promise.all(
        targets.map((plugin) =>
          applyUpdate(plugin.site_id, { kind: "plugin", slug: plugin.file, new_version: plugin.new_version! }).then(
            () => ({ site_id: plugin.site_id, ok: true }),
            (err: Error) => ({ site_id: plugin.site_id, ok: false, error: err.message }),
          ),
        ),
      );
    },
    onMutate: () => setErrors(new Map()),
    onSuccess: (results, next) => {
      setErrors(new Map(results.filter((result) => !result.ok).map((result) => [result.site_id, result.error ?? "Failed"])));
      if (next === "delete") setConfirmDelete(false);
      // Keep only the sites that failed selected, so trying again is one click.
      setSelected(new Set(results.filter((result) => !result.ok).map((result) => result.site_id)));
      if (results.some((result) => !result.ok)) setOpen(true);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      for (const plugin of plugins) queryClient.invalidateQueries({ queryKey: ["site", plugin.site_id] });
    },
  });

  const active = plugins.filter((plugin) => plugin.active).length;
  const versions = [...new Set(plugins.map((plugin) => plugin.version).filter(Boolean))];
  const failedJobs = plugins.filter((plugin) => plugin.job_status === "failed").length;
  const busyJobs = plugins.filter((plugin) => plugin.job_status === "queued" || plugin.job_status === "running").length;
  const allSelected = plugins.length > 0 && chosen.length === plugins.length;
  const toggle = (siteId: number) => {
    const next = new Set(selected);
    if (next.has(siteId)) next.delete(siteId);
    else next.add(siteId);
    setSelected(next);
  };
  const run = (next: PluginAction | "update") => action.mutate(next);

  return (
    <li>
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <RemoteIcon sources={[first.icon_url]} name={first.name} className="size-9 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{first.name}</span>
              {updates.length > 0 && <Badge variant="secondary">Update available</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline"
              >
                {plugins.length === 1 ? "1 site" : `${plugins.length} sites`}
                <ChevronDownIcon className={cn("size-3 transition-transform", open && "rotate-180")} />
              </button>
              {` · ${active} active`}
              {versions.length > 0 && ` · ${versions.length === 1 ? "Version" : "Versions"} ${versions.join(", ")}`}
              {first.author && ` · ${first.author}`}
              {busyJobs > 0 && ` · ${busyJobs} updating`}
              {failedJobs > 0 && <span className="text-destructive">{` · ${failedJobs} failed`}</span>}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {action.isPending && <span className="text-xs text-muted-foreground">{PENDING_LABELS[action.variables]}</span>}
          {isProtected ? (
            <span className="text-xs text-muted-foreground">Connects each site to Presser</span>
          ) : (
            updates.length > 0 &&
            !open && (
              <Button size="sm" onClick={() => run("update")} disabled={action.isPending}>
                Update
              </Button>
            )
          )}
        </div>
      </div>

      {open && (
        <div className="border-t bg-muted/30">
          {!isProtected && (
            <div className="flex flex-wrap items-center gap-2 py-2 pr-4 pl-4 sm:pl-16">
              <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(plugins.map((plugin) => plugin.site_id)))}
                  aria-label="Select every site"
                />
                {chosen.length ? `${chosen.length} selected` : "Select sites"}
              </label>
              <Button size="sm" variant="outline" disabled={!chosen.length || action.isPending} onClick={() => run("activate")}>
                Activate
              </Button>
              <Button size="sm" variant="outline" disabled={!chosen.length || action.isPending} onClick={() => run("deactivate")}>
                Deactivate
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!chosen.some(updatable) || action.isPending}
                onClick={() => run("update")}
              >
                Update
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={!chosen.length || action.isPending}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </div>
          )}
          <ul className="divide-y border-t">
            {plugins.map((plugin) => (
              <SiteRow
                key={plugin.site_id}
                plugin={plugin}
                selectable={!isProtected}
                selected={selected.has(plugin.site_id)}
                onToggle={() => toggle(plugin.site_id)}
                error={errors.get(plugin.site_id) ?? null}
              />
            ))}
          </ul>
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={(next) => !action.isPending && setConfirmDelete(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {first.name} from {chosen.length === 1 ? chosen[0].site_name : `${chosen.length} sites`}?
            </DialogTitle>
            <DialogDescription>
              Presser deactivates it where it is active, then deletes its files, as Delete on the Plugins screen does.
              Its settings may stay in each site's database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={action.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => run("delete")} disabled={action.isPending}>
              {action.isPending ? "Deleting..." : "Delete plugin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

const JOB_LABELS = { queued: "Update queued", running: "Updating...", done: "Updated", failed: "Update failed" } as const;

function SiteRow(props: {
  plugin: FleetPlugin;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  error: string | null;
}) {
  const { plugin } = props;
  const update = plugin.new_version && !plugin.protected;
  return (
    <li className="flex items-start gap-3 py-2.5 pr-4 pl-4 sm:pl-16">
      {props.selectable && (
        <input
          type="checkbox"
          className="mt-1"
          checked={props.selected}
          onChange={props.onToggle}
          aria-label={`Select ${plugin.site_name}`}
        />
      )}
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
          {plugin.job_status && ` · ${JOB_LABELS[plugin.job_status]}`}
        </p>
        {plugin.job_status === "failed" && plugin.job_error && (
          <p className="mt-1 text-xs text-destructive">{plugin.job_error}</p>
        )}
        {props.error && <p className="mt-1 text-xs text-destructive">{props.error}</p>}
      </div>
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
  const sites = (overview.data?.sites ?? []).filter((site) => !unsupported.has(site.id));
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

function SitePicker(props: {
  sites: SiteSummary[];
  loading: boolean;
  selected: Set<number>;
  onChange: (selected: Set<number>) => void;
}) {
  const { sites, selected } = props;
  const all = sites.length > 0 && sites.every((site) => selected.has(site.id));
  return (
    <fieldset className="space-y-1.5">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium">Sites</legend>
        {sites.length > 1 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => props.onChange(all ? new Set() : new Set(sites.map((site) => site.id)))}
          >
            {all ? "Clear" : "Select all"}
          </button>
        )}
      </div>
      {props.loading ? (
        <p className="text-sm text-muted-foreground">Loading sites...</p>
      ) : !sites.length ? (
        <p className="text-sm text-muted-foreground">No sites can install plugins from Presser yet.</p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border px-3 py-2">
          {sites.map((site) => (
            <label key={site.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(site.id)}
                onChange={() => {
                  const next = new Set(selected);
                  if (next.has(site.id)) next.delete(site.id);
                  else next.add(site.id);
                  props.onChange(next);
                }}
              />
              <span className="truncate">{site.name}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { compareVersions, PLUGIN_MANAGEMENT_SINCE } from "../../shared/plugin-version";
import type { InstalledPlugin, SiteSummary, SiteUpdate } from "../../shared/types";
import { applyUpdate, fetchPlugins, installPlugin, managePlugin, type PluginInstall } from "../api";
import { PluginBulkBar, SelectBox, type BulkAction, type BulkProgress } from "./PluginBulkBar";
import { HelpTip } from "./HelpTip";
import { Spinner } from "./Spinner";
import { pluginIconSources, RemoteIcon } from "./RemoteIcon";
import { EmptyRow, Section } from "./Section";
import { SiteScheduleFields, SiteScheduleSelect, useSitePluginSchedule } from "./UpdatePolicy";

function supported(site: SiteSummary): boolean {
  return !site.plugin_version || compareVersions(site.plugin_version, PLUGIN_MANAGEMENT_SINCE) >= 0;
}

/** The site's installed plugins, read live from the site. */
export function PluginsSection(props: { site: SiteSummary; updates: SiteUpdate[] }) {
  const { site } = props;
  const [installing, setInstalling] = useState(false);
  const plugins = useQuery({
    queryKey: ["site", site.id, "plugins"],
    queryFn: () => fetchPlugins(site.id),
    enabled: supported(site),
    refetchInterval: false,
  });
  const canModify = plugins.data?.can_modify_files ?? false;

  let body;
  if (!supported(site)) {
    body = (
      <EmptyRow>
        Managing plugins needs KontrolWP Connect {PLUGIN_MANAGEMENT_SINCE} or later. This site runs {site.plugin_version};
        it updates automatically.
      </EmptyRow>
    );
  } else if (plugins.isPending) {
    body = <EmptyRow>Loading plugins...</EmptyRow>;
  } else if (plugins.error) {
    body = <p className="px-4 py-6 text-center text-sm text-destructive">{plugins.error.message}</p>;
  } else if (!plugins.data.plugins.length) {
    body = <EmptyRow>No plugins are installed.</EmptyRow>;
  } else {
    body = (
      <SitePluginList
        siteId={site.id}
        plugins={plugins.data.plugins}
        canModify={canModify}
        autoUpdates={plugins.data.auto_updates}
        updates={props.updates}
        showSchedule={!site.updates_excluded}
      />
    );
  }

  return (
    <Section
      title={plugins.data ? `Plugins (${plugins.data.plugins.length})` : "Plugins"}
      action={
        plugins.data && (
          <Button
            size="sm"
            variant="outline"
            aria-label="Add plugin"
            onClick={() => setInstalling(true)}
            disabled={!canModify}
            title={canModify ? undefined : "File changes are disabled on this site (DISALLOW_FILE_MODS)"}
          >
            <PlusIcon /> Add
          </Button>
        )
      }
    >
      {body}
      <SiteInstallDialog site={site} open={installing} onOpenChange={setInstalling} />
    </Section>
  );
}

type Result = { file: string; ok: boolean; error?: string };

/** The site's plugins, with checkboxes after Select and one action bar for everything checked. */
function SitePluginList(props: {
  siteId: number;
  plugins: InstalledPlugin[];
  canModify: boolean;
  /** Undefined before KontrolWP Connect 0.7.0; false when the site turns plugin auto-updates off in code. */
  autoUpdates: boolean | undefined;
  updates: SiteUpdate[];
  /** Update checks are on, so each plugin gets a scheduled updates switch. */
  showSchedule: boolean;
}) {
  const { siteId } = props;
  const queryClient = useQueryClient();
  const schedule = useSitePluginSchedule(siteId);
  const [scheduleErrors, setScheduleErrors] = useState<Map<string, string>>(new Map());
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const stopSelecting = () => {
    setSelecting(false);
    setChecked(new Set());
    setErrors(new Map());
  };

  const offers = new Map(
    props.updates
      .filter((update) => update.kind === "plugin" && (update.job_status === null || update.job_status === "failed"))
      .map((update) => [update.slug, update]),
  );
  const autoUpdatable = (plugin: InstalledPlugin) => !!props.autoUpdates && plugin.auto_update !== undefined;
  const targets: Record<BulkAction, (plugin: InstalledPlugin) => boolean> = {
    activate: (plugin) => !plugin.active,
    deactivate: (plugin) => plugin.active,
    update: (plugin) => offers.has(plugin.file),
    "enable-auto-update": (plugin) => autoUpdatable(plugin) && !plugin.auto_update,
    "disable-auto-update": (plugin) => autoUpdatable(plugin) && !!plugin.auto_update,
    delete: () => props.canModify,
  };
  const selectable = props.plugins.filter((plugin) => !plugin.protected);
  const selected = selectable.filter((plugin) => checked.has(plugin.file));
  const counts = Object.fromEntries(
    (Object.keys(targets) as BulkAction[]).map((action) => [action, selected.filter(targets[action]).length]),
  ) as Record<BulkAction, number>;
  const allChecked = selectable.length > 0 && selected.length === selectable.length;

  const action = useMutation({
    mutationFn: async (next: BulkAction): Promise<Result[]> => {
      const results: Result[] = [];
      const chosen = selected.filter(targets[next]);
      setProgress({ done: 0, total: chosen.length });
      // One at a time: WordPress changes plugins one request after another.
      for (const plugin of chosen) {
        setWorking(plugin.file);
        try {
          if (next === "update") await applyUpdate(siteId, offers.get(plugin.file)!);
          else await managePlugin(siteId, plugin.file, next);
          results.push({ file: plugin.file, ok: true });
        } catch (err) {
          results.push({ file: plugin.file, ok: false, error: (err as Error).message });
        }
        setProgress({ done: results.length, total: chosen.length });
      }
      return results;
    },
    onMutate: () => setErrors(new Map()),
    onSuccess: (results) => {
      const failed = results.filter((result) => !result.ok);
      setErrors(new Map(failed.map((result) => [result.file, result.error ?? "Failed"])));
      setChecked(new Set(failed.map((result) => result.file)));
      if (!failed.length) setSelecting(false);
    },
    onSettled: () => {
      setWorking(null);
      queryClient.invalidateQueries({ queryKey: ["site", siteId] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["fleet-plugins"] });
    },
  });

  // Scheduled updates replace WordPress's own auto-updates, so turning one on turns the other off.
  const setScheduled = async (plugin: InstalledPlugin, on: boolean) => {
    const next = new Map(scheduleErrors);
    next.delete(plugin.file);
    setScheduleErrors(next);
    try {
      await schedule.set({ file: plugin.file, on });
      if (on && autoUpdatable(plugin) && plugin.auto_update) {
        await managePlugin(siteId, plugin.file, "disable-auto-update");
        await queryClient.invalidateQueries({ queryKey: ["site", siteId, "plugins"] });
      }
    } catch (err) {
      setScheduleErrors((errs) => new Map(errs).set(plugin.file, (err as Error).message));
    }
  };

  const toggle = (file: string) => {
    const next = new Set(checked);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    setChecked(next);
  };

  return (
    <>
      <PluginBulkBar
        selecting={selecting}
        onSelect={() => setSelecting(true)}
        onCancel={stopSelecting}
        counts={counts}
        selection={selected.length ? `${selected.length} ${selected.length === 1 ? "plugin" : "plugins"} checked` : null}
        allChecked={allChecked}
        someChecked={selected.length > 0}
        canSelectAll={selectable.length > 0}
        onToggleAll={() => setChecked(allChecked ? new Set() : new Set(selectable.map((plugin) => plugin.file)))}
        onRun={(next) => action.mutate(next)}
        pending={action.isPending ? action.variables : null}
        progress={action.isPending ? progress : null}
        start={props.showSchedule && <SiteScheduleSelect siteId={siteId} />}
        below={props.showSchedule && <SiteScheduleFields siteId={siteId} />}
        deleteTitle={selected.length === 1 ? `Delete ${selected[0].name}?` : `Delete ${selected.length} plugins?`}
        error={
          action.error?.message ??
          (errors.size ? `${errors.size} ${errors.size === 1 ? "change" : "changes"} failed. Those plugins stay checked.` : null)
        }
      />
      <ul className="divide-y">
        {props.plugins.map((plugin) => (
          <PluginRow
            key={plugin.file}
            plugin={plugin}
            autoUpdates={props.autoUpdates}
            update={offers.get(plugin.file) ?? props.updates.find((u) => u.kind === "plugin" && u.slug === plugin.file) ?? null}
            selecting={selecting}
            checked={checked.has(plugin.file)}
            onToggle={() => toggle(plugin.file)}
            error={errors.get(plugin.file) ?? scheduleErrors.get(plugin.file) ?? null}
            working={action.isPending && working === plugin.file}
            schedule={
              props.showSchedule && !plugin.protected
                ? {
                    on: schedule.pending?.file === plugin.file ? schedule.pending.on : schedule.included(plugin.file),
                    disabled: !schedule.active || schedule.lockedOut(plugin.file) || schedule.pending !== null,
                    reason: !schedule.active
                      ? "This site has no schedule that updates plugins. Choose one in the bar above the list."
                      : schedule.lockedOut(plugin.file)
                        ? "Left out of scheduled updates on every site, in Settings."
                        : null,
                    onChange: (on) => setScheduled(plugin, on),
                  }
                : null
            }
          />
        ))}
      </ul>
    </>
  );
}

function PluginRow(props: {
  plugin: InstalledPlugin;
  autoUpdates: boolean | undefined;
  update: SiteUpdate | null;
  /** Select was pressed, so each row shows its checkbox. */
  selecting: boolean;
  checked: boolean;
  onToggle: () => void;
  error: string | null;
  /** A bulk action is changing this plugin right now. */
  working: boolean;
  /** The scheduled updates switch; null hides it. */
  schedule: { on: boolean; disabled: boolean; reason: string | null; onChange: (on: boolean) => void } | null;
}) {
  const { plugin, update } = props;
  const jobActive = update?.job_status === "queued" || update?.job_status === "running";
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:items-center">
      {props.selecting && (
        <span className="mt-2.5 flex size-4 shrink-0 items-center justify-center sm:mt-0">
          {props.working ? (
            <Spinner className="size-4 text-muted-foreground" label={`Changing ${plugin.name}`} />
          ) : (
            !plugin.protected && (
              <SelectBox checked={props.checked} onChange={props.onToggle} label={`Check ${plugin.name}`} />
            )
          )}
        </span>
      )}
      {/* Inactive plugins are dimmed rather than labelled. */}
      <div className={cn("flex min-w-0 flex-1 items-start gap-3 sm:items-center", !plugin.active && "opacity-60")}>
        <RemoteIcon
          sources={plugin.protected ? ["/kontrolwp.svg"] : pluginIconSources(plugin.file, plugin.icon_url)}
          name={plugin.name}
          className="size-9 text-sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">
              {plugin.name}
              {!plugin.active && <span className="sr-only"> (inactive)</span>}
            </p>
            {update && !plugin.protected && <Badge variant="secondary">Update to {update.new_version}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {[plugin.version && `Version ${plugin.version}`, plugin.author, plugin.network_active && "Network active"]
              .filter(Boolean)
              .join(" · ")}
            {!plugin.protected && props.autoUpdates === false && " · Auto-updates turned off in code"}
            {!plugin.protected && props.autoUpdates && plugin.auto_update !== undefined &&
              ` · Auto-updates ${plugin.auto_update ? "on" : "off"}`}
            {update?.job_status === "done" && " · Updated"}
          </p>
          {jobActive && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              {update.job_status === "running" ? `Updating to ${update.new_version}...` : `Update to ${update.new_version} queued`}
            </p>
          )}
          {update?.job_status === "failed" && update.job_error && (
            <p className="mt-1 text-xs text-destructive">{update.job_error}</p>
          )}
          {props.error && <p className="mt-1 text-xs text-destructive">{props.error}</p>}
        </div>
      </div>
      {props.schedule && (
        <label
          className="mt-0.5 flex shrink-0 items-center gap-2 text-xs text-muted-foreground sm:mt-0"
          title={props.schedule.reason ?? undefined}
        >
          <span className="hidden sm:inline">Scheduled updates</span>
          <Switch
            aria-label={`Scheduled updates for ${plugin.name}`}
            checked={props.schedule.on}
            disabled={props.schedule.disabled}
            onCheckedChange={props.schedule.onChange}
          />
        </label>
      )}
    </li>
  );
}

type Source = PluginInstall["source"];

function SiteInstallDialog(props: { site: SiteSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { site } = props;
  const queryClient = useQueryClient();
  return (
    <InstallDialog
      title={`Add a plugin to ${site.name}`}
      open={props.open}
      onOpenChange={props.onOpenChange}
      install={(request) => installPlugin(site.id, request)}
      onSettled={() => queryClient.invalidateQueries({ queryKey: ["site", site.id, "plugins"] })}
    />
  );
}

/**
 * Choose a plugin from WordPress.org, a link or a zip. The fleet page adds a
 * site picker as children; install throws to keep the dialog open with its
 * message.
 */
export function InstallDialog(props: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  install: (request: PluginInstall) => Promise<unknown>;
  onSettled: () => void;
  children?: ReactNode;
  canSubmit?: boolean;
}) {
  const [source, setSource] = useState<Source>("wordpress.org");
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [activate, setActivate] = useState(true);

  const install = useMutation({
    mutationFn: props.install,
    onSuccess: () => close(false),
    onSettled: props.onSettled,
  });

  const close = (open: boolean) => {
    props.onOpenChange(open);
    if (!open) {
      setSlug("");
      setUrl("");
      setFile(null);
      install.reset();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (source === "wordpress.org") install.mutate({ source, slug: slugFrom(slug), activate });
    else if (source === "url") install.mutate({ source, url: url.trim(), activate });
    else if (file) install.mutate({ source, file, activate });
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !install.isPending && close(open)}>
      <DialogContent className="sm:max-w-lg [&>*]:min-w-0">
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>WordPress installs it the same way the Add Plugins screen does.</DialogDescription>
          </DialogHeader>
          <Tabs value={source} onValueChange={(value) => setSource(value as Source)}>
            <TabsList className="w-full">
              <TabsTrigger value="wordpress.org">WordPress.org</TabsTrigger>
              <TabsTrigger value="url">Link</TabsTrigger>
              <TabsTrigger value="zip">Upload zip</TabsTrigger>
            </TabsList>
            <TabsContent value="wordpress.org" className="pt-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="plugin-slug" className="text-sm font-medium">
                    Plugin slug or WordPress.org link
                  </label>
                  <HelpTip>
                    The slug is the last part of the plugin's address, such as wordpress.org/plugins/akismet.
                  </HelpTip>
                </div>
                <Input
                  id="plugin-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="akismet"
                  required={source === "wordpress.org"}
                  autoComplete="off"
                />
              </div>
            </TabsContent>
            <TabsContent value="url" className="pt-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="plugin-url" className="text-sm font-medium">
                    Link to a plugin zip
                  </label>
                  <HelpTip>Each site downloads it directly.</HelpTip>
                </div>
                <Input
                  id="plugin-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/my-plugin.zip"
                  inputMode="url"
                  type="url"
                  required={source === "url"}
                />
              </div>
            </TabsContent>
            <TabsContent value="zip" className="pt-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Plugin zip, up to 10 MB</span>
                <Input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required={source === "zip"}
                />
              </label>
            </TabsContent>
          </Tabs>
          {props.children}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
            Activate after installing
          </label>
          {install.error && <p className="whitespace-pre-line text-sm text-destructive">{install.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={install.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={props.canSubmit === false} loading={install.isPending}>
              {install.isPending ? "Installing..." : "Install"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Accept a slug or a wordpress.org/plugins/<slug> link. */
function slugFrom(value: string): string {
  const match = value.trim().match(/wordpress\.org\/plugins\/([a-z0-9-]+)/i);
  return (match ? match[1] : value.trim()).toLowerCase();
}

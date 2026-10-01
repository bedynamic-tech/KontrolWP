import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { compareVersions, PLUGIN_MANAGEMENT_SINCE } from "../../shared/plugin-version";
import type { InstalledPlugin, PluginAction, SiteSummary } from "../../shared/types";
import { fetchPlugins, installPlugin, managePlugin, type PluginInstall } from "../api";
import { pluginIconSources, RemoteIcon } from "./RemoteIcon";
import { EmptyRow, Section } from "./Section";

function supported(site: SiteSummary): boolean {
  return !site.plugin_version || compareVersions(site.plugin_version, PLUGIN_MANAGEMENT_SINCE) >= 0;
}

/** The site's installed plugins, read live from the site. */
export function PluginsSection(props: { site: SiteSummary }) {
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
        Managing plugins needs Presser Connect {PLUGIN_MANAGEMENT_SINCE} or later. This site runs {site.plugin_version};
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
      <ul className="divide-y">
        {plugins.data.plugins.map((plugin) => (
          <PluginRow
            key={plugin.file}
            siteId={site.id}
            plugin={plugin}
            canDelete={canModify}
            autoUpdates={plugins.data.auto_updates}
          />
        ))}
      </ul>
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
            onClick={() => setInstalling(true)}
            disabled={!canModify}
            title={canModify ? undefined : "File changes are disabled on this site (DISALLOW_FILE_MODS)"}
          >
            <PlusIcon /> Add plugin
          </Button>
        )
      }
    >
      {body}
      <SiteInstallDialog site={site} open={installing} onOpenChange={setInstalling} />
    </Section>
  );
}

const ACTION_LABELS: Record<PluginAction, string> = {
  activate: "Activating...",
  deactivate: "Deactivating...",
  delete: "Deleting...",
  "enable-auto-update": "Turning on auto-updates...",
  "disable-auto-update": "Turning off auto-updates...",
};

function PluginRow(props: {
  siteId: number;
  plugin: InstalledPlugin;
  canDelete: boolean;
  /** Undefined before Presser Connect 0.7.0; false when the site turns plugin auto-updates off in code. */
  autoUpdates: boolean | undefined;
}) {
  const { siteId, plugin } = props;
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = useMutation({
    mutationFn: (next: PluginAction) => managePlugin(siteId, plugin.file, next),
    onSuccess: () => setConfirmDelete(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["site", siteId, "plugins"] }),
  });

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <RemoteIcon sources={plugin.protected ? ["/presser.svg"] : pluginIconSources(plugin.file, plugin.icon_url)} name={plugin.name} className="size-9 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{plugin.name}</p>
            {plugin.active ? (
              <Badge variant="secondary">{plugin.network_active ? "Network active" : "Active"}</Badge>
            ) : (
              <Badge variant="outline">Inactive</Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {[plugin.version && `Version ${plugin.version}`, plugin.author].filter(Boolean).join(" · ")}
            {!plugin.protected && props.autoUpdates === false && " · Auto-updates turned off in code"}
            {!plugin.protected && props.autoUpdates && plugin.auto_update !== undefined && (
              <>
                {` · Auto-updates ${plugin.auto_update ? "on" : "off"} · `}
                <button
                  type="button"
                  className="hover:text-foreground hover:underline disabled:opacity-60"
                  disabled={action.isPending}
                  onClick={() => action.mutate(plugin.auto_update ? "disable-auto-update" : "enable-auto-update")}
                >
                  {plugin.auto_update ? "Disable" : "Enable"}
                </button>
              </>
            )}
          </p>
          {action.error && <p className="mt-1 text-xs text-destructive">{action.error.message}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action.isPending && <span className="text-xs text-muted-foreground">{ACTION_LABELS[action.variables]}</span>}
        {plugin.protected ? (
          <span className="text-xs text-muted-foreground">Connects this site to Presser</span>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() => action.mutate(plugin.active ? "deactivate" : "activate")}
            >
              {plugin.active ? "Deactivate" : "Activate"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={action.isPending || !props.canDelete}
              title={props.canDelete ? undefined : "File changes are disabled on this site (DISALLOW_FILE_MODS)"}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          </>
        )}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {plugin.name}?</DialogTitle>
            <DialogDescription>
              {plugin.active ? "Presser deactivates it, then deletes" : "Presser deletes"} its files from the site, as
              Delete on the Plugins screen does. Its settings may stay in the database.
            </DialogDescription>
          </DialogHeader>
          {action.error && <p className="text-sm text-destructive">{action.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => action.mutate("delete")} disabled={action.isPending}>
              {action.isPending ? "Deleting..." : "Delete plugin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Plugin slug or WordPress.org link</span>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="akismet"
                  required={source === "wordpress.org"}
                  autoComplete="off"
                />
                <span className="block text-xs text-muted-foreground">
                  The slug is the last part of the plugin's address, such as wordpress.org/plugins/akismet.
                </span>
              </label>
            </TabsContent>
            <TabsContent value="url" className="pt-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Link to a plugin zip</span>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/my-plugin.zip"
                  inputMode="url"
                  type="url"
                  required={source === "url"}
                />
                <span className="block text-xs text-muted-foreground">Each site downloads it directly.</span>
              </label>
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
            <Button type="submit" disabled={install.isPending || props.canSubmit === false}>
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

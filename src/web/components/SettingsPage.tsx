import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LINK_SCAN_INTERVALS,
  SYNC_INTERVALS,
  type LinkScanInterval,
  type SyncInterval,
  type UmamiMode,
} from "../../shared/types";
import {
  deleteCloudflareSettings,
  deleteUmamiSettings,
  fetchCloudflareSettings,
  saveCloudflareSettings,
  fetchLayoutSettings,
  fetchLinkScanSettings,
  fetchSyncSettings,
  fetchUmamiSettings,
  saveLayoutSettings,
  saveLinkScanSettings,
  saveSyncSettings,
  saveUmamiSettings,
} from "../api";
import { Section } from "./Section";
import { Spinner } from "./Spinner";

export function SettingsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <SyncSettingsSection />
      <LinkScanSettingsSection />
      <LayoutSettingsSection />
      <UmamiSettingsSection />
      <CloudflareSettingsSection />
    </div>
  );
}

const SYNC_LABELS: Record<SyncInterval, string> = {
  15: "Every 15 minutes",
  30: "Every 30 minutes",
  60: "Every hour",
  180: "Every 3 hours",
  360: "Every 6 hours",
};

function SyncSettingsSection() {
  const queryClient = useQueryClient();
  const sync = useQuery({ queryKey: ["settings", "sync"], queryFn: fetchSyncSettings, refetchInterval: false });
  const save = useMutation({
    mutationFn: saveSyncSettings,
    onMutate: (next) => queryClient.setQueryData(["settings", "sync"], next),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["settings", "sync"] }),
  });
  return (
    <Section
      title="Background sync"
      action={save.isPending ? <Spinner className="size-4 text-muted-foreground" label="Saving" /> : undefined}
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          <span className="block text-sm font-medium">Check every site</span>
          <span className="block text-xs text-muted-foreground">
            Updates, plugins, users and comments are refreshed on this schedule. Sync now on a site refreshes it at
            once.
          </span>
        </span>
        <select
          aria-label="Background sync interval"
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          value={sync.data?.interval_minutes ?? 60}
          disabled={sync.isPending}
          onChange={(e) => save.mutate({ interval_minutes: Number(e.target.value) as SyncInterval })}
        >
          {SYNC_INTERVALS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {SYNC_LABELS[minutes]}
            </option>
          ))}
        </select>
      </div>
      {(sync.error || save.error) && (
        <p className="px-4 pb-3 text-sm text-destructive">{(sync.error ?? save.error)!.message}</p>
      )}
    </Section>
  );
}

const LINK_SCAN_LABELS: Record<LinkScanInterval, string> = {
  0: "Off",
  1: "Every day",
  3: "Every 3 days",
  5: "Every 5 days",
  7: "Every 7 days",
};

const SELECT_CLASS =
  "h-8 max-w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** This browser's time zone, such as America/Chicago. */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones =
      (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    // Older browsers: just the saved zone and this browser's.
  }
  return [...new Set([current, browserTimeZone(), "UTC", ...zones])].sort();
}

/**
 * Scheduled link checks run at midnight in a time zone the Worker can't
 * guess, so the dashboard saves this browser's the first time it loads.
 */
export function useSaveTimeZoneOnce(enabled: boolean) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings", "links"],
    queryFn: fetchLinkScanSettings,
    refetchInterval: false,
    enabled,
  });
  const needsZone = settings.data && settings.data.time_zone === null;
  useEffect(() => {
    if (!needsZone) return;
    saveLinkScanSettings({ time_zone: browserTimeZone() })
      .then((data) => queryClient.setQueryData(["settings", "links"], data))
      .catch(() => undefined);
  }, [needsZone, queryClient]);
}

function LinkScanSettingsSection() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings", "links"],
    queryFn: fetchLinkScanSettings,
    refetchInterval: false,
  });
  const save = useMutation({
    mutationFn: saveLinkScanSettings,
    onSuccess: (data) => queryClient.setQueryData(["settings", "links"], data),
  });
  const data = settings.data;
  const zone = data?.time_zone ?? browserTimeZone();
  return (
    <Section
      title="Link checks"
      action={save.isPending ? <Spinner className="size-4 text-muted-foreground" label="Saving" /> : undefined}
    >
      <div className="divide-y">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="block text-sm font-medium">Check every site's links</span>
            <span className="block text-xs text-muted-foreground">
              At midnight, one site at a time, a couple of minutes apart.
              {data?.next_run_at
                ? ` Next: ${new Date(data.next_run_at * 1000).toLocaleString(undefined, {
                    timeZone: zone,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}.`
                : ""}
            </span>
          </span>
          <select
            aria-label="Link check interval"
            className={SELECT_CLASS}
            value={data?.interval_days ?? 7}
            disabled={settings.isPending || save.isPending}
            onChange={(e) => save.mutate({ interval_days: Number(e.target.value) as LinkScanInterval })}
          >
            {LINK_SCAN_INTERVALS.map((days) => (
              <option key={days} value={days}>
                {LINK_SCAN_LABELS[days]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="block text-sm font-medium">Time zone</span>
            <span className="block text-xs text-muted-foreground">
              Where midnight is. Set from this browser at first.
            </span>
          </span>
          <select
            aria-label="Time zone"
            className={SELECT_CLASS}
            value={zone}
            disabled={settings.isPending || save.isPending}
            onChange={(e) => save.mutate({ time_zone: e.target.value })}
          >
            {timeZones(zone).map((name) => (
              <option key={name} value={name}>
                {name.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      {(settings.error || save.error) && (
        <p className="px-4 pb-3 text-sm text-destructive">{(settings.error ?? save.error)!.message}</p>
      )}
    </Section>
  );
}

function LayoutSettingsSection() {
  const queryClient = useQueryClient();
  const layout = useQuery({ queryKey: ["settings", "layout"], queryFn: fetchLayoutSettings, refetchInterval: false });
  const save = useMutation({
    mutationFn: saveLayoutSettings,
    onMutate: (next) => queryClient.setQueryData(["settings", "layout"], next),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["settings", "layout"] }),
  });
  const columns = layout.data?.site_columns ?? 1;
  const option = (value: 1 | 2, title: string, detail: string) => (
    <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/40">
      <input
        type="radio"
        name="site-columns"
        className="mt-1 accent-primary"
        checked={columns === value}
        disabled={layout.isPending}
        onChange={() => save.mutate({ ...layout.data, site_columns: value })}
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
  return (
    <Section
      title="Site page layout"
      action={save.isPending ? <Spinner className="size-4 text-muted-foreground" label="Saving" /> : undefined}
    >
      <div className="divide-y">
        {option(1, "One column", "On a site's Overview tab, Analytics, Updates and Comments one below the other.")}
        {option(
          2,
          "Two columns",
          "On a site's Overview tab, Updates and Comments on the left, Analytics on the right. Needs Umami connected below, and a wide enough window; narrow screens keep one column.",
        )}
      </div>
      {(layout.error || save.error) && (
        <p className="px-4 pb-3 text-sm text-destructive">{(layout.error ?? save.error)!.message}</p>
      )}
    </Section>
  );
}

function UmamiSettingsSection() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings", "umami"], queryFn: fetchUmamiSettings, refetchInterval: false });
  const [mode, setMode] = useState<UmamiMode>("cloud");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");

  // Start the form on what is saved.
  useEffect(() => {
    if (!settings.data?.configured) return;
    setMode(settings.data.mode);
    setUrl(settings.data.url);
    setUsername(settings.data.username);
  }, [settings.data]);

  const saved = settings.data?.configured && settings.data.mode === mode;
  const save = useMutation({
    mutationFn: () =>
      saveUmamiSettings(
        mode === "cloud"
          ? { mode, secret: secret || undefined }
          : { mode, url: url.trim(), username: username.trim(), secret: secret || undefined },
      ),
    onSuccess: (result) => {
      setSecret("");
      queryClient.setQueryData(["settings", "umami"], result);
      queryClient.invalidateQueries({ queryKey: ["site"] });
    },
  });
  const disconnect = useMutation({
    mutationFn: deleteUmamiSettings,
    onSuccess: (result) => {
      save.reset();
      setSecret("");
      queryClient.setQueryData(["settings", "umami"], result);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Section title="Umami analytics">
      {settings.isPending ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : settings.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{settings.error.message}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4 p-4">
          <p className="text-sm text-muted-foreground">
            {settings.data.configured
              ? `Connected to ${settings.data.mode === "cloud" ? "Umami Cloud" : settings.data.url}. Each site's page shows its analytics from the Umami website with the same domain.`
              : "Connect Umami to see each site's visitors, pageviews and top pages on its page. KontrolWP matches each site to the Umami website with the same domain."}
          </p>
          <Tabs value={mode} onValueChange={(value) => setMode(value as UmamiMode)}>
            <TabsList>
              <TabsTrigger value="cloud">Umami Cloud</TabsTrigger>
              <TabsTrigger value="self-hosted">Self-hosted</TabsTrigger>
            </TabsList>
            <TabsContent value="cloud" className="space-y-3 pt-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">API key</span>
                <Input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={saved ? "Saved; enter a new key to replace it" : "api_..."}
                  required={mode === "cloud" && !saved}
                  autoComplete="off"
                />
                <span className="block text-xs text-muted-foreground">
                  Create one in Umami Cloud under Settings, API keys.
                </span>
              </label>
            </TabsContent>
            <TabsContent value="self-hosted" className="space-y-3 pt-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Umami address</span>
                <Input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://analytics.example.com"
                  required={mode === "self-hosted"}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Username</span>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required={mode === "self-hosted"}
                    autoComplete="off"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Password</span>
                  <Input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={saved ? "Saved" : undefined}
                    required={mode === "self-hosted" && !saved}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                A view-only Umami user is enough. KontrolWP signs in with it each time it loads analytics.
              </p>
            </TabsContent>
          </Tabs>
          <p className="text-xs text-muted-foreground">
            The {mode === "cloud" ? "API key" : "password"} is stored encrypted, like each site's connection key, and is
            never shown again.
          </p>
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
          {save.isSuccess && (
            <p className="text-sm text-muted-foreground">
              Connected. Umami lists {save.data.websites} {save.data.websites === 1 ? "website" : "websites"}.
            </p>
          )}
          {disconnect.error && <p className="text-sm text-destructive">{disconnect.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              {save.isPending ? "Checking..." : "Save and test"}
            </Button>
            {settings.data.configured && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                loading={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            )}
          </div>
        </form>
      )}
    </Section>
  );
}

function CloudflareSettingsSection() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings", "cloudflare"],
    queryFn: fetchCloudflareSettings,
    refetchInterval: false,
  });
  const [token, setToken] = useState("");
  const refresh = (result: { configured: boolean }) => {
    setToken("");
    queryClient.setQueryData(["settings", "cloudflare"], { configured: result.configured });
    queryClient.invalidateQueries({ queryKey: ["cloudflare"] });
    queryClient.invalidateQueries({ queryKey: ["site"] });
  };
  const save = useMutation({ mutationFn: () => saveCloudflareSettings(token.trim()), onSuccess: refresh });
  const disconnect = useMutation({
    mutationFn: deleteCloudflareSettings,
    onSuccess: (result) => {
      save.reset();
      refresh(result);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Section title="Cloudflare">
      {settings.isPending ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : settings.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{settings.error.message}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4 p-4">
          <p className="text-sm text-muted-foreground">
            {settings.data.configured
              ? "Connected. A static site on Cloudflare Workers shows its deployments and build logs once you choose its Worker."
              : "Connect Cloudflare to show a static site's deployments and build logs. KontrolWP only reads from Cloudflare."}
          </p>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">API token</span>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings.data.configured ? "Saved; enter a new token to replace it" : "Cloudflare API token"}
              required={!settings.data.configured}
              autoComplete="off"
            />
            <span className="block text-xs text-muted-foreground">
              Create a user API token in Cloudflare under My Profile, API Tokens, with read access to Account Settings,
              Workers Scripts and Workers Builds Configuration. It is stored encrypted and never shown again.
            </span>
          </label>
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
          {save.isSuccess && (
            <p className="text-sm text-muted-foreground">
              Connected. Cloudflare lists {save.data.workers} {save.data.workers === 1 ? "Worker" : "Workers"}.
            </p>
          )}
          {disconnect.error && <p className="text-sm text-destructive">{disconnect.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending} disabled={!token.trim()}>
              {save.isPending ? "Checking..." : "Save and test"}
            </Button>
            {settings.data.configured && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                loading={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            )}
          </div>
        </form>
      )}
    </Section>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { LINK_SCAN_INTERVALS, type LinkScanInterval } from "../../shared/types";
import { fetchLinkScanSettings, saveLinkScanSettings } from "../api";
import { HelpTip } from "./HelpTip";
import { ResponsiveTabsList } from "./ResponsiveTabsList";
import { Section } from "./Section";
import { UpdatePolicySettingsSection } from "./UpdatePolicy";
import { Spinner } from "./Spinner";
import { Select } from "@/components/ui/select";

const SETTINGS_TABS = [
  { value: "general", label: "General" },
  { value: "updates", label: "Updates" },
  { value: "links", label: "Link checks" },
];

// Integrations used to be a Settings tab; older links and bookmarks still land on them.
const INTEGRATION_SECTIONS = ["cloudflare", "google", "pagespeed", "umami", "wordfence"];

export function SettingsPage() {
  const { hash } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab") ?? "general";
  const tab = SETTINGS_TABS.some((item) => item.value === requested) ? requested : "general";
  if (requested === "integrations" || INTEGRATION_SECTIONS.includes(hash.slice(1))) {
    const params = new URLSearchParams(searchParams);
    params.delete("tab");
    const search = params.toString();
    return <Navigate to={`/integrations${search ? `?${search}` : ""}${hash}`} replace />;
  }
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <Tabs
        variant="underline"
        value={tab}
        onValueChange={(next) => setSearchParams(next === "general" ? {} : { tab: next }, { replace: true })}
        className="mt-6 gap-0"
      >
        <ResponsiveTabsList
          tabs={SETTINGS_TABS}
          value={tab}
          onChange={(next) => setSearchParams(next === "general" ? {} : { tab: next }, { replace: true })}
          label="Settings section"
        />
        <TabsContent value="general">
          <SyncSettingsSection />
        </TabsContent>
        <TabsContent value="updates">
          <UpdatePolicySettingsSection />
        </TabsContent>
        <TabsContent value="links">
          <LinkScanSettingsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Sites sync every night and when the dashboard opens; this sets where midnight is, for link checks too. */
function SyncSettingsSection() {
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
  const zone = settings.data?.time_zone ?? browserTimeZone();
  return (
    <Section
      title="Background sync"
      action={save.isPending ? <Spinner className="size-4 text-muted-foreground" label="Saving" /> : undefined}
    >
      <div className="divide-y">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Check every site
            <HelpTip>
              Updates, plugins, users and comments are refreshed every day at midnight and each time you open
              KontrolWP. Sync now on a site refreshes it at once.
            </HelpTip>
          </span>
          <span className="text-sm text-muted-foreground">Every day at midnight</span>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Time zone
            <HelpTip>Where midnight is, for background sync and link checks. Set from this browser at first.</HelpTip>
          </span>
          <Select
            aria-label="Time zone"
            value={zone}
            disabled={settings.isPending || save.isPending}
            onValueChange={(next) => save.mutate({ time_zone: next })}
          >
            {timeZones(zone).map((name) => (
              <option key={name} value={name}>
                {name.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {(settings.error || save.error) && (
        <p className="px-4 pb-3 text-sm text-destructive">{(settings.error ?? save.error)!.message}</p>
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
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Check every site's links
              <HelpTip>At midnight in the time zone under General, one site at a time, a couple of minutes apart.</HelpTip>
            </span>
            {data?.next_run_at ? (
              <span className="block text-xs text-muted-foreground">
                {`Next: ${new Date(data.next_run_at * 1000).toLocaleString(undefined, {
                  timeZone: zone,
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}.`}
              </span>
            ) : null}
          </span>
          <Select
            aria-label="Link check interval"
            value={data?.interval_days ?? 7}
            disabled={settings.isPending || save.isPending}
            onValueChange={(next) => save.mutate({ interval_days: Number(next) as LinkScanInterval })}
          >
            {LINK_SCAN_INTERVALS.map((days) => (
              <option key={days} value={days}>
                {LINK_SCAN_LABELS[days]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {(settings.error || save.error) && (
        <p className="px-4 pb-3 text-sm text-destructive">{(settings.error ?? save.error)!.message}</p>
      )}
    </Section>
  );
}

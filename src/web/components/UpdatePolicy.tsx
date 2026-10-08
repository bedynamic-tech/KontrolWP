import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import type {
  GlobalUpdatePolicy,
  SiteSummary,
  SiteUpdatePolicy,
  UpdateFrequency,
  UpdateRun,
  UpdateSchedule,
} from "../../shared/types";
import {
  fetchFleetPlugins,
  fetchGlobalUpdatePolicy,
  fetchSiteUpdatePolicy,
  saveGlobalUpdatePolicy,
  saveSiteUpdatePolicy,
} from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { HelpTip } from "./HelpTip";
import { RemoteIcon, pluginIconSources } from "./RemoteIcon";
import { Section } from "./Section";
import { Spinner } from "./Spinner";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? "AM" : "PM"}`;

/** "Every Sunday at 3:00 AM" and the like. */
export function describeSchedule(s: UpdateSchedule): string {
  const when =
    s.frequency === "daily"
      ? "Every day"
      : s.frequency === "weekly"
        ? `Every ${WEEKDAYS[s.weekday]}`
        : `On day ${s.day} of each month`;
  const what = [s.core && "WordPress", s.plugins && "plugins", s.themes && "themes"].filter(Boolean).join(", ");
  return `${when} at ${hourLabel(s.hour)}${what ? `: ${what}` : ": nothing selected"}`;
}

function nextRun(at: number | null, zone: string): string | null {
  if (at === null) return null;
  if (at <= Date.now() / 1000 + 60) return "Next run: within 15 minutes.";
  return `Next run: ${new Date(at * 1000).toLocaleString(undefined, {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} (${zone.replace(/_/g, " ")}).`;
}

function ScheduleFields(props: {
  value: UpdateSchedule;
  onChange: (value: UpdateSchedule) => void;
  disabled: boolean;
}) {
  const { value, onChange, disabled } = props;
  const set = (patch: Partial<UpdateSchedule>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {(
          [
            ["core", "WordPress"],
            ["plugins", "Plugins"],
            ["themes", "Themes"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <Switch checked={value[key]} disabled={disabled} onCheckedChange={(next) => set({ [key]: next })} />
            {label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          aria-label="How often"
          className={SELECT_CLASS}
          value={value.frequency}
          disabled={disabled}
          onChange={(event) => set({ frequency: event.target.value as UpdateFrequency })}
        >
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
        </select>
        {value.frequency === "weekly" && (
          <select
            aria-label="Day of the week"
            className={SELECT_CLASS}
            value={value.weekday}
            disabled={disabled}
            onChange={(event) => set({ weekday: Number(event.target.value) })}
          >
            {WEEKDAYS.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        )}
        {value.frequency === "monthly" && (
          <select
            aria-label="Day of the month"
            className={SELECT_CLASS}
            value={value.day}
            disabled={disabled}
            onChange={(event) => set({ day: Number(event.target.value) })}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                Day {day}
              </option>
            ))}
          </select>
        )}
        <span className="text-muted-foreground">at</span>
        <select
          aria-label="Time of day"
          className={SELECT_CLASS}
          value={value.hour}
          disabled={disabled}
          onChange={(event) => set({ hour: Number(event.target.value) })}
        >
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour}>
              {hourLabel(hour)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

interface PluginChoice {
  file: string;
  name: string;
  icon_url: string | null;
  sites: number;
}

/** Plugins with a checkbox each: checked ones are updated on schedule, unchecked ones are left out. */
function PluginPicker(props: {
  plugins: PluginChoice[];
  excluded: string[];
  /** Left out by the global policy, so shown unchecked and locked on a site. */
  locked?: string[];
  onChange: (excluded: string[]) => void;
  disabled: boolean;
  showSites?: boolean;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const shown = props.plugins.filter((p) => !query || p.name.toLowerCase().includes(query) || p.file.includes(query));
  const left = new Set(props.excluded);
  const locked = new Set(props.locked ?? []);
  const toggle = (file: string, include: boolean) =>
    props.onChange(include ? props.excluded.filter((f) => f !== file) : [...props.excluded, file]);
  if (!props.plugins.length) {
    return <p className="text-xs text-muted-foreground">No plugins to choose from yet. They appear after a sync.</p>;
  }
  return (
    <div className="space-y-2">
      {props.plugins.length > 8 && (
        <Input
          type="search"
          placeholder="Find a plugin"
          aria-label="Find a plugin"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
        {shown.map((plugin) => {
          const isLocked = locked.has(plugin.file);
          return (
            <li key={plugin.file}>
              <label className="flex items-center gap-3 px-3 py-2 text-sm">
                {/* A plugin left out of updates is dimmed, like an inactive plugin. */}
                <span className={cn("flex min-w-0 flex-1 items-center gap-3", (left.has(plugin.file) || isLocked) && "opacity-60")}>
                  <RemoteIcon
                    sources={pluginIconSources(plugin.file, plugin.icon_url)}
                    name={plugin.name}
                    className="size-6 text-xs"
                  />
                  <span className="min-w-0 flex-1 truncate">{plugin.name}</span>
                  {isLocked ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Left out for all sites</span>
                  ) : (
                    props.showSites && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {plugin.sites} {plugin.sites === 1 ? "site" : "sites"}
                      </span>
                    )
                  )}
                </span>
                <Switch
                  checked={!left.has(plugin.file) && !isLocked}
                  disabled={props.disabled || isLocked}
                  onCheckedChange={(value) => toggle(plugin.file, value)}
                />
              </label>
            </li>
          );
        })}
        {!shown.length && <li className="px-3 py-2 text-xs text-muted-foreground">No plugin matches.</li>}
      </ul>
    </div>
  );
}

function RunsList(props: { runs: UpdateRun[]; showSite: boolean }) {
  if (!props.runs.length) return null;
  return (
    <div>
      <p className="text-sm font-medium">Recent scheduled runs</p>
      <ul className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">
        {props.runs.map((run) => (
          <li key={run.id}>
            <span className="font-medium text-foreground">
              {new Date(run.ran_at * 1000).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {props.showSite && <> on {run.site_name}</>}: queued {run.queued} {run.queued === 1 ? "update" : "updates"}
            {run.items.length > 0 && ` (${run.items.map((item) => `${item.name} ${item.version}`).join(", ")})`}
            {run.skipped > 0 && `, left out ${run.skipped} by the plugin list`}.
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every plugin on the connected sites, once each, for choosing which to leave out. */
function usePluginChoices(siteId?: number) {
  const plugins = useQuery({ queryKey: ["fleet-plugins"], queryFn: fetchFleetPlugins, refetchInterval: false });
  const choices = useMemo<PluginChoice[]>(() => {
    const byFile = new Map<string, PluginChoice>();
    for (const plugin of plugins.data?.plugins ?? []) {
      if (plugin.protected || (siteId !== undefined && plugin.site_id !== siteId)) continue;
      const entry = byFile.get(plugin.file);
      if (entry) entry.sites++;
      else byFile.set(plugin.file, { file: plugin.file, name: plugin.name, icon_url: plugin.icon_url, sites: 1 });
    }
    return [...byFile.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [plugins.data, siteId]);
  return { choices, pending: plugins.isPending };
}

/** Settings: the schedule every site follows unless it sets its own. */
export function UpdatePolicySettingsSection() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    queryKey: ["settings", "updates"],
    queryFn: fetchGlobalUpdatePolicy,
    refetchInterval: false,
  });
  const save = useMutation({
    mutationFn: saveGlobalUpdatePolicy,
    onSuccess: (data) => queryClient.setQueryData(["settings", "updates"], data),
  });
  const { choices } = usePluginChoices();
  const data = policy.data;
  const current: GlobalUpdatePolicy | undefined = save.isPending ? save.variables : data?.policy;
  const busy = policy.isPending || save.isPending;
  return (
    <Section
      title="Scheduled updates"
      action={save.isPending ? <Spinner className="size-4 text-muted-foreground" label="Saving" /> : undefined}
    >
      <div className="space-y-5 px-4 py-4">
        <label className="flex cursor-pointer items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Update sites on a schedule
              <HelpTip>
                Every site follows this unless its own settings say otherwise. Updates run one at a time on each site,
                and sites start a couple of minutes apart. The time zone is the one chosen under Link checks.
              </HelpTip>
            </span>
          </span>
          <Switch
            className="mt-0.5"
            checked={!!current?.enabled}
            disabled={busy || !current}
            onCheckedChange={(value) => current && save.mutate({ ...current, enabled: value })}
          />
        </label>
        {current && (
          <>
            <ScheduleFields
              value={current}
              disabled={busy}
              onChange={(value) => save.mutate({ ...current, ...value })}
            />
            {data && current.enabled && (
              <p className="text-xs text-muted-foreground">
                {describeSchedule(current)}. {nextRun(data.next_run_at, data.time_zone)}
              </p>
            )}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                Plugins to update
                <HelpTip>
                  Uncheck a plugin to leave it out of scheduled updates on every site. You can still update it by hand.
                </HelpTip>
              </p>
              <PluginPicker
                plugins={choices}
                excluded={current.excluded_plugins}
                disabled={busy}
                showSites
                onChange={(excluded_plugins) => save.mutate({ ...current, excluded_plugins })}
              />
            </div>
          </>
        )}
        {data && <RunsList runs={data.runs} showSite />}
        {(policy.error || save.error) && (
          <p className="text-sm text-destructive">{(policy.error ?? save.error)!.message}</p>
        )}
      </div>
    </Section>
  );
}

/** Site settings: follow the global schedule, use the site's own, or none, and leave plugins out here. */
export function SiteUpdatePolicyRow(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const key = ["site", site.id, "update-policy"];
  const view = useQuery({ queryKey: key, queryFn: () => fetchSiteUpdatePolicy(site.id), refetchInterval: false });
  const save = useMutation({
    mutationFn: (policy: SiteUpdatePolicy) => saveSiteUpdatePolicy(site.id, policy),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const { choices } = usePluginChoices(site.id);
  const data = view.data;
  const current: SiteUpdatePolicy | undefined = save.isPending ? save.variables : data?.policy;
  const busy = view.isPending || save.isPending;
  const globalSummary = data?.global.enabled ? describeSchedule(data.global) : "no schedule is set";
  return (
    <div className="space-y-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Scheduled updates
            <HelpTip>{data ? `The global setting: ${globalSummary}.` : "Loading..."}</HelpTip>
          </p>
        </div>
        {save.isPending && <Spinner className="size-4 text-muted-foreground" label="Saving" />}
      </div>
      {current && (
        <>
          <select
            aria-label="Scheduled updates for this site"
            className={`${SELECT_CLASS} w-full`}
            value={current.mode}
            disabled={busy}
            onChange={(event) => save.mutate({ ...current, mode: event.target.value as SiteUpdatePolicy["mode"] })}
          >
            <option value="inherit">Follow the global setting</option>
            <option value="custom">Use a schedule for this site</option>
            <option value="off">No scheduled updates for this site</option>
          </select>
          {current.mode === "custom" && (
            <ScheduleFields
              value={current.schedule}
              disabled={busy}
              onChange={(schedule) => save.mutate({ ...current, schedule })}
            />
          )}
          {data && data.effective !== "off" && (
            <p className="text-xs text-muted-foreground">{nextRun(data.next_run_at, data.time_zone)}</p>
          )}
          {current.mode !== "off" && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                Plugins to update
                <HelpTip>Uncheck a plugin to leave it out of scheduled updates on this site.</HelpTip>
              </p>
              <PluginPicker
                plugins={choices}
                excluded={current.excluded_plugins}
                locked={data?.global.excluded_plugins}
                disabled={busy}
                onChange={(excluded_plugins) => save.mutate({ ...current, excluded_plugins })}
              />
            </div>
          )}
        </>
      )}
      {data && <RunsList runs={data.runs} showSite={false} />}
      {(view.error || save.error) && <p className="text-xs text-destructive">{(view.error ?? save.error)!.message}</p>}
    </div>
  );
}

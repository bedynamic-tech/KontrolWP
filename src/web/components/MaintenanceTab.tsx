import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { compareVersions, MAINTENANCE_SINCE } from "../../shared/plugin-version";
import type { Maintenance, MaintenanceLogo, MaintenanceSave, SiteSummary } from "../../shared/types";
import { fetchMaintenance, saveMaintenance } from "../api";
import { timeAgo } from "../format";
import { SELECT_CLASS } from "./AnalyticsSection";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";
import { Row } from "./ToolsTab";

const LOGO_LABELS: Record<MaintenanceLogo, string> = {
  site: "The site's logo",
  login: "The login page logo",
  none: "No logo",
};

type Draft = Pick<Maintenance, "headline" | "message" | "logo" | "background" | "accent">;
const toDraft = (saved: Maintenance): Draft => ({
  headline: saved.headline,
  message: saved.message,
  logo: saved.logo,
  background: saved.background,
  accent: saved.accent,
});

/** A color picker with a button that clears it back to the default. */
function ColorField(props: {
  label: string;
  value: string;
  fallback: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <input
        type="color"
        aria-label={props.label}
        value={props.value || props.fallback}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        className="h-8 w-12 cursor-pointer rounded-md border bg-background p-0.5 disabled:cursor-default"
      />
      <span className="w-20 font-mono text-sm text-muted-foreground">{props.value || "Default"}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={props.disabled || !props.value}
        onClick={() => props.onChange("")}
      >
        Reset
      </Button>
    </div>
  );
}

const HINT =
  "Shows visitors a simple page with the site's logo, a headline and a message instead of the site, for example while you run updates. Search engines are told to come back later, so it does not hurt rankings. Anyone signed in to WordPress who can edit posts still sees the site, and wp-admin, the login page and KontrolWP keep working. Common page caches are cleared when it changes.";

export const maintenanceSupported = (site: SiteSummary) =>
  site.kind !== "static" && !!site.plugin_version && compareVersions(site.plugin_version, MAINTENANCE_SINCE) >= 0;

/** The site's maintenance mode, shared by the tab and the banner on the site page. */
export function useMaintenance(site: SiteSummary) {
  const queryClient = useQueryClient();
  const supported = maintenanceSupported(site);
  const key = ["site", site.id, "maintenance"];
  const query = useQuery({ queryKey: key, queryFn: () => fetchMaintenance(site.id), enabled: supported });
  const save = useMutation({
    mutationFn: (settings: MaintenanceSave) => saveMaintenance(site.id, settings),
    onSuccess: (data: Maintenance) => {
      queryClient.setQueryData(key, data);
      // The sites list shows a badge while it is on.
      if (data.enabled !== site.maintenance) {
        queryClient.invalidateQueries({ queryKey: ["site", site.id], exact: true });
        queryClient.invalidateQueries({ queryKey: ["overview"] });
      }
    },
  });
  return { supported, query, save };
}

/** Shown above the site's sections while maintenance mode is on, so it is not forgotten. */
export function MaintenanceBanner(props: { site: SiteSummary; onOpen: () => void; className?: string }) {
  const { query, save } = useMaintenance(props.site);
  const enabled = save.isPending ? save.variables.enabled : query.data?.enabled;
  if (!enabled) return null;
  const since = query.data?.since ? Math.floor(Date.parse(query.data.since) / 1000) : null;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-amber-600/25 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center dark:border-amber-400/25",
        props.className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-amber-800 dark:text-amber-300">Maintenance mode is on</p>
        <p className="mt-1 text-muted-foreground">
          Visitors see the maintenance page instead of the site.{since ? ` Turned on ${timeAgo(since).toLowerCase()}.` : ""}
        </p>
        {save.error && <p className="mt-1 text-destructive">{save.error.message}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={props.onOpen}>
          Edit page
        </Button>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ enabled: false })}>
          {save.isPending && <Spinner className="size-4" />} Turn off
        </Button>
      </div>
    </div>
  );
}

/** Tools > Maintenance: the switch and the page visitors see while it is on. */
export function MaintenanceTab({ site }: { site: SiteSummary }) {
  const { supported, query, save } = useMaintenance(site);
  const saved = query.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (saved) setDraft(toDraft(saved));
  }, [saved]);

  if (!supported) {
    return (
      <Section title="Maintenance mode" hint={HINT}>
        <EmptyRow>
          Maintenance mode needs KontrolWP Connect {MAINTENANCE_SINCE} or later on this site. It updates
          automatically; select Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  if (!saved || !draft) {
    return (
      <Section title="Maintenance mode" hint={HINT}>
        {query.error ? (
          <p className="px-4 py-6 text-center text-sm text-destructive">{query.error.message}</p>
        ) : (
          <div className="flex justify-center py-8">
            <Spinner className="size-5 text-muted-foreground" label="Loading" />
          </div>
        )}
      </Section>
    );
  }

  const busy = save.isPending;
  const enabled = busy ? save.variables.enabled : saved.enabled;
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((field) => draft[field] !== saved[field]);
  const logoUrl =
    draft.logo === "none"
      ? ""
      : draft.logo === "login" && saved.login_logo_url
        ? saved.login_logo_url
        : saved.site_logo_url;
  const headline = draft.headline.trim() || saved.default_headline;
  const message = draft.message.trim() || saved.default_message;

  return (
    <>
      <Section
        title="Maintenance mode"
        hint={HINT}
        action={
          busy ? (
            <Spinner className="size-4 text-muted-foreground" label="Saving" />
          ) : (
            dirty && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft(toDraft(saved))}
                >
                  Discard
                </Button>
                <Button size="sm" onClick={() => save.mutate({ enabled: saved.enabled, ...draft })}>
                  Save changes
                </Button>
              </div>
            )
          )
        }
      >
        {save.error && <p className="border-b px-4 py-3 text-sm text-destructive">{save.error.message}</p>}
        <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
          <p className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium ${enabled ? "" : "opacity-60"}`}>
            Turn on maintenance mode
            <HelpTip>
              {enabled
                ? "Visitors see the maintenance page. You still see the site while signed in to WordPress."
                : "Visitors see the site as usual."}
            </HelpTip>
          </p>
          <Switch
            checked={enabled}
            disabled={busy}
            // The switch also saves the headline and message as they are typed.
            onCheckedChange={(value) => save.mutate({ enabled: value, ...draft })}
          />
        </label>
        <div className="divide-y border-t">
          <Row title="Headline" hint="The large text on the page. Leave it empty for the default.">
            <Input
              aria-label="Headline"
              value={draft.headline}
              maxLength={120}
              disabled={busy}
              placeholder={saved.default_headline}
              onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
            />
          </Row>
          <Row
            title="Message"
            hint="Shown under the headline. A blank line starts a new paragraph. Leave it empty for the default."
          >
            <Textarea
              aria-label="Message"
              rows={4}
              value={draft.message}
              maxLength={1000}
              disabled={busy}
              placeholder={saved.default_message}
              onChange={(event) => setDraft({ ...draft, message: event.target.value })}
            />
          </Row>
        </div>
      </Section>

      <Section
        title="Page branding"
        hint="How the maintenance page looks. Changes are kept with Save changes above, and the preview below follows them as you go."
      >
        <div className="divide-y">
          <Row
            title="Logo"
            hint="The site's logo is the one set in WordPress, or its site icon when there is no logo. The login page logo is the image uploaded under Branding. With no logo, or none set, the site's name is shown instead."
          >
            <select
              aria-label="Logo"
              className={SELECT_CLASS}
              value={draft.logo}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, logo: event.target.value as MaintenanceLogo })}
            >
              {(Object.keys(LOGO_LABELS) as MaintenanceLogo[]).map((value) => (
                <option key={value} value={value} disabled={value === "login" && !saved.login_logo_url}>
                  {LOGO_LABELS[value]}
                  {value === "login" && !saved.login_logo_url ? " (none uploaded)" : ""}
                </option>
              ))}
            </select>
          </Row>
          <Row title="Background color" hint="The page behind the card. Default follows the visitor's light or dark setting.">
            <ColorField
              label="Background color"
              value={draft.background}
              fallback="#f6f6f7"
              disabled={busy}
              onChange={(background) => setDraft({ ...draft, background })}
            />
          </Row>
          <Row title="Accent color" hint="A bar along the top of the card, in your brand color. Default has no bar.">
            <ColorField
              label="Accent color"
              value={draft.accent}
              fallback="#2563eb"
              disabled={busy}
              onChange={(accent) => setDraft({ ...draft, accent })}
            />
          </Row>
        </div>
      </Section>

      <Section
        title="What visitors see"
        hint="A preview of the page with the changes above. Open preview shows the real page on the site, as it is saved."
        action={
          <Button variant="outline" size="sm" asChild>
            <a href={saved.preview_url} target="_blank" rel="noreferrer">
              Open preview <ExternalLinkIcon />
            </a>
          </Button>
        }
      >
        <div
          className="flex justify-center bg-muted/40 px-4 py-8"
          style={draft.background ? { background: draft.background } : undefined}
        >
          <div
            className="w-full max-w-sm rounded-2xl border bg-background px-6 py-8 text-center"
            style={draft.accent ? { borderTop: `6px solid ${draft.accent}` } : undefined}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="" className="mx-auto mb-6 max-h-16 max-w-40 object-contain" />
            ) : (
              <p className="mb-5 text-sm font-semibold text-muted-foreground">{site.name}</p>
            )}
            <p className="text-xl font-semibold tracking-tight">{headline}</p>
            {message.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index} className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}

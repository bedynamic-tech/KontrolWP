import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { compareVersions, SEO_MIGRATE_SINCE } from "../../shared/plugin-version";
import type { SeoMigrationParts, SeoMigrationPreview, SeoMigrationResult, SiteSummary } from "../../shared/types";
import { deactivateMigrationSource, fetchMigrationSources, previewMigration, runMigration } from "../api";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";
import { Checkbox } from "@/components/ui/checkbox";

const SETTING_LABELS: Record<string, string> = {
  separator: "Title separator",
  title_template: "Page title template",
  home_title: "Home page title",
  home_description: "Home page description",
  og_image: "Default social image",
  twitter_site: "Twitter or X handle",
  noindex_author: "Hide author pages",
  noindex_date: "Hide date archives",
  twitter_card: "Twitter or X card",
  hidden_types: "Content types hidden from search",
  hidden_taxonomies: "Archives hidden from search",
  type_templates: "Title templates by content type",
  strip_category_base: "Remove category from addresses",
  author_archives: "Author archives",
  "content.schema_type": "Site is marked up as",
  "content.schema_name": "Name in structured data",
  "content.schema_logo": "Logo in structured data",
  "content.schema_same_as": "Social profile links",
  "content.breadcrumb_home": "Breadcrumb home label",
  "content.breadcrumb_sep": "Breadcrumb separator",
  "content.external_new_tab": "Open outside links in a new tab",
  "content.external_nofollow": "Add nofollow to outside links",
  "tools.verify.google": "Google verification code",
  "tools.verify.bing": "Bing verification code",
  "tools.verify.yandex": "Yandex verification code",
  "tools.verify.baidu": "Baidu verification code",
  "tools.verify.pinterest": "Pinterest verification code",
  "tools.robots_text": "robots.txt rules",
};

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function CheckLine(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex items-start gap-3 px-4 py-3 ${props.disabled ? "opacity-60" : "cursor-pointer"}`}>
      <Checkbox
        className="mt-0.5"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{props.title}</p>
        <div className="text-xs text-muted-foreground">{props.children}</div>
      </div>
    </label>
  );
}

function Summary(props: { result: SeoMigrationResult }) {
  const { result } = props;
  return (
    <div className="grid gap-1 px-4 py-3 text-sm">
      <p>
        Settings filled in: {result.settings.length}. Pages updated: {result.pages.updated}
        {result.pages.skipped > 0 ? ` (${result.pages.skipped} kept as they were)` : ""}. Redirects added:{" "}
        {result.redirects.added}
        {result.redirects.skipped > 0 ? `, ${result.redirects.skipped} already existed` : ""}
        {result.redirects.errors.length > 0 ? `, ${result.redirects.errors.length} could not be imported` : ""}.
      </p>
      {result.redirects.errors.length > 0 && (
        <ul className="max-h-40 overflow-y-auto text-xs text-muted-foreground">
          {result.redirects.errors.map((error) => (
            <li key={`${error.row}-${error.message}`}>
              Redirect {error.row}: {error.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeactivateDialog(props: { site: SiteSummary; name: string; source: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: () => deactivateMigrationSource(props.site.id, props.source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site", props.site.id, "seo"] });
      queryClient.invalidateQueries({ queryKey: ["site", props.site.id, "plugins"] });
      props.onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-md [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Deactivate {props.name}?</DialogTitle>
          <DialogDescription>
            {props.name} stops running on this site and KontrolWP takes over the SEO tags and redirects you imported.
            The plugin is not deleted and keeps its data, so you can turn it back on from the Plugins page.
          </DialogDescription>
        </DialogHeader>
        {run.error && <p className="text-sm text-destructive">{run.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending && <Spinner className="size-4" />}
            Deactivate {props.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Review(props: { site: SiteSummary; source: string }) {
  const { site, source } = props;
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ["site", site.id, "seo", "migrate", source],
    queryFn: () => previewMigration(site.id, source),
  });
  const [parts, setParts] = useState<SeoMigrationParts | null>(null);
  const [result, setResult] = useState<SeoMigrationResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const run = useMutation({
    mutationFn: (chosen: SeoMigrationParts) => runMigration(site.id, source, chosen),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["site", site.id, "seo"] });
    },
  });
  if (preview.isPending) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="size-5 text-muted-foreground" label="Reading the plugin's settings" />
      </div>
    );
  }
  if (preview.error) return <p className="px-4 py-6 text-sm text-destructive">{preview.error.message}</p>;
  const data: SeoMigrationPreview = preview.data;
  const nothing = data.settings.length === 0 && data.pages.total === 0 && data.redirects.total === 0;
  const chosen = parts ?? {
    settings: data.settings.length > 0,
    pages: data.pages.total > 0,
    redirects: data.redirects.importable > 0,
  };
  const set = (key: keyof SeoMigrationParts, value: boolean) => setParts({ ...chosen, [key]: value });
  return (
    <>
      {nothing ? (
        <EmptyRow>{data.name} has no settings, page values or redirects that KontrolWP can import.</EmptyRow>
      ) : (
        <div className="divide-y">
          <CheckLine
            checked={chosen.settings}
            disabled={data.settings.length === 0}
            onChange={(value) => set("settings", value)}
            title="Site-wide settings"
          >
            {data.settings.length === 0 ? (
              "Nothing found."
            ) : (
              <ul>
                {data.settings.map((item) => (
                  <li key={item.key} className="truncate">
                    {SETTING_LABELS[item.key] ?? item.key}: {item.value}
                  </li>
                ))}
              </ul>
            )}
            {data.settings.length > 0 &&
              "Only settings that are still at KontrolWP's defaults are filled in. KontrolWP's SEO tags are switched on."}
          </CheckLine>
          <CheckLine
            checked={chosen.pages}
            disabled={data.pages.total === 0}
            onChange={(value) => set("pages", value)}
            title="Page titles, descriptions, keywords and visibility"
          >
            {data.pages.total === 0
              ? "Nothing found."
              : `${plural(data.pages.total, "page", "pages")} with values: ${data.pages.titles} titles, ${data.pages.descriptions} descriptions, ${data.pages.noindex} hidden from search, ${data.pages.images} social images${data.pages.keywords ? `, ${data.pages.keywords} focus keywords` : ""}. Values KontrolWP already has are kept${data.pages.existing > 0 ? ` (${plural(data.pages.existing, "page has", "pages have")} some)` : ""}.${data.pages.truncated ? " This site has more than could be read at once, so import again afterwards to bring in the rest." : ""}`}
          </CheckLine>
          <CheckLine
            checked={chosen.redirects}
            disabled={data.redirects.importable === 0}
            onChange={(value) => set("redirects", value)}
            title="Redirects"
          >
            {data.redirects.total === 0 ? (
              "Nothing found."
            ) : (
              <>
                <p>
                  {plural(data.redirects.importable, "redirect", "redirects")} can be imported
                  {data.redirects.total > data.redirects.importable
                    ? `, and ${data.redirects.total - data.redirects.importable} cannot be understood and will be skipped`
                    : ""}
                  . Ones KontrolWP already has are skipped. Check pattern-based redirects afterwards.
                </p>
                <ul className="mt-1">
                  {data.redirects.samples.map((item) => (
                    <li key={`${item.match_type}-${item.source}`} className="truncate">
                      {item.source} to {item.target || "(gone)"} ({item.status_code})
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CheckLine>
        </div>
      )}
      {run.error && <p className="border-t px-4 py-3 text-sm text-destructive">{run.error.message}</p>}
      {result && (
        <div className="border-t">
          <Summary result={result} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Importing only adds to KontrolWP. {data.name} and its data are not changed, and you can import again safely.
        </p>
        <div className="flex gap-2">
          {!nothing && (
            <Button
              size="sm"
              onClick={() => run.mutate(chosen)}
              disabled={run.isPending || !(chosen.settings || chosen.pages || chosen.redirects)}
            >
              {run.isPending && <Spinner className="size-4" />}
              {result ? "Import again" : "Import"}
            </Button>
          )}
          {data.active && (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
              Deactivate {data.name}
            </Button>
          )}
        </div>
      </div>
      {data.active && !result && !nothing && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          {data.name} is still active, so KontrolWP prints no SEO tags yet. Import first, then deactivate it.
        </p>
      )}
      {confirming && (
        <DeactivateDialog site={site} name={data.name} source={source} onClose={() => setConfirming(false)} />
      )}
    </>
  );
}

/** Bring another SEO plugin's settings, page values and redirects into KontrolWP, then deactivate it. */
export function MigrateTab(props: { site: SiteSummary }) {
  const { site } = props;
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, SEO_MIGRATE_SINCE) >= 0;
  const sources = useQuery({
    queryKey: ["site", site.id, "seo", "migrate-sources"],
    queryFn: () => fetchMigrationSources(site.id),
    enabled: supported,
  });
  const [chosen, setChosen] = useState<string | null>(null);
  if (!supported) {
    return (
      <Section title="Import from another SEO plugin">
        <EmptyRow>
          Importing needs KontrolWP Connect {SEO_MIGRATE_SINCE} or later on this site. It updates automatically; select
          Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  const list = sources.data?.sources ?? [];
  const selected = list.find((item) => item.id === chosen) ?? (list.length === 1 ? list[0] : null);
  return (
    <Section
      title="Import from another SEO plugin"
      hint="Works with Yoast SEO, Rank Math, All in One SEO, SEOPress and Slim SEO. You see what will be imported before anything changes."
    >
      {sources.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-5 text-muted-foreground" label="Looking for SEO plugins" />
        </div>
      ) : sources.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{sources.error.message}</p>
      ) : list.length === 0 ? (
        <EmptyRow>No other SEO plugin is installed on this site.</EmptyRow>
      ) : (
        <>
          {list.length > 1 && (
            <ul className="divide-y border-b">
              {list.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <p className="font-medium">
                    {item.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {item.active ? "Active" : "Not active"}
                    </span>
                  </p>
                  <Button
                    variant={selected?.id === item.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setChosen(item.id)}
                  >
                    Review
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {selected ? (
            <Review key={selected.id} site={site} source={selected.id} />
          ) : (
            <EmptyRow>Choose a plugin to see what can be imported.</EmptyRow>
          )}
        </>
      )}
    </Section>
  );
}

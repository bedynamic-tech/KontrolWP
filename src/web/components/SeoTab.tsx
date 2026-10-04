import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon, TriangleAlertIcon } from "lucide-react";
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { compareVersions, SEO_SINCE } from "../../shared/plugin-version";
import {
  SEO_BUSINESS_TYPES,
  SEO_DAYS,
  SEO_SEPARATORS,
  MAX_SEO_LOCATIONS,
  type SeoLocal,
  type SeoLocation,
  type SeoPage,
  type SeoSettings,
  type SiteSeo,
  type SiteSummary,
} from "../../shared/types";
import { fetchSeo, fetchSeoPages, saveSeo, saveSeoPage } from "../api";
import { HelpTip } from "./HelpTip";
import { MigrateTab } from "./MigrateTab";
import { NotFoundTab, RedirectsTab } from "./RedirectsTab";
import { ResponsiveTabsList } from "./ResponsiveTabsList";
import { Spinner } from "./Spinner";
import { EmptyRow, Section } from "./Section";

const SELECT_CLASS =
  "h-8 max-w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const TITLE_LENGTH = 60;
const DESCRIPTION_LENGTH = 160;

function Row(props: {
  title: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-sm">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {props.title}
          {props.detail && <HelpTip>{props.detail}</HelpTip>}
        </p>
      </div>
      <div className="min-w-0 sm:w-80">{props.children}</div>
    </div>
  );
}

function CheckRow(props: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {props.title}
          <HelpTip>{props.detail}</HelpTip>
        </p>
      </div>
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-primary"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}

function Counter(props: { value: string; limit: number }) {
  const over = props.value.length > props.limit;
  return (
    <span
      className={
        over ? "text-xs text-destructive" : "text-xs text-muted-foreground"
      }
    >
      {props.value.length} of about {props.limit} characters
    </span>
  );
}

/** Fill a title template the way the plugin does. */
export function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template
    .replace(
      /%(title|sitename|tagline|sep)%/g,
      (_, name: string) => vars[name] ?? "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** How a result might look in search, for the title and description in play. */
function Preview(props: { title: string; url: string; description: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <p className="truncate text-xs text-muted-foreground">{props.url}</p>
      <p className="mt-0.5 truncate text-base text-blue-700 dark:text-blue-300">
        {props.title || "Untitled"}
      </p>
      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
        {props.description ||
          "No description. Search engines will pick text from the page."}
      </p>
    </div>
  );
}

function PageDialog(props: {
  site: SiteSummary;
  seo: SiteSeo;
  page: SeoPage;
  onClose: () => void;
}) {
  const { site, seo, page } = props;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(page.seo_title);
  const [description, setDescription] = useState(page.description);
  const [noindex, setNoindex] = useState(page.noindex);
  const [image, setImage] = useState(page.image);
  const save = useMutation({
    mutationFn: () =>
      saveSeoPage(site.id, page.id, {
        seo_title: title,
        description,
        noindex,
        image,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["site", site.id, "seo", "pages"],
      });
      props.onClose();
    },
  });
  const vars = {
    title: page.title,
    sitename: seo.site_name,
    tagline: seo.tagline,
    sep: seo.settings.separator,
  };
  const shownTitle = fillTemplate(title || seo.settings.title_template, vars);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{page.title || "Untitled"}</DialogTitle>
          <DialogDescription>
            Leave a field empty to use the site-wide defaults.
          </DialogDescription>
        </DialogHeader>
        <Preview
          title={shownTitle}
          url={page.permalink}
          description={description || page.excerpt}
        />
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="seo-page-title">
              SEO title
            </label>
            <Input
              id="seo-page-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={seo.settings.title_template}
            />
            <Counter value={shownTitle} limit={TITLE_LENGTH} />
          </div>
          <div className="grid gap-1.5">
            <label
              className="text-sm font-medium"
              htmlFor="seo-page-description"
            >
              Meta description
            </label>
            <Textarea
              id="seo-page-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={page.excerpt}
              rows={3}
            />
            <Counter
              value={description || page.excerpt}
              limit={DESCRIPTION_LENGTH}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="seo-page-image">
              Social image address
            </label>
            <Input
              id="seo-page-image"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              placeholder="Featured image, then the site-wide image"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={noindex}
              onChange={(event) => setNoindex(event.target.checked)}
            />
            <span className="text-sm">
              Ask search engines not to list this page
            </span>
          </label>
        </div>
        {save.error && (
          <p className="text-sm text-destructive">{save.error.message}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Spinner className="size-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Choose the page that stands for a location, by searching the site's published pages. */
function PagePicker(props: {
  site: SiteSummary;
  pageId: number;
  known?: { title: string; url: string };
  onPick: (page: { id: number; title: string; url: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useQuery({
    queryKey: ["site", props.site.id, "seo", "pages", 1, term],
    queryFn: () => fetchSeoPages(props.site.id, 1, term),
    enabled: open,
  });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {props.pageId > 0 ? (
          <span className="min-w-0 truncate">
            {props.known?.title ?? `Page ${props.pageId}`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            None. Its markup goes on the home page.
          </span>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          {open ? "Close" : props.pageId > 0 ? "Change" : "Choose page"}
        </Button>
        {props.pageId > 0 && (
          <Button variant="ghost" size="sm" onClick={() => props.onPick(null)}>
            Remove
          </Button>
        )}
      </div>
      {open && (
        <div className="rounded-lg border">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search pages"
            aria-label="Search pages for this location"
            className="rounded-b-none border-0 border-b"
          />
          {results.isPending ? (
            <div className="flex justify-center py-4">
              <Spinner
                className="size-4 text-muted-foreground"
                label="Loading pages"
              />
            </div>
          ) : results.error ? (
            <p className="px-3 py-3 text-xs text-destructive">
              {results.error.message}
            </p>
          ) : results.data.items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No published pages match.
            </p>
          ) : (
            <ul className="max-h-48 divide-y overflow-y-auto">
              {results.data.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
                    onClick={() => {
                      props.onPick({
                        id: item.id,
                        title: item.title,
                        url: item.permalink,
                      });
                      setOpen(false);
                    }}
                  >
                    <span className="block truncate">
                      {item.title || "Untitled"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.permalink}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function newLocation(): SeoLocation {
  return {
    id: Math.random().toString(36).slice(2, 10).padEnd(8, "0"),
    page_id: 0,
    type: "LocalBusiness",
    name: "",
    phone: "",
    email: "",
    logo: "",
    image: "",
    street: "",
    city: "",
    region: "",
    postal: "",
    country: "",
    latitude: "",
    longitude: "",
    price_range: "",
    hours: {},
    same_as: [],
  };
}

function LocationCard(props: {
  site: SiteSummary;
  location: SeoLocation;
  siteName: string;
  known?: { title: string; url: string };
  startOpen: boolean;
  onChange: (location: SeoLocation) => void;
  onPick: (page: { id: number; title: string; url: string } | null) => void;
  onRemove: () => void;
}) {
  const { location, onChange } = props;
  const set = <K extends keyof SeoLocation>(key: K, value: SeoLocation[K]) =>
    onChange({ ...location, [key]: value });
  const text = (
    key:
      | "name"
      | "phone"
      | "email"
      | "street"
      | "city"
      | "region"
      | "postal"
      | "country"
      | "price_range"
      | "logo"
      | "image",
    label: string,
    placeholder = "",
  ) => (
    <Row title={label}>
      <Input
        aria-label={`${label} for ${location.name || "this location"}`}
        value={location[key]}
        onChange={(event) => set(key, event.target.value)}
        placeholder={placeholder}
      />
    </Row>
  );
  const setHours = (day: string, part: "open" | "close", value: string) => {
    const current = location.hours[day] ?? { open: "", close: "" };
    const next = { ...current, [part]: value };
    const hours = { ...location.hours };
    if (next.open || next.close) hours[day] = next;
    else delete hours[day];
    set("hours", hours);
  };
  const incomplete = !location.phone && !location.street;
  const summary = [location.city, location.phone].filter(Boolean).join(" · ");
  return (
    <details className="group" open={props.startOpen}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {location.name || props.siteName || "New location"}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {summary || "Add a phone number or a street address"}
            {location.page_id > 0 && " · Has its own page"}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">
          Edit
        </span>
      </summary>
      <div className="divide-y border-t bg-muted/10">
        {incomplete && (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Add a phone number or a street address. Nothing is marked up for
            this location until you do.
          </p>
        )}
        <Row
          title="Location page"
          detail="Optional. Mark up this location on its own page, such as a Contact or branch page, instead of the home page."
        >
          <PagePicker
            site={props.site}
            pageId={location.page_id}
            known={props.known}
            onPick={props.onPick}
          />
        </Row>
        <Row title="Business type">
          <select
            aria-label={`Business type for ${location.name || "this location"}`}
            className={SELECT_CLASS}
            value={location.type}
            onChange={(event) => set("type", event.target.value)}
          >
            {SEO_BUSINESS_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Row>
        {text("name", "Business name", props.siteName)}
        {text("phone", "Phone", "+1 555 0100")}
        {text("email", "Email")}
        {text("street", "Street address")}
        {text("city", "City")}
        {text("region", "State or region")}
        {text("postal", "Postal code")}
        {text("country", "Country", "US")}
        <Row
          title="Map location"
          detail="Optional latitude and longitude, such as 30.2672 and -97.7431."
        >
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Latitude"
              value={location.latitude}
              onChange={(event) => set("latitude", event.target.value)}
              placeholder="Latitude"
            />
            <Input
              aria-label="Longitude"
              value={location.longitude}
              onChange={(event) => set("longitude", event.target.value)}
              placeholder="Longitude"
            />
          </div>
        </Row>
        {text("price_range", "Price range", "$$")}
        {text("logo", "Logo address", "https://")}
        {text("image", "Photo address", "https://")}
        <div className="px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Opening hours
            <HelpTip>Leave both times empty for a day you are closed.</HelpTip>
          </p>
          <ul className="mt-3 grid gap-2">
            {SEO_DAYS.map(([day, label]) => (
              <li key={day} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0">{label}</span>
                <Input
                  type="time"
                  aria-label={`${label} opens`}
                  className="w-32"
                  value={location.hours[day]?.open ?? ""}
                  onChange={(event) =>
                    setHours(day, "open", event.target.value)
                  }
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="time"
                  aria-label={`${label} closes`}
                  className="w-32"
                  value={location.hours[day]?.close ?? ""}
                  onChange={(event) =>
                    setHours(day, "close", event.target.value)
                  }
                />
              </li>
            ))}
          </ul>
        </div>
        <Row
          title="Profile links"
          detail="One address per line: Google Business, Facebook, Instagram and other profiles."
        >
          <Textarea
            aria-label="Profile links"
            rows={3}
            value={location.same_as.join("\n")}
            onChange={(event) =>
              set(
                "same_as",
                event.target.value.split("\n").map((line) => line.trim()),
              )
            }
            placeholder="https://"
          />
        </Row>
        <div className="flex justify-end px-4 py-3">
          <Button variant="outline" size="sm" onClick={props.onRemove}>
            Remove location
          </Button>
        </div>
      </div>
    </details>
  );
}

/** Business locations for local search, marked up as LocalBusiness on the home page or on a location's own page. */
function LocalSection(props: {
  site: SiteSummary;
  local: SeoLocal;
  siteName: string;
  knownPages: Record<string, { title: string; url: string }>;
  onPicked: (page: { id: number; title: string; url: string }) => void;
  onChange: (local: SeoLocal) => void;
}) {
  const { local, onChange } = props;
  const [added, setAdded] = useState<string | null>(null);
  const update = (id: string, next: SeoLocation) =>
    onChange({
      ...local,
      locations: local.locations.map((item) => (item.id === id ? next : item)),
    });
  return (
    <Section
      title="Local SEO"
      action={
        local.enabled && local.locations.length < MAX_SEO_LOCATIONS ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = newLocation();
              setAdded(next.id);
              onChange({ ...local, locations: [...local.locations, next] });
            }}
          >
            Add location
          </Button>
        ) : undefined
      }
    >
      <div className="divide-y">
        <CheckRow
          title="Mark up my business locations for local search"
          detail="Adds schema.org business details, which search engines use for local results and knowledge panels. A location without its own page is marked up on the home page."
          checked={local.enabled}
          onChange={(value) => {
            const locations =
              value && local.locations.length === 0
                ? [newLocation()]
                : local.locations;
            if (value && local.locations.length === 0)
              setAdded(locations[0].id);
            onChange({ ...local, enabled: value, locations });
          }}
        />
        {local.enabled &&
          local.locations.map((location) => (
            <LocationCard
              key={location.id}
              site={props.site}
              location={location}
              siteName={props.siteName}
              known={props.knownPages[String(location.page_id)]}
              startOpen={location.id === added}
              onChange={(next) => update(location.id, next)}
              onPick={(page) => {
                if (page) props.onPicked(page);
                update(location.id, { ...location, page_id: page?.id ?? 0 });
              }}
              onRemove={() =>
                onChange({
                  ...local,
                  locations: local.locations.filter(
                    (item) => item.id !== location.id,
                  ),
                })
              }
            />
          ))}
      </div>
    </Section>
  );
}

function PagesSection(props: { site: SiteSummary; seo: SiteSeo }) {
  const { site, seo } = props;
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SeoPage | null>(null);
  // Search after a pause, so each keystroke is not a request to the site.
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);
  const pages = useQuery({
    queryKey: ["site", site.id, "seo", "pages", page, term],
    queryFn: () => fetchSeoPages(site.id, page, term),
    placeholderData: (previous) => previous,
  });
  const lastPage = Math.max(1, Math.ceil((pages.data?.total ?? 0) / 20));
  return (
    <Section
      title="Pages"
      action={
        <div className="relative w-full max-w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search pages"
            aria-label="Search pages"
            className="pl-8"
          />
        </div>
      }
    >
      {pages.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner
            className="size-5 text-muted-foreground"
            label="Loading pages"
          />
        </div>
      ) : pages.error ? (
        <p className="px-4 py-6 text-sm text-destructive">
          {pages.error.message}
        </p>
      ) : pages.data.items.length === 0 ? (
        <EmptyRow>No published pages match.</EmptyRow>
      ) : (
        <ul className="divide-y">
          {pages.data.items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {item.title || "Untitled"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.seo_title || item.description || item.noindex
                    ? [
                        item.seo_title && "Custom title",
                        item.description && "Custom description",
                        item.image && "Social image",
                        item.noindex && "Hidden from search",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "Uses the site-wide defaults"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(item)}
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
      {lastPage > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            Page {page} of {lastPage}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= lastPage}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      {editing && (
        <PageDialog
          site={site}
          seo={seo}
          page={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  );
}

/** Titles, descriptions, social tags, search visibility and per-page overrides. */
function SeoSettingsPanel(props: { site: SiteSummary; onMigrate: () => void }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const supported =
    !!site.plugin_version &&
    compareVersions(site.plugin_version, SEO_SINCE) >= 0;
  const seo = useQuery({
    queryKey: ["site", site.id, "seo"],
    queryFn: () => fetchSeo(site.id),
    enabled: supported,
  });
  const [draft, setDraft] = useState<SeoSettings | null>(null);
  // Pages chosen for locations since the last save, whose titles the site has not reported yet.
  const [picked, setPicked] = useState<
    Record<string, { title: string; url: string }>
  >({});
  const saved = seo.data?.settings;
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);
  const save = useMutation({
    mutationFn: (settings: SeoSettings) => saveSeo(site.id, settings),
    onSuccess: (data) =>
      queryClient.setQueryData(["site", site.id, "seo"], data),
  });

  if (!supported) {
    return (
      <Section title="SEO">
        <EmptyRow>
          SEO needs KontrolWP Connect {SEO_SINCE} or later on this site. It
          updates automatically; select Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  if (seo.isPending || !draft) {
    return seo.error ? (
      <p className="text-sm text-destructive">{seo.error.message}</p>
    ) : (
      <div className="flex justify-center py-12">
        <Spinner
          className="size-5 text-muted-foreground"
          label="Loading SEO settings"
        />
      </div>
    );
  }
  const data = seo.data!;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = <K extends keyof SeoSettings>(key: K, value: SeoSettings[K]) =>
    setDraft({ ...draft, [key]: value });
  const vars = {
    sitename: data.site_name,
    tagline: data.tagline,
    sep: draft.separator,
  };
  const homeTitle = fillTemplate(
    draft.home_title || `${data.site_name} %sep% ${data.tagline}`,
    vars,
  );
  const homeDescription = draft.home_description || data.tagline;

  return (
    <>
      <div className="mt-4 grid gap-3 empty:hidden">
        {data.conflict && (
          <div className="flex items-start gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-200">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <p>
              {data.conflict} is active on this site, so KontrolWP does not add
              SEO tags. Two sets of tags on a page confuse search engines.
              Deactivate {data.conflict} to use these settings.
            </p>
            <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={props.onMigrate}>
              Import from {data.conflict}
            </Button>
          </div>
        )}
        {data.discouraged && (
          <div className="flex items-start gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-200">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <p>
              WordPress is set to discourage search engines (Settings, Reading),
              so search engines are asked to skip every page whatever you set
              here.
            </p>
          </div>
        )}
      </div>

      <Section
        title="SEO"
        action={
          save.isPending ? (
            <Spinner className="size-4 text-muted-foreground" label="Saving" />
          ) : dirty ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDraft(data.settings)}
              >
                Discard
              </Button>
              <Button size="sm" onClick={() => save.mutate(draft)}>
                Save changes
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="divide-y">
          <CheckRow
            title="Add SEO tags to this site"
            detail="KontrolWP Connect adds titles, descriptions, social tags and robots rules to the head of your pages. Turning this off puts the pages back as WordPress made them."
            checked={draft.enabled}
            onChange={(value) => set("enabled", value)}
          />
        </div>
        {save.error && (
          <p className="border-t px-4 py-3 text-sm text-destructive">
            {save.error.message}
          </p>
        )}
      </Section>

      <Section title="Titles and descriptions">
        <div className="divide-y">
          <Row title="Separator" detail="Goes between the parts of a title.">
            <select
              aria-label="Title separator"
              className={SELECT_CLASS}
              value={draft.separator}
              onChange={(event) =>
                set("separator", event.target.value as SeoSettings["separator"])
              }
            >
              {SEO_SEPARATORS.map((separator) => (
                <option key={separator} value={separator}>
                  {separator}
                </option>
              ))}
            </select>
          </Row>
          <Row
            title="Page title template"
            detail="Used for posts, pages and archives. Tokens: %title%, %sitename%, %tagline%, %sep%."
          >
            <Input
              aria-label="Page title template"
              value={draft.title_template}
              onChange={(event) => set("title_template", event.target.value)}
            />
          </Row>
          <Row
            title="Home page title"
            detail="Empty uses the site name and tagline."
          >
            <Input
              aria-label="Home page title"
              value={draft.home_title}
              onChange={(event) => set("home_title", event.target.value)}
              placeholder={`${data.site_name} ${draft.separator} ${data.tagline}`}
            />
            <Counter value={homeTitle} limit={TITLE_LENGTH} />
          </Row>
          <Row
            title="Home page description"
            detail="Empty uses the tagline. Other pages use their excerpt, or the start of their text."
          >
            <Textarea
              aria-label="Home page description"
              value={draft.home_description}
              onChange={(event) => set("home_description", event.target.value)}
              placeholder={data.tagline}
              rows={3}
            />
            <Counter value={homeDescription} limit={DESCRIPTION_LENGTH} />
          </Row>
          <div className="px-4 py-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Home page in search results
            </p>
            <Preview
              title={homeTitle}
              url={data.home_url}
              description={homeDescription}
            />
          </div>
        </div>
      </Section>

      <Section title="Social sharing">
        <div className="divide-y">
          <CheckRow
            title="Open Graph and Twitter tags"
            detail="Control the title, description and image shown when a page is shared."
            checked={draft.og_enabled}
            onChange={(value) => set("og_enabled", value)}
          />
          {draft.og_enabled && (
            <>
              <Row
                title="Default image address"
                detail="Used when a page has no featured image or social image."
              >
                <Input
                  aria-label="Default social image address"
                  value={draft.og_image}
                  onChange={(event) => set("og_image", event.target.value)}
                  placeholder="https://"
                />
              </Row>
              <Row title="Card style">
                <select
                  aria-label="Twitter card style"
                  className={SELECT_CLASS}
                  value={draft.twitter_card}
                  onChange={(event) =>
                    set(
                      "twitter_card",
                      event.target.value as SeoSettings["twitter_card"],
                    )
                  }
                >
                  <option value="summary_large_image">Large image</option>
                  <option value="summary">Small image</option>
                </select>
              </Row>
              <Row
                title="Twitter or X handle"
                detail="Optional, such as @yourbrand."
              >
                <Input
                  aria-label="Twitter or X handle"
                  value={draft.twitter_site}
                  onChange={(event) => set("twitter_site", event.target.value)}
                  placeholder="@yourbrand"
                />
              </Row>
            </>
          )}
        </div>
      </Section>

      <Section title="Search visibility">
        <div className="divide-y">
          <CheckRow
            title="Hide search result pages"
            detail="Asks search engines not to list your site's own search results."
            checked={draft.noindex_search}
            onChange={(value) => set("noindex_search", value)}
          />
          <CheckRow
            title="Hide author pages"
            detail="Useful on sites with one author, where the author page repeats the blog."
            checked={draft.noindex_author}
            onChange={(value) => set("noindex_author", value)}
          />
          <CheckRow
            title="Hide date archives"
            detail="Date archives repeat content that is already listed elsewhere."
            checked={draft.noindex_date}
            onChange={(value) => set("noindex_date", value)}
          />
        </div>
      </Section>

      <Section title="Technical">
        <div className="divide-y">
          <CheckRow
            title="Canonical links"
            detail="Tells search engines each page's preferred address, so tracking links and duplicates count as one page."
            checked={draft.canonical}
            onChange={(value) => set("canonical", value)}
          />
          <CheckRow
            title="XML sitemap"
            detail="WordPress's built-in sitemap at /wp-sitemap.xml, which search engines use to find your pages."
            checked={draft.sitemap}
            onChange={(value) => set("sitemap", value)}
          />
        </div>
      </Section>

      <LocalSection
        site={site}
        local={draft.local}
        siteName={data.site_name}
        knownPages={{ ...data.location_pages, ...picked }}
        onPicked={(page) =>
          setPicked({
            ...picked,
            [String(page.id)]: { title: page.title, url: page.url },
          })
        }
        onChange={(local) => set("local", local)}
      />

      <PagesSection site={site} seo={data} />
    </>
  );
}

const SEO_VIEWS = [
  { value: "settings", label: "Settings" },
  { value: "redirects", label: "Redirects" },
  { value: "404", label: "404 log" },
  { value: "migrate", label: "Import" },
];

/** The SEO tab: site-wide settings and page overrides, and redirects. */
export function SeoTab(props: { site: SiteSummary }) {
  const [view, setView] = useState("settings");
  return (
    <Tabs value={view} onValueChange={setView} className="mt-6 gap-0">
      <ResponsiveTabsList tabs={SEO_VIEWS} value={view} onChange={setView} label="SEO section" />
      <TabsContent value="settings">
        <SeoSettingsPanel site={props.site} onMigrate={() => setView("migrate")} />
      </TabsContent>
      <TabsContent value="redirects">
        <RedirectsTab site={props.site} />
      </TabsContent>
      <TabsContent value="404">
        <NotFoundTab site={props.site} />
      </TabsContent>
      <TabsContent value="migrate">
        <MigrateTab site={props.site} />
      </TabsContent>
    </Tabs>
  );
}

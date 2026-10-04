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
import { Textarea } from "@/components/ui/textarea";
import { compareVersions, SEO_SINCE } from "../../shared/plugin-version";
import { SEO_SEPARATORS, type SeoPage, type SeoSettings, type SiteSeo, type SiteSummary } from "../../shared/types";
import { fetchSeo, fetchSeoPages, saveSeo, saveSeoPage } from "../api";
import { Spinner } from "./Spinner";
import { EmptyRow, Section } from "./Section";

const SELECT_CLASS =
  "h-8 max-w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const TITLE_LENGTH = 60;
const DESCRIPTION_LENGTH = 160;

function Row(props: { title: string; detail?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-sm">
        <p className="text-sm font-medium">{props.title}</p>
        {props.detail && <p className="mt-0.5 text-xs text-muted-foreground">{props.detail}</p>}
      </div>
      <div className="min-w-0 sm:w-80">{props.children}</div>
    </div>
  );
}

function CheckRow(props: { title: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{props.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{props.detail}</p>
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
    <span className={over ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
      {props.value.length} of about {props.limit} characters
    </span>
  );
}

/** Fill a title template the way the plugin does. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/%(title|sitename|tagline|sep)%/g, (_, name: string) => vars[name] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** How a result might look in search, for the title and description in play. */
function Preview(props: { title: string; url: string; description: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <p className="truncate text-xs text-muted-foreground">{props.url}</p>
      <p className="mt-0.5 truncate text-base text-blue-700 dark:text-blue-300">{props.title || "Untitled"}</p>
      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
        {props.description || "No description. Search engines will pick text from the page."}
      </p>
    </div>
  );
}

function PageDialog(props: { site: SiteSummary; seo: SiteSeo; page: SeoPage; onClose: () => void }) {
  const { site, seo, page } = props;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(page.seo_title);
  const [description, setDescription] = useState(page.description);
  const [noindex, setNoindex] = useState(page.noindex);
  const [image, setImage] = useState(page.image);
  const save = useMutation({
    mutationFn: () => saveSeoPage(site.id, page.id, { seo_title: title, description, noindex, image }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site", site.id, "seo", "pages"] });
      props.onClose();
    },
  });
  const vars = { title: page.title, sitename: seo.site_name, tagline: seo.tagline, sep: seo.settings.separator };
  const shownTitle = fillTemplate(title || seo.settings.title_template, vars);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{page.title || "Untitled"}</DialogTitle>
          <DialogDescription>Leave a field empty to use the site-wide defaults.</DialogDescription>
        </DialogHeader>
        <Preview title={shownTitle} url={page.permalink} description={description || page.excerpt} />
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
            <label className="text-sm font-medium" htmlFor="seo-page-description">
              Meta description
            </label>
            <Textarea
              id="seo-page-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={page.excerpt}
              rows={3}
            />
            <Counter value={description || page.excerpt} limit={DESCRIPTION_LENGTH} />
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
            <span className="text-sm">Ask search engines not to list this page</span>
          </label>
        </div>
        {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
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
          <Spinner className="size-5 text-muted-foreground" label="Loading pages" />
        </div>
      ) : pages.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{pages.error.message}</p>
      ) : pages.data.items.length === 0 ? (
        <EmptyRow>No published pages match.</EmptyRow>
      ) : (
        <ul className="divide-y">
          {pages.data.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.title || "Untitled"}</p>
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
              <Button variant="outline" size="sm" onClick={() => setEditing(item)}>
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
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
      {editing && <PageDialog site={site} seo={seo} page={editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

/** The SEO tab: titles, descriptions, social tags, search visibility and per-page overrides. */
export function SeoTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, SEO_SINCE) >= 0;
  const seo = useQuery({ queryKey: ["site", site.id, "seo"], queryFn: () => fetchSeo(site.id), enabled: supported });
  const [draft, setDraft] = useState<SeoSettings | null>(null);
  const saved = seo.data?.settings;
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);
  const save = useMutation({
    mutationFn: (settings: SeoSettings) => saveSeo(site.id, settings),
    onSuccess: (data) => queryClient.setQueryData(["site", site.id, "seo"], data),
  });

  if (!supported) {
    return (
      <Section title="SEO">
        <EmptyRow>
          SEO needs KontrolWP Connect {SEO_SINCE} or later on this site. It updates automatically; select Sync now to
          check.
        </EmptyRow>
      </Section>
    );
  }
  if (seo.isPending || !draft) {
    return seo.error ? (
      <p className="text-sm text-destructive">{seo.error.message}</p>
    ) : (
      <div className="flex justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" label="Loading SEO settings" />
      </div>
    );
  }
  const data = seo.data!;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = <K extends keyof SeoSettings>(key: K, value: SeoSettings[K]) => setDraft({ ...draft, [key]: value });
  const vars = { sitename: data.site_name, tagline: data.tagline, sep: draft.separator };
  const homeTitle = fillTemplate(draft.home_title || `${data.site_name} %sep% ${data.tagline}`, vars);
  const homeDescription = draft.home_description || data.tagline;

  return (
    <>
      <div className="mt-6 grid gap-3 empty:hidden">
        {data.conflict && (
          <div className="flex items-start gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-200">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <p>
              {data.conflict} is active on this site, so KontrolWP does not add SEO tags. Two sets of tags on a page
              confuse search engines. Deactivate {data.conflict} to use these settings.
            </p>
          </div>
        )}
        {data.discouraged && (
          <div className="flex items-start gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-200">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <p>
              WordPress is set to discourage search engines (Settings, Reading), so search engines are asked to skip
              every page whatever you set here.
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
              <Button variant="outline" size="sm" onClick={() => setDraft(data.settings)}>
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
        {save.error && <p className="border-t px-4 py-3 text-sm text-destructive">{save.error.message}</p>}
      </Section>

      <Section title="Titles and descriptions">
        <div className="divide-y">
          <Row title="Separator" detail="Goes between the parts of a title.">
            <select
              aria-label="Title separator"
              className={SELECT_CLASS}
              value={draft.separator}
              onChange={(event) => set("separator", event.target.value as SeoSettings["separator"])}
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
          <Row title="Home page title" detail="Empty uses the site name and tagline.">
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
            <p className="mb-2 text-xs text-muted-foreground">Home page in search results</p>
            <Preview title={homeTitle} url={data.home_url} description={homeDescription} />
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
              <Row title="Default image address" detail="Used when a page has no featured image or social image.">
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
                  onChange={(event) => set("twitter_card", event.target.value as SeoSettings["twitter_card"])}
                >
                  <option value="summary_large_image">Large image</option>
                  <option value="summary">Small image</option>
                </select>
              </Row>
              <Row title="Twitter or X handle" detail="Optional, such as @yourbrand.">
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

      <PagesSection site={site} seo={data} />
    </>
  );
}

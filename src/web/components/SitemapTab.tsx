import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SitemapPage, SiteSummary } from "../../shared/types";
import { fetchSitePages } from "../api";
import { plural } from "../format";
import { EmptyRow, Section } from "./Section";

const PAGE_SIZE = 50;

/** "/about/team" for an address on the site; the whole address for anything else. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

/** The sitemap's date as a local date, or the text as written when it is not one. */
function formatModified(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Newest changes first; pages with no date follow, by address. */
function byModified(a: SitemapPage, b: SitemapPage): number {
  const da = a.lastmod ? Date.parse(a.lastmod) : NaN;
  const db = b.lastmod ? Date.parse(b.lastmod) : NaN;
  if (Number.isNaN(da) !== Number.isNaN(db)) return Number.isNaN(da) ? 1 : -1;
  if (!Number.isNaN(da) && da !== db) return db - da;
  return a.url.localeCompare(b.url);
}

/** A static site's pages, read from its sitemap each time the tab opens. */
export function SitemapTab(props: { site: SiteSummary }) {
  const { site } = props;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pages = useQuery({
    queryKey: ["site", site.id, "pages"],
    queryFn: () => fetchSitePages(site.id),
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });

  const query = search.trim().toLowerCase();
  const sorted = useMemo(() => [...(pages.data?.items ?? [])].sort(byModified), [pages.data]);
  const shown = useMemo(
    () => (query ? sorted.filter((item) => item.url.toLowerCase().includes(query)) : sorted),
    [sorted, query],
  );

  if (pages.isPending) {
    return (
      <Section title="Pages">
        <EmptyRow>Reading the sitemap...</EmptyRow>
      </Section>
    );
  }
  if (pages.error) {
    return (
      <Section title="Pages">
        <p className="px-4 py-6 text-center text-sm text-destructive">{pages.error.message}</p>
      </Section>
    );
  }
  const data = pages.data;
  if (!data.sitemap_url) {
    return (
      <Section title="Pages">
        <EmptyRow>
          KontrolWP did not find a sitemap for this site. It looked in robots.txt, /sitemap.xml and /sitemap_index.xml.
        </EmptyRow>
      </Section>
    );
  }

  const last = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, last);
  const rows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const anyDate = data.items.some((item) => item.lastmod);

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{`Pages (${data.total.toLocaleString()})`}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => pages.refetch()}
            disabled={pages.isFetching}
            title="Read the sitemap again"
            aria-label="Read the sitemap again"
          >
            <RefreshCwIcon className={pages.isFetching ? "animate-spin" : ""} />
          </Button>
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search pages"
              aria-label="Search pages"
              className="pl-8"
            />
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border bg-background">
        {rows.length ? (
          <ul className="divide-y text-sm">
            {rows.map((item) => (
              <li key={item.url} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex min-w-0 items-center gap-1.5 hover:underline"
                  title={item.url}
                >
                  <span className="truncate font-medium">{pathOf(item.url)}</span>
                  <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
                </a>
                {anyDate && (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatModified(item.lastmod)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyRow>{query ? "No pages match your search." : "The sitemap lists no pages."}</EmptyRow>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate" title={data.sitemap_url}>
          {query ? `${plural(shown.length, "match", "matches")} · ` : ""}From {pathOf(data.sitemap_url)}
          {data.truncated ? ` · showing the first ${data.items.length.toLocaleString()}` : ""}
        </span>
        {last > 1 && (
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <span className="tabular-nums">
              {current} / {last}
            </span>
            <Button size="sm" variant="outline" disabled={current >= last} onClick={() => setPage(current + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

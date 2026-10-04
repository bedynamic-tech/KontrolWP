import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { compareVersions, CONTENT_LIST_SINCE } from "../../shared/plugin-version";
import type { ContentStatus, ContentTypeInfo, SiteContentItem, SiteSummary } from "../../shared/types";
import { fetchContent, type ContentFilter } from "../api";
import { plural } from "../format";
import { EditButton } from "./LinksTab";
import { EmptyRow, Section } from "./Section";

const PAGE_SIZE = 25;

const STATUS_LABELS: Record<ContentStatus, string> = {
  publish: "Published",
  future: "Scheduled",
  draft: "Draft",
  pending: "Pending review",
  private: "Private",
};

const STATUS_TONES: Record<ContentStatus, string> = {
  publish: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  future: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  draft: "bg-muted text-muted-foreground",
  pending: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  private: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
};

/** What an older KontrolWP Connect lists: posts and pages, and no names for them. */
const CORE_TYPES: ContentTypeInfo[] = [
  { slug: "post", name: "Posts", singular: "Post" },
  { slug: "page", name: "Pages", singular: "Page" },
];

function supported(site: SiteSummary): boolean {
  return !site.plugin_version || compareVersions(site.plugin_version, CONTENT_LIST_SINCE) >= 0;
}

const formatDate = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** The Posts and pages tab: the site's content, filtered by status and type, read live from the site. */
export function ContentTab(props: { site: SiteSummary }) {
  const { site } = props;
  const [status, setStatus] = useState<ContentFilter["status"]>("all");
  const [type, setType] = useState<ContentFilter["type"]>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  // Search once typing pauses, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const content = useQuery({
    queryKey: ["site", site.id, "content", status, type, query, page],
    queryFn: () => fetchContent(site.id, { status, type, search: query, page }),
    enabled: supported(site),
    placeholderData: keepPreviousData,
    refetchInterval: false,
  });

  if (!supported(site)) {
    return (
      <Section title="Posts and pages">
        <EmptyRow>
          Listing posts and pages needs KontrolWP Connect {CONTENT_LIST_SINCE} or later. This site runs{" "}
          {site.plugin_version}; it updates automatically.
        </EmptyRow>
      </Section>
    );
  }
  if (content.isPending) {
    return (
      <Section title="Posts and pages">
        <EmptyRow>Loading posts and pages...</EmptyRow>
      </Section>
    );
  }
  if (content.error) {
    return (
      <Section title="Posts and pages">
        <p className="px-4 py-6 text-center text-sm text-destructive">{content.error.message}</p>
      </Section>
    );
  }

  const { items, counts, total } = content.data;
  const types = content.data.types ?? CORE_TYPES;
  const typeOptions = [{ slug: "all", name: "All types", singular: "" }, ...types];
  const all = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const chips: { value: ContentFilter["status"]; label: string; count: number }[] = [
    { value: "all", label: "All", count: all },
    ...(Object.keys(STATUS_LABELS) as ContentStatus[]).map((value) => ({
      value,
      label: STATUS_LABELS[value],
      count: counts[value],
    })),
  ];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(total, page * PAGE_SIZE);

  function choose<T>(set: (value: T) => void, value: T) {
    set(value);
    setPage(1);
  }

  return (
    <section className="mt-8">
      <div className="mb-3 space-y-2">
        <div className="flex max-w-full min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
          {chips
            .filter((chip) => chip.value === "all" || chip.count > 0 || chip.value === status)
            .map((chip) => (
              <Button
                key={chip.value}
                size="sm"
                variant={status === chip.value ? "secondary" : "ghost"}
                className="flex-none"
                onClick={() => choose(setStatus, chip.value)}
                aria-pressed={status === chip.value}
              >
                {chip.label}
                <span className="text-muted-foreground tabular-nums">{chip.count}</span>
              </Button>
            ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            {typeOptions.map((option) => (
              <Button
                key={option.slug}
                size="sm"
                variant={type === option.slug ? "outline" : "ghost"}
                onClick={() => choose(setType, option.slug)}
                aria-pressed={type === option.slug}
              >
                {option.name}
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search titles and content"
              aria-label="Search titles and content"
              className="pl-8"
            />
          </div>
        </div>
      </div>
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-background",
          content.isPlaceholderData && "opacity-60 transition-opacity",
        )}
      >
        {items.length ? (
          <ContentList site={site} items={items} types={types} />
        ) : (
          <EmptyRow>{query ? "Nothing matches your search." : "Nothing here yet."}</EmptyRow>
        )}
      </div>
      {total > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {first.toLocaleString()} to {last.toLocaleString()} of {plural(total, "item")}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function StatusBadge(props: { item: SiteContentItem }) {
  const { item } = props;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium",
        STATUS_TONES[item.status],
      )}
    >
      {STATUS_LABELS[item.status]}
    </span>
  );
}

function Actions(props: { site: SiteSummary; item: SiteContentItem }) {
  const { site, item } = props;
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="icon-xs"
        variant="ghost"
        asChild
        title={
          item.status === "publish" ? "View on the site" : "Open on the site (WordPress sign-in needed to preview)"
        }
      >
        <a href={item.permalink} target="_blank" rel="noreferrer noopener" aria-label="View on the site">
          <ExternalLinkIcon />
        </a>
      </Button>
      <EditButton site={site} postId={item.id} />
    </div>
  );
}

function ContentList(props: { site: SiteSummary; items: SiteContentItem[]; types: ContentTypeInfo[] }) {
  const { site, items, types } = props;
  const typeLabel = (item: SiteContentItem) => types.find((type) => type.slug === item.type)?.singular || item.type;
  const title = (item: SiteContentItem) => item.title || `(no title) #${item.id}`;
  return (
    <>
      {/* Phones: one item per row. */}
      <ul className="divide-y text-sm md:hidden">
        {items.map((item) => (
          <li key={item.id} className="space-y-1.5 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 font-medium break-words">{title(item)}</p>
              <Actions site={site} item={item} />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <StatusBadge item={item} />
              <span>{typeLabel(item)}</span>
              {item.author && <span>{item.author}</span>}
              <span>{formatDate(item.date)}</span>
            </div>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Author</th>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((item) => (
            <tr key={item.id} className="align-middle">
              <td className="w-full max-w-0 px-4 py-2.5">
                <a
                  href={item.permalink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block truncate font-medium hover:underline"
                  title={title(item)}
                >
                  {title(item)}
                </a>
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{typeLabel(item)}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <StatusBadge item={item} />
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{item.author}</td>
              <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{formatDate(item.date)}</td>
              <td className="px-4 py-2.5">
                <Actions site={site} item={item} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

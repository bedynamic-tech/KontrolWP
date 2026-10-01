import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  DownloadIcon,
  EyeOffIcon,
  ImageIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  UndoIcon,
  UnlinkIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { compareVersions, LINK_CHECK_SINCE, LINK_UNLINK_SINCE, MAGIC_LOGIN_SINCE } from "../../shared/plugin-version";
import type { LinkRef, LinkScan, LinkUnlinkResult, SiteLink, SiteLinks, SiteSummary } from "../../shared/types";
import { createMagicLogin, fetchLinks, ignoreLink, recheckLink, scanLinks, unlinkLinks } from "../api";
import { download, linksTable, toCsv, toXlsx } from "../export";
import { hostname, plural, timeAgo } from "../format";
import { EmptyRow, Section } from "./Section";

type Filter = "problems" | "broken" | "unresponsive" | "blocked" | "ignored";

const STATUS_LABEL: Record<"broken" | "unresponsive" | "blocked", string> = {
  broken: "Broken",
  unresponsive: "Unresponsive",
  blocked: "Couldn't check",
};

const STATUS_CLASS: Record<"broken" | "unresponsive" | "blocked", string> = {
  broken: "bg-destructive/10 text-destructive",
  unresponsive: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  blocked: "bg-muted text-muted-foreground",
};

/** References shown per link before "and N more". */
const REFS_SHOWN = 3;

function supported(site: SiteSummary): boolean {
  return !site.plugin_version || compareVersions(site.plugin_version, LINK_CHECK_SINCE) >= 0;
}

/** Remove link takes a broken or unresponsive link out of posts; images, ignored links and ones that couldn't be checked are left alone. */
const removable = (link: SiteLink) =>
  !link.ignored && link.status !== "blocked" && link.refs.some((ref) => ref.kind === "link");

/** A scheduled check waiting its turn in the queue (sites are spaced a couple of minutes apart). */
const queued = (scan: LinkScan | null | undefined) =>
  scan?.status === "collecting" && scan.started_at > Math.floor(Date.now() / 1000);

const running = (scan: LinkScan | null | undefined) =>
  (scan?.status === "collecting" || scan?.status === "checking") && !queued(scan);

/** The Links tab: scan published posts and pages for broken links, and fix them one by one. */
export function LinksTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("problems");
  const [search, setSearch] = useState("");
  const [unlinking, setUnlinking] = useState<SiteLink[] | null>(null);
  const [unlinked, setUnlinked] = useState<LinkUnlinkResult | null>(null);
  const canUnlink = !!site.plugin_version && compareVersions(site.plugin_version, LINK_UNLINK_SINCE) >= 0;
  const links = useQuery({
    queryKey: ["site", site.id, "links"],
    queryFn: () => fetchLinks(site.id),
    enabled: supported(site),
    // Follow a scan while it runs; otherwise results only change on request.
    refetchInterval: (query) =>
      running(query.state.data?.scan) ? 3000 : queued(query.state.data?.scan) ? 60_000 : false,
  });
  const setData = (data: SiteLinks) => queryClient.setQueryData(["site", site.id, "links"], data);
  const scan = useMutation({
    mutationFn: () => scanLinks(site.id),
    onSuccess: setData,
  });

  if (!supported(site)) {
    return (
      <Section title="Links">
        <EmptyRow>
          Checking links needs KontrolWP Connect {LINK_CHECK_SINCE} or later. This site runs {site.plugin_version}; it
          updates automatically.
        </EmptyRow>
      </Section>
    );
  }
  if (links.isPending) {
    return (
      <Section title="Links">
        <EmptyRow>Loading links...</EmptyRow>
      </Section>
    );
  }
  if (links.error) {
    return (
      <Section title="Links">
        <p className="px-4 py-6 text-center text-sm text-destructive">{links.error.message}</p>
      </Section>
    );
  }

  const data = links.data;
  const busy = running(data.scan) || scan.isPending;
  const scanButton = (
    <Button size="sm" variant={data.scan ? "outline" : "default"} onClick={() => scan.mutate()} disabled={busy}>
      <RefreshCwIcon className={busy ? "animate-spin" : ""} />
      {busy ? "Scanning..." : data.scan ? "Scan again" : "Scan now"}
    </Button>
  );

  if (!data.scan) {
    return (
      <Section title="Links" action={scanButton}>
        <div className="space-y-1 px-4 py-8 text-center text-sm">
          <p className="font-medium">Find broken links</p>
          <p className="text-muted-foreground">
            Scan every published post and page for links and images that no longer load.
          </p>
          {scan.error && <p className="text-destructive">{scan.error.message}</p>}
        </div>
      </Section>
    );
  }

  const { counts } = data;
  const problems = counts.broken + counts.unresponsive + counts.blocked;
  const query = search.trim().toLowerCase();
  const shown = data.links.filter((link) => {
    if (filter === "ignored" ? !link.ignored : link.ignored) return false;
    if (filter !== "problems" && filter !== "ignored" && link.status !== filter) return false;
    return (
      !query ||
      link.url.toLowerCase().includes(query) ||
      link.refs.some(
        (ref) => ref.post_title.toLowerCase().includes(query) || ref.link_text.toLowerCase().includes(query),
      )
    );
  });

  const brokenLinks = data.links.filter((link) => link.status === "broken" && removable(link));
  const onUnlink = canUnlink ? (urls: SiteLink[]) => setUnlinking(urls) : undefined;

  /** Saves the links in the current view, as filtered and searched, in the chosen format. */
  function exportLinks(format: "csv" | "xlsx") {
    const view = chips.find((chip) => chip.value === filter)?.label ?? "links";
    const name = `${hostname(site.url)} ${view} ${new Date().toISOString().slice(0, 10)}`
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-");
    const table = linksTable(shown);
    if (format === "csv") download(`${name}.csv`, toCsv(table), "text/csv;charset=utf-8");
    else {
      download(
        `${name}.xlsx`,
        toXlsx(table, view, [18, 12, 40, 60, 20, 40, 60]),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    }
  }

  const chips: { value: Filter; label: string; count: number }[] = [
    { value: "problems", label: "All problems", count: problems },
    { value: "broken", label: "Broken", count: counts.broken },
    {
      value: "unresponsive",
      label: "Unresponsive",
      count: counts.unresponsive,
    },
    { value: "blocked", label: "Couldn't check", count: counts.blocked },
    { value: "ignored", label: "Ignored", count: counts.ignored },
  ];

  return (
    <>
      {data.scan.status === "done" ? (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Link check</h2>
            {scanButton}
          </div>
          <ScanCards scan={data.scan} counts={counts} />
          {scan.error && <p className="mt-2 text-sm text-destructive">{scan.error.message}</p>}
        </section>
      ) : (
        <Section title="Link check" action={scanButton}>
          <ScanSummary scan={data.scan} counts={counts} />
          {scan.error && <p className="border-t px-4 py-2.5 text-sm text-destructive">{scan.error.message}</p>}
        </Section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-2 xl:flex-nowrap">
          <div className="flex max-w-full min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
            {chips
              .filter((chip) => chip.value === "problems" || chip.count > 0 || chip.value === filter)
              .map((chip) => (
                <Button
                  key={chip.value}
                  size="sm"
                  variant={filter === chip.value ? "secondary" : "ghost"}
                  className="flex-none"
                  onClick={() => setFilter(chip.value)}
                  aria-pressed={filter === chip.value}
                >
                  {chip.label}
                  <span className="text-muted-foreground tabular-nums">{chip.count}</span>
                </Button>
              ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {onUnlink && brokenLinks.length > 0 && filter !== "ignored" && (
              <Button size="sm" variant="outline" className="flex-none" onClick={() => onUnlink(brokenLinks)}>
                <UnlinkIcon /> Remove broken links ({brokenLinks.length})
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="flex-none" disabled={!shown.length}>
                  <DownloadIcon /> Download <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => exportLinks("csv")}>CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportLinks("xlsx")}>Excel (.xlsx)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="relative w-full sm:w-64">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search links or posts"
                aria-label="Search links or posts"
                className="pl-8"
              />
            </div>
          </div>
        </div>
        {unlinked && <UnlinkNotice result={unlinked} onClose={() => setUnlinked(null)} />}
        <div className="overflow-hidden rounded-xl border bg-background">
          {shown.length ? (
            <LinkList site={site} links={shown} onChange={setData} onUnlink={onUnlink} />
          ) : (
            <EmptyRow>
              {query
                ? "No links match your search."
                : filter === "ignored"
                  ? "No ignored links."
                  : running(data.scan)
                    ? "No problems found yet. The scan is still running."
                    : filter === "problems"
                      ? `No problems found in ${plural(counts.total, "link")}.`
                      : "No links in this group."}
            </EmptyRow>
          )}
        </div>
        {data.links.length >= 1000 && (
          <p className="mt-2 text-xs text-muted-foreground">Showing the first 1,000 links that need a look.</p>
        )}
      </section>
      <UnlinkDialog
        site={site}
        links={unlinking}
        onClose={() => setUnlinking(null)}
        onDone={(response) => {
          setData(response.links);
          setUnlinked(response.result);
          setUnlinking(null);
        }}
      />
    </>
  );
}

/** Confirms Remove link, for one link or every broken one. */
function UnlinkDialog(props: {
  site: SiteSummary;
  links: SiteLink[] | null;
  onClose: () => void;
  onDone: (response: { result: LinkUnlinkResult; links: SiteLinks }) => void;
}) {
  const links = props.links ?? [];
  const unlink = useMutation({
    mutationFn: () =>
      unlinkLinks(
        props.site.id,
        links.map((link) => link.url),
      ),
    onSuccess: props.onDone,
  });
  const posts = new Set(
    links.flatMap((link) => link.refs.filter((ref) => ref.kind === "link").map((ref) => ref.post_id)),
  );
  const one = links.length === 1 ? links[0] : null;
  return (
    <Dialog
      open={props.links !== null}
      onOpenChange={(open) => {
        if (!open && !unlink.isPending) {
          unlink.reset();
          props.onClose();
        }
      }}
    >
      <DialogContent className="[&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{one ? "Remove this link?" : `Remove ${links.length} broken links?`}</DialogTitle>
          <DialogDescription>
            {one ? (
              <>
                The link to{" "}
                <span className="font-medium break-all text-foreground">{one.url.replace(/^https?:\/\//, "")}</span>{" "}
                comes out of {plural(posts.size, "post")}.
              </>
            ) : (
              <>These links come out of {plural(posts.size, "post")}.</>
            )}{" "}
            The linked text stays as plain text. WordPress saves a revision of each post, so you can undo this from the
            post's Revisions.
          </DialogDescription>
        </DialogHeader>
        {unlink.error && <p className="text-sm text-destructive">{unlink.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose} disabled={unlink.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => unlink.mutate()} loading={unlink.isPending}>
            {unlink.isPending ? "Removing..." : one ? "Remove link" : "Remove links"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnlinkNotice(props: { result: LinkUnlinkResult; onClose: () => void }) {
  const { result } = props;
  const notes = [
    result.posts_changed
      ? `Removed from ${plural(result.posts_changed, "post")}.`
      : "Nothing changed; the posts no longer had these links.",
    result.buttons_kept
      ? `${plural(result.buttons_kept, "button")} kept, since removing a button's link breaks it; edit those posts to change them.`
      : "",
    result.images_kept
      ? `Images using ${result.images_kept === 1 ? "this address" : "these addresses"} were left in place.`
      : "",
  ].filter(Boolean);
  return (
    <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-900 dark:text-emerald-200">
      <p>{notes.join(" ")}</p>
      <button type="button" className="text-xs underline-offset-2 hover:underline" onClick={props.onClose}>
        Dismiss
      </button>
    </div>
  );
}

function ScanSummary(props: { scan: LinkScan; counts: SiteLinks["counts"] }) {
  const { scan, counts } = props;
  if (queued(scan)) {
    const minutes = Math.max(1, Math.ceil((scan.started_at - Date.now() / 1000) / 60));
    return (
      <p className="px-4 py-4 text-sm text-muted-foreground">
        The scheduled check is queued and starts in {plural(minutes, "minute")}. Sites are checked one at a time.
      </p>
    );
  }
  if (scan.status === "collecting" || scan.status === "checking") {
    const percent =
      scan.status === "checking" && scan.total_urls ? Math.round((scan.checked_urls / scan.total_urls) * 100) : 0;
    return (
      <div className="space-y-2 px-4 py-4">
        <p className="text-sm">
          {scan.status === "collecting"
            ? `Reading published content${scan.posts_scanned ? ` (${plural(scan.posts_scanned, "post")} so far)` : ""}...`
            : `Checking links: ${scan.checked_urls.toLocaleString()} of ${scan.total_urls.toLocaleString()}`}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-[width]",
              scan.status === "collecting" && "w-1/4 animate-pulse",
            )}
            style={scan.status === "checking" ? { width: `${percent}%` } : undefined}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          The scan keeps running if you leave this page. Results from the last scan stay until each link is checked
          again.
        </p>
      </div>
    );
  }
  if (scan.status === "failed" || scan.status === "stopped") {
    return (
      <p className="px-4 py-4 text-sm text-destructive">
        {scan.status === "stopped" ? "The scan stopped before it finished. Scan again to restart it." : scan.error}
      </p>
    );
  }
  return null;
}

/** A finished scan as cards, in the style of the facts at the top of a site. */
function ScanCards(props: { scan: LinkScan; counts: SiteLinks["counts"] }) {
  const { scan, counts } = props;
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Links checked" value={scan.total_urls.toLocaleString()} />
      <StatCard label="Broken" value={counts.broken.toLocaleString()} tone={counts.broken ? "bad" : undefined} />
      <StatCard
        label="Unresponsive"
        value={counts.unresponsive.toLocaleString()}
        tone={counts.unresponsive ? "warn" : undefined}
      />
      <StatCard label="Last scan" value={timeAgo(scan.finished_at)} />
    </dl>
  );
}

function StatCard(props: { label: string; value: string; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd
        className={cn(
          "mt-1 truncate text-sm font-medium tabular-nums",
          props.tone === "bad" && "text-destructive",
          props.tone === "warn" && "text-amber-700 dark:text-amber-300",
        )}
      >
        {props.value}
      </dd>
    </div>
  );
}

function LinkList(props: {
  site: SiteSummary;
  links: SiteLink[];
  onChange: (data: SiteLinks) => void;
  onUnlink?: (links: SiteLink[]) => void;
}) {
  return (
    <>
      {/* Phones: one link per row, its posts under it. */}
      <ul className="divide-y text-sm md:hidden">
        {props.links.map((link) => (
          <li key={link.url} className="space-y-2 px-4 py-3">
            <div className="flex items-start gap-2">
              <StatusBadge link={link} />
              <LinkCell link={link} />
            </div>
            <Refs site={props.site} refs={link.refs} />
            <Actions site={props.site} link={link} onChange={props.onChange} onUnlink={props.onUnlink} />
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Link</th>
            <th className="px-4 py-2 font-medium">Found in</th>
            <th className="px-4 py-2 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {props.links.map((link) => (
            <tr key={link.url} className="align-top">
              <td className="px-4 py-3 whitespace-nowrap">
                <StatusBadge link={link} />
              </td>
              <td className="w-1/2 max-w-0 px-4 py-3">
                <LinkCell link={link} />
              </td>
              <td className="w-1/2 max-w-0 px-4 py-3">
                <Refs site={props.site} refs={link.refs} />
              </td>
              <td className="px-4 py-3">
                <Actions site={props.site} link={link} onChange={props.onChange} onUnlink={props.onUnlink} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function StatusBadge(props: { link: SiteLink }) {
  const { link } = props;
  if (link.status === "ok" || link.status === "pending") {
    return (
      <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-emerald-500/10 px-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        {link.status === "ok" ? "Working" : "Not checked"}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium",
        STATUS_CLASS[link.status],
      )}
      title={link.error ?? undefined}
    >
      {STATUS_LABEL[link.status]}
      {link.http_status !== null && <span className="tabular-nums opacity-80">{link.http_status}</span>}
    </span>
  );
}

function LinkCell(props: { link: SiteLink }) {
  const { link } = props;
  const image = link.refs.some((ref) => ref.kind === "image");
  const text = link.refs.find((ref) => ref.link_text)?.link_text;
  return (
    <div className="min-w-0 flex-1">
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer noopener"
        className="block truncate font-medium hover:underline"
        title={link.url}
      >
        {image && <ImageIcon className="mr-1 inline size-3.5 align-[-2px] text-muted-foreground" aria-label="Image" />}
        {link.url.replace(/^https?:\/\//, "")}
      </a>
      <p className="mt-0.5 line-clamp-2 text-xs break-words text-muted-foreground">
        {[text && `"${text}"`, link.error, link.checked_at && `Checked ${timeAgo(link.checked_at).toLowerCase()}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

function Refs(props: { site: SiteSummary; refs: LinkRef[] }) {
  const [all, setAll] = useState(false);
  if (!props.refs.length) return <p className="text-xs text-muted-foreground">No longer in any post</p>;
  const shown = all ? props.refs : props.refs.slice(0, REFS_SHOWN);
  return (
    <ul className="space-y-1">
      {shown.map((ref) => (
        <li key={`${ref.post_id} ${ref.kind}`} className="flex min-w-0 items-center gap-1">
          <a
            href={ref.permalink || undefined}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 truncate hover:underline"
            title={ref.permalink}
          >
            {ref.post_title || `(no title) #${ref.post_id}`}
          </a>
          <span className="shrink-0 text-xs text-muted-foreground">{typeLabel(ref.post_type)}</span>
          <EditButton site={props.site} postId={ref.post_id} />
        </li>
      ))}
      {props.refs.length > REFS_SHOWN && !all && (
        <li>
          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setAll(true)}>
            and {props.refs.length - REFS_SHOWN} more
          </button>
        </li>
      )}
    </ul>
  );
}

function typeLabel(type: string): string {
  if (type === "post") return "Post";
  if (type === "page") return "Page";
  return type.replace(/[_-]+/g, " ");
}

/** Opens the post in the WordPress editor, signed in with Magic Login when it is set up. */
function EditButton(props: { site: SiteSummary; postId: number }) {
  const { site, postId } = props;
  const [pending, setPending] = useState(false);
  const magic =
    !!site.login_user_id && !!site.plugin_version && compareVersions(site.plugin_version, MAGIC_LOGIN_SINCE) >= 0;
  const editUrl = new URL(
    `wp-admin/post.php?post=${postId}&action=edit`,
    site.url.endsWith("/") ? site.url : `${site.url}/`,
  ).href;

  async function open() {
    // Open the tab during the click, or the browser blocks it as a popup.
    const tab = window.open(magic ? "" : editUrl, "_blank");
    if (tab) tab.opener = null;
    if (!magic) return;
    setPending(true);
    try {
      const { url } = await createMagicLogin(site.id, postId);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch {
      // Without a sign-in link, the editor still opens if the browser is signed in.
      if (tab) tab.location.href = editUrl;
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      size="icon-xs"
      variant="ghost"
      className="shrink-0"
      onClick={open}
      disabled={pending}
      title={magic ? "Edit in WordPress (Magic Login)" : "Edit in WordPress"}
      aria-label="Edit in WordPress"
    >
      <PencilIcon className={pending ? "animate-pulse" : ""} />
    </Button>
  );
}

function Actions(props: {
  site: SiteSummary;
  link: SiteLink;
  onChange: (data: SiteLinks) => void;
  onUnlink?: (links: SiteLink[]) => void;
}) {
  const { site, link } = props;
  const recheck = useMutation({
    mutationFn: () => recheckLink(site.id, link.url),
    onSuccess: props.onChange,
  });
  const ignore = useMutation({
    mutationFn: () => ignoreLink(site.id, link.url, !link.ignored),
    onSuccess: props.onChange,
  });
  const error = recheck.error ?? ignore.error;
  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <div className="flex gap-1">
        {/* Ignored links are never checked again. */}
        {!link.ignored && (
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => recheck.mutate()}
            loading={recheck.isPending}
            title="Check this link again now"
            aria-label="Check again"
          >
            {!recheck.isPending && <RefreshCwIcon />}
          </Button>
        )}
        {props.onUnlink && removable(link) && (
          <Button
            size="icon-sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => props.onUnlink!([link])}
            title="Take this link out of its posts, keeping the text"
            aria-label="Remove link"
          >
            <UnlinkIcon />
          </Button>
        )}
        {link.ignored ? (
          <Button size="sm" variant="ghost" onClick={() => ignore.mutate()} loading={ignore.isPending}>
            {!ignore.isPending && <UndoIcon />}
            Unignore
          </Button>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => ignore.mutate()}
            loading={ignore.isPending}
            title="Ignore: hide this link from the problems and stop checking it"
            aria-label="Ignore"
          >
            {!ignore.isPending && <EyeOffIcon />}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { compareVersions, DATABASE_CLEANUP_SINCE } from "../../shared/plugin-version";
import {
  DATABASE_ITEMS,
  type DatabaseCleanup,
  type DatabaseCleanupResult,
  type DatabaseItem,
  type DatabaseReport,
  type SiteSummary,
} from "../../shared/types";
import { cleanDatabase, fetchDatabase } from "../api";
import { ErrorBoundary } from "./ErrorBoundary";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";

const ITEM_LABELS: Record<DatabaseItem, { title: string; hint: string; one: string; many?: string }> = {
  revisions: {
    title: "Post revisions",
    hint: "Earlier versions WordPress saves each time a post or page is edited. The current version of every post stays.",
    one: "revision",
  },
  auto_drafts: {
    title: "Auto-drafts",
    hint: "Empty drafts WordPress starts when the editor opens and never published. Ones from the last day are kept, in case an editor is still open.",
    one: "auto-draft",
  },
  trash_posts: {
    title: "Trashed posts and pages",
    hint: "Posts, pages and other content in the trash. They are deleted for good.",
    one: "trashed item",
  },
  spam_comments: {
    title: "Spam comments",
    hint: "Comments marked as spam.",
    one: "spam comment",
  },
  trash_comments: {
    title: "Trashed comments",
    hint: "Comments in the trash.",
    one: "trashed comment",
  },
  expired_transients: {
    title: "Expired transients",
    hint: "Temporary cached data that plugins stored and that has expired. Plugins make it again when they need it.",
    one: "transient",
  },
};

const HINT =
  "How big this site's database is, and leftovers that can be deleted to make it smaller: old revisions, trash, spam and expired cache data. Optimizing rebuilds tables to give back free space.";

/** "6,214 revisions": plural() with thousands separators. */
function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** "a, b and c". */
function list(parts: string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/** "1.4 MB", "820 KB", "0 B". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Tools > Database: the database's size and a cleanup of its leftovers. */
export function DatabaseTab(props: { site: SiteSummary }) {
  return (
    <ErrorBoundary label="Database cleanup">
      <Database site={props.site} />
    </ErrorBoundary>
  );
}

function Database({ site }: { site: SiteSummary }) {
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, DATABASE_CLEANUP_SINCE) >= 0;
  const key = ["site", site.id, "database"];
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchDatabase(site.id),
    enabled: supported,
  });
  // What the owner unticked; everything with something to delete starts ticked.
  const [unticked, setUnticked] = useState<Set<DatabaseItem | "optimize">>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DatabaseCleanupResult | null>(null);
  const clean = useMutation({
    mutationFn: (cleanup: DatabaseCleanup) => cleanDatabase(site.id, cleanup),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data.report);
      queryClient.invalidateQueries({ queryKey: ["site", site.id, "content"] });
      setResult(data);
      setConfirming(false);
    },
  });

  if (!supported) {
    return (
      <Section title="Database" hint={HINT}>
        <EmptyRow>
          Database cleanup needs KontrolWP Connect {DATABASE_CLEANUP_SINCE} or later on this site. It updates
          automatically; select Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  const report = query.data;
  if (!report) {
    return (
      <Section title="Database" hint={HINT}>
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

  const available = DATABASE_ITEMS.filter((item) => report.items[item].count > 0);
  const chosen = available.filter((item) => !unticked.has(item));
  const canOptimize = report.tables.overhead > 0;
  const optimize = canOptimize && !unticked.has("optimize");
  const toggle = (item: DatabaseItem | "optimize", on: boolean) =>
    setUnticked((current) => {
      const next = new Set(current);
      if (on) next.delete(item);
      else next.add(item);
      return next;
    });
  const nothing = chosen.length === 0 && !optimize;

  return (
    <>
      <Section
        title="Database"
        hint={HINT}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching || clean.isPending}
          >
            {query.isFetching ? "Checking..." : "Check again"}
          </Button>
        }
      >
        <dl className="grid grid-cols-3 divide-x">
          <Stat label="Size" value={formatBytes(report.tables.size)} />
          <Stat label="Tables" value={String(report.tables.count)} />
          <Stat label="Free space" value={formatBytes(report.tables.overhead)} />
        </dl>
      </Section>

      <Section
        title="Clean up"
        action={
          <Button size="sm" onClick={() => setConfirming(true)} disabled={nothing || clean.isPending}>
            Clean up
          </Button>
        }
      >
        {result && <CleanupNotice result={result} onClose={() => setResult(null)} />}
        <div className="divide-y">
          {DATABASE_ITEMS.map((item) => {
            const { count, bytes } = report.items[item];
            const labels = ITEM_LABELS[item];
            return (
              <CleanupRow
                key={item}
                title={labels.title}
                hint={labels.hint}
                detail={count ? `${plural(count, labels.one, labels.many)}, about ${formatBytes(bytes)}` : "None"}
                checked={count > 0 && !unticked.has(item)}
                disabled={count === 0 || clean.isPending}
                onChange={(on) => toggle(item, on)}
              />
            );
          })}
          <CleanupRow
            title="Optimize tables"
            hint="Rebuilds the tables that have free space inside them, so the database gives it back. Runs after the deletions. It can take a while on a large site."
            detail={canOptimize ? `${formatBytes(report.tables.overhead)} free` : "Nothing to free"}
            checked={optimize}
            disabled={!canOptimize || clean.isPending}
            onChange={(on) => toggle("optimize", on)}
          />
        </div>
      </Section>

      <LargestTables report={report} />

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !clean.isPending) {
            clean.reset();
            setConfirming(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clean up the database?</DialogTitle>
            <DialogDescription>
              {chosen.length > 0
                ? `This deletes ${list(
                    chosen.map((item) =>
                      plural(report.items[item].count, ITEM_LABELS[item].one, ITEM_LABELS[item].many),
                    ),
                  )} for good${optimize ? ", then optimizes the tables" : ""}. Deleted items cannot be brought back, so make sure the site has a recent backup.`
                : "This optimizes the tables that have free space. Nothing is deleted."}
            </DialogDescription>
          </DialogHeader>
          {clean.error && <p className="text-sm text-destructive">{clean.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={clean.isPending}>
              Cancel
            </Button>
            <Button
              variant={chosen.length > 0 ? "destructive" : "default"}
              onClick={() => clean.mutate({ items: chosen, optimize })}
              loading={clean.isPending}
            >
              {clean.isPending ? "Cleaning up..." : "Clean up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="truncate text-xs text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{props.value}</dd>
    </div>
  );
}

function CleanupRow(props: {
  title: string;
  hint: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className={`flex items-center gap-3 px-4 py-3 ${props.disabled ? "" : "cursor-pointer"}`}>
      <Checkbox
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className={`flex items-center gap-1.5 text-sm font-medium ${props.disabled ? "opacity-60" : ""}`}>
          {props.title}
          <HelpTip>{props.hint}</HelpTip>
        </p>
        <span className="text-sm text-muted-foreground sm:text-right">{props.detail}</span>
      </div>
    </label>
  );
}

function CleanupNotice(props: { result: DatabaseCleanupResult; onClose: () => void }) {
  const { result } = props;
  const deleted = DATABASE_ITEMS.filter((item) => (result.deleted[item] ?? 0) > 0).map((item) =>
    plural(result.deleted[item] ?? 0, ITEM_LABELS[item].one, ITEM_LABELS[item].many),
  );
  const notes = [
    deleted.length ? `Deleted ${list(deleted)}.` : result.optimized ? "" : "Nothing was deleted.",
    result.optimized ? `Optimized ${plural(result.optimized, "table")}.` : "",
    result.unfinished
      ? "Some are left because the site stopped to avoid timing out. Select Clean up again to finish."
      : "",
  ].filter(Boolean);
  return (
    <div className="flex items-start justify-between gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-900 dark:text-emerald-200">
      <p>{notes.join(" ")}</p>
      <button type="button" className="text-xs underline-offset-2 hover:underline" onClick={props.onClose}>
        Dismiss
      </button>
    </div>
  );
}

function LargestTables({ report }: { report: DatabaseReport }) {
  const tables = report.tables.largest;
  if (!tables.length) return null;
  return (
    <Section title="Largest tables">
      <div className="divide-y">
        {tables.map((table) => (
          <div key={table.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <p className="min-w-0 flex-1 truncate font-mono text-xs">{table.name}</p>
            <span className="hidden shrink-0 text-muted-foreground sm:inline">{plural(table.rows, "row")}</span>
            <span className="w-20 shrink-0 text-right font-medium">{formatBytes(table.bytes)}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

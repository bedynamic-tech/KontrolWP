import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, SearchIcon, UploadIcon } from "lucide-react";
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
import { compareVersions, SEO_AUTO_REDIRECTS_SINCE, SEO_REDIRECTS_SINCE } from "../../shared/plugin-version";
import { redirectsFromCsv, redirectsToCsv } from "../../shared/redirect-csv";
import {
  REDIRECT_CODES,
  REDIRECT_DELETE_ACTIONS,
  type AutoRedirectSettings,
  type RedirectDeleteAction,
  type Redirect,
  type RedirectImportResult,
  type RedirectInput,
  type SiteSummary,
} from "../../shared/types";
import {
  bulkRedirects,
  clearNotFound,
  createRedirect,
  fetchNotFound,
  fetchRedirects,
  importRedirects,
  setRedirectSettings,
  updateRedirect,
} from "../api";
import { timeAgo } from "../format";
import { SELECT_CLASS } from "./AnalyticsSection";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";

const CODE_LABELS: Record<number, string> = {
  301: "301 Moved permanently",
  302: "302 Found (temporary)",
  307: "307 Temporary, keep method",
  308: "308 Permanent, keep method",
  410: "410 Gone",
  451: "451 Unavailable for legal reasons",
};

const MATCH_LABELS = { exact: "Exact address", prefix: "Starts with", regex: "Regular expression" } as const;

const PER_PAGE = 25;

const blankRule = (): RedirectInput => ({
  source: "",
  match_type: "exact",
  target: "",
  status_code: 301,
  enabled: true,
});

function Pager(props: { page: number; total: number; perPage: number; onPage: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(props.total / props.perPage));
  if (last <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
      <span>
        Page {props.page} of {last}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={props.page >= last} onClick={() => props.onPage(props.page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

function Field(props: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium" htmlFor={props.htmlFor}>
        {props.label}
        {props.hint && <HelpTip>{props.hint}</HelpTip>}
      </label>
      {props.children}
    </div>
  );
}

function RuleDialog(props: { site: SiteSummary; rule: Redirect | null; initial: RedirectInput; onClose: () => void }) {
  const { site, rule } = props;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RedirectInput>(props.initial);
  const noTarget = draft.status_code === 410 || draft.status_code === 451;
  const save = useMutation({
    mutationFn: () => {
      const body = { ...draft, target: noTarget ? "" : draft.target.trim(), source: draft.source.trim() };
      return rule ? updateRedirect(site.id, rule.id, body) : createRedirect(site.id, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site", site.id, "seo", "redirects"] });
      queryClient.invalidateQueries({ queryKey: ["site", site.id, "seo", "404s"] });
      props.onClose();
    },
  });
  const set = <K extends keyof RedirectInput>(key: K, value: RedirectInput[K]) => setDraft({ ...draft, [key]: value });
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-lg [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit redirect" : "Add redirect"}</DialogTitle>
          <DialogDescription>Send visitors from one address on this site to another.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field
            label="Match"
            htmlFor="redirect-match"
            hint="Exact matches one address, ignoring capital letters and a trailing slash. Starts with matches an address and everything below it, and $1 in the target is the rest. A regular expression can use groups such as $1 and $2 in the target."
          >
            <select
              id="redirect-match"
              className={SELECT_CLASS}
              value={draft.match_type}
              onChange={(event) => set("match_type", event.target.value as RedirectInput["match_type"])}
            >
              {Object.entries(MATCH_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={draft.match_type === "regex" ? "Pattern" : "From address"}
            htmlFor="redirect-source"
            hint={
              draft.match_type === "regex"
                ? "Matched against the path, such as ^/blog/(\\d+)/(.*)$. Not case sensitive."
                : "The path on this site, such as /old-page. A full address is shortened to its path."
            }
          >
            <Input
              id="redirect-source"
              value={draft.source}
              onChange={(event) => set("source", event.target.value)}
              placeholder={draft.match_type === "regex" ? "^/blog/(.*)$" : "/old-page"}
            />
          </Field>
          <Field label="Type" htmlFor="redirect-code">
            <select
              id="redirect-code"
              className={SELECT_CLASS}
              value={draft.status_code}
              onChange={(event) => set("status_code", Number(event.target.value) as RedirectInput["status_code"])}
            >
              {REDIRECT_CODES.map((code) => (
                <option key={code} value={code}>
                  {CODE_LABELS[code]}
                </option>
              ))}
            </select>
          </Field>
          {!noTarget && (
            <Field
              label="To address"
              htmlFor="redirect-target"
              hint="A path on this site, or a full address starting with https://. Any query string on the visitor's address is kept."
            >
              <Input
                id="redirect-target"
                value={draft.target}
                onChange={(event) => set("target", event.target.value)}
                placeholder="/new-page"
              />
            </Field>
          )}
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={draft.enabled}
              onChange={(event) => set("enabled", event.target.checked)}
            />
            <span className="text-sm">Active</span>
          </label>
        </div>
        {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !draft.source.trim()}>
            {save.isPending && <Spinner className="size-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog(props: { site: SiteSummary; rows: Partial<RedirectInput>[]; onClose: () => void }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const [result, setResult] = useState<RedirectImportResult | null>(null);
  const run = useMutation({
    mutationFn: () => importRedirects(site.id, props.rows),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["site", site.id, "seo", "redirects"] });
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-lg [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Import redirects</DialogTitle>
          <DialogDescription>
            {result
              ? "Import finished."
              : `${props.rows.length} ${props.rows.length === 1 ? "row" : "rows"} found in the file. Redirects that already exist are skipped.`}
          </DialogDescription>
        </DialogHeader>
        {result && (
          <div className="grid gap-2 text-sm">
            <p>
              Added {result.added}, skipped {result.skipped} that already existed
              {result.errors.length > 0 ? `, ${result.errors.length} with problems.` : "."}
            </p>
            {result.errors.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded-lg border p-2 text-xs text-muted-foreground">
                {result.errors.map((error) => (
                  <li key={`${error.row}-${error.message}`}>
                    Row {error.row}: {error.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {run.error && <p className="text-sm text-destructive">{run.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={() => run.mutate()} disabled={run.isPending || props.rows.length === 0}>
              {run.isPending && <Spinner className="size-4" />}
              Import
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function RulesSection(props: { site: SiteSummary; hasAuto: boolean; onNew: (rule: Redirect | null) => void }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [autoOnly, setAutoOnly] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [importing, setImporting] = useState<Partial<RedirectInput>[] | null>(null);
  const [fileError, setFileError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);
  const rules = useQuery({
    queryKey: ["site", site.id, "seo", "redirects", page, term, autoOnly],
    queryFn: () => fetchRedirects(site.id, { page, search: term, per_page: PER_PAGE, auto: autoOnly }),
    placeholderData: (previous) => previous,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["site", site.id, "seo", "redirects"] });
  const bulk = useMutation({
    mutationFn: (input: { action: "enable" | "disable" | "delete"; ids: number[] }) =>
      bulkRedirects(site.id, input.action, input.ids),
    onSuccess: () => {
      setSelected([]);
      refresh();
    },
  });
  const exportAll = useMutation({
    mutationFn: () => fetchRedirects(site.id, { page: 1, search: "", export: true }),
    onSuccess: (data) => download("redirects.csv", redirectsToCsv(data.items)),
  });
  const items = rules.data?.items ?? [];
  const allSelected = items.length > 0 && items.every((item) => selected.includes(item.id));
  const readFile = async (chosen: File | undefined) => {
    setFileError("");
    if (!chosen) return;
    const rows = redirectsFromCsv(await chosen.text());
    if (rows.length === 0) setFileError("That file has no redirects in it.");
    else setImporting(rows);
  };
  return (
    <Section
      title="Redirects"
      hint="Send visitors and search engines from an old address to a new one. Rules run before WordPress builds the page."
      action={
        <div className="flex flex-wrap justify-end gap-2">
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              void readFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
            <UploadIcon className="size-4" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportAll.mutate()} disabled={exportAll.isPending}>
            <DownloadIcon className="size-4" />
            Export
          </Button>
          <Button size="sm" onClick={() => props.onNew(null)}>
            Add redirect
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <div className="relative w-full max-w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search redirects"
            aria-label="Search redirects"
            className="pl-8"
          />
        </div>
        {props.hasAuto && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={autoOnly}
              onChange={(event) => {
                setAutoOnly(event.target.checked);
                setPage(1);
              }}
            />
            Automatic only
          </label>
        )}
        {selected.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{selected.length} selected</span>
            <Button variant="outline" size="sm" onClick={() => bulk.mutate({ action: "enable", ids: selected })}>
              Enable
            </Button>
            <Button variant="outline" size="sm" onClick={() => bulk.mutate({ action: "disable", ids: selected })}>
              Disable
            </Button>
            <Button variant="outline" size="sm" onClick={() => bulk.mutate({ action: "delete", ids: selected })}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {(fileError || bulk.error || exportAll.error) && (
        <p className="border-b px-4 py-3 text-sm text-destructive">
          {fileError || bulk.error?.message || exportAll.error?.message}
        </p>
      )}
      {rules.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-5 text-muted-foreground" label="Loading redirects" />
        </div>
      ) : rules.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{rules.error.message}</p>
      ) : items.length === 0 ? (
        <EmptyRow>{term ? "No redirects match." : "No redirects yet."}</EmptyRow>
      ) : (
        <>
          <label className="flex items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={allSelected}
              onChange={(event) => setSelected(event.target.checked ? items.map((item) => item.id) : [])}
              aria-label="Select all on this page"
            />
            Select all on this page
          </label>
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))
                  }
                  aria-label={`Select ${item.source}`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-medium ${item.enabled ? "" : "text-muted-foreground line-through"}`}>
                    {item.source}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.target ? `to ${item.target}` : "No destination"} · {item.status_code}
                    {item.match_type !== "exact" ? ` · ${MATCH_LABELS[item.match_type].toLowerCase()}` : ""} ·{" "}
                    {item.hits} {item.hits === 1 ? "hit" : "hits"}
                    {item.last_hit ? `, last ${timeAgo(item.last_hit)}` : ""}
                    {item.enabled ? "" : " · Off"}
                    {item.auto ? " · Automatic" : ""}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => props.onNew(item)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <Pager page={page} total={rules.data?.total ?? 0} perPage={PER_PAGE} onPage={setPage} />
      {importing && <ImportDialog site={site} rows={importing} onClose={() => setImporting(null)} />}
    </Section>
  );
}

const DELETE_LABELS: Record<RedirectDeleteAction, string> = {
  none: "Do nothing",
  "410": "Show that the page is gone (410)",
  "301": "Redirect to another address",
};

/** Redirects KontrolWP makes by itself when content is moved or removed. */
function AutoSection(props: { site: SiteSummary; auto?: AutoRedirectSettings }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, SEO_AUTO_REDIRECTS_SINCE) >= 0;
  const [action, setAction] = useState<RedirectDeleteAction>(props.auto?.on_delete ?? "none");
  const [target, setTarget] = useState(props.auto?.target ?? "");
  // Follow what the site reports once it arrives or changes.
  const reportedAction = props.auto?.on_delete;
  const reportedTarget = props.auto?.target;
  useEffect(() => {
    if (reportedAction) setAction(reportedAction);
    if (reportedTarget !== undefined) setTarget(reportedTarget);
  }, [reportedAction, reportedTarget]);
  const save = useMutation({
    mutationFn: (change: Parameters<typeof setRedirectSettings>[1]) => setRedirectSettings(site.id, change),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site", site.id, "seo", "redirects"] }),
  });
  if (!supported) {
    return (
      <Section title="Automatic redirects">
        <EmptyRow>
          Automatic redirects need KontrolWP Connect {SEO_AUTO_REDIRECTS_SINCE} or later on this site. It updates
          automatically; select Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  if (!props.auto) return null;
  const dirty = action !== props.auto.on_delete || (action === "301" && target.trim() !== props.auto.target);
  return (
    <Section
      title="Automatic redirects"
      hint="Keeps links working when you change a page's address or remove it. Rules made this way are marked Automatic in the list below, and you can edit or delete them."
    >
      <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Enable automatic redirects
            <HelpTip>
              When a published page, post or other public content gets a new address, such as a changed slug or parent,
              or a category or tag is renamed, the old address is sent to the new one with a 301. Earlier automatic
              redirects are updated to point straight at the newest address. Pages below a moved page are covered too.
            </HelpTip>
          </p>
        </div>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={props.auto.enabled}
          disabled={save.isPending}
          onChange={(event) => save.mutate({ auto_enabled: event.target.checked })}
        />
      </label>
      {props.auto.enabled && (
        <div className="grid gap-3 border-t px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              When content is deleted or trashed
              <HelpTip>
                This also applies to deleted categories, tags and other terms. Moving content back out of the trash
                removes the rule made when it went in. Publishing new content at an address removes an automatic rule
                from that address.
              </HelpTip>
            </p>
            <select
              aria-label="When content is deleted or trashed"
              className={`${SELECT_CLASS} sm:w-80`}
              value={action}
              onChange={(event) => setAction(event.target.value as RedirectDeleteAction)}
            >
              {REDIRECT_DELETE_ACTIONS.map((value) => (
                <option key={value} value={value}>
                  {DELETE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          {action === "301" && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <label htmlFor="auto-redirect-target" className="text-sm font-medium">
                Send visitors to
              </label>
              <Input
                id="auto-redirect-target"
                className="sm:w-80"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="/ or https://"
              />
            </div>
          )}
          {dirty && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAction(props.auto!.on_delete);
                  setTarget(props.auto!.target);
                }}
              >
                Discard
              </Button>
              <Button
                size="sm"
                disabled={save.isPending}
                onClick={() => save.mutate({ on_delete: action, delete_target: action === "301" ? target.trim() : "" })}
              >
                Save
              </Button>
            </div>
          )}
        </div>
      )}
      {save.error && <p className="border-t px-4 py-3 text-sm text-destructive">{save.error.message}</p>}
    </Section>
  );
}

function NotFoundSection(props: { site: SiteSummary; logging: boolean; onRedirect: (path: string) => void }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const toggle = useMutation({
    mutationFn: (value: boolean) => setRedirectSettings(site.id, { log_404: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site", site.id, "seo", "redirects"] }),
  });
  const log = useQuery({
    queryKey: ["site", site.id, "seo", "404s", page],
    queryFn: () => fetchNotFound(site.id, page),
    enabled: props.logging,
    placeholderData: (previous) => previous,
  });
  const clear = useMutation({
    mutationFn: () => clearNotFound(site.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site", site.id, "seo", "404s"] }),
  });
  return (
    <Section
      title="Pages not found"
      hint="Addresses visitors asked for that do not exist. Turn a busy one into a redirect so the visitor lands somewhere useful."
      action={
        props.logging && (log.data?.total ?? 0) > 0 ? (
          <Button variant="outline" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}>
            Clear log
          </Button>
        ) : undefined
      }
    >
      <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Enable 404 logging
            <HelpTip>
              Records up to 500 missing addresses with how often each was requested. Images, scripts and other files are
              not recorded.
            </HelpTip>
          </p>
        </div>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={props.logging}
          disabled={toggle.isPending}
          onChange={(event) => toggle.mutate(event.target.checked)}
        />
      </label>
      {toggle.error && <p className="border-t px-4 py-3 text-sm text-destructive">{toggle.error.message}</p>}
      {props.logging &&
        (log.isPending ? (
          <div className="flex justify-center border-t py-6">
            <Spinner className="size-5 text-muted-foreground" label="Loading the log" />
          </div>
        ) : log.error ? (
          <p className="border-t px-4 py-4 text-sm text-destructive">{log.error.message}</p>
        ) : log.data.items.length === 0 ? (
          <div className="border-t">
            <EmptyRow>Nothing recorded yet.</EmptyRow>
          </div>
        ) : (
          <>
            <ul className="divide-y border-t">
              {log.data.items.map((item) => (
                <li key={item.path} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.path}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.hits} {item.hits === 1 ? "request" : "requests"} · last {timeAgo(item.last_seen)}
                      {item.referrer ? ` · from ${item.referrer}` : ""}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => props.onRedirect(item.path)}>
                    Redirect
                  </Button>
                </li>
              ))}
            </ul>
            <Pager page={page} total={log.data.total} perPage={25} onPage={setPage} />
          </>
        ))}
    </Section>
  );
}

/** Whether the log is on and the automatic settings come with the rule list, so both views share one query. */
function useRedirectState(site: SiteSummary, supported: boolean) {
  return useQuery({
    queryKey: ["site", site.id, "seo", "redirects", 1, "", "state"],
    queryFn: () => fetchRedirects(site.id, { page: 1, search: "", per_page: 1 }),
    enabled: supported,
  });
}

const supportsRedirects = (site: SiteSummary) =>
  !!site.plugin_version && compareVersions(site.plugin_version, SEO_REDIRECTS_SINCE) >= 0;

/** Redirect rules for a site, and the settings for making them automatically. */
export function RedirectsTab(props: { site: SiteSummary }) {
  const { site } = props;
  const supported = supportsRedirects(site);
  const [editing, setEditing] = useState<{ rule: Redirect | null; initial: RedirectInput } | null>(null);
  const state = useRedirectState(site, supported);
  if (!supported) {
    return (
      <Section title="Redirects">
        <EmptyRow>
          Redirects need KontrolWP Connect {SEO_REDIRECTS_SINCE} or later on this site. It updates automatically; select
          Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  return (
    <>
      <AutoSection site={site} auto={state.data?.auto} />
      <RulesSection
        site={site}
        hasAuto={!!state.data?.auto}
        onNew={(rule) =>
          setEditing({
            rule,
            initial: rule
              ? {
                  source: rule.source,
                  match_type: rule.match_type,
                  target: rule.target,
                  status_code: rule.status_code,
                  enabled: rule.enabled,
                }
              : blankRule(),
          })
        }
      />
      {editing && (
        <RuleDialog site={site} rule={editing.rule} initial={editing.initial} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

/** The log of addresses that were not found, with a button to turn one into a redirect. */
export function NotFoundTab(props: { site: SiteSummary }) {
  const { site } = props;
  const supported = supportsRedirects(site);
  const [creating, setCreating] = useState<string | null>(null);
  const state = useRedirectState(site, supported);
  if (!supported) {
    return (
      <Section title="Pages not found">
        <EmptyRow>
          The 404 log needs KontrolWP Connect {SEO_REDIRECTS_SINCE} or later on this site. It updates automatically;
          select Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  if (state.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" label="Loading" />
      </div>
    );
  }
  if (state.error) return <p className="mt-6 text-sm text-destructive">{state.error.message}</p>;
  return (
    <>
      <NotFoundSection site={site} logging={state.data.log_404} onRedirect={setCreating} />
      {creating !== null && (
        <RuleDialog
          site={site}
          rule={null}
          initial={{ ...blankRule(), source: creating }}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  );
}

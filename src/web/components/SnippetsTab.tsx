import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { compareVersions, SNIPPETS_SINCE } from "../../shared/plugin-version";
import type { CodeSnippet, SnippetLocation, SnippetScope, SnippetsSettings, SiteSummary } from "../../shared/types";
import { fetchSnippets, saveSnippets } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { ErrorBoundary } from "./ErrorBoundary";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";
import { CheckRow, Row } from "./ToolsTab";

const LOCATION_LABELS: Record<SnippetLocation, string> = {
  head: "Head",
  body_start: "Start of body",
  footer: "Footer",
};

const SCOPE_LABELS: Record<SnippetScope, string> = {
  all: "Every page",
  only: "Only these pages",
  except: "Every page except these",
};

const blankSnippet = (): CodeSnippet => ({
  id: "",
  name: "",
  code: "",
  location: "head",
  enabled: true,
  scope: "all",
  paths: [],
});

/** Code snippets: analytics, tracking and other small scripts printed on the public site. */
export function SnippetsTab(props: { site: SiteSummary }) {
  return (
    <ErrorBoundary label="Code snippets">
      <Snippets site={props.site} />
    </ErrorBoundary>
  );
}

function Snippets(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, SNIPPETS_SINCE) >= 0;
  const query = useQuery({
    queryKey: ["site", site.id, "snippets"],
    queryFn: () => fetchSnippets(site.id),
    enabled: supported,
  });
  const [draft, setDraft] = useState<SnippetsSettings | null>(null);
  // Which snippets are expanded, by position; a new one opens so its code can be pasted straight away.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const saved = query.data?.settings;
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);
  const save = useMutation({
    mutationFn: (settings: SnippetsSettings) => saveSnippets(site.id, settings),
    onSuccess: (data) => {
      queryClient.setQueryData(["site", site.id, "snippets"], data);
      setOpen(new Set());
    },
  });

  if (!supported) {
    return (
      <Section title="Code snippets">
        <EmptyRow>
          Code snippets need KontrolWP Connect {SNIPPETS_SINCE} or later on this site. It updates automatically; select
          Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  if (query.isPending || !draft) {
    return query.error ? (
      <p className="mt-6 text-sm text-destructive">{query.error.message}</p>
    ) : (
      <div className="flex justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" label="Loading" />
      </div>
    );
  }

  const limits = query.data!.limits;
  const dirty = JSON.stringify(draft) !== JSON.stringify(query.data!.settings);
  const update = (index: number, patch: Partial<CodeSnippet>) =>
    setDraft({ ...draft, snippets: draft.snippets.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  return (
    <>
      <Section
        title="Code snippets"
        hint={`Analytics codes, tracking pixels and other small scripts, printed exactly as written on the public site. Only the dashboard can change them. They are not printed in the WordPress admin or in feeds. If another plugin or theme, such as WPCode or Kadence, already prints the same code, remove it there so visits are not counted twice. Up to ${limits.snippets} snippets.`}
        action={
          save.isPending ? (
            <Spinner className="size-4 text-muted-foreground" label="Saving" />
          ) : (
            <div className="flex gap-2">
              {dirty && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDraft(query.data!.settings);
                      setOpen(new Set());
                    }}
                  >
                    Discard
                  </Button>
                  <Button size="sm" onClick={() => save.mutate(draft)}>
                    Save changes
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={draft.snippets.length >= limits.snippets}
                onClick={() => {
                  setDraft({ ...draft, snippets: [...draft.snippets, blankSnippet()] });
                  setOpen((current) => new Set(current).add(draft.snippets.length));
                }}
              >
                <PlusIcon /> Add snippet
              </Button>
            </div>
          )
        }
      >
        {save.error && <p className="border-b px-4 py-3 text-sm text-destructive">{save.error.message}</p>}
        <CheckRow
          title="Skip logged-in editors"
          hint="Leaves snippets out when someone who can edit posts is logged in to the site, so your own visits do not count as traffic. Turn it off to test a snippet while logged in."
          checked={draft.skip_editors}
          onChange={(value) => setDraft({ ...draft, skip_editors: value })}
        />
        {draft.snippets.length === 0 ? (
          <div className="border-t">
            <EmptyRow>
              No snippets yet. Add one for an analytics code, a tracking pixel or a chat widget.
            </EmptyRow>
          </div>
        ) : (
          <ul className="divide-y border-t">
            {draft.snippets.map((snippet, index) => {
              const isOpen = open.has(index);
              return (
                <li key={snippet.id || `new-${index}`}>
                  <div className="flex items-center gap-2 px-4 py-3">
                    <button
                      type="button"
                      className={cn("flex min-w-0 flex-1 items-center gap-2 text-left", !snippet.enabled && "opacity-60")}
                      aria-expanded={isOpen}
                      onClick={() => toggle(index)}
                    >
                      {isOpen ? (
                        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 truncate text-sm font-medium">{snippet.name || "New snippet"}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{LOCATION_LABELS[snippet.location]}</span>
                      {!snippet.enabled && <span className="sr-only">(off)</span>}
                    </button>
                    <Switch
                      aria-label={`${snippet.name || "New snippet"} on`}
                      checked={snippet.enabled}
                      onCheckedChange={(value) => update(index, { enabled: value })}
                    />
                  </div>
                  {isOpen && (
                    <div className="divide-y border-t bg-muted/20">
                      <Row title="Name" hint="Only for you, and shown as a comment in the page source.">
                        <Input
                          aria-label="Snippet name"
                          value={snippet.name}
                          maxLength={limits.name}
                          onChange={(event) => update(index, { name: event.target.value })}
                          placeholder="Google Analytics"
                        />
                      </Row>
                      <Row
                        title="Location"
                        hint="Head suits most analytics codes. Start of body needs a theme that supports it (most current themes do). Footer loads after the page content."
                      >
                        <select
                          aria-label="Snippet location"
                          className={SELECT_CLASS}
                          value={snippet.location}
                          onChange={(event) => update(index, { location: event.target.value as SnippetLocation })}
                        >
                          {(Object.keys(LOCATION_LABELS) as SnippetLocation[]).map((value) => (
                            <option key={value} value={value}>
                              {LOCATION_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </Row>
                      <Row title="Pages" hint="Print on every page, or choose pages by their address. Use /pricing for one page, or /blog/* for everything under /blog/.">
                        <select
                          aria-label="Snippet pages"
                          className={SELECT_CLASS}
                          value={snippet.scope}
                          onChange={(event) => update(index, { scope: event.target.value as SnippetScope })}
                        >
                          {(Object.keys(SCOPE_LABELS) as SnippetScope[]).map((value) => (
                            <option key={value} value={value}>
                              {SCOPE_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </Row>
                      {snippet.scope !== "all" && (
                        <Row title="Page addresses" hint={`One per line, starting with a slash. Up to ${limits.paths}.`}>
                          <Textarea
                            aria-label="Snippet page addresses"
                            rows={3}
                            value={snippet.paths.join("\n")}
                            onChange={(event) => update(index, { paths: event.target.value.split("\n") })}
                            placeholder={"/pricing\n/blog/*"}
                            className="font-mono text-xs"
                            spellCheck={false}
                          />
                        </Row>
                      )}
                      <div className="px-4 py-3">
                        <Textarea
                          aria-label="Snippet code"
                          rows={8}
                          value={snippet.code}
                          maxLength={limits.code}
                          onChange={(event) => update(index, { code: event.target.value })}
                          placeholder={'<script async src="https://example.com/tracker.js"></script>'}
                          className="font-mono text-xs"
                          spellCheck={false}
                          autoComplete="off"
                        />
                        <p className="mt-1 text-right text-xs text-muted-foreground">
                          {snippet.code.length} / {limits.code}
                        </p>
                      </div>
                      <div className="flex justify-end px-4 py-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setDraft({ ...draft, snippets: draft.snippets.filter((_, i) => i !== index) });
                            setOpen(new Set());
                          }}
                        >
                          <Trash2Icon /> Delete snippet
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

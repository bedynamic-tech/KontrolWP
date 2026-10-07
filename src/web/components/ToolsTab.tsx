import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { compareVersions, SEO_TOOLS_SINCE } from "../../shared/plugin-version";
import {
  MAX_LLMS_TEXT,
  MAX_ROBOTS_TEXT,
  type SeoToolsSettings,
  type SeoVerifyService,
  type SiteSummary,
} from "../../shared/types";
import { fetchSeoTools, saveSeoTools } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";
import { TwoColumns } from "./TwoColumns";
import { Spinner } from "./Spinner";

const VERIFY_LABELS: Record<SeoVerifyService, string> = {
  google: "Google Search Console",
  bing: "Bing Webmaster Tools",
  yandex: "Yandex Webmaster",
  baidu: "Baidu Webmaster",
  pinterest: "Pinterest",
};

export function Row(props: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <p className="flex items-center gap-1.5 text-sm font-medium sm:max-w-sm sm:pt-1.5">
        {props.title}
        {props.hint && <HelpTip>{props.hint}</HelpTip>}
      </p>
      <div className="min-w-0 sm:w-96">{props.children}</div>
    </div>
  );
}

export function Warning(props: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-t border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-200">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <p>{props.children}</p>
    </div>
  );
}

/** Whether the saved file is really being served, as seen from outside. */
function LiveCheck(props: { check?: { ok: boolean; detail: string }; dirty: boolean }) {
  if (!props.check || props.dirty) return null;
  return (
    <p
      className={`border-t px-4 py-3 text-sm ${props.check.ok ? "text-muted-foreground" : "text-yellow-900 dark:text-yellow-200"}`}
    >
      {props.check.ok ? "Checked from outside the site: " : "Not working yet: "}
      {props.check.detail}
    </p>
  );
}

function Preview(props: { label: string; text: string; href: string }) {
  return (
    <div className="border-t px-4 py-3">
      <p className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
        {props.label}
        {props.href && (
          <a href={props.href} target="_blank" rel="noreferrer" className="underline">
            Open
          </a>
        )}
      </p>
      <pre className="max-h-48 overflow-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">
        {props.text || "(empty)"}
      </pre>
    </div>
  );
}

export function CheckRow(props: {
  title: string;
  hint: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
      <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
        {props.title}
        <HelpTip>{props.hint}</HelpTip>
      </p>
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-primary"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}

/** Site verification codes, robots.txt, llms.txt and IndexNow. */
export function ToolsTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, SEO_TOOLS_SINCE) >= 0;
  const tools = useQuery({
    queryKey: ["site", site.id, "seo", "tools"],
    queryFn: () => fetchSeoTools(site.id),
    enabled: supported,
  });
  const [draft, setDraft] = useState<SeoToolsSettings | null>(null);
  const saved = tools.data?.settings;
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);
  const save = useMutation({
    mutationFn: (settings: SeoToolsSettings) => saveSeoTools(site.id, settings),
    onSuccess: (data) => queryClient.setQueryData(["site", site.id, "seo", "tools"], data),
  });

  if (!supported) {
    return (
      <Section title="Verification and files">
        <EmptyRow>
          These tools need KontrolWP Connect {SEO_TOOLS_SINCE} or later on this site. It updates automatically; select
          Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  if (tools.isPending || !draft) {
    return tools.error ? (
      <p className="mt-6 text-sm text-destructive">{tools.error.message}</p>
    ) : (
      <div className="flex justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" label="Loading" />
      </div>
    );
  }
  const data = tools.data!;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = <K extends keyof SeoToolsSettings>(key: K, value: SeoToolsSettings[K]) =>
    setDraft({ ...draft, [key]: value });
  return (
    <>
      {data.conflict && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-200">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            {data.conflict} is active on this site, so KontrolWP does not apply any of these. Deactivate {data.conflict}{" "}
            to use them.
          </p>
        </div>
      )}
      <TwoColumns>
      <Section
        title="Verification and files"
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
        hint="Codes and files that search engines and AI tools look for. KontrolWP answers for robots.txt, llms.txt and the IndexNow key itself, so nothing is written to the site's files."
      >
        {save.error && <p className="border-b px-4 py-3 text-sm text-destructive">{save.error.message}</p>}
        <div className="px-4 py-3 text-sm font-medium">Site verification</div>
        <div className="divide-y border-t">
          {(Object.keys(VERIFY_LABELS) as SeoVerifyService[]).map((name) => (
            <Row
              key={name}
              title={VERIFY_LABELS[name]}
              hint="Paste the code, or the whole meta tag the service gives you. It is added to the home page."
            >
              <Input
                aria-label={`${VERIFY_LABELS[name]} verification code`}
                value={draft.verify[name]}
                onChange={(event) => set("verify", { ...draft.verify, [name]: event.target.value })}
                placeholder="Verification code"
              />
            </Row>
          ))}
        </div>
      </Section>

      <Section
        title="robots.txt"
        hint="Tells crawlers what they may visit. The default is WordPress's own, which keeps the admin out and lists the sitemap. A custom file replaces it; a rule that would block the whole site is refused."
      >
        <Row title="Rules">
          <select
            aria-label="robots.txt rules"
            className={`${SELECT_CLASS} w-full`}
            value={draft.robots_mode}
            onChange={(event) => set("robots_mode", event.target.value as SeoToolsSettings["robots_mode"])}
          >
            <option value="default">WordPress default</option>
            <option value="custom">Custom</option>
          </select>
        </Row>
        {draft.robots_mode === "custom" && (
          <div className="border-t px-4 py-3">
            <Textarea
              aria-label="Custom robots.txt"
              value={draft.robots_text}
              onChange={(event) => set("robots_text", event.target.value)}
              placeholder={data.robots_default}
              rows={8}
              className="font-mono text-xs"
              maxLength={MAX_ROBOTS_TEXT}
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {draft.robots_text.length} / {MAX_ROBOTS_TEXT}
            </p>
          </div>
        )}
        {data.robots_file_exists && (
          <Warning>
            A real robots.txt file is in the site's folder, so the web server shows that and WordPress never gets to
            answer. Remove the file for these rules to apply.
          </Warning>
        )}
        {!data.public && (
          <Warning>
            WordPress is set to discourage search engines, so it keeps its own robots.txt, which blocks everything,
            whatever is written here.
          </Warning>
        )}
        <LiveCheck check={data.live?.robots} dirty={dirty} />
        <Preview
          label={
            draft.robots_mode === "custom" && dirty ? "WordPress default (custom is used once saved)" : "Current file"
          }
          text={
            draft.robots_mode === "custom" && !dirty && data.settings.robots_text
              ? data.settings.robots_text
              : data.robots_default
          }
          href={data.urls.robots}
        />
      </Section>

      <Section
        title="llms.txt"
        hint="A plain summary of the site for AI tools, at /llms.txt. Automatic lists your site name, tagline, pages and latest posts, leaving out anything hidden from search. Custom lets you write it yourself."
      >
        <Row title="Content">
          <select
            aria-label="llms.txt content"
            className={`${SELECT_CLASS} w-full`}
            value={draft.llms_mode}
            onChange={(event) => set("llms_mode", event.target.value as SeoToolsSettings["llms_mode"])}
          >
            <option value="off">Off</option>
            <option value="auto">Automatic</option>
            <option value="custom">Custom</option>
          </select>
        </Row>
        {draft.llms_mode === "custom" && (
          <div className="border-t px-4 py-3">
            <Textarea
              aria-label="Custom llms.txt"
              value={draft.llms_text}
              onChange={(event) => set("llms_text", event.target.value)}
              placeholder={data.llms_auto}
              rows={10}
              className="font-mono text-xs"
              maxLength={MAX_LLMS_TEXT}
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {draft.llms_text.length} / {MAX_LLMS_TEXT}
            </p>
          </div>
        )}
        {draft.llms_mode === "auto" && (
          <Preview
            label="What it will say"
            text={data.llms_auto}
            href={data.settings.llms_mode !== "off" && !dirty ? data.urls.llms : ""}
          />
        )}
        <LiveCheck check={data.live?.llms} dirty={dirty} />
      </Section>

      <Section
        title="IndexNow"
        hint="Tells Bing, Yandex and other search engines that use it the moment a page is published, changed or removed, so they do not wait to find it. Google does not use IndexNow. KontrolWP makes the key and answers for its file."
      >
        <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm font-medium">Notify search engines when content changes</p>
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-primary"
            checked={draft.indexnow}
            onChange={(event) => set("indexnow", event.target.checked)}
          />
        </label>
      </Section>
      </TwoColumns>
    </>
  );
}

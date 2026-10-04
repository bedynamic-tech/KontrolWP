import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { compareVersions, SEO_CONTENT_SINCE } from "../../shared/plugin-version";
import {
  MAX_SCHEMA_LINKS,
  SEO_BREADCRUMB_SEPARATORS,
  type SeoContentSettings,
  type SiteSummary,
} from "../../shared/types";
import { fetchSeoContent, saveSeoContent } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";
import { CheckRow, Row, Warning } from "./ToolsTab";

/** Site-wide schema, breadcrumbs, link rules, image alt text and the feed footer. */
export function SeoContentTab(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, SEO_CONTENT_SINCE) >= 0;
  const content = useQuery({
    queryKey: ["site", site.id, "seo", "content"],
    queryFn: () => fetchSeoContent(site.id),
    enabled: supported,
  });
  const [draft, setDraft] = useState<SeoContentSettings | null>(null);
  // The profile links are edited as lines of text, and turned back into a list on save.
  const [links, setLinks] = useState("");
  const saved = content.data?.settings;
  useEffect(() => {
    if (saved) {
      setDraft(saved);
      setLinks(saved.schema_same_as.join("\n"));
    }
  }, [saved]);
  const save = useMutation({
    mutationFn: (settings: SeoContentSettings) => saveSeoContent(site.id, settings),
    onSuccess: (data) => queryClient.setQueryData(["site", site.id, "seo", "content"], data),
  });

  if (!supported) {
    return (
      <Section title="Schema and content">
        <EmptyRow>
          These settings need KontrolWP Connect {SEO_CONTENT_SINCE} or later on this site. It updates automatically;
          select Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  if (content.isPending || !draft) {
    return content.error ? (
      <p className="mt-6 text-sm text-destructive">{content.error.message}</p>
    ) : (
      <div className="flex justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" label="Loading" />
      </div>
    );
  }
  const data = content.data!;
  const current: SeoContentSettings = {
    ...draft,
    schema_same_as: links
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_SCHEMA_LINKS),
  };
  const dirty = JSON.stringify(current) !== JSON.stringify(data.settings);
  const set = <K extends keyof SeoContentSettings>(key: K, value: SeoContentSettings[K]) =>
    setDraft({ ...draft, [key]: value });
  const reset = () => {
    setDraft(data.settings);
    setLinks(data.settings.schema_same_as.join("\n"));
  };
  return (
    <>
      {(data.conflict || !data.seo_enabled) && (
        <div className="mt-4">
          <Warning>
            {data.conflict
              ? `${data.conflict} is active on this site, so KontrolWP does not apply any of these. Deactivate ${data.conflict} to use them.`
              : "None of these apply until SEO tags are switched on in Settings."}
          </Warning>
        </div>
      )}
      <Section
        title="Schema"
        hint="Structured data that tells search engines who is behind the site and what each post is. It appears in the page head as JSON-LD."
        action={
          save.isPending ? (
            <Spinner className="size-4 text-muted-foreground" label="Saving" />
          ) : dirty ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                Discard
              </Button>
              <Button size="sm" onClick={() => save.mutate(current)}>
                Save changes
              </Button>
            </div>
          ) : undefined
        }
      >
        {save.error && <p className="border-b px-4 py-3 text-sm text-destructive">{save.error.message}</p>}
        <div className="divide-y">
          <CheckRow
            title="Describe the site and who runs it"
            hint="Adds WebSite markup and the organization or person behind the site to the home page."
            checked={draft.schema}
            onChange={(value) => set("schema", value)}
          />
          {draft.schema && (
            <>
              <Row title="The site belongs to">
                <select
                  aria-label="The site belongs to"
                  className={`${SELECT_CLASS} w-full`}
                  value={draft.schema_type}
                  onChange={(event) => set("schema_type", event.target.value as SeoContentSettings["schema_type"])}
                >
                  <option value="organization">An organization or business</option>
                  <option value="person">A person</option>
                </select>
              </Row>
              <Row title="Name" hint="Empty uses the site name.">
                <Input
                  aria-label="Schema name"
                  value={draft.schema_name}
                  onChange={(event) => set("schema_name", event.target.value)}
                  placeholder={data.site_name}
                />
              </Row>
              <Row
                title="Logo address"
                hint="Empty uses the site icon. A square image of at least 112 pixels works best."
              >
                <Input
                  aria-label="Schema logo address"
                  value={draft.schema_logo}
                  onChange={(event) => set("schema_logo", event.target.value)}
                  placeholder={data.site_icon || "https://"}
                />
              </Row>
              <Row
                title="Profile links"
                hint="One address per line, such as your social profiles. Search engines use them to connect the site to its accounts."
              >
                <Textarea
                  aria-label="Profile links"
                  value={links}
                  onChange={(event) => setLinks(event.target.value)}
                  placeholder="https://"
                  rows={3}
                />
              </Row>
            </>
          )}
          <CheckRow
            title="Mark up posts as articles"
            hint="Adds headline, dates, author, image and publisher to each blog post."
            checked={draft.article_schema}
            onChange={(value) => set("article_schema", value)}
          />
        </div>
      </Section>

      <Section
        title="Breadcrumbs"
        hint="A trail like Home, News, This story. Search results can show it, and visitors can use it to move up a level. Add it to a page with the [kontrolwp_breadcrumbs] shortcode, or echo kontrolwp_breadcrumbs() in a theme."
      >
        <div className="divide-y">
          <CheckRow
            title="Breadcrumbs"
            hint="Adds breadcrumb markup to posts, pages and archives, and turns on the shortcode."
            checked={draft.breadcrumbs}
            onChange={(value) => set("breadcrumbs", value)}
          />
          {draft.breadcrumbs && (
            <>
              <Row title="Home label">
                <Input
                  aria-label="Breadcrumb home label"
                  value={draft.breadcrumb_home}
                  onChange={(event) => set("breadcrumb_home", event.target.value)}
                />
              </Row>
              <Row title="Separator">
                <select
                  aria-label="Breadcrumb separator"
                  className={`${SELECT_CLASS} w-full`}
                  value={draft.breadcrumb_sep}
                  onChange={(event) =>
                    set("breadcrumb_sep", event.target.value as SeoContentSettings["breadcrumb_sep"])
                  }
                >
                  {SEO_BREADCRUMB_SEPARATORS.map((separator) => (
                    <option key={separator} value={separator}>
                      {separator}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}
        </div>
      </Section>

      <Section
        title="Links and images"
        hint="Changes are made as pages are shown. Nothing stored in your posts is edited, so turning a setting off puts everything back."
      >
        {!data.html_support && (
          <Warning>These need WordPress 6.2 or later, which this site does not have, so they are not applied.</Warning>
        )}
        <div className="divide-y">
          <CheckRow
            title="Open links to other sites in a new tab"
            hint="Applies to links in post and page content that go to another site. New tabs are not always welcome to people using assistive technology, so this is off by default."
            checked={draft.external_new_tab}
            onChange={(value) => set("external_new_tab", value)}
          />
          <CheckRow
            title="Add nofollow to links to other sites"
            hint="Asks search engines not to pass credit to the sites you link to. Most sites leave this off, since good outbound links help readers."
            checked={draft.external_nofollow}
            onChange={(value) => set("external_nofollow", value)}
          />
          <CheckRow
            title="Fill in missing image alt text"
            hint="Images with no alt text get the alt text saved in the media library, or else a readable version of the image's title. Camera file names such as IMG_1234 are never used, and images deliberately marked as decoration are left alone."
            checked={draft.image_alt}
            onChange={(value) => set("image_alt", value)}
          />
        </div>
      </Section>

      <Section
        title="Feeds"
        hint="Text added under each item in your RSS feed, so a copy on another site points back to the original. Tokens: %title%, %link%, %sitename%. Leave empty to add nothing."
      >
        <Row title="Footer text">
          <Textarea
            aria-label="Feed footer"
            value={draft.feed_footer}
            onChange={(event) => set("feed_footer", event.target.value)}
            rows={2}
          />
        </Row>
      </Section>
    </>
  );
}

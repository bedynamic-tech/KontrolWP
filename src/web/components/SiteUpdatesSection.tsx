import type { ReactNode } from "react";
import type { SiteSummary, SiteUpdate } from "../../shared/types";
import { Section } from "./Section";
import { UpdateAllButton, UpdatesList } from "./UpdatesList";

/** A site's updates, with WordPress, plugins and (when there are any) themes each in their own part. */
export function SiteUpdatesSection(props: { site: SiteSummary; updates: SiteUpdate[] }) {
  const { site, updates } = props;
  const of = (kind: SiteUpdate["kind"]) => updates.filter((update) => update.kind === kind);
  const themes = of("theme");

  if (site.updates_excluded) {
    return (
      <Section title="Updates">
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          This site is excluded from update checks.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Updates" action={<UpdateAllButton updates={updates} />}>
      <Part title="WordPress">
        <List updates={of("core")} empty="WordPress is up to date." />
      </Part>
      <Part title="Plugins">
        <List updates={of("plugin")} empty="All plugins are up to date" />
      </Part>
      {themes.length > 0 && (
        <Part title="Themes">
          <List updates={themes} empty="" />
        </Part>
      )}
    </Section>
  );
}

function Part(props: { title: string; children: ReactNode }) {
  return (
    <div className="border-b last:border-b-0 [&>*:last-child]:border-b-0">
      <h3 className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">{props.title}</h3>
      {props.children}
    </div>
  );
}

function List(props: { updates: SiteUpdate[]; empty: string }) {
  if (!props.updates.length) return <p className="px-4 py-3 text-sm text-muted-foreground">{props.empty}</p>;
  return <UpdatesList updates={props.updates} showSite={false} />;
}

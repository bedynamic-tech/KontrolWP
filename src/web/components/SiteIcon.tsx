import type { SiteSummary } from "../../shared/types";
import { RemoteIcon } from "./RemoteIcon";

/**
 * The site's favicon as its home page declares it (or its WordPress Site
 * Icon), else /favicon.ico, else the first letter of its name.
 */
export function SiteIcon(props: { site: Pick<SiteSummary, "name" | "url" | "icon_url">; className?: string }) {
  const { site } = props;
  return <RemoteIcon sources={[site.icon_url, faviconUrl(site.url)]} name={site.name} className={props.className} />;
}

function faviconUrl(url: string): string | null {
  try {
    return new URL("/favicon.ico", url).href;
  } catch {
    return null;
  }
}

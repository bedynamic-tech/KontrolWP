import { useState } from "react";
import { cn } from "@/lib/utils";
import type { SiteSummary } from "../../shared/types";

/**
 * The site's favicon: its WordPress Site Icon when Presser Connect reported
 * one, else /favicon.ico, else the first letter of its name.
 */
export function SiteIcon(props: { site: Pick<SiteSummary, "name" | "url" | "icon_url">; className?: string }) {
  const { site } = props;
  const sources = [site.icon_url, faviconUrl(site.url)].filter((src): src is string => !!src);
  const [failed, setFailed] = useState(0);
  const src = sources[failed];
  const box = cn("shrink-0 rounded-md border bg-muted", props.className);

  if (!src) {
    return (
      <span aria-hidden className={cn(box, "flex items-center justify-center font-medium uppercase text-muted-foreground")}>
        {site.name.trim().charAt(0) || "?"}
      </span>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed((count) => count + 1)}
      className={cn(box, "object-contain p-0.5")}
    />
  );
}

function faviconUrl(url: string): string | null {
  try {
    return new URL("/favicon.ico", url).href;
  } catch {
    return null;
  }
}

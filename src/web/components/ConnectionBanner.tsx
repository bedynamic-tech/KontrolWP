import type { SiteSummary } from "../../shared/types";
import { cn } from "@/lib/utils";

/**
 * Shown only when KontrolWP cannot reach a site: its last sync failed, or it
 * has not connected yet. A connected site shows nothing.
 */
export function ConnectionBanner(props: { site: SiteSummary; compact?: boolean; className?: string }) {
  const { site } = props;
  if (site.status === "connected" && !site.last_error) return null;
  const failed = site.status === "error" || !!site.last_error;
  const title = failed ? "KontrolWP can't reach this site" : "This site hasn't connected yet";
  const detail = failed
    ? site.last_error
    : "KontrolWP is waiting for its first sync. Check that KontrolWP Connect is active, then select Sync now.";
  return (
    <div
      role="alert"
      className={cn(
        "border text-sm",
        failed
          ? "border-destructive/30 bg-destructive/5"
          : "border-amber-600/25 bg-amber-500/10 dark:border-amber-400/25",
        props.compact ? "rounded-lg px-3 py-2 text-xs" : "rounded-xl px-4 py-3",
        props.className,
      )}
    >
      <p className={cn("font-medium", failed ? "text-destructive" : "text-amber-800 dark:text-amber-300")}>{title}</p>
      {detail && <p className={cn("text-muted-foreground", props.compact ? "mt-0.5 line-clamp-2" : "mt-1")}>{detail}</p>}
    </div>
  );
}

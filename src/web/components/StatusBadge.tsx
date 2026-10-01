import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SiteStatus } from "../../shared/types";

const LABELS: Record<SiteStatus, string> = {
  pending: "Waiting to connect",
  connected: "Connected",
  error: "Needs attention",
};

// A soft tint and a small dot; the label stays the main signal.
const TONES: Record<SiteStatus, { badge: string; dot: string }> = {
  connected: {
    badge: "border-emerald-600/20 bg-emerald-500/10 text-emerald-800 dark:border-emerald-400/20 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  pending: {
    badge: "border-amber-600/20 bg-amber-500/10 text-amber-800 dark:border-amber-400/20 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  error: {
    badge: "border-red-600/20 bg-red-500/10 text-red-800 dark:border-red-400/20 dark:text-red-300",
    dot: "bg-red-500",
  },
};

export function StatusBadge(props: { status: SiteStatus }) {
  const tone = TONES[props.status];
  return (
    <Badge variant="outline" className={cn("gap-1.5", tone.badge)}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden="true" />
      {LABELS[props.status]}
    </Badge>
  );
}

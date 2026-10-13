import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HelpTip } from "./HelpTip";

/** One fact in a row of cards at the top of a tab, in the style of the facts at the top of a site. */
export function StatCard(props: { label: string; value: string; detail?: string; className?: string }) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className={cn("mt-1 wrap-break-word text-sm font-medium tabular-nums", props.className)}>{props.value}</dd>
      {props.detail && <dd className="mt-0.5 wrap-break-word text-xs text-muted-foreground">{props.detail}</dd>}
    </div>
  );
}

/** A title, with its hint and actions, over a row of stat cards: a Section's header without the box. */
export function StatsHeader(props: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        {props.title}
        {props.hint && <HelpTip>{props.hint}</HelpTip>}
      </h2>
      {props.action}
    </div>
  );
}

/** A message under the stat cards: an error, a warning or a note. */
export function StatsNote(props: { tone?: "bad" | "muted"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "mt-3 rounded-xl border bg-background px-4 py-3 text-sm",
        props.tone === "bad" ? "border-destructive/30 bg-destructive/5 font-medium text-destructive" : "text-muted-foreground",
      )}
    >
      {props.children}
    </p>
  );
}

import type { ReactNode } from "react";
import { HelpTip } from "./HelpTip";

/** A titled block. `hint` is explanatory text, shown in a tooltip beside the title. */
export function Section(props: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          {props.title}
          {props.hint && <HelpTip>{props.hint}</HelpTip>}
        </h2>
        {props.action}
      </div>
      <div className="overflow-hidden rounded-xl border bg-background">{props.children}</div>
    </section>
  );
}

export function EmptyRow(props: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{props.children}</p>;
}

import type { ReactNode } from "react";

export function Section(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{props.title}</h2>
        {props.action}
      </div>
      <div className="overflow-hidden rounded-xl border bg-background">{props.children}</div>
    </section>
  );
}

export function EmptyRow(props: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{props.children}</p>;
}

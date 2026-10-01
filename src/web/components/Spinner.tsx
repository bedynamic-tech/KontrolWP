import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A small spinning ring for work in progress. */
export function Spinner(props: { className?: string; label?: string }) {
  return (
    <Loader2Icon
      className={cn("size-3.5 shrink-0 animate-spin", props.className)}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      role={props.label ? "status" : undefined}
    />
  );
}

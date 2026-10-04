import { useState, type ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Explanatory text that used to sit under a label, now behind a small info
 * icon beside it. It opens on hover and keyboard focus, and on tap for touch
 * screens, where hover does not exist. Anything a person must see to act (an
 * error, a warning, an empty state) stays on the page instead.
 */
export function HelpTip(props: { children: ReactNode; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={props.label ?? "More information"}
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            props.className,
          )}
          // A tap opens it and a second tap closes it; hover and focus work as usual.
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{props.children}</TooltipContent>
    </Tooltip>
  );
}

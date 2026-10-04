import { forwardRef, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A button that shows only an icon. The label is its tooltip and its accessible
 * name, so nothing is lost for keyboards and screen readers.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentProps<typeof Button>, "size"> & { label: string }
>(function IconButton({ label, children, ...rest }, ref) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          size="icon-sm"
          variant="outline"
          aria-label={label}
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});

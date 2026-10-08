import * as React from "react"

import { cn } from "@/lib/utils"

/** An on/off toggle for a setting. Use a checkbox for picking items from a list. */
function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange" | "role" | "type"> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 touch:h-6 touch:w-11",
        checked ? "bg-primary" : "bg-input dark:bg-input/80",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block size-4 rounded-full shadow-sm transition-transform touch:size-5",
          checked
            ? "bg-background translate-x-[18px] touch:translate-x-[22px]"
            : "bg-background dark:bg-foreground translate-x-0.5"
        )}
      />
    </button>
  )
}

export { Switch }

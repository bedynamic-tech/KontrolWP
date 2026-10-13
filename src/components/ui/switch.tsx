import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * An on/off toggle for a setting. Use a checkbox for picking items from a list.
 *
 * Like Checkbox, the real input (a checkbox with the switch role) sits
 * invisibly on top of the track, so a wrapping label names it and clicks,
 * the keyboard and screen readers work as usual.
 */
function Switch({
  checked,
  onCheckedChange,
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<"input">, "onChange" | "role" | "type" | "checked"> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <span
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50 touch:h-6 touch:w-11",
        checked ? "bg-primary" : "bg-input dark:bg-input/80",
        disabled && "opacity-50",
        className
      )}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="absolute inset-0 z-10 m-0 cursor-pointer rounded-full opacity-0 outline-none disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block size-4 rounded-full shadow-sm transition-transform touch:size-5",
          checked
            ? "bg-background translate-x-[18px] touch:translate-x-[22px]"
            : "bg-background dark:bg-foreground translate-x-0.5"
        )}
      />
    </span>
  )
}

export { Switch }

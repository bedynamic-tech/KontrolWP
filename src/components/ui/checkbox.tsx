import * as React from "react"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A checkbox for picking items from a list. Use a Switch for an on/off setting.
 *
 * The real input sits invisibly on top of the box, so clicks, the keyboard,
 * a wrapping label and screen readers all work as usual.
 */
function Checkbox({
  className,
  checked,
  indeterminate = false,
  disabled,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  checked: boolean
  /** Shows a bar for "some selected" while unchecked. */
  indeterminate?: boolean
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  const mixed = indeterminate && !checked
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed
  }, [mixed])
  const Mark = checked ? CheckIcon : mixed ? MinusIcon : null

  return (
    <span
      data-slot="checkbox"
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center",
        disabled && "opacity-50",
        className
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          "flex size-full items-center justify-center rounded-[4px] border peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
          Mark ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background dark:bg-input/30"
        )}
      >
        {Mark && <Mark className="size-3" strokeWidth={3} />}
      </span>
    </span>
  )
}

export { Checkbox }

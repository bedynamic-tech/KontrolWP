import * as React from "react"
import { motion } from "framer-motion"

import { motionTransitions } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * A checkbox for picking items from a list. Use a Switch for an on/off setting.
 *
 * EasyUI's DrawCheckbox: the box pops a little and the check mark draws
 * itself. The real input sits invisibly on top of the box, so clicks, the
 * keyboard, a wrapping label and screen readers all work as usual.
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
  const on = checked || mixed
  // Only draw the mark when it changes, not for boxes already checked on load.
  const mounted = React.useRef(false)
  React.useEffect(() => {
    mounted.current = true
  }, [])
  const enter = mounted.current

  return (
    <span
      data-slot="checkbox"
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center",
        disabled && "opacity-40",
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
      <motion.span
        aria-hidden
        initial={false}
        animate={{ scale: on ? [0.9, 1.04, 1] : 1 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "flex size-full items-center justify-center rounded-[4px] border transition-colors duration-150 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
          on ? "border-primary bg-primary" : "border-input bg-background peer-hover:border-ring dark:bg-input/30"
        )}
      >
        {checked && (
          <motion.svg
            viewBox="0 0 16 16"
            className="size-3 text-primary-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={enter ? { scale: 0.6, opacity: 0 } : false}
            animate={{ scale: [0.6, 1.18, 1], opacity: 1 }}
            transition={{ scale: { duration: 0.36, ease: [0.16, 1, 0.3, 1] }, opacity: { duration: 0.12 } }}
          >
            <motion.path
              d="M3.5 8.5 L6.5 11.5 L12.5 5"
              initial={enter ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.28, ease: [0.65, 0, 0.35, 1] }}
            />
          </motion.svg>
        )}
        {mixed && (
          <motion.span
            initial={enter ? { scaleX: 0 } : false}
            animate={{ scaleX: 1 }}
            transition={motionTransitions.springSnappy}
            style={{ transformOrigin: "left center" }}
            className="h-0.5 w-2.5 rounded-full bg-primary-foreground"
          />
        )}
      </motion.span>
    </span>
  )
}

export { Checkbox }

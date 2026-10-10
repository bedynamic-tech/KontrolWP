import * as React from "react"
import { motion } from "framer-motion"

import { motionTransitions } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * An on/off toggle for a setting. Use a checkbox for picking items from a list.
 *
 * EasyUI's StretchSwitch: the thumb stretches a little while pressed, then
 * springs across to its new side.
 */
function Switch({
  checked,
  onCheckedChange,
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange" | "role" | "type"> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const [pressed, setPressed] = React.useState(false)
  const release = () => setPressed(false)

  // How far the thumb travels. The track grows on touch screens, so measure it.
  const trackRef = React.useRef<HTMLButtonElement>(null)
  const thumbRef = React.useRef<HTMLSpanElement>(null)
  const [travel, setTravel] = React.useState(16)
  React.useLayoutEffect(() => {
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!track || !thumb) return
    const measure = () => {
      const style = getComputedStyle(track)
      setTravel(track.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - thumb.offsetWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  return (
    <button
      ref={trackRef}
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border px-0.5 transition-colors duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 touch:h-6 touch:w-11",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
        className
      )}
      {...props}
    >
      <motion.span
        ref={thumbRef}
        aria-hidden
        initial={false}
        animate={{ x: checked ? travel : 0, scaleX: pressed ? 1.18 : 1, scaleY: pressed ? 0.86 : 1 }}
        transition={motionTransitions.springSnappy}
        className={cn(
          "pointer-events-none block size-3.5 rounded-full shadow-xs touch:size-[18px]",
          checked ? "bg-primary-foreground" : "bg-muted-foreground"
        )}
      />
    </button>
  )
}

export { Switch }

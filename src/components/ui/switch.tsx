import * as React from "react"
import { motion } from "framer-motion"

import { motionTransitions } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * An on/off toggle for a setting. Use a checkbox for picking items from a list.
 *
 * EasyUI's StretchSwitch: the thumb stretches a little while pressed, then
 * springs across to its new side. Like Checkbox, the real input (a checkbox
 * with the switch role) sits invisibly on top of the track, so a wrapping
 * label names it and clicks, the keyboard and screen readers work as usual.
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
  const [pressed, setPressed] = React.useState(false)
  const release = () => setPressed(false)

  // How far the thumb travels. The track grows on touch screens, so measure it.
  const trackRef = React.useRef<HTMLSpanElement>(null)
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
    <span
      ref={trackRef}
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border px-0.5 transition-colors duration-200 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 touch:h-6 touch:w-11",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
        disabled && "opacity-40",
        className
      )}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        onPointerDown={() => !disabled && setPressed(true)}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        className="absolute inset-0 z-10 m-0 cursor-pointer rounded-full opacity-0 outline-none disabled:cursor-not-allowed"
        {...props}
      />
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
    </span>
  )
}

export { Switch }

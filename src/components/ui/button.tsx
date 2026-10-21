import * as React from "react"
import { Slot } from "radix-ui"
import { Button as PanelButton, buttonVariants as panelButtonVariants } from "panelui-web/button"

import { cn } from "@/lib/utils"

/*
 * The app's Button is PanelUI's (panelui-web/button). This file only maps the
 * size names the app already uses onto PanelUI's sizes, grows them to touch
 * size on phones, and keeps `asChild` for links drawn as buttons.
 */

type Size =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg"

const PANEL_SIZE = {
  default: "sm",
  xs: "sm",
  sm: "sm",
  lg: "md",
  icon: "icon-sm",
  "icon-xs": "icon-sm",
  "icon-sm": "icon-sm",
  "icon-lg": "icon",
} as const

const TOUCH_SIZE: Record<Size, string> = {
  default: "touch:h-10 touch:px-3.5 touch:text-sm",
  xs: "touch:h-9 touch:text-sm",
  sm: "touch:h-9 touch:text-sm",
  lg: "touch:h-11 touch:text-sm",
  icon: "touch:size-10",
  "icon-xs": "touch:size-9",
  "icon-sm": "touch:size-9",
  "icon-lg": "touch:size-11",
}

type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"

function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: { variant?: Variant | null; size?: Size | null; className?: string } = {}) {
  const s = size ?? "default"
  return cn(
    panelButtonVariants({ variant: variant ?? "default", size: PANEL_SIZE[s] }),
    TOUCH_SIZE[s],
    className
  )
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  type = "submit",
  children,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: Variant | null
  size?: Size | null
  asChild?: boolean
  /** Shows a spinner and disables the button while its request runs. */
  loading?: boolean
}) {
  const s = size ?? "default"
  if (asChild) {
    return (
      <Slot.Root
        data-slot="button"
        data-variant={variant}
        className={buttonVariants({ variant, size: s, className })}
        {...props}
      >
        {children}
      </Slot.Root>
    )
  }

  return (
    <PanelButton
      variant={variant ?? "default"}
      size={PANEL_SIZE[s]}
      loading={loading}
      // A button in a form submits it, as a plain <button> does.
      type={type}
      className={cn(TOUCH_SIZE[s], className)}
      {...props}
    >
      {children}
    </PanelButton>
  )
}

export { Button, buttonVariants }

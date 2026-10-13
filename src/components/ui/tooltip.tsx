import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// The trigger names its tooltip with data-ui-tooltip, so the UI check
// (npm run lint:ui) can see that an icon-only button has a text label.
// While closed, the tooltip text stays in the page as a hidden element with
// that id; while open, the visible Radix tooltip carries the id instead.
const TooltipState = React.createContext<{ id: string; open: boolean } | null>(null)

function TooltipProvider({ delayDuration = 150, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({ open: openProp, defaultOpen = false, onOpenChange, ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const id = React.useId()
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const handleOpenChange = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  return (
    <TooltipState.Provider value={{ id, open }}>
      <TooltipPrimitive.Root data-slot="tooltip" open={open} onOpenChange={handleOpenChange} {...props} />
    </TooltipState.Provider>
  )
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const state = React.useContext(TooltipState)
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" data-ui-tooltip={state?.id} {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const state = React.useContext(TooltipState)
  const closed = state !== null && !state.open
  return (
    <>
      {closed && (
        <span id={state.id} role="tooltip" hidden>
          {children}
        </span>
      )}
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          data-slot="tooltip-content"
          id={closed ? undefined : state?.id}
          role="tooltip"
          sideOffset={sideOffset}
          className={cn(
            "z-50 max-w-72 rounded-lg bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-md",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }

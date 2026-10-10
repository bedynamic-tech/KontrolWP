"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { LayoutGroup, motion } from "framer-motion"
import { Tabs as TabsPrimitive } from "radix-ui"

import { motionTransitions } from "@/lib/motion"
import { cn } from "@/lib/utils"

/** The open tab, so the active trigger can draw the sliding indicator. */
const TabsContext = React.createContext<{ value?: string; indicatorId: string }>({ indicatorId: "" })

function Tabs({
  className,
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue)
  const current = value ?? uncontrolled
  const indicatorId = `tabs-indicator-${React.useId()}`

  return (
    <TabsContext.Provider value={{ value: current, indicatorId }}>
      <LayoutGroup id={indicatorId}>
        <TabsPrimitive.Root
          data-slot="tabs"
          data-orientation={orientation}
          orientation={orientation}
          value={value}
          defaultValue={defaultValue}
          onValueChange={(next) => {
            setUncontrolled(next)
            onValueChange?.(next)
          }}
          className={cn(
            "group/tabs flex gap-2 data-horizontal:flex-col",
            className
          )}
          {...props}
        />
      </LayoutGroup>
    </TabsContext.Provider>
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 touch:group-data-horizontal/tabs:h-10 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "border border-border bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const tabs = React.useContext(TabsContext)
  const active = tabs.value === value

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {/* EasyUI's AnimatedTabs: one indicator that slides to the open tab. */}
      {active && (
        <motion.span
          aria-hidden
          layoutId={tabs.indicatorId}
          transition={motionTransitions.springMorph}
          className={cn(
            "pointer-events-none absolute",
            "group-data-[variant=default]/tabs-list:inset-0 group-data-[variant=default]/tabs-list:rounded-md group-data-[variant=default]/tabs-list:border group-data-[variant=default]/tabs-list:border-border group-data-[variant=default]/tabs-list:bg-background group-data-[variant=default]/tabs-list:shadow-xs dark:group-data-[variant=default]/tabs-list:bg-card",
            "group-data-[variant=line]/tabs-list:bg-foreground group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:inset-x-0 group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:bottom-[-5px] group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:h-0.5 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:inset-y-0 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:-right-1 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:w-0.5"
          )}
        />
      )}
      <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span>
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("easy-rise flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }

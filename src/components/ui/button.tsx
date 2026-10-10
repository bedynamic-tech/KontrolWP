import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2Icon } from "lucide-react"
import { motion, type HTMLMotionProps } from "framer-motion"
import { Slot } from "radix-ui"

import { motionTransitions } from "@/lib/motion"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity] duration-150 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:opacity-90",
        outline:
          "border-border bg-transparent hover:border-input hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
        secondary:
          "border-border bg-card text-foreground hover:border-input hover:bg-accent aria-expanded:bg-accent",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive hover:border-destructive hover:bg-destructive hover:text-white focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 touch:h-10 touch:px-3.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs touch:h-8 touch:px-2.5 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-sm touch:h-9 touch:px-3 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 touch:h-11 touch:px-4 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8 touch:size-10",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] touch:size-8 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] touch:size-9 in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 touch:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Shows a spinner and disables the button while its request runs. */
    loading?: boolean
  }) {
  const shared = {
    "data-slot": "button",
    "data-variant": variant,
    "data-size": size,
    className: cn(buttonVariants({ variant, size, className })),
    disabled: disabled || loading,
    "aria-busy": loading || undefined,
  }

  if (asChild) {
    return (
      <Slot.Root {...shared} {...props}>
        {children}
      </Slot.Root>
    )
  }

  // EasyUI's spring tap: the button compresses a little under the pointer
  // and springs back, instead of nudging down a pixel.
  const inactive = disabled || loading
  return (
    <motion.button
      {...shared}
      {...(props as HTMLMotionProps<"button">)}
      whileTap={inactive || variant === "link" ? undefined : { scale: 0.97 }}
      transition={motionTransitions.springSnappy}
    >
      {loading && <Loader2Icon className="animate-spin" aria-hidden="true" />}
      {children}
    </motion.button>
  )
}

export { Button, buttonVariants }

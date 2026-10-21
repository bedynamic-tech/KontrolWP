import * as React from "react"
import { Input as PanelInput } from "panelui-web/input"

import { cn } from "@/lib/utils"

/** PanelUI's Input at the app's field height, grown to touch size on phones. */
function Input({ className, ...props }: Omit<React.ComponentProps<"input">, "size">) {
  return <PanelInput size="sm" className={cn("touch:h-10", className)} {...props} />
}

export { Input }

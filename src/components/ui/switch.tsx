import * as React from "react"
import { Switch as PanelSwitch } from "panelui-web/switch"

/**
 * An on/off toggle for a setting: PanelUI's Switch (panelui-web/switch). Use a
 * checkbox for picking items from a list. A wrapping label names it.
 */
function Switch({
  checked,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<typeof PanelSwitch>, "checked" | "onCheckedChange"> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <PanelSwitch
      size="sm"
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      {...props}
    />
  )
}

export { Switch }

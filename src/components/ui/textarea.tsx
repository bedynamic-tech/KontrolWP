import * as React from "react"
import { Textarea as PanelTextarea } from "panelui-web/textarea"

/**
 * PanelUI's Textarea. It starts `rows` lines tall and grows with what is
 * written in it; pass `autoResize={false}` for a fixed box sized by its class.
 */
function Textarea({
  rows = 3,
  autoResize = true,
  ...props
}: Omit<React.ComponentProps<"textarea">, "size"> & { autoResize?: boolean }) {
  return (
    <PanelTextarea
      size="sm"
      autoResize={autoResize}
      rows={rows}
      minRows={rows}
      maxRows={Math.max(rows * 2, 16)}
      {...props}
    />
  )
}

export { Textarea }

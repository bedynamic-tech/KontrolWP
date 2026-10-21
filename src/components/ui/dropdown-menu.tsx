import * as React from "react"
import { Menu } from "panelui-web/menu"

/*
 * The app's dropdown menus are PanelUI's Menu (panelui-web/menu). These keep
 * the names the app already uses, and `asChild`, which hands the child to
 * PanelUI's `render` so it becomes the trigger or item itself.
 */

function DropdownMenu(props: React.ComponentProps<typeof Menu>) {
  return <Menu {...props} />
}

function asRender(asChild: boolean | undefined, children: React.ReactNode) {
  return asChild ? { render: React.Children.only(children) as React.ReactElement } : { children }
}

function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Menu.Trigger>, "render"> & { asChild?: boolean }) {
  return <Menu.Trigger {...props} {...asRender(asChild, children)} />
}

function DropdownMenuContent({
  align = "end",
  ...props
}: React.ComponentProps<typeof Menu.Content>) {
  return <Menu.Content align={align} {...props} />
}

function DropdownMenuItem({
  asChild,
  onSelect,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Menu.Item>, "render"> & {
  asChild?: boolean
  /** Runs when the item is chosen, by pointer or keyboard. */
  onSelect?: () => void
}) {
  return (
    <Menu.Item
      {...props}
      onClick={(event) => {
        props.onClick?.(event)
        onSelect?.()
      }}
      {...asRender(asChild, children)}
    />
  )
}

function DropdownMenuSeparator(props: React.ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator {...props} />
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
}

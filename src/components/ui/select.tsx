import * as React from "react"
import { Select as PanelSelect } from "panelui-web/select"

import { cn } from "@/lib/utils"

/*
 * A dropdown of options: PanelUI's Select (panelui-web/select) behind the shape
 * of a native <select>, so options stay plain <option> children:
 *
 *   <Select aria-label="Time zone" value={zone} onValueChange={setZone}>
 *     <option value="UTC">UTC</option>
 *   </Select>
 *
 * Values are strings, as they are in a native select. An option with an empty
 * value is the "nothing chosen" choice; disabled, it is only the placeholder.
 */

interface Option {
  value: string
  label: React.ReactNode
  disabled: boolean
}

type OptionProps = { value?: string | number; disabled?: boolean; children?: React.ReactNode }

function readOptions(children: React.ReactNode, into: Option[] = []): Option[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === React.Fragment) {
      readOptions((child.props as { children?: React.ReactNode }).children, into)
      return
    }
    if (child.type !== "option") return
    const props = child.props as OptionProps
    into.push({
      value: String(props.value ?? ""),
      label: props.children,
      disabled: !!props.disabled,
    })
  })
  return into
}

/** Past this many options the trigger stops sizing itself to the longest one. */
const SIZE_TO_LONGEST_UP_TO = 60

function Select({
  value,
  onValueChange,
  disabled,
  required,
  id,
  className,
  children,
  ...props
}: {
  value: string | number
  onValueChange: (value: string) => void
  disabled?: boolean
  required?: boolean
  id?: string
  className?: string
  children?: React.ReactNode
  "aria-label"?: string
}) {
  const options = readOptions(children)
  const placeholder = options.find((option) => option.value === "")
  const listed = options.filter((option) => option.value !== "" || !option.disabled)
  // Base UI's Select keeps "nothing chosen" as null.
  const items = listed.map((option) => ({
    value: option.value === "" ? null : option.value,
    label: option.label,
  }))
  const current = String(value)

  return (
    <PanelSelect
      items={items}
      value={current === "" ? null : current}
      onValueChange={(next) => onValueChange(next == null ? "" : String(next))}
      disabled={disabled}
      required={required}
    >
      <PanelSelect.Trigger
        id={id}
        size="sm"
        className={cn("w-full max-w-full touch:h-10 touch:text-sm sm:w-auto", className)}
        {...props}
      >
        {/* The hidden labels keep the field as wide as its longest option,
            as a native select is, so it does not resize as the value changes. */}
        <span className="grid min-w-0 flex-1">
          <PanelSelect.Value
            placeholder={placeholder?.label}
            className="[grid-area:1/1]"
          />
          {listed.length <= SIZE_TO_LONGEST_UP_TO &&
            listed.map((option) => (
              <span
                key={option.value}
                aria-hidden
                className="invisible h-0 overflow-hidden text-start whitespace-nowrap [grid-area:1/1]"
              >
                {option.label}
              </span>
            ))}
        </span>
      </PanelSelect.Trigger>
      <PanelSelect.Content>
        {listed.map((option) => (
          <PanelSelect.Item
            key={option.value}
            value={option.value === "" ? null : option.value}
            disabled={option.disabled}
          >
            {option.label}
          </PanelSelect.Item>
        ))}
      </PanelSelect.Content>
    </PanelSelect>
  )
}

export { Select }

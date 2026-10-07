import { Children, type ReactNode } from "react";

/**
 * Sections side by side on wide screens, balanced by height. Phones and
 * narrow windows keep one column, in the same order.
 */
export function TwoColumns(props: { children: ReactNode }) {
  const items = Children.toArray(props.children);
  return (
    <div className="gap-x-6 lg:columns-2">
      {items.map((item, i) => (
        <div key={i} className="grid break-inside-avoid">
          {item}
        </div>
      ))}
    </div>
  );
}

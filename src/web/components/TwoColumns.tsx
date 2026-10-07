import { Children, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLayoutSettings } from "../api";

/**
 * The same layout choice the site overview uses (Settings, Layout): with two
 * columns picked, sections sit side by side on wide screens, balanced by
 * height. Phones and narrow windows keep one column, in the same order.
 */
export function TwoColumns(props: { children: ReactNode }) {
  const layout = useQuery({
    queryKey: ["settings", "layout"],
    queryFn: fetchLayoutSettings,
    refetchInterval: false,
  });
  const items = Children.toArray(props.children);
  if (layout.data?.site_columns !== 2 || items.length < 2) return <>{items}</>;
  // CSS columns balance the two sides by height, whatever the sections hold.
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

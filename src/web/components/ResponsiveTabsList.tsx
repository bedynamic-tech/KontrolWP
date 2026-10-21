import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select } from "@/components/ui/select";

export interface TabItem {
  value: string;
  label: string;
}

/**
 * The tab bar for a page's sections: tabs from the sm breakpoint up, and one
 * dropdown below it, where a row of tabs would scroll sideways. Both control
 * the same value, so it sits inside the page's `Tabs`, which takes
 * `variant="underline"`.
 */
export function ResponsiveTabsList(props: {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <>
      <Select
        aria-label={props.label}
        className="h-10 w-full sm:hidden"
        value={props.value}
        onValueChange={(next) => props.onChange(next)}
      >
        {props.tabs.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      <TabsList className="hidden sm:flex">
        {props.tabs.map((item) => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </>
  );
}

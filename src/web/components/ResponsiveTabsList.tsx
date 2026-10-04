import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SELECT_CLASS } from "./AnalyticsSection";

export interface TabItem {
  value: string;
  label: string;
}

/**
 * The tab bar for a page's sections: tabs from the sm breakpoint up, and one
 * dropdown below it, where a row of tabs would scroll sideways. Both control
 * the same value, so it sits inside the page's `Tabs`.
 */
export function ResponsiveTabsList(props: {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <>
      <select
        aria-label={props.label}
        className={`${SELECT_CLASS} h-10 w-full sm:hidden`}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.tabs.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <TabsList
        variant="line"
        className="hidden w-full justify-start overflow-x-auto overflow-y-hidden border-b pb-1.5 [scrollbar-width:none] sm:inline-flex"
      >
        {props.tabs.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="flex-none px-3">
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </>
  );
}

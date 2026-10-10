import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { LayoutGroup, motion } from "framer-motion";
import { Fragment, useId } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motionTransitions } from "@/lib/motion";

export interface NavItem {
  value: string;
  label: string;
  /** Views inside this section, such as SEO's Redirects; picking the section opens the first. */
  children?: NavItem[];
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * A page's sections as one grouped menu: a column of links from the lg breakpoint up,
 * and one dropdown below it. A section with views opens in place to list them, so a
 * view is always one pick away instead of sitting under rows of nested tabs.
 */
export function SectionNav(props: {
  groups: NavGroup[];
  /** The open section, and its open view when it has views. */
  value: string;
  view?: string;
  onChange: (value: string, view?: string) => void;
  label: string;
}) {
  const { groups, value, view, onChange } = props;
  const current = groups.flatMap((group) => group.items.map((item) => ({ group, item }))).find(({ item }) => item.value === value);
  const currentView = current?.item.children?.find((child) => child.value === view) ?? current?.item.children?.[0];
  const trail = [current?.group.label, currentView && current?.item.label].filter(Boolean);
  const leaf = currentView?.label ?? current?.item.label ?? "";
  const layoutGroup = useId();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${props.label}: ${[...trail, leaf].join(", ")}`}
            className="group flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden dark:bg-input/30"
          >
            <span className="min-w-0 truncate">
              {trail.map((part) => (
                <span key={part} className="text-muted-foreground">{part} / </span>
              ))}
              <span className="font-medium">{leaf}</span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-(--ease-snappy) group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          {groups.map((group, index) => (
            <Fragment key={group.label ?? index}>
              {index > 0 && <DropdownMenuSeparator />}
              {group.label && <p className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>}
              {group.items.map((item) => (
                <Fragment key={item.value}>
                  <DropdownMenuItem
                    onSelect={() => onChange(item.value, item.children?.[0]?.value)}
                    className={item.value === value && !item.children ? "bg-accent font-medium" : item.children ? "font-medium" : ""}
                  >
                    {item.label}
                  </DropdownMenuItem>
                  {item.children?.map((child) => (
                    <DropdownMenuItem
                      key={child.value}
                      onSelect={() => onChange(item.value, child.value)}
                      className={`ml-3 rounded-l-none border-l pl-3 ${item.value === value && child.value === currentView?.value ? "bg-accent font-medium" : ""}`}
                    >
                      {child.label}
                    </DropdownMenuItem>
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <LayoutGroup id={layoutGroup}>
        <nav aria-label={props.label} className="hidden lg:mt-6 lg:block">
          <div className="sticky top-6 space-y-0.5">
            {groups.map((group, index) => (
              <Fragment key={group.label ?? index}>
                {group.label && <p className="px-2 pt-5 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>}
                {group.items.map((item) => {
                  const open = item.value === value;
                  return (
                    <Fragment key={item.value}>
                      <NavButton
                        label={item.label}
                        active={open && !item.children}
                        open={open}
                        expandable={!!item.children}
                        onClick={() => onChange(item.value, item.children?.[0]?.value)}
                      />
                      {open &&
                        item.children?.map((child) => (
                          <NavButton
                            key={child.value}
                            label={child.label}
                            child
                            active={child.value === currentView?.value}
                            onClick={() => onChange(item.value, child.value)}
                          />
                        ))}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </nav>
      </LayoutGroup>
    </>
  );
}

function NavButton(props: {
  label: string;
  active?: boolean;
  open?: boolean;
  expandable?: boolean;
  child?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      aria-current={props.active ? "page" : undefined}
      aria-expanded={props.expandable ? props.open : undefined}
      onClick={props.onClick}
      // A section's views fade down into place as it opens.
      initial={props.child ? { opacity: 0, y: -4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransitions.springGentle}
      className={`relative flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        props.child ? "ml-3 w-[calc(100%-0.75rem)] rounded-l-none border-l pl-3" : ""
      } ${
        props.active
          ? "font-medium text-sidebar-accent-foreground"
          : props.open
            ? "font-medium text-foreground hover:bg-sidebar-accent/60"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
      }`}
    >
      {/* EasyUI's PillNavigation: one highlight that slides to the open section. */}
      {props.active && (
        <motion.span
          aria-hidden
          layoutId="section-active"
          transition={motionTransitions.springMorph}
          className={`absolute inset-0 bg-sidebar-accent ${props.child ? "rounded-r-lg" : "rounded-lg"}`}
        />
      )}
      <span className="relative truncate">{props.label}</span>
      {props.expandable && (
        <motion.span
          aria-hidden
          className="relative"
          initial={false}
          animate={{ rotate: props.open ? 90 : 0 }}
          transition={motionTransitions.springSnappy}
        >
          <ChevronRightIcon className="size-3.5 shrink-0" />
        </motion.span>
      )}
    </motion.button>
  );
}

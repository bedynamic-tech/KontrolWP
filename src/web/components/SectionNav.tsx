import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Fragment, useId, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface NavItem {
  value: string;
  label: string;
  icon?: ReactNode;
  /** Views inside this section, such as SEO's Redirects; picking the section opens the first. */
  children?: NavItem[];
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/** A group's heading: small capitals, so it reads as a label over its sections and not as one of them. */
const GROUP_HEADING = "px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase";

/**
 * A page's sections as one grouped menu: a column of links from the lg breakpoint up,
 * and one dropdown below it. Each group sits under its own heading, set apart by a rule.
 * A section with views opens in place to list them, so a view is always one pick away
 * instead of sitting under rows of nested tabs.
 */
export function SectionNav(props: {
  groups: NavGroup[];
  /** The open section, and its open view when it has views. */
  value: string;
  view?: string;
  onChange: (value: string, view?: string) => void;
  /** The address of a section, so each one is a real link that can open in a new tab. */
  hrefFor: (value: string, view?: string) => string;
  label: string;
}) {
  const { groups, value, view, onChange } = props;
  const current = groups.flatMap((group) => group.items.map((item) => ({ group, item }))).find(({ item }) => item.value === value);
  const currentView = current?.item.children?.find((child) => child.value === view) ?? current?.item.children?.[0];
  const trail = [current?.group.label, currentView && current?.item.label].filter(Boolean);
  const leaf = currentView?.label ?? current?.item.label ?? "";
  const headingId = useId();

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
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--anchor-width)">
          {groups.map((group, index) => (
            <Fragment key={group.label ?? index}>
              {index > 0 && <DropdownMenuSeparator />}
              {group.label && <p className={`${GROUP_HEADING} pt-1.5 pb-1`}>{group.label}</p>}
              {group.items.map((item) => (
                <Fragment key={item.value}>
                  <DropdownMenuItem
                    onSelect={() => onChange(item.value, item.children?.[0]?.value)}
                    className={item.value === value && !item.children ? "bg-accent font-medium" : item.children ? "font-medium" : ""}
                  >
                    {item.icon}
                    {item.label}
                  </DropdownMenuItem>
                  {item.children?.map((child) => (
                    <DropdownMenuItem
                      key={child.value}
                      onSelect={() => onChange(item.value, child.value)}
                      className={`ml-4 rounded-l-none border-l pl-3 ${item.value === value && child.value === currentView?.value ? "bg-accent font-medium" : ""}`}
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

      <nav aria-label={props.label} className="hidden lg:mt-6 lg:block">
        <div className="sticky top-6">
          {groups.map((group, index) => (
            <div
              key={group.label ?? index}
              role="group"
              aria-labelledby={group.label ? `${headingId}-group-${index}` : undefined}
              className={`space-y-0.5 ${index > 0 ? "mt-4 border-t pt-4" : ""}`}
            >
              {group.label && (
                <p id={`${headingId}-group-${index}`} className={`${GROUP_HEADING} pb-1.5`}>
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const open = item.value === value;
                return (
                  <Fragment key={item.value}>
                    <NavButton
                      label={item.label}
                      icon={item.icon}
                      active={open && !item.children}
                      open={open}
                      expandable={!!item.children}
                      href={props.hrefFor(item.value, item.children?.[0]?.value)}
                      onClick={() => onChange(item.value, item.children?.[0]?.value)}
                    />
                    {open &&
                      item.children?.map((child) => (
                        <NavButton
                          key={child.value}
                          label={child.label}
                          child
                          active={child.value === currentView?.value}
                          href={props.hrefFor(item.value, child.value)}
                          onClick={() => onChange(item.value, child.value)}
                        />
                      ))}
                  </Fragment>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}

function NavButton(props: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  open?: boolean;
  expandable?: boolean;
  child?: boolean;
  href: string;
  onClick: () => void;
}) {
  return (
    <a
      href={props.href}
      aria-current={props.active ? "page" : undefined}
      aria-expanded={props.expandable ? props.open : undefined}
      onClick={(event) => {
        // A plain click switches in place; a modified click opens a new tab as usual.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        props.onClick();
      }}
      className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        props.child ? "ml-4 w-[calc(100%-1rem)] rounded-l-none border-l pl-3" : ""
      } ${
        props.active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : props.open
            ? "font-medium text-foreground hover:bg-sidebar-accent/60"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
        {props.icon && <span className={props.active || props.open ? "text-foreground" : "text-muted-foreground"}>{props.icon}</span>}
        <span className="wrap-break-word">{props.label}</span>
      </span>
      {props.expandable && (
        <ChevronRightIcon aria-hidden className={`size-3.5 shrink-0 ${props.open ? "rotate-90" : ""}`} />
      )}
    </a>
  );
}

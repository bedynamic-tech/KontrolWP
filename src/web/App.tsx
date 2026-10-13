import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, GlobeIcon, LayoutDashboardIcon, MenuIcon, PlugIcon, SettingsIcon, UsersIcon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useMatch } from "react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { accessSetupError, fetchOverview, secretsKeyMissing, syncAllSites } from "./api";
import { AccessSetup } from "./components/AccessSetup";
import { ActivityBar } from "./components/ActivityBar";
import { FeedbackMenu } from "./components/FeedbackMenu";
import { PLUGIN_ZIP_URL } from "./components/PluginDownload";
import { SecretsKeySetup } from "./components/SecretsKeySetup";
import { SettingsPage, useSaveTimeZoneOnce } from "./components/SettingsPage";
import { OverviewPage } from "./components/OverviewPage";
import { PluginsPage } from "./components/PluginsPage";
import { SitePage } from "./components/SitePage";
import { SitesPage } from "./components/SitesPage";
import { ThemeToggle } from "./components/ThemeToggle";
import { UsersPage } from "./components/UsersPage";

const OPENED_KEY = "kontrolwp-opened";

/**
 * Opening KontrolWP syncs every site. A reload keeps this tab's session
 * storage, so only a new tab or window starts one; the Worker also skips it
 * when another tab started one a few minutes ago.
 */
function useSyncOnOpen(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    try {
      if (sessionStorage.getItem(OPENED_KEY)) return;
      sessionStorage.setItem(OPENED_KEY, "1");
    } catch {
      // No session storage: let the Worker's own check decide.
    }
    syncAllSites().catch(() => {});
  }, [enabled]);
}

export function App() {
  // The overview doubles as the Access check: every page needs the API.
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview, retry: false });
  useSaveTimeZoneOnce(overview.isSuccess);
  useSyncOnOpen(overview.isSuccess);
  const collapsed = !!useMatch("/sites/:siteId");
  const setupError = accessSetupError(overview.error);
  if (setupError) {
    return (
      <AccessSetup error={setupError} onRetry={() => overview.refetch()} retrying={overview.isFetching} />
    );
  }
  if (secretsKeyMissing(overview.error)) {
    return <SecretsKeySetup onRetry={() => overview.refetch()} retrying={overview.isFetching} />;
  }

  return (
    <div className="flex min-h-dvh bg-canvas text-foreground">
      <ActivityBar />
      {/* A site's page has its own section menu on the left, so there the sidebar folds to its
          icons and opens over the page on hover or keyboard focus. Its contents keep their full
          width, so folding only clips them and hides the labels. */}
      <div className={`sticky top-0 z-40 hidden h-dvh shrink-0 md:block ${collapsed ? "w-14" : "w-56"}`}>
        <aside
          className={`group/rail absolute inset-y-0 left-0 overflow-x-hidden overflow-y-auto border-r bg-sidebar px-3 py-4 ${
            collapsed
              ? "w-14 transition-[width,box-shadow] duration-150 hover:w-56 hover:shadow-2xl hover:delay-100 focus-within:w-56 focus-within:shadow-2xl [&_span]:transition-opacity [&:not(:hover):not(:focus-within)_span]:opacity-0"
              : "w-56"
          }`}
        >
          {/* Folded, the contents fit the rail, so nothing hidden sits over the page; opened,
              they take their full width at once and the rail's own width animates. */}
          <div
            className={`flex min-h-full flex-col whitespace-nowrap ${
              collapsed ? "w-8 overflow-hidden group-hover/rail:w-50 group-focus-within/rail:w-50" : "w-50"
            }`}
          >
            <div className="flex items-center justify-between">
              <Brand />
              <ThemeToggle />
            </div>
            <SidebarLinks folded={collapsed} />
          </div>
        </aside>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
          <Brand />
          <PhoneMenu />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-10">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/sites" element={<SitesPage />} />
            <Route path="/sites/:siteId" element={<SitePage />} />
            <Route path="/plugins" element={<PluginsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2">
      <img src="/kontrolwp.svg" alt="KontrolWP" className="size-6" />
      <span
        className="text-sm font-semibold tracking-tight"
        aria-hidden="true"
      >
        KontrolWP
      </span>
    </div>
  );
}

function NavItem(props: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={props.to}
      end={props.to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm [&_svg]:size-4 [&_svg]:shrink-0 ${
          isActive
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        }`
      }
    >
      {props.icon}
      <span>{props.label}</span>
    </NavLink>
  );
}

/** The pages, feedback and plugin download, shared by the sidebar and the phone menu. */
function SidebarLinks(props: { folded?: boolean }) {
  return (
    <>
      <nav className="mt-6 space-y-1">
        <NavItem to="/" icon={<LayoutDashboardIcon />} label="Overview" />
        <NavItem to="/sites" icon={<GlobeIcon />} label="Sites" />
        <NavItem to="/plugins" icon={<PlugIcon />} label="Plugins" />
        <NavItem to="/users" icon={<UsersIcon />} label="Users" />
        <NavItem to="/settings" icon={<SettingsIcon />} label="Settings" />
      </nav>
      <div className="mt-auto">
        <FeedbackMenu folded={props.folded} />
      </div>
      <a
        href={PLUGIN_ZIP_URL}
        download
        className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground [&_svg]:size-4"
      >
        <DownloadIcon />
        <span>KontrolWP Connect</span>
      </a>
    </>
  );
}

/** Phones have no sidebar, so a menu button slides the same links in from the left. */
function PhoneMenu() {
  const [open, setOpen] = useState(false);
  const { pathname, search } = useLocation();
  useEffect(() => setOpen(false), [pathname, search]);
  // The page behind is hidden from screen readers while the menu is open; inert also takes its
  // links out of the tab order.
  useEffect(() => {
    const root = document.getElementById("root");
    root?.toggleAttribute("inert", open);
    return () => root?.removeAttribute("inert");
  }, [open]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogPrimitive.Trigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Open menu">
              <MenuIcon />
            </Button>
          </DialogPrimitive.Trigger>
        </TooltipTrigger>
        <TooltipContent>Open menu</TooltipContent>
      </Tooltip>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/10 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Focus the menu itself, so no button's tooltip opens with it.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus({ preventScroll: true });
          }}
          // A link inside closes the menu even when it points at the page already open.
          onClick={(event) => {
            if ((event.target as Element).closest("a[href]")) setOpen(false);
          }}
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[calc(100%-3rem)] flex-col overflow-y-auto border-r bg-sidebar px-3 pt-[max(1rem,var(--app-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] outline-none duration-200 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
        >
          <div className="flex items-center justify-between gap-2">
            <DialogPrimitive.Title asChild>
              <div>
                <Brand />
              </div>
            </DialogPrimitive.Title>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogPrimitive.Close asChild>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Close menu">
                      <XIcon />
                    </Button>
                  </DialogPrimitive.Close>
                </TooltipTrigger>
                <TooltipContent>Close menu</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <SidebarLinks />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

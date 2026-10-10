import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, GlobeIcon, LayoutDashboardIcon, PlugIcon, SettingsIcon, UsersIcon } from "lucide-react";
import { LayoutGroup, motion } from "framer-motion";
import type { ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useMatch } from "react-router";
import { motionTransitions } from "@/lib/motion";
import { accessSetupError, fetchOverview, secretsKeyMissing } from "./api";
import { AccessSetup } from "./components/AccessSetup";
import { ActivityBar } from "./components/ActivityBar";
import { PLUGIN_ZIP_URL } from "./components/PluginDownload";
import { SecretsKeySetup } from "./components/SecretsKeySetup";
import { SettingsPage, useSaveTimeZoneOnce } from "./components/SettingsPage";
import { OverviewPage } from "./components/OverviewPage";
import { PluginsPage } from "./components/PluginsPage";
import { SitePage } from "./components/SitePage";
import { SitesPage } from "./components/SitesPage";
import { ThemeToggle } from "./components/ThemeToggle";
import { UsersPage } from "./components/UsersPage";

export function App() {
  // The overview doubles as the Access check: every page needs the API.
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview, retry: false });
  useSaveTimeZoneOnce(overview.isSuccess);
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
          className={`absolute inset-y-0 left-0 overflow-x-hidden overflow-y-auto border-r bg-sidebar px-3 py-4 ${
            collapsed
              ? "w-14 transition-[width,box-shadow] duration-150 hover:w-56 hover:shadow-2xl hover:delay-100 focus-within:w-56 focus-within:shadow-2xl [&_span]:transition-opacity [&:not(:hover):not(:focus-within)_span]:opacity-0"
              : "w-56"
          }`}
        >
          <div className="flex min-h-full w-50 flex-col whitespace-nowrap">
            <div className="flex items-center justify-between">
              <Brand />
              <ThemeToggle />
            </div>
            <LayoutGroup id="sidebar-nav">
              <nav className="mt-6 space-y-1">
                <NavItem to="/" icon={<LayoutDashboardIcon />} label="Overview" />
                <NavItem to="/sites" icon={<GlobeIcon />} label="Sites" />
                <NavItem to="/plugins" icon={<PlugIcon />} label="Plugins" />
                <NavItem to="/users" icon={<UsersIcon />} label="Users" />
                <NavItem to="/settings" icon={<SettingsIcon />} label="Settings" />
              </nav>
            </LayoutGroup>
            <a
              href={PLUGIN_ZIP_URL}
              download
              className="mt-auto flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground [&_svg]:size-4"
            >
              <DownloadIcon />
              <span>KontrolWP Connect</span>
            </a>
          </div>
        </aside>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
          <Brand compact />
          <div className="flex items-center gap-1">
            <LayoutGroup id="header-nav">
              <nav className="flex gap-1">
                <NavItem to="/" icon={<LayoutDashboardIcon />} label="Overview" compact />
                <NavItem to="/sites" icon={<GlobeIcon />} label="Sites" compact />
                <NavItem to="/plugins" icon={<PlugIcon />} label="Plugins" compact />
                <NavItem to="/users" icon={<UsersIcon />} label="Users" compact />
                <NavItem to="/settings" icon={<SettingsIcon />} label="Settings" compact />
              </nav>
            </LayoutGroup>
            {/* The sidebar is hidden on small screens, so its download link moves here. */}
            <a
              href={PLUGIN_ZIP_URL}
              download
              aria-label="Download the KontrolWP Connect plugin"
              title="KontrolWP Connect plugin"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground [&_svg]:size-4"
            >
              <DownloadIcon />
            </a>
            <ThemeToggle />
          </div>
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

/** compact keeps only the logo on the narrowest phones, where the header nav needs the room. */
function Brand(props: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2">
      <img src="/kontrolwp.svg" alt="KontrolWP" className="size-6" />
      <span
        className={`text-sm font-semibold tracking-tight ${props.compact ? "max-[439px]:sr-only" : ""}`}
        aria-hidden="true"
      >
        KontrolWP
      </span>
    </div>
  );
}

/** compact hides the label on phones, where the header has room only for icons. */
function NavItem(props: { to: string; icon: ReactNode; label: string; compact?: boolean }) {
  return (
    <NavLink
      to={props.to}
      title={props.compact ? props.label : undefined}
      end={props.to === "/"}
      className={({ isActive }) =>
        `relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors [&_svg]:size-4 ${
          isActive
            ? "font-medium text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* EasyUI's PillNavigation: one highlight that slides to the open page. */}
          {isActive && (
            <motion.div
              aria-hidden
              layoutId="nav-active"
              transition={motionTransitions.springMorph}
              className="absolute inset-0 rounded-lg bg-sidebar-accent"
            />
          )}
          {/* A div, not a span: the folded sidebar fades out every span, and the icon must stay. */}
          <div className="relative flex items-center gap-2">
            {props.icon}
            <span className={props.compact ? "sr-only sm:not-sr-only" : undefined}>{props.label}</span>
          </div>
        </>
      )}
    </NavLink>
  );
}

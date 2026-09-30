import { useQuery } from "@tanstack/react-query";
import { LayoutDashboardIcon, GlobeIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router";
import { accessSetupError, fetchOverview } from "./api";
import { AccessSetup } from "./components/AccessSetup";
import { OverviewPage } from "./components/OverviewPage";
import { SitePage } from "./components/SitePage";
import { SitesPage } from "./components/SitesPage";

export function App() {
  // The overview doubles as the Access check: every page needs the API.
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview, retry: false });
  const setupError = accessSetupError(overview.error);
  if (setupError) {
    return (
      <AccessSetup error={setupError} onRetry={() => overview.refetch()} retrying={overview.isFetching} />
    );
  }

  return (
    <div className="flex min-h-dvh bg-canvas text-foreground">
      <aside className="hidden w-56 shrink-0 border-r bg-sidebar px-3 py-4 md:block">
        <Brand />
        <nav className="mt-6 space-y-1">
          <NavItem to="/" icon={<LayoutDashboardIcon />} label="Overview" />
          <NavItem to="/sites" icon={<GlobeIcon />} label="Sites" />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
          <Brand />
          <nav className="flex gap-1">
            <NavItem to="/" icon={<LayoutDashboardIcon />} label="Overview" />
            <NavItem to="/sites" icon={<GlobeIcon />} label="Sites" />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-10">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/sites" element={<SitesPage />} />
            <Route path="/sites/:siteId" element={<SitePage />} />
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
      <img src="/presser.svg" alt="" className="size-6" />
      <span className="text-sm font-semibold tracking-tight">Presser</span>
    </div>
  );
}

function NavItem(props: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={props.to}
      end={props.to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm [&_svg]:size-4 ${
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

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig, MotionGlobalConfig } from "framer-motion";
import { BrowserRouter } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import { ApiError } from "./api";
import { startTheme } from "./theme";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 60_000,
      staleTime: 10_000,
      // Setup errors (Access, the secrets key) and client errors will not fix
      // themselves; retrying only delays the setup screen.
      retry: (failures, error) =>
        !(error instanceof ApiError && (error.code || error.status < 500)) && failures < 3,
    },
  },
});

startTheme();

// MotionConfig's "user" setting still fades opacity; people who ask for reduced
// motion get every animation finished at once instead.
MotionGlobalConfig.skipAnimations = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);

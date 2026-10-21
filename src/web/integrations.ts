import { useQuery } from "@tanstack/react-query";
import {
  fetchCloudflareSettings,
  fetchGoogleSettings,
  fetchPagespeedSettings,
  fetchUmamiSettings,
  fetchWordfenceSettings,
} from "./api";

/**
 * Which integrations are set up and switched on, so the pages, tabs and site
 * settings that need one stay hidden without it. Each is undefined until known.
 * Uses the same queries as the Integrations page, so a change there shows at once.
 */
export function useIntegrations() {
  const once = { refetchInterval: false as const };
  const umami = useQuery({ queryKey: ["settings", "umami"], queryFn: fetchUmamiSettings, ...once });
  const google = useQuery({ queryKey: ["settings", "google"], queryFn: fetchGoogleSettings, ...once });
  const pagespeedKey = useQuery({ queryKey: ["settings", "pagespeed"], queryFn: fetchPagespeedSettings, ...once });
  const wordfence = useQuery({ queryKey: ["settings", "wordfence"], queryFn: fetchWordfenceSettings, ...once });
  const cloudflare = useQuery({ queryKey: ["settings", "cloudflare"], queryFn: fetchCloudflareSettings, ...once });
  const g = google.data;
  return {
    umami: umami.data?.configured,
    ga4: g && g.configured && g.features.analytics,
    searchConsole: g && g.configured && g.features.search_console,
    // PageSpeed Insights tests run with a saved key or the connected Google account.
    pagespeed: g && pagespeedKey.data ? g.features.pagespeed && (g.configured || pagespeedKey.data.configured) : undefined,
    wordfence: wordfence.data?.configured,
    cloudflare: cloudflare.data?.configured,
  };
}

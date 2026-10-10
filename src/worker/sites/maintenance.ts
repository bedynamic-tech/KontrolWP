import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, MAINTENANCE_SINCE } from "../../shared/plugin-version.ts";
import type { Maintenance, MaintenanceSave, SiteSummary } from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("Maintenance mode belongs to a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, MAINTENANCE_SINCE) < 0) {
    throw new SeoError(
      `This needs KontrolWP Connect ${MAINTENANCE_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return credentials;
}

async function call(credentials: SiteCredentials, path: string, body: unknown): Promise<Maintenance> {
  try {
    return await callSite<Maintenance>(credentials, "POST", `${REST_NAMESPACE}${path}`, body);
  } catch (error) {
    if (error instanceof SiteRequestError) throw new SeoError(error.message, 502);
    throw error;
  }
}

export const siteMaintenance = (site: SiteSummary, credentials: SiteCredentials | null) =>
  call(requireSupported(site, credentials), "/maintenance", {});

export const saveMaintenance = (site: SiteSummary, credentials: SiteCredentials | null, settings: MaintenanceSave) =>
  call(requireSupported(site, credentials), "/maintenance/save", settings);

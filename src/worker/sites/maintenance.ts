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

/** Keeps the sites list's maintenance badge in step with what the site just reported. */
async function remember(db: D1Database, site: SiteSummary, result: Maintenance): Promise<Maintenance> {
  if (result.enabled !== site.maintenance) {
    await db.prepare("UPDATE sites SET maintenance = ? WHERE id = ?").bind(result.enabled ? 1 : 0, site.id).run();
  }
  return result;
}

export const siteMaintenance = async (db: D1Database, site: SiteSummary, credentials: SiteCredentials | null) =>
  remember(db, site, await call(requireSupported(site, credentials), "/maintenance", {}));

export const saveMaintenance = async (
  db: D1Database,
  site: SiteSummary,
  credentials: SiteCredentials | null,
  settings: MaintenanceSave,
) => remember(db, site, await call(requireSupported(site, credentials), "/maintenance/save", settings));

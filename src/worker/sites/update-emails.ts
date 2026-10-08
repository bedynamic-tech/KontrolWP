import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, UPDATE_EMAILS_SINCE } from "../../shared/plugin-version.ts";
import type { SiteSummary, UpdateEmails } from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("Update emails belong to a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, UPDATE_EMAILS_SINCE) < 0) {
    throw new SeoError(
      `This needs KontrolWP Connect ${UPDATE_EMAILS_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return credentials;
}

async function call(credentials: SiteCredentials, path: string, body: unknown): Promise<UpdateEmails> {
  try {
    return await callSite<UpdateEmails>(credentials, "POST", `${REST_NAMESPACE}${path}`, body);
  } catch (error) {
    if (error instanceof SiteRequestError) throw new SeoError(error.message, 502);
    throw error;
  }
}

export const siteUpdateEmails = (site: SiteSummary, credentials: SiteCredentials | null) =>
  call(requireSupported(site, credentials), "/update-emails", {});

export const saveUpdateEmails = (site: SiteSummary, credentials: SiteCredentials | null, disabled: boolean) =>
  call(requireSupported(site, credentials), "/update-emails/save", { disabled });

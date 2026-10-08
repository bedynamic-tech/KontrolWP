import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, LOGIN_URL_SINCE } from "../../shared/plugin-version.ts";
import type { LoginUrl, LoginUrlSettings, SiteSummary } from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("A custom login address needs a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, LOGIN_URL_SINCE) < 0) {
    throw new SeoError(
      `This needs KontrolWP Connect ${LOGIN_URL_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return credentials;
}

async function call(credentials: SiteCredentials, path: string, body: unknown): Promise<LoginUrl> {
  try {
    return await callSite<LoginUrl>(credentials, "POST", `${REST_NAMESPACE}${path}`, body);
  } catch (error) {
    if (error instanceof SiteRequestError) throw new SeoError(error.message, error.status === 409 || error.status === 400 ? 400 : 502);
    throw error;
  }
}

export const siteLoginUrl = (site: SiteSummary, credentials: SiteCredentials | null) =>
  call(requireSupported(site, credentials), "/login-url", {});

export const saveLoginUrl = (site: SiteSummary, credentials: SiteCredentials | null, settings: LoginUrlSettings) =>
  call(requireSupported(site, credentials), "/login-url/save", settings);

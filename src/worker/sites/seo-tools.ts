import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, SEO_TOOLS_SINCE } from "../../shared/plugin-version.ts";
import type { SeoFileCheck, SeoTools, SeoToolsSettings, SiteSummary } from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("These tools need a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, SEO_TOOLS_SINCE) < 0) {
    throw new SeoError(
      `These tools need KontrolWP Connect ${SEO_TOOLS_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return credentials;
}

async function call<T>(credentials: SiteCredentials, path: string, body: unknown): Promise<T> {
  try {
    return await callSite<T>(credentials, "POST", `${REST_NAMESPACE}${path}`, body);
  } catch (error) {
    if (error instanceof SiteRequestError) throw new SeoError(error.message, 502);
    throw error;
  }
}

/** The site's verification codes, robots.txt and llms.txt settings. Not cached: the previews must match the site. */
export async function siteSeoTools(site: SiteSummary, credentials: SiteCredentials | null): Promise<SeoTools> {
  const tools = await call<SeoTools>(requireSupported(site, credentials), "/seo/tools", {});
  return withLiveChecks(tools);
}

/** Ask the public site for a file as a visitor would, without following redirects. */
export async function probeFile(url: string): Promise<SeoFileCheck> {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "KontrolWP", Accept: "text/plain" },
      signal: AbortSignal.timeout(6000),
    });
    if (response.status >= 300 && response.status < 400) {
      const to = response.headers.get("location");
      return {
        ok: false,
        detail: `The site redirects it${to ? ` to ${to}` : ""}, so WordPress is not answering for this file. Another plugin, a cache or the web server may be intercepting it.`,
      };
    }
    const type = response.headers.get("content-type") ?? "";
    if (response.status === 200 && type.includes("text/plain")) return { ok: true, detail: "Served correctly." };
    if (response.status === 200)
      return {
        ok: false,
        detail: `The site answered with ${type || "something other than plain text"}, not the file.`,
      };
    return { ok: false, detail: `The site answered with status ${response.status}, so the file is not being served.` };
  } catch {
    return { ok: false, detail: "The dashboard could not reach the site to check." };
  }
}

/** Check the files that are switched on and saved, unless another SEO plugin is in the way. */
async function withLiveChecks(tools: SeoTools): Promise<SeoTools> {
  if (tools.conflict || !tools.urls) return tools;
  const [llms, robots] = await Promise.all([
    tools.settings.llms_mode !== "off" ? probeFile(tools.urls.llms) : undefined,
    tools.settings.robots_mode === "custom" ? probeFile(tools.urls.robots) : undefined,
  ]);
  return { ...tools, live: { ...(llms ? { llms } : {}), ...(robots ? { robots } : {}) } };
}

export async function saveSeoTools(
  site: SiteSummary,
  credentials: SiteCredentials | null,
  settings: SeoToolsSettings,
): Promise<SeoTools> {
  return withLiveChecks(await call<SeoTools>(requireSupported(site, credentials), "/seo/tools/save", settings));
}

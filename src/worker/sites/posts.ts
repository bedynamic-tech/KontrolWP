import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, POST_CREATE_SINCE } from "../../shared/plugin-version.ts";
import type { CreatedPost, NewPost, PostForm, SiteSummary, UploadedImage } from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("Writing posts needs a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, POST_CREATE_SINCE) < 0) {
    throw new SeoError(
      `Writing posts needs KontrolWP Connect ${POST_CREATE_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return credentials;
}

async function call<T>(credentials: SiteCredentials, path: string, body: unknown): Promise<T> {
  try {
    return await callSite<T>(credentials, "POST", `${REST_NAMESPACE}${path}`, body);
  } catch (error) {
    if (!(error instanceof SiteRequestError)) throw error;
    // The web server in front of WordPress has its own size limit (nginx's is 1 MB unless raised).
    if (error.status === 413)
      throw new SeoError("The site's web server turned the image down as too large. Try a smaller image.", 400);
    throw new SeoError(error.message, error.status === 400 ? 400 : 502);
  }
}

export const sitePostForm = (site: SiteSummary, credentials: SiteCredentials | null) =>
  call<PostForm>(requireSupported(site, credentials), "/posts/form", {});

export const createSitePost = (site: SiteSummary, credentials: SiteCredentials | null, post: NewPost) =>
  call<CreatedPost>(requireSupported(site, credentials), "/posts/create", post);

export const uploadSiteImage = (
  site: SiteSummary,
  credentials: SiteCredentials | null,
  image: { name: string; image: string; alt?: string },
) => call<UploadedImage>(requireSupported(site, credentials), "/media/upload", image);

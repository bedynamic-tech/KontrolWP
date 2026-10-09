import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, SEO_SCORE_SINCE, SEO_SINCE } from "../../shared/plugin-version.ts";
import type {
  SeoLocal,
  SeoLocation,
  SeoPageChange,
  SeoPages,
  SeoScore,
  SeoSettings,
  SiteSeo,
  SiteSummary,
} from "../../shared/types.ts";
import { cachedRead, clearContentCache } from "../content-cache.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";

/**
 * A report in the shape the dashboard draws, whatever stored it: an answer
 * kept before locations existed, or one from a plugin that still sends a
 * single business, would otherwise break the SEO tab when it renders.
 */
export function normalizeSeo(report: SiteSeo): SiteSeo {
  const local = (report.settings?.local ?? {}) as Partial<SeoLocal> & Partial<SeoLocation>;
  let locations: SeoLocation[] = [];
  if (Array.isArray(local.locations)) locations = local.locations;
  else if (local.name || local.phone || local.street)
    locations = [{ ...emptyLocation(), ...local, id: "loc1" } as SeoLocation];
  return {
    ...report,
    settings: {
      ...report.settings,
      local: {
        enabled: !!local.enabled,
        // PHP sends a location with no opening hours as [] rather than {}, which the save would refuse.
        locations: locations.map((item) => ({
          ...emptyLocation(),
          ...item,
          hours: item.hours && !Array.isArray(item.hours) ? item.hours : {},
        })),
      },
      // A site on an older plugin reports none of these; they then change nothing.
      noindex_attachment: !!report.settings?.noindex_attachment,
      noindex_author_single: !!report.settings?.noindex_author_single,
      hidden_taxonomies: report.settings?.hidden_taxonomies ?? [],
      hidden_types: report.settings?.hidden_types ?? [],
      strip_category_base: !!report.settings?.strip_category_base,
      author_archives: report.settings?.author_archives ?? "keep",
      type_templates: report.settings?.type_templates && !Array.isArray(report.settings.type_templates) ? report.settings.type_templates : {},
    },
    post_types: report.post_types ?? [],
    taxonomies: report.taxonomies ?? [],
    location_pages: report.location_pages && !Array.isArray(report.location_pages) ? report.location_pages : {},
  };
}

function emptyLocation(): SeoLocation {
  return {
    id: "",
    page_id: 0,
    type: "LocalBusiness",
    name: "",
    phone: "",
    email: "",
    logo: "",
    image: "",
    street: "",
    city: "",
    region: "",
    postal: "",
    country: "",
    latitude: "",
    longitude: "",
    price_range: "",
    hours: {},
    same_as: [],
  };
}

export class SeoError extends Error {
  readonly status: 400 | 502;
  constructor(message: string, status: 400 | 502) {
    super(message);
    this.status = status;
  }
}

/** The SEO tab needs a WordPress site whose KontrolWP Connect is new enough. */
function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("SEO needs a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, SEO_SINCE) < 0) {
    throw new SeoError(
      `SEO needs KontrolWP Connect ${SEO_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return credentials;
}

/** Run a call to the site, turning its failures into a message for the dashboard. */
async function call<T>(credentials: SiteCredentials, path: string, body?: unknown): Promise<T> {
  try {
    return await callSite<T>(credentials, body === undefined ? "GET" : "POST", `${REST_NAMESPACE}${path}`, body);
  } catch (error) {
    if (error instanceof SiteRequestError) throw new SeoError(error.message, 502);
    throw error;
  }
}

/** The site's SEO settings, and whether another SEO plugin is in the way. */
export async function siteSeo(env: Env, site: SiteSummary, credentials: SiteCredentials | null): Promise<SiteSeo> {
  const creds = requireSupported(site, credentials);
  return normalizeSeo(await cachedRead(env.DB, site.id, "seo", "settings", () => call<SiteSeo>(creds, "/seo")));
}

export async function saveSeoSettings(
  env: Env,
  site: SiteSummary,
  credentials: SiteCredentials | null,
  settings: SeoSettings,
): Promise<SiteSeo> {
  const creds = requireSupported(site, credentials);
  const saved = await call<SiteSeo>(creds, "/seo/settings", settings);
  // Cached copies of pages may show the old tags; forget everything kept for the site.
  await clearContentCache(env.DB, site.id);
  return normalizeSeo(saved);
}

/** Published pages with their SEO overrides, 20 at a time. */
export async function listSeoPages(
  env: Env,
  site: SiteSummary,
  credentials: SiteCredentials | null,
  page: number,
  search: string,
): Promise<SeoPages> {
  const creds = requireSupported(site, credentials);
  return cachedRead(env.DB, site.id, "seo", `pages|${page}|${search}`, () =>
    call<SeoPages>(creds, "/seo/pages", { page, search }),
  );
}

export async function saveSeoPage(
  env: Env,
  site: SiteSummary,
  credentials: SiteCredentials | null,
  id: number,
  change: SeoPageChange,
): Promise<void> {
  const creds = requireSupported(site, credentials);
  await call(creds, "/seo/page", { id, ...change });
  await clearContentCache(env.DB, site.id);
}

/** The checklist for one page, from its saved values or the unsaved ones in `draft`. Needs a plugin that has it. */
export async function scoreSeoPage(
  site: SiteSummary,
  credentials: SiteCredentials | null,
  id: number,
  draft: { seo_title?: string; description?: string; keyword?: string },
): Promise<SeoScore> {
  const creds = requireSupported(site, credentials);
  if (compareVersions(site.plugin_version ?? "0", SEO_SCORE_SINCE) < 0) {
    throw new SeoError(
      `The checklist needs KontrolWP Connect ${SEO_SCORE_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return call<SeoScore>(creds, "/seo/score", { id, ...draft });
}

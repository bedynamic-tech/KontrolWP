/**
 * The KontrolWP Connect version this dashboard ships in
 * public/downloads/kontrolwp-connect-<version>.zip. Sites running an older one are offered
 * an update. tests/plugin-lint.test.mjs checks it matches the plugin header.
 */
export const KONTROLWP_CONNECT_VERSION = "0.19.0";

/** The zip's name in public/downloads, as scripts/build-plugin-zip.mjs writes it. */
export const KONTROLWP_CONNECT_ZIP = `kontrolwp-connect-${KONTROLWP_CONNECT_VERSION}.zip`;

/** The first KontrolWP Connect that can take updates from the dashboard. */
export const SELF_UPDATING_SINCE = "0.4.0";

/** Compare dotted versions numerically; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/** The first KontrolWP Connect with Magic Login. */
export const MAGIC_LOGIN_SINCE = "0.5.0";

/** The first KontrolWP Connect that can list, install and remove plugins. */
export const PLUGIN_MANAGEMENT_SINCE = "0.6.0";

/** The first KontrolWP Connect that can turn WordPress's auto-updates on and off. */
export const AUTO_UPDATES_SINCE = "0.7.0";

/** The first KontrolWP Connect that can list, add, change and remove users. */
export const USER_MANAGEMENT_SINCE = "0.8.0";

/** The first KontrolWP Connect that lists its content's links, and opens a post's editor through Magic Login. */
export const LINK_CHECK_SINCE = "0.9.0";

/** The first KontrolWP Connect that lists the links of chosen posts, so Check again sees a link removed from them. */
export const LINK_RECHECK_SINCE = "0.9.2";

/** The first KontrolWP Connect that can take a link out of posts, keeping its text. */
export const LINK_UNLINK_SINCE = "0.9.3";

/** The first KontrolWP Connect that lists the site's posts and pages. */
export const CONTENT_LIST_SINCE = "0.10.0";

/** The first KontrolWP Connect that lists custom post types too, with their names. */
export const CONTENT_TYPES_SINCE = "0.11.0";

/** The first KontrolWP Connect that reports insecure configuration settings for the Security tab. */
export const SECURITY_SINCE = "0.12.0";

/** The first KontrolWP Connect that can switch on the Security tab's hardening fixes. */
export const HARDENING_SINCE = "0.13.0";

/** The first KontrolWP Connect that can switch on the Accessibility tab's fixes. */
export const ACCESSIBILITY_SINCE = "0.14.0";

/** The first KontrolWP Connect that serves the SEO tab as it is today (0.15.0 had a one-business Local SEO shape). */
export const SEO_SINCE = "0.15.1";

/** Redirections (rules, hit counts, 404 log) arrived in this version. */
export const SEO_REDIRECTS_SINCE = "0.16.0";

/** Importing from another SEO plugin arrived in this version. */
export const SEO_MIGRATE_SINCE = "0.17.0";

/** Automatic redirects when content moves or is removed arrived in this version. */
export const SEO_AUTO_REDIRECTS_SINCE = "0.18.0";

/** Indexing controls for attachments, tags, content types and single-author sites arrived in this version. */
export const SEO_INDEXING_SINCE = "0.19.0";

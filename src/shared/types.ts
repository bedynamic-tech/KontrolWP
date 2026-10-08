export type SiteStatus = "pending" | "connected" | "error";

/** A WordPress site managed through KontrolWP Connect, or a static website on Cloudflare Workers. */
export type SiteKind = "wordpress" | "static";

export interface SiteSummary {
  id: number;
  kind: SiteKind;
  /** The name shown everywhere: the owner's own, or the default. */
  name: string;
  /** The owner renamed the site, so a sync keeps `name`. */
  name_custom: boolean;
  /** What Reset restores: the WordPress site title, or null for a static site's domain. */
  default_name: string | null;
  url: string;
  status: SiteStatus;
  last_error: string | null;
  last_synced_at: number | null;
  wp_version: string | null;
  php_version: string | null;
  plugin_version: string | null;
  theme_name: string | null;
  icon_url: string | null;
  pending_comments: number;
  update_count: number;
  created_at: number;
  /** The administrator Magic Login signs in as, if one is chosen. */
  login_user_id: number | null;
  login_user_name: string | null;
  /** KontrolWP Connect's own update job, which never shows in the updates lists. */
  self_update_status: UpdateJobStatus | null;
  self_update_version: string | null;
  self_update_error: string | null;
  /** The owner excluded the site from update checks. */
  updates_excluded: boolean;
  /** The owner excluded the site from broken link detection. */
  links_excluded: boolean;
  analytics_excluded: boolean;
  security_excluded: boolean;
  accessibility_excluded: boolean;
  /** WordPress's own core auto-updates, from the last sync; null before KontrolWP Connect 0.7.0. */
  core_auto_update: CoreAutoUpdate | null;
  /** wp-config.php decides core auto-updates, so KontrolWP cannot change them. */
  core_auto_update_locked: boolean;
  /** False when the site turns plugin auto-updates off in code. */
  plugin_auto_updates: boolean;
  /** The Umami website the owner chose for this site; null matches by domain. */
  umami_website_id: string | null;
  /** Where this site's analytics come from. */
  analytics_provider: AnalyticsProvider;
  /** The Web Analytics site or GA4 property the owner chose, for providers other than Umami; null matches by domain. */
  analytics_ref: string | null;
  /** Static sites: hosted on Cloudflare Workers, so Deployments and the Worker below apply. */
  cf_hosted: boolean;
  /** Static sites hosted there: the Worker they deploy from, and why reading it last failed. */
  cf_account_id: string | null;
  cf_worker: string | null;
  cf_error: string | null;
  /** Static sites: when the newest deployment went live, in seconds. */
  last_deployed_at: number | null;
}

/** Core auto-updates: every new version, maintenance and security releases only, or none. */
export type CoreAutoUpdate = "all" | "minor" | "off";

/** An administrator on a site, as KontrolWP Connect lists them for Magic Login. */
export interface SiteAdmin {
  id: number;
  login: string;
  display_name: string;
}

export type UpdateKind = "core" | "plugin" | "theme";

export interface SiteUpdate {
  site_id: number;
  site_name: string;
  site_url: string;
  kind: UpdateKind;
  slug: string;
  name: string;
  current_version: string;
  new_version: string;
  /** The plugin's icon, the theme's screenshot or the WordPress logo, when known. */
  icon_url: string | null;
  /** The owner's request to install it, if any. `done` lasts until the next sync. */
  job_status: UpdateJobStatus | null;
  /** Why the last attempt failed, or a note while it waits to retry. */
  job_error: string | null;
  /**
   * KontrolWP is still working on it: the job is queued or running, or it just
   * finished and the sync that clears the row has not landed yet.
   */
  job_active: boolean;
}

export type UpdateJobStatus = "queued" | "running" | "done" | "failed";

export interface PendingComment {
  site_id: number;
  site_name: string;
  comment_id: number;
  author: string;
  author_email: string;
  content: string;
  post_title: string;
  post_url: string;
  created_at: number;
}

export type CommentAction = "approve" | "spam" | "trash";

export interface Overview {
  sites: SiteSummary[];
  updates: SiteUpdate[];
  comments: PendingComment[];
  links: FleetLinks;
}

/** A broken or unresponsive link on one site, for the Overview. */
export interface FleetLink {
  site_id: number;
  site_name: string;
  url: string;
  status: "broken" | "unresponsive";
  http_status: number | null;
  error: string | null;
  checked_at: number | null;
  /** One post it appears in, and how many posts in all. */
  post_title: string | null;
  post_count: number;
}

/** Broken and unresponsive links across every site; ignored and uncheckable ones are left out. */
export interface FleetLinks {
  total: number;
  /** Whether any site has been checked yet. */
  scanned: boolean;
  items: FleetLink[];
}

export interface SiteDetail {
  site: SiteSummary;
  updates: SiteUpdate[];
  comments: PendingComment[];
}

/** What KontrolWP Connect reports. Mirrors plugin/kontrolwp-connect/includes/class-kontrolwp-connect-rest.php. */
export interface PluginStatus {
  name: string;
  home_url: string;
  wp_version: string;
  php_version: string;
  plugin_version: string;
  theme: string;
  /** KontrolWP Connect 0.2.1+: the Site Icon URL, or "" when there is none. */
  icon_url?: string;
  /** KontrolWP Connect 0.7.0+. */
  core_auto_update?: { mode: CoreAutoUpdate; locked: boolean };
}

/** `icon_url` arrives from KontrolWP Connect 0.3+. */
export interface PluginUpdates {
  core: { current: string; new_version: string; icon_url?: string } | null;
  plugins: Array<{ slug: string; name: string; current_version: string; new_version: string; icon_url?: string }>;
  themes: Array<{ slug: string; name: string; current_version: string; new_version: string; icon_url?: string }>;
}

export interface PluginComments {
  pending_count: number;
  comments: Array<{
    id: number;
    author: string;
    author_email: string;
    content: string;
    post_title: string;
    post_url: string;
    date_gmt: string;
  }>;
}

/** A plugin installed on a site, as KontrolWP Connect 0.6.0+ lists it. */
export interface InstalledPlugin {
  /** Plugin file relative to wp-content/plugins, such as akismet/akismet.php. */
  file: string;
  name: string;
  version: string;
  author: string;
  active: boolean;
  network_active: boolean;
  /** KontrolWP Connect itself: never deactivated or deleted from KontrolWP. */
  protected: boolean;
  /** KontrolWP Connect 0.7.0+: WordPress updates it automatically. */
  auto_update?: boolean;
  /** KontrolWP Connect 0.7.1+: its icon from WordPress's last update check, or "". */
  icon_url?: string;
}

export interface SitePlugins {
  plugins: InstalledPlugin[];
  /** False when the site sets DISALLOW_FILE_MODS: no installs or deletes. */
  can_modify_files: boolean;
  /** KontrolWP Connect 0.7.0+: false when the site turns plugin auto-updates off in code. */
  auto_updates?: boolean;
}

export type PluginAction = "activate" | "deactivate" | "delete" | "enable-auto-update" | "disable-auto-update";

/** One plugin on one site, as last synced, for the fleet-wide Plugins page. */
export interface FleetPlugin {
  site_id: number;
  site_name: string;
  site_url: string;
  site_icon_url: string | null;
  updates_excluded: boolean;
  site_plugin_version: string | null;
  /** False when the site turns plugin auto-updates off in code. */
  site_plugin_auto_updates: boolean;
  file: string;
  name: string;
  version: string;
  author: string;
  active: boolean;
  network_active: boolean;
  protected: boolean;
  auto_update: boolean;
  /** The version WordPress offers, when an update is available. */
  new_version: string | null;
  icon_url: string | null;
  job_status: UpdateJobStatus | null;
  job_error: string | null;
}

export interface FleetPlugins {
  plugins: FleetPlugin[];
  /** Connected sites whose KontrolWP Connect cannot list plugins yet. */
  unsupported_sites: { id: number; name: string; plugin_version: string | null }[];
}

export interface BulkPluginResult {
  site_id: number;
  ok: boolean;
  error?: string;
}

/** The services a site's analytics can be read from. */
export const ANALYTICS_PROVIDERS = ["umami", "cloudflare", "ga4"] as const;
export type AnalyticsProvider = (typeof ANALYTICS_PROVIDERS)[number];

export type UmamiMode = "cloud" | "self-hosted";

/** The Umami connection as Settings shows it; the API key or password never leaves the Worker. */
export interface UmamiSettings {
  configured: boolean;
  mode: UmamiMode;
  /** The self-hosted Umami address; empty for Umami Cloud. */
  url: string;
  username: string;
}

export interface UmamiWebsite {
  id: string;
  name: string;
  domain: string;
}

export type AnalyticsRange = "24h" | "7d" | "30d" | "90d";

export interface AnalyticsStat {
  value: number;
  /** The same figure for the period before, when Umami reports it. */
  previous: number | null;
}

export interface SiteAnalytics {
  /** Where the numbers come from; an answer saved before providers existed has none, and is Umami's. */
  provider?: AnalyticsProvider;
  /** The source shown (an Umami website, a Web Analytics site or a GA4 property), or null when none matches the site. */
  website: UmamiWebsite | null;
  /** True when the owner chose the website rather than KontrolWP matching it by domain. */
  chosen: boolean;
  range: AnalyticsRange;
  stats: {
    /** A provider that does not count visitors (Cloudflare) has none. */
    visitors: AnalyticsStat | null;
    visits: AnalyticsStat;
    pageviews: AnalyticsStat;
    bounces: AnalyticsStat | null;
    /** Total visit time in seconds. */
    totaltime: AnalyticsStat | null;
  } | null;
  /** One point per hour (24h) or day, in the browser's time zone. */
  series: { label: string; pageviews: number; visitors: number }[];
  pages: { label: string; count: number }[];
  referrers: { label: string; count: number }[];
}

/** The Analytics tab's breakdowns, each Umami's top 10 for the period. */
export const ANALYTICS_BREAKDOWNS = [
  "pages",
  "entry",
  "exit",
  "referrers",
  "countries",
  "cities",
  "browsers",
  "os",
  "devices",
  "events",
] as const;
export type AnalyticsBreakdown = (typeof ANALYTICS_BREAKDOWNS)[number];

/** The Analytics tab: the summary, more breakdowns, and who is on the site now. */
export interface SiteAnalyticsDetails extends SiteAnalytics {
  /** A breakdown is null when this Umami version doesn't offer it. */
  breakdowns: Record<AnalyticsBreakdown, { label: string; count: number }[] | null> | null;
  /** Visitors in the last five minutes, when Umami reports it. */
  active: number | null;
}

/** How often every site is synced in the background, in minutes. */
export const SYNC_INTERVALS = [15, 30, 60, 180, 360] as const;
export type SyncInterval = (typeof SYNC_INTERVALS)[number];

export interface SyncSettings {
  interval_minutes: SyncInterval;
}

/** How often every site's links are checked, in days, at midnight; 0 is off. */
export const LINK_SCAN_INTERVALS = [0, 1, 3, 5, 7] as const;
export type LinkScanInterval = (typeof LINK_SCAN_INTERVALS)[number];

export interface LinkScanSettings {
  interval_days: LinkScanInterval;
  /** The IANA time zone midnight is in, such as America/Chicago; null until the dashboard saves the browser's. */
  time_zone: string | null;
}

/** The settings, plus when the next scheduled check starts (unix seconds; null when off). */
export interface LinkScanSchedule extends LinkScanSettings {
  next_run_at: number | null;
}

/** One DNS record, as a public resolver answers for it. */
export interface DnsRecord {
  type: "A" | "AAAA" | "CNAME" | "MX" | "NS" | "TXT" | "CAA" | "SOA";
  name: string;
  value: string;
  ttl: number;
}

/** Registration details from the registry (RDAP); times in Unix seconds. */
export interface DomainRegistration {
  registrar: string | null;
  registered_at: number | null;
  updated_at: number | null;
  expires_at: number | null;
  /** EPP status codes, such as "client transfer prohibited". */
  statuses: string[];
  nameservers: string[];
  /** Whether the registry has DNSSEC on for the domain; null when it doesn't say. */
  dnssec: boolean | null;
}

/** A site's domain, looked up live when the Domain tab opens. */
export interface SiteDomain {
  /** The registered domain, such as example.co.uk. */
  domain: string;
  /** The site's own host, such as www.example.co.uk. */
  host: string;
  registration: DomainRegistration | null;
  registration_error: string | null;
  dns: DnsRecord[];
  dns_error: string | null;
  checked_at: number;
}

/** A WordPress role on a site: its slug and display name. */
export interface UserRole {
  slug: string;
  name: string;
}

/** One WordPress user, as KontrolWP Connect 0.8.0+ lists them. */
export interface SiteUser {
  id: number;
  login: string;
  email: string;
  display_name: string;
  roles: string[];
  /** Unix seconds. */
  registered: number;
}

/** A page a static site's sitemap lists. */
export interface SitemapPage {
  url: string;
  /** The sitemap's last modified date, as written (a date or a date and time); null when it gives none. */
  lastmod: string | null;
}

/** A static site's pages, read from its sitemap. */
export interface SiteSitemap {
  /** The sitemap file the pages came from, or null when none was found. */
  sitemap_url: string | null;
  items: SitemapPage[];
  total: number;
  /** The site lists more pages than KontrolWP keeps. */
  truncated: boolean;
  error: string | null;
}

/** The statuses the Posts and pages tab lists. Trash is left out. */
export const CONTENT_STATUSES = ["publish", "future", "draft", "pending", "private"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** A public post type on the site: posts, pages and any custom type. */
export interface ContentTypeInfo {
  slug: string;
  /** Plural, as WordPress labels it: "Products". */
  name: string;
  singular: string;
}

/** A post or page, as the site lists it. Dates are seconds since the epoch, in UTC. */
export interface SiteContentItem {
  id: number;
  title: string;
  /** The post type slug. */
  type: string;
  status: ContentStatus;
  author: string;
  date: number;
  modified: number;
  permalink: string;
}

/** One page of a site's posts and pages, with how many there are of each status for the chosen type. */
export interface SiteContent {
  items: SiteContentItem[];
  counts: Record<ContentStatus, number>;
  total: number;
  /** The site's public post types; an older KontrolWP Connect lists only posts and pages and sends none. */
  types?: ContentTypeInfo[];
}

export interface SiteUsers {
  users: SiteUser[];
  roles: UserRole[];
  /** Every user on the site; the list stops at 2000. */
  total: number;
}

export type UserAction = "set-role" | "reset-password" | "delete";

export interface NewUser {
  login: string;
  email: string;
  role: string;
  first_name?: string;
  last_name?: string;
  /** Empty: the user sets their own from the welcome email. */
  password?: string;
  /** Send WordPress's new-user email with a link to set a password. */
  notify: boolean;
}

/** One user on one site, for the Users page. */
export interface FleetUser {
  site_id: number;
  site_name: string;
  site_url: string;
  site_icon_url: string | null;
  user_id: number;
  login: string;
  email: string;
  display_name: string;
  roles: string[];
  registered: number;
  /** The administrator Magic Login signs in as on this site. */
  magic_login: boolean;
}

export interface FleetUsers {
  users: FleetUser[];
  /** Every role found on any site, for choosing one. */
  roles: UserRole[];
  /** Connected sites whose KontrolWP Connect cannot manage users yet. */
  unsupported_sites: { id: number; name: string; plugin_version: string | null }[];
}

export interface BulkUserResult {
  site_id: number;
  user_id: number;
  ok: boolean;
  error?: string;
}

/** What checking a link found. "blocked" means the other site refused the check, so it couldn't be tested. */
export type LinkStatus = "pending" | "ok" | "broken" | "unresponsive" | "blocked";

/** A site's link scan: KontrolWP Connect lists the links, then the Worker checks each one. */
export interface LinkScan {
  /** "stopped" is a scan that made no progress for a while; scan again to restart it. */
  status: "collecting" | "checking" | "done" | "failed" | "stopped";
  error: string | null;
  posts_scanned: number;
  total_urls: number;
  checked_urls: number;
  started_at: number;
  finished_at: number | null;
  /** The site has more addresses than one scan lists, so the newest content was left out. */
  truncated: boolean;
}

/** One place a link appears. */
export interface LinkRef {
  post_id: number;
  post_title: string;
  post_type: string;
  permalink: string;
  link_text: string;
  kind: "link" | "image";
}

export interface SiteLink {
  url: string;
  status: LinkStatus;
  http_status: number | null;
  error: string | null;
  checked_at: number | null;
  ignored: boolean;
  refs: LinkRef[];
}

/** The Links tab: the latest scan, counts, and every link that needs a look (plus the ignored ones). */
export interface SiteLinks {
  scan: LinkScan | null;
  counts: Record<Exclude<LinkStatus, "pending">, number> & { ignored: number; total: number };
  links: SiteLink[];
}

/** What Remove link did. */
export interface LinkUnlinkResult {
  /** Addresses that left the list because no post links to them any more. */
  links_removed: number;
  posts_changed: number;
  /** Button blocks pointing at the address, left as they are. */
  buttons_kept: number;
  /** Addresses also used as images, which are left in place. */
  images_kept: number;
}

/** The Cloudflare connection as Settings shows it; the API token never leaves the Worker. */
export interface CloudflareSettings {
  configured: boolean;
}

/** A Worker the Cloudflare token can see, for choosing a static site's deployments. */
export interface CloudflareWorker {
  account_id: string;
  account_name: string;
  name: string;
  tag: string;
}

export type DeploymentStatus = "live" | "queued" | "building" | "success" | "failed" | "cancelled" | "skipped";

/** One deployment (a version went live) or build (Workers Builds ran) of a static site. */
export interface SiteDeployment {
  type: "deployment" | "build";
  ref: string;
  created_at: number;
  status: DeploymentStatus;
  message: string;
  author: string;
  source: string;
  branch: string;
  commit_hash: string;
}

export interface SiteDeployments {
  /** A Cloudflare token is saved in Settings. */
  configured: boolean;
  /** The Worker this site deploys from, if one is chosen. */
  worker: string | null;
  /** Why the last read from Cloudflare failed. */
  error: string | null;
  deployments: SiteDeployment[];
}

/** One page of a build's log. */
export interface BuildLog {
  lines: { time: number; text: string }[];
  /** Pass back to read the next page; null at the end. */
  cursor: string | null;
  truncated: boolean;
}

export type VulnSeverity = "critical" | "high" | "medium" | "low" | "unknown";

/** A known vulnerability that affects the version of WordPress or a plugin a site runs. */
export interface SiteVulnerability {
  id: string;
  kind: "core" | "plugin";
  slug: string;
  name: string;
  installed_version: string;
  /** False for an installed plugin that is switched off; its files are still on the site. */
  active: boolean;
  title: string;
  cve: string | null;
  cvss: number | null;
  severity: VulnSeverity;
  /** The first version that fixes it, when the feed names one. */
  patched_in: string | null;
  url: string;
}

export interface SecurityCheck {
  id: string;
  /** "ok" passes; "warning" is worth fixing. */
  status: "ok" | "warning";
  title: string;
  detail: string;
}

/** One hardening fix: `enabled` is set from the dashboard; `applied` is whether it is in effect on the site now. */
export interface SecurityFix {
  id: string;
  title: string;
  detail: string;
  enabled: boolean;
  applied: boolean;
}

/** One line of the Security tab's settings list: a finding, with the fix that clears it when there is one. */
export interface SecurityItem {
  id: string;
  status: "ok" | "warning";
  title: string;
  detail: string;
  /** The hardening fix behind it; null when the finding has to be fixed by hand. */
  fix: { id: string; enabled: boolean } | null;
}

export interface SiteSecurity {
  vulnerabilities: SiteVulnerability[];
  items: SecurityItem[];
  /** Why the plugin's own settings are missing from the items, when they are. */
  checks_note: string | null;
  feed: {
    configured: boolean;
    updated_at: number | null;
    error: string | null;
    note: string | null;
    /** When the next download is tried, after a failure. */
    next_attempt_at: number | null;
  };
}

/** One kind of accessibility problem found on a site's pages. */
export interface AccessibilityIssue {
  rule: string;
  title: string;
  impact: import("./accessibility.ts").AccessibilityImpact;
  /** The WCAG 2.1 success criterion. */
  wcag: string;
  help: string;
  /** How many times it was found across the scanned pages. */
  count: number;
  /** The scanned pages it appears on. */
  pages: string[];
  /** A few of the elements, as written in the page. */
  examples: string[];
  /** The automatic fix that clears it; null when it has to be fixed by hand. */
  fix: { id: string; title: string; enabled: boolean; applied: boolean } | null;
}

export interface AccessibilityScan {
  scanned_at: number;
  score: number;
  pages: string[];
  issues: AccessibilityIssue[];
}

export interface SiteAccessibility {
  scan: AccessibilityScan | null;
  /** The reason the latest attempt failed, when it did. */
  error: string | null;
  history: { scanned_at: number; score: number }[];
  /** Every automatic fix and whether it is on; empty when the site cannot take them. */
  fixes: { id: string; title: string; detail: string; enabled: boolean; applied: boolean }[];
  /** Why the automatic fixes are missing, when they are. */
  fixes_note: string | null;
  /** Whether this site can take automatic fixes (WordPress with KontrolWP Connect 0.14.0 or later). */
  can_fix: boolean;
}

export const SEO_SEPARATORS = ["-", "|", "·", "»", "•"] as const;

export const SEO_BUSINESS_TYPES = [
  ["LocalBusiness", "Local business"],
  ["Restaurant", "Restaurant"],
  ["CafeOrCoffeeShop", "Cafe or coffee shop"],
  ["Store", "Store"],
  ["ProfessionalService", "Professional service"],
  ["LegalService", "Legal service"],
  ["AccountingService", "Accounting service"],
  ["FinancialService", "Financial service"],
  ["Dentist", "Dentist"],
  ["Physician", "Physician"],
  ["HealthAndBeautyBusiness", "Health and beauty"],
  ["RealEstateAgent", "Real estate agent"],
  ["HomeAndConstructionBusiness", "Home and construction"],
  ["AutomotiveBusiness", "Automotive"],
  ["LodgingBusiness", "Lodging"],
  ["SportsActivityLocation", "Sports and fitness"],
  ["EntertainmentBusiness", "Entertainment"],
] as const;

export const SEO_DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;

/** One business location, marked up as schema.org LocalBusiness. */
export interface SeoLocation {
  /** Stable key for the list; made in the dashboard. */
  id: string;
  /** A page that stands for this location and carries its markup; 0 puts it on the home page. */
  page_id: number;
  type: string;
  name: string;
  phone: string;
  email: string;
  logo: string;
  image: string;
  street: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  latitude: string;
  longitude: string;
  price_range: string;
  /** Opening hours by day key (mon to sun, 24 hour HH:MM); a missing day is closed. */
  hours: Record<string, { open: string; close: string }>;
  same_as: string[];
}

export const MAX_SEO_LOCATIONS = 50;

export interface SeoLocal {
  enabled: boolean;
  locations: SeoLocation[];
}

/** The SEO options KontrolWP Connect applies to a site's pages. */
export interface SeoSettings {
  enabled: boolean;
  separator: (typeof SEO_SEPARATORS)[number];
  /** Tokens: %title%, %sitename%, %tagline%, %sep%. */
  title_template: string;
  home_title: string;
  home_description: string;
  og_enabled: boolean;
  og_image: string;
  twitter_card: "summary" | "summary_large_image";
  twitter_site: string;
  noindex_search: boolean;
  noindex_author: boolean;
  noindex_date: boolean;
  /** Hide attachment pages (the page WordPress makes for each uploaded file). */
  noindex_attachment: boolean;
  /** Hide author pages on a site where one person writes everything, as they repeat the blog. */
  noindex_author_single: boolean;
  /** Taxonomies (tags, categories, ...) whose pages are hidden from search and left out of the sitemap. */
  hidden_taxonomies: string[];
  /** Content types hidden from search and the sitemap. */
  hidden_types: string[];
  canonical: boolean;
  sitemap: boolean;
  local: SeoLocal;
  /** Leave "category" out of category addresses; the old addresses redirect. */
  strip_category_base: boolean;
  /** What an author archive does: stays, redirects to the home page, or answers not found. */
  author_archives: "keep" | "redirect" | "404";
  /** Title and description templates by content type; a type with none uses the site-wide title template. */
  type_templates: Record<string, { title: string; description: string }>;
}

/** A category address before and after the base is left out, for the preview beside the setting. */
export interface SeoCategoryPreview {
  /** False when the site's permalinks or categories give nothing to shorten. */
  supported: boolean;
  base: string;
  old: string;
  new: string;
  /** Categories that keep their old address, because a page already uses the short one. */
  skipped: string[];
}

export interface SiteSeo {
  settings: SeoSettings;
  /** The name of another SEO plugin on the site, which stops KontrolWP printing tags; empty when none. */
  conflict: string;
  site_name: string;
  tagline: string;
  home_url: string;
  /** WordPress's own "Discourage search engines" switch is on. */
  discouraged: boolean;
  /** Title and address of each page a location is tied to, by page id. */
  location_pages: Record<string, { title: string; url: string }>;
  /** Public content types and taxonomies on the site, for the hide lists. */
  post_types: { name: string; label: string }[];
  taxonomies: { name: string; label: string }[];
  /** A plugin before 0.22.0 sends none. */
  category?: SeoCategoryPreview;
}

/** One page's SEO overrides; an empty value means the site-wide defaults apply. */
export interface SeoPageChange {
  seo_title?: string;
  description?: string;
  noindex?: boolean;
  image?: string;
  /** The phrase the page is meant to rank for; empty means none. */
  keyword?: string;
}

export type SeoScoreStatus = "good" | "needs_work";

export interface SeoScoreCheck {
  id: string;
  label: string;
  status: "good" | "improve" | "skipped";
  detail: string;
  /** Does not affect the overall status. */
  optional: boolean;
}

/** The checklist for one page: guidance, not a ranking promise. */
export interface SeoScore {
  keyword: string;
  status: SeoScoreStatus;
  checks: SeoScoreCheck[];
}

export interface SeoPage extends Required<SeoPageChange> {
  /** The checklist's overall status; a plugin before 0.23.0 sends none. */
  score?: SeoScoreStatus;
  id: number;
  title: string;
  type: string;
  permalink: string;
  /** What the description would be without an override. */
  excerpt: string;
}

export interface SeoPages {
  items: SeoPage[];
  total: number;
}

export const REDIRECT_CODES = [301, 302, 307, 308, 410, 451] as const;
export type RedirectCode = (typeof REDIRECT_CODES)[number];
export const REDIRECT_MATCH_TYPES = ["exact", "prefix", "regex"] as const;
export type RedirectMatchType = (typeof REDIRECT_MATCH_TYPES)[number];
export const MAX_REDIRECT_IMPORT = 5000;

/** What a redirect rule is made of, as the dashboard sends it. */
export interface RedirectInput {
  source: string;
  match_type: RedirectMatchType;
  /** Empty for 410 and 451, which answer without sending the visitor anywhere. */
  target: string;
  status_code: RedirectCode;
  enabled: boolean;
}

export interface Redirect extends RedirectInput {
  id: number;
  /** Made by KontrolWP when content moved or was removed, not by a person. */
  auto: boolean;
  hits: number;
  /** Unix seconds, 0 when never used. */
  last_hit: number;
}

export const REDIRECT_DELETE_ACTIONS = ["none", "410", "301"] as const;
export type RedirectDeleteAction = (typeof REDIRECT_DELETE_ACTIONS)[number];

/** Redirects KontrolWP makes by itself when content moves or is removed. */
export interface AutoRedirectSettings {
  enabled: boolean;
  /** What happens to the address of removed content: nothing, a "gone" answer, or a redirect to `target`. */
  on_delete: RedirectDeleteAction;
  target: string;
}

export interface RedirectSettingsChange {
  log_404?: boolean;
  auto_enabled?: boolean;
  on_delete?: RedirectDeleteAction;
  delete_target?: string;
}

export interface SiteRedirects {
  items: Redirect[];
  total: number;
  /** Absent from sites running a plugin older than 0.18.0. */
  auto?: AutoRedirectSettings;
  /** Whether the site records addresses that answered "not found". */
  log_404: boolean;
}

export interface NotFoundEntry {
  path: string;
  hits: number;
  last_seen: number;
  referrer: string;
}

export interface NotFoundLog {
  items: NotFoundEntry[];
  total: number;
}

export interface RedirectImportResult {
  added: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

/** Another SEO plugin on a site whose settings can be brought into KontrolWP. */
export interface SeoMigrationSource {
  id: string;
  name: string;
  active: boolean;
}

export interface SeoMigrationPreview {
  source: string;
  name: string;
  active: boolean;
  /** KontrolWP's own SEO tags are already switched on. */
  enabled: boolean;
  /** Site-wide settings that would be filled in: the setting name and the value. */
  settings: { key: string; value: string }[];
  pages: {
    total: number;
    titles: number;
    descriptions: number;
    noindex: number;
    images: number;
    /** Focus keywords; absent from sites before 0.26.0. */
    keywords?: number;
    /** Pages that already have KontrolWP SEO values, which are kept. */
    existing: number;
    /** More pages than could be read; run the import again for the rest. */
    truncated: boolean;
  };
  redirects: { total: number; importable: number; samples: RedirectInput[] };
}

export interface SeoMigrationParts {
  settings: boolean;
  pages: boolean;
  redirects: boolean;
}

export interface SeoMigrationResult {
  settings: string[];
  pages: { updated: number; skipped: number };
  redirects: RedirectImportResult;
}

export const SEO_VERIFY_SERVICES = ["google", "bing", "yandex", "baidu", "pinterest"] as const;
export type SeoVerifyService = (typeof SEO_VERIFY_SERVICES)[number];

/** Verification codes, robots.txt, llms.txt and IndexNow. */
export interface SeoToolsSettings {
  /** The code from each service, or a whole meta tag (the plugin keeps just the code). */
  verify: Record<SeoVerifyService, string>;
  robots_mode: "default" | "custom";
  robots_text: string;
  llms_mode: "off" | "auto" | "custom";
  llms_text: string;
  indexnow: boolean;
}

export interface SeoTools {
  settings: SeoToolsSettings;
  /** Another SEO plugin is active, so none of this is applied. */
  conflict: string;
  /** WordPress is set to discourage search engines, which keeps its own robots.txt. */
  public: boolean;
  /** A real robots.txt file sits in the site folder, so WordPress never gets to answer. */
  robots_file_exists: boolean;
  robots_default: string;
  llms_auto: string;
  urls: { robots: string; llms: string };
  /** What the dashboard saw when it asked the live site for each saved file; absent when the file is not in use. */
  live?: { llms?: SeoFileCheck; robots?: SeoFileCheck };
}

/** The result of fetching one of a site's files from the public internet. */
export interface SeoFileCheck {
  ok: boolean;
  /** What happened, in a sentence the dashboard can show. */
  detail: string;
}

export const MAX_ROBOTS_TEXT = 5000;
export const MAX_LLMS_TEXT = 20000;

export const SEO_BREADCRUMB_SEPARATORS = ["›", "/", ">", "»", "-", "|"] as const;

/** Site-wide schema, breadcrumbs, link rules, image alt text and the feed footer. */
export interface SeoContentSettings {
  schema: boolean;
  schema_type: "organization" | "person";
  /** Empty uses the site name. */
  schema_name: string;
  /** Empty uses the site icon. */
  schema_logo: string;
  schema_same_as: string[];
  article_schema: boolean;
  breadcrumbs: boolean;
  breadcrumb_home: string;
  breadcrumb_sep: (typeof SEO_BREADCRUMB_SEPARATORS)[number];
  external_new_tab: boolean;
  external_nofollow: boolean;
  image_alt: boolean;
  /** Add a title attribute to images that have none, from the media library title. */
  image_title: boolean;
  /** Tokens: %title%, %link%, %sitename%. Empty adds nothing to feeds. */
  feed_footer: string;
}

export interface SeoContent {
  settings: SeoContentSettings;
  conflict: string;
  /** SEO tags are switched on; none of these apply until they are. */
  seo_enabled: boolean;
  /** The site's WordPress can rewrite links and images as they are shown (6.2 or later). */
  html_support: boolean;
  site_icon: string;
  site_name: string;
}

export const MAX_SCHEMA_LINKS = 20;

export const UPDATE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type UpdateFrequency = (typeof UPDATE_FREQUENCIES)[number];

/** What a scheduled run updates, and when. */
export interface UpdateSchedule {
  core: boolean;
  plugins: boolean;
  themes: boolean;
  frequency: UpdateFrequency;
  /** 0 (Sunday) to 6, for weekly. */
  weekday: number;
  /** 1 to 28, for monthly. */
  day: number;
  /** 0 to 23, in the time zone chosen under Link checks. */
  hour: number;
}

/** The policy every site follows unless it sets its own. */
export interface GlobalUpdatePolicy extends UpdateSchedule {
  enabled: boolean;
  /** Plugin files such as "akismet/akismet.php", left out of scheduled runs on every site. */
  excluded_plugins: string[];
}

/** One site's choice: follow the global policy, use its own schedule, or run none. */
export interface SiteUpdatePolicy {
  mode: "inherit" | "custom" | "off";
  /** Used when `mode` is "custom". */
  schedule: UpdateSchedule;
  /** Left out of scheduled runs on this site, besides the globally excluded ones. */
  excluded_plugins: string[];
}

export interface UpdateRun {
  id: number;
  site_id: number;
  site_name: string;
  ran_at: number;
  queued: number;
  /** Updates left out because their plugin is excluded. */
  skipped: number;
  items: { kind: UpdateKind; name: string; version: string }[];
}

export interface GlobalUpdatePolicyView {
  policy: GlobalUpdatePolicy;
  time_zone: string;
  /** When the next run is due; null when the policy is off. */
  next_run_at: number | null;
  runs: UpdateRun[];
}

export interface SiteUpdatePolicyView {
  policy: SiteUpdatePolicy;
  global: GlobalUpdatePolicy;
  time_zone: string;
  /** Which schedule applies to this site now. */
  effective: "off" | "global" | "custom";
  next_run_at: number | null;
  runs: UpdateRun[];
}

/** One kind of SEO problem found on a static site. */
export interface SeoAuditIssue {
  rule: string;
  title: string;
  impact: import("./seo-audit.ts").SeoImpact;
  /** What to change on the site. */
  help: string;
  /** How many times it was found across the checked pages. */
  count: number;
  /** The checked pages it appears on; empty for a site-wide finding. */
  pages: string[];
  /** A few of the values found, as written in the page. */
  examples: string[];
}

export interface SeoAuditScan {
  scanned_at: number;
  score: number;
  pages: string[];
  issues: SeoAuditIssue[];
}

/** The SEO health check of a static site: the latest result and its score history. */
export interface SiteSeoAudit {
  scan: SeoAuditScan | null;
  /** The reason the latest attempt failed, when it did. */
  error: string | null;
  history: { scanned_at: number; score: number }[];
}

export type SiteStatus = "pending" | "connected" | "error";

/** A WordPress site managed through KontrolWP Connect, or a static website on Cloudflare Workers. */
export type SiteKind = "wordpress" | "static";

export interface SiteSummary {
  id: number;
  kind: SiteKind;
  name: string;
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
  /** WordPress's own core auto-updates, from the last sync; null before KontrolWP Connect 0.7.0. */
  core_auto_update: CoreAutoUpdate | null;
  /** wp-config.php decides core auto-updates, so KontrolWP cannot change them. */
  core_auto_update_locked: boolean;
  /** False when the site turns plugin auto-updates off in code. */
  plugin_auto_updates: boolean;
  /** The Umami website the owner chose for this site; null matches by domain. */
  umami_website_id: string | null;
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
  /** The Umami website shown, or null when none matches the site. */
  website: UmamiWebsite | null;
  /** True when the owner chose the website rather than KontrolWP matching it by domain. */
  chosen: boolean;
  range: AnalyticsRange;
  stats: {
    visitors: AnalyticsStat;
    visits: AnalyticsStat;
    pageviews: AnalyticsStat;
    bounces: AnalyticsStat;
    /** Total visit time in seconds. */
    totaltime: AnalyticsStat;
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

/** Dashboard layout choices from Settings. */
export interface LayoutSettings {
  /** The site page below its summary: one column, or Updates and the rest left of Analytics. */
  site_columns: 1 | 2;
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

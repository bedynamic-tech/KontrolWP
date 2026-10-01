export type SiteStatus = "pending" | "connected" | "error";

export interface SiteSummary {
  id: number;
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
  /** Presser Connect's own update job, which never shows in the updates lists. */
  self_update_status: UpdateJobStatus | null;
  self_update_version: string | null;
  self_update_error: string | null;
  /** The owner excluded the site from update checks. */
  updates_excluded: boolean;
  /** WordPress's own core auto-updates, from the last sync; null before Presser Connect 0.7.0. */
  core_auto_update: CoreAutoUpdate | null;
  /** wp-config.php decides core auto-updates, so Presser cannot change them. */
  core_auto_update_locked: boolean;
  /** False when the site turns plugin auto-updates off in code. */
  plugin_auto_updates: boolean;
}

/** Core auto-updates: every new version, maintenance and security releases only, or none. */
export type CoreAutoUpdate = "all" | "minor" | "off";


/** An administrator on a site, as Presser Connect lists them for Magic Login. */
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
   * Presser is still working on it: the job is queued or running, or it just
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
}

export interface SiteDetail {
  site: SiteSummary;
  updates: SiteUpdate[];
  comments: PendingComment[];
}

/** What Presser Connect reports. Mirrors plugin/presser-connect/includes/class-presser-connect-rest.php. */
export interface PluginStatus {
  name: string;
  home_url: string;
  wp_version: string;
  php_version: string;
  plugin_version: string;
  theme: string;
  /** Presser Connect 0.2.1+: the Site Icon URL, or "" when there is none. */
  icon_url?: string;
  /** Presser Connect 0.7.0+. */
  core_auto_update?: { mode: CoreAutoUpdate; locked: boolean };
}

/** `icon_url` arrives from Presser Connect 0.3+. */
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

/** A plugin installed on a site, as Presser Connect 0.6.0+ lists it. */
export interface InstalledPlugin {
  /** Plugin file relative to wp-content/plugins, such as akismet/akismet.php. */
  file: string;
  name: string;
  version: string;
  author: string;
  active: boolean;
  network_active: boolean;
  /** Presser Connect itself: never deactivated or deleted from Presser. */
  protected: boolean;
  /** Presser Connect 0.7.0+: WordPress updates it automatically. */
  auto_update?: boolean;
  /** Presser Connect 0.7.1+: its icon from WordPress's last update check, or "". */
  icon_url?: string;
}

export interface SitePlugins {
  plugins: InstalledPlugin[];
  /** False when the site sets DISALLOW_FILE_MODS: no installs or deletes. */
  can_modify_files: boolean;
  /** Presser Connect 0.7.0+: false when the site turns plugin auto-updates off in code. */
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
  /** Connected sites whose Presser Connect cannot list plugins yet. */
  unsupported_sites: { id: number; name: string; plugin_version: string | null }[];
}

export interface BulkPluginResult {
  site_id: number;
  ok: boolean;
  error?: string;
}

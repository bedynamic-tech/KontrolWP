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
}

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

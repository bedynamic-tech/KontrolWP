/**
 * The Presser Connect version this dashboard ships in
 * public/downloads/presser-connect.zip. Sites running an older one are offered
 * an update. tests/plugin-lint.test.mjs checks it matches the plugin header.
 */
export const PRESSER_CONNECT_VERSION = "0.6.0";

/** The first Presser Connect that can take updates from the dashboard. */
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

/** The first Presser Connect with Magic Login. */
export const MAGIC_LOGIN_SINCE = "0.5.0";

/** The first Presser Connect that can list, install and remove plugins. */
export const PLUGIN_MANAGEMENT_SINCE = "0.6.0";

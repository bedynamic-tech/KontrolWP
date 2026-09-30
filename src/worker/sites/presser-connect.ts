import { PRESSER_CONNECT_VERSION } from "../../shared/plugin-version.ts";
import { SiteRequestError } from "./client.ts";

/** The update row for Presser Connect itself, which the dashboard supplies. */
export const SELF_UPDATE = {
  slug: "presser-connect",
  name: "Presser Connect",
  iconUrl: "/presser.svg",
  version: PRESSER_CONNECT_VERSION,
} as const;

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

/** True when the site runs an older Presser Connect than this dashboard ships. */
export function needsSelfUpdate(siteVersion: string): boolean {
  return !!siteVersion && compareVersions(siteVersion, PRESSER_CONNECT_VERSION) < 0;
}

/** The zip the build put in the static assets, base64-encoded for a signed request. */
export async function loadPackage(env: Env): Promise<string> {
  const response = await env.ASSETS.fetch("https://assets.invalid/downloads/presser-connect.zip");
  if (!response.ok) throw new SiteRequestError(`The Presser Connect package is missing from this deployment (HTTP ${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

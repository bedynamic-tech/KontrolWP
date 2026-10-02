import type { SiteDomain } from "../shared/types.ts";
import { lookupDomain } from "./domain.ts";

/** Registration and DNS change rarely, and the lookup makes a dozen public requests. */
const TTL = 24 * 3600;

interface Cached {
  url: string;
  domain: SiteDomain;
}

/**
 * The site's domain from the day's earlier lookup when there is one, else a
 * fresh lookup, which is then kept. `refresh` skips the stored answer.
 */
export async function cachedDomain(
  db: D1Database,
  siteId: number,
  siteUrl: string,
  refresh = false,
  now = Date.now(),
): Promise<SiteDomain> {
  const name = `domain:${siteId}`;
  if (!refresh) {
    const row = await db
      .prepare("SELECT value FROM settings WHERE name = ?")
      .bind(name)
      .first<{ value: string }>()
      .catch(() => null);
    try {
      const cached = row ? (JSON.parse(row.value) as Cached) : null;
      if (cached && cached.url === siteUrl && now / 1000 - cached.domain.checked_at < TTL) return cached.domain;
    } catch {
      // A damaged row is replaced by the lookup below.
    }
  }
  const domain = await lookupDomain(siteUrl, now);
  await db
    .prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)")
    .bind(name, JSON.stringify({ url: siteUrl, domain } satisfies Cached))
    .run()
    .catch((error: unknown) => console.error("domain cache", error));
  return domain;
}

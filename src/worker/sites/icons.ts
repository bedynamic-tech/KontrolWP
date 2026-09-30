// Finds the icon a browser would show for a site, from the <link> tags in its
// home page. Themes and SEO plugins often set a favicon this way without
// WordPress's own Site Icon, and then /favicon.ico is WordPress's default.

interface IconLink {
  href: string;
  score: number;
}

const ATTRIBUTE = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(ATTRIBUTE)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&#0*38;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;/g, "'");
}

/** Prefer large, square-friendly icons: SVG, then the biggest declared size. */
function score(rel: string[], sizes: string, type: string, href: string): number {
  if (type.includes("svg") || /\.svg(\?|$)/i.test(href)) return 1000;
  const declared = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/gi)].map((m) => Number(m[1])));
  if (declared) return declared;
  if (rel.includes("apple-touch-icon")) return 180;
  return /\.ico(\?|$)/i.test(href) ? 16 : 32;
}

/**
 * The best https icon URL among the page's icon links, resolved against the
 * page's URL, or null when it declares none.
 */
export function findIcon(html: string, pageUrl: string): string | null {
  const head = html.slice(0, 512 * 1024);
  const end = head.search(/<\/head\s*>/i);
  const links: IconLink[] = [];
  for (const match of (end === -1 ? head : head.slice(0, end)).matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("icon") && !rel.includes("apple-touch-icon")) continue;
    if (!attrs.href || attrs.href.startsWith("data:")) continue;
    let href: string;
    try {
      href = new URL(attrs.href, pageUrl).href;
    } catch {
      continue;
    }
    if (!href.startsWith("https://")) continue;
    links.push({ href, score: score(rel, attrs.sizes ?? "", (attrs.type ?? "").toLowerCase(), href) });
  }
  links.sort((a, b) => b.score - a.score);
  return links[0]?.href ?? null;
}

/** Fetch the site's home page and find its icon. Never throws. */
export async function discoverIcon(siteUrl: string): Promise<string | null> {
  try {
    const response = await fetch(siteUrl, {
      headers: { Accept: "text/html", "User-Agent": "Presser" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("html")) return null;
    return findIcon(await response.text(), response.url || siteUrl);
  } catch {
    return null;
  }
}

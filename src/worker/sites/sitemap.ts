import type { SiteSitemap, SitemapPage } from "../../shared/types.ts";

const TIMEOUT_MS = 10_000;
/** Child sitemaps one index is followed into, and pages kept in all. */
const MAX_SITEMAPS = 20;
const MAX_PAGES = 5000;
/** The most one sitemap file is read from, so a huge one cannot use up the Worker's memory. */
const MAX_BYTES = 10 * 1024 * 1024;

const decode = (text: string) =>
  text
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** The text of the first <tag> inside a block of XML. */
function field(block: string, tag: string): string | null {
  const match = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "i").exec(block);
  return match ? decode(match[1]) : null;
}

/** Every <tag>...</tag> block in some XML. */
function blocks(xml: string, tag: string): string[] {
  return [
    ...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "gi")),
  ].map((match) => match[1]);
}

/** What a sitemap file holds: more sitemaps (an index) or pages. Null when it is neither. */
export function parseSitemap(xml: string): { sitemaps: string[]; pages: SitemapPage[] } | null {
  const sitemaps = blocks(xml, "sitemap")
    .map((block) => field(block, "loc"))
    .filter((loc): loc is string => !!loc);
  const pages = blocks(xml, "url").flatMap((block) => {
    const url = field(block, "loc");
    return url ? [{ url, lastmod: field(block, "lastmod") }] : [];
  });
  if (!/<(?:[\w-]+:)?(urlset|sitemapindex)[\s>]/i.test(xml) && !sitemaps.length && !pages.length) return null;
  return { sitemaps, pages };
}

/** Addresses on the site's own host count, with or without www. */
const bareHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
};

async function readText(response: Response, url: string): Promise<string> {
  const gzipped = /\.gz(\?|$)/i.test(url) && !/gzip/i.test(response.headers.get("Content-Encoding") ?? "");
  const stream = gzipped && response.body ? response.body.pipeThrough(new DecompressionStream("gzip")) : response.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error("The sitemap is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

async function get(url: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/xml,text/xml,text/plain,*/*", "User-Agent": "KontrolWP" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await readText(response, url);
  } catch {
    return null;
  }
}

/**
 * Read a static site's sitemap: the address robots.txt names, or
 * /sitemap.xml and /sitemap_index.xml. An index is followed into its
 * sitemaps (up to 20). Only addresses on the site's own host are read or
 * listed.
 */
export async function readSitemap(siteUrl: string, fetcher: typeof fetch = fetch): Promise<SiteSitemap> {
  const origin = new URL(siteUrl).origin;
  const host = bareHost(siteUrl);
  const own = (url: string) => bareHost(url) === host;

  const robots = (await get(`${origin}/robots.txt`, fetcher)) ?? "";
  const named = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((match) => match[1]).filter(own);
  const candidates = [...new Set([...named, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])];

  for (const candidate of candidates) {
    const xml = await get(candidate, fetcher);
    const root = xml ? parseSitemap(xml) : null;
    if (!root) continue;

    const pages = new Map<string, SitemapPage>();
    const add = (list: SitemapPage[]) => {
      for (const page of list) if (own(page.url) && !pages.has(page.url)) pages.set(page.url, page);
    };
    add(root.pages);
    const children = root.sitemaps.filter(own).slice(0, MAX_SITEMAPS);
    for (const child of children) {
      if (pages.size >= MAX_PAGES) break;
      const childXml = await get(child, fetcher);
      const parsed = childXml ? parseSitemap(childXml) : null;
      if (parsed) add(parsed.pages);
    }
    const all = [...pages.values()];
    return {
      sitemap_url: candidate,
      items: all.slice(0, MAX_PAGES),
      total: all.length,
      truncated: all.length > MAX_PAGES,
      error: null,
    };
  }
  return { sitemap_url: null, items: [], total: 0, truncated: false, error: "No sitemap found" };
}

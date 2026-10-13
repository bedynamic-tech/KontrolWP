import { decode } from "./seo-audit-check.ts";

/**
 * The link checker's reader for static sites. A static site runs no
 * KontrolWP Connect, so the Worker loads its pages itself, like a visitor,
 * and lists the links and images on each. Links inside a page's <header> or
 * <footer> are listed under Header and Footer instead of every page, as
 * WordPress sites list their menus.
 */

const TIMEOUT_MS = 10_000;
/** The most of one page that is read, so a huge file can't use up the Worker's memory. */
const MAX_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; KontrolWP link checker)";

/** Addresses that are files, not pages, so the crawler doesn't download them. */
const FILE_PATH =
  /\.(?:pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|zip|gz|tar|rar|7z|xml|json|txt|csv|css|js|mjs|map|woff2?|ttf|otf|eot|mp[34]|m4[av]|mov|webm|ogg|wav|docx?|xlsx?|pptx?|exe|dmg|apk)$/i;

export interface PageLink {
  url: string;
  text: string;
  kind: "link" | "image";
}

export interface StaticPage {
  title: string;
  links: PageLink[];
  header: PageLink[];
  footer: PageLink[];
}

/** Addresses on the site's own host count, with or without www. */
export function bareHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Whether an address is a page of the site worth reading for links. */
export function isSitePage(url: string, siteUrl: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return (
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    bareHost(url) === bareHost(siteUrl) &&
    !FILE_PATH.test(parsed.pathname)
  );
}

/** A positive id for a page, stable across scans, standing in for a WordPress post id. */
export function pageId(url: string): number {
  // FNV-1a, folded to 31 bits so it fits SQLite's integers and stays above 0.
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) + 1;
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/** An absolute http(s) address without its fragment, or null. */
function absolute(value: string, base: string): string | null {
  const href = decode(value);
  if (!href || href.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  return url.href;
}

const text = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).slice(0, 200);

/** The links and images in some HTML, each address once per kind. */
function extract(html: string, base: string): PageLink[] {
  const found = new Map<string, PageLink>();
  const add = (url: string | null, linkText: string, kind: PageLink["kind"]) => {
    if (url && !found.has(`${kind} ${url}`)) found.set(`${kind} ${url}`, { url, text: linkText, kind });
  };
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attr(match[1], "href");
    if (href !== null) add(absolute(href, base), text(match[2]), "link");
  }
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(match[0], "src");
    if (src !== null) add(absolute(src, base), decode(attr(match[0], "alt") ?? "").slice(0, 200), "image");
  }
  return [...found.values()];
}

/** Read one page's title and links, splitting off those in its <header> and <footer>. */
export function readPage(source: string, pageUrl: string): StaticPage {
  // Comments, scripts and styles hold no links a visitor can follow.
  let html = source.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "");
  const baseHref = /<base\b[^>]*>/i.exec(html);
  const base = (baseHref && absolute(attr(baseHref[0], "href") ?? "", pageUrl)) || pageUrl;
  const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 300);
  const areas: Record<"header" | "footer", string[]> = { header: [], footer: [] };
  for (const area of ["header", "footer"] as const) {
    html = html.replace(new RegExp(`<${area}\\b[^>]*>([\\s\\S]*?)<\\/${area}\\s*>`, "gi"), (_, inner: string) => {
      areas[area].push(inner);
      return " ";
    });
  }
  return {
    title,
    links: extract(html, base),
    header: extract(areas.header.join("\n"), base),
    footer: extract(areas.footer.join("\n"), base),
  };
}

async function readText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    // Links past this point are left out rather than failing the page.
    if (size >= MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Load a page of the site and read it. Null when it isn't an HTML page on
 * the site (an error, a file, or a redirect to another site); its address is
 * still checked like any other link.
 */
export async function fetchPage(url: string, siteUrl: string, fetcher: typeof fetch = fetch): Promise<StaticPage | null> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  const finalUrl = response.url || url;
  if (!response.ok || !/html/i.test(response.headers.get("Content-Type") ?? "") || bareHost(finalUrl) !== bareHost(siteUrl)) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    return readPage(await readText(response), finalUrl);
  } catch {
    return null;
  }
}

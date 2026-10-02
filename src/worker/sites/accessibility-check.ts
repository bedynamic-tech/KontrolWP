// Finds accessibility problems in one page's HTML. There is no browser here,
// so this checks what the markup alone shows: missing text alternatives,
// labels and names, headings, landmarks and the like. Colour contrast and
// anything that depends on scripts or layout are not checked.

export interface Finding {
  rule: string;
  /** The element, as written in the page, shortened. */
  example: string;
}

const VAGUE_LINK_TEXT = new Set([
  "click here",
  "here",
  "read more",
  "more",
  "learn more",
  "link",
  "this link",
  "details",
]);

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, "i").exec(tag);
  if (!match) return null;
  return decode(match[1] ?? match[2] ?? match[3] ?? "");
}

function hasAttr(tag: string, name: string): boolean {
  return new RegExp(`\\s${name}(?=[\\s=/>])`, "i").test(tag);
}

function decode(value: string): string {
  return value
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function text(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(tag: string): string {
  const flat = tag.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}...` : flat;
}

/** Whether a link or button's contents give it a name a screen reader can say. */
function named(open: string, inner: string): boolean {
  for (const name of ["aria-label", "aria-labelledby", "title"]) {
    if ((attr(open, name) ?? "").trim()) return true;
  }
  if (text(inner)) return true;
  if (/<img\b[^>]*\balt\s*=\s*(?:"[^"]+"|'[^']+')/i.test(inner)) return true;
  if (/<svg\b[^>]*\baria-label\s*=\s*(?:"[^"]+"|'[^']+')|<svg\b[^>]*>[\s\S]*?<title\b[^>]*>[^<]+/i.test(inner))
    return true;
  return false;
}

export function analyzePage(source: string): Finding[] {
  const found: Finding[] = [];
  const add = (rule: string, example: string) => found.push({ rule, example: shorten(example) });
  const html = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, "");

  const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] ?? "";
  if (!(attr(htmlTag, "lang") ?? attr(htmlTag, "xml:lang") ?? "").trim()) add("html-lang", htmlTag || "<html>");

  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!title || !text(title[1])) add("document-title", title?.[0] ?? "No <title> element");

  for (const meta of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = meta[0];
    const name = (attr(tag, "name") ?? "").toLowerCase();
    const content = attr(tag, "content") ?? "";
    if (name === "viewport") {
      const max = /maximum-scale\s*=\s*([0-9.]+)/i.exec(content);
      if (/user-scalable\s*=\s*(no|0)/i.test(content) || (max && Number(max[1]) < 2)) add("meta-viewport", tag);
    }
    if ((attr(tag, "http-equiv") ?? "").toLowerCase() === "refresh" && Number.parseFloat(content) > 0) {
      add("meta-refresh", tag);
    }
  }

  for (const img of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = img[0];
    const role = (attr(tag, "role") ?? "").toLowerCase();
    if (!hasAttr(tag, "alt") && role !== "presentation" && role !== "none") add("image-alt", tag);
  }

  for (const frame of html.matchAll(/<iframe\b[^>]*>/gi)) {
    if (!(attr(frame[0], "title") ?? "").trim() && attr(frame[0], "aria-hidden") !== "true")
      add("frame-title", frame[0]);
  }

  for (const media of html.matchAll(/<(video|audio)\b[^>]*>/gi)) {
    if (hasAttr(media[0], "autoplay") && !(media[1].toLowerCase() === "video" && hasAttr(media[0], "muted"))) {
      add("autoplay", media[0]);
    }
  }

  for (const tag of html.matchAll(/<[a-z][^>]*\stabindex\s*=\s*["']?(\d+)/gi)) {
    if (Number(tag[1]) > 0) add("tabindex", tag[0].slice(0, 140));
  }

  // Form fields: labelled by a label for them, a label around them, or an attribute.
  const labelled = new Set<string>();
  for (const label of html.matchAll(/<label\b[^>]*>/gi)) {
    const id = attr(label[0], "for");
    if (id) labelled.add(id);
  }
  const wrapped: [number, number][] = [];
  for (const label of html.matchAll(/<label\b[\s\S]*?<\/label>/gi)) {
    wrapped.push([label.index, label.index + label[0].length]);
  }
  for (const field of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = field[0];
    const type = (attr(tag, "type") ?? "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
    if (["aria-label", "aria-labelledby", "title"].some((name) => (attr(tag, name) ?? "").trim())) continue;
    const id = attr(tag, "id");
    if (id && labelled.has(id)) continue;
    if (wrapped.some(([from, to]) => field.index >= from && field.index < to)) continue;
    add("label", tag);
  }

  for (const link of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const open = `<a${link[1]}>`;
    if (attr(open, "href") === null) continue;
    if (!named(open, link[2])) {
      add("link-name", `${open}${link[2].slice(0, 60)}</a>`);
    } else if (
      VAGUE_LINK_TEXT.has(
        text(link[2])
          .toLowerCase()
          .replace(/[.!»›>→]+$/, "")
          .trim(),
      )
    ) {
      add("link-text", `${open}${link[2].slice(0, 60)}</a>`);
    }
  }

  for (const button of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const open = `<button${button[1]}>`;
    if (!named(open, button[2])) add("button-name", `${open}${button[2].slice(0, 60)}</button>`);
  }

  let previous = 0;
  let h1 = 0;
  for (const heading of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const level = Number(heading[1]);
    if (!text(heading[2]) && !/<img\b[^>]*\balt\s*=\s*["'][^"']+/i.test(heading[2])) {
      add("empty-heading", heading[0].slice(0, 100));
      continue;
    }
    if (level === 1) h1++;
    if (previous && level > previous + 1)
      add("heading-order", `<h${previous}> followed by <h${level}>: ${text(heading[2]).slice(0, 60)}`);
    previous = level;
  }
  if (!h1) add("page-has-heading-one", "No heading 1 on the page");

  const main = /<main\b[^>]*>|\srole\s*=\s*["']main["']/i.test(html);
  if (!main) add("landmark-main", "No <main> element");
  const body = /<body\b[^>]*>/i.exec(html);
  if (body) {
    const top = html.slice(body.index + body[0].length, body.index + body[0].length + 6000);
    const skip = /<a\b[^>]*\bhref\s*=\s*["']#[^"']+["'][^>]*>[^<]*skip/i.test(top);
    const target = main || /\sid\s*=\s*["'](?:main|content|primary|site-content|main-content)["']/i.test(html);
    if (!skip && target) add("skip-link", "No link at the top of the page that skips to the main content");
  }
  return found;
}

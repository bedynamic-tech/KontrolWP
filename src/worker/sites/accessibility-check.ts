// Finds accessibility problems in one page's HTML, against WCAG 2.1 Level A
// and AA. There is no browser here, so this checks what the markup alone
// shows: missing text alternatives, captions, labels and names, language,
// headings, keyboard access and focus styles written into the page, and the
// contrast of colours set on an element itself. Colours from stylesheets and
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


/** Languages: a primary subtag of 2 or 3 letters, then optional subtags (BCP 47). */
const LANG = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;

/** The field names autocomplete accepts (HTML's autofill detail tokens). */
const AUTOFILL_FIELDS = new Set(
  (
    "name honorific-prefix given-name additional-name family-name honorific-suffix nickname username " +
    "new-password current-password one-time-code organization-title organization street-address " +
    "address-line1 address-line2 address-line3 address-level4 address-level3 address-level2 address-level1 " +
    "country country-name postal-code cc-name cc-given-name cc-additional-name cc-family-name cc-number " +
    "cc-exp cc-exp-month cc-exp-year cc-csc cc-type transaction-currency transaction-amount language bday " +
    "bday-day bday-month bday-year sex url photo tel tel-country-code tel-national tel-area-code tel-local " +
    "tel-local-prefix tel-local-suffix tel-extension email impp"
  ).split(" "),
);

/** Whether an autocomplete value is one browsers understand. */
export function validAutocomplete(value: string): boolean {
  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  if (tokens.length === 1 && (tokens[0] === "on" || tokens[0] === "off")) return true;
  if (tokens.at(-1) === "webauthn") tokens.pop();
  const field = tokens.pop();
  if (!field || !AUTOFILL_FIELDS.has(field)) return false;
  if (tokens.length && /^(home|work|mobile|fax|pager)$/.test(tokens.at(-1)!)) tokens.pop();
  if (tokens.length && /^(shipping|billing)$/.test(tokens.at(-1)!)) tokens.pop();
  if (tokens.length && tokens[0].startsWith("section-")) tokens.shift();
  return tokens.length === 0;
}

/** A CSS colour as red, green and blue from 0 to 255, for hex and rgb() values; null for anything else. */
export function parseColor(value: string): [number, number, number] | null {
  const color = value.trim().toLowerCase();
  if (color === "white") return [255, 255, 255];
  if (color === "black") return [0, 0, 0];
  let match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(color);
  if (match) {
    const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  }
  match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([0-9.]+%?))?\s*\)$/.exec(color);
  if (match) {
    // A see-through colour depends on what is behind it, which the HTML does not say.
    if (match[4] !== undefined && Number.parseFloat(match[4]) < (match[4].endsWith("%") ? 100 : 1)) return null;
    return [match[1], match[2], match[3]].map((n) => Math.min(255, Number(n))) as [number, number, number];
  }
  return null;
}

/** WCAG's contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const luminance = (rgb: [number, number, number]) => {
    const [r, g, bl] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** A declaration's value from an inline style attribute. */
function styleValue(style: string, property: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(style);
  return match ? match[1].replace(/!important/i, "").trim() : null;
}

/** Large text (24px, or 18.66px bold) needs a contrast of 3 instead of 4.5. */
function largeText(style: string): boolean {
  const size = /([0-9.]+)\s*(px|r?em|pt)/i.exec(styleValue(style, "font-size") ?? "");
  const scale: Record<string, number> = { px: 1, em: 16, rem: 16, pt: 4 / 3 };
  const px = size ? Number(size[1]) * scale[size[2].toLowerCase()] : 0;
  const bold = /bold|[6-9]00/.test(styleValue(style, "font-weight") ?? "");
  return px >= 24 || (bold && px >= 18.66);
}

/** CSS rules that take the outline off focused elements without drawing anything in its place. */
export function hiddenFocusRules(css: string): string[] {
  const found: string[] = [];
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*:focus\b[^{}]*)\{([^{}]*)\}/gi)) {
    const selector = rule[1].trim();
    const body = rule[2];
    // Hiding the outline only for mouse clicks, while :focus-visible keeps one, is fine.
    if (/:focus-visible|:not\(\s*:focus-visible\s*\)/i.test(selector)) continue;
    if (!/(?:^|;)\s*outline(?:-style|-width)?\s*:\s*(?:none|0(?:px)?)\s*(?:!important)?\s*(?:;|$)/i.test(body)) continue;
    if (/box-shadow|border|text-decoration|background|outline-color|outline\s*:\s*[^;]*\b(?:solid|dotted|dashed|double)/i.test(body)) continue;
    found.push(`${selector} { ${body.trim()} }`);
  }
  return found;
}

/** An aria-label must hold the words a link or button shows, so voice control users can say them. */
function labelInName(open: string, inner: string): boolean {
  const label = attr(open, "aria-label");
  const words = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const shown = words(text(inner));
  if (!label?.trim() || shown.length < 2) return true;
  return ` ${words(label)} `.includes(` ${shown} `);
}

export function analyzePage(source: string): Finding[] {
  const found: Finding[] = [];
  const add = (rule: string, example: string) => found.push({ rule, example: shorten(example) });
  for (const style of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of hiddenFocusRules(style[1])) add("focus-outline", rule);
  }
  const html = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, "");

  const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] ?? "";
  const pageLang = (attr(htmlTag, "lang") ?? attr(htmlTag, "xml:lang") ?? "").trim();
  if (!pageLang) add("html-lang", htmlTag || "<html>");
  else if (!LANG.test(pageLang)) add("html-lang-valid", htmlTag);
  for (const tag of html.matchAll(/<(?!html\b)[a-z][a-z0-9-]*\b[^>]*\slang\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi)) {
    const value = (tag[1] ?? tag[2] ?? "").trim();
    if (value && !LANG.test(value)) add("valid-lang", tag[0]);
  }

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

  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    if ((attr(input[0], "type") ?? "").toLowerCase() !== "image") continue;
    if (!["alt", "aria-label", "aria-labelledby", "title"].some((name) => (attr(input[0], name) ?? "").trim()))
      add("input-image-alt", input[0]);
  }
  for (const area of html.matchAll(/<area\b[^>]*>/gi)) {
    if (attr(area[0], "href") !== null && !hasAttr(area[0], "alt") && !(attr(area[0], "aria-label") ?? "").trim())
      add("area-alt", area[0]);
  }
  for (const graphic of html.matchAll(/<([a-z]+)\b([^>]*\srole\s*=\s*["']img["'][^>]*)>/gi)) {
    const open = graphic[0];
    if (graphic[1].toLowerCase() === "img") continue;
    if (["aria-label", "aria-labelledby", "title"].some((name) => (attr(open, name) ?? "").trim())) continue;
    if (attr(open, "aria-hidden") === "true") continue;
    const after = html.slice(graphic.index + open.length, graphic.index + open.length + 400);
    if (graphic[1].toLowerCase() === "svg" && /^\s*<title\b[^>]*>\s*[^<\s]/i.test(after)) continue;
    add("svg-img-alt", open);
  }

  for (const video of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
    const open = `<video${video[1]}>`;
    // A muted background video with no controls has no speech to caption.
    if (hasAttr(open, "muted") && !hasAttr(open, "controls")) continue;
    if (!/<track\b[^>]*\bkind\s*=\s*["']?(?:captions|subtitles)/i.test(video[2])) add("video-caption", open);
  }

  for (const marquee of html.matchAll(/<(marquee|blink)\b[^>]*>/gi)) add("blink", marquee[0]);

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

  for (const tag of html.matchAll(/<(div|span|li|td|img|p|section|article)\b[^>]*\sonclick\s*=[^>]*>/gi)) {
    if (!hasAttr(tag[0], "role") && !hasAttr(tag[0], "tabindex")) add("click-keyboard", tag[0]);
  }

  for (const tag of html.matchAll(/<(a|button|input|select|textarea)\b[^>]*\saria-hidden\s*=\s*["']?true[^>]*>/gi)) {
    if ((attr(tag[0], "tabindex") ?? "") === "-1" || hasAttr(tag[0], "disabled")) continue;
    if (tag[1].toLowerCase() === "a" && attr(tag[0], "href") === null) continue;
    if (tag[1].toLowerCase() === "input" && (attr(tag[0], "type") ?? "").toLowerCase() === "hidden") continue;
    add("aria-hidden-focus", tag[0]);
  }

  for (const tag of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([^<]*)/gi)) {
    if (!text(tag[4])) continue;
    const style = decode(tag[2] ?? tag[3] ?? "");
    const fg = styleValue(style, "color");
    const bg = styleValue(style, "background-color") ?? styleValue(style, "background");
    const fore = fg ? parseColor(fg) : null;
    const back = bg ? parseColor(bg) : null;
    if (!fore || !back) continue;
    const ratio = contrastRatio(fore, back);
    if (ratio < (largeText(style) ? 3 : 4.5)) add("color-contrast", `${tag[0].slice(0, 100)} (${ratio.toFixed(2)}:1)`);
  }

  // Ids that labels or ARIA point at must be unique, or the reference reaches the wrong element.
  const ids = new Map<string, number>();
  for (const tag of html.matchAll(/<[a-z][^>]*\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const id = (tag[1] ?? tag[2] ?? "").trim();
    if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  const referenced = new Set<string>();
  for (const ref of html.matchAll(/\s(?:for|aria-labelledby|aria-describedby|aria-controls)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const id of (ref[1] ?? ref[2] ?? "").split(/\s+/)) if (id) referenced.add(id);
  }
  for (const id of referenced) if ((ids.get(id) ?? 0) > 1) add("duplicate-id", `id="${id}" is used ${ids.get(id)} times`);

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
    const autocomplete = attr(tag, "autocomplete");
    if (autocomplete !== null && !validAutocomplete(autocomplete)) add("autocomplete-valid", tag);
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
    } else if (!labelInName(open, link[2])) {
      add("label-in-name", `${open}${link[2].slice(0, 60)}</a>`);
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
    else if (!labelInName(open, button[2])) add("label-in-name", `${open}${button[2].slice(0, 60)}</button>`);
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

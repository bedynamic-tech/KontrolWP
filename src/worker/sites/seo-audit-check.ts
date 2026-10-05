// Reads one page's HTML for what search engines look at: title, description,
// headings, canonical link, robots tag, viewport, social tags and structured
// data. There is no browser here, so nothing that needs scripts is judged.

export interface SeoFinding {
  rule: string;
  /** What was found, shortened. */
  example: string;
}

export interface SeoPageReport {
  title: string;
  description: string;
  findings: SeoFinding[];
}

function decode(value: string): string {
  return value
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`,
    "i",
  ).exec(tag);
  return match ? decode(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function shorten(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

/** The content of the first <meta> tag whose name or property is `key`. */
function meta(html: string, key: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = (
      attr(tag, "name") ??
      attr(tag, "property") ??
      ""
    ).toLowerCase();
    if (name === key) return attr(tag, "content") ?? "";
  }
  return null;
}

export function analyzeSeoPage(source: string, pageUrl: string): SeoPageReport {
  const found: SeoFinding[] = [];
  const add = (rule: string, example: string) =>
    found.push({ rule, example: shorten(example) });
  const html = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, "");
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? html;

  const title = decode(
    (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "").replace(
      /<[^>]*>/g,
      "",
    ),
  );
  if (!title) add("title-missing", pageUrl);
  else if (title.length < 15 || title.length > 60)
    add("title-length", `${title} (${title.length} characters)`);

  const description = meta(head, "description")?.trim() ?? "";
  if (!description) add("description-missing", pageUrl);
  else if (description.length < 70 || description.length > 160) {
    add(
      "description-length",
      `${description} (${description.length} characters)`,
    );
  }

  const body = /<body\b[\s\S]*/i.exec(html)?.[0] ?? html;
  const headings = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].filter(
    (match) => decode(match[1].replace(/<[^>]*>/g, "")),
  );
  if (!headings.length) add("h1-missing", pageUrl);
  else if (headings.length > 1)
    add("h1-multiple", `${headings.length} headings on ${pageUrl}`);

  let canonical: string | null = null;
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    if (/\bcanonical\b/i.test(attr(match[0], "rel") ?? "")) {
      canonical = attr(match[0], "href") ?? "";
      break;
    }
  }
  if (!canonical) add("canonical-missing", pageUrl);
  else {
    try {
      const target = new URL(canonical, pageUrl);
      const bare = (host: string) => host.replace(/^www\./, "");
      if (bare(target.hostname) !== bare(new URL(pageUrl).hostname))
        add("canonical-offsite", canonical);
    } catch {
      // An address that does not parse is left to the search engine to ignore.
    }
  }

  const robots =
    (meta(head, "robots") ?? "") + "," + (meta(head, "googlebot") ?? "");
  if (/\bnoindex\b/i.test(robots)) add("noindex", pageUrl);

  if (meta(head, "viewport") === null) add("viewport", pageUrl);

  const social = ["og:title", "og:description", "og:image"].filter(
    (key) => !meta(head, key)?.trim(),
  );
  if (social.length)
    add("social-tags", `${pageUrl} has no ${social.join(", ")}`);

  if (!/<script\b[^>]*ld\+json/i.test(source)) add("structured-data", pageUrl);

  return { title, description, findings: found };
}

export type SeoImpact = "high" | "medium" | "low";

export interface SeoRule {
  title: string;
  impact: SeoImpact;
  /** What to change on the site, in the owner's words. */
  help: string;
}

/**
 * What the SEO health check looks for on a static site. Everything here can
 * be told from the pages' HTML, robots.txt and the sitemap, so it only reads
 * the site and never changes it.
 */
export const SEO_RULES: Record<string, SeoRule> = {
  "title-missing": {
    title: "Pages without a title",
    impact: "high",
    help: "Add a <title> to each page that says what the page is about, in the head of the page.",
  },
  "title-length": {
    title: "Titles too short or too long",
    impact: "medium",
    help: "Keep titles between about 15 and 60 characters so search results show them whole.",
  },
  "title-duplicate": {
    title: "Pages sharing a title",
    impact: "medium",
    help: "Give every page its own title, so search engines can tell the pages apart.",
  },
  "description-missing": {
    title: "Pages without a meta description",
    impact: "high",
    help: 'Add <meta name="description" content="..."> to each page with a one or two sentence summary.',
  },
  "description-length": {
    title: "Descriptions too short or too long",
    impact: "low",
    help: "Aim for 70 to 160 characters so search results show the whole description.",
  },
  "description-duplicate": {
    title: "Pages sharing a description",
    impact: "medium",
    help: "Write a different description for each page.",
  },
  "h1-missing": {
    title: "Pages without a main heading",
    impact: "medium",
    help: "Give each page one <h1> that names the page.",
  },
  "h1-multiple": {
    title: "Pages with more than one main heading",
    impact: "low",
    help: "Keep a single <h1> per page and use <h2> and below for sections.",
  },
  "canonical-missing": {
    title: "Pages without a canonical link",
    impact: "medium",
    help: 'Add <link rel="canonical" href="..."> with the page\'s own address, so copies of it do not compete.',
  },
  "canonical-offsite": {
    title: "Canonical link points to another site",
    impact: "high",
    help: "A canonical link on another domain asks search engines to list that site instead. Point it at this page's own address.",
  },
  noindex: {
    title: "Pages hidden from search",
    impact: "high",
    help: "These pages carry a noindex robots tag, so search engines will not list them. Remove it if they should appear.",
  },
  viewport: {
    title: "Pages without a mobile viewport",
    impact: "medium",
    help: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> so the page works on phones.',
  },
  "social-tags": {
    title: "Pages without social sharing tags",
    impact: "low",
    help: "Add og:title, og:description and og:image tags so links look right when shared.",
  },
  "structured-data": {
    title: "No structured data",
    impact: "low",
    help: "Add JSON-LD (an Organization or WebSite block on the home page) so search engines understand the site.",
  },
  "broken-pages": {
    title: "Pages that do not load",
    impact: "high",
    help: "The home page links to these pages, or the sitemap lists them, but they answered an error. Fix the link or restore the page.",
  },
  "robots-blocks-all": {
    title: "robots.txt blocks the whole site",
    impact: "high",
    help: "robots.txt tells every crawler to stay away (Disallow: /). Remove that line unless the site is meant to be private.",
  },
  "robots-missing": {
    title: "No robots.txt",
    impact: "low",
    help: "Add a robots.txt at the site's root that allows crawling and names the sitemap.",
  },
  "sitemap-missing": {
    title: "No sitemap found",
    impact: "high",
    help: "Publish a sitemap.xml and name it in robots.txt (Sitemap: https://example.com/sitemap.xml).",
  },
  "sitemap-unlisted": {
    title: "Sitemap not named in robots.txt",
    impact: "low",
    help: "Add a Sitemap: line to robots.txt so crawlers find the sitemap without guessing.",
  },
  "soft-404": {
    title: "Missing pages answer 200",
    impact: "medium",
    help: "An address that does not exist should answer 404. Answering 200 lets search engines index empty pages.",
  },
};

const WEIGHT: Record<SeoImpact, number> = { high: 12, medium: 5, low: 2 };

/** 100 minus a penalty for each kind of problem, larger when it happens more often. */
export function seoScore(
  issues: { impact: SeoImpact; count: number }[],
): number {
  let penalty = 0;
  for (const issue of issues) {
    const spread = issue.count <= 1 ? 0.6 : issue.count <= 3 ? 1 : 1.4;
    penalty += WEIGHT[issue.impact] * spread;
  }
  return Math.max(0, Math.round(100 - penalty));
}

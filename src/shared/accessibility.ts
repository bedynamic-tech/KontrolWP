export type AccessibilityImpact = "critical" | "serious" | "moderate" | "minor";

/** An automatic fix KontrolWP Connect can apply (0.14.0), in the order the tab lists them. */
export const ACCESSIBILITY_FIXES = [
  {
    id: "image_alt",
    title: "Mark images without alt text as decorative",
    detail:
      "Adds an empty alt attribute to images that have none, so screen readers skip them. Images that matter still need a real description in the Media Library.",
  },
  {
    id: "form_labels",
    title: "Name form fields from their placeholder",
    detail: "Gives fields with no label an accessible name taken from their placeholder text.",
  },
  {
    id: "link_names",
    title: "Name icon-only links",
    detail: "Names links that hold only an icon, such as social media and email links, after where they go.",
  },
  {
    id: "frame_titles",
    title: "Title embedded frames",
    detail: "Gives embedded videos and maps a title that says where they come from.",
  },
  {
    id: "viewport_zoom",
    title: "Allow zooming on phones",
    detail: "Removes the settings that stop visitors pinching to zoom the page.",
  },
  {
    id: "skip_link",
    title: "Add a skip to content link",
    detail: "Adds a link, shown when a keyboard user tabs in, that jumps past the menu to the main content.",
  },
] as const;

export interface AccessibilityRule {
  title: string;
  impact: AccessibilityImpact;
  /** The WCAG 2.1 success criterion it relates to. */
  wcag: string;
  help: string;
  /** The automatic fix that clears it, when there is one. */
  fix?: (typeof ACCESSIBILITY_FIXES)[number]["id"];
}

/** What the scan looks for. Everything here can be told from a page's HTML alone. */
export const ACCESSIBILITY_RULES: Record<string, AccessibilityRule> = {
  "image-alt": {
    title: "Images without alt text",
    impact: "critical",
    wcag: "1.1.1",
    help: 'Give each image an alt attribute that describes it, or alt="" when it is only decoration.',
    fix: "image_alt",
  },
  label: {
    title: "Form fields without labels",
    impact: "critical",
    wcag: "1.3.1",
    help: "Give each field a visible label, or an aria-label when the design has none.",
    fix: "form_labels",
  },
  "button-name": {
    title: "Buttons without a name",
    impact: "critical",
    wcag: "4.1.2",
    help: "Give each button text or an aria-label that says what it does.",
  },
  "meta-viewport": {
    title: "Zooming is blocked on phones",
    impact: "critical",
    wcag: "1.4.4",
    help: "Remove user-scalable=no and a low maximum-scale from the viewport tag.",
    fix: "viewport_zoom",
  },
  "link-name": {
    title: "Links without a name",
    impact: "serious",
    wcag: "2.4.4",
    help: "Give each link text, or an aria-label when it holds only an icon.",
    fix: "link_names",
  },
  "frame-title": {
    title: "Embedded frames without a title",
    impact: "serious",
    wcag: "4.1.2",
    help: "Add a title attribute that says what the embedded content is.",
    fix: "frame_titles",
  },
  "document-title": {
    title: "Pages without a title",
    impact: "serious",
    wcag: "2.4.2",
    help: "Give every page a descriptive title.",
  },
  "html-lang": {
    title: "Pages that do not state their language",
    impact: "serious",
    wcag: "3.1.1",
    help: "Set the site's language in Settings, General so the html tag carries it.",
  },
  tabindex: {
    title: "Positive tabindex values",
    impact: "serious",
    wcag: "2.4.3",
    help: "Remove tabindex values above 0, which scramble the keyboard order. The theme or a plugin adds them.",
  },
  "meta-refresh": {
    title: "Pages that reload or redirect on a timer",
    impact: "serious",
    wcag: "2.2.1",
    help: "Use a normal redirect instead of a timed refresh.",
  },
  autoplay: {
    title: "Media that plays on its own",
    impact: "serious",
    wcag: "1.4.2",
    help: "Do not start audio or video automatically, or let visitors pause it.",
  },
  "page-has-heading-one": {
    title: "Pages without a main heading",
    impact: "moderate",
    wcag: "1.3.1",
    help: "Give each page one top-level heading that says what the page is about.",
  },
  "heading-order": {
    title: "Skipped heading levels",
    impact: "moderate",
    wcag: "1.3.1",
    help: "Go down one level at a time, for example from a heading 2 to a heading 3.",
  },
  "landmark-main": {
    title: "Pages without a main landmark",
    impact: "moderate",
    wcag: "1.3.1",
    help: "Wrap the main content in a main element. The theme controls this.",
  },
  "skip-link": {
    title: "No skip to content link",
    impact: "minor",
    wcag: "2.4.1",
    help: "Add a link at the top of the page that jumps to the main content.",
    fix: "skip_link",
  },
  "empty-heading": {
    title: "Empty headings",
    impact: "minor",
    wcag: "1.3.1",
    help: "Remove headings with no text, or fill them in.",
  },
  "link-text": {
    title: "Vague link text",
    impact: "minor",
    wcag: "2.4.4",
    help: 'Say where the link goes, instead of "click here" or "read more".',
  },
};

const WEIGHT: Record<AccessibilityImpact, number> = { critical: 12, serious: 8, moderate: 4, minor: 1.5 };

/** 100 minus a penalty for each kind of problem, larger when it happens more often. */
export function accessibilityScore(issues: { impact: AccessibilityImpact; count: number }[]): number {
  let penalty = 0;
  for (const issue of issues) {
    const spread = issue.count <= 1 ? 0.6 : issue.count <= 5 ? 1 : issue.count <= 20 ? 1.4 : 1.8;
    penalty += WEIGHT[issue.impact] * spread;
  }
  return Math.max(0, Math.round(100 - penalty));
}

export type ScoreBand = "good" | "fair" | "poor" | "bad";

export function scoreBand(score: number): ScoreBand {
  return score >= 90 ? "good" : score >= 70 ? "fair" : score >= 50 ? "poor" : "bad";
}

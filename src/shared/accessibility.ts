import { ACCESSIBILITY_SINCE, compareVersions } from "./plugin-version.ts";

export type AccessibilityImpact = "critical" | "serious" | "moderate" | "minor";

/** The most pages one scan reads: the home page and a sample of the rest. */
export const MAX_SCANNED_PAGES = 50;

/**
 * Every WCAG 2.1 success criterion at Level A and AA: the standard the ADA
 * rules for websites point to. The scan checks the ones its rules name; the
 * rest need a person to review.
 */
export const WCAG_CRITERIA: { id: string; name: string; level: "A" | "AA" }[] = [
  { id: "1.1.1", name: "Non-text Content", level: "A" },
  { id: "1.2.1", name: "Audio-only and Video-only (Prerecorded)", level: "A" },
  { id: "1.2.2", name: "Captions (Prerecorded)", level: "A" },
  { id: "1.2.3", name: "Audio Description or Media Alternative (Prerecorded)", level: "A" },
  { id: "1.2.4", name: "Captions (Live)", level: "AA" },
  { id: "1.2.5", name: "Audio Description (Prerecorded)", level: "AA" },
  { id: "1.3.1", name: "Info and Relationships", level: "A" },
  { id: "1.3.2", name: "Meaningful Sequence", level: "A" },
  { id: "1.3.3", name: "Sensory Characteristics", level: "A" },
  { id: "1.3.4", name: "Orientation", level: "AA" },
  { id: "1.3.5", name: "Identify Input Purpose", level: "AA" },
  { id: "1.4.1", name: "Use of Color", level: "A" },
  { id: "1.4.2", name: "Audio Control", level: "A" },
  { id: "1.4.3", name: "Contrast (Minimum)", level: "AA" },
  { id: "1.4.4", name: "Resize Text", level: "AA" },
  { id: "1.4.5", name: "Images of Text", level: "AA" },
  { id: "1.4.10", name: "Reflow", level: "AA" },
  { id: "1.4.11", name: "Non-text Contrast", level: "AA" },
  { id: "1.4.12", name: "Text Spacing", level: "AA" },
  { id: "1.4.13", name: "Content on Hover or Focus", level: "AA" },
  { id: "2.1.1", name: "Keyboard", level: "A" },
  { id: "2.1.2", name: "No Keyboard Trap", level: "A" },
  { id: "2.1.4", name: "Character Key Shortcuts", level: "A" },
  { id: "2.2.1", name: "Timing Adjustable", level: "A" },
  { id: "2.2.2", name: "Pause, Stop, Hide", level: "A" },
  { id: "2.3.1", name: "Three Flashes or Below Threshold", level: "A" },
  { id: "2.4.1", name: "Bypass Blocks", level: "A" },
  { id: "2.4.2", name: "Page Titled", level: "A" },
  { id: "2.4.3", name: "Focus Order", level: "A" },
  { id: "2.4.4", name: "Link Purpose (In Context)", level: "A" },
  { id: "2.4.5", name: "Multiple Ways", level: "AA" },
  { id: "2.4.6", name: "Headings and Labels", level: "AA" },
  { id: "2.4.7", name: "Focus Visible", level: "AA" },
  { id: "2.5.1", name: "Pointer Gestures", level: "A" },
  { id: "2.5.2", name: "Pointer Cancellation", level: "A" },
  { id: "2.5.3", name: "Label in Name", level: "A" },
  { id: "2.5.4", name: "Motion Actuation", level: "A" },
  { id: "3.1.1", name: "Language of Page", level: "A" },
  { id: "3.1.2", name: "Language of Parts", level: "AA" },
  { id: "3.2.1", name: "On Focus", level: "A" },
  { id: "3.2.2", name: "On Input", level: "A" },
  { id: "3.2.3", name: "Consistent Navigation", level: "AA" },
  { id: "3.2.4", name: "Consistent Identification", level: "AA" },
  { id: "3.3.1", name: "Error Identification", level: "A" },
  { id: "3.3.2", name: "Labels or Instructions", level: "A" },
  { id: "3.3.3", name: "Error Suggestion", level: "AA" },
  { id: "3.3.4", name: "Error Prevention (Legal, Financial, Data)", level: "AA" },
  { id: "4.1.1", name: "Parsing", level: "A" },
  { id: "4.1.2", name: "Name, Role, Value", level: "A" },
  { id: "4.1.3", name: "Status Messages", level: "AA" },
];

/** The W3C's explanation of a success criterion. */
export function wcagLink(id: string): string | null {
  const criterion = WCAG_CRITERIA.find((candidate) => candidate.id === id);
  if (!criterion) return null;
  const slug = criterion.name
    .toLowerCase()
    .replace(/[(),]/g, "")
    .replace(/\s+/g, "-");
  return `https://www.w3.org/WAI/WCAG21/Understanding/${slug}.html`;
}

/**
 * An automatic fix KontrolWP Connect can apply, in the order the tab lists
 * them. The first six arrived in 0.14.0; `since` names the version a later one
 * needs.
 */
export const ACCESSIBILITY_FIXES: readonly { id: string; title: string; detail: string; since?: string }[] = [
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
  {
    id: "focus_visible",
    title: "Show keyboard focus",
    detail: "Draws a clear outline around the link, button or field a keyboard user is on, even where the theme hides it.",
    since: "0.46.0",
  },
  {
    id: "media_autoplay",
    title: "Stop audio playing on its own",
    detail: "Stops audio and videos with sound from starting by themselves, and gives them play and pause controls.",
    since: "0.46.0",
  },
];

/** The fixes a site's KontrolWP Connect version can apply. */
export function fixesFor(pluginVersion: string | null) {
  return ACCESSIBILITY_FIXES.filter((fix) => {
    if (!pluginVersion) return false;
    return compareVersions(pluginVersion, fix.since ?? ACCESSIBILITY_SINCE) >= 0;
  });
}

export interface AccessibilityRule {
  title: string;
  impact: AccessibilityImpact;
  /** The WCAG 2.1 success criterion it relates to. */
  wcag: string;
  help: string;
  /**
   * A common accessibility practice rather than a failure of the criterion on
   * its own, so it does not count against the criterion in the WCAG checklist.
   */
  bestPractice?: true;
  /** The automatic fix that clears it, when there is one. */
  fix?: string;
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
    fix: "media_autoplay",
  },
  "input-image-alt": {
    title: "Image buttons without alt text",
    impact: "critical",
    wcag: "1.1.1",
    help: "Give each image button an alt attribute that says what it does.",
  },
  "area-alt": {
    title: "Image map areas without alt text",
    impact: "critical",
    wcag: "1.1.1",
    help: "Give each area of an image map an alt attribute that says where it goes.",
  },
  "svg-img-alt": {
    title: "Graphics without a text alternative",
    impact: "serious",
    wcag: "1.1.1",
    help: 'Give elements marked role="img" an aria-label, or a title inside an svg.',
  },
  "video-caption": {
    title: "Videos without captions",
    impact: "critical",
    wcag: "1.2.2",
    help: "Add a captions track to each video with sound. Videos embedded from YouTube or Vimeo are not checked; turn on captions there.",
  },
  "autocomplete-valid": {
    title: "Fields with an unknown autocomplete value",
    impact: "serious",
    wcag: "1.3.5",
    help: 'Use one of the standard autocomplete values, such as "email", "name" or "tel", so browsers can fill the field in.',
  },
  "color-contrast": {
    title: "Text with too little contrast",
    impact: "serious",
    wcag: "1.4.3",
    help: "Make text at least 4.5 times as bright or dark as its background (3 times for large text). Only colours set on the element itself are checked.",
  },
  blink: {
    title: "Scrolling or blinking text",
    impact: "serious",
    wcag: "2.2.2",
    help: "Remove marquee and blink elements, which move with no way to stop them.",
  },
  "click-keyboard": {
    title: "Clickable elements a keyboard cannot reach",
    impact: "serious",
    wcag: "2.1.1",
    help: 'Use a link or button for things visitors click, or give the element role="button" and tabindex="0" and handle the Enter key.',
  },
  "focus-outline": {
    title: "Keyboard focus is hidden",
    impact: "serious",
    wcag: "2.4.7",
    help: "Keep an outline, or another clear style, on the element that has keyboard focus. Only styles written into the page are checked.",
    fix: "focus_visible",
  },
  "label-in-name": {
    title: "Names that do not match the visible text",
    impact: "serious",
    wcag: "2.5.3",
    help: "Start a link or button's aria-label with the words it shows, so people using voice control can say them.",
  },
  "html-lang-valid": {
    title: "Pages with an invalid language code",
    impact: "serious",
    wcag: "3.1.1",
    help: 'Use a standard language code on the html tag, such as "en" or "en-US" (with a hyphen, not an underscore).',
  },
  "valid-lang": {
    title: "Parts of pages with an invalid language code",
    impact: "moderate",
    wcag: "3.1.2",
    help: 'Use a standard language code in lang attributes, such as "fr" or "es-MX".',
  },
  "aria-hidden-focus": {
    title: "Hidden elements that keyboard users can reach",
    impact: "serious",
    wcag: "4.1.2",
    help: 'Remove aria-hidden="true" from links, buttons and fields, or take them out of the tab order with tabindex="-1".',
  },
  "duplicate-id": {
    title: "Labels pointing at a repeated id",
    impact: "serious",
    wcag: "4.1.1",
    help: "Give each element a unique id, so labels and ARIA references reach the right one.",
  },
  "page-has-heading-one": {
    title: "Pages without a main heading",
    impact: "moderate",
    wcag: "1.3.1",
    help: "Give each page one top-level heading that says what the page is about.",
    bestPractice: true,
  },
  "heading-order": {
    title: "Skipped heading levels",
    impact: "moderate",
    wcag: "1.3.1",
    help: "Go down one level at a time, for example from a heading 2 to a heading 3.",
    bestPractice: true,
  },
  "landmark-main": {
    title: "Pages without a main landmark",
    impact: "moderate",
    wcag: "1.3.1",
    help: "Wrap the main content in a main element. The theme controls this.",
    bestPractice: true,
  },
  "skip-link": {
    title: "No skip to content link",
    impact: "minor",
    wcag: "2.4.1",
    help: "Add a link at the top of the page that jumps to the main content.",
    fix: "skip_link",
    bestPractice: true,
  },
  "empty-heading": {
    title: "Empty headings",
    impact: "minor",
    wcag: "1.3.1",
    help: "Remove headings with no text, or fill them in.",
    bestPractice: true,
  },
  "link-text": {
    title: "Vague link text",
    impact: "minor",
    wcag: "2.4.4",
    help: 'Say where the link goes, instead of "click here" or "read more".',
    bestPractice: true,
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

export type CriterionStatus = "problems" | "passed" | "manual";

/**
 * Every WCAG 2.1 A and AA criterion with what the latest scan says about it:
 * problems found, no problems the scan can detect, or one only a person can
 * review. Best-practice findings do not count against a criterion.
 */
export function wcagChecklist(issues: { rule: string }[]) {
  const checked = new Set<string>();
  for (const rule of Object.values(ACCESSIBILITY_RULES)) if (!rule.bestPractice) checked.add(rule.wcag);
  const failing = new Map<string, string[]>();
  for (const issue of issues) {
    const rule = ACCESSIBILITY_RULES[issue.rule];
    if (!rule || rule.bestPractice) continue;
    failing.set(rule.wcag, [...(failing.get(rule.wcag) ?? []), issue.rule]);
  }
  return WCAG_CRITERIA.map((criterion) => ({
    ...criterion,
    status: (failing.has(criterion.id)
      ? "problems"
      : checked.has(criterion.id)
        ? "passed"
        : "manual") as CriterionStatus,
    rules: failing.get(criterion.id) ?? [],
  }));
}

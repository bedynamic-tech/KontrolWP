// Runs lintapple on every page and tab of the dashboard.
// Start the app first (npm run dev, with tests/ui/seed.sql loaded), then:
//   npm run lint:ui [-- http://localhost:5173] [-- --json report.json]
// Exit 0: passed, 1: findings, 2: a check did not finish.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { checkPage } from "lintapple";

const args = process.argv.slice(2);
const jsonIndex = args.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? args.splice(jsonIndex, 2)[1] : undefined;
const base = (args[0] ?? "http://localhost:5173").replace(/\/$/, "");
const policy = JSON.parse(await readFile(new URL("../ui-policy.json", import.meta.url), "utf8"));

// Site ids come from tests/ui/seed.sql: 1 connected, 2 failing, 3 static.
const routes = [
  "/",
  "/sites",
  "/plugins",
  "/users",
  ...["general", "updates", "links", "integrations"].map((tab) => `/settings?tab=${tab}`),
  ...[
    "overview", "analytics", "content", "plugins", "users", "tools", "links", "snippets", "database",
    "uptime", "performance", "seo", "branding", "maintenance", "security", "accessibility", "domain",
  ].map((tab) => `/sites/1?tab=${tab}`),
  "/sites/1?tab=analytics&view=analytics",
  "/sites/1?tab=content&new=post",
  "/sites/2",
  ...["overview", "analytics", "pages", "tools", "links", "uptime", "performance", "seo", "accessibility", "domain"].map(
    (tab) => `/sites/3?tab=${tab}`,
  ),
  "/sites/3?tab=analytics&view=analytics",
];

// Like lintapple's checkUrl, but the pointer starts away from the page. Headless
// Chromium puts it at (0, 0), which hovers the folded sidebar open over the page.
async function checkRoute(browser, url) {
  const findings = [];
  for (const viewport of policy.viewports) {
    for (const colorScheme of policy.colorSchemes) {
      const context = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(url, { waitUntil: "load" });
        await page.mouse.move(viewport.width - 1, viewport.height - 1);
        await page.locator("main h1").first().waitFor({ state: "visible" });
        const result = await checkPage(page, policy);
        findings.push(...result.findings.map((f) => ({ ...f, state: "initial", viewport, colorScheme })));
        // On phones the header's menu button slides in the app's links; the menu is the same on
        // every page, so the overview checks it.
        const menuButton = page.getByRole("button", { name: "Open menu" });
        if (url === `${base}/` && (await menuButton.isVisible())) {
          await menuButton.click();
          await page.getByRole("dialog").waitFor({ state: "visible" });
          await page.mouse.move(viewport.width - 1, viewport.height - 1);
          const menu = await checkPage(page, policy);
          findings.push(...menu.findings.map((f) => ({ ...f, state: "menu open", viewport, colorScheme })));
        }
      } finally {
        await context.close();
      }
    }
  }
  return { url, findings };
}

let failed = false;
let total = 0;
const reports = [];
const browser = await chromium.launch();
for (const route of routes) {
  try {
    const report = await checkRoute(browser, base + route);
    reports.push({ route, report });
    total += report.findings.length;
    console.log(`${report.findings.length ? "Failed" : "Passed"}: ${route} (${report.findings.length} findings)`);
    for (const f of report.findings) {
      console.log(`  ${f.rule} (${f.viewport.width}px, ${f.colorScheme}, ${f.state})`);
      console.log(`    ${f.selector}`);
      console.log(`    ${f.message}`);
    }
  } catch (error) {
    failed = true;
    reports.push({ route, error: error.message });
    console.log(`Could not check ${route}: ${error.message}`);
  }
}
await browser.close();
if (jsonPath) await writeFile(jsonPath, JSON.stringify(reports, null, 2));
console.log(`\n${total} UI findings across ${routes.length} pages.`);
process.exitCode = failed ? 2 : total ? 1 : 0;

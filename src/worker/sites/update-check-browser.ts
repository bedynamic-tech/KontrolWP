import puppeteer from "@cloudflare/puppeteer";
import { BLOCK, UpdateCheckError, type Look, type Looker } from "./update-check.ts";

// The browser half of the regression check: Cloudflare Browser Rendering loads
// the home page, and its canvas shrinks the screenshot to one pixel per block
// for the comparison in update-check.ts. Kept apart so the tests never load
// puppeteer.

const WIDTH = 1280;
const VIEWPORT_HEIGHT = 900;
/** Long pages are cut here. */
const MAX_HEIGHT = 3000;
const PAGE_TIMEOUT = 30_000;
/** Lets late fonts and images settle after the load event. */
const SETTLE_MS = 1500;

/** Stops animations and blinking carets, which would otherwise differ between any two screenshots. */
const FREEZE_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

/** Runs in the browser: the screenshot shrunk to one pixel per block, as RGBA bytes (base64). A string, so the bundler never rewrites it. */
const SHRINK = `async ([src, block]) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  const cols = Math.ceil(image.naturalWidth / block);
  const rows = Math.ceil(image.naturalHeight / block);
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, cols, rows);
  const bytes = context.getImageData(0, 0, cols, rows).data;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { cols, rows, pixels: btoa(binary) };
}`;

/** WordPress's own page when PHP stops with a fatal error. */
const CRITICAL_ERROR = /There has been a critical error on this website/i;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One browser for one look at one page, closed straight after to keep Browser Rendering time small. */
export const browserLooker: Looker = {
  async look(env, url): Promise<Look> {
    if (!env.BROWSER) throw new UpdateCheckError("Browser Rendering is not set up. Deploy KontrolWP again to add it.");
    let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
    try {
      browser = await puppeteer.launch(env.BROWSER as unknown as Parameters<typeof puppeteer.launch>[0]);
    } catch (error) {
      console.error("update check browser", error);
      throw new UpdateCheckError(
        /429|limit/i.test(reason(error))
          ? "Cloudflare Browser Rendering was busy or out of time for today."
          : "Cloudflare Browser Rendering did not start a browser.",
      );
    }
    try {
      const page = await browser.newPage();
      let status: number | null;
      let html: string;
      let image: Uint8Array;
      try {
        await page.setViewport({ width: WIDTH, height: VIEWPORT_HEIGHT });
        const response = await page.goto(url, { waitUntil: "load", timeout: PAGE_TIMEOUT });
        status = response?.status() ?? null;
        await page.addStyleTag({ content: FREEZE_CSS }).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        html = await page.content();
        const height = (await page.evaluate("document.documentElement.scrollHeight")) as number;
        image = new Uint8Array(
          await page.screenshot({
            type: "jpeg",
            quality: 70,
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width: WIDTH, height: Math.max(VIEWPORT_HEIGHT, Math.min(height || 0, MAX_HEIGHT)) },
          }),
        );
      } catch (error) {
        const message = reason(error);
        return {
          status: null,
          critical: false,
          grid: null,
          error: /timeout/i.test(message) ? "it did not finish loading within 30 seconds" : "it did not load",
        };
      }
      // A blank page decodes the screenshot, so the site's own security headers never get in the way.
      const canvas = await browser.newPage();
      const grid = (await canvas.evaluate(
        `(${SHRINK})(${JSON.stringify([`data:image/jpeg;base64,${toBase64(image)}`, BLOCK])})`,
      )) as { cols: number; rows: number; pixels: string };
      return {
        status,
        critical: CRITICAL_ERROR.test(html),
        grid: { cols: grid.cols, rows: grid.rows, pixels: fromBase64(grid.pixels) },
        error: null,
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  },
};

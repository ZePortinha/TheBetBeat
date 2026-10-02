/**
 * Screenshot helper (A2.9 visual verification).
 * Usage: pnpm exec tsx scripts/screenshot.ts <url> <out.png> [WxH] [--full]
 *        [--slow] (CDP 4% animation speed for frame review) [--wait <ms>]
 */
import { chromium } from "@playwright/test";

async function main() {
  const [url, out, size = "393x852", ...rest] = process.argv.slice(2);
  if (!url || !out) {
    console.error("usage: screenshot.ts <url> <out.png> [WxH] [--full] [--slow]");
    process.exit(1);
  }
  const [w, h] = size.split("x").map(Number);
  const waitIdx = rest.indexOf("--wait");
  const extraWait = waitIdx >= 0 ? Number(rest[waitIdx + 1]) : 800;

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: w!, height: h! },
    deviceScaleFactor: 2,
  });
  if (rest.includes("--slow")) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Animation.enable");
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.04 });
  }
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(extraWait);
  await page.screenshot({ path: out, fullPage: rest.includes("--full") });
  await browser.close();
  console.log(`saved ${out} (${size})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

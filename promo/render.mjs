/**
 * Renders promo/orbit-promo.html to an MP4 (1080x1920, 30 fps) frame by
 * frame with the installed Chrome and ffmpeg.
 *   node promo/render.mjs                 -> promo/orbit-promo.mp4
 *   node promo/render.mjs --frames 1,6,9  -> PNG stills at those seconds
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
if (!CHROME) throw new Error("Chrome or Edge is needed");

const stillsArg = process.argv.indexOf("--frames");
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(",").map(Number) : null;
const outDir = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : here;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(join(here, "orbit-promo.html")).href + "?capture");
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => [...document.images].every((i) => i.complete));
const stage = page.locator("#stage");

if (stills) {
  for (const t of stills) {
    await page.evaluate((t) => window.render(t), t);
    await stage.screenshot({ path: join(outDir, `frame-${String(t).replace(".", "_")}.png`) });
  }
  console.log(`saved ${stills.length} stills to ${outDir}`);
} else {
  const duration = await page.evaluate(() => window.DURATION);
  const out = join(here, "orbit-promo.mp4");
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "image2pipe",
      "-framerate",
      String(FPS),
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "17",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: ["pipe", "ignore", "inherit"] },
  );
  const total = Math.round(duration * FPS);
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    const png = await stage.screenshot({ type: "png" });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 60 === 0) console.log(`frame ${f}/${total}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`saved ${out}`);
}
await browser.close();

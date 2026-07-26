/* ============================================================================
   build-og-image.mjs: render assets/img/og-image.png (1200x630), the card that
   LinkedIn, X, Slack and iMessage show for every link to this site.

   It is rendered THROUGH THE SITE'S OWN STYLESHEET, served from a local server,
   so it inherits the real tokens, the real self-hosted fonts and the real ink
   surface. Hand-drawing it somewhere else is what let the previous card sit a
   whole redesign behind the site it advertised.

   Deliberately NOT part of `npm run build`: a screenshot is not guaranteed to be
   byte-identical across machines and font versions, and the CI freshness gate
   compares the tree after a rebuild. This is a manual step, like the resume PDF.

   Run (needs a server on PORT, default 8080):  npm run og-image
   ============================================================================ */
import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(HERE, "..");
const PORT = process.env.PORT || "8080";
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.join(WEBSITE_ROOT, "assets", "img", "og-image.png");

const WIDTH = 1200;
const HEIGHT = 630;

/* Evergreen copy only. Anything countable (packages, ADRs, fitness tests) would
   put this file on the release treadmill for no gain: a social card is read in
   half a second, at thumbnail size. */
/* Four, not five: the text column is ~650px wide next to the portrait, and a
   fifth pill wrapped onto a line of its own. */
const PILLS = [".NET 10", "Azure", "DDD & Clean Architecture", "CQRS"];

const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <base href="${BASE}">
  <link rel="stylesheet" href="assets/css/styles.css">
  <style>
    html, body { margin: 0; padding: 0; }
    body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    .og {
      width: ${WIDTH}px; height: ${HEIGHT}px;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 4rem;
      padding: 0 72px;
      box-sizing: border-box;
    }
    .og-brand { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 2.6rem; }
    .og-brand .brand-mark { width: 46px; height: 46px; border-radius: 13px; font-size: 1.2rem; }
    .og-domain {
      font-family: var(--font-mono);
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--ink-muted);
    }
    .og h1 {
      font-size: 4.6rem;
      line-height: 1.02;
      letter-spacing: -0.035em;
      margin: 0 0 0.6rem;
      color: var(--ink-text);
    }
    .og-role {
      font-size: 2rem;
      font-weight: 600;
      letter-spacing: -0.015em;
      color: var(--ink-accent);
      margin: 0 0 1.1rem;
    }
    .og-lede {
      font-size: 1.45rem;
      line-height: 1.4;
      color: var(--ink-muted);
      margin: 0;
      max-width: 29ch;
    }
    .og-pills {
      display: flex; flex-wrap: wrap; gap: 0.6rem;
      list-style: none; margin: 2.4rem 0 0; padding: 0;
    }
    .og-pills li {
      font-family: var(--font-mono);
      font-size: 1.02rem;
      padding: 0.4rem 0.9rem;
      border-radius: 999px;
      border: 1px solid var(--ink-border);
      background: rgba(134, 170, 255, 0.08);
      color: var(--ink-text);
      white-space: nowrap;
    }
    .og-portrait {
      width: 340px; height: 340px;
      border-radius: 50%;
      object-fit: cover;
      box-shadow: 0 0 0 2px var(--ink-border), 0 0 0 18px rgba(134, 170, 255, 0.10);
    }
  </style>
</head>
<body>
  <div class="og ink">
    <div>
      <div class="og-brand">
        <span class="brand-mark" aria-hidden="true">IB</span>
        <span class="og-domain">IVANBALL.GITHUB.IO</span>
      </div>
      <h1>Ivan Ball-llovera</h1>
      <p class="og-role">Senior Software Architect</p>
      <p class="og-lede">Cloud-native enterprise architecture on the Microsoft stack.</p>
      <ul class="og-pills">
${PILLS.map((p) => `        <li>${p}</li>`).join("\n")}
      </ul>
    </div>
    <!-- The 800px JPG, not the 400px .webp the site serves: this is rendered at
         340px and the derivative visibly softened at that size. Nothing here
         ships to a visitor, so the heavier source costs nothing. -->
    <img class="og-portrait" src="assets/img/ivan-ball-llovera.jpg" alt="">
  </div>
</body>
</html>`;

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
/* setContent rather than a template file under the site root: this markup is
   build tooling, not a page anyone should be able to browse to. The <base> tag
   is what lets its relative asset URLs resolve against the served site. */
await page.setContent(html, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
const shot = await page.screenshot({ type: "png" });
await browser.close();

const optimized = await sharp(shot).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(OUT, optimized);
console.log(`Wrote assets/img/og-image.png (${WIDTH}x${HEIGHT}, ${(optimized.length / 1024).toFixed(0)} KB).`);

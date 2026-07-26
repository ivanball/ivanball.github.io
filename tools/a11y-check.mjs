/* ============================================================================
   Accessibility gate: axe-core against every page type, in BOTH themes.

   The site claims WCAG 2.1 AA with zero violations, so this keeps that honest.

   Why not pa11y-ci: it bundles axe 4.2 (2021), which cannot evaluate this
   stylesheet's CSS custom properties or its color-mix() header background. It
   reported color-contrast failures on body text measured at 16.4:1 against a
   4.5:1 requirement. Silencing those would have meant an exclusion list broad
   enough to hide a real regression. Driving current axe-core through puppeteer
   costs a few lines and checks what is actually on the page.

   Both themes matter: the palette swaps entirely via [data-theme], so a
   light-only run tests half the site.

   Run: npm run a11y      (expects a server already on PORT, default 8080)
   ============================================================================ */
import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const PORT = process.env.PORT || "8080";
const BASE = `http://127.0.0.1:${PORT}`;

/* One of each page type. The seven root pages are hand-authored; the two docs
   pages cover the generated shell and the sidebar layout. */
const PATHS = [
  "/index.html",
  "/resume.html",
  "/platform.html",
  "/writing.html",
  "/speaking.html",
  "/contact.html",
  "/404.html",
  "/docs/index.html",
  "/docs/adr/001-manual-dto-mapping.html",
];

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

let violationCount = 0;
const failures = [];

for (const p of PATHS) {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage();
    /* Set the theme the way the site does, before first paint, so the run sees
       the same computed colors a visitor would. */
    await page.evaluateOnNewDocument((t) => {
      try { localStorage.setItem("mmca-theme", t); } catch { /* first-visit path */ }
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    await page.goto(BASE + p, { waitUntil: "networkidle0" });
    await page.evaluate(axeSource);
    const result = await page.evaluate(
      (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
      TAGS
    );
    await page.close();

    for (const v of result.violations) {
      violationCount += v.nodes.length;
      failures.push({ page: p, theme, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")) });
    }
  }
}

await browser.close();

if (failures.length === 0) {
  console.log(`axe-core: no WCAG 2.1 AA violations across ${PATHS.length} pages in light and dark.`);
  process.exit(0);
}

console.error(`axe-core: ${violationCount} violation(s) across ${failures.length} page/theme combination(s).\n`);
for (const f of failures) {
  console.error(`${f.page} [${f.theme}]  ${f.id} (${f.impact}): ${f.help}`);
  for (const t of f.nodes) console.error(`    ${t}`);
}
process.exit(1);

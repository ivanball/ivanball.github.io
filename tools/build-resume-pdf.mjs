/* ============================================================================
   Export the downloadable resume PDF from resume.html.

   The PDF used to be exported separately from a .docx, which let the two drift:
   the file served by the "Download PDF" button was a month older than the page
   above it and disagreed with it on job title and several figures. Generating
   from the page makes that impossible.

   styles.css already carries a @media print block written for exactly this:
   Letter with 0.5in margins, site chrome hidden, ink-friendly light palette
   regardless of the active theme, and break-inside avoid on each job so roles
   are not split across pages. So this script only has to drive it.

   Run: npm run resume-pdf     (expects a server already on PORT, default 8080)
   ============================================================================ */
import puppeteer from "puppeteer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(TOOLS_DIR, "..");
const OUT = process.env.OUT
  || path.join(WEBSITE_ROOT, "assets", "files", "Ivan-Ball-llovera-Resume-2026.pdf");

const PORT = process.env.PORT || "8080";

const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();

/* Force light: the print block already neutralises the palette, but rendering
   in light avoids any dark-mode image or shadow leaking into the export. */
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem("mmca-theme", "light"); } catch { /* ignore */ }
  document.documentElement.setAttribute("data-theme", "light");
});
await page.goto(`http://127.0.0.1:${PORT}/resume.html`, { waitUntil: "networkidle0" });
await page.emulateMediaType("print");

await page.pdf({
  path: OUT,
  format: "Letter",
  printBackground: true,
  /* Margins come from the @page rule in styles.css. */
  preferCSSPageSize: true,
});

await browser.close();

const kb = Math.round(statSync(OUT).size / 1024);
console.log(`Wrote ${path.relative(WEBSITE_ROOT, OUT)} (${kb} KB) from resume.html.`);

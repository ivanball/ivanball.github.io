/* ============================================================================
   Article hero images: PNG source -> WebP for the web.

   The 50 article heroes are authored at 1600x840 PNG (~750 KB each, ~37 MB
   total) because that is the size Medium wants when a piece is published. The
   Writing page renders them in cards roughly 380 CSS px wide, so shipping the
   originals meant downloading about 37 MB to fill thumbnails.

   This script emits two WebPs beside each PNG: `article-NN.webp` at 800px,
   which covers a 2x display at card size and the single-column mobile layout,
   and `article-NN-1600.webp` at the full source width, for the article page
   hero on a high-DPI screen. The generator offers both as a srcset, so the
   browser picks per placement.

   The PNG originals STAY in the repo and are deliberately not referenced by
   any page: they are the source heroes uploaded to Medium at publish time, and
   24 articles are still unpublished. Deleting them would destroy assets that
   are still needed, and it would not shrink a clone anyway since they are
   already in git history.

   Run: npm run images     (then `npm run build` to regenerate the card markup)
   ============================================================================ */
import { readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(TOOLS_DIR, "..");
const ARTICLE_IMG_DIR = path.join(WEBSITE_ROOT, "assets", "img", "articles");

const TARGET_WIDTH = 800;
const FULL_WIDTH = 1600;
const QUALITY = 80;

const sources = readdirSync(ARTICLE_IMG_DIR)
  .filter((f) => /^article-\d+\.png$/i.test(f))
  .sort();

if (sources.length === 0) {
  console.error(`No article-NN.png files found in ${ARTICLE_IMG_DIR}`);
  process.exit(1);
}

let converted = 0;
let skipped = 0;
let srcBytes = 0;
let outBytes = 0;
let fullBytes = 0;

for (const file of sources) {
  const src = path.join(ARTICLE_IMG_DIR, file);
  const dst = src.replace(/\.png$/i, ".webp");
  const dstFull = src.replace(/\.png$/i, `-${FULL_WIDTH}.webp`);
  srcBytes += statSync(src).size;

  /* Incremental: only re-encode when the source is newer than a derivative,
     so a rebuild after editing one hero does not churn the other 49. */
  const current = (f) => existsSync(f) && statSync(f).mtimeMs >= statSync(src).mtimeMs;
  if (current(dst) && current(dstFull)) {
    outBytes += statSync(dst).size;
    fullBytes += statSync(dstFull).size;
    skipped++;
    continue;
  }

  await sharp(src)
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(dst);
  await sharp(src)
    .resize({ width: FULL_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(dstFull);

  outBytes += statSync(dst).size;
  fullBytes += statSync(dstFull).size;
  converted++;
}

const mb = (n) => (n / 1048576).toFixed(1);
const pct = srcBytes ? Math.round((1 - outBytes / srcBytes) * 100) : 0;
console.log(
  `Article images: ${converted} converted, ${skipped} already current (${sources.length} total).`
);
console.log(
  `PNG sources ${mb(srcBytes)} MB -> WebP ${mb(outBytes)} MB at ${TARGET_WIDTH}px wide, quality ${QUALITY} (${pct}% smaller).`
);
console.log(`Full-resolution WebP ${mb(fullBytes)} MB at ${FULL_WIDTH}px wide (srcset for high-DPI screens).`);

/* ----- profile photo -----
   The hero avatar renders at 168px (120px under 760px), so 400px covers a 2x
   display with room to spare. The 800px JPEG stays as the source: it is the
   right size to hand to LinkedIn, a conference bio, or a speaker page. */
{
  const src = path.join(WEBSITE_ROOT, "assets", "img", "ivan-ball-llovera.jpg");
  const dst = src.replace(/\.jpg$/i, ".webp");
  if (existsSync(src)) {
    await sharp(src).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 82 }).toFile(dst);
    const before = statSync(src).size, after = statSync(dst).size;
    console.log(`Profile photo: ${Math.round(before / 1024)} KB JPEG -> ${Math.round(after / 1024)} KB WebP at 400px.`);
  }
}

/* ============================================================================
   Article hero images: PNG source -> WebP for the web.

   The 50 article heroes are authored at 1600x840 PNG (~750 KB each, ~37 MB
   total) because that is the size Medium wants when a piece is published. The
   Writing page renders them in cards roughly 380 CSS px wide, so shipping the
   originals meant downloading about 37 MB to fill thumbnails.

   This script emits an 800px-wide WebP beside each PNG. 800px covers a 2x
   display at card size and the single-column mobile layout alike, so one
   derivative serves every breakpoint and no srcset is needed.

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

for (const file of sources) {
  const src = path.join(ARTICLE_IMG_DIR, file);
  const dst = src.replace(/\.png$/i, ".webp");
  srcBytes += statSync(src).size;

  /* Incremental: only re-encode when the source is newer than the derivative,
     so a rebuild after editing one hero does not churn the other 49. */
  if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) {
    outBytes += statSync(dst).size;
    skipped++;
    continue;
  }

  await sharp(src)
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(dst);

  outBytes += statSync(dst).size;
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

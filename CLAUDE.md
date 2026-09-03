# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Personal website for Ivan Ball-llovera (published as `ivanball.github.io` via GitHub Pages), plus the **canonical documentation library for the whole MMCA workspace**. It is plain HTML/CSS/vanilla JS with **no build step for the site pages**; the only build tooling is the docs generator under `tools/`.

**Pushing to `main` publishes the live site immediately.** This repo is not PR-gated like the four .NET repos in the workspace; confirm with the user before pushing.

## Commands

```bash
# Serve locally (no build step for the pages; any static server works)
python -m http.server 8080

# Regenerate the reference library after ANY edit under docs-src/ or assets/data/
cd tools && npm install && npm run build

# Re-encode article heroes to WebP after adding a new article-NN.png (incremental)
cd tools && npm run images

# Re-export the downloadable resume PDF after editing resume.html (needs a server)
cd tools && PORT=8080 npm run resume-pdf

# Re-render the social card after a design or positioning change (needs a server)
cd tools && PORT=8080 npm run og-image

# axe-core over every page type in both themes (needs a server)
cd tools && PORT=8080 npm run a11y
```

The generator prints a summary: pages written per collection, mermaid page count, vendored font count, highlighted code blocks, on-this-page rails, article and ADR card counts, feed and sitemap sizes, pruned orphans, and dead cross-links. Check it after a build. A non-zero dead-link count usually means a wrong relative path in the markdown, not a deliberate reference to something unpublished.

CI (`.github/workflows/ci.yml`) runs three jobs on push and PR:

1. **Freshness** rebuilds and fails if `git diff` is non-empty. This is the important one: it converts "remember to run the build" into an enforced check. It needs a full clone, because sitemap `lastmod` comes from each file's last commit date.
2. **Links** crawls the served site with linkinator. Internal links fail the build, external ones are advisory. Two traps: linkinator only recurses beneath its entry point's own path (so point it at the directory root, not `index.html`), and it crawls concurrently, so a single-threaded server reports healthy files as BROKEN.
3. **Accessibility** runs `tools/a11y-check.mjs` (axe-core via puppeteer) over every page type in **both** themes, because the palette swaps entirely via `data-theme`. Not pa11y-ci: its bundled axe 4.2 cannot evaluate this stylesheet's custom properties or the `color-mix()` header background, and reported contrast failures on text measuring 16.4:1.

## The two content systems

### 1. Hand-authored pages (repo root)

`index.html`, `resume.html`, `platform.html`, `writing.html`, `speaking.html`, `contact.html`, `404.html`. There is no templating: the header/footer/nav markup is **duplicated across every page** (and separately inside `tools/build-docs.mjs` as `headerHtml`/`footerHtml`). A nav or footer change means editing all top-level pages AND the generator, then rebuilding `docs/`.

Single edit points:
- **Writing page cards**: `assets/data/articles.js` (`window.ARTICLES` + `ARTICLE_CATEGORIES`). An empty `url` renders a "Coming soon" card; paste the Medium URL **and** the publication instant into `date` to publish. **These cards are static markup generated at build time**, so editing the data file is not enough: re-run `cd tools && npm run build` and commit the regenerated `writing.html`, `feed.xml`, and `sitemap.xml` with it. `assets/js/writing.js` only filters the generated nodes in place; it renders nothing.
- **Platform ADR card copy**: `assets/data/adr-cards.js`, keyed by ADR number. The list itself is enumerated from `docs-src/adr/`, so a new ADR appears on the page and in the counts with no edit here; an entry only replaces the generated fallback with better copy.
- **Analytics and email capture**: `assets/js/analytics.js` (GA4 measurement ID + newsletter form action). Both are placeholders and both no-op until replaced: no request is made and the subscribe form stays hidden. Search-console verification is a meta tag and lives commented in `index.html`'s head, because a crawler will not accept a JS-injected tag.
- **Published email**: `EMAIL_USER` / `EMAIL_DOMAIN` at the top of `assets/js/main.js` (assembled in JS to deter scraping). Deliberately absent from the `ContactPage` JSON-LD for the same reason.
- **Figures that come from MMCA.Common**: `assets/data/platform-facts.js` (packages, fitness tests, reference apps, rubric categories). CI checks out this repo alone and cannot read `MMCA.Common/FACTS.md`, so they are mirrored here and stamped into `index.html`, `platform.html`, and `resume.html`. Refresh them during the consumer sweep after a framework release. The ADR count is NOT here: it is counted from `docs-src/adr/`. The same file also owns `packageLayers`, the package list grouped by layer that renders the stack on `platform.html`; **the build throws if its package count disagrees with `packages`**, so the two cannot drift apart.
- **Resume**: edit `resume.html`, then re-export the PDF with `npm run resume-pdf` (it renders the page through the `@media print` block). Do not hand-replace the PDF: a hand-made PDF drifts from the page it sits on.
- **Social card** (`assets/img/og-image.png`, 1200x630, what LinkedIn/X/Slack/iMessage show for every link to the site): generated by `npm run og-image`, which renders it **through the site's own stylesheet** off the local server, so it inherits the real tokens, fonts and ink surface. Copy lives in `tools/build-og-image.mjs` and is deliberately evergreen (no package/ADR counts, which would put a social card on the release treadmill). Like the resume PDF it is a **manual** step, not part of `npm run build`: a screenshot is not guaranteed byte-identical across machines and font versions, and the freshness gate diffs the tree after a rebuild. A card edited elsewhere drifts from the site it advertises.
- **Article hero images**: drop the 1600x840 `article-NN.png` into `assets/img/articles/` and run `npm run images`. The PNGs are the source heroes uploaded to Medium and stay in the repo; pages reference only the derived 800px `.webp` (about 97% smaller across the 50).

`assets/js/main.js` is loaded with `defer` on every page: theme toggle (localStorage key `mmca-theme`; each page also has an inline head script that applies the stored theme before paint), mobile nav, footer year, doc sidebar, scroll reveal, and the on-this-page rail's active state. `assets/css/styles.css` is the single stylesheet (light + dark via `data-theme` on `<html>`); `assets/css/docs.css` layers doc-page prose/layout on top of it.

**404.html is the one root page stamped with a root-absolute (`/`) prefix.** GitHub Pages serves it for a miss at any depth (`/docs/adr/typo.html`), where a relative `assets/css/styles.css` resolves under *that* directory and 404s in turn: the page rendered completely unstyled, with dead nav links, exactly where a visitor least needs a broken page. The prefix is chosen in the root-page loop in `tools/build-docs.mjs`; the two tags outside the regions (`favicon`) are root-absolute by hand.

### Site search

Global search lives in a native `<dialog>` stamped into the `site-header` region, so it is on all 126 pages: the magnifier button in the nav, `Ctrl`/`Cmd`+`K` anywhere, or `/` when not already typing. `<dialog>` is deliberate: the focus trap, `Esc`, page inertness and the backdrop come from the platform instead of hand-written JS.

- **The index is a real inverted index**, built with **MiniSearch** at build time by `tools/build-docs.mjs` and written to `assets/data/search-index.json` as its serialized form (a few MB raw, about a quarter of that gzipped over the wire: the honest cost of full body text over the whole corpus, paid only by a visitor who opens search). The browser loads a finished index instead of building one, which is the only way a 7.6 MB corpus is searchable client-side at all.
- **Nothing ships to a visitor who never searches.** `assets/js/search.js` is the only search code on the page until the dialog opens; on FIRST open it injects `assets/js/minisearch.js` (vendored by the build from the `minisearch` dependency, same pattern as `mermaid.min.js`, so no third-party request) and then fetches the index. The library is deliberately **not** in `headAssetsHtml`.
- **The envelope carries the options**: `{ v, n, o: { fields, storeFields, idField }, i: <index> }`, and the runtime hands `o` straight to `MiniSearch.loadJS(data.i, data.o)`. Never restate the options in `search.js`, and **never customize `tokenize` or `processTerm` on either side**: a function cannot cross JSON, so a custom one would give the browser a different tokenization than the index was built with. Both sides must tokenize identically or the index quietly stops matching.
- **Indexed fields are `t` (section title), `d` (document title), `i` (identifiers) and `b` (the FULL plain text of the section body)**; `b` is indexed but **not stored**, so the whole body is searchable while only the 180-character display excerpt (`x`) travels back with a result. Stored fields are `u, d, k, t, x, e`, and rendering uses only those.
- **One record per H2 section**, not per page: a hit lands on the section that answers the question rather than on a 500 KB chapter. `MAX_SECTIONS_PER_DOC` caps the long tail (`00-inventory.md` alone has hundreds of H2s), and capped sections **stay findable**: `foldSectionsIntoDocument()` folds their plain text and their identifiers into the DOCUMENT record, so the words stay findable and the reader lands on the document that contains them.
- Each record also carries the distinct `backticked` identifiers of its section. Those identifiers are what people search this library for, and they are boosted above body text. `identifiersIn()` reduces `PagedCollectionResult<EventDTO>` to its parts: a stricter pattern indexed *nothing* for the generic forms this codebase actually writes. The per-section cap (`MAX_IDENTIFIERS`) does not apply to a folded document record, whose list is a deduplicated union.
- **`toPlainText()` is what gets indexed, `toExcerpt()` is what gets displayed.** They differ deliberately: `toPlainText` does not truncate and **keeps table cell text** (only the pipes go), because a comparison matrix is prose to someone hunting a term.
- Anchors come from `ctx.toc`, the ids the renderer already assigned, zipped with the source split by `splitSections()` (which skips fenced code, so a `## ` line inside a fence is not mistaken for a heading). Do not re-slug independently: heading ids are deduplicated per document and would drift.
- Root pages are indexed by **reading back the final HTML**, so what is indexed is what a visitor sees, including regions this build just stamped. Published articles come from `articles.js` and are marked as leaving the site.
- **Ids are sequential in insertion order.** Nothing about the index then depends on hashing or iteration luck, which is what keeps two builds byte-identical for the CI freshness gate.
- **Query grammar** (`parseQuery` in `search.js`): bare words are **OR** (broad by default suits a reference library, where a visitor rarely knows which words the author used), and `AND` / `OR` in **uppercase** combine explicitly, with `AND` binding tighter. `"quoted"` means **all of those words in the same record**, not an exact phrase: the index stores no term positions, which for section-sized records is close enough to be useful and is what the dialog's foot hint says. The parsed shape maps one for one onto a MiniSearch query (`toQuery()`): a multi-word item is an AND of its words, a group is an AND of its items, the query is an OR of its groups. Uppercase-only operators keep a search for the word "and" working; smart quotes are accepted because that is what a paste carries; an unterminated quote runs to the end rather than failing, since it is nearly always a query mid-typing.
- **`normalize()` must match MiniSearch's default tokenizer**, so its character class splits on **dots and underscores** as well as the rest of the punctuation: `MMCA.Common.API` becomes three words ANDed together, and `"soft delete"` still finds **Soft-Delete** (this corpus is full of hyphenated terms: `database-per-service`, `dual-dispatch`). Changing that class without changing the tokenizer on the build side is how you silently break matching.
- **Search options live in `SEARCH_OPTIONS`**: prefix matching from three characters, `fuzzy: false` (in a reference library a near-miss on a type name is a wrong answer dressed as a right one), field boosts `t: 3, i: 2.5, d: 2, b: 1`, and a `boostDocument` that restores the **specificity** BM25 lacks: a record whose short title (60 chars or fewer) contains the matched term is lifted (sections 1.6x, document records 4x, because for those the title IS the document), and document records get a small nudge ahead of their own sections when they score comparably. Without it a long section that repeats "outbox" thirty times buried ADR-003 at position 24. The status line **echoes the parsed reading back** (`7 results · "soft delete" AND erasure`), which is the only documentation the operators get and the moment it is useful.
- **Highlighting uses `result.terms`**, the index terms that actually matched, not the typed query: each is anchored at a word start and allowed to run to the end of its word, so a prefix match lights up the whole word it matched. It runs on the already-escaped string, so a record can never inject markup.
- URLs in the index are root-absolute so a result works from any depth, including the 404 page; `LIB_URL` is root-absolute for the same reason.
- The a11y gate opens the dialog on `index.html` in both themes and re-runs axe against it. A dialog is `display:none` until opened, so without that step its contrast and labelling would never be checked.

### Design system

- **Type**: Inter Variable (text/UI) + JetBrains Mono (code, eyebrows, stat figures, tags). Both self-hosted: **the build copies the woff2 files out of the `@fontsource*` devDependencies into `assets/fonts/`**, the same way `mermaid.min.js` is vendored, so the site makes no third-party request. Latin subset only, and the `@font-face` `unicode-range` in `styles.css` is copied verbatim from fontsource: a glyph outside it (the `→`/`↗` arrows, the theme-toggle symbols) falls back to the system font instead of pulling a second file. The two above-the-fold faces are preloaded from `headAssetsHtml`. A missing package means no copy and no build failure: the stack degrades to the system fonts it already listed.
- **Tokens**: a type scale (`--step--2`..`--step-4`), a spacing scale (`--space-1`..`--space-9`), and the light/dark palettes. Prefer the scale tokens over new ad-hoc rem values.
- **The ink surface** (`.ink`): the band used for the home hero and one feature panel per page. Every value it sets comes from an `--ink-*` token, and **those flip with the theme** like everything else: a soft tinted band in light, the deep panel in dark. Re-pointing the base tokens (`--text`, `--surface`, `--accent`, ...) locally is what lets anything nested inside it stay legible with no second set of rules. The band must flip with the theme: the hero is the entire viewport on load, so a band that stays dark in light mode makes the toggle look broken. If you give `.ink` a new value, add it as an `--ink-*` token in both palettes rather than hardcoding it, and note that the print block has to neutralize the band separately because the print `:root` override does not reach those tokens.
- **Whole-card links**: `a.card` / `.meter-card` must stay in the `text-decoration: none` opt-out list near the top of `styles.css`. Without it, every line of body copy inside a card that is itself an anchor renders underlined.
- Accessibility is enforced, not assumed: any palette change has to survive `npm run a11y` in **both** themes before it lands.

`sitemap.xml` and `feed.xml` are **generated** by `tools/build-docs.mjs`, not hand-maintained. The sitemap covers every root page plus every generated document; `lastmod` comes from each source file's last git commit date, with anything uncommitted dated today. The feed lists the published articles from `articles.js`, pointing at Medium; its `lastBuildDate` is the newest article's publication instant, **not** the wall clock, so consecutive builds are byte-identical and the CI freshness gate is meaningful.

### 2. Generated reference library (`docs/` from `docs-src/`)

`docs-src/` holds the **canonical markdown** for the MMCA workspace documentation (centralized here 2026-07-20; the .NET repos link to it, they do not own copies):

- `docs-src/adr/`: Architecture Decision Records (`NNN-*.md`); its `README.md` is the source of truth for ADR count/range. Add or edit ADRs ONLY here.
- `docs-src/governance/`: evaluation rubric + repo-prefixed scorecards/backlogs (e.g. `store-ArchitectureScorecard.md`).
- `docs-src/guides/`: public-safe narrative docs (getting-started, specs, workflows).
- `docs-src/onboarding/`: the onboarding chapters, their ONLY home; the workspace `Tools/invtool` pipeline writes here directly. Underscore-prefixed files are working files and are skipped by the build.

`tools/build-docs.mjs` renders each markdown file into a full page in the site shell (sidebar, breadcrumb, canonical/OG meta) under `docs/`. **The generated HTML in `docs/` is committed: never hand-edit it; edit `docs-src/` and rebuild.** A docs-src edit is not done until the rebuild ran and both the source and regenerated output are committed together.

The generator also writes into **marked regions of the hand-authored root pages**, so derived content cannot drift from its source. Each region is delimited by `<!-- BEGIN name -->` / `<!-- END name -->`, and a missing marker fails the build rather than silently no-oping:

| Region | Page | Derived from |
|---|---|---|
| `head-assets`, `site-header`, `site-footer` | **all 7 root pages** | `NAV_ITEMS` / `FOOTER_LINKS` in the generator, which also stamp the 119 docs pages |
| `subscribe` | `writing.html`, `platform.html` | one `subscribeHtml()`, differing only in the input id |
| `articles`, `articles-jsonld`, `article-categories` | `writing.html` | `assets/data/articles.js` |
| `featured-articles` | `index.html` | the three most recently published entries in `assets/data/articles.js`, with their hero art |
| `package-layers` | `platform.html` | `packageLayers` in `assets/data/platform-facts.js` |
| `adr-list`, `adr-count` | `platform.html` | `docs-src/adr/*.md` + `assets/data/adr-cards.js` |
| `platform-stats` | `platform.html` | ADR count from `docs-src/adr/` + `assets/data/platform-facts.js` |
| `scorecards` | `platform.html` | the `**Maturity index**` / `**Implementation index**` lines in `docs-src/governance/*-ArchitectureScorecard.md` |
| `library-cards` | `platform.html` | the four `docs-src/` collection sizes |
| `home-stats` | `index.html` | ADR count + `assets/data/platform-facts.js` |
| `resume-platform-facts` | `resume.html` | ADR count + `assets/data/platform-facts.js` |

Never hand-edit inside a region: the next build overwrites it.

**A nav or footer change is one edit.** Change `NAV_ITEMS` or `FOOTER_LINKS` in `tools/build-docs.mjs` and rebuild; every page follows.

The build also **prunes**: any `.html` under `docs/` with no surviving markdown source is deleted, so a renamed or removed doc cannot leave a stale page committed and reachable.

Generator behaviors worth knowing before touching it or the markdown:

- **Heading slugs are GitHub-compatible and computed from the literal heading text**, so headings with C# generics like `PagedCollectionResult<T>` slug to `pagedcollectionresultt` and existing cross-links keep working. Do not "fix" angle brackets in headings.
- **Inline `<...>` that is not real HTML is escaped**, via the `REAL_HTML_TAGS` whitelist: `<br>`/`<a id=...>` etc. pass through, C# pseudo-tags like `<T>` or `<in TEntity>` render as visible text. If a doc needs a new HTML element, add it to the whitelist.
- **`.md` cross-links are rewritten to `.html`** within the library.
- **Mermaid**: ` ```mermaid ` fences become `<pre class="mermaid">` rendered client-side; `assets/js/mermaid.min.js` is vendored by the build (copied from the `mermaid` devDependency) and lazy-loaded only on pages that contain diagrams. Keep diagram labels free of curly braces. Diagrams run on the `base` theme with `themeVariables` pinned to the site tokens, because the stock mermaid themes ship a lavender/beige palette that reads as a foreign object dropped into the page.
- **Syntax highlighting happens at BUILD time** (highlight.js in the `code` renderer), so no highlighter ships to the reader: the output is plain `<span class="hljs-*">` markup coloured by `docs.css` from the site's own tokens, and the corner label comes from `data-lang`. A fence whose language highlight.js has no grammar for (`bicep`) keeps its label and renders as plain text rather than being mis-tokenized. Add a display name to `LANG_LABELS` when a new fence language appears.
- **On-this-page rail**: H2s are collected while rendering and become a third column (`.doc-layout--toc`) on documents with at least `TOC_MIN_HEADINGS` sections. It is the first thing dropped below 1180px, since the collection sidebar already answers "where am I". `main.js` only adds the active state.

## Conventions

- Never use accents, tildes, or em-dashes in prose or drafted content; use parentheses, colons, or plain characters. Avoid the words "seam" and "seams" (use boundary, extension point, pipeline, or layer instead). (Workspace-wide rule; applies to page copy and docs-src markdown.)
- This repo sits inside the MMCA workspace (`C:\Projects\MMCA\`) whose root CLAUDE.md governs cross-repo workflow; governance commands like `/update-adrs` and `/update-scorecard` land their edits here in `docs-src/`.

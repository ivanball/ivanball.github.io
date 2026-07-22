# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Personal website for Ivan Ball-llovera (published as `ivanball.github.io` via GitHub Pages), plus the **canonical documentation library for the whole MMCA workspace**. It is plain HTML/CSS/vanilla JS with **no build step for the site pages**; the only build tooling is the docs generator under `tools/`.

**Pushing to `main` publishes the live site immediately.** This repo is not PR-gated like the four .NET repos in the workspace; confirm with the user before pushing.

## Commands

```bash
# Serve locally (no build step; any static server works)
python -m http.server 8080

# Regenerate the reference library after ANY edit under docs-src/
cd tools && npm install && npm run build
```

There are no tests and no linter. The generator prints a summary line (pages written per collection, mermaid page count); check it after a build.

## The two content systems

### 1. Hand-authored pages (repo root)

`index.html`, `resume.html`, `platform.html`, `writing.html`, `speaking.html`, `contact.html`, `404.html`. There is no templating: the header/footer/nav markup is **duplicated across every page** (and separately inside `tools/build-docs.mjs` as `headerHtml`/`footerHtml`). A nav or footer change means editing all top-level pages AND the generator, then rebuilding `docs/`.

Single edit points:
- **Writing page cards**: `assets/data/articles.js` (`window.ARTICLES` + `ARTICLE_CATEGORIES`, rendered by `assets/js/writing.js`). An empty `url` renders a "Coming soon" card; paste the Medium URL to publish.
- **Published email**: `EMAIL_USER` / `EMAIL_DOMAIN` at the top of `assets/js/main.js` (assembled in JS to deter scraping).
- **Resume**: replace the PDF in `assets/files/` and edit `resume.html`.

`assets/js/main.js` is loaded with `defer` on every page: theme toggle (localStorage key `mmca-theme`; each page also has an inline head script that applies the stored theme before paint), mobile nav, footer year, doc sidebar. `assets/css/styles.css` is the single stylesheet (light + dark via `data-theme` on `<html>`); `assets/css/docs.css` layers doc-page prose/layout on top of it.

`sitemap.xml` is maintained by hand: bump the relevant `lastmod` when a page's content changes.

### 2. Generated reference library (`docs/` from `docs-src/`)

`docs-src/` holds the **canonical markdown** for the MMCA workspace documentation (centralized here 2026-07-20; the .NET repos link to it, they do not own copies):

- `docs-src/adr/`: Architecture Decision Records (`NNN-*.md`); its `README.md` is the source of truth for ADR count/range. Add or edit ADRs ONLY here.
- `docs-src/governance/`: evaluation rubric + repo-prefixed scorecards/backlogs (e.g. `store-ArchitectureScorecard.md`).
- `docs-src/guides/`: public-safe narrative docs (getting-started, specs, workflows).
- `docs-src/onboarding/`: the onboarding chapters, their ONLY home; the workspace `Tools/invtool` pipeline writes here directly. Underscore-prefixed files are working files and are skipped by the build.

`tools/build-docs.mjs` renders each markdown file into a full page in the site shell (sidebar, breadcrumb, canonical/OG meta) under `docs/`. **The generated HTML in `docs/` is committed: never hand-edit it; edit `docs-src/` and rebuild.** A docs-src edit is not done until the rebuild ran and both the source and regenerated output are committed together.

Generator behaviors worth knowing before touching it or the markdown:

- **Heading slugs are GitHub-compatible and computed from the literal heading text**, so headings with C# generics like `PagedCollectionResult<T>` slug to `pagedcollectionresultt` and existing cross-links keep working. Do not "fix" angle brackets in headings.
- **Inline `<...>` that is not real HTML is escaped**, via the `REAL_HTML_TAGS` whitelist: `<br>`/`<a id=...>` etc. pass through, C# pseudo-tags like `<T>` or `<in TEntity>` render as visible text. If a doc needs a new HTML element, add it to the whitelist.
- **`.md` cross-links are rewritten to `.html`** within the library.
- **Mermaid**: ` ```mermaid ` fences become `<pre class="mermaid">` rendered client-side; `assets/js/mermaid.min.js` is vendored by the build (copied from the `mermaid` devDependency) and lazy-loaded only on pages that contain diagrams. Keep diagram labels free of curly braces.

## Conventions

- Never use accents, tildes, or em-dashes in prose or drafted content; use parentheses, colons, or plain characters. Avoid the words "seam" and "seams" (use boundary, extension point, pipeline, or layer instead). (Workspace-wide rule; applies to page copy and docs-src markdown.)
- This repo sits inside the MMCA workspace (`C:\Projects\MMCA\`) whose root CLAUDE.md governs cross-repo workflow; governance commands like `/update-adrs` and `/update-scorecard` land their edits here in `docs-src/`.

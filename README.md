# ivanball.github.io

Personal website for Ivan Ball-llovera, Senior Software Architect, and the canonical
documentation library for the MMCA workspace. A fast, accessible static site: plain HTML,
CSS, and vanilla JS, with no build step for the site pages.

Live at <https://ivanball.github.io/>. **Pushing to `main` publishes immediately.**

> Working on this repo with Claude Code? `CLAUDE.md` is the detailed guide (marked-region
> table, generator behaviors, single edit points). This README is the short version.

## Run locally

No build step for the pages themselves. Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8080
```

## Structure

```
index.html        Home / About
resume.html       Experience, skills, certifications, education (+ PDF download)
platform.html     The MMCA platform showcase
writing.html      Article cards (summary + "Read on Medium")
speaking.html     Speaking & community
contact.html      Contact (email, LinkedIn, GitHub)
404.html
docs-src/         Canonical markdown for the whole MMCA workspace (edit here)
  adr/                Architecture Decision Records; its README.md owns the count/range
  governance/         Evaluation rubric + per-repo scorecards and backlogs
  guides/             Public-safe narrative docs
  onboarding/         Onboarding chapters (written by the workspace Tools/invtool pipeline)
docs/             Generated HTML for everything in docs-src/ (committed; never hand-edit)
assets/
  css/styles.css     Single stylesheet (light + dark, responsive)
  css/docs.css       Reference-library prose + layout (layers on styles.css)
  js/main.js         Theme toggle, mobile nav, email de-obfuscation, footer year, doc sidebar
  js/analytics.js    GA4 measurement ID + newsletter form action (the single edit point)
  js/writing.js      Filters the generated article cards in place
  js/mermaid.min.js  Vendored by the build; lazy-loaded only on pages with diagrams
  data/articles.js   window.ARTICLES  (the single edit point for the Writing page)
  data/adr-cards.js  window.ADR_CARDS (optional better copy per ADR number)
tools/            build-docs.mjs generator (Node; not served)
sitemap.xml  feed.xml  robots.txt  .nojekyll   (the first two are generated)
```

## The generator

`tools/build-docs.mjs` does three jobs. Run it after **any** edit under `docs-src/` or to
`assets/data/*.js`:

```bash
cd tools && npm install && npm run build
```

1. **Renders `docs-src/**/*.md` into `docs/`**, each page wrapped in the site shell with a
   collection sidebar, breadcrumb, canonical/OG meta, GitHub-compatible heading anchors,
   `.md` -> `.html` cross-link rewriting, and mermaid diagrams.
2. **Writes derived content into marked regions of the hand-authored root pages**
   (`<!-- BEGIN name -->` / `<!-- END name -->`), so the article cards, ADR list, ADR
   counts, scorecard indices, and library-collection sizes cannot drift from their
   sources. A missing marker fails the build rather than silently no-opping. Never
   hand-edit inside a region.
3. **Generates `sitemap.xml` and `feed.xml`.** Neither is hand-maintained.

The generated HTML under `docs/` is committed, so readers need no runtime JS to read a
doc. A `docs-src/` edit is not done until the rebuild has run and the source plus the
regenerated output are committed together.

Check the summary the build prints: pages written per collection, mermaid page count,
article and ADR card counts, feed and sitemap sizes, and any dead cross-links.

## Editing content

- **Article card:** edit `assets/data/articles.js`, then rebuild. Set `url` once a piece is
  live on Medium; an empty `url` renders a "Coming soon" card. The cards are static markup
  emitted by the build, so editing the data file alone is not enough.
- **ADR:** add or edit it in `docs-src/adr/` only, then rebuild. It appears on the platform
  page and in the counts automatically.
- **Published email:** `EMAIL_USER` / `EMAIL_DOMAIN` at the top of `assets/js/main.js`.
- **Analytics / newsletter:** `assets/js/analytics.js`. Both self-gate, so an unset value
  simply stays off.
- **Resume:** replace the PDF in `assets/files/` and edit `resume.html`.

## Conventions

No accents, tildes, or em-dashes in prose; use parentheses, colons, or plain characters.
Avoid the words "seam" and "seams" (prefer boundary, extension point, pipeline, or layer).
This is a workspace-wide rule and applies to page copy and `docs-src/` markdown alike.

## Deploy

GitHub Pages serves the `main` branch root. `.nojekyll` bypasses Jekyll. No custom domain
today; one can be added later via a `CNAME` file.

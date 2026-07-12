# ivanball.github.io

Personal website for Ivan Ball-llovera, Senior Software Architect. A fast, accessible, static
site (plain HTML, CSS, and vanilla JS, no build step) that brings together the resume, the
open-source MMCA platform, the writing series, and speaking/community work.

## Run locally

There is no build step. Open `index.html` directly in a browser, or serve the folder with any
static server, for example:

```bash
# Python
python -m http.server 8080
# or .NET
dotnet tool install -g dotnet-serve && dotnet serve -d .
```

Then browse to the printed URL.

## Structure

```
index.html        Home / About
resume.html       Experience, skills, certifications, education (+ PDF download)
platform.html     The MMCA platform showcase
writing.html      Article cards (summary + "Read on Medium")
speaking.html     Speaking & community
contact.html      Contact (email, LinkedIn, GitHub)
404.html
docs/             Reference library (generated: see below)
  index.html          Reference-library hub
  adr/                Every Architecture Decision Record, rendered
  onboarding/         The full onboarding guide, rendered
assets/
  css/styles.css  Single stylesheet (light + dark, responsive)
  css/docs.css    Reference-library prose + layout (layers on styles.css)
  js/main.js      Theme toggle, mobile nav, email de-obfuscation, footer year, doc sidebar
  js/writing.js   Renders article cards from data
  js/mermaid.min.js  Vendored; lazy-loaded only on pages with diagrams
  data/articles.js  window.ARTICLES = [...]  (the single edit point for the Writing page)
  data/talks.js     window.TALKS = [...]
  img/ files/
tools/            build-docs.mjs generator (Node; not served)
sitemap.xml  robots.txt  .nojekyll
```

## Reference library (`docs/`)

The pages under `docs/` are **generated** from the MMCA source repositories, not hand-edited:

- ADRs from `../MMCA.Common/ADRs/*.md`
- The onboarding guide from `../Docs/Onboarding/*.md` (underscore-prefixed working files are skipped)

`tools/build-docs.mjs` renders each Markdown file into a page wrapped in the site shell
(header/footer/theme), with a collection sidebar, breadcrumb, cross-link rewriting (`.md` → `.html`),
GitHub-compatible heading anchors, and diagram rendering. Regenerate after the source docs change:

```bash
cd tools && npm install && npm run build
```

The generated HTML is committed (readers need no runtime JS to read a doc); `tools/node_modules`
is not. Do not hand-edit files under `docs/` — re-run the generator instead.

## Editing content

- **Add or update an article card:** edit `assets/data/articles.js`. Set the `url` field once an
  article is live on Medium; an empty `url` renders a "Coming soon" state.
- **Change the published email:** edit `EMAIL_USER` / `EMAIL_DOMAIN` at the top of
  `assets/js/main.js`.
- **Update the resume:** replace `assets/files/Ivan-Ball-llovera-Resume-2026.pdf` and edit
  `resume.html`.

## Deploy (GitHub Pages)

Pushed to the `ivanball.github.io` repository and served from the `main` branch root. A custom
domain can be added later via a `CNAME` file.

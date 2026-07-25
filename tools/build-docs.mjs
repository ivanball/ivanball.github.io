/*
 * build-docs.mjs: render the MMCA documentation library into static HTML
 * pages that live natively inside this site (same header/footer/theme).
 *
 * Sources (canonical markdown, committed in THIS repo under ../docs-src/):
 *   - ../docs-src/adr/*.md               (Architecture Decision Records)
 *   - ../docs-src/onboarding/*.md        (the onboarding guide; underscore-prefixed
 *                                         working files are excluded)
 *   - ../docs-src/governance/*.md        (rubric + per-repo scorecards/backlogs)
 *   - ../docs-src/guides/*.md            (getting-started, specs, workflows, notes)
 *
 * Output (committed):
 *   - ../docs/index.html                 Reference-library hub
 *   - ../docs/adr/index.html + adr/*.html
 *   - ../docs/onboarding/index.html + onboarding/*.html
 *   - ../docs/governance/index.html + governance/*.html
 *   - ../docs/guides/index.html + guides/*.html
 *
 * Re-run whenever the source docs change:  npm install && npm run build
 * No runtime JS dependency ships to readers: everything is pre-rendered.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import path from "node:path";
import { Marked } from "marked";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(HERE, "..");
const DOCS_SRC = path.join(WEBSITE_ROOT, "docs-src");
const ADR_SRC = path.join(DOCS_SRC, "adr");
const ONB_SRC = path.join(DOCS_SRC, "onboarding");
const GOV_SRC = path.join(DOCS_SRC, "governance");
const GUIDES_SRC = path.join(DOCS_SRC, "guides");
const SITE = "https://ivanball.github.io";
const SRC_GITHUB = "https://github.com/ivanball/ivanball.github.io/blob/main/docs-src/";
const MEDIUM_PROFILE = "https://medium.com/@ivanball76";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

/* The seven hand-authored pages at the repo root. The generator does not own them, but it does own
   three things inside them: the marked regions below, the sitemap entry, and (for writing.html and
   platform.html) content derived from data files rather than typed by hand. */
const ROOT_PAGES = [
  { file: "index.html", priority: "1.0", loc: `${SITE}/` },
  { file: "resume.html", priority: "0.9" },
  { file: "platform.html", priority: "0.9" },
  { file: "writing.html", priority: "0.9" },
  { file: "speaking.html", priority: "0.7" },
  { file: "contact.html", priority: "0.6" },
];

/* ----- small helpers ----- */
const norm = (p) => path.resolve(p).toLowerCase();
const toPosix = (p) => p.split(path.sep).join("/");
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(s) { return escapeHtml(s); }

/* GitHub-compatible heading slug computed from the LITERAL heading text.
   These docs write C# generics as literal `Type<T>` in headings and cross-link
   to them with GitHub-style slugs (e.g. `PagedCollectionResult<T>` ->
   `pagedcollectionresultt`), so slug the raw text, do NOT let angle brackets be
   parsed away as HTML first. Consecutive spaces (left behind by stripped
   punctuation) each become a hyphen, matching GitHub. */
function ghSlug(raw) {
  return String(raw)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // [text](url) -> text
    .replace(/[`*]/g, "")                        // code / bold / italic markers
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")                    // drop punctuation incl < > ( ) : , ; keep _ - space
    .trim()
    .replace(/\s/g, "-");
}

/* Real inline/block HTML the source uses deliberately (manual `<a id>` anchors,
   `<br>` in table cells, emphasis) must pass through; a C# generic that merely
   looks like a tag (`<T>`, `<in TEntity>`, `<out TRequest>`) must be escaped so
   it renders visibly and does not vanish as an unknown element. */
const REAL_HTML_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "code", "del", "details", "div", "em",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "mark",
  "ol", "p", "pre", "s", "small", "span", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "th", "thead", "tr", "u", "ul",
]);
function isRealHtml(text) {
  const m = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(String(text).trim());
  return !!m && REAL_HTML_TAGS.has(m[1].toLowerCase());
}

/* First H1 as the document title. */
function firstHeading(md) {
  const m = md.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].replace(/[`*_]/g, "").trim() : null;
}
/* First real paragraph, flattened + truncated, for the meta description. */
function metaDescription(md) {
  const lines = md.split(/\r?\n/);
  let started = false, buf = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!started) {
      if (line.startsWith("#") || line === "" || line.startsWith(">") || line.startsWith("|") || line.startsWith("```")) continue;
      started = true;
    }
    if (line === "" || line.startsWith("#") || line.startsWith("|") || line.startsWith("```")) break;
    buf.push(line);
  }
  let text = buf.join(" ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // links -> text
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 155) text = text.slice(0, 152).replace(/\s+\S*$/, "") + "…";
  return text;
}

/* ----- data files (hand-maintained, read at build time) -----
   assets/data/*.js assign onto `window` so the browser can load them directly with a <script> tag.
   Evaluating them in a VM sandbox with a fake `window` lets the build read exactly the same data
   the page reads, with no duplicate copy to drift. */
function loadWindowData(relPath) {
  const src = readFileSync(path.join(WEBSITE_ROOT, relPath), "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: relPath });
  return sandbox.window;
}
const { ARTICLES = [], ARTICLE_CATEGORIES = [] } = loadWindowData("assets/data/articles.js");
const { ADR_CARDS = {} } = loadWindowData("assets/data/adr-cards.js");

/* Replace the content between `<!-- BEGIN name -->` and `<!-- END name -->`. Throws rather than
   silently no-oping, because a missing marker means the page quietly stops being regenerated. */
function replaceRegion(html, name, content, file) {
  const re = new RegExp(`([ \\t]*<!-- BEGIN ${name} -->\\r?\\n)[\\s\\S]*?([ \\t]*<!-- END ${name} -->)`);
  if (!re.test(html)) {
    throw new Error(`${file}: missing region markers for "${name}" (<!-- BEGIN ${name} --> ... <!-- END ${name} -->)`);
  }
  return html.replace(re, (_m, open, close) => `${open}${content}\n${close}`);
}

/* Last commit date per repo-relative path, in one git call. Used for sitemap <lastmod>: file mtimes
   are useless here because a fresh clone stamps every file with the checkout time. Anything with
   uncommitted changes is dated today, since that is what is about to be published. */
function gitDates() {
  const dates = new Map();
  const dirty = new Set();
  try {
    const log = execFileSync("git", ["log", "--name-only", "--no-renames", "--pretty=format:%cs"],
      { cwd: WEBSITE_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let current = null;
    for (const line of log.split(/\r?\n/)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(line)) { current = line; continue; }
      if (!line.trim() || !current) { continue; }
      if (!dates.has(line)) { dates.set(line, current); }   // log is newest-first
    }
    const status = execFileSync("git", ["status", "--porcelain"],
      { cwd: WEBSITE_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    for (const line of status.split(/\r?\n/)) {
      const p = line.slice(3).trim();
      if (p) { dirty.add(p.replace(/^"|"$/g, "")); }
    }
  } catch {
    /* not a git checkout: every lastmod falls back to the build date */
  }
  return {
    for(relPath) {
      const p = toPosix(relPath);
      if (dirty.has(p)) { return BUILD_DATE; }
      return dates.get(p) || BUILD_DATE;
    },
  };
}

/* ----- collections ----- */
const adrFiles = readdirSync(ADR_SRC)
  .filter((f) => /^\d{3}-.*\.md$/.test(f))
  .sort();
const onbFiles = readdirSync(ONB_SRC)
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"));
const govFiles = readdirSync(GOV_SRC)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort();
const guideFiles = readdirSync(GUIDES_SRC)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort();

const collections = [
  {
    id: "adr",
    outDir: "docs/adr",
    srcDir: ADR_SRC,
    kicker: "Architecture Decision Record",
    title: "Architecture Decision Records",
    navTitle: `All ${adrFiles.length} ADRs`,
    indexSrc: "README.md",
    files: ["README.md", ...adrFiles],
    github: `${SRC_GITHUB}adr/`,
  },
  {
    id: "onboarding",
    outDir: "docs/onboarding",
    srcDir: ONB_SRC,
    kicker: "Onboarding guide",
    title: "Onboarding Guide",
    navTitle: "Guide contents",
    indexSrc: "00-index.md",
    files: onbFiles,
    github: null,
  },
  {
    id: "governance",
    outDir: "docs/governance",
    srcDir: GOV_SRC,
    kicker: "Architecture governance",
    title: "Architecture Governance",
    navTitle: "Rubric, scorecards & backlogs",
    indexSrc: "README.md",
    files: ["README.md", ...govFiles],
    github: `${SRC_GITHUB}governance/`,
  },
  {
    id: "guides",
    outDir: "docs/guides",
    srcDir: GUIDES_SRC,
    kicker: "Guides & specifications",
    title: "Guides & Specifications",
    navTitle: "All guides",
    indexSrc: "README.md",
    files: ["README.md", ...guideFiles],
    github: `${SRC_GITHUB}guides/`,
  },
];

/* Output filename for a source file within a collection. */
function outName(col, file) {
  if (file === col.indexSrc) return "index.html";
  return file.replace(/\.md$/i, ".html");
}

/* Ordering rank for the onboarding sidebar. */
function onbRank(file) {
  if (file === "00-index.md") return [0, ""];
  if (/^00-/.test(file)) return [1, file];
  const g = file.match(/^group-(\d+)-/);
  if (g) return [2, String(g[1]).padStart(3, "0")];
  if (/^devops-/.test(file)) return [3, file];
  if (/^99-/.test(file)) return [4, file];
  return [5, file];
}

/* Concise sidebar label per file. */
function navLabel(col, file, title) {
  if (col.id === "adr") {
    const n = file.slice(0, 3);
    const t = title.replace(/^ADR[-\s]?\d+:\s*/i, "").trim();
    return `${n} · ${t}`;
  }
  const g = file.match(/^group-(\d+)-/);
  if (g) {
    const t = title.replace(/^Group\s+\d+[.:]?\s*/i, "").replace(/^\d+\.\s*/, "").trim();
    return `${parseInt(g[1], 10)}. ${t}`;
  }
  if (col.id === "governance" || col.id === "guides") {
    const repo = file.match(/^(common|store|adc)-/);
    if (repo) {
      const name = { common: "Common", store: "Store", adc: "ADC" }[repo[1]];
      const t = title
        .replace(/^MMCA[\w.]*\s*[—–-]\s*/i, "")     // "MMCA.Common.UI — X" -> "X"
        .replace(/^ADC\s*\([^)]*\)\s*[—–-]\s*/i, "") // "ADC (Atlanta ...) - X" -> "X"
        .replace(/^MMCA\s+/i, "")                    // "MMCA Business ..." -> "Business ..."
        .trim();
      return `${name} · ${t || title}`;
    }
  }
  return title;
}

/* ----- build the global manifest (absolute src path -> website-relative out path) + metadata ----- */
const manifest = new Map();     // norm(absPath) -> "docs/adr/001-....html"
const docsMeta = [];            // { col, file, absSrc, outRel, title, label, desc, md }

for (const col of collections) {
  for (const file of col.files) {
    const absSrc = path.join(col.srcDir, file);
    const md = readFileSync(absSrc, "utf8");
    const title = firstHeading(md) || file.replace(/\.md$/i, "");
    const outRel = `${col.outDir}/${outName(col, file)}`;
    const isIndex = file === col.indexSrc;
    const label = isIndex ? "Overview" : navLabel(col, file, title);
    manifest.set(norm(absSrc), outRel);
    docsMeta.push({ col, file, absSrc, outRel, title, label, desc: metaDescription(md), md });
  }
}
// sort onboarding docs into reading order; ADRs are already numeric
for (const col of collections) {
  if (col.id === "onboarding") {
    col.docs = docsMeta.filter((d) => d.col === col)
      .sort((a, b) => {
        const [ra, sa] = onbRank(a.file), [rb, sb] = onbRank(b.file);
        return ra - rb || sa.localeCompare(sb);
      });
  } else {
    col.docs = docsMeta.filter((d) => d.col === col)
      .sort((a, b) => (a.file === col.indexSrc ? -1 : b.file === col.indexSrc ? 1 : a.file.localeCompare(b.file)));
  }
}

/* ----- markdown rendering with link rewriting + mermaid + code ----- */
let CTX = null; // { srcDir, outRel, hasMermaid }

function rewriteHref(href) {
  if (!href) return href;
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(href)) return href;      // external / anchor / absolute
  const hash = href.indexOf("#");
  const rawPath = hash === -1 ? href : href.slice(0, hash);
  const anchor = hash === -1 ? "" : href.slice(hash);
  if (!rawPath) return href;
  if (!/\.md$/i.test(rawPath)) return href;                          // non-markdown relative link: leave
  const absTarget = path.resolve(CTX.srcDir, rawPath);
  const target = manifest.get(norm(absTarget));
  if (!target) return null;                                          // outside the published set -> drop link
  let rel = toPosix(path.relative(path.dirname(CTX.outRel), target));
  if (!rel) rel = path.basename(target);
  return rel + anchor;
}

function makeRenderer(slugCounts) {
  function uniqueId(raw) {
    let base = ghSlug(raw) || "section";
    const n = slugCounts.get(base) || 0;
    slugCounts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  }
  return {
    heading({ tokens, depth, text }) {
      const id = uniqueId(text);
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${escapeAttr(id)}">${inner}</h${depth}>\n`;
    },
    html({ text }) {
      return isRealHtml(text) ? text : escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const nh = rewriteHref(href);
      if (nh === null) return `<span class="doc-deadlink" title="Reference outside the published set">${text}</span>`;
      const ext = /^https?:/i.test(nh);
      const t = title ? ` title="${escapeAttr(title)}"` : "";
      const attrs = ext ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${escapeAttr(nh)}"${t}${attrs}>${text}</a>`;
    },
    code({ text, lang }) {
      const language = (lang || "").trim().split(/\s+/)[0].toLowerCase();
      if (language === "mermaid") {
        CTX.hasMermaid = true;
        return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
      }
      const cls = language ? ` class="language-${escapeAttr(language)}"` : "";
      return `<pre class="doc-pre"><code${cls}>${escapeHtml(text)}</code></pre>\n`;
    },
  };
}

function renderMarkdown(md, ctx) {
  CTX = ctx;
  const slugCounts = new Map();   // per-doc, GitHub-style dedup
  const m = new Marked({ gfm: true, breaks: false });
  m.use({ renderer: makeRenderer(slugCounts) });
  let html = m.parse(md);
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
  return html;
}

/* ----- page shell ----- */
/* Kept byte-identical to the nav in the seven hand-authored root pages: there is no templating in
   this repo, so a nav change means editing those pages AND this list, then rebuilding. */
const NAV_ITEMS = [
  ["index.html", "Home"],
  ["resume.html", "Résumé"],
  ["platform.html", "Platform"],
  ["docs/index.html", "Reference"],
  ["writing.html", "Writing"],
  ["speaking.html", "Speaking"],
  ["contact.html", "Contact"],
];

function assetPrefix(outRel) {
  const depth = outRel.split("/").length - 1; // dir segments
  return "../".repeat(depth);
}

function headerHtml(prefix) {
  const links = NAV_ITEMS.map(([href, label]) => {
    /* every page this generator emits lives under docs/, so Reference is the current section */
    const cur = href === "docs/index.html" ? ' aria-current="page"' : "";
    return `          <li><a href="${prefix}${href}"${cur}>${label}</a></li>`;
  }).join("\n");
  return `  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="${prefix}index.html">
        <span class="brand-mark" aria-hidden="true">IB</span>
        <span>Ivan Ball-llovera</span>
      </a>
      <nav aria-label="Primary">
        <ul class="nav-links" id="nav-links">
${links}
        </ul>
      </nav>
      <div class="nav-tools">
        <button class="icon-btn theme-toggle" type="button" aria-label="Switch color theme">
          <span class="sun" aria-hidden="true">☀</span><span class="moon" aria-hidden="true">☾</span>
        </button>
        <button class="icon-btn nav-toggle" type="button" aria-label="Toggle navigation menu" aria-expanded="false" aria-controls="nav-links">☰</button>
      </div>
    </div>
  </header>`;
}

function footerHtml(prefix) {
  return `  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <p class="footer-meta mb-0"><strong>Ivan Ball-llovera</strong> · Senior Software Architect · Douglasville, GA</p>
        <ul class="footer-links">
          <li><a href="${prefix}resume.html">Résumé</a></li>
          <li><a href="${prefix}platform.html">Platform</a></li>
          <li><a href="${prefix}docs/index.html">Reference</a></li>
          <li><a href="${prefix}writing.html">Writing</a></li>
          <li><a href="https://github.com/ivanball" target="_blank" rel="me noopener">GitHub</a></li>
          <li><a href="https://www.linkedin.com/in/ivan-ball-llovera-6549a911" target="_blank" rel="me noopener">LinkedIn</a></li>
        </ul>
      </div>
      <p class="footer-meta" style="margin-top:1rem">© <span class="js-year">2026</span> Ivan Ball-llovera. Reference docs generated from source.</p>
    </div>
  </footer>`;
}

function mermaidHtml(prefix) {
  return `  <script defer src="${prefix}assets/js/mermaid.min.js"></script>
  <script>
    window.addEventListener("load", function () {
      if (!window.mermaid) { return; }
      var root = document.documentElement;
      var dark = root.getAttribute("data-theme") === "dark" ||
        (!root.getAttribute("data-theme") && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      try {
        // Diagrams are static, first-party content, so "loose" is safe here and
        // lets the flowchart labels keep their <br/> / <i> formatting.
        window.mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: dark ? "dark" : "default" });
        window.mermaid.run({ querySelector: "pre.mermaid" });
      } catch (e) { /* leave the diagram source visible on failure */ }
    });
  </script>`;
}

function page({ outRel, title, description, contentHtml, hasMermaid, jsonLd }) {
  const prefix = assetPrefix(outRel);
  const canonical = `${SITE}/${outRel}`;
  const fullTitle = `${title} · MMCA · Ivan Ball-llovera`;
  const ld = jsonLd
    ? `\n  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <link rel="icon" href="${prefix}assets/img/favicon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="Ivan Ball-llovera: deep dives on enterprise .NET" href="${SITE}/feed.xml">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Ivan Ball-llovera">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta property="og:image" content="${SITE}/assets/img/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(title)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <meta name="twitter:image" content="${SITE}/assets/img/og-image.png">${ld}
  <script>(function(){try{var t=localStorage.getItem('mmca-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <link rel="stylesheet" href="${prefix}assets/css/styles.css">
  <link rel="stylesheet" href="${prefix}assets/css/docs.css">
  <script defer src="${prefix}assets/js/main.js"></script>
  <script defer src="${prefix}assets/js/analytics.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>

${headerHtml(prefix)}

  <main id="main">
${contentHtml}
  </main>

${footerHtml(prefix)}
${hasMermaid ? mermaidHtml(prefix) : ""}
</body>
</html>
`;
}

/* Sidebar + breadcrumb for a doc within a collection. */
function sidebarHtml(col, currentOutRel) {
  const prefix = assetPrefix(currentOutRel);
  const items = col.docs.map((d) => {
    const rel = toPosix(path.relative(path.dirname(currentOutRel), d.outRel));
    const current = d.outRel === currentOutRel ? ' aria-current="page"' : "";
    return `        <li><a href="${escapeAttr(rel)}"${current}>${escapeHtml(d.label)}</a></li>`;
  }).join("\n");
  return `      <aside class="doc-sidebar">
      <details class="doc-sidebar-details" open>
        <summary>${escapeHtml(col.navTitle)}</summary>
        <nav class="doc-nav" aria-label="${escapeHtml(col.title)}">
          <ol>
${items}
          </ol>
        </nav>
      </details>
    </aside>`;
}

/* Machine-readable twin of breadcrumbHtml below: the visual trail has existed for a while with no
   markup behind it, so search results could not show the hierarchy. */
function breadcrumbJsonLd(col, currentLabel, outRel) {
  const crumbs = [
    ["Platform", `${SITE}/platform.html`],
    ["Reference", `${SITE}/docs/index.html`],
    [col.title, `${SITE}/${col.outDir}/index.html`],
    [currentLabel, `${SITE}/${outRel}`],
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map(([name, item], i) => ({
      "@type": "ListItem", position: i + 1, name, item,
    })),
  };
}

function breadcrumbHtml(col, prefix, currentLabel) {
  return `      <nav class="doc-breadcrumb" aria-label="Breadcrumb">
        <a href="${prefix}platform.html">Platform</a>
        <span aria-hidden="true">/</span>
        <a href="${prefix}docs/index.html">Reference</a>
        <span aria-hidden="true">/</span>
        <a href="${prefix}${col.outDir}/index.html">${escapeHtml(col.title)}</a>
        <span aria-hidden="true">/</span>
        <span class="current">${escapeHtml(currentLabel)}</span>
      </nav>`;
}

function docFootHtml(col, doc) {
  const prefix = assetPrefix(doc.outRel);
  const parts = [`<a class="btn btn--ghost" href="${prefix}${col.outDir}/index.html">← Back to ${escapeHtml(col.title)}</a>`];
  if (col.github) {
    parts.push(`<a class="btn btn--ghost" href="${col.github}${doc.file}" target="_blank" rel="noopener">View source on GitHub ↗</a>`);
  }
  return `        <div class="doc-foot btn-row">
          ${parts.join("\n          ")}
        </div>`;
}

/* ----- write the per-document pages ----- */
mkdirSync(path.join(WEBSITE_ROOT, "docs", "adr"), { recursive: true });
mkdirSync(path.join(WEBSITE_ROOT, "docs", "onboarding"), { recursive: true });
mkdirSync(path.join(WEBSITE_ROOT, "docs", "governance"), { recursive: true });
mkdirSync(path.join(WEBSITE_ROOT, "docs", "guides"), { recursive: true });

let written = 0, mermaidPages = 0;
for (const col of collections) {
  for (const doc of col.docs) {
    const ctx = { srcDir: col.srcDir, outRel: doc.outRel, hasMermaid: false };
    const body = renderMarkdown(doc.md, ctx);
    if (ctx.hasMermaid) mermaidPages++;
    const isIndex = doc.file === col.indexSrc;
    const currentLabel = isIndex ? "Overview" : doc.label;
    const prefix = assetPrefix(doc.outRel);
    const content =
`    <div class="container doc-container">
${breadcrumbHtml(col, prefix, currentLabel)}
      <div class="doc-layout">
${sidebarHtml(col, doc.outRel)}
        <article class="doc-content">
          <p class="eyebrow doc-kicker">${escapeHtml(col.kicker)}</p>
${body.split("\n").map((l) => "          " + l).join("\n")}
${docFootHtml(col, doc)}
        </article>
      </div>
    </div>`;
    const html = page({
      outRel: doc.outRel,
      title: doc.title,
      description: doc.desc || `${col.title}: ${doc.title}.`,
      contentHtml: content,
      hasMermaid: ctx.hasMermaid,
      jsonLd: breadcrumbJsonLd(col, currentLabel, doc.outRel),
    });
    writeFileSync(path.join(WEBSITE_ROOT, doc.outRel), html);
    written++;
  }
}

/* ----- the Reference-library hub (docs/index.html) ----- */
{
  const outRel = "docs/index.html";
  const prefix = assetPrefix(outRel);
  const onb = collections.find((c) => c.id === "onboarding");
  const onbContent = onb.docs.length - 1; // exclude the index page itself
  const content =
`    <section class="section">
      <div class="container">
        <div class="section-head">
          <p class="eyebrow">Platform · Reference library</p>
          <h1 style="margin:0 0 0.75rem">Reference library</h1>
          <p style="font-size:1.12rem;max-width:70ch">The architecture documentation behind the MMCA platform, published from its canonical home in this site's repository. Every Architecture Decision Record, the governance scorecards, the guides, and the complete onboarding guide, rendered as browsable pages, evidence and trade-offs included.</p>
          <div class="btn-row" style="margin-top:1.25rem">
            <a class="btn btn--ghost" href="${prefix}platform.html">← Back to the platform overview</a>
          </div>
        </div>
        <div class="grid grid--2">
          <a class="card card--link" href="adr/index.html">
            <span class="kicker" style="color:var(--accent)">${adrFiles.length} records</span>
            <h2 style="margin:.35rem 0 .5rem">Architecture Decision Records</h2>
            <p class="mb-0">The context, decision, rationale, and trade-offs behind every cross-cutting pattern, from manual DTO mapping and the outbox to JWKS auth, caching, and supply-chain provenance. Numbered, dated, and cross-linked.</p>
            <div class="card-foot" style="margin-top:1rem"><span class="doc-cta">Browse the ADRs →</span></div>
          </a>
          <a class="card card--link" href="onboarding/index.html">
            <span class="kicker" style="color:var(--accent)">${onbContent} documents</span>
            <h2 style="margin:.35rem 0 .5rem">Onboarding Guide</h2>
            <p class="mb-0">A teaching guide for an engineer new to the codebase: a primer, a mechanically extracted type inventory, ${onbFiles.filter((f) => /^group-\d/.test(f)).length} group chapters walking every first-party type, five DevOps chapters, concept maps, and a coverage audit.</p>
            <div class="card-foot" style="margin-top:1rem"><span class="doc-cta">Open the guide →</span></div>
          </a>
          <a class="card card--link" href="governance/index.html">
            <span class="kicker" style="color:var(--accent)">${govFiles.length} artifacts</span>
            <h2 style="margin:.35rem 0 .5rem">Architecture Governance</h2>
            <p class="mb-0">The 34-category evaluation rubric, plus an evidence-based scorecard and remediation backlog for each repo (framework, e-commerce, conference). Every score cites the code that earns it.</p>
            <div class="card-foot" style="margin-top:1rem"><span class="doc-cta">Read the scorecards →</span></div>
          </a>
          <a class="card card--link" href="guides/index.html">
            <span class="kicker" style="color:var(--accent)">${guideFiles.length} guides</span>
            <h2 style="margin:.35rem 0 .5rem">Guides & Specifications</h2>
            <p class="mb-0">The narrative layer: the getting-started guide for adopting the framework, business specifications and workflow analyses for both applications, and per-concern notes on accessibility, resilience, responsiveness, versioning, and cost.</p>
            <div class="card-foot" style="margin-top:1rem"><span class="doc-cta">Browse the guides →</span></div>
          </a>
        </div>
      </div>
    </section>`;
  const html = page({
    outRel,
    title: "Reference library",
    description: "The full MMCA platform documentation: every Architecture Decision Record and the complete onboarding guide, rendered from source.",
    contentHtml: content,
    hasMermaid: false,
  });
  writeFileSync(path.join(WEBSITE_ROOT, outRel), html);
  written++;
}

/* ----- vendor mermaid (only referenced by pages that contain diagrams) ----- */
const mermaidSrc = path.join(HERE, "node_modules", "mermaid", "dist", "mermaid.min.js");
const mermaidDst = path.join(WEBSITE_ROOT, "assets", "js", "mermaid.min.js");
if (existsSync(mermaidSrc)) {
  copyFileSync(mermaidSrc, mermaidDst);
}

/* ============================================================================
   Root-page generation: writing.html cards, the platform ADR list, feed.xml,
   sitemap.xml.

   These live in hand-authored pages, but their CONTENT is derived, so it is
   generated into marked regions rather than typed. The writing page in
   particular used to render entirely client-side, which meant crawlers saw one
   <noscript> paragraph instead of the article index.
   ============================================================================ */

const adrByNum = new Map(adrFiles.map((f) => [f.slice(0, 3), f]));
const catLabels = new Map(ARTICLE_CATEGORIES.map((c) => [c.key, c.label]));
const publishedArticles = ARTICLES.filter((a) => a.url).sort((a, b) => b.n - a.n);

/* "ADR 006/007/008" -> ["006", "007", "008"] */
function adrNumbers(adr) {
  const m = /^ADR\s+([\d/\s]+)$/.exec(String(adr || "").trim());
  return m ? m[1].split("/").map((s) => s.trim()).filter(Boolean) : [];
}
function adrHref(num, prefix = "") {
  const f = adrByNum.get(String(num).padStart(3, "0"));
  return f ? `${prefix}docs/adr/${f.replace(/\.md$/i, ".html")}` : null;
}

/* Same markup assets/js/writing.js used to build at runtime, with two additions: the ADR reference
   becomes a real link into the published record (internal link equity the client-rendered version
   could never contribute), and the category rides a data attribute so filtering can hide and show
   these nodes instead of replacing them. */
function articleCardHtml(a) {
  const thumb = a.hero
    ? `<img src="${escapeAttr(a.hero)}" alt="" loading="lazy">`
    : `<span class="thumb-num" aria-hidden="true">${a.n}</span>`;
  const tags = adrNumbers(a.adr).map((n) => {
    const href = adrHref(n);
    const label = `ADR ${n}`;
    return href
      ? `<li class="tag tag--accent"><a href="${escapeAttr(href)}">${escapeHtml(label)}</a></li>`
      : `<li class="tag tag--accent">${escapeHtml(label)}</li>`;
  }).join("");
  const foot = a.url
    ? `<a href="${escapeAttr(a.url)}" target="_blank" rel="noopener">Read on Medium ↗</a>`
    : `<span class="coming-soon">● Coming soon</span>`;
  return `          <article class="card card--link article-card" data-cat="${escapeAttr(a.cat)}">
            <div class="thumb">${thumb}</div>
            <div class="body">
              <span class="kicker">${escapeHtml(catLabels.get(a.cat) || "Article")} · No. ${a.n}</span>
              <h3>${escapeHtml(a.title)}</h3>
              <p>${escapeHtml(a.summary)}</p>
${tags ? `              <ul class="tags" style="margin-bottom:0.85rem">${tags}</ul>\n` : ""}              <div class="card-foot">${foot}</div>
            </div>
          </article>`;
}

/* ----- writing.html ----- */
{
  const file = "writing.html";
  const abs = path.join(WEBSITE_ROOT, file);
  let html = readFileSync(abs, "utf8");

  html = replaceRegion(html, "articles", ARTICLES.map(articleCardHtml).join("\n"), file);

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Deep dives on enterprise .NET",
    description: "A long-form series turning the MMCA framework's architecture decisions into teachable patterns.",
    numberOfItems: publishedArticles.length,
    itemListElement: publishedArticles
      .slice()
      .sort((a, b) => a.n - b.n)
      .map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "TechArticle",
          headline: a.title,
          description: a.summary,
          url: a.url,
          image: `${SITE}/${a.hero}`,
          ...(a.date ? { datePublished: a.date } : {}),
          author: { "@type": "Person", name: "Ivan Ball-llovera", url: SITE },
        },
      })),
  };
  html = replaceRegion(html, "articles-jsonld",
    `  <script type="application/ld+json">${JSON.stringify(itemList)}</script>`, file);

  writeFileSync(abs, html);
}

/* ----- platform.html: ADR count, ADR list, scorecard indices, library cards ----- */
{
  const file = "platform.html";
  const abs = path.join(WEBSITE_ROOT, file);
  let html = readFileSync(abs, "utf8");

  /* Scorecard headline indices, parsed out of the same governance markdown that gets published.
     A re-score updates those files, so this page cannot drift behind them any more. */
  const SCORED_REPOS = [
    { file: "common-ArchitectureScorecard.md", name: "MMCA.Common", kind: "framework" },
    { file: "adc-ArchitectureScorecard.md", name: "MMCA.ADC", kind: "conference app" },
    { file: "store-ArchitectureScorecard.md", name: "MMCA.Store", kind: "e-commerce app" },
  ];
  const scoreCards = SCORED_REPOS.map((repo) => {
    const md = readFileSync(path.join(GOV_SRC, repo.file), "utf8");
    const grab = (label) => {
      const m = new RegExp(`\\*\\*${label} index\\*\\*[^\\n]*?\\*\\*([\\d.]+%)\\*\\*`).exec(md);
      if (!m) { throw new Error(`${repo.file}: could not parse the ${label} index`); }
      return m[1];
    };
    const slug = repo.file.replace(/\.md$/i, ".html");
    return `          <a class="card card--link" href="docs/governance/${slug}">
            <h3>${escapeHtml(repo.name)} <span class="muted" style="font-weight:400">(${escapeHtml(repo.kind)})</span></h3>
            <p class="mb-0"><strong>Maturity ${grab("Maturity")}</strong> · <strong>Implementation ${grab("Implementation")}</strong><br><span class="muted">Scored across all 34 categories, every score citing the code that earns it.</span></p>
          </a>`;
  }).join("\n");
  html = replaceRegion(html, "scorecards", scoreCards, file);

  html = replaceRegion(html, "adr-stat",
    `          <div class="stat"><div class="num">${adrFiles.length}</div><div class="label">Architecture Decision Records</div></div>`,
    file);

  const onbCol = collections.find((c) => c.id === "onboarding");
  const groupChapters = onbFiles.filter((f) => /^group-\d/.test(f)).length;
  const libraryCards = [
    ["docs/adr/index.html", `${adrFiles.length} records`, "Architecture Decision Records",
      "The context, decision, rationale, and trade-offs behind every cross-cutting pattern, from manual DTO mapping and the outbox to JWKS auth, caching, and supply-chain provenance. Numbered, dated, and cross-linked.",
      "Browse the ADRs →"],
    ["docs/onboarding/index.html", `${onbCol.docs.length - 1} documents`, "Onboarding guide",
      `A teaching guide for an engineer new to the codebase: a primer, a mechanically extracted type inventory, ${groupChapters} group chapters walking every first-party type, five DevOps chapters, concept maps, and a coverage audit.`,
      "Open the guide →"],
    ["docs/governance/index.html", `${govFiles.length} artifacts`, "Architecture governance",
      "The 34-category evaluation rubric, plus an evidence-based scorecard and remediation backlog for each repo. Every score cites the code that earns it.",
      "Read the scorecards →"],
    ["docs/guides/index.html", `${guideFiles.length} guides`, "Guides &amp; specifications",
      "The narrative layer: the getting-started guide for adopting the framework, business specifications and workflow analyses for both applications, and per-concern reference notes.",
      "Browse the guides →"],
  ].map(([href, count, title, body, cta]) =>
`          <a class="card card--link" href="${href}">
            <span class="kicker" style="color:var(--accent)">${count}</span>
            <h3 style="margin:.35rem 0 .5rem">${title}</h3>
            <p class="mb-0">${body}</p>
            <div class="card-foot" style="margin-top:1rem"><span style="font-weight:600;color:var(--accent)">${cta}</span></div>
          </a>`).join("\n");
  html = replaceRegion(html, "library-cards", libraryCards, file);

  const cards = adrFiles.map((f) => {
    const num = f.slice(0, 3);
    const hand = ADR_CARDS[num];
    const doc = docsMeta.find((d) => d.col.id === "adr" && d.file === f);
    const title = hand?.title || (doc ? doc.title.replace(/^ADR[-\s]?\d+:\s*/i, "") : num);
    const summary = hand?.summary || (doc ? doc.desc : "");
    return `          <a class="adr" href="docs/adr/${f.replace(/\.md$/i, ".html")}"><span class="adr-num">${num}</span><span><span class="adr-title">${escapeHtml(title)}</span><span class="adr-sum">${escapeHtml(summary)}</span></span></a>`;
  }).join("\n");

  html = replaceRegion(html, "adr-list", cards, file);
  html = replaceRegion(html, "adr-count",
    `          <p>${adrFiles.length} ADRs capture the context and trade-offs behind each cross-cutting pattern, so the design is teachable, not tribal knowledge. Every entry below links to the full record.</p>`,
    file);

  writeFileSync(abs, html);
}

/* ----- feed.xml -----
   The aggregators and feed readers subscribe to this; Morning Dew's Dew Submitter takes a feed URL
   once instead of a link per article. Entries point at Medium (where the article lives), not at the
   site, so a subscriber lands on the real thing. */
{
  const items = publishedArticles.map((a) => {
    const pub = a.date ? `\n      <pubDate>${new Date(a.date).toUTCString()}</pubDate>` : "";
    const adrs = adrNumbers(a.adr).map((n) => `\n      <category>ADR ${n}</category>`).join("");
    return `    <item>
      <title>${escapeHtml(a.title)}</title>
      <link>${escapeHtml(a.url)}</link>
      <guid isPermaLink="true">${escapeHtml(a.url)}</guid>${pub}
      <description>${escapeHtml(a.summary)}</description>
      <category>${escapeHtml(catLabels.get(a.cat) || "Article")}</category>${adrs}
    </item>`;
  }).join("\n");

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Ivan Ball-llovera: deep dives on enterprise .NET</title>
    <link>${SITE}/writing.html</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>A long-form series turning a production .NET framework's architecture decisions into teachable patterns: the Result railway, the transactional outbox, database-per-service, JWKS auth, fitness functions, and more.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <managingEditor>noreply@ivanball.github.io (Ivan Ball-llovera)</managingEditor>
${items}
  </channel>
</rss>
`;
  writeFileSync(path.join(WEBSITE_ROOT, "feed.xml"), feed);
}

/* ----- sitemap.xml -----
   Generated, because the hand-maintained file listed 11 URLs and omitted every individual document:
   the deepest and most linkable content on the site was invisible to crawlers. */
let sitemapUrls = 0;
{
  const dates = gitDates();
  const entries = [];

  for (const p of ROOT_PAGES) {
    entries.push({ loc: p.loc || `${SITE}/${p.file}`, lastmod: dates.for(p.file), priority: p.priority });
  }
  entries.push({ loc: `${SITE}/docs/index.html`, lastmod: dates.for("docs/index.html"), priority: "0.8" });
  for (const col of collections) {
    for (const doc of col.docs) {
      entries.push({
        loc: `${SITE}/${doc.outRel}`,
        lastmod: dates.for(path.relative(WEBSITE_ROOT, doc.absSrc)),
        priority: doc.file === col.indexSrc ? "0.8" : "0.6",
      });
    }
  }

  const body = entries.map((e) =>
    `  <url>\n    <loc>${escapeHtml(e.loc)}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <priority>${e.priority}</priority>\n  </url>`
  ).join("\n");
  writeFileSync(path.join(WEBSITE_ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
  sitemapUrls = entries.length;
}

console.log(`Wrote ${written} pages (${collections.map((c) => `${c.docs.length} ${c.id}`).join(", ")}). Mermaid on ${mermaidPages} page(s).`);
console.log(`Mermaid bundle vendored: ${existsSync(mermaidDst)}`);
console.log(`Rendered ${ARTICLES.length} article cards into writing.html (${publishedArticles.length} published) and ${adrFiles.length} ADR cards into platform.html.`);
console.log(`Generated feed.xml (${publishedArticles.length} items) and sitemap.xml (${sitemapUrls} URLs).`);

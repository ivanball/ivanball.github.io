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
const NAV_ITEMS = [
  ["index.html", "Home"],
  ["resume.html", "Résumé"],
  ["platform.html", "Platform"],
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
    const cur = href === "platform.html" ? ' aria-current="page"' : "";
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

function page({ outRel, title, description, contentHtml, hasMermaid }) {
  const prefix = assetPrefix(outRel);
  const canonical = `${SITE}/${outRel}`;
  const fullTitle = `${title} · MMCA · Ivan Ball-llovera`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <link rel="icon" href="${prefix}assets/img/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta property="og:image" content="${SITE}/assets/img/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/assets/img/og-image.png">
  <script>(function(){try{var t=localStorage.getItem('mmca-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <link rel="stylesheet" href="${prefix}assets/css/styles.css">
  <link rel="stylesheet" href="${prefix}assets/css/docs.css">
  <script defer src="${prefix}assets/js/main.js"></script>
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

console.log(`Wrote ${written} pages (${collections.map((c) => `${c.docs.length} ${c.id}`).join(", ")}). Mermaid on ${mermaidPages} page(s).`);
console.log(`Mermaid bundle vendored: ${existsSync(mermaidDst)}`);

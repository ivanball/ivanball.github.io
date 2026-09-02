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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import path from "node:path";
import { Marked } from "marked";
import hljs from "highlight.js";
import MiniSearch from "minisearch";

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
const { PLATFORM_FACTS = {} } = loadWindowData("assets/data/platform-facts.js");

const stat = (num, label) =>
  `          <div class="stat"><div class="num">${num}</div><div class="label">${label}</div></div>`;

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
    /* %cI (strict ISO with offset) converted to the UTC calendar date, NOT %cs: %cs formats the
       date in the commit's own timezone, while BUILD_DATE and the CI runner are UTC. With %cs an
       evening US-Eastern squash merge is dated one day earlier locally than the UTC rebuild
       computes, and the freshness gate diffs on exactly that boundary (twice on 2026-08-05). */
    const log = execFileSync("git", ["log", "--name-only", "--no-renames", "--pretty=format:%cI"],
      { cwd: WEBSITE_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let current = null;
    for (const line of log.split(/\r?\n/)) {
      if (/^\d{4}-\d{2}-\d{2}T/.test(line)) { current = new Date(line).toISOString().slice(0, 10); continue; }
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

/* A relative .md link whose target is not in the published set degrades to a plain
   span rather than a broken href. That is the right rendering, but it used to happen
   silently: 44 links pointing at "../00-primer.md" (a sibling, so the "../" was simply
   wrong) sat dead in the published guide unnoticed. Collect them so the summary can
   report the count and the build can be audited. */
const DEAD_LINKS = [];

/* Code fences are highlighted at build time (see the `code` renderer). Counted for
   the build summary so a language that silently stopped resolving is visible. */
let HIGHLIGHTED_BLOCKS = 0;
/* Display names for the corner label on a code block. Anything not listed shows the
   fence's own language token, which is already the right answer for most of them. */
const LANG_LABELS = {
  csharp: "C#", cs: "C#", bash: "Shell", sh: "Shell", powershell: "PowerShell",
  json: "JSON", jsonc: "JSON", xml: "XML", yaml: "YAML", yml: "YAML", sql: "SQL", ini: "INI",
  /* bicep has no highlight.js grammar, so those blocks keep this label and render as
     plain text rather than being mis-tokenized as something else. */
  bicep: "Bicep",
  js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript",
  html: "HTML", css: "CSS", diff: "Diff", text: "Text", plaintext: "Text",
};

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
      /* Collect the H2s for the on-this-page rail. Plain text only: the rail is a
         narrow column, so inline code and links inside a heading are flattened. */
      if (depth === 2 && CTX.toc) {
        CTX.toc.push({ id, text: String(text).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").trim() });
      }
      return `<h${depth} id="${escapeAttr(id)}">${inner}</h${depth}>\n`;
    },
    html({ text }) {
      return isRealHtml(text) ? text : escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const nh = rewriteHref(href);
      if (nh === null) {
        DEAD_LINKS.push({ page: CTX.outRel, href, text: text.replace(/<[^>]*>/g, "") });
        return `<span class="doc-deadlink" title="Reference outside the published set">${text}</span>`;
      }
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
      /* Highlighting happens HERE, at build time, so no highlighter ships to the
         reader: the output is plain <span class="hljs-*"> markup coloured by
         docs.css from the site's own tokens. An unknown or absent language falls
         back to escaped plain text, exactly as before. */
      let body = escapeHtml(text);
      let langClass = language ? ` language-${escapeAttr(language)}` : "";
      /* highlight.js resolves its own aliases (jsonc -> json). A fence whose language
         it has no grammar for at all (bicep) keeps its label and renders plain. */
      if (language && hljs.getLanguage(language)) {
        try {
          body = hljs.highlight(text, { language, ignoreIllegals: true }).value;
          langClass += " hljs";
          HIGHLIGHTED_BLOCKS++;
        } catch {
          body = escapeHtml(text);
        }
      }
      const label = language ? ` data-lang="${escapeAttr(LANG_LABELS[language] || language)}"` : "";
      return `<pre class="doc-pre"${label}><code class="${langClass.trim()}">${body}</code></pre>\n`;
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

/* Matches the --bg custom property in styles.css for each theme, so mobile browser
   chrome follows the page instead of staying stuck on the light default. */
const THEME_COLOR_META = `  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0e151f" media="(prefers-color-scheme: dark)">`;

/* The footer link set. Root pages listed all six; the generated docs pages listed only
   four. That divergence had no reason behind it, so both now use the full set. */
const FOOTER_LINKS = [
  ["resume.html", "Résumé"],
  ["platform.html", "Platform"],
  ["docs/index.html", "Reference"],
  ["writing.html", "Writing"],
  ["speaking.html", "Speaking"],
  ["contact.html", "Contact"],
];

/* `active` is the NAV_ITEMS href of the page being stamped. Pages generated under docs/
   pass nothing and default to the Reference entry. Hand-authored root pages pass their
   own href, which is the ONLY thing that used to differ between their seven copies of
   this markup: one of them had drifted and listed Reference twice. */
function headerHtml(prefix, active = "docs/index.html") {
  const links = NAV_ITEMS.map(([href, label]) => {
    const cur = href === active ? ' aria-current="page"' : "";
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
        <button class="icon-btn search-open" type="button" aria-label="Search the site" data-search-open>
          <span aria-hidden="true">⌕</span>
        </button>
        <button class="icon-btn theme-toggle" type="button" aria-label="Switch color theme">
          <span class="sun" aria-hidden="true">☀</span><span class="moon" aria-hidden="true">☾</span>
        </button>
        <button class="icon-btn nav-toggle" type="button" aria-label="Toggle navigation menu" aria-expanded="false" aria-controls="nav-links">☰</button>
      </div>
    </div>
  </header>
${searchDialogHtml()}`;
}

/* The search dialog lives on every page, stamped inside the site-header region.
   A native <dialog> is used deliberately: it brings the focus trap, the Esc
   handling, inertness of the page behind it and the ::backdrop for free, which
   is a lot of accessibility to get wrong by hand. It is empty markup until
   assets/js/search.js fetches the index on first open. */
function searchDialogHtml() {
  return `  <dialog class="search-dialog" id="site-search" aria-label="Search this site">
    <form class="search-box" method="dialog" role="search">
      <span class="search-icon" aria-hidden="true">⌕</span>
      <input class="search-input" type="search" id="site-search-input" placeholder="Search ADRs, guides, chapters, articles…"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             aria-controls="site-search-results" aria-describedby="site-search-status">
      <button class="btn btn--ghost search-close" type="button" data-search-close>Esc</button>
    </form>
    <p class="search-status" id="site-search-status" role="status" aria-live="polite"></p>
    <ul class="search-results" id="site-search-results"></ul>
    <p class="search-foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
      <span><kbd>Enter</kbd> to open</span>
      <span><kbd>"…"</kbd> all these words</span>
      <span><kbd>AND</kbd><kbd>OR</kbd> to combine</span>
    </p>
  </dialog>`;
}

function footerHtml(prefix, tagline = "Reference docs generated from source.") {
  const links = FOOTER_LINKS
    .map(([href, label]) => `          <li><a href="${prefix}${href}">${label}</a></li>`)
    .join("\n");
  return `  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <p class="footer-meta mb-0"><strong>Ivan Ball-llovera</strong> · Senior Software Architect · Douglasville, GA</p>
        <ul class="footer-links">
${links}
          <li><a href="https://github.com/ivanball" target="_blank" rel="me noopener">GitHub</a></li>
          <li><a href="https://www.linkedin.com/in/ivan-ball-llovera-6549a911" target="_blank" rel="me noopener">LinkedIn</a></li>
        </ul>
      </div>
      <p class="footer-meta" style="margin-top:1rem">© <span class="js-year">2026</span> Ivan Ball-llovera. ${tagline}</p>
    </div>
  </footer>`;
}

/* Authored hidden and revealed by analytics.js only once a list URL exists, so a
   half-configured site never shows a form that silently drops addresses. The id prefix
   keeps the label/input pairing unique on pages that both carry the block. */
function subscribeHtml(idPrefix) {
  return `        <div class="subscribe" data-newsletter-wrap hidden>
          <h2 style="margin:0 0 0.4rem">Get each deep dive by email</h2>
          <p class="mb-0" style="max-width:60ch">One message per article, no digests and no other mail.</p>
          <form class="subscribe-form" data-newsletter method="post" target="_blank">
            <label class="sr-only" for="${idPrefix}-subscribe-email">Email address</label>
            <input id="${idPrefix}-subscribe-email" type="email" name="email" required placeholder="you@example.com" autocomplete="email">
            <button class="btn btn--primary" type="submit">Subscribe</button>
          </form>
        </div>`;
}

/* The contiguous tail of every <head>: the pre-paint theme reader, the stylesheet, and
   the two deferred scripts. Everything above it (title, description, canonical, the
   per-page OG and Twitter values) is genuinely per-page and stays hand-authored. */
function headAssetsHtml(prefix, extraCss = "") {
  const css = extraCss ? `\n  <link rel="stylesheet" href="${prefix}${extraCss}">` : "";
  /* The two fonts used by every page above the fold are preloaded: without it they
     are only discovered when the stylesheet finishes parsing, which is a visible
     swap on the h1. `crossorigin` is required on a font preload even same-origin,
     or the browser fetches the file twice. */
  return `  <script>(function(){try{var t=localStorage.getItem('mmca-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);if(localStorage.getItem('mmca-rail')==='hidden')document.documentElement.setAttribute('data-rail','hidden');}catch(e){}})();</script>
  <link rel="preload" href="${prefix}assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${prefix}assets/fonts/jetbrains-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${prefix}assets/css/styles.css">${css}
  <script defer src="${prefix}assets/js/main.js"></script>
  <script defer src="${prefix}assets/js/search.js"></script>
  <script defer src="${prefix}assets/js/analytics.js"></script>`;
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
        // themeVariables pin the diagram palette to the site's own tokens: the
        // stock mermaid themes ship a lavender/beige scheme that read as a
        // foreign object dropped into the page.
        var themeVariables = dark ? {
          background: "#131e2b", primaryColor: "#17263f", primaryTextColor: "#e9eff7",
          primaryBorderColor: "#3b4e64", lineColor: "#7aa5ff", secondaryColor: "#10303a",
          tertiaryColor: "#1b2837", mainBkg: "#17263f", nodeBorder: "#3b4e64",
          clusterBkg: "#111b28", clusterBorder: "#2a3a4d", titleColor: "#e9eff7",
          edgeLabelBackground: "#131e2b", textColor: "#e9eff7"
        } : {
          background: "#ffffff", primaryColor: "#e6edfd", primaryTextColor: "#101a25",
          primaryBorderColor: "#1a4fd6", lineColor: "#1a4fd6", secondaryColor: "#ddf0f2",
          tertiaryColor: "#f4f7fb", mainBkg: "#e6edfd", nodeBorder: "#1a4fd6",
          clusterBkg: "#f4f7fb", clusterBorder: "#dbe3ec", titleColor: "#101a25",
          edgeLabelBackground: "#ffffff", textColor: "#101a25"
        };
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "base",
          fontFamily: '"Inter Variable", -apple-system, "Segoe UI", Roboto, sans-serif',
          themeVariables: themeVariables
        });
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
${THEME_COLOR_META}
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
  <meta property="og:image:alt" content="Ivan Ball-llovera, Senior Software Architect">
  <meta property="og:locale" content="en_US">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(title)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <meta name="twitter:image" content="${SITE}/assets/img/og-image.png">${ld}
${headAssetsHtml(prefix, "assets/css/docs.css")}
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

function breadcrumbHtml(col, prefix, currentLabel, hasRail = false) {
  /* The rail toggle rides in the breadcrumb row, right-aligned, and is only
     stamped on pages that actually have a rail. Its aria-expanded is corrected
     by main.js when a stored preference hides the rail before first paint. */
  const railBtn = hasRail
    ? `\n        <button class="rail-toggle" type="button" data-rail-toggle aria-expanded="true" aria-controls="doc-rail">On this page</button>`
    : "";
  return `      <nav class="doc-breadcrumb" aria-label="Breadcrumb">
        <a href="${prefix}platform.html">Platform</a>
        <span aria-hidden="true">/</span>
        <a href="${prefix}docs/index.html">Reference</a>
        <span aria-hidden="true">/</span>
        <a href="${prefix}${col.outDir}/index.html">${escapeHtml(col.title)}</a>
        <span aria-hidden="true">/</span>
        <span class="current">${escapeHtml(currentLabel)}</span>${railBtn}
      </nav>`;
}

/* On-this-page rail. Only rendered when a document has enough sections to be worth
   navigating: below that it is chrome competing with the collection sidebar, and the
   three-column layout would collapse to two mostly-empty rails. */
const TOC_MIN_HEADINGS = 4;
function tocHtml(toc) {
  if (!toc || toc.length < TOC_MIN_HEADINGS) return "";
  const items = toc
    .map((h) => `            <li><a href="#${escapeAttr(h.id)}">${escapeHtml(h.text)}</a></li>`)
    .join("\n");
  return `        <aside class="doc-aside" id="doc-rail">
          <nav class="doc-toc" aria-label="On this page">
            <p class="doc-toc-title">On this page</p>
            <ul>
${items}
            </ul>
          </nav>
        </aside>`;
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

let written = 0, mermaidPages = 0, tocPages = 0;

/* ============================================================================
   Search index
   ----------------------------------------------------------------------------
   A real inverted index, built here with MiniSearch and shipped as its own
   serialized form, so the browser loads a finished index instead of rebuilding
   one out of 7.6 MB of markdown it would first have to download.

   The unit is still the H2 SECTION, which is the right granularity for a
   reference library: a hit lands on the section that answers the question, not
   on a 500 KB chapter. What changed is what each record CONTAINS. The indexed
   fields are the section title, the document title, the distinct
   `code identifiers`, and `b`, the full plain text of the section body. `b` is
   indexed but never stored, so the whole body is searchable while only the
   180-character display excerpt travels back with a result. Before this, body
   text past the excerpt was simply not findable.

   Sections past the per-document cap do not vanish: their text and identifiers
   fold into the DOCUMENT record, so the words stay findable and the hit lands
   on the document rather than nowhere.

   Everything is root-absolute so a result works from any depth, including the
   404 page. The output is deterministic: same sources in, byte-identical file
   out, which the CI freshness gate depends on. Ids are assigned sequentially in
   insertion order for exactly that reason.
   ============================================================================ */
const SEARCH_RECORDS = [];
let searchIndexBytes = 0;
const EXCERPT_CHARS = 180;
const MAX_IDENTIFIERS = 12;
/* 00-inventory.md alone has hundreds of H2s. Past this many sections a document
   contributes its own long tail of near-identical rows and nothing else. */
const MAX_SECTIONS_PER_DOC = 60;

/* Split markdown into H2 sections, skipping fenced code (a "## " line inside a
   fence is not a heading, and the renderer does not treat it as one either).
   Returns the lead text before the first H2, then one entry per section, in
   document order, so it can be zipped with the ids the renderer already
   assigned in ctx.toc. */
function splitSections(md) {
  const lines = md.split(/\r?\n/);
  const lead = [];
  const sections = [];
  let current = null;
  let fenced = false;
  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/.test(line)) { fenced = !fenced; }
    if (!fenced && /^##\s+\S/.test(line)) {
      current = { body: [] };
      sections.push(current);
      continue;
    }
    (current ? current.body : lead).push(line);
  }
  return { lead: lead.join("\n"), sections: sections.map((s) => s.body.join("\n")) };
}

/* Markdown to a flat, human-readable excerpt. Code fences, tables and images go
   entirely: a table of 40 type names reads as noise in a result list. */
function toExcerpt(md) {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    /* Heading lines are navigation, not prose. Without this the excerpt for a
       document record opened by restating the title directly above it. */
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, " ")
    .replace(/^\s*\|.*$/gm, " ")                  // table rows
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")        // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")      // links -> text
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= EXCERPT_CHARS) return text;
  return text.slice(0, EXCERPT_CHARS - 1).replace(/\s+\S*$/, "") + "…";
}

/* Markdown to the full plain text that gets INDEXED. Same idea as toExcerpt but
   with no truncation, and tables are kept: a table cell is prose to a reader
   looking for a term, and dropping them would silently hide whole comparison
   matrices from search. Only the pipes go, not the content. Fenced code and
   images still go entirely: code is already covered, far better, by
   identifiersIn(), and an image URL is noise no one searches for. */
function toPlainText(md) {
  return String(md)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")        // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")      // links -> text
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*\|?[\s:|-]*\|[\s:|-]*$/gm, " ") // table separator rows
    .replace(/[`*_>#|]/g, " ")                    // markdown punctuation, pipes included
    .replace(/\s+/g, " ")
    .trim();
}

/* Distinct `backticked` identifiers, longest-first so the most specific names
   survive the cap.

   The inner text is captured loosely and then reduced to its base name, because
   this codebase writes generics and calls inside the ticks: a strict
   [A-Za-z0-9_.] pattern silently indexed NOTHING for
   `PagedCollectionResult<EventDTO>`, which is precisely the kind of term someone
   opens this search to find. Both the base name and any type argument are kept,
   so either half of `Result<Ticket>` finds the section. */
function identifiersIn(md) {
  const found = new Set();
  for (const m of md.matchAll(/`([^`\n]{3,80})`/g)) {
    for (const part of m[1].split(/[<>(),\s[\]{}]+/)) {
      const name = part.replace(/[?;:.]+$/, "").replace(/^[@#.]+/, "");
      if (/^[A-Za-z_][A-Za-z0-9_.]{2,48}$/.test(name)) { found.add(name); }
    }
  }
  return [...found].sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, MAX_IDENTIFIERS);
}

/* Returns the record it pushed, or null when it dropped one, so the caller can
   keep folding into a document record it already created. */
function addSearchRecord({ url, section, doc, kind, source }) {
  const excerpt = toExcerpt(source);
  const ids = identifiersIn(source);
  const body = toPlainText(source);
  /* A SECTION with no prose and no identifiers is a divider, not a destination.
     A DOCUMENT record is always kept: its title is the main thing people search
     for, and an ADR's lead is nothing but that title, so dropping empty ones
     took all 56 ADRs out of the index by their own name. */
  if (section && !excerpt && !ids.length && !body) return null;
  const rec = { u: url, d: doc, k: kind };
  if (section) rec.t = section;
  if (excerpt) rec.x = excerpt;
  if (ids.length) rec.i = ids.join(" ");
  /* Indexed, never stored: the full body is what makes the search full-text,
     and shipping it back with every result would undo the point of the
     excerpt. */
  if (body) rec.b = body;
  SEARCH_RECORDS.push(rec);
  return rec;
}

/* Sections past the cap used to be dropped outright, which meant their text was
   unfindable by any means. Fold them into the document record instead: the
   words stay searchable and the reader lands on the document that contains
   them, which is the honest answer when there is no anchor to offer. The
   per-section identifier cap does not apply here: this list is a union of many
   sections, so it is allowed to grow, deduplicated and in first-seen order so
   the output stays byte-stable. */
function foldSectionsIntoDocument(rec, overflow) {
  if (!rec || !overflow.length) return;
  const ids = new Set(rec.i ? rec.i.split(" ") : []);
  const text = rec.b ? [rec.b] : [];
  for (const source of overflow) {
    const body = toPlainText(source);
    if (body) text.push(body);
    for (const id of identifiersIn(source)) ids.add(id);
  }
  if (ids.size) rec.i = [...ids].join(" ");
  if (text.length) rec.b = text.join(" ");
}

/* Everything under docs/ is generated from docs-src/. The build only ever wrote files,
   so deleting or renaming a source left its rendered page behind: still committed, still
   reachable by URL, just absent from every sidebar and the sitemap. Track what this run
   produced so the orphans can be removed at the end. */
const WRITTEN_DOCS = new Set();
for (const col of collections) {
  for (const doc of col.docs) {
    const ctx = { srcDir: col.srcDir, outRel: doc.outRel, hasMermaid: false, toc: [] };
    const body = renderMarkdown(doc.md, ctx);
    if (ctx.hasMermaid) mermaidPages++;
    const isIndex = doc.file === col.indexSrc;
    const currentLabel = isIndex ? "Overview" : doc.label;
    const prefix = assetPrefix(doc.outRel);
    const aside = tocHtml(ctx.toc);
    if (aside) tocPages++;

    /* Index this document: one record for the document itself (its lead text),
       then one per H2. ctx.toc holds the ids the renderer just assigned, in
       document order, so zipping it with the split source keeps every anchor
       exactly in step with the page. */
    {
      const { lead, sections } = splitSections(doc.md);
      const docUrl = `/${toPosix(doc.outRel)}`;
      const docRec = addSearchRecord({ url: docUrl, section: "", doc: doc.title, kind: col.title, source: lead });
      const limit = Math.min(sections.length, ctx.toc.length, MAX_SECTIONS_PER_DOC);
      for (let i = 0; i < limit; i++) {
        addSearchRecord({
          url: `${docUrl}#${ctx.toc[i].id}`,
          section: ctx.toc[i].text,
          doc: doc.title,
          kind: col.title,
          source: sections[i],
        });
      }
      /* Whatever the cap (or a shorter ctx.toc) left over still gets indexed,
         on the document's own record. */
      foldSectionsIntoDocument(docRec, sections.slice(limit));
    }
    /* Pretty-print the body by indenting it into the page shell, EXCEPT inside <pre> blocks:
       there the whitespace is literal, so the indent used to render every code line after the
       first shifted ten spaces right on all 119+ doc pages. The line carrying the opening <pre>
       tag may still be indented (the tag itself is outside the content); every line up to and
       including the one carrying </pre> starts with code content and must stay flush left. */
    let preDepth = 0;
    const indentedBody = body.split("\n").map((l) => {
      const out = preDepth > 0 ? l : "          " + l;
      preDepth += (l.match(/<pre\b/g) || []).length - (l.match(/<\/pre>/g) || []).length;
      return out;
    }).join("\n");
    const content =
`    <div class="container doc-container">
${breadcrumbHtml(col, prefix, currentLabel, Boolean(aside))}
      <div class="doc-layout${aside ? " doc-layout--toc" : ""}">
${sidebarHtml(col, doc.outRel)}
        <article class="doc-content">
          <p class="eyebrow doc-kicker">${escapeHtml(col.kicker)}</p>
${indentedBody}
${docFootHtml(col, doc)}
        </article>
${aside}
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
    WRITTEN_DOCS.add(toPosix(doc.outRel));
    written++;
  }
}

/* ----- the Reference-library hub (docs/index.html) ----- */
{
  const outRel = "docs/index.html";
  const prefix = assetPrefix(outRel);
  const onb = collections.find((c) => c.id === "onboarding");
  const onbContent = onb.docs.length - 1; // exclude the index page itself
  const hub = [
    ["adr/index.html", `${adrFiles.length} records`, "Architecture Decision Records",
      "The context, decision, rationale, and trade-offs behind every cross-cutting pattern, from manual DTO mapping and the outbox to JWKS auth, caching, and supply-chain provenance. Numbered, dated, and cross-linked.",
      "Browse the ADRs →"],
    ["onboarding/index.html", `${onbContent} documents`, "Onboarding Guide",
      `A teaching guide for an engineer new to the codebase: a primer, a mechanically extracted type inventory, ${onbFiles.filter((f) => /^group-\d/.test(f)).length} group chapters walking every first-party type, five DevOps chapters, concept maps, and a coverage audit.`,
      "Open the guide →"],
    ["governance/index.html", `${govFiles.length} artifacts`, "Architecture Governance",
      "The 34-category evaluation rubric, plus an evidence-based scorecard and remediation backlog for each repo (framework, e-commerce, conference). Every score cites the code that earns it.",
      "Read the scorecards →"],
    ["guides/index.html", `${guideFiles.length} guides`, "Guides &amp; Specifications",
      "The narrative layer: the getting-started guide for adopting the framework, business specifications and workflow analyses for both applications, and per-concern notes on accessibility, resilience, responsiveness, versioning, and cost.",
      "Browse the guides →"],
  ].map(([href, count, title, body, cta]) =>
`          <a class="card card--link" href="${href}">
            <span class="kicker kicker--accent">${count}</span>
            <h2>${title}</h2>
            <p>${body}</p>
            <div class="card-foot"><span class="go">${cta}</span></div>
          </a>`).join("\n");
  const content =
`    <div class="page-head">
      <div class="container">
        <p class="eyebrow">Platform · Reference library</p>
        <h1>Reference library</h1>
        <p class="lede">The architecture documentation behind the MMCA platform, published from its canonical home in this site's repository. Every Architecture Decision Record, the governance scorecards, the guides, and the complete onboarding guide, rendered as browsable pages, evidence and trade-offs included.</p>
        <div class="btn-row">
          <a class="btn btn--ghost" href="${prefix}platform.html">← Back to the platform overview</a>
        </div>
      </div>
    </div>
    <section class="section">
      <div class="container">
        <div class="grid grid--2">
${hub}
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
  WRITTEN_DOCS.add(toPosix(outRel));
  written++;
}

/* ----- prune orphaned output -----
   Any .html under docs/ that this run did not produce has lost its markdown source.
   Removing it here keeps the committed output a faithful mirror of docs-src/ instead of
   accumulating pages that nothing links to but search engines can still reach. */
const pruned = [];
{
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.name.endsWith(".html")) continue;
      const rel = toPosix(path.relative(WEBSITE_ROOT, abs));
      if (!WRITTEN_DOCS.has(rel)) { rmSync(abs); pruned.push(rel); }
    }
  };
  walk(path.join(WEBSITE_ROOT, "docs"));
}

/* ----- vendor mermaid (only referenced by pages that contain diagrams) ----- */
const mermaidSrc = path.join(HERE, "node_modules", "mermaid", "dist", "mermaid.min.js");
const mermaidDst = path.join(WEBSITE_ROOT, "assets", "js", "mermaid.min.js");
if (existsSync(mermaidSrc)) {
  copyFileSync(mermaidSrc, mermaidDst);
}

/* ----- vendor minisearch (loaded lazily by search.js on first open) -----
   Self-hosted for the same reason as mermaid and the fonts: no third-party
   request. Deliberately NOT in headAssetsHtml: it is fetched by search.js the
   first time the dialog opens, so a visitor who never searches downloads
   nothing extra. The UMD build is the one that defines a global. */
const miniSearchSrc = path.join(HERE, "node_modules", "minisearch", "dist", "umd", "index.js");
const miniSearchDst = path.join(WEBSITE_ROOT, "assets", "js", "minisearch.js");
if (existsSync(miniSearchSrc)) {
  copyFileSync(miniSearchSrc, miniSearchDst);
}

/* ----- vendor the web fonts -----
   Self-hosted so the site makes no third-party request and needs no font CDN in a
   CSP. Latin subset only; the @font-face unicode-range in styles.css is copied from
   the same fontsource packages, so a glyph outside it falls back to the system font
   instead of pulling a second file. Missing package = no copy and no failure: the
   font stack degrades to the system sans/mono it already listed. */
const FONT_FILES = [
  ["@fontsource-variable/inter", "inter-latin-wght-normal.woff2"],
  ["@fontsource-variable/inter", "inter-latin-wght-italic.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-700-normal.woff2"],
];
const FONT_DIR = path.join(WEBSITE_ROOT, "assets", "fonts");
mkdirSync(FONT_DIR, { recursive: true });
let fontsCopied = 0;
for (const [pkg, file] of FONT_FILES) {
  const src = path.join(HERE, "node_modules", ...pkg.split("/"), "files", file);
  if (!existsSync(src)) continue;
  copyFileSync(src, path.join(FONT_DIR, file));
  fontsCopied++;
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

/* articles.js points `hero` at the 1600x840 PNG, because that file is the source hero
   uploaded to Medium when a piece publishes. The site serves the 800px WebP that
   `npm run images` derives from it (about 97% smaller across the 50 heroes). Keeping the
   swap here means the data file keeps naming the real source and no page references a
   35 MB asset. If a WebP is missing, fall back to the PNG rather than emit a broken src. */
const HERO_W = 800;
const HERO_H = 420;

function webHero(hero) {
  const webp = hero.replace(/\.png$/i, ".webp");
  return existsSync(path.join(WEBSITE_ROOT, webp)) ? webp : hero;
}

/* Same markup assets/js/writing.js used to build at runtime, with two additions: the ADR reference
   becomes a real link into the published record (internal link equity the client-rendered version
   could never contribute), and the category rides a data attribute so filtering can hide and show
   these nodes instead of replacing them. */
function articleCardHtml(a) {
  const thumb = a.hero
    ? `<img src="${escapeAttr(webHero(a.hero))}" alt="" width="${HERO_W}" height="${HERO_H}" loading="lazy" decoding="async">`
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

/* ----- the shared shell on every hand-authored root page -----
   The header, footer, head asset tags, and subscribe block used to be copy-pasted into
   all seven pages, with a ninth and tenth copy living in this file for the generated
   docs pages. Eight edit sites for one nav change, and 404.html had already drifted into
   listing "Reference" twice. Now every page is stamped from the same functions, so the
   nav lives in NAV_ITEMS alone. Per-page uniqueness (title, description, canonical, the
   OG and Twitter values, aria-current) stays outside these regions. */
{
  const SUBSCRIBE_PAGES = new Map([
    ["writing.html", "writing"],
    ["platform.html", "platform"],
  ]);

  for (const [file] of NAV_ITEMS.filter(([h]) => h !== "docs/index.html").concat([["404.html"]])) {
    const abs = path.join(WEBSITE_ROOT, file);
    let html = readFileSync(abs, "utf8");

    /* 404.html is the one root page that gets a root-absolute prefix. GitHub Pages
       serves it for a miss at ANY depth (/docs/adr/typo.html), where a relative
       "assets/css/styles.css" resolves under that directory and 404s in turn: the
       page rendered completely unstyled, which is exactly where a visitor least
       needs a broken page. The nav links had the same problem. This site is a user
       site at the domain root, so "/" is the correct prefix. */
    const prefix = file === "404.html" ? "/" : "";
    html = replaceRegion(html, "head-assets", headAssetsHtml(prefix), file);
    html = replaceRegion(html, "site-header", headerHtml(prefix, file), file);
    html = replaceRegion(html, "site-footer", footerHtml(prefix, "Built as a static site."), file);

    const idPrefix = SUBSCRIBE_PAGES.get(file);
    if (idPrefix) html = replaceRegion(html, "subscribe", subscribeHtml(idPrefix), file);

    writeFileSync(abs, html);
  }
}

/* ----- index.html stat row -----
   The ADR count is the rigor signal that was missing here: years, packages, and
   conferences say experience and community, but nothing said the decisions are written
   down. Generated for the same reason as the platform stats, so it tracks docs-src/. */
{
  const file = "index.html";
  const abs = path.join(WEBSITE_ROOT, file);
  let html = readFileSync(abs, "utf8");
  html = replaceRegion(html, "home-stats", [
    stat("25+", "Years on the Microsoft stack"),
    stat(PLATFORM_FACTS.packages, "Open-source NuGet packages"),
    stat(adrFiles.length, "Architecture Decision Records"),
    stat(2, "Atlanta tech conferences organized"),
  ].join("\n"), file);

  /* ----- featured writing -----
     The home page used to carry three hand-written summaries of articles, which meant
     three more places to keep in sync with articles.js and no hero image on any of
     them. These are the three most recently published pieces, rendered from the same
     data and the same hero art as the Writing page, and they refresh themselves the
     moment a new Medium URL lands in articles.js. */
  const featured = publishedArticles
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || b.n - a.n)
    .slice(0, 3);
  html = replaceRegion(html, "featured-articles",
    featured.map((a) =>
`          <a class="card card--link article-card" href="${escapeAttr(a.url)}" target="_blank" rel="noopener">
            <div class="thumb"><img src="${escapeAttr(webHero(a.hero))}" alt="" width="${HERO_W}" height="${HERO_H}" loading="lazy" decoding="async"></div>
            <div class="body">
              <span class="kicker">${escapeHtml(catLabels.get(a.cat) || "Article")} · No. ${a.n}</span>
              <h3>${escapeHtml(a.title)}</h3>
              <p>${escapeHtml(a.summary)}</p>
              <div class="card-foot"><span class="go">Read on Medium ↗</span></div>
            </div>
          </a>`).join("\n"), file);

  writeFileSync(abs, html);
}

/* ----- resume.html platform figures -----
   The resume is the page a recruiter reads, and it was the page whose numbers had gone
   stale: it claimed 91 fitness tests and 51 ADRs against the real 93 and 55. Same sources
   as the platform stats now, so the two pages cannot disagree again. */
{
  const file = "resume.html";
  const abs = path.join(WEBSITE_ROOT, file);
  let html = readFileSync(abs, "utf8");
  html = replaceRegion(html, "resume-platform-facts",
    `            <li>Built Blazor (MudBlazor) and .NET MAUI clients; enforced quality with xUnit v3, Playwright E2E, ${PLATFORM_FACTS.fitnessTests} architecture-fitness tests, and automated accessibility testing (axe, WCAG 2.1 AA: zero violations).</li>
            <li>Documented decisions with ${adrFiles.length} ADRs and a ${PLATFORM_FACTS.rubricCategories}-category architecture-review rubric; built Roslyn-based code-inventory tooling and AI/multi-agent development workflows.</li>`,
    file);
  writeFileSync(abs, html);
}

/* ----- writing.html ----- */
{
  const file = "writing.html";
  const abs = path.join(WEBSITE_ROOT, file);
  let html = readFileSync(abs, "utf8");

  html = replaceRegion(html, "articles", ARTICLES.map(articleCardHtml).join("\n"), file);

  /* Only the category list, not the whole ARTICLES array. The cards are static markup
     now, so shipping articles.js to the browser sent 18 KB of summaries and URLs that
     nothing read. writing.js reads window.ARTICLE_CATEGORIES and filters in place. */
  html = replaceRegion(html, "article-categories",
    `  <script>window.ARTICLE_CATEGORIES=${JSON.stringify(ARTICLE_CATEGORIES)};</script>`,
    file);

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
    /* Two axes read as two bars. The percentage is both the bar width and the printed
       value, so the visual and the number cannot disagree, and a screen reader still
       gets "Maturity 96.9%" as plain text. */
    const bar = (label, value, alt) =>
`            <span class="meter${alt ? " meter--alt" : ""}">
              <span class="meter-label">${label}</span>
              <span class="meter-track"><span class="meter-fill" style="width:${value}"></span></span>
              <span class="meter-value">${value}</span>
            </span>`;
    return `          <a class="meter-card card--link" href="docs/governance/${slug}">
            <span class="meter-title"><strong>${escapeHtml(repo.name)}</strong> <span class="meter-role">${escapeHtml(repo.kind)}</span></span>
${bar("Maturity", grab("Maturity"), false)}
${bar("Implementation", grab("Implementation"), true)}
          </a>`;
  }).join("\n");
  html = replaceRegion(html, "scorecards", scoreCards, file);

  /* The ADR count is derived from docs-src/; the other three mirror MMCA.Common via
     assets/data/platform-facts.js. All four used to be hand-typed here and in
     resume.html, and the two pages had already drifted apart. */
  html = replaceRegion(html, "platform-stats", [
    stat(PLATFORM_FACTS.packages, "NuGet packages"),
    stat(adrFiles.length, "Architecture Decision Records"),
    stat(PLATFORM_FACTS.fitnessTests, "Architecture fitness tests"),
    stat(PLATFORM_FACTS.referenceApps, "Reference applications"),
  ].join("\n"), file);

  /* ----- the package stack -----
     Rendered from PLATFORM_FACTS.packageLayers so the list and the "15 packages"
     figure come from one place. The check below is the point of the exercise: the
     hand-typed pill list this replaced had drifted to 13 entries while the prose
     beside it still said fifteen, and nothing caught it. */
  const layers = PLATFORM_FACTS.packageLayers || [];
  const layerPackages = layers.flatMap((l) => l.items);
  if (layerPackages.length !== PLATFORM_FACTS.packages) {
    throw new Error(
      `platform-facts.js: packageLayers lists ${layerPackages.length} package(s) but packages is ${PLATFORM_FACTS.packages}. ` +
      "Update both from MMCA.Common/FACTS.md.");
  }
  const packageLayers = layers.map((l) =>
`          <li class="layer${l.edge ? " layer--edge" : ""}">
            <span class="layer-name">${l.name}</span>
            <span>
              <span class="pill-list">${l.items.map((p) => `<span class="pill">${escapeHtml(p)}</span>`).join("")}</span>
              <span class="layer-note">${l.note}</span>
            </span>
          </li>`).join("\n");
  html = replaceRegion(html, "package-layers", packageLayers, file);

  /* The four per-collection cards used to be repeated here in full; they are the
     Reference page's (docs/index.html) whole content, so the platform page now
     carries one summary card pointing there instead of a second copy. */
  const onbCol = collections.find((c) => c.id === "onboarding");
  const onbCount = onbCol.docs.length - 1;
  const libraryTotal = adrFiles.length + onbCount + govFiles.length + guideFiles.length;
  const libraryCard =
`          <a class="card card--link" href="docs/index.html">
            <span class="kicker kicker--accent">${libraryTotal} documents</span>
            <h3>Open the reference library</h3>
            <p>Every collection indexed in one place: ${adrFiles.length} Architecture Decision Records, the ${onbCount}-document onboarding guide, ${govFiles.length} governance artifacts, and ${guideFiles.length} guides and specifications.</p>
            <div class="card-foot"><span class="go">Browse the collections →</span></div>
          </a>`;
  html = replaceRegion(html, "library-cards", libraryCard, file);

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

/* ----- search index: the hand-authored root pages + the article series -----
   Read back from the FINAL html so what gets indexed is what a visitor sees,
   including the regions this build just stamped (the ADR list, the article
   cards, the package stack). Parsing the output also means a new hand-authored
   section is indexed with no extra bookkeeping. */
{
  const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();

  for (const [file] of NAV_ITEMS.filter(([h]) => h !== "docs/index.html")) {
    const html = readFileSync(path.join(WEBSITE_ROOT, file), "utf8");
    const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html);
    if (!main) continue;
    const title = stripTags((/<title>([\s\S]*?)<\/title>/.exec(html) || [, file])[1])
      .replace(/\s*·\s*Ivan Ball-llovera\s*$/, "").trim();
    const url = file === "index.html" ? "/" : `/${file}`;

    /* Everything down to the first h2 describes the page itself. */
    const body = main[1];
    const firstH2 = body.search(/<h2[\s>]/);
    const lead = stripTags(firstH2 === -1 ? body : body.slice(0, firstH2));
    SEARCH_RECORDS.push({
      u: url, d: title, k: "Site",
      x: lead.length > EXCERPT_CHARS ? lead.slice(0, EXCERPT_CHARS - 1).replace(/\s+\S*$/, "") + "…" : lead,
      /* The stripped text in full is the indexed body; the excerpt above is
         only what a result displays. */
      b: lead,
    });

    /* Then one record per h2 section. Root pages carry no heading ids, so these
       link to the page rather than to an anchor. */
    const parts = body.split(/<h2[^>]*>/).slice(1);
    for (const part of parts) {
      const close = part.indexOf("</h2>");
      if (close === -1) continue;
      const heading = stripTags(part.slice(0, close));
      if (!heading || heading.toLowerCase() === "all articles") continue;
      const text = stripTags(part.slice(close + 5));
      SEARCH_RECORDS.push({
        u: url, t: heading, d: title, k: "Site",
        x: text.length > EXCERPT_CHARS ? text.slice(0, EXCERPT_CHARS - 1).replace(/\s+\S*$/, "") + "…" : text,
        b: text,
      });
    }
  }

  /* The published series. These leave the site (they live on Medium), so the
     result list marks them and the link opens in a new tab. */
  for (const a of publishedArticles) {
    SEARCH_RECORDS.push({
      u: a.url, t: a.title, d: `Article no. ${a.n}`,
      k: catLabels.get(a.cat) || "Writing", x: a.summary, e: 1,
      /* The summary IS the whole text this site holds for an article; the
         article itself lives on Medium. */
      b: a.summary,
    });
  }

  /* The runtime reads these options straight back out of the envelope and hands
     them to MiniSearch.loadJS, so both sides are guaranteed to agree on which
     fields exist and which are stored. Tokenizer and processTerm are left at
     their defaults deliberately: a function cannot survive JSON, so customizing
     either here would silently give the browser a different tokenization than
     the one the index was built with. */
  const searchOptions = {
    fields: ["t", "d", "i", "b"],
    storeFields: ["u", "d", "k", "t", "x", "e"],
    idField: "id",
  };
  /* Sequential ids in insertion order: nothing about the index then depends on
     hashing or iteration luck, which is what keeps two builds byte-identical. */
  SEARCH_RECORDS.forEach((rec, i) => { rec.id = i; });
  const miniSearch = new MiniSearch(searchOptions);
  miniSearch.addAll(SEARCH_RECORDS);

  const outPath = path.join(WEBSITE_ROOT, "assets", "data", "search-index.json");
  const payload = JSON.stringify({
    v: 2, n: SEARCH_RECORDS.length, o: searchOptions, i: miniSearch.toJSON(),
  });
  writeFileSync(outPath, payload);
  searchIndexBytes = payload.length;
}

/* ----- feed.xml -----
   The aggregators and feed readers subscribe to this; Morning Dew's Dew Submitter takes a feed URL
   once instead of a link per article. Entries point at Medium (where the article lives), not at the
   site, so a subscriber lands on the real thing. */
{
  /* Derived from the newest published article, NOT from the wall clock. A build-time
     timestamp here rewrote feed.xml on every run, which made the build non-idempotent
     and would make a "rebuild and check git diff is clean" CI gate fail every time.
     The feed's content genuinely last changed when the newest article was published. */
  const newest = publishedArticles
    .map((a) => (a.date ? Date.parse(a.date) : NaN))
    .filter((t) => !Number.isNaN(t))
    .reduce((max, t) => (t > max ? t : max), 0);
  const feedLastBuild = new Date(newest).toUTCString();

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
    <lastBuildDate>${feedLastBuild}</lastBuildDate>
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
if (pruned.length) console.log(`Pruned ${pruned.length} orphaned page(s) whose source is gone: ${pruned.join(", ")}`);
console.log(`Mermaid bundle vendored: ${existsSync(mermaidDst)}. Fonts vendored: ${fontsCopied}/${FONT_FILES.length}.`);
console.log(`Highlighted ${HIGHLIGHTED_BLOCKS} code block(s) at build time. On-this-page rail on ${tocPages} page(s).`);
console.log(`Search index: ${SEARCH_RECORDS.length} records, ${(searchIndexBytes / 1024).toFixed(0)} KB MiniSearch index (fetched once, on first search, alongside the ${(existsSync(miniSearchDst) ? statSync(miniSearchDst).size / 1024 : 0).toFixed(0)} KB library).`);
console.log(`Rendered ${ARTICLES.length} article cards into writing.html (${publishedArticles.length} published) and ${adrFiles.length} ADR cards into platform.html.`);
console.log(`Generated feed.xml (${publishedArticles.length} items) and sitemap.xml (${sitemapUrls} URLs).`);

/* Dead cross-links: rendered as plain text, never as a broken href, so they cannot
   break a page. Reported here because a link pointing outside the published set is
   usually a typo in the source markdown (a wrong "../" prefix), not a deliberate
   reference to something unpublished. Grouped by target so a systematic mistake
   stands out from the genuine one-offs. */
if (DEAD_LINKS.length === 0) {
  console.log("Dead cross-links: none.");
} else {
  const byTarget = new Map();
  for (const d of DEAD_LINKS) byTarget.set(d.href, (byTarget.get(d.href) || 0) + 1);
  const ranked = [...byTarget.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Dead cross-links: ${DEAD_LINKS.length} across ${new Set(DEAD_LINKS.map((d) => d.page)).size} page(s), rendered as plain text.`);
  for (const [href, count] of ranked) console.log(`  ${String(count).padStart(3)}x  ${href}`);
}

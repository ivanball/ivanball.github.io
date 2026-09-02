/* Global site search.

   The index (assets/data/search-index.json) is a real inverted index, built by
   MiniSearch at build time in tools/build-docs.mjs and serialized: one record
   per H2 section of every reference document, plus the hand-authored pages and
   the published article series. The browser loads a finished index rather than
   building one, which is the only way a 7.6 MB corpus is searchable client-side
   at all.

   Nothing here ships to a visitor who never searches. On the FIRST open this
   injects assets/js/minisearch.js (vendored, first-party) and then fetches the
   index; before that the page has downloaded neither.

   The library and the generator must tokenize identically, so neither side
   customizes tokenize or processTerm: a function cannot cross JSON, and the
   runtime reads the field options back out of the index envelope precisely so
   the two cannot drift.

   One consequence worth knowing: a "quoted phrase" is no longer positional.
   The index stores no term positions, so a phrase means all of those words in
   the same record, which for section-sized records is close enough to be
   useful and is what the dialog's foot hint now says.

   Markup comes from searchDialogHtml() in the generator and is present on every
   page. If this script never runs, the button simply does nothing, which is the
   right failure: nothing else on the page depends on it. */
(function () {
  "use strict";

  var INDEX_URL = "/assets/data/search-index.json";
  /* Root-absolute like the index, so search works from any depth, including the
     404 page served for a miss under /docs/adr/. */
  var LIB_URL = "/assets/js/minisearch.js";
  var MAX_RESULTS = 25;
  var MIN_QUERY = 2;

  /* Prefix matching from three characters on, so a half-typed "outb" still
     finds the outbox pages, while one- and two-letter fragments do not drag in
     the whole corpus. Fuzzy is off: in a reference library a near-miss on a
     type name is a wrong answer dressed as a right one.

     The field weights say what a hit MEANS: a section title is what the section
     is about, an identifier is the most specific thing anyone types here, and
     the body is the broad net underneath both.

     boostDocument carries the one thing BM25 gets wrong for a reference
     library: specificity. A 3,000-word section that says "outbox" thirty times
     outscores ADR-003, whose entire title is the word, because term frequency
     is what BM25 rewards and a title has one. So a record whose SHORT title
     (60 chars or fewer) contains the matched term is lifted: sections modestly,
     document records (the ones with no section title, where the title IS the
     document) hard enough to put "ADR-003: Outbox Pattern with Dual Dispatch"
     on the first screen for "outbox" instead of at position 24. Document
     records also get a small nudge over their own sections when they score
     comparably: the reader gets the whole document rather than one slice. */
  var SEARCH_OPTIONS = {
    prefix: function (term) { return term.length >= 3; },
    fuzzy: false,
    boost: { t: 3, d: 2, i: 2.5, b: 1 },
    boostDocument: function (id, term, stored) {
      if (!stored) { return 1; }
      var title = stored.t || stored.d || "";
      var m = stored.t ? 1 : 1.1;
      if (title.length <= 60 && (" " + normalize(title) + " ").indexOf(" " + term) !== -1) {
        m *= stored.t ? 1.6 : 4;
      }
      return m;
    }
  };

  var dialog, input, list, status;
  var records = null;          // the loaded MiniSearch index
  var libPromise = null;       // in-flight (or settled) load of the library
  var loading = false;
  var active = -1;             // highlighted result
  var lastQuery = "";

  /* ----- loading ----- */

  /* Injected once and cached in libPromise, so reopening the dialog while the
     script is still in flight does not add a second tag. A FAILED load clears
     the cache, because the next open should be allowed to try again. */
  function loadLibrary() {
    if (window.MiniSearch) { return Promise.resolve(); }
    if (libPromise) { return libPromise; }
    libPromise = new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = LIB_URL;
      el.async = true;
      el.onload = function () {
        if (window.MiniSearch) { resolve(); } else { reject(new Error("library unavailable")); }
      };
      el.onerror = function () { reject(new Error("library unavailable")); };
      document.head.appendChild(el);
    });
    return libPromise;
  }

  function load() {
    if (records || loading) { return Promise.resolve(); }
    loading = true;
    setStatus("Loading the index…");
    return loadLibrary()
      .then(function () { return fetch(INDEX_URL, { credentials: "omit" }); })
      .then(function (r) {
        if (!r.ok) { throw new Error("HTTP " + r.status); }
        return r.json();
      })
      .then(function (data) {
        /* The envelope carries the options the index was built with, so the
           runtime never restates them and the two cannot disagree. */
        records = window.MiniSearch.loadJS(data.i, data.o);
        loading = false;
        setStatus("");
        if (input.value.trim()) { run(input.value); }
      })
      .catch(function (err) {
        loading = false;
        libPromise = null;
        records = null;
        setStatus("Search is unavailable right now (" + err.message + ").");
      });
  }

  /* ----- normalization -----
     Punctuation collapses to a single space on BOTH sides of a comparison, so a
     phrase search for "soft delete" still finds "Soft-Delete". This corpus is
     full of hyphenated terms (database-per-service, dual-dispatch), and a phrase
     search that misses all of them would be a trap rather than a feature.

     Dots and underscores split too, matching MiniSearch's default tokenizer,
     which treats both as punctuation. That is the whole reason the character
     class looks the way it does: whatever the index did to the text, the query
     has to do as well. `MMCA.Common.API` therefore becomes three words, ANDed
     together, which finds the same records the one-token form used to. */
  function normalize(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9#+]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /* ----- query parsing -----
     The grammar, smallest thing that covers how people actually type:

       outbox stripe            bare words, OR by default
       outbox AND stripe        both required
       "dual dispatch"          both words, in the same record
       "soft delete" AND gdpr   mix freely

     AND and OR are operators only in UPPERCASE, so searching for the word "and"
     still works. AND binds tighter than OR, which is the convention everywhere
     else: the query becomes OR-groups of AND-ed items, and a record qualifies if
     any one group matches completely. Smart quotes count, because that is what a
     paste from a document carries; an unterminated quote runs to the end rather
     than failing, since it is almost always a query still being typed. */
  function parseQuery(raw) {
    var s = String(raw);
    var items = [];
    var ops = [];
    var i = 0;
    var expectOperand = true;

    while (i < s.length) {
      var ch = s.charAt(i);
      if (/\s/.test(ch)) { i++; continue; }

      if (ch === '"' || ch === "“" || ch === "”") {
        var close = s.length;
        for (var j = i + 1; j < s.length; j++) {
          var c = s.charAt(j);
          if (c === '"' || c === "“" || c === "”") { close = j; break; }
        }
        var phrase = normalize(s.slice(i + 1, close));
        i = close + 1;
        if (!phrase) { continue; }
        if (!expectOperand) { ops.push("OR"); }
        items.push({ phrase: true, norm: phrase });
        expectOperand = false;
        continue;
      }

      var end = i;
      while (end < s.length && !/[\s"“”]/.test(s.charAt(end))) { end++; }
      var token = s.slice(i, end);
      i = end;

      if (token === "AND" || token === "OR") {
        /* A leading or doubled operator is noise from a half-typed query. */
        if (!expectOperand) { ops.push(token); expectOperand = true; }
        continue;
      }
      var term = normalize(token);
      if (!term) { continue; }
      if (!expectOperand) { ops.push("OR"); }
      /* A token that normalizes to several words (someone typed a-b, or a
         dotted name) behaves as the phrase it visibly is. */
      items.push({ phrase: term.indexOf(" ") !== -1, norm: term });
      expectOperand = false;
    }

    /* AND binds tighter: fold the item list into OR-groups. */
    var groups = [];
    var current = [];
    for (var k = 0; k < items.length; k++) {
      if (k > 0 && ops[k - 1] === "OR") { groups.push(current); current = []; }
      current.push(items[k]);
    }
    if (current.length) { groups.push(current); }

    return { items: items, groups: groups };
  }

  /* The parsed grammar, expressed as a MiniSearch query. The shapes line up one
     for one: an item whose normalized form is several words is an AND of those
     words (a phrase, minus the positions the index does not carry), a group is
     an AND of its items, and the query is an OR of its groups. */
  function toQuery(parsed) {
    var groups = parsed.groups.map(function (group) {
      return {
        combineWith: "AND",
        queries: group.map(function (item) {
          var words = item.norm.split(" ");
          return words.length === 1 ? words[0] : { combineWith: "AND", queries: words };
        })
      };
    });
    return { combineWith: "OR", queries: groups };
  }

  function search(parsed) {
    if (!parsed.items.length) { return []; }
    return records.search(toQuery(parsed), SEARCH_OPTIONS).slice(0, MAX_RESULTS);
  }

  /* How the query was read, echoed back under the input. This is the only
     documentation the operators get, and it is the moment it is useful. */
  function describe(parsed) {
    return parsed.groups.map(function (group) {
      return group.map(function (it) {
        return it.phrase ? '"' + it.norm + '"' : it.norm;
      }).join(" AND ");
    }).join(" OR ");
  }

  /* ----- rendering ----- */

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Mark the matched terms in already-escaped text. Done on the escaped string
     so a record can never inject markup.

     The terms come from the result itself, not from the typed query: those are
     the index terms that actually matched, so a prefix match on "outb" lights
     up the word the index matched it against. Each is anchored at a word start
     and allowed to run to the end of its word, so the reader sees a whole word
     highlighted rather than a fragment of one. The character before the match
     excludes & so an escaped entity cannot be lit up from the inside. */
  function mark(text, terms) {
    var out = escapeHtml(text);
    if (!terms || !terms.length) { return out; }
    var alternatives = terms.slice()
      .sort(function (a, b) { return b.length - a.length; })
      .map(escapeRe)
      .join("|");
    var re = new RegExp("(^|[^a-z0-9&#])((?:" + alternatives + ")[a-z0-9]*)", "gi");
    return out.replace(re, function (whole, before, word) {
      return before + "<mark>" + word + "</mark>";
    });
  }

  /* Everything rendered comes from the stored fields MiniSearch hands back on
     the result: u (url), d (document title), k (kind), t (section title),
     x (excerpt), e (leaves the site). */
  function render(hits) {
    list.innerHTML = hits.map(function (r, i) {
      var heading = r.t || r.d;
      var context = r.t ? r.d : r.k;
      var external = r.e ? ' target="_blank" rel="noopener"' : "";
      return '<li class="search-result"' + (i === 0 ? ' data-active="true"' : "") + '>' +
        '<a href="' + escapeHtml(r.u) + '"' + external + '>' +
          '<span class="search-kind">' + escapeHtml(r.k) + (r.e ? " ↗" : "") + '</span>' +
          '<span class="search-title">' + mark(heading, r.terms) + '</span>' +
          '<span class="search-context">' + escapeHtml(context) + '</span>' +
          (r.x ? '<span class="search-excerpt">' + mark(r.x, r.terms) + '</span>' : "") +
        '</a></li>';
    }).join("");
    active = hits.length ? 0 : -1;
  }

  function setStatus(text) { status.textContent = text; }

  function run(q) {
    lastQuery = q;
    if (!records) { load(); return; }
    var parsed = parseQuery(q);
    var longest = parsed.items.reduce(function (n, it) { return Math.max(n, it.norm.length); }, 0);
    if (!parsed.items.length || longest < MIN_QUERY) {
      list.innerHTML = "";
      active = -1;
      setStatus(q.trim() ? "Keep typing…" : "");
      return;
    }
    var hits = search(parsed);
    render(hits);
    var reading = parsed.items.length > 1 ? " · " + describe(parsed) : "";
    if (!hits.length) {
      setStatus("No results for " + describe(parsed) + ".");
      return;
    }
    /* Echoing the reading back is what makes the operators discoverable: a
       two-word query visibly reports itself as "a OR b", which is also how a
       visitor learns AND exists. */
    setStatus(hits.length + (hits.length === MAX_RESULTS ? "+ results" : " result" + (hits.length === 1 ? "" : "s")) + reading);
  }

  /* ----- keyboard navigation ----- */

  function items() { return list.querySelectorAll(".search-result"); }

  function move(delta) {
    var all = items();
    if (!all.length) { return; }
    if (active >= 0 && all[active]) { all[active].removeAttribute("data-active"); }
    active = (active + delta + all.length) % all.length;
    all[active].setAttribute("data-active", "true");
    all[active].scrollIntoView({ block: "nearest" });
  }

  function openCurrent() {
    var all = items();
    if (active < 0 || !all[active]) { return; }
    var link = all[active].querySelector("a");
    if (link) { link.click(); }
  }

  /* ----- open / close ----- */

  function open(seed) {
    if (!dialog || dialog.open) { return; }
    dialog.showModal();
    input.value = seed || "";
    load();
    run(input.value);
    input.focus();
  }

  function close() {
    if (dialog && dialog.open) { dialog.close(); }
  }

  function init() {
    dialog = document.getElementById("site-search");
    if (!dialog || typeof dialog.showModal !== "function") { return; }
    input = dialog.querySelector(".search-input");
    list = dialog.querySelector(".search-results");
    status = dialog.querySelector(".search-status");

    document.querySelectorAll("[data-search-open]").forEach(function (btn) {
      btn.addEventListener("click", function () { open(""); });
    });
    dialog.querySelectorAll("[data-search-close]").forEach(function (btn) {
      btn.addEventListener("click", close);
    });

    /* Clicking the backdrop closes. The dialog fills its own box, so a click
       whose target IS the dialog element landed outside the panel. */
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) { close(); }
    });

    var debounce = null;
    input.addEventListener("input", function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () { run(input.value); }, 90);
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); openCurrent(); }
    });

    /* Ctrl/Cmd+K anywhere, and "/" when the visitor is not already typing. */
    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        dialog.open ? close() : open("");
      } else if (e.key === "/" && !typing && !dialog.open) {
        e.preventDefault();
        open("");
      }
    });

    /* Re-running on reopen keeps the previous query's results in place. */
    dialog.addEventListener("close", function () { lastQuery = input.value; });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

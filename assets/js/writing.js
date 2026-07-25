/* Progressive enhancement for the Writing page.

   The cards themselves are STATIC: tools/build-docs.mjs renders them into
   writing.html at build time from assets/data/articles.js, so crawlers, feed
   readers, and no-JS visitors get the full index. This file only adds the
   filter behavior on top, hiding and showing the nodes that are already there.

   It deliberately does not re-render the grid. Rewriting innerHTML from the
   data would throw away the server-visible markup and reintroduce the problem
   the static rendering solved. */
(function () {
  "use strict";

  var grid = document.getElementById("articles-grid");
  var filterBar = document.getElementById("article-filters");
  var countNote = document.getElementById("article-count");
  if (!grid) { return; }

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".article-card"));
  if (!cards.length) { return; }

  var categories = window.ARTICLE_CATEGORIES || [{ key: "all", label: "All" }];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function apply(filter) {
    var shown = 0;
    cards.forEach(function (card) {
      var match = filter === "all" || card.getAttribute("data-cat") === filter;
      card.hidden = !match;
      if (match) { shown++; }
    });
    if (countNote) {
      countNote.textContent = "Showing " + shown + " of " + cards.length + " articles.";
    }
  }

  function buildFilters() {
    if (!filterBar) { return; }
    filterBar.innerHTML = categories.map(function (c, i) {
      return '<button class="filter-btn" type="button" data-filter="' + escapeHtml(c.key) + '" aria-pressed="' + (i === 0) + '">' +
        escapeHtml(c.label) + "</button>";
    }).join("");

    filterBar.addEventListener("click", function (e) {
      var btn = e.target.closest(".filter-btn");
      if (!btn) { return; }
      filterBar.querySelectorAll(".filter-btn").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      apply(btn.getAttribute("data-filter"));
    });
  }

  buildFilters();
  apply("all");
})();

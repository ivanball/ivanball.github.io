/* Renders the Writing article cards from window.ARTICLES and wires the filters.
   Loaded after assets/data/articles.js. No dependencies. */
(function () {
  "use strict";

  var grid = document.getElementById("articles-grid");
  var filterBar = document.getElementById("article-filters");
  var countNote = document.getElementById("article-count");
  if (!grid || !window.ARTICLES) { return; }

  var categories = window.ARTICLE_CATEGORIES || [{ key: "all", label: "All" }];
  var catLabel = {};
  categories.forEach(function (c) { catLabel[c.key] = c.label; });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function cardHtml(a) {
    var thumb = a.hero
      ? '<img src="' + escapeHtml(a.hero) + '" alt="" loading="lazy">'
      : '<span class="thumb-num" aria-hidden="true">' + a.n + '</span>';

    var adrTag = a.adr ? '<li class="tag tag--accent">' + escapeHtml(a.adr) + "</li>" : "";

    var foot = a.url
      ? '<a href="' + escapeHtml(a.url) + '" target="_blank" rel="noopener">Read on Medium ↗</a>'
      : '<span class="coming-soon">● Coming soon</span>';

    return '' +
      '<article class="card card--link article-card" data-cat="' + escapeHtml(a.cat) + '">' +
        '<div class="thumb">' + thumb + "</div>" +
        '<div class="body">' +
          '<span class="kicker">' + escapeHtml(catLabel[a.cat] || "Article") + " · No. " + a.n + "</span>" +
          "<h3>" + escapeHtml(a.title) + "</h3>" +
          "<p>" + escapeHtml(a.summary) + "</p>" +
          (adrTag ? '<ul class="tags" style="margin-bottom:0.85rem">' + adrTag + "</ul>" : "") +
          '<div class="card-foot">' + foot + "</div>" +
        "</div>" +
      "</article>";
  }

  function render(filter) {
    var items = window.ARTICLES.filter(function (a) {
      return filter === "all" || a.cat === filter;
    });
    grid.innerHTML = items.map(cardHtml).join("");
    if (countNote) {
      countNote.textContent = "Showing " + items.length + " of " + window.ARTICLES.length + " articles.";
    }
  }

  function buildFilters() {
    if (!filterBar) { return; }
    filterBar.innerHTML = categories.map(function (c, i) {
      return '<button class="filter-btn" type="button" data-filter="' + c.key + '" aria-pressed="' + (i === 0) + '">' +
        escapeHtml(c.label) + "</button>";
    }).join("");

    filterBar.addEventListener("click", function (e) {
      var btn = e.target.closest(".filter-btn");
      if (!btn) { return; }
      filterBar.querySelectorAll(".filter-btn").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      render(btn.getAttribute("data-filter"));
    });
  }

  buildFilters();
  render("all");
})();

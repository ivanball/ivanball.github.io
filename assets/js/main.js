/* Shared site behavior: theme toggle, mobile nav, email de-obfuscation, footer year.
   No dependencies. Safe to load with `defer` on every page. */
(function () {
  "use strict";

  /* ----- Contact email (assembled in JS to reduce scraping) -----
     Single edit point. Switch the user/domain here to change the published address. */
  var EMAIL_USER = "ivanball_76";
  var EMAIL_DOMAIN = "yahoo.com";

  /* ----- Theme toggle ----- */
  var STORAGE_KEY = "mmca-theme";
  var root = document.documentElement;

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
  }

  function currentlyDark() {
    var explicit = root.getAttribute("data-theme");
    if (explicit) { return explicit === "dark"; }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function initThemeToggle() {
    var btn = document.querySelector(".theme-toggle");
    if (!btn) { return; }
    btn.addEventListener("click", function () {
      var next = currentlyDark() ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignore */ }
      btn.setAttribute("aria-label", next === "dark" ? "Switch to light theme" : "Switch to dark theme");
    });
  }

  /* ----- Mobile nav ----- */
  function initNavToggle() {
    var toggle = document.querySelector(".nav-toggle");
    var links = document.getElementById("nav-links");
    if (!toggle || !links) { return; }
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ----- Email de-obfuscation -----
     Markup: <a class="js-email" data-subject="..."><span>see email</span></a>
     or any element with class "js-email-text" to receive the address as text. */
  function initEmail() {
    var address = EMAIL_USER + "@" + EMAIL_DOMAIN;
    document.querySelectorAll(".js-email").forEach(function (el) {
      var subject = el.getAttribute("data-subject");
      el.setAttribute("href", "mailto:" + address + (subject ? "?subject=" + encodeURIComponent(subject) : ""));
      var slot = el.querySelector(".js-email-text");
      if (slot) { slot.textContent = address; }
      else if (!el.textContent.trim()) { el.textContent = address; }
    });
    document.querySelectorAll(".js-email-text:not(.js-email .js-email-text)").forEach(function (el) {
      el.textContent = address;
    });
  }

  /* ----- Footer year ----- */
  function initYear() {
    document.querySelectorAll(".js-year").forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  /* ----- Reference-doc sidebar: collapse the long collection nav on small
     screens so the content leads; leave it open on wider viewports. ----- */
  function initDocSidebar() {
    var details = document.querySelector(".doc-sidebar-details");
    if (!details) { return; }
    if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
      details.removeAttribute("open");
    }
  }

  /* ----- Scroll reveal -----
     Opt-in via data-reveal. The CSS only hides the element inside a
     (prefers-reduced-motion: no-preference) block, so if this never runs, or the
     visitor asked for reduced motion, the content is visible either way. Elements
     are unobserved once shown: this is a one-shot entrance, not a scroll effect. */
  function initReveal() {
    var targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) { return; }
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      targets.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) { return; }
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ----- On-this-page rail -----
     Highlights the heading currently in view on long reference documents. The
     rail itself is generated at build time, so this only adds the active state. */
  function initDocToc() {
    var links = document.querySelectorAll(".doc-toc a");
    if (!links.length || !("IntersectionObserver" in window)) { return; }
    var byId = {};
    var headings = [];
    links.forEach(function (link) {
      var id = link.getAttribute("href").slice(1);
      var heading = document.getElementById(id);
      if (!heading) { return; }
      byId[id] = link;
      headings.push(heading);
    });
    if (!headings.length) { return; }

    var visible = [];
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.id;
        var at = visible.indexOf(id);
        if (entry.isIntersecting && at === -1) { visible.push(id); }
        else if (!entry.isIntersecting && at !== -1) { visible.splice(at, 1); }
      });
      /* Pick the topmost heading still in the band; falling back to the last one
         passed keeps a section marked while the reader is in the middle of it. */
      var current = null;
      headings.forEach(function (h) {
        if (visible.indexOf(h.id) !== -1 && !current) { current = h.id; }
      });
      if (!current) { return; }
      links.forEach(function (link) { link.removeAttribute("aria-current"); });
      if (byId[current]) { byId[current].setAttribute("aria-current", "true"); }
    }, { rootMargin: "-84px 0px -70% 0px", threshold: 0 });
    headings.forEach(function (h) { io.observe(h); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initNavToggle();
    initEmail();
    initYear();
    initDocSidebar();
    initReveal();
    initDocToc();
  });
})();

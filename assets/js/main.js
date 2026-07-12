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

  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initNavToggle();
    initEmail();
    initYear();
    initDocSidebar();
  });
})();

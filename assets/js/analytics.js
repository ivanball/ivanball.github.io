/* ============================================================================
   Analytics and newsletter wiring: the SINGLE edit point for both.

   Loaded with `defer` on every hand-authored page AND injected into every
   generated docs page by tools/build-docs.mjs, so one edit here covers the
   whole site (7 hand-authored pages plus the generated reference library).

   Nothing is loaded, sent, or shown while the values below are placeholders:
   no network request is made, no cookie is set, and the newsletter form stays
   hidden. Replace a placeholder and that feature turns itself on.

   TO ACTIVATE
   -----------
   1. GA4: create a property at https://analytics.google.com, copy its
      Measurement ID (looks like G-ABC1234XYZ), and paste it below.
   2. Newsletter: create a list (Buttondown's free tier embeds with a plain
      form POST), then paste its form action URL below.
   3. Search Console / Bing verification are META TAGS, not script: they must
      be present in the served HTML before the crawler will accept them. The
      placeholders live in the <head> of index.html.
   ============================================================================ */
(function () {
  "use strict";

  /* --- 1. Google Analytics 4 ------------------------------------------- */
  /* Property "ivanball.github.io", web stream "Personal site". */
  var GA4_MEASUREMENT_ID = "G-79V9WXLJ1V";

  /* --- 2. Newsletter form action --------------------------------------- */
  /* e.g. "https://buttondown.com/api/emails/embed-subscribe/ivanball" */
  var NEWSLETTER_FORM_ACTION = "";

  /* --------------------------------------------------------------------- */

  var gaConfigured = /^G-[A-Z0-9]{6,}$/.test(GA4_MEASUREMENT_ID) &&
    GA4_MEASUREMENT_ID !== "G-XXXXXXXXXX";
  var listConfigured = /^https:\/\//.test(NEWSLETTER_FORM_ACTION);

  window.SITE_ANALYTICS = {
    ga4: gaConfigured ? GA4_MEASUREMENT_ID : null,
    newsletter: listConfigured ? NEWSLETTER_FORM_ACTION : null
  };

  if (gaConfigured) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA4_MEASUREMENT_ID);

    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA4_MEASUREMENT_ID);
    document.head.appendChild(s);
  }

  /* Newsletter forms are authored hidden so a half-configured site never shows
     a form that silently drops addresses. They reveal themselves only once an
     action URL exists. */
  function wireNewsletter() {
    var forms = document.querySelectorAll("form[data-newsletter]");
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      if (!listConfigured) { continue; }
      form.setAttribute("action", NEWSLETTER_FORM_ACTION);
      var wrap = form.closest("[data-newsletter-wrap]") || form;
      wrap.hidden = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireNewsletter);
  } else {
    wireNewsletter();
  }
})();

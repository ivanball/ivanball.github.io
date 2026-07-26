/* ============================================================================
   Platform figures that originate OUTSIDE this repo.

   The ADR count is derived by the build from docs-src/adr/, so it is not here.
   These four come from MMCA.Common (FACTS.md is their source of truth) and the
   Website repo cannot read that repo at build time: CI checks out this repo
   alone. So they are mirrored here, in one place, and tools/build-docs.mjs
   stamps them into every page that quotes them.

   Before this file existed, resume.html and platform.html each hand-typed
   these numbers and had already drifted apart: the resume claimed 91 fitness
   tests and 51 ADRs while the platform page said 93 and 55.

   TO UPDATE: refresh these against MMCA.Common/FACTS.md as part of the
   consumer sweep that follows a framework release, then `npm run build`.
   ============================================================================ */
window.PLATFORM_FACTS = {
  /* FACTS.md "Published packages" */
  packages: 15,
  /* FACTS.md "Architecture fitness functions": test methods, not base classes */
  fitnessTests: 93,
  /* Store, ADC, Helpdesk */
  referenceApps: 3,
  /* docs-src/governance/ArchitectureEvaluationCriteria.md */
  rubricCategories: 34,
};

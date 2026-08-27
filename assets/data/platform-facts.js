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
  packages: 16,
  /* The same 16 packages, grouped by the layer they serve, for the stack on
     platform.html. The count above is derived from this list at build time, so a
     package added here cannot leave the headline figure behind (the hand-typed
     pill list this replaced had drifted to 13 while the copy still said fifteen).
     `edge` marks the layers that exist to make extraction possible. */
  packageLayers: [
    { name: "Shared", note: "Result pattern, value objects, error handling, DTOs", items: ["MMCA.Common.Shared"] },
    { name: "Domain", note: "Entities, aggregate roots, domain events, specifications", items: ["MMCA.Common.Domain"] },
    { name: "Application", note: "CQRS handlers, the decorator pipeline, the module system", items: ["MMCA.Common.Application"] },
    { name: "Infrastructure", note: "EF Core multi-engine, repositories, caching, outbox, message bus, multi-tenancy, audit trail, job scheduler", items: ["MMCA.Common.Infrastructure"] },
    { name: "API &amp; transport", note: "Controllers, middleware, idempotency, JWKS, gRPC contracts", items: ["MMCA.Common.API", "MMCA.Common.Grpc"], edge: true },
    { name: "UI", note: "Blazor shared components, MudBlazor theme, web and MAUI clients", items: ["MMCA.Common.UI", "MMCA.Common.UI.Web", "MMCA.Common.UI.Maui"] },
    { name: "Hosting", note: "Aspire service defaults, OpenTelemetry, health checks, broker wiring, YARP gateway composition", items: ["MMCA.Common.Aspire", "MMCA.Common.Aspire.Hosting", "MMCA.Common.Gateway"], edge: true },
    { name: "Testing", note: "Integration bases, architecture rule library, Playwright and bUnit harnesses", items: ["MMCA.Common.Testing", "MMCA.Common.Testing.Architecture", "MMCA.Common.Testing.E2E", "MMCA.Common.Testing.UI"] },
  ],
  /* FACTS.md "Architecture fitness functions": test methods, not base classes */
  fitnessTests: 119,
  /* Store, ADC, Helpdesk */
  referenceApps: 3,
  /* docs-src/governance/ArchitectureEvaluationCriteria.md */
  rubricCategories: 34,
};

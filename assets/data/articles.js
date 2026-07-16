/* ============================================================================
   Writing data: the MMCA.Common deep-dive series (41 articles).
   This is the SINGLE edit point for the Writing page.

   Each entry:
     n       article number (also the reading order)
     title   article title
     summary one-line teaser
     cat      category key (see CATEGORIES below) used for filtering
     adr      optional ADR reference shown as a small tag (e.g. "ADR 006")
     hero     optional image path; when empty a numbered placeholder is shown
     url      Medium URL; when empty the card shows "Coming soon"

   To publish a link: paste the Medium URL into that entry's `url`.
   ============================================================================ */

window.ARTICLE_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "orient", label: "Orientation" },
  { key: "core", label: "Core patterns" },
  { key: "data", label: "Data & persistence" },
  { key: "auth", label: "Auth & the edge" },
  { key: "run", label: "Run & extract" },
  { key: "proof", label: "Proof & getting started" }
];

window.ARTICLES = [
  { n: 1,  cat: "orient", hero: "assets/img/articles/article-01.png", title: "Open-sourced and graded against 34 categories", summary: "Why I open-sourced a production .NET framework and scored it against a 34-category architecture rubric, gaps and all.", url: "https://medium.com/@ivanball76/i-open-sourced-the-enterprise-net-77f9200f3728" },
  { n: 2,  cat: "orient", hero: "assets/img/articles/article-02.png", adr: "ADR 006/007/008", title: "Modular monolith to microservices", summary: "The cornerstone idea: build the monolith now and extract a service later with no rewrite, via module discovery, gRPC contracts, and a YARP gateway.", url: "https://medium.com/@ivanball76/modular-monolith-to-microservices-without-the-rewrite-8c3603614f12" },
  { n: 3,  cat: "orient", hero: "assets/img/articles/article-03.png", title: "The 34-category architecture rubric", summary: "A two-axis rubric for scoring architecture on maturity and implementation, so 'good architecture' stops being a vibe.", url: "https://medium.com/@ivanball76/what-good-architecture-actually-means-a-34-category-rubric-you-can-score-yourself-against-4002291a6b6a" },
  { n: 4,  cat: "core", hero: "assets/img/articles/article-04.png", adr: "ADR 013", title: "The Result railway in C#", summary: "Model expected failures as Result values with a transport-agnostic error type, and keep exceptions for the genuinely exceptional.", url: "https://medium.com/@ivanball76/stop-throwing-exceptions-for-control-flow-the-result-railway-in-c-7a02050b554e" },
  { n: 5,  cat: "core", hero: "assets/img/articles/article-05.png", title: "Kill the anemic domain model", summary: "Push behavior into rich aggregates with factory methods and invariants instead of bags of public setters.", url: "https://medium.com/@ivanball76/kill-the-anemic-domain-model-rich-aggregates-with-factory-methods-that-return-result-44f2e3d89794" },
  { n: 6,  cat: "core", hero: "assets/img/articles/article-06.png", title: "Specifications over LINQ spaghetti", summary: "Compose queries from reusable specification objects instead of scattering LINQ across handlers.", url: "https://medium.com/@ivanball76/specifications-over-linq-spaghetti-composable-reusable-query-intent-8a40dafcbd3d" },
  { n: 7,  cat: "core", hero: "assets/img/articles/article-07.png", adr: "ADR 014/031", title: "The CQRS decorator pipeline", summary: "Thin command and query handlers wrapped by a Scrutor decorator chain whose order is load-bearing.", url: "https://medium.com/@ivanball76/the-cqrs-decorator-pipeline-logging-caching-and-transactions-without-touching-a-handler-fb7679b8bde8" },
  { n: 8,  cat: "core", hero: "assets/img/articles/article-08.png", title: "Compose validators, don't copy them", summary: "A validation kit that composes FluentValidation rules instead of copy-pasting them across features.", url: "https://medium.com/@ivanball76/compose-validators-dont-copy-them-a-reusable-fluentvalidation-kit-8865a6003a9c" },
  { n: 9,  cat: "core", hero: "assets/img/articles/article-09.png", adr: "ADR 003", title: "The transactional outbox", summary: "Events that survive a crash: persist them atomically with your data, then dispatch at least once.", url: "https://medium.com/@ivanball76/the-transactional-outbox-in-net-10-never-lose-an-event-again-f5a9b7a89e51" },
  { n: 10, cat: "data", hero: "assets/img/articles/article-10.png", adr: "ADR 006", title: "Database-per-service inside a monolith", summary: "Give each module its own database and outbox before you extract it, so extraction changes hosting, not data.", url: "https://medium.com/@ivanball76/database-per-service-inside-a-monolith-and-why-265092eb03f1" },
  { n: 11, cat: "data", hero: "assets/img/articles/article-11.png", adr: "ADR 018", title: "Polyglot persistence: one model, three engines", summary: "SQL Server, Cosmos, and SQLite behind a single entity model, with the engine chosen by attribute.", url: "https://medium.com/@ivanball76/one-entity-model-three-databases-polyglot-persistence-behind-a-single-attribute-760e77974d5d" },
  { n: 12, cat: "data", hero: "assets/img/articles/article-12.png", adr: "ADR 002", title: "Navigation populators", summary: "Eager-load relationships that cross containers and data sources without N+1 or a leaky abstraction.", url: "https://medium.com/@ivanball76/ef-core-include-chains-are-a-trap-navigation-populators-decouple-eager-loading-c378fa4497ac" },
  { n: 13, cat: "data", hero: "assets/img/articles/article-13.png", adr: "ADR 035", title: "Optimistic concurrency: RowVersion round-trips", summary: "Carry the RowVersion from database to DTO and back, so a concurrent edit fails fast as a conflict instead of silently overwriting.", url: "https://medium.com/@ivanball76/optimistic-concurrency-that-survives-the-round-trip-rowversion-from-database-to-dto-and-back-93d4a794716f" },
  { n: 14, cat: "data", hero: "assets/img/articles/article-14.png", title: "Self-ordering modules", summary: "Modules declare their dependencies and load in topological order, so registration is never hand-sequenced.", url: "https://medium.com/@ivanball76/self-ordering-modules-discovered-kahn-ordered-and-extractable-2ce7283a26b5" },
  { n: 15, cat: "data", hero: "assets/img/articles/article-15.png", adr: "ADR 010", title: "Event-schema versioning", summary: "Every integration event carries a schema version; breaking changes get a new event type and an upcaster, never a silent reshape.", url: "https://medium.com/@ivanball76/event-schema-versioning-never-silently-reshape-an-event-93cd5d4a156d" },
  { n: 16, cat: "auth", hero: "assets/img/articles/article-16.png", adr: "ADR 004", title: "JWKS cross-service auth", summary: "Validate another service's RS256 tokens via JWKS discovery, with no shared secret crossing a boundary.", url: "https://medium.com/@ivanball76/cross-service-auth-without-a-shared-secret-jwks-dual-fetch-478e6f688c7e" },
  { n: 17, cat: "auth", hero: "assets/img/articles/article-17.png", adr: "ADR 032", title: "Password hashing done right", summary: "The non-negotiables of password storage in .NET, done correctly and tested.", url: "https://medium.com/@ivanball76/password-hashing-done-right-pbkdf2-sha512-600k-iterations-timing-safe-d64ddb802403" },
  { n: 18, cat: "auth", hero: "assets/img/articles/article-18.png", adr: "ADR 017/021", title: "Idempotency in one attribute", summary: "Dedup client retries with an Idempotency-Key header and cached replay, plus a consumer-side inbox for brokers.", url: "https://medium.com/@ivanball76/idempotency-in-one-attribute-safe-retries-for-http-apis-065848fd03f4" },
  { n: 19, cat: "auth", adr: "ADR 026/040", title: "The self-invalidating cache", summary: "A caching decorator where commands invalidate and queries populate, plus an authenticated output-cache tier at the API edge.", url: "" },
  { n: 20, cat: "auth", title: "Problem Details across HTTP and gRPC", summary: "One error contract mapped consistently to HTTP Problem Details and gRPC status.", url: "" },
  { n: 21, cat: "auth", adr: "ADR 024", title: "Notifications as a vertical slice", summary: "A notifications feature built as a clean vertical slice across every layer.", url: "" },
  { n: 22, cat: "auth", adr: "ADR 039", title: "Live channels over one SignalR hub", summary: "Sub-second ephemeral events (polls, Q&A, live counts) fanned out over the existing notification hub, with nothing persisted.", url: "" },
  { n: 23, cat: "auth", adr: "ADR 001", title: "Delete AutoMapper: manual DTO mapping", summary: "Why source-generated, per-entity mappers beat reflection-based mapping for clarity and speed.", url: "" },
  { n: 24, cat: "auth", adr: "ADR 020", title: "Permission-based authorization over roles", summary: "A capability layer over RBAC: permission policies that resolve on demand from a central registry.", url: "" },
  { n: 25, cat: "auth", adr: "ADR 022", title: "Browser session-cookie auth for Blazor SSR", summary: "HttpOnly session cookies and an SSR-time scheme so [Authorize] passes during prerender, with the API still the boundary.", url: "" },
  { n: 26, cat: "auth", adr: "ADR 036", title: "External OAuth login behind your own JWTs", summary: "Sign in with Google or GitHub without leaking provider tokens: external identity exchanged for your own JWTs at the boundary.", url: "" },
  { n: 27, cat: "auth", adr: "ADR 034", title: "Generic entity controllers", summary: "A write-once REST surface every entity inherits, plus a bounded dynamic query contract that is never open SQL.", url: "" },
  { n: 28, cat: "auth", adr: "ADR 033", title: "Resource-ownership authorization", summary: "Beyond roles and permissions: which rows you may touch, enforced per resource.", url: "" },
  { n: 29, cat: "auth", adr: "ADR 019/029", title: "Rate limiting and brute-force protection", summary: "Two layers that cover the whole API edge: endpoint rate limits plus lockout-based brute-force defense on identity.", url: "" },
  { n: 30, cat: "run", adr: "ADR 023/025/041", title: "Aspire: one command", summary: "Model services, databases, and the broker as one Aspire graph that runs from laptop to Azure with one command.", url: "" },
  { n: 31, cat: "run", adr: "ADR 007/008/012", title: "Extracting a module to a gRPC service", summary: "A step-by-step extraction of an in-process module into its own gRPC service, database, and auth.", url: "" },
  { n: 32, cat: "run", adr: "ADR 009", title: "Resilience and recovery objectives", summary: "Standard resilience on every outbound client, plus declared RTO/RPO and a drilled restore.", url: "" },
  { n: 33, cat: "proof", adr: "ADR 015", title: "Architecture fitness functions", summary: "Architecture rules that fail the build: a compile-time layer guard plus a shared NetArchTest rule library.", url: "" },
  { n: 34, cat: "proof", title: "The test pyramid", summary: "How the framework's tests stack up: fast unit and architecture tests at the base, E2E at the tip.", url: "" },
  { n: 35, cat: "proof", adr: "ADR 005", title: "Soft-delete vs the right to erasure", summary: "Soft-delete for lifecycle, anonymization plus outbox purge for GDPR/CCPA erasure, and why both exist.", url: "" },
  { n: 36, cat: "proof", title: "A reusable Blazor UI framework", summary: "A shared Blazor and MudBlazor UI layer with accessibility enforced by axe in CI.", url: "" },
  { n: 37, cat: "proof", adr: "ADR 027/028", title: "i18n and theming on one preference pipeline", summary: "A culture choice and a theme choice ride the same cookie, profile column, and login reconciliation: one persistence path, two switches.", url: "" },
  { n: 38, cat: "proof", title: "Build your first module", summary: "A hands-on walkthrough of building a new module across all five layers.", url: "" },
  { n: 39, cat: "proof", adr: "ADR 015", title: "Write your first fitness test", summary: "Author your first architecture fitness test and watch it fail the build on a violation.", url: "" },
  { n: 40, cat: "proof", title: "Two real apps on one framework", summary: "A case study: a conference platform and an e-commerce store built on the same kernel.", url: "" },
  { n: 41, cat: "proof", title: "The series index", summary: "The full series index and recommended reading order.", url: "" }
];

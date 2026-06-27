/* ============================================================================
   Writing data: the MMCA.Common deep-dive series.
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
  { n: 5,  cat: "core", title: "Kill the anemic domain model", summary: "Push behavior into rich aggregates with factory methods and invariants instead of bags of public setters.", url: "" },
  { n: 6,  cat: "core", title: "Specifications over LINQ spaghetti", summary: "Compose queries from reusable specification objects instead of scattering LINQ across handlers.", url: "" },
  { n: 7,  cat: "core", adr: "ADR 014", title: "The CQRS decorator pipeline", summary: "Thin command and query handlers wrapped by a Scrutor decorator chain whose order is load-bearing.", url: "" },
  { n: 8,  cat: "core", title: "Compose validators, don't copy them", summary: "A validation kit that composes FluentValidation rules instead of copy-pasting them across features.", url: "" },
  { n: 9,  cat: "core", adr: "ADR 003", title: "The transactional outbox", summary: "Events that survive a crash: persist them atomically with your data, then dispatch at least once.", url: "" },
  { n: 10, cat: "data", adr: "ADR 006", title: "Database-per-service inside a monolith", summary: "Give each module its own database and outbox before you extract it, so extraction changes hosting, not data.", url: "" },
  { n: 11, cat: "data", adr: "ADR 018", title: "Polyglot persistence: one model, three engines", summary: "SQL Server, Cosmos, and SQLite behind a single entity model, with the engine chosen by attribute.", url: "" },
  { n: 12, cat: "data", adr: "ADR 002", title: "Navigation populators", summary: "Eager-load relationships that cross containers and data sources without N+1 or a leaky abstraction.", url: "" },
  { n: 13, cat: "data", title: "Self-ordering modules", summary: "Modules declare their dependencies and load in topological order, so registration is never hand-sequenced.", url: "" },
  { n: 14, cat: "data", adr: "ADR 010", title: "Event-schema versioning", summary: "Every integration event carries a schema version; breaking changes get a new event type and an upcaster, never a silent reshape.", url: "" },
  { n: 15, cat: "auth", adr: "ADR 004", title: "JWKS cross-service auth", summary: "Validate another service's RS256 tokens via JWKS discovery, with no shared secret crossing a boundary.", url: "" },
  { n: 16, cat: "auth", title: "Password hashing done right", summary: "The non-negotiables of password storage in .NET, done correctly and tested.", url: "" },
  { n: 17, cat: "auth", adr: "ADR 017/021", title: "Idempotency in one attribute", summary: "Dedup client retries with an Idempotency-Key header and cached replay, plus a consumer-side inbox for brokers.", url: "" },
  { n: 18, cat: "auth", title: "The self-invalidating cache", summary: "A caching decorator where commands invalidate and queries populate, so the cache stays correct on its own.", url: "" },
  { n: 19, cat: "auth", title: "Problem Details across HTTP and gRPC", summary: "One error contract mapped consistently to HTTP Problem Details and gRPC status.", url: "" },
  { n: 20, cat: "auth", title: "Notifications as a vertical slice", summary: "A notifications feature built as a clean vertical slice across every layer.", url: "" },
  { n: 21, cat: "auth", adr: "ADR 001", title: "Delete AutoMapper: manual DTO mapping", summary: "Why source-generated, per-entity mappers beat reflection-based mapping for clarity and speed.", url: "" },
  { n: 22, cat: "auth", adr: "ADR 020", title: "Permission-based authorization over roles", summary: "A capability layer over RBAC: permission policies that resolve on demand from a central registry.", url: "" },
  { n: 23, cat: "auth", adr: "ADR 022", title: "Browser session-cookie auth for Blazor SSR", summary: "HttpOnly session cookies and an SSR-time scheme so [Authorize] passes during prerender, with the API still the boundary.", url: "" },
  { n: 24, cat: "run", adr: "ADR 023", title: "Aspire: one command", summary: "Model services, databases, and the broker as one Aspire graph that runs from laptop to Azure with one command.", url: "" },
  { n: 25, cat: "run", adr: "ADR 007/008/012", title: "Extracting a module to a gRPC service", summary: "A step-by-step extraction of an in-process module into its own gRPC service, database, and auth.", url: "" },
  { n: 26, cat: "run", adr: "ADR 009", title: "Resilience and recovery objectives", summary: "Standard resilience on every outbound client, plus declared RTO/RPO and a drilled restore.", url: "" },
  { n: 27, cat: "proof", adr: "ADR 015", title: "Architecture fitness functions", summary: "Architecture rules that fail the build: a compile-time layer guard plus a shared NetArchTest rule library.", url: "" },
  { n: 28, cat: "proof", title: "The test pyramid", summary: "How the framework's tests stack up: fast unit and architecture tests at the base, E2E at the tip.", url: "" },
  { n: 29, cat: "proof", adr: "ADR 005", title: "Soft-delete vs the right to erasure", summary: "Soft-delete for lifecycle, anonymization plus outbox purge for GDPR/CCPA erasure, and why both exist.", url: "" },
  { n: 30, cat: "proof", title: "A reusable Blazor UI framework", summary: "A shared Blazor and MudBlazor UI layer with accessibility enforced by axe in CI.", url: "" },
  { n: 31, cat: "proof", title: "Build your first module", summary: "A hands-on walkthrough of building a new module across all five layers.", url: "" },
  { n: 32, cat: "proof", adr: "ADR 015", title: "Write your first fitness test", summary: "Author your first architecture fitness test and watch it fail the build on a violation.", url: "" },
  { n: 33, cat: "proof", title: "Two real apps on one framework", summary: "A case study: a conference platform and an e-commerce store built on the same kernel.", url: "" },
  { n: 34, cat: "proof", title: "The series index", summary: "The full series index and recommended reading order.", url: "" }
];

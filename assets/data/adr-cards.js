/* ============================================================================
   ADR card copy for the Platform page.

   The LIST itself is not maintained here: tools/build-docs.mjs enumerates
   docs-src/adr/*.md, so a new ADR appears on the page (and in the count) the
   next time the docs are built, with no edit to this file or to platform.html.

   What lives here is the short, hand-written card copy, keyed by ADR number.
   An ADR with no entry falls back to its own H1 title and first paragraph, so
   this file is a quality layer, never a gate. Adding an entry is optional and
   is how you replace a generated fallback with better copy.
   ============================================================================ */

window.ADR_CARDS = {
  "001": { title: "Manual DTO mapping", summary: "Per-entity source-generated mappers chosen over reflection-based AutoMapper." },
  "002": { title: "Navigation populators", summary: "Cross-container and cross-source eager loading via an explicit populator contract." },
  "003": { title: "Outbox dual dispatch", summary: "Outbox plus in-process dispatch plus a background processor for at-least-once delivery." },
  "004": { title: "Cross-service token validation (JWKS)", summary: "Extracted services validate RS256 tokens via JWKS / OIDC discovery, no shared key." },
  "005": { title: "Soft-delete vs. erasure", summary: "Soft-delete for lifecycle; anonymization plus outbox purge for GDPR/CCPA erasure." },
  "006": { title: "Database per service", summary: "Each service owns its DB and outbox; one context class, one instance per database." },
  "007": { title: "gRPC cross-service calls", summary: "Shared contracts, typed clients, and Result-over-the-wire for synchronous calls." },
  "008": { title: "Monolith to services plus gateway", summary: "One service host per module behind a YARP gateway; transport at the edge keeps it reversible." },
  "009": { title: "Resilience and recovery objectives", summary: "A standard resilience handler on every outbound client; declared RTO/RPO and drilled restore." },
  "010": { title: "Integration-event schema versioning", summary: "Every event carries a SchemaVersion; breaking changes use a new event type plus upcaster." },
  "011": { title: "Single-locale by design", summary: "Superseded by ADR-027: en-US only was a deliberate, revisitable non-goal." },
  "012": { title: "gRPC-host transport convention", summary: "Two coherent Kestrel profiles; the choice forces the gateway-forward mode and JWKS routing." },
  "013": { title: "Result pattern over exceptions", summary: "Expected failures are Result values; only the edge maps to HTTP or gRPC status." },
  "014": { title: "CQRS decorator pipeline", summary: "Thin handlers behind a Scrutor decorator chain whose order is load-bearing." },
  "015": { title: "Architecture fitness functions", summary: "Invariants gate the build twice: a compile-time layer guard plus a shared NetArchTest library." },
  "016": { title: "Lockstep versioning + MassTransit pin", summary: "All packages release at one version; the MassTransit v8 pin is a build gate." },
  "017": { title: "HTTP request idempotency", summary: "An attribute dedups client retries via an Idempotency-Key header and cached replay." },
  "018": { title: "Polyglot persistence", summary: "SQL Server, Cosmos, and SQLite behind one model; engine is an attribute on the config." },
  "019": { title: "Layered rate limiting", summary: "An always-on global limiter caps authenticated callers per user and exempts infra traffic." },
  "020": { title: "Permission-based authorization", summary: "An opt-in capability layer over RBAC; permission policies resolve on demand from a registry." },
  "021": { title: "Consumer-side inbox idempotency", summary: "An opt-in inbox dedups broker redeliveries by message id in the consumer's own database." },
  "022": { title: "Browser session-cookie auth", summary: "HttpOnly cookies plus an SSR-time non-validating scheme so [Authorize] passes during prerender." },
  "023": { title: "Security-response headers plus CSP", summary: "Hardened security-headers middleware with a pluggable CSP that cannot break Blazor." },
  "024": { title: "Two-channel user notifications", summary: "One use case writes a durable inbox and fires a transient SignalR push; transport is pluggable." },
  "025": { title: "Startup warm-up plus readiness gating", summary: "Warm-up tasks run at startup and a readiness gate holds probes off a warming replica." },
  "026": { title: "Two-tier caching", summary: "One swappable cache substrate (in-memory or Redis) plus an HTTP output-cache edge for public reads." },
  "027": { title: "Multi-locale i18n (supersedes 011)", summary: "English and Spanish via resource files; backend errors localized at the edge by error code, one culture cookie across SSR, Server, and WASM." },
  "028": { title: "Day / dark theme mode", summary: "A persisted light/dark toggle bound through MudThemeProvider, defaulting to the OS preference with a no-flash cookie bootstrap." },
  "029": { title: "Brute-force login protection", summary: "Email-keyed login lockout with exponential backoff plus a per-IP registration cap, covering the anonymous surface the rate limiter exempts." },
  "030": { title: "Startup sole-migrator", summary: "Each service applies its own EF migrations at boot and is the sole migrator; no deploy-step backstop." },
  "031": { title: "Feature-flag management", summary: "One flag name enforced on two surfaces: a controller gate and the outermost CQRS decorator; disabled reads as 404." },
  "032": { title: "Password hashing with legacy migration", summary: "PBKDF2 with 600k iterations for new passwords; legacy records still verify and migrate on the owner's next password set." },
  "033": { title: "Resource-ownership authorization", summary: "A row-level ownership axis beside RBAC: an owner-or-admin filter rejects mismatches and a specification row-scopes queries." },
  "034": { title: "Generic entity controllers", summary: "Every entity inherits a REST surface plus a bounded query contract: sparse fields, typed filters, sort, and pagination." },
  "035": { title: "Optimistic concurrency (RowVersion)", summary: "A RowVersion token round-trips through DTOs so a stale write surfaces as HTTP 409, gated by a fitness rule." },
  "036": { title: "External OAuth login", summary: "Google and GitHub sign-in swap a single-use code for local JWTs; provider tokens never ride the redirect URL." },
  "037": { title: "Field-level encryption at rest", summary: "An EF converter encrypts string columns with AES-256-GCM; shipped and tested, not yet wired to an entity." },
  "038": { title: "Supply-chain provenance", summary: "An SBOM release gate, committed lock files, a transitive vulnerability audit, and package sources pinned to nuget.org." },
  "039": { title: "Live channel push", summary: "Ephemeral channel events ride the existing notification hub, so one WebSocket carries durable notifications and lossy live events." },
  "040": { title: "Authenticated output caching", summary: "Public, user-independent GET endpoints cache even when requests carry a Bearer token; identity-dependent payloads never qualify." },
  "041": { title: "Observability and telemetry", summary: "A shared OpenTelemetry baseline plus CQRS duration metrics, correlation IDs, head sampling, and outbox-poll span filtering." },
  "042": { title: "Device capability abstraction (MAUI)", summary: "Per-capability contracts with browser fallbacks; the MAUI package overrides them for native heads (the fifteenth package)." },
  "043": { title: "Mobile deep links and OAuth callback", summary: "Allow-listed custom-scheme OAuth completion for MAUI plus app-association files served by each app's web host." },
  "044": { title: "Native push delivery", summary: "A third notification channel: OS-level FCM/APNs push via Azure Notification Hubs reaches backgrounded and killed apps; the inbox stays the source of truth." },
  "045": { title: "Managed file storage and avatars", summary: "Pluggable blob storage plus an image processor that strips all metadata and re-encodes uploads; avatars land as 256x256 JPEGs in a public-read container." },
  "046": { title: "HTTP API versioning strategy", summary: "Header-based versioning wired in one call; supported and deprecated versions are reported on every response, with a fitness contract asserting the headers." },
  "047": { title: "Soft-deleted-user session revocation", summary: "A middleware returns 401 for authenticated callers whose account is soft-deleted, bounding the stateless-JWT revocation window to a 30-second cache instead of the token lifetime." },
  "048": { title: "Primitive identifier type aliases", summary: "Entity IDs stay primitives behind per-module type aliases, chosen over strongly-typed ID structs: readable signatures with zero EF, serializer, or OpenAPI friction." },
  "049": { title: "Library-scoped ConfigureAwait policy", summary: "Framework packages await with ConfigureAwait(false), enforced by CA2007 at error severity; application repos keep the analyzer off because ASP.NET Core has no synchronization context." },
  "050": { title: "JWT + single rotating refresh token", summary: "A short-lived stateless JWT plus one server-stored, opaque refresh token per user that rotates on every use; each rotation slides a fixed inactivity window, and a mismatch revokes the chain." },
  "051": { title: "Client-side auth token lifecycle across render modes", summary: "One ITokenRefresher abstraction with head-specific strategies: browser heads refresh through the same-origin proxy cookie, MAUI refreshes directly and persists the rotated pair in OS SecureStorage." },
  "052": { title: "Background job execution", summary: "Work that outlives a request runs as a bounded channel plus a single-reader hosted drain, never an untracked task, so the host can cancel and await it on shutdown." },
  "053": { title: "Dual-registry package publishing", summary: "Every release pushes the same packages to nuget.org and GitHub Packages from one tag, authenticated by a short-lived OIDC exchange rather than a stored key; nuget.org is the documented install path because the GitHub registry needs a token even for public packages." },
};

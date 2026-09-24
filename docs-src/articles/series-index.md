# The MMCA series: every pattern, one place

> Series: MMCA.Common · Article #53 (index / hub) · Pillar P6 · Rubric: all ·
> Status: grounded in the 53 `Article-NN-*` files in this folder (each article's own H1 and number).
> No em dashes. Articles 1 to 49 and this index carry their live Medium URLs; Articles 50, 51 and 52
> are listed without a link because they are not published yet.

**Subtitle:** A single map of the whole series. Start at the top if MMCA.Common is new to you, or jump
straight to the pattern you came for.

---

MMCA.Common is an Apache-2.0 licensed .NET 10 framework that gives you DDD, Clean Architecture, and CQRS as a
modular monolith that extracts to microservices without a rewrite, and it grades itself against a
34-category architecture rubric in the open. This series teaches it one pattern at a time: the failure
mode each pattern fixes, the real type and ADR behind the MMCA.Common implementation, the honest
trade-offs, and how to apply the idea even if you never install the package.

Each article stands on its own if you land on it from a search. This page is the index that ties them
together: 52 deep-dives plus this map, 53 articles in all. The groups below run roughly from "why this
exists" to "how to build with it," so reading top to bottom is a reasonable curriculum, but every link
is also a fine place to start.

## Start here

The thesis and the framing. Read these first if you have not met the framework.

- 01 · [I open-sourced the enterprise .NET plumbing I never want to rewrite, and graded it against 34 categories](open-sourced-enterprise-dotnet-34-categories.md)
- 02 · [Modular monolith to microservices, without the rewrite](modular-monolith-to-microservices.md)
- 03 · [What good architecture actually means: a 34-category rubric you can score yourself against](34-category-architecture-rubric.md)

## Core patterns

The day-one building blocks. Error handling, the domain model, query intent, the handler pipeline, the
reliability backbone that ties them together, the compensating handlers that undo a step no
transaction can roll back, and the durable queue that runs an ordinary command later.

- 04 · [Stop throwing exceptions for control flow: the Result railway in C#](result-railway-csharp.md)
- 05 · [Kill the anemic domain model: rich aggregates with factory methods that return Result](kill-anemic-domain-model.md)
- 06 · [Specifications over LINQ spaghetti: composable, reusable query intent](specification-pattern.md)
- 07 · [The CQRS decorator pipeline: logging, caching, and transactions without touching a handler](cqrs-decorator-pipeline.md)
- 08 · [Compose validators, don't copy them: a reusable FluentValidation kit](validation-kit.md)
- 09 · [The transactional outbox in .NET 10: never lose an event again](transactional-outbox-dotnet.md)
- 45 · [Feature Flags in the CQRS Pipeline: Gate Commands, Not Code](feature-flags-cqrs-pipeline.md)
- 49 · [Undo Is a Feature: Saga Compensation and the Reconciliation Backstop](saga-compensation-reconciliation.md)
- 51 · [Four Ways to Do Work Later: Channels, Cron, the Outbox and Durable Internal Commands](durable-internal-commands.md)

## Data and persistence

How the data layer is built so a module owns its own database, and even its own storage engine, and can
become its own service later without a rewrite.

- 10 · [Database-per-service inside a monolith (and why)](database-per-service.md)
- 11 · [One entity model, four databases: polyglot persistence behind a single attribute](polyglot-persistence.md)
- 12 · [EF Core Include chains are a trap: navigation populators decouple eager loading](navigation-populators.md)
- 13 · [Optimistic concurrency you cannot opt out of: RowVersion from the database to a required If-Match](optimistic-concurrency-rowversion.md)
- 14 · [Self-ordering modules: discovered, Kahn-ordered, and extractable](self-ordering-modules.md)
- 15 · [Event-schema versioning: never silently reshape an event](event-schema-versioning.md)

## Auth, the API edge, and cross-cutting

The concerns that sit across every module: authentication between services, authorization (by role, by
permission, and by row ownership), password storage, safe retries, caching, error contracts,
notifications, DTO mapping, browser session auth, the generic REST surface, defending the edge,
encrypting PII columns at rest, the hardened response headers every host stamps, and the optional
second factor, email-confirmation gate and stored permission grants that complete the identity story.

- 16 · [Cross-service auth without a shared secret: JWKS dual-fetch](jwks-cross-service-auth.md)
- 17 · [Password hashing done right: PBKDF2-SHA512, 600k iterations, timing-safe](password-hashing.md)
- 18 · [Idempotency in one attribute: safe retries for HTTP APIs](idempotency-attribute.md)
- 19 · [The self-invalidating cache that lives in the pipeline, not your handlers](self-invalidating-cache.md)
- 20 · [Problem Details across HTTP and gRPC (RFC 9457)](problem-details-http-grpc.md)
- 21 · [Notifications as a vertical slice: in-app inbox, real-time push, native push, and email](notifications-vertical-slice.md)
- 22 · [Ephemeral by design: sub-second live channels over one SignalR hub](live-channel-push.md)
- 23 · [Delete AutoMapper: explicit, compile-time DTO mapping that you can actually test](manual-dto-mapping.md)
- 24 · [Permission-based authorization: capabilities over role checks](permission-based-authorization.md)
- 25 · [Browser session-cookie auth for Blazor SSR: surviving the F5](session-cookie-auth-blazor-ssr.md)
- 26 · [Google, GitHub and Apple login without leaking tokens: external OAuth behind your own JWTs](external-oauth-login.md)
- 27 · [Refresh tokens that rotate per device, and reuse detection that makes theft self-limiting](jwt-refresh-token-rotation.md)
- 28 · [Generic entity controllers and the dynamic query contract (ADR-034)](generic-entity-controllers.md)
- 29 · [Resource-ownership authorization: which rows you may touch, not just which actions](resource-ownership-authorization.md)
- 30 · [Defending the API edge: three controls that cover the whole surface](rate-limiting-brute-force-protection.md)
- 46 · [Field-Level Encryption in EF Core: AES-GCM for PII Columns](field-level-encryption-ef-core.md)
- 47 · [Security Headers and CSP for Blazor: One Middleware, Every Host](security-headers-csp-blazor.md)
- 52 · [Finishing Identity: Second Factor, Email Confirmation and Stored Permission Grants](identity-completions.md)

## Run, extract, and harden

Bring the whole stack up with one command, then cut a module out into its own service, make the
running system survive failure, see what it is doing in production, and put bounds, guardrails and
token metering around the model call. Read these in order: Aspire first, then extraction, then
resilience, then observability, then the governed LLM boundary.

- 31 · [Aspire: one command brings up the whole distributed app](aspire-one-command.md)
- 32 · [Extracting a module to a gRPC service, live](extract-module-to-grpc-service.md)
- 33 · [Retries are not a recovery plan: resilience handlers, RTO/RPO, and a restore you actually drilled](resilience-recovery-objectives.md)
- 48 · [Observability by Default: OpenTelemetry and Azure Monitor in MMCA](observability-opentelemetry.md)
- 50 · [The LLM Is a Dependency: A Bounded, Guarded, Metered Boundary for Chat Completions](governed-llm-boundary.md)

## Proof, front end, and getting started

The evidence that the patterns hold (fitness functions, the test pyramid, the erasure pathway), the
reusable Blazor UI framework and the internationalization and theming that ride on it, the hands-on
path from `dotnet new mmca-app` to your first module, your first fitness test, and the two real apps
that run on all of it, the
device-capability layer that lets one Blazor UI run in a browser and inside a native phone app, and two
later additions that round out the framework surface: managed file storage with untrusted-upload
handling, and provable HTTP API versioning.

- 34 · [Architecture fitness functions: rules that fail the build, not a wiki page](architecture-fitness-functions.md)
- 35 · [The test pyramid, not the ice-cream cone: 2,254 fast tests, zero Docker](test-pyramid.md)
- 36 · [Soft-delete vs the right to erasure: the GDPR conflict and the erasure pathway](soft-delete-vs-erasure.md)
- 37 · [A list page in a few lines: a reusable Blazor UI framework with the same discipline as the backend](reusable-blazor-ui-framework.md)
- 38 · [One preference, two switches: shipping i18n and dark mode on a single cookie-and-profile pipeline](i18n-and-theming.md)
- 39 · [Scaffold a .NET modular monolith in one command, then build your first module](build-your-first-module.md)
- 40 · [Write your first architecture fitness test](write-your-first-fitness-test.md)
- 41 · [Two real apps on one framework: a conference platform and a store](two-real-apps-case-study.md)
- 42 · [One Blazor UI, two hosts: a device-capability layer that stays resolvable everywhere](device-capability-abstraction.md)
- 43 · [Managed file storage: uploads you don't have to trust](managed-file-storage-avatars.md)
- 44 · [HTTP API versioning, proven not just claimed](http-api-versioning.md)

## Where to go next

If you are evaluating the framework, read 01 then 03 then 41: the thesis, the rubric, and the proof. If
you are here to solve a specific problem, the core-patterns and cross-cutting groups are the toolbox. If
you want to build, start at 39: it scaffolds the whole solution in one command, then explains what you
were handed. Then 40, to make the conventions fail the build.

*Previous: Article 52, "Finishing Identity: Second Factor, Email Confirmation and Stored Permission
Grants." This index is article 53 of 53, the last one in the series, so it has no next.*

---

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the scorecard (the gaps are the honest
part), or `dotnet add package MMCA.Common.API` and tell me what breaks. New patterns land regularly,
then monthly evergreen.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- The 34-category scorecard and the ADRs are committed in the docs site.

*Tags: .NET, Software Architecture, C Sharp, Microservices, Programming*

*Notes: article numbers and titles match the 53 `Article-NN-*` files in this folder (each article's own
H1 and `Article #N` header), not the strategic calendar in `Medium-Campaign-Plan.md` (which runs a
different, shorter order). The 2026-09-19 refresh grew the series from 50 files to 53 and moved this hub
from 50 to 53: the governed LLM boundary
(`Personal/Medium/Articles/Article-50-governed-llm-boundary.md:1`) joined "Run, extract, and harden",
durable internal commands (`Article-51-durable-internal-commands.md:1`) joined "Core patterns", and the
identity completions (`Article-52-identity-completions.md:1`) joined "Auth, the API edge, and
cross-cutting"; all three are appends, so no earlier article renumbered. The same pass re-read every
`Article-NN-*.md` H1 in this folder and set each link text to it verbatim, which rewrote 29 of them
(articles 05 to 15, 17 to 21, 23, 26 to 28, 30, 31, 33 to 38 and 41). Four of those titles had changed
in their own articles that same day: 11 (`Article-11-polyglot-persistence.md:1`, three databases to
four), 13 (`Article-13-optimistic-concurrency-rowversion.md:1`, naming the required If-Match), 26
(`Article-26-external-oauth-login.md:1`, Apple added) and 27
(`Article-27-jwt-refresh-token-rotation.md:1`, per-device rotation). Article 35's link text carries the
2,254-test figure from its H1 (`Article-35-test-pyramid.md:1`); its Medium slug spells the figure the
story was published under and a published URL cannot be edited, so the URL is left alone. The
2026-07-25 coverage audit appended the saga-compensation deep-dive (ADR-054), Article 49, and moved this
hub from 49 to 50. The 2026-07-23 coverage audit appended four dedicated articles, promoting
patterns previously covered only in passing: feature flags in the CQRS pipeline (ADR-031), Article 45;
field-level encryption (ADR-037), Article 46; security headers + CSP (ADR-023), Article 47; and
observability (ADR-041), Article 48; this hub moved from 45 to 49. The 2026-07-21 coverage audit
inserted Article 27 (the JWT rotating refresh token, a deep-dive on ADR-050) into the auth cluster right
after external OAuth login, renumbering every later article +1 and moving this hub from 44 to 45; the
reading-order groups and the "Where to go next" pointers were reconciled to the new numbering. Earlier
growth: the 2026-07-15 audit added the device-capability deep-dive (ADR-042 + the G26 device-capability
group), now Article 42, and the 2026-07-17 audit added managed file storage (ADR-045), now Article 43,
and HTTP API versioning (ADR-046), now Article 44. Articles 1 to 49 were filled with their live Medium
URLs on 2026-08-19 and this index published 2026-08-20
(`Website/assets/data/articles.js:88`, non-empty url and date); Articles 50, 51 and 52 have no row in
that file and no Medium URL yet, so they are listed here without a link. Re-check the file set before
publishing in case the running order shifts.*

- Full series index: https://ivanball.github.io/writing.html

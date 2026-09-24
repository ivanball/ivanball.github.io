# The MMCA.Common article series

A long-form series that turns the MMCA.Common framework's architecture decisions into teachable
patterns: the Result railway, the transactional outbox, database-per-service, JWKS auth, fitness
functions, and more. Every technical claim traces to real source, an ADR, or a scorecard entry.

## The series (53 articles)

| # | Article | Pillar | Group(s) | Rubric § | ADR | Format |
|---|------|--------|----------|----------|-----|--------|
| 1 | [Open-sourced + graded against 34 categories](open-sourced-enterprise-dotnet-34-categories.md) | P1/P4 | all | all | - | opinion ★ |
| 2 | [Modular monolith to microservices](modular-monolith-to-microservices.md) | P1/P3 | G07,G13,G14 | §7 | 006/007/008 | deep-dive ★ |
| 3 | [The 34-category rubric](34-category-architecture-rubric.md) | P4 | - | all | - | opinion ★ |
| 4 | [The Result railway in C#](result-railway-csharp.md) | P2 | G01 | §1,§2 | 013 | deep-dive |
| 5 | [Kill the anemic domain model](kill-anemic-domain-model.md) | P2 | G02 | §4 | 068/115 | deep-dive |
| 6 | [Specifications over LINQ spaghetti](specification-pattern.md) | P2 | G03 | §2,§8 | - | deep-dive |
| 7 | [The CQRS decorator pipeline](cqrs-decorator-pipeline.md) | P2 | G05 | §1,§6,§10 | 014/031/079 | deep-dive |
| 8 | [Compose validators, don't copy them](validation-kit.md) | P2 | G06 | §24,§33 | - | deep-dive |
| 9 | [The transactional outbox](transactional-outbox-dotnet.md) | P2/P3 | G04 | §6,§8 | 003/066/075/087/100/107 | deep-dive ★ |
| 10 | [Database-per-service inside a monolith](database-per-service.md) | P3 | G07 | §7,§8 | 006/073 | deep-dive ★ |
| 11 | [Polyglot persistence: one model, four engines](polyglot-persistence.md) | P3 | G07,G03 | §8 | 018/113 | deep-dive |
| 12 | [Navigation populators](navigation-populators.md) | P2/P3 | G11 | §8 | 002 | deep-dive |
| 13 | [Optimistic concurrency: RowVersion to a required If-Match](optimistic-concurrency-rowversion.md) | P2/P3 | G07 | §8 | 035 | deep-dive |
| 14 | [Self-ordering modules](self-ordering-modules.md) | P2 | G14 | §7 | 059 | deep-dive |
| 15 | [Event-schema versioning](event-schema-versioning.md) | P3 | G04 | §6 | 010/083 | deep-dive |
| 16 | [JWKS cross-service auth](jwks-cross-service-auth.md) | P3 | G08 | §11 | 004 | deep-dive ★ |
| 17 | [Password hashing done right](password-hashing.md) | P2/P4 | G08 | §11 | 102 | deep-dive |
| 18 | [Idempotency in one attribute](idempotency-attribute.md) | P2 | G12 | §9,§29 | 017/021 | deep-dive |
| 19 | [The self-invalidating cache](self-invalidating-cache.md) | P2 | G09 | §10,§12 | 026/040/073/077 | deep-dive |
| 20 | [Problem Details across HTTP and gRPC](problem-details-http-grpc.md) | P2 | G12,G13 | §9 | - | deep-dive |
| 21 | [Notifications as a vertical slice](notifications-vertical-slice.md) | P2 | G10 | §5 | 024 | deep-dive |
| 22 | [Ephemeral by design: sub-second live channels over one SignalR hub](live-channel-push.md) | P2/P3 | G10,G26 | §5,§7 | 039/052/074 | deep-dive |
| 23 | [Delete AutoMapper: manual DTO mapping](manual-dto-mapping.md) | P2 | G12 | §9,§15 | 001 | deep-dive |
| 24 | [Permission-based authorization over roles](permission-based-authorization.md) | P2/P4 | G08 | §11 | 020 | deep-dive |
| 25 | [Browser session-cookie auth for Blazor SSR](session-cookie-auth-blazor-ssr.md) | P2/P4 | G08,G15 | §11,§26 | 022/069 | deep-dive |
| 26 | [External OAuth login: Google/GitHub/Apple behind your own JWTs](external-oauth-login.md) | P2/P4 | G08 | §11 | 036 | deep-dive |
| 27 | [Refresh tokens that rotate per device, and reuse detection that makes theft self-limiting](jwt-refresh-token-rotation.md) | P2/P4 | G08 | §11 | 097 | deep-dive |
| 28 | [Generic entity controllers + dynamic query contract](generic-entity-controllers.md) | P2 | G12 | §9,§11,§12 | 034/078 | deep-dive |
| 29 | [Resource-ownership authorization](resource-ownership-authorization.md) | P2/P4 | G08 | §11 | 033 | deep-dive |
| 30 | [Defending the API edge: rate limiting + brute-force](rate-limiting-brute-force-protection.md) | P2/P4 | G08 | §11 | 019/029/124 | deep-dive |
| 31 | [Aspire: one command](aspire-one-command.md) | P2/P5 | G16 | §13,§33 | 023/025/041/066/070 | tutorial |
| 32 | [Extracting a module to a gRPC service](extract-module-to-grpc-service.md) | P3/P5 | G13,G14 | §7,§9 | 007/008/012/088/089 | tutorial |
| 33 | [Resilience and recovery objectives](resilience-recovery-objectives.md) | P3/P4 | G04,G13 | §29 | 009/087 | deep-dive |
| 34 | [Architecture fitness functions](architecture-fitness-functions.md) | P4 | G28 | §3,§12,§25,§34 | 015/060/062/105/109 | deep-dive |
| 35 | [The test pyramid](test-pyramid.md) | P4 | G28 | §14,§21,§28 | 058/063/117 | deep-dive |
| 36 | [Soft-delete vs the right to erasure](soft-delete-vs-erasure.md) | P3/P4 | G07,G23 | §30 | 005/047/076/119 | deep-dive ★ |
| 37 | [A reusable Blazor UI framework](reusable-blazor-ui-framework.md) | P2/P5 | G15 | §18,§19,§20,§22,§23 | 056/067 | deep-dive |
| 38 | [i18n and theming on one preference pipeline](i18n-and-theming.md) | P2/P5 | G15 | §27 | 027/028 | deep-dive |
| 39 | [Build your first module](build-your-first-module.md) | P5 | G02,G05,G14 | §33 | 065 | tutorial |
| 40 | [Write your first fitness test](write-your-first-fitness-test.md) | P5 | G25 | §34 | 015 | tutorial |
| 41 | [Two real apps on one framework](two-real-apps-case-study.md) | P6 | - | proof,§4,§5,§7,§10,§32 | 016 | case study |
| 42 | [One Blazor UI, two hosts: a device-capability layer](device-capability-abstraction.md) | P2/P5 | G27 | §18 | 042/043/071 | deep-dive |
| 43 | [Managed file storage: uploads you don't have to trust](managed-file-storage-avatars.md) | P2/P4 | G07 | §8,§11,§30 | 045 | deep-dive |
| 44 | [HTTP API versioning, proven not just claimed](http-api-versioning.md) | P2/P3 | G12,G13 | §9 | 046 | deep-dive |
| 45 | [Feature flags in the CQRS pipeline](feature-flags-cqrs-pipeline.md) | P2 | G05 | §6 | 031 | deep-dive |
| 46 | [Field-level encryption in EF Core](field-level-encryption-ef-core.md) | P3 | G07 | §11,§30 | 037 | deep-dive |
| 47 | [Security headers and CSP for Blazor](security-headers-csp-blazor.md) | P2 | G16 | §26 | 023/082 | deep-dive |
| 48 | [Observability by default: OpenTelemetry + Azure Monitor](observability-opentelemetry.md) | P2/P3 | G16 | §13,§31 | 041/062 | deep-dive |
| 49 | [Undo is a feature: saga compensation and the reconciliation backstop](saga-compensation-reconciliation.md) | P2/P3 | G04 | §6,§29 | 054/084/086 | deep-dive |
| 50 | [The LLM is a dependency: a bounded, guarded, metered boundary for chat completions](governed-llm-boundary.md) | P2/P4 | G28 | §16 | 120/111 | deep-dive |
| 51 | [Four ways to do work later: channels, cron, the outbox and durable internal commands](durable-internal-commands.md) | P2/P3 | G04 | §6,§10 | 114/121 | deep-dive |
| 52 | [Finishing identity: second factor, email confirmation and stored permission grants](identity-completions.md) | P2/P4 | G08 | §11 | 116 | deep-dive |
| 53 | [Series index (hub)](series-index.md) | P6 | all | all | - | index |

★ = cornerstone pillar (publish first; everything links up to these).

**The numbering is the reading order.** Each article builds on the ones before it, so reading 1 through 53
in sequence is the intended curriculum (1-3 orient, 4-9 are the core patterns, 10-15 data and persistence,
16-30 auth, the API edge, and notifications, 31-33 run/extract/harden, 34-44 proof, front end, getting
started, the device-capability layer, managed file storage, and API versioning, 45-48 the appended
2026-07-23 additions: pipeline feature flags, field-level encryption, security headers + CSP, and
observability, 49 the appended 2026-07-25 addition: saga compensation and the reconciliation backstop,
50-52 the appended 2026-09-19 additions: the governed LLM boundary (ADR-120/111), durable
internal commands (ADR-114/121), and the identity completions (ADR-116), 53 is the index hub; the
hub's reading-order groups slot 45-52 back into their logical clusters). Every article's "Next in the series" footer points to the next number.

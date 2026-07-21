# MMCA.Common + MMCA.ADC, Onboarding Guide

A teaching guide for an experienced .NET engineer who is **new to this codebase**. It walks every
first-party type, explaining not just *what* each type is but *how* it works and *why* it was built
that way, introducing each project-specific concept the first time it appears, and connecting the
code to a 34-category architecture-evaluation rubric as it goes.

> **Ground rule for this guide:** every statement is traceable to source actually read, cited as
> `path/File.cs:line`. Where the source can't settle a question, the text says so explicitly
> ("Not determinable from source: …") rather than guessing. The existing docs
> (`Architecture/ArchitecturalAnalysis.md`, `ADRs/`, per-project `CLAUDE.md`) are used as a map and cross-check,
> but **source code is ground truth**, where a doc and the code disagree, the code wins and the
> discrepancy is noted.

---

## How the guide is organized, two axes

The guide has **two organizing axes that work together**.

1. **Primary axis, functional grouping.** Every type lives in exactly **one** functional group: the
   capability or cross-cutting concern it most exists to serve. The 27 group chapters
   (`group-01-*.md` … `group-27-*.md`) are sequenced roughly topologically, foundational,
   widely-depended-on concerns first (Result → domain blocks → querying → events → CQRS → …), then the
   ASP.NET/UI/Aspire edges, then the `MMCA.ADC` business modules that build on all of it, then the test
   infrastructure. The full assignment of every type to its group is
   [`00-group-taxonomy.md`](00-group-taxonomy.md).

2. **Secondary axis, dependency leveling within a group.** Inside each chapter, the per-type sections
   run in ascending **Level** (a longest-path topological layering over first-party dependencies), so
   you meet a type only after the first-party types it depends on.

**First-party type** = any type declared in `MMCA.Common` or `MMCA.ADC` source. The .NET BCL and
external NuGet packages are *not* first-party, they are "external Level 0", explained **once** in the
[primer](00-primer.md), never per class.

```
Level(C) = 0                              if C references only external (BCL/NuGet) types
Level(C) = 1 + max(Level(D)) over all first-party D that C depends on
```

When a type must reference a first-party type whose home group appears **later**, that forward
reference is allowed (functional cohesion can outrank strict progressive disclosure) and is
cross-linked. Sixteen dependency **cycles** exist (mutually-dependent types, e.g. an aggregate root and
its child entity with bidirectional EF navigations); each is kept whole within a single group and
called out where it occurs. They are listed in the
[dependency manifest](00-dependency-manifest.md#cycles-scc-size--1-16).

### How the inventory & leveling were computed

The type inventory and dependency graph are produced **mechanically** by a small Roslyn syntactic
parser (`Tools/invtool/`), so the type list, namespaces, and `file:line` are exact and reproducible. Edges
are resolved by **namespace-aware name matching**; ~96% bind by namespace visibility, the rest by a
globally-unique-name fallback (331 edges), and 27 references are dropped as ambiguous. The functional grouping is
then applied mechanically (`Tools/invtool/classify.ps1` → `00-group-taxonomy.md`), so every one of the
**2,587** distinct type nodes maps to exactly one group with no silent drops. See the
[manifest's accuracy note](00-dependency-manifest.md#edge-resolution--accuracy) for residual caveats.

---

## Chapters

### Front matter
| File | Contents |
|------|----------|
| [`00-primer.md`](00-primer.md) | Cross-cutting concepts, the BCL/NuGet stack, build/language conventions, and the 34-category rubric, taught **once** |
| [`00-inventory.md`](00-inventory.md) | Phase 0, every in-scope type (2,587 distinct), mechanically extracted, with `file:line` |
| [`00-dependency-manifest.md`](00-dependency-manifest.md) | Phase 1a, per-type first-party deps + computed Level; the 16 cycles |
| [`00-group-taxonomy.md`](00-group-taxonomy.md) | Phase 1b, the ordered groups + every type's group assignment (the primary axis) |

### Group chapters (primary axis)
| # | Chapter | Types | Concern |
|---|---------|-------|---------|
| 1 | [Result & Error Handling](group-01-result-error-handling.md) | 11 | The `Result`/`Error` railway returned instead of throwing, incl. its own JSON round-trip converter |
| 2 | [Domain Building Blocks](group-02-domain-building-blocks.md) | 28 | Entity/aggregate bases, value objects + invariants, domain markers, attributes, identifier aliases, `[Pii]` redaction, row-version concurrency marker |
| 3 | [Querying: Specifications, Filtering & the Entity Query Service](group-03-querying-specifications.md) | 26 | Specification pattern (incl. cross-source), dynamic filter/sort/page (incl. IN-list value parsing), the generic query pipeline |
| 4 | [Domain & Integration Events + Outbox Dual-Dispatch](group-04-events-outbox.md) | 31 | Event contracts, dispatcher, transactional outbox/inbox (incl. the async `OutboxFinalizer`), message buses |
| 5 | [CQRS: Commands, Queries & the Decorator Pipeline](group-05-cqrs-pipeline.md) | 23 | Handler abstraction + the logging/transaction/caching/feature-gate/idempotency decorators (incl. the cache-stampede lock) |
| 6 | [Validation](group-06-validation.md) | 17 | FluentValidation contracts + failure mapping that gate commands |
| 7 | [Persistence & EF Core](group-07-persistence-ef-core.md) | 85 | `SQLServerDbContext` over abstract `ApplicationDbContext`, interceptors (incl. the deferred-dispatch record), repositories, engine-aware entity config, data-source routing, conventions (incl. the soft-delete unique-index convention), factories, managed file storage + image processing (ADR-045), native-push device registrar (ADR-044) |
| 8 | [Authentication & Authorization](group-08-auth.md) | 56 | JWT/JWKS dual-fetch, the shared `AuthenticationServiceBase<TUser>` login/refresh workflow (`IAuthUser`), current-user/claims, password hashing, cookie sessions, role policies + the permission-based authorization mechanism (registry, `[HasPermission]`), the `RoleValue` base, the external-auth-broker contract (ADR-042/043) |
| 9 | [Caching](group-09-caching.md) | 4 | The cache abstraction + its invalidation-aware decorator integration |
| 10 | [Notifications (Push + In-App Inbox + Email)](group-10-notifications.md) | 54 | Push (SignalR), in-app inbox, email, recipient providers, the ADR-039 hub-channel live publisher, ADR-044 native OS-level push (Azure Notification Hubs, shipped inert), ADC Notification module + its cross-service gRPC live-channel plumbing + extractable-host Kestrel config |
| 11 | [Navigation Metadata & Populators](group-11-navigation-populators.md) | 12 | EF-decoupled cross-container/cross-source eager loading (ADR-002) |
| 12 | [API Hosting, Middleware, Idempotency & DTO/Contract Mapping](group-12-api-hosting-mapping.md) | 56 | Controller bases (incl. OAuth + service-info + API versioning, ADR-046), middleware (incl. soft-deleted-user revocation, ADR-047), startup, model binders, JSON converters, feature mgmt, idempotency, mapping, edge error localization (i18n), authenticated output caching (ADR-040), app-association/deep-link endpoints (ADR-043) |
| 13 | [gRPC & Inter-Service Contracts](group-13-grpc-contracts.md) | 6 | Typed gRPC clients/servers, interceptors, Result-over-the-wire (ADR-007) |
| 14 | [Module System, Composition & Configuration](group-14-module-system-composition.md) | 34 | `IModule` + Kahn-ordered loader, DI composition roots, data-source attributes, options binding |
| 15 | [Common UI Framework](group-15-common-ui-framework.md) | 82 | Reusable MudBlazor building blocks: data-grid list page base, theme, common pages/services, i18n culture bootstrap + day/dark `ThemeService`, user-preference readers/writers, pseudo-localization gate, OAuth UI settings + token storage (Web/WASM), hub-channel subscriptions (ADR-039) |
| 16 | [Aspire Orchestration & Service Defaults](group-16-aspire-orchestration.md) | 16 | AppHost wiring, ServiceDefaults, warmup, telemetry, security helpers, the shared `HttpResilienceDefaults` Polly source of truth |
| 17 | [ADC Conference, Domain Model & Module Contracts](group-17-conference-domain.md) | 85 | Event/Session/Speaker/Category/Question aggregates + domain events + invariants + Shared contracts (incl. `ConferencePermissions`, the current/next-event selector + live-validation contracts) |
| 18 | [ADC Conference, Application & Use Cases](group-18-conference-application.md) | 211 | Conference CQRS handlers, validators (incl. the per-field session validation-rule family), DTOs, specs, Sessionize import, decision-support analytics, batch bookmark-count query, event-filtering-by-role handlers, calendar (.ics) export slice (ADR-042) |
| 19 | [ADC Conference, Infrastructure & Persistence](group-19-conference-infrastructure.md) | 27 | Conference DbContext registration, EF configs, seeding, infra services |
| 20 | [ADC Conference, API, gRPC Contracts & Service Host](group-20-conference-api-grpc.md) | 41 | REST controllers, `.Contracts` gRPC, the extractable service host (incl. its Kestrel config), the gRPC adapters (incl. cross-service live-validation), localized error resources |
| 21 | [ADC Conference, UI](group-21-conference-ui.md) | 89 | Conference Blazor pages + UI services, the single canonical ADC Home page + its view models, the AI-scoring poll recovery tracker, calendar/QR export UI, OfflineBanner, PresenterLayout on Common theme providers |
| 22 | [ADC Engagement Module (Session Bookmarks)](group-22-engagement-module.md) | 72 | The async session-bookmarking slice of the Engagement bounded context: bookmark aggregate, use cases, persistence, API/contracts/service, feedback UI, the durable live-channel publish queue (ADR-039), the cross-service user-engagement export slice (gRPC) |
| 23 | [ADC Engagement Live Layer (Real-Time Polls & Session Q&A)](group-23-engagement-live-layer.md) | 92 | Event-wide live polls with voting + moderated per-session Q&A with upvoting, over the ADR-039 hub-channel transport and the cross-service gRPC live-channel adapter (HappeningNow / SessionLive / PresenterView) |
| 24 | [ADC Identity Module (Users, Profiles, GDPR Export/Erasure)](group-24-identity-module.md) | 82 | The Identity bounded context end-to-end (incl. `IdentityPermissions`, user culture/theme preferences, the ADR-045 user-avatar photo slice end to end, the external-login email verifier + extractable-host Kestrel config; `AuthenticationService` now extends Common's shared base) |
| 25 | [ADC Application Host, UI Shell & Cross-Module Composition](group-25-adc-host-composition.md) | 18 | Blazor Web/WASM/WinUI shells, host pages/services, security, app composition, device-capability DI wiring, one-time preference migrator (the shared ADC Home page + its view models now live in the Conference UI chapter) |
| 26 | [Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)](group-26-device-capability-layer.md) | 87 | Per-capability interface contracts (biometric, geolocation, speech, push registration, clipboard/share/haptics, external auth/links, connectivity/battery, deep links) + their MAUI-native, browser-JS-interop, and inert-fallback implementations, selected per host at DI composition time (ADR-042/043/044/045) |
| 27 | [Testing & Quality Infrastructure](group-27-testing-infrastructure.md) | 1242 | All test projects + reusable Testing/Testing.E2E/Testing.UI/**Testing.Architecture** bases (incl. the handler + decorator-pipeline test bases and the Gallery auth stubs) + architecture-fitness tests + Gallery + the BenchmarkDotNet perf-smoke suite |

### DevOps & operations chapters
| File | Contents |
|------|----------|
| [`devops-cicd.md`](devops-cicd.md) | CI/CD workflows (the 14-package lockstep release; ADC deploy/e2e/cost-guard/load-test/cutover) |
| [`devops-iac.md`](devops-iac.md) | Bicep infrastructure-as-code, the UAMI/OIDC + shared-RG + database-per-service deployment model |
| [`devops-aspire.md`](devops-aspire.md) | Aspire AppHost + ServiceDefaults orchestration; how local run and service wiring work |
| [`devops-runbooks.md`](devops-runbooks.md) | Operational scripts, SQL, and runbooks (disaster recovery, post-cutover downgrade) |
| [`devops-testing.md`](devops-testing.md) | Solution composition (`.slnx`/`.slnf`), MTP/xUnit v3 runner, the test strategy & pyramid |

### Back matter
| File | Contents |
|------|----------|
| [`99-coverage-audit.md`](99-coverage-audit.md) | Phase 4, coverage cross-check, exceptions log, grouping/ordering verification, rubric matrix, open questions |

---

## Legend, how to read a type section

Every type gets one section using this template:

> ### {TypeName}
> > {Assembly} · `{namespace}` · `{file:line}` · Level {n} · {kind}
> - **What it is**: one or two plain-language sentences.
> - **Depends on**: first-party types (linked) and notable externals.
> - **Concept introduced**: taught from first principles the first time a pattern appears; otherwise
>   cross-references where it was introduced. Relevant rubric categories are tagged inline as
>   `[Rubric §N, Name]`.
> - **Walkthrough**: members in teaching order (fields → constructor/factory → key methods), with
>   line numbers and the *mechanism*.
> - **Why it's built this way**: design rationale; cites the relevant ADR when one applies.
> - **Where it's used**: a forward pointer to consumers.
> - **Caveats / not-in-source**: anything uncertain, stated explicitly.

- **Cross-links.** A first-party type named in prose links to its section, e.g.
  [`Result`](group-01-result-error-handling.md#result). The target is computed from the type's group
  (see [`00-group-taxonomy.md`](00-group-taxonomy.md)); within a chapter, links are same-page anchors.
- **Sibling families.** Near-identical types (per-entity `Add*/Remove*/Update*` commands, `*DTOMapper`,
  `*Validator` families) may share one `### A, B, C` section that teaches the shared shape once, with a
  per-member `File:Line` table so every type stays individually cited.
- **`[Rubric §N, Name]` tags.** These connect the code to the 34-category rubric introduced in the
  [primer](00-primer.md#6-the-34-category-architecture-evaluation-lens). A tag *explains* the category
  and how this code embodies (or under-uses) it, it does **not** score it. Scoring lives in the
  separate `ArchitectureEvaluation-*.md` reports.

---

## Suggested reading paths

- **Framework-first (recommended).** [Primer](00-primer.md) → group-01 → upward. You meet the
  `MMCA.Common` foundations before the `MMCA.ADC` features that build on them; this matches dependency
  order across and within groups.
- **"I need to touch the ADC Conference module."** Primer → skim group-01/02/05 (Result, domain blocks,
  CQRS) → then [Conference Domain](group-17-conference-domain.md) →
  [Application](group-18-conference-application.md) → [UI](group-21-conference-ui.md).
- **Capability deep-dive.** Jump straight to the group for the concern you care about, persistence,
  auth, events/outbox, notifications, navigation populators, etc. Each chapter opens with a
  "how this capability is implemented" overview before the per-type sections.
- **Rubric-driven (architecture review).** Read the [primer's rubric section](00-primer.md#6-the-34-category-architecture-evaluation-lens),
  then follow the `[Rubric §N]` tags; the [coverage audit](99-coverage-audit.md#rubric-coverage-matrix)
  maps every category to where it's first explained.
- **Operations / DevOps.** Primer → the [`devops-*`](devops-cicd.md) chapters.

---

## The companion projects (context)

```
MMCA.Common , shared framework, published as 15 NuGet packages (DDD/Clean Arch/CQRS base classes)
   ├── consumed by MMCA.ADC   (Atlanta Developers Conference app, the focus of this guide)
   └── consumed by MMCA.Store  (e-commerce app, out of scope here)
```

This guide covers **MMCA.Common** (the framework) and **MMCA.ADC** (one consumer). `MMCA.Store` is out
of scope. The dependency arrow is why the Common framework groups (1–16) come before the ADC
business-module groups (17–25); the late-added Common Device Capability layer (26, a framework concern
appended after the business modules) and the test infrastructure (27) come last.

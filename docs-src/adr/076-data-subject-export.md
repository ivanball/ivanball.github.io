# ADR-076: Data-Subject Export (DSAR) as a Framework Contract

## Status
Accepted (2026-08-13). Revised 2026-08-14 (the API-surface section corrected to the shipped mechanism,
an abstract `DataExportControllerBase` a subclass mounts, not an application-part registration; the
consumer adoption picture corrected; the export/delete generic-constraint difference stated; ADC
citations re-anchored).
The implementation lands in the MMCA.Common "enterprise capability wave" release.
It is opt-in: an app subclasses `ExportUserDataHandlerBase` and registers its own
`IUserDataExportSection` implementations, and the shipped controller base is subclassed and routed by
the app. Nothing changes for a host that does not.

## Context
A data-subject access request is a legal obligation with a clock on it: the person asks for a copy of the
personal data held about them, and the operator has a deadline to hand one over.
[ADR-005](005-soft-delete-vs-erasure.md) decided the other half of that obligation (erasure, via
`IAnonymizable` and anonymize-in-place) and scoped export out: the framework supplies the extension
points, while "the consumer must still wire the erasure handler, the data-subject request flow, and
access/export".

Both consumers then wrote that flow, separately.
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs`
and its Store twin
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs`
make the same decisions in the same order: check owner-or-privileged role, load the user aggregate
read-only, fan out to the peer modules holding the rest of the person's data, catch each peer call on its
own, assemble one document. They differ only in which fields they copy and which peers they call.

The duplication is already on the record. `UserOwnershipRule`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserOwnershipRule.cs:21`) exists precisely
because the owner-or-privileged-role idiom "was written out four times across the two apps (account
deletion and data export, in each)" (`UserOwnershipRule.cs:9-20`). The same remarks record why it was
hoisted as a plain helper instead of a base class: "because the two data-export handlers stay app-level
(their projections are entirely app-specific)". Deletion did get a base class, `DeleteUserHandlerBase`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:38`),
which calls that helper at `DeleteUserHandlerBase.cs:62`.

**This record supersedes that reasoning for the export half.** It treated a handler as one indivisible
thing, either app-specific or not. It is two: an orchestration (authorize, load, fan out, degrade,
envelope) identical in both apps, and projections app-specific in both. The projections being
app-specific is the argument for making them an extension point, not for leaving the orchestration
written twice.

Three questions had no recorded answer in either app or the framework: what an export does when one
contributing source is unavailable, what file the subject receives, and where the endpoint lives once
the orchestration no longer sits in the app.

## Decision
The framework takes the part that is the same in both apps; the app keeps the part that is not. A
consumer's export handler becomes a subclass that supplies a role test and a set of sections.

### `IUserDataExportSection` is the extension point
`IUserDataExportSection` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs`)
declares a `SectionName` and `ExportAsync(UserIdentifierType userId, CancellationToken)` returning a
section DTO carrying an `Available` flag. Every store of personal data that is not the user aggregate
itself contributes one implementation: an in-process module service, a gRPC adapter to an extracted
peer, or anything else the app registers. This generalizes ADC's `IUserEngagementExportService`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Exports/IUserEngagementExportService.cs:11`),
the same contract with one module's name baked into it. Sections are collected from DI, so adding a
store of personal data to an app is a registration, not an edit to the export handler.

### `ExportUserDataHandlerBase<TUser, TQuery>` mirrors `DeleteUserHandlerBase`
The base class (`.../Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs`) takes generic
constraints similar to `DeleteUserHandlerBase` but not identical: both constrain `TUser` to
`AuditableAggregateRootEntity<UserIdentifierType>` and `TQuery`/`TCommand` to `IUserOwnedRequest`
(`ExportUserDataHandlerBase.cs:54-55`), and deletion additionally requires `TUser : IErasableUser`
(`DeleteUserHandlerBase.cs:41`) because it calls `Anonymize()`. Export never does, so it does not ask
for that interface: a user aggregate can be exportable without being erasable. The base runs the same
`UserOwnershipRule.CheckOwnership` gate with the export error code, and exposes a `HasDeletePrivilege`-style hook so the app supplies its own role
vocabulary (ADC evaluates `UserRole.IsOrganizer`, Store evaluates `UserRole.IsAdmin`). It then loads the
owned aggregate, fans out to every registered `IUserDataExportSection`, and assembles a
`UserDataExportDTO`. The subclass keeps the role test, the subject snapshot projection, and the sections.

### Best-effort per-section degradation is the contract, not an implementation detail
Each section call is caught individually, and a section that throws is returned with `Available = false`
rather than failing the export. Both apps already do this; this record promotes it from a shared habit to
the framework's stated behavior. A data-subject request is a legal obligation with a deadline, and a
package containing eight of nine sections that says which one is missing lets the operator answer the
request and follow up on the remainder, where a 500 returns nothing and informs nobody. The cost is real
and is named in the trade-offs: an export that looks successful can be incomplete. The `Available` flag
is the mitigation, and it lives in the document rather than in a log entry so the subject sees it too.

### The envelope is a versioned data contract
`UserDataExportDTO` and its section envelope are `[DataContract]`-annotated, the same treatment
`PagedCollectionResult<T>` gets
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:118-119`). The envelope
carries the subject snapshot, the sections, a generated-on timestamp, and a **format version**, which is
what makes the shape evolvable: a reader can tell which contract it has without inferring it from which
fields happen to be present.

### The package is JSON, delivered as a download
The response is `application/json` with a `Content-Disposition` attachment header, not a zip of CSVs and
not a PDF. A zip of CSVs would flatten a nested graph of heterogeneous sections into a tabular shape it
does not have, and the flattening is lossy exactly where the data is most specific (nested order lines,
per-activity ledger entries). A PDF is a rendering, not a copy: the subject's likely next step is machine
processing or handing the file to another controller, which a PDF turns into a scraping exercise. JSON is
what the sections already are, and the format version makes it evolvable as a rendered document is not.

### The API surface is a shipped controller base the app subclasses
The endpoint ships from the framework assembly as the abstract
`DataExportControllerBase<TQuery>`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:59`),
**not** as a concrete controller registered into the MVC application parts. That is a deliberate
departure from the `AddNotificationControllers` precedent for package-assembly controllers
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Notifications/DependencyInjection.cs:19-23`), and the
base's own remarks record why: the query type is app-owned, so "this ships as an abstract base with a
`CreateQuery` factory rather than as a concrete controller added through an application part: a
concrete controller could not construct a type it cannot see" (`DataExportControllerBase.cs:44-47`).
There is no `AddDsarControllers()` registration; the unit of opt-in is the subclass itself. An app
declares a controller carrying its own `[Route]`, passes its query type, and implements the abstract
`CreateQuery(userId, currentUserId, currentUserRole)` factory (`:119-122`); the action template
`{userId}/export` is fixed on the base (`:77`), so a subclass routed at `Users` serves the same
`/Users/{userId}/export` path the hand-written controllers do.

The base carries a bare `[Authorize]` (`:57`) and `[FeatureGate(PrivacyFeatures.DataExport)]` (`:58`),
so a host that has not turned the feature on answers 404 rather than 403
([ADR-031](031-feature-flag-management.md)), and the endpoint does not exist for an app that never
subclasses. An authenticated caller is all the attribute asks for, and that is the right ask: the
caller this endpoint exists for is the data subject, who holds no capability beyond owning the account
([ADR-020](020-permission-based-authorization.md)). Authorization at the edge is defence in depth
rather than the real gate: the handler independently enforces owner-or-privileged-role. The action
serializes the package itself and returns `File(payload, ExportContentType, BuildFileName(...))`
(`:109`) rather than an `ObjectResult`, because content negotiation would render the document inline
and the point of the endpoint is a saved file.

**No consumer has adopted the base yet.** Neither ADC's nor Store's `UsersController` references
`DataExportControllerBase`: each still owns a standalone action that reimplements the dispatch. ADC's
`GET /Users/{userId}/export`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:157`) builds
the query inline and ends in `Ok(result.Value)` (`:175`), returning the document as a negotiated body
with no `Content-Disposition`, and it is covered only by the class-level `[Authorize]` (`:31`) with no
`[FeatureGate]`. Store's is the same shape
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/UsersController.cs:35`). So
the handler hoist landed in both apps while the controller hoist did not: the framework base is shipped
and tested, the download delivery and the feature gate reach a consumer only when one subclasses it.

### The completeness fitness rule is deferred, deliberately
A `PiiEntitiesAreExportable` rule as a sibling to `EntitiesWithPiiImplementAnonymizable` (ADR-005) is the
obvious guard: every entity carrying `[Pii]` should be reachable by some registered section. It is
**not** shipped. Written today it would fail every consumer on the release that introduces it, before any
of them could register a section, which is the opposite of how a fitness function should enter a codebase
([ADR-015](015-architecture-fitness-functions.md)). It is recorded as a follow-up so the gap stays
visible rather than being forgotten.

### Adoption in the lockstep sweep
ADC and Store rebase their existing handlers onto the base as thin subclasses with identical public
surface and untouched unit tests: the `AuthenticationServiceBase` hoist playbook (hoist with
behavior-preserving hooks, the consumer becomes a subclass, the tests do not move). ADC's Engagement
section already carries the check-in and points data added by [ADR-072](072-qr-badge-check-in-and-points.md)
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Exports/UserEngagementExportDTO.cs:18`,
`:24`), so it re-registers that projection as an `IUserDataExportSection` rather than adding data.
MMCA.Helpdesk has no Identity module and does not adopt.

## Rationale
- **The two halves of a handler have different owners.** The ownership gate, the aggregate load, the
  fan-out, the per-section catch and the envelope are the same decisions in both apps, in the same order,
  for the same regulatory reason. The field-by-field projection of a `User` cannot be: it names app types.
  `UserOwnershipRule` is the evidence for the split; it is a helper rather than a base class only because
  the split had not been made yet.
- **A degraded package beats no package when the clock is legal.** Failing the whole document because
  one peer is down converts a partial answer into no answer plus a retry loop, and the retry loop does
  not make the peer come back. Best-effort with no signal would be silent data loss, which is why the
  per-section boolean is part of the contract rather than a logging convention.
- **Sections generalize a contract both apps already wrote.** ADC's `IUserEngagementExportService` and
  Store's `IUserSalesExportService` are the same interface with different nouns. Naming the shape once
  means a new store of personal data is registered rather than wired into a handler, and a peer that gets
  extracted into a service changes only which implementation is registered.
- **A format version costs one field and buys the ability to change the envelope.** The envelope now
  belongs to the framework and will move on a framework release, so a reader that can name the contract
  it received is the difference between an evolvable document and a frozen one.
- **An abstract base is what a NuGet-delivered endpoint can be when the query type is app-owned.** MVC
  does not scan package assemblies, and the usual answer is an application-part registration, but a
  concrete controller in the framework assembly cannot name (or construct) each app's
  `ExportUserDataQuery`. Shipping the action, the attributes and the file delivery on a base whose one
  abstract member is the query factory keeps the endpoint absent for a host that did not subclass, and
  costs the adopter a class declaration and one expression.
- **A fitness rule that fails everything on arrival does not get adopted, it gets suppressed.** ADR-015's
  value comes from rules that hold on the day they land. Recording the deferral keeps the gap in the
  record instead of hiding it behind a suppression.

## Trade-offs
- **Best-effort degradation can return a quietly incomplete package.** `Available = false` is the only
  signal, and nothing forces a caller, a UI, or the subject to read it. A section that fails on every
  attempt produces an export that looks successful every time.
- **The controller half of this record is shipped but unadopted.** Both apps subclass the handler base
  and neither subclasses `DataExportControllerBase`, so the download delivery, the `Content-Disposition`
  file name and the `[FeatureGate]` 404 posture are framework behavior no deployed endpoint exhibits
  today: ADC and Store still return the package inline from their own actions. Until a consumer
  subclasses, the two halves of the endpoint contract can drift without a test noticing.
- **Nothing proves a section exists for every store of personal data.** The completeness of an export is
  exactly the set of sections a consumer chose to register; a module holding personal data that registers
  none is invisible to the export, and the fitness rule that would catch it is deferred.
- **The export reads live data with no snapshot and no transaction across sections.** Sections are read
  sequentially from their own stores, so a package assembled while the subject is mutating their own
  account can be internally inconsistent (an order visible in one section and absent from another).
- **There is no asynchronous or large-export path in v1.** The request is synchronous and holds a
  response open while every section runs, so the slowest section paces the whole export and a subject
  with a large history pays for it in wall-clock time on an HTTP request.
- **No rate limiting and no export audit beyond the ownership gate.** Nothing records that an export was
  produced, and nothing bounds how often a privileged caller may produce one.
- **The envelope now moves on the framework's schedule.** A consumer's export document shape is no longer
  the consumer's to version: a change to `UserDataExportDTO` reaches every app on the next lockstep bump
  ([ADR-016](016-lockstep-versioning-masstransit-pin.md)), the cost of not writing the orchestration
  three times.
- **The ownership gate trusts the caller's claims.** `UserOwnershipRule` compares `CurrentUserId` and the
  role against the target, both taken from the validated token
  ([ADR-004](004-authentication-dual-fetch.md)), so an export is only as strong as the token that asked
  for it, and the privileged-role bypass is a full read of anyone's personal data by design.

## Related
[ADR-005](005-soft-delete-vs-erasure.md) (the erasure half of the same privacy obligation, whose
`IAnonymizable` opt-in and `[Pii]` guard are this contract's mirror: one erases what the other copies),
[ADR-033](033-resource-ownership-authorization.md) (the resource-ownership axis this gate belongs to,
expressed as `UserOwnershipRule` rather than the action filter because the check happens in the
Application layer), [ADR-031](031-feature-flag-management.md) (the `[FeatureGate]` on the shipped
controller and the 404-not-403 posture a disabled export takes),
[ADR-015](015-architecture-fitness-functions.md) (the deferred `PiiEntitiesAreExportable` rule that would
make section coverage an invariant rather than a discipline),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (why hoisting a shared envelope is a release
obligation across every consumer at once), [ADR-013](013-result-pattern.md) (the `Result` the handler
returns on a denied ownership check, surfaced at the HTTP edge rather than thrown),
[ADR-004](004-authentication-dual-fetch.md) (the validated principal the ownership gate trusts).

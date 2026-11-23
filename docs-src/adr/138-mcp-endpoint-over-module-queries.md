# ADR-138: MCP Endpoint Over Module Queries (Opt-In, Read-Only, Governed Per Tool)

## Status
Accepted (2026-11-07). Ships in the MMCA.Common release after v1.277.0 as a new package,
`MMCA.Common.Mcp`, the framework's 27th (`MMCA.Common/FACTS.md:20`, `:32`). Off unless a host calls
both registration methods and sets `Mcp:Enabled`.
Revised 2026-11-08 (MMCA.Common v1.281.0): a machine client's token now satisfies permissioned tools
for server-to-server callers, OAuth 2.1 for desktop clients stays deferred, and ADC's tools are
scoped to one event with a `list_events` tool. See the Revision (2026-11-08) at the end.
Revised 2026-11-08 (MMCA.Common v1.282.0): a tool now declares `[McpToolPublic]` or `[McpToolPermission]`, enforced at test time; the runtime rule is unchanged. See the Revision (2026-11-08, access declaration) at the end.
Revised 2026-11-17 (MMCA.Common v1.300.0): the `mcp` policy no longer sits beside a `UserPolicy`, which was removed with `FixedPolicy` because no consumer named them; `auth-ip` and `mcp` are the only named rate-limit policies, and the rate-limit anchors are refreshed. See the Revision (2026-11-17) at the end.
Revised 2026-11-23: `MapCommonMcp` now refuses startup when a registered tool declares neither access attribute (MMCA.Common v1.313.0), so the declaration is enforced at startup as well as by the test, superseding the 2026-11-08 test-time-only sentence above; `McpHiddenText` is public with a `Strip` for tool results (v1.315.0); ADC has adopted the endpoint and wraps speaker-written result text as untrusted. See the Revision (2026-11-23) at the end.

## Context
AI clients (Claude Code, Claude Desktop, any Model Context Protocol client) can query an application
through tools a server exposes. A consumer that wants to offer its data to such a client had no
framework surface for it: there was no MCP endpoint, and nothing that governs which tool a caller may
see or call, how often, or what a tool's description says to the model that reads it.

Four forces shaped the decision:

- **Vendor SDKs stay out of the core.** [ADR-134](134-cloud-neutral-core-vendor-adapters.md) keeps
  third-party SDKs in adapter packages a host opts into, and [ADR-120](120-governed-chat-client-boundary.md)
  does the same for the AI boundary. The official MCP C# SDK is such a dependency.
- **The read path already exists and is governed.** Every module exposes its reads as query handlers
  behind the decorator pipeline ([ADR-014](014-cqrs-decorator-pipeline.md)): authorization, caching,
  validation and timeouts already apply there. A second read path that bypassed it would need its own
  copy of each.
- **A description is an instruction.** A model reads tool, parameter and server descriptions as
  guidance. Text a reviewer cannot see in a diff (zero-width and bidirectional control characters,
  Unicode tag characters, an HTML comment) is a way to put instructions in front of the model that no
  review would approve.
- **Access tokens are short-lived.** The default access-token lifetime is 15 minutes
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:66`), so a token pasted
  into an MCP client's configuration stops working almost at once. Public data needs no token at all;
  anything permissioned needs a client that can refresh.

## Decision
**An opt-in Presentation package wraps the official SDK, exposes read-only tools over the existing
query handlers, and governs each tool by configuration, permission and rate limit. Startup is refused
when any description hides text or any tool leaves its access undeclared.**

1. **One package, the only reference to the SDK.** `MMCA.Common.Mcp` sits under `Source/Presentation`,
   references `MMCA.Common.API` and `ModelContextProtocol.AspNetCore`
   (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/MMCA.Common.Mcp.csproj:11-12`), pinned exactly at
   2.4.0 (`MMCA.Common/Directory.Packages.props:181`), and is in the solution
   (`MMCA.Common/MMCA.Common.slnx:25`). No other framework package references it.
2. **Two calls opt a host in.** `builder.AddCommonMcpServer(options => ...)`
   (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:52`) binds the `Mcp`
   section with `ValidateOnStart` (`:57-63`; `McpSettings.cs:22`) and, only when `Mcp:Enabled` is true
   (`:65-68`; `McpSettings.cs:25`, default false), registers the SDK server with the stateless
   streamable HTTP transport (`:77-78`), the two governance filters (`:79-83`) and the tool classes the
   host names, by type (`CommonMcpOptions.ToolTypes`, `:87`) or by assembly
   (`CommonMcpOptions.ToolAssemblies`, `:89-92`; `CommonMcpOptions.cs:12`, `:15`).
   `app.MapCommonMcp()` (`:114`) maps `/mcp` (`DefaultPath`, `:41`) anonymous at the HTTP layer with
   the `mcp` rate-limit policy (`:134-136`). With MCP disabled nothing is mapped, so the path answers 404
   (`:105-106`, `:119-128`); with `Mcp:Enabled` true but `AddCommonMcpServer` never called, the host
   refuses to start (`:123-124`).
3. **Tools are read-only wrappers over query handlers.** A tool is a static `[McpServerToolType]` class
   in the module's API project, each method `[McpServerTool(ReadOnly = true)]` with a `[Description]`,
   injecting the query handler the HTTP endpoint injects, so the decorator pipeline applies to a tool
   call exactly as to a request (`McpHostingExtensions.cs:20-26`). The package offers no write tools,
   resources or prompts, and the server never calls a model.
4. **Per-tool governance through the SDK's request filters**
   (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolGovernance.cs:14-20`):
   - **Enable.** `Mcp:Tools:<name>:Enabled` (default true, `McpToolSettings.cs:10`; tool names matched
     ignoring case, `McpSettings.cs:31`). A disabled tool is dropped from `tools/list` (`:37`) and a
     call to it is refused with `Mcp.ToolUnavailable` (`:63-66`).
   - **Permission.** An optional `[McpToolPermission("area:capability")]` on the tool method
     (`McpToolPermissionAttribute.cs:11`) is checked through `IAuthorizationService` against the same
     `perm:` policy `[HasPermission]` resolves (`McpToolGovernance.cs:130-145`;
     `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:12`, `:17`), so a
     role grant or a direct permission claim admits the caller exactly as on the module's HTTP endpoint.
     A tool without the attribute is public at runtime (`McpToolGovernance.cs:132-135`), and must carry
     `[McpToolPublic]` instead or the endpoint refuses to start (point 6). A caller who lacks the permission, or is not signed in, does
     not see the tool in `tools/list` (`:38`) and is refused with `Mcp.Forbidden` (`:68-74`).
   - **Rate.** `Mcp:Tools:<name>:PermitsPerMinute` (`McpToolSettings.cs:17`; validated to be 1 or more,
     `McpHostingExtensions.cs:60-62`) limits one caller per tool, keyed by user id, else client IP, else
     one shared `anonymous` key (`McpToolGovernance.cs:147-150`), in a one-minute fixed window with no
     queue (`McpToolRateLimiter.cs:16-25`); the call after the limit is refused with `Mcp.RateLimited`
     (`McpToolGovernance.cs:76-83`).
   - **Refusals are tool results, not exceptions.** Each is an `IsError` result whose text carries the
     code (`:154-158`), so the model reads it and stops rather than retrying blindly. The filtered
     `tools/list` is marked private to the caller (`:46-47`), since it depends on who asked.
   - The filters read `IOptionsMonitor<McpSettings>.CurrentValue` on every request (`:32`, `:61`), and a
     changed permit count starts a fresh window (`McpToolRateLimiter.cs:13-18`).
5. **The endpoint is metered as a whole too.** `AddCommonRateLimiting` registers the `mcp` policy beside
   the global limiter (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:57`,
   `:442`), and `MapCommonMcp` requires it on the mapped endpoint
   (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:136`): one bucket per user
   id, then name, then client IP (`WebApplicationBuilderExtensions.RateLimiting.cs:209-224`), at
   `RateLimiting:McpPermitLimit` requests per minute (default 60, `[Range(1, 1_000_000)]`,
   `MMCA.Common/Source/Presentation/MMCA.Common.API/RateLimiting/RateLimitingSettings.cs:42-43`), so an
   anonymous caller of a public tool is metered, unlike under the global limiter, which exempts
   anonymous traffic outside the hub paths (`WebApplicationBuilderExtensions.RateLimiting.cs:102`). A
   caller with no user and no IP gets no limiter (`:215`), the same fail-open choice as the `auth-ip`
   policy (`:345`).
6. **Startup refuses hidden text (R023) and undeclared access.** Before mapping, `MapCommonMcp` runs
   `ToolDescriptionInspector.ThrowIfHiddenText` over the server instructions, title and description, and
   over every tool's name, title, annotation title, description and each string of its input and output
   schema, where parameter descriptions live
   (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/ToolDescriptionInspector.cs:25-93`,
   `McpHostingExtensions.cs:131`). The character checks live in the public `McpHiddenText` class: a
   Unicode format character (category Cf: zero-width characters, bidi controls,
   `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHiddenText.cs:36`), a tag character U+E0000 to
   U+E007F (`:83`) or an HTML comment opener `<!--` (`:16`) fails startup with a message naming each
   location (`ToolDescriptionInspector.cs:54-57`). Visible text, accented letters and emoji included,
   passes (`MMCA.Common/Tests/Presentation/MMCA.Common.Mcp.Tests/ToolDescriptionInspectionTests.cs:79-82`).
   It then runs `McpToolGovernance.ThrowIfAccessUndeclared` (`McpHostingExtensions.cs:132`;
   `McpToolGovernance.cs:95-112`), which fails startup with a message naming every registered tool
   that carries neither `[McpToolPermission]` nor `[McpToolPublic]`.
7. **Authentication: public tools anonymous, permissioned tools bearer.** The endpoint allows anonymous
   callers; a permissioned tool is listed and callable only for a caller the host's bearer handler signed
   in with that permission, so `UseAuthentication` must run before the endpoint, as it does for
   controllers (`McpHostingExtensions.cs:27-32`). Programmatic clients that refresh their own tokens
   suit permissioned tools; a long-lived personal token or an OAuth 2.1 authorization server is not
   offered (see Alternatives).

The package's own tests pin the governance end to end over a test host: a public tool callable
without a token, a disabled tool absent and refused, a permissioned tool hidden and refused without the
permission and callable with it, the per-tool limit, and 404 when disabled
(`MMCA.Common/Tests/Presentation/MMCA.Common.Mcp.Tests/McpGovernanceTests.cs:19`, `:34`, `:52`, `:66`,
`:81`, `:102`), and the hidden-text refusal for tool, parameter and server descriptions
(`ToolDescriptionInspectionTests.cs:24`, `:42`, `:56`).

## Rationale
- **Tools over query handlers keep one governed read path.** Authorization, caching and validation are
  already decided per query; a tool that calls the handler inherits them instead of restating them.
- **A separate package keeps the SDK where ADR-134 puts vendor code.** A host that never offers MCP takes
  no MCP dependency, and an SDK major version (1.x to 2.x within a year) is one package's upgrade, pinned
  exactly, rather than every consumer's.
- **Governance by configuration lets an operator act without a release.** Disabling a tool or lowering
  its limit is a configuration change; hiding what a caller cannot call keeps `tools/list` from
  advertising work that would only fail.
- **Refusing startup is the only point a hidden instruction can be stopped for certain.** Once a tool
  is listed, the model has read its description. A check at map time fails the deploy instead.
- **Anonymous public tools match the data.** The intended first tools wrap reads that are already
  anonymous on HTTP; requiring a token for them would add friction without adding protection.

## Trade-offs
- **A new public surface per consumer that opts in.** Mitigated by read-only tools, the per-tool and
  endpoint limits, and anonymous access limited to data already public over HTTP; it is still one more
  endpoint to monitor.
- **The per-tool limit is per instance.** `McpToolRateLimiter` is an in-memory partitioned limiter, so N
  replicas allow up to N times `PermitsPerMinute` per caller; the endpoint-wide `mcp` policy can use the
  shared Redis counters when `RateLimiting:Distributed` is on (`WebApplicationBuilderExtensions.RateLimiting.cs:224`, `:268`).
- **Anonymous callers behind one address share a bucket.** The per-tool key falls back to the client IP,
  so users behind one NAT share a public tool's limit, and a caller with neither identity shares the
  `anonymous` key.
- **Permissioned tools need a refreshing client.** With 15-minute access tokens, a desktop client
  configured with a pasted token works for minutes. That is the cost of deferring a long-lived credential.
- **The description check is a denylist of hidden forms.** It stops text a reviewer cannot see; it does
  not judge visible text, which stays a code-review matter.

## Alternatives rejected
- **An OAuth 2.1 authorization server now** (2026-11-07). It is the MCP specification's answer for
  third-party clients, but it is a credential issuer, consent screens and a token store for a need no
  consumer has yet. It stays deferred with API keys and client credentials in the
  *Enterprise-scale register* of [the Common backlog](../governance/common-RemediationBacklog.md).
  **Revisit:** the first external integrator.
- **A production diagnostics MCP server** (dropped 2026-11-07). Tools that read logs, traces or tables
  for an operator's AI client would be a permanent read path to all data, outside the module
  boundaries and their authorization. Diagnostics stay with the telemetry backends.
- **Scanning tool results for injected instructions** (dropped 2026-11-06). Results are module data
  returned by the host's own query handlers; the startup check this record keeps is on descriptions,
  the text the host authors and a model reads as guidance. A tool that returns third-party text
  removes its invisible characters with `McpHiddenText.Strip` (`McpHiddenText.cs:63-78`), which
  detects nothing and only cleans; see the Revision (2026-11-23).
- **Building the tools on Common.AI's `IChatClient`** (2026-11-07). The server never calls a model: the
  model is the user's own client. Coupling the package to the AI boundary would add a dependency with
  nothing to do.

## Consequences
- Each consumer that offers MCP adds two calls, its tool classes and, behind a gateway, a route to
  `/mcp`. ADC has adopted it in its Conference service, with public schedule, session and speaker
  tools (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:367`, `:378`); Store and
  Helpdesk leave it off.
- `MMCA.Common/FACTS.md` lists the package and its single framework
  reference, `MMCA.Common.API`; no other package's row names it.
- A host that offers only public data needs no privacy-notice change for this endpoint: no personal
  data is exposed and the AI provider is the user's own client.

## Revision (2026-11-08): machine tokens and event-scoped ADC tools
**Context.** Point 7 left permissioned tools to "programmatic clients that refresh their own tokens",
but only a person could obtain a token, so in practice no program could call one. MMCA.Common v1.281.0
adds machine clients ([ADR-140](140-machine-clients-oauth-client-credentials.md)). Separately, ADC's
first session and speaker tools took no event at all, so a question about "the schedule" could mix
editions and a client had no way to name one.

**Decision.**
- **A machine token is a bearer token the permission check already accepts.** A program obtains one
  through the client credentials grant; its `sub` is the client's service account and its permission
  claims are that account's role's
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/MachineClients/MachineClientService.cs:103-115`;
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:159-171`). The permission
  filter checks the `perm:` policy through `IAuthorizationService` (point 4), so a machine token
  holding the tool's permission is listed and admitted with no MCP change. Point 7's "Programmatic
  clients that refresh their own tokens" is now concretely a machine client asking `auth/token` again
  every 15 minutes or less.
- **OAuth 2.1 for desktop clients stays deferred.** A machine client is a server-to-server credential
  an operator issues to a program, not a user's consent to a third-party client acting for them.
  Claude Desktop or another desktop client calling a permissioned tool on a person's behalf still
  needs the authorization server this record rejected; that entry stands. The register row it
  pointed to no longer lists client credentials (ADR-140 shipped them); API keys stay rejected there.
- **ADC's tools read one event at a time.** All in
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Mcp/` (no handler, schema or migration
  change):
  - A new `list_events` tool lists the published events, newest first, with id, name, first and last
    day, time zone, venue and a status of `live`, `upcoming` or `past`
    (`ConferenceMcpTools.cs:32-40`; `ConferenceMcpResults.cs:53-68`), the status judged by the app's
    own live window (`ConferenceMcpReader.cs:331-340`).
  - `list_sessions`, `list_speakers` and `now_next` take an optional `eventId`, and `get_speaker`
    takes one to choose which event's sessions it lists (`ConferenceMcpTools.cs:50-62`, `:86-130`).
    Omitted, it means the current event: live now, else the next upcoming, else the most recently
    ended (`ConferenceMcpTools.cs:23-24`; `ConferenceMcpReader.cs:40-43`, `:346-361`).
  - An id that is not a published event answers `Mcp.EventNotFound` before anything else is read
    (`ConferenceMcpReader.cs:321-326`, `:358-359`).
  - Session summaries and details carry `EventId` and `EventName` (`ConferenceMcpResults.cs:17-51`);
    `get_session` takes no `eventId`, because a session belongs to one event.
  - The new tool and parameter descriptions pass the hidden-text check (point 6) like the rest.

**Consequences.**
- A consumer that wants programs to call permissioned tools turns on machine clients (ADR-140) and
  grants the tool's permission to the role behind the client; nothing in the MCP package changes.
- An ADC MCP client should call `list_events` first when the user names an edition.

## Revision (2026-11-08, access declaration)

**Context.** A tool with no `[McpToolPermission]` is public at runtime, so a tool someone forgot to
protect and a tool left public on purpose look identical in source.

**Decision.** A tool now says which it is. `[McpToolPublic]`
(`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolPublicAttribute.cs:11-12`) records that a tool is
public on purpose and has no runtime effect. `McpToolAccessDeclarationTestsBase`
(`MMCA.Common.Testing.Architecture/Bases/`, over `ArchitectureRules.McpToolsDeclareAccess` at
`Rules/Api/ArchitectureRules.McpToolAccess.cs:18-35`) fails when an `[McpServerTool]` method, or an override
of one, declares neither or both of the two attributes. The attributes are read where declared, so an
override states its own, while `[McpServerTool]` is read with inheritance (`:23`, `:59`). The rule
also exposes `CountMcpTools` (`:43-47`) so a host can assert a non-vacuity floor and a renamed assembly
cannot pass having inspected nothing. The runtime rule in the Decision above is unchanged: a tool without
`[McpToolPermission]` is still public, and the permission gate still wins if both were somehow present.

**Consequences.**
- A host adds a subclass of the base naming its tool assemblies, and every existing tool needs one of the
  two attributes before that test passes.
- The declaration is enforced by the test, not at runtime: a host that does not subclass the base keeps the
  old behaviour.

## Revision (2026-11-17)

**Context.** The framework's opt-in `FixedPolicy` and `UserPolicy` rate-limit policies, the
`UserPolicyRateLimitPartition` selector and the `PermitLimit`, `QueueLimit` and `PerUserPermitLimit`
settings were removed in the API-projects drift review (MMCA.Common v1.300.0) because no consumer
named them (ADR-019, Revision (2026-11-17)).

**Decision.** The `mcp` policy is unchanged: same partition key, same `McpPermitLimit` default of 60,
same fail-open rule for a caller with no user and no IP, and still distributed when
`RateLimiting:Distributed` is set (`allowDistributed: true`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:223`).
Point 5 now names its registration beside the global limiter (`:439`) rather than beside `UserPolicy`,
and its anchors are re-verified against current source.

**Consequences.**
- `auth-ip` and `mcp` are the only named policies `AddCommonRateLimiting` registers; a host that wants
  a general per-user tightening policy registers its own.

## Revision (2026-11-23)

Re-verified against current source. The package boundary, the per-tool filters, the endpoint-wide
`mcp` policy and the hidden-text inspection of descriptions are unchanged. What moved: undeclared
access is now refused at startup rather than only by a test, the hidden-text checks became a public
class with a cleaner for tool results, and ADC has adopted the endpoint.

1. **Undeclared access fails startup** (MMCA.Common v1.313.0, a breaking change,
   `MMCA.Common/CHANGELOG.md:62`). `MapCommonMcp` calls `McpToolGovernance.ThrowIfAccessUndeclared`
   after the hidden-text check
   (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:132`), and it throws with
   a message naming every registered tool that carries neither `[McpToolPermission]` nor
   `[McpToolPublic]` (`McpToolGovernance.cs:95-112`). One such tool fails the whole endpoint's
   startup, not just its own listing. The check reads `ToolCollection` once, when `MapCommonMcp` runs
   (`:99`; `McpHostingExtensions.cs:130-132`); at runtime the filters still treat a tool without
   `[McpToolPermission]` as public and never read `[McpToolPublic]` (`McpToolGovernance.cs:132-135`).
   This replaces the Revision
   (2026-11-08, access declaration) statements that `[McpToolPublic]` "has no runtime effect" and
   that a host not subclassing the test base "keeps the old behaviour": the attribute is now one of
   the two declarations the startup check accepts (`McpToolGovernance.cs:100-101`;
   `McpToolPublicAttribute.cs:5-9`). A tool carrying both is still admitted by the permission at
   runtime (`FindPermission`, `McpToolGovernance.cs:117-126`); only
   `McpToolAccessDeclarationTestsBase` rejects "both". Decision points 4 and 6 and the headline are
   updated in place.
2. **The hidden-text checks are a public class** (v1.315.0, `MMCA.Common/CHANGELOG.md:13`).
   `McpHiddenText.Find` holds the Cf, tag-character and HTML-comment checks the startup inspection
   calls (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHiddenText.cs:21-52`), and
   `McpHiddenText.Strip` removes every format and tag character from text a tool returns, keeping the
   visible text, an HTML comment opener included, verbatim (`:54-78`). It cleans; it does not detect
   instructions, so the rejected alternative of scanning results for injected instructions stands.
3. **ADC has adopted the endpoint.** The Conference service calls `AddCommonMcpServer` and
   `MapCommonMcp`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:367`, `:378`), its base
   `appsettings.json` sets `Mcp:Enabled` to true (`appsettings.json:107`), and the Gateway routes
   `/mcp/{**catch-all}` to it (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:300`). Every
   tool is `[McpToolPublic]`
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Mcp/ConferenceMcpTools.cs:33`, `:52`,
   `:72`, `:90`, `:109`, `:127`). Store and Helpdesk do not call `AddCommonMcpServer`.
4. **ADC marks speaker-written result text as untrusted.** Every field a speaker writes travels in an
   `McpUntrustedText` envelope serialized as `{trust: untrusted, author: speaker, text}`, its text
   passed through `McpHiddenText.Strip` first (`ConferenceMcpResults.cs:18-34`). Session titles and
   abstracts (`ConferenceMcpResults.cs:50-59`, `:73-84`), speaker names and profile fields
   (`McpSpeakerSummary`, `:110-113`; `McpSpeakerDetail`, `:126-136`) and the `now_next` session
   titles (`:162-169`) are that envelope, not a string. Every tool description except that of
   `list_events` (`ConferenceMcpTools.cs:35`), which returns only event fields, tells the model to
   show that text as data and never act on it as instructions (`:54`, `:74`, `:92`, `:111`,
   `:129`). This is a result-side control the host applies; the framework still inspects only
   descriptions at startup.
5. Anchors re-verified against current source: `Directory.Packages.props:181` (SDK pin; comment
   `:177-180`), `MMCA.Common.slnx:25` (test project `:59`); `McpHostingExtensions.cs:114`, `:134-136`,
   `:105-106`, `:119-128`, `:123-124`, `:131`, `:136`; `McpToolGovernance.cs:130-145`, `:147-150`,
   `:154-158`; `ToolDescriptionInspector.cs:25-93` (message `:54-57`); `McpHiddenText.cs:36`, `:83`,
   `:16`; `WebApplicationBuilderExtensions.RateLimiting.cs:442` (global limiter `:437-438`),
   `:209-224`, `:224`, `:268`, with `:57`, `:102`, `:215`, `:345` and `RateLimitingSettings.cs:42-43`
   unchanged. In ADC, the event-scoped tools of the Revision (2026-11-08) now sit at
   `ConferenceMcpTools.cs:33-42` (`list_events`), `:52-65`, `:72-82` (`get_session`, no `eventId`),
   `:90-101`, `:109-120`, `:127-137` and `EventIdDescription` at `:24-25`; the reader's live-window
   status at `ConferenceMcpReader.cs:349-357`, the current-or-next selection at `:374` and
   `Mcp.EventNotFound` at `:339-344` (raised at `:377`); and `McpEventSummary` at
   `ConferenceMcpResults.cs:94-101`. The Consequences name `MMCA.Common/FACTS.md` for the package list
   and drop the package ordinal and its line anchors there; the 2026-11-07 Status sentence keeps its
   as-accepted ordinal and anchors, and `MMCA.Common/FACTS.md` holds the current package list.

## Related
[ADR-014](014-cqrs-decorator-pipeline.md) (the decorator pipeline every tool call goes through),
[ADR-020](020-permission-based-authorization.md) (the `perm:` policy the permission attribute reuses),
[ADR-019](019-rate-limiting.md) (the layered rate limiter the `mcp` policy joins),
[ADR-120](120-governed-chat-client-boundary.md) (the AI boundary this package deliberately does not use),
[ADR-134](134-cloud-neutral-core-vendor-adapters.md) (why a third-party SDK lives in its own package),
[ADR-070](070-fail-fast-configuration-contract.md) (the validating chain the `Mcp` section binds through).

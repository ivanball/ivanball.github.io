# ADR-138: MCP Endpoint Over Module Queries (Opt-In, Read-Only, Governed Per Tool)

## Status
Accepted (2026-11-07). Ships in the MMCA.Common release after v1.277.0 as a new package,
`MMCA.Common.Mcp`, the framework's 27th (`MMCA.Common/FACTS.md:20`, `:32`). Off unless a host calls
both registration methods and sets `Mcp:Enabled`.

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
when any description hides text.**

1. **One package, the only reference to the SDK.** `MMCA.Common.Mcp` sits under `Source/Presentation`,
   references `MMCA.Common.API` and `ModelContextProtocol.AspNetCore`
   (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/MMCA.Common.Mcp.csproj:11-12`), pinned exactly at
   2.4.0 (`MMCA.Common/Directory.Packages.props:123`), and is in the solution
   (`MMCA.Common/MMCA.Common.slnx:21`). No other framework package references it.
2. **Two calls opt a host in.** `builder.AddCommonMcpServer(options => ...)`
   (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:52`) binds the `Mcp`
   section with `ValidateOnStart` (`:57-63`; `McpSettings.cs:22`) and, only when `Mcp:Enabled` is true
   (`:65-68`; `McpSettings.cs:25`, default false), registers the SDK server with the stateless
   streamable HTTP transport (`:77-78`), the two governance filters (`:79-83`) and the tool classes the
   host names, by type (`CommonMcpOptions.ToolTypes`, `:87`) or by assembly
   (`CommonMcpOptions.ToolAssemblies`, `:89-92`; `CommonMcpOptions.cs:12`, `:15`).
   `app.MapCommonMcp()` (`:112`) maps `/mcp` (`DefaultPath`, `:41`) anonymous at the HTTP layer with
   the `mcp` rate-limit policy (`:130-132`). With MCP disabled nothing is mapped, so the path answers 404
   (`:100-106`, `:117-126`); with `Mcp:Enabled` true but `AddCommonMcpServer` never called, the host
   refuses to start (`:119-123`).
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
     `perm:` policy `[HasPermission]` resolves (`McpToolGovernance.cs:102-119`;
     `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:12`, `:17`), so a
     role grant or a direct permission claim admits the caller exactly as on the module's HTTP endpoint.
     A tool without the attribute is public. A caller who lacks the permission, or is not signed in, does
     not see the tool in `tools/list` (`:38`) and is refused with `Mcp.Forbidden` (`:68-74`).
   - **Rate.** `Mcp:Tools:<name>:PermitsPerMinute` (`McpToolSettings.cs:17`; validated to be 1 or more,
     `McpHostingExtensions.cs:60-62`) limits one caller per tool, keyed by user id, else client IP, else
     one shared `anonymous` key (`McpToolGovernance.cs:121-124`), in a one-minute fixed window with no
     queue (`McpToolRateLimiter.cs:16-25`); the call after the limit is refused with `Mcp.RateLimited`
     (`McpToolGovernance.cs:76-83`).
   - **Refusals are tool results, not exceptions.** Each is an `IsError` result whose text carries the
     code (`:126-132`), so the model reads it and stops rather than retrying blindly. The filtered
     `tools/list` is marked private to the caller (`:46-47`), since it depends on who asked.
   - The filters read `IOptionsMonitor<McpSettings>.CurrentValue` on every request (`:32`, `:61`), and a
     changed permit count starts a fresh window (`McpToolRateLimiter.cs:13-18`).
5. **The endpoint is metered as a whole too.** `AddCommonRateLimiting` registers the `mcp` policy beside
   `UserPolicy` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:57`,
   `:482-485`): one bucket per user id, then name, then client IP, at `RateLimiting:McpPermitLimit`
   requests per minute (default 60, `[Range(1, 1_000_000)]`,
   `MMCA.Common/Source/Presentation/MMCA.Common.API/RateLimiting/RateLimitingSettings.cs:54-55`), so an
   anonymous caller of a public tool is metered, unlike under the global limiter (`:52-55`). A caller
   with no user and no IP gets no limiter, the same fail-open choice as the `auth-ip` policy (`:224-249`).
6. **Startup refuses hidden text (R023).** Before mapping, `MapCommonMcp` runs
   `ToolDescriptionInspector.ThrowIfHiddenText` over the server instructions, title and description, and
   over every tool's name, title, annotation title, description and each string of its input and output
   schema, where parameter descriptions live
   (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/ToolDescriptionInspector.cs:55-93`,
   `McpHostingExtensions.cs:128`). A Unicode format character (category Cf: zero-width characters, bidi
   controls, `:36`), a tag character U+E0000 to U+E007F (`:97`) or an HTML comment opener `<!--`
   (`:16`) fails startup with a message naming each location (`:88-92`). Visible text, accented letters
   and emoji included, passes (`MMCA.Common/Tests/Presentation/MMCA.Common.Mcp.Tests/ToolDescriptionInspectionTests.cs:79-82`).
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
  shared Redis counters when `RateLimiting:Distributed` is on (`WebApplicationBuilderExtensions.RateLimiting.cs:241-248`).
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
  returned by the host's own query handlers; the check this record keeps is on descriptions, the text
  the host authors and a model reads as guidance.
- **Building the tools on Common.AI's `IChatClient`** (2026-11-07). The server never calls a model: the
  model is the user's own client. Coupling the package to the AI boundary would add a dependency with
  nothing to do.

## Consequences
- Each consumer that offers MCP adds two calls, its tool classes and, behind a gateway, a route to
  `/mcp`. ADC is the intended first adopter, with public schedule, session and speaker tools; Store and
  Helpdesk leave it off.
- `MMCA.Common/FACTS.md` lists the 27th package and its single framework reference
  (`FACTS.md:32`, `:67`).
- A host that offers only public data needs no privacy-notice change for this endpoint: no personal
  data is exposed and the AI provider is the user's own client.

## Related
[ADR-014](014-cqrs-decorator-pipeline.md) (the decorator pipeline every tool call goes through),
[ADR-020](020-permission-based-authorization.md) (the `perm:` policy the permission attribute reuses),
[ADR-019](019-rate-limiting.md) (the layered rate limiter the `mcp` policy joins),
[ADR-120](120-governed-chat-client-boundary.md) (the AI boundary this package deliberately does not use),
[ADR-134](134-cloud-neutral-core-vendor-adapters.md) (why a third-party SDK lives in its own package),
[ADR-070](070-fail-fast-configuration-contract.md) (the validating chain the `Mcp` section binds through).

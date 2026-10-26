# ADR-007: Synchronous Cross-Service Calls via gRPC Contracts

## Status
Accepted. Revised 2026-08-23 (the `[ServiceContract]` marker now has a dedicated fitness rule behind
it, `ServiceContractPurityTestsBase`, subclassed in all four repos; it is a ratchet that no marked
type triggers yet). Revised 2026-09-04: the `*.Contracts` gRPC adapter is named for what it is, the
module's **Anti-Corruption Layer**; no code changed. Revised 2026-10-06: the `[ServiceContract]` ratchet
is now triggered (ADC marks six interfaces and Store four), a second fitness rule keeps their
implementations non-public, and the h2c, JWKS and disabled-stub bullets are narrowed to current wiring.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release.
Revised 2026-10-21: ADC now marks seven `[ServiceContract]` interfaces, and the auth bullets record
Store's one shared-secret exception (an HS256 service token on the Sales -> Identity Customers edge).
Revised 2026-10-26: anchors refreshed after the v1.261.0 release.

## Context
Once modules became separate service processes, the in-process interface calls between them (e.g.
Conference → Engagement's `IBookmarkCountService`, Engagement → Conference's
`ISessionBookmarkValidationService`) had to cross a process boundary. Asynchronous integration
events (outbox → broker, ADR-003) cover fire-and-forget flows, but some calls need a **synchronous
answer**. We needed a transport for those that preserved the existing application interfaces and the
`Result<T>` error model, without coupling application/domain code to a transport.

## Decision
Use **gRPC**, exposed through `MMCA.Common.Grpc`, with a contract-package convention:

- **`*.Contracts` projects** hold the `.proto` definitions plus a gRPC adapter that implements the
  **same in-process service interface** the modules already used. Any project ending in `.Contracts`
  auto-compiles `Protos/**/*.proto` with both server and client stubs (`Directory.Build.props`).
  That adapter is the module's **Anti-Corruption Layer**: it is the only place the peer's wire model
  (generated protobuf messages and client stubs) meets the module's own interface and `Result<T>`
  types, so a peer's contract never leaks into Domain or Application. The convention is documented on
  the typed-client registration itself ("register a hand-written adapter that implements the consuming
  module's own C# interface contract ... and delegates to this typed gRPC client. That adapter IS the
  consuming module's Anti-Corruption Layer",
  `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:74-76`, with the package's
  own class remarks naming both this pattern and the Strangler Fig route at `:16-25`) and enforced by the
  transport fitness rule below, which forbids gRPC and protobuf types outside the adapter's layer.
- **Typed clients** via `AddTypedGrpcClient<T>(serviceName)` resolve `http://<service>` through
  Aspire service discovery, wrapped in the standard Polly resilience pipeline and a
  `JwtForwardingClientInterceptor` (the inbound bearer token is forwarded downstream). A client can
  also opt in, one registration at a time, to a service token with `.WithServiceToken()`, which needs
  the host to call `AddServiceTokenClient(configuration)` as well
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenHttpClientBuilderExtensions.cs:23-25`);
  registering the provider sends nothing by itself
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:17-22`).
  Store's Customers client is the only adopter
  (`MMCA.Store/Source/Services/MMCA.Store.Identity.Contracts/DependencyInjection.cs:46`, with
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:300`); ADC uses neither.
- **`Result` failures over the wire**: the server-side `GrpcResultExceptionInterceptor` maps a failed
  `Result` to an `RpcException` carrying the structured `ErrorType`/code, mirroring the HTTP
  `HandleFailure` edge mapping (ADR-013). Adapters whose interface returns a `Result` (for example
  `SessionBookmarkValidationServiceGrpcAdapter`) re-hydrate that failure **client-side** by parsing the
  `error-{i}-*` trailers, so the caller sees the same `Result` shape it would from an in-process call.
  Adapters whose interface returns a plain type (for example `Task<int>` or `Task<IReadOnlyList<T>>`)
  surface a remote failure as a thrown exception instead.
- **HTTP/2 cleartext (h2c)**: every gRPC target serves HTTP/2 on a cleartext endpoint so clients
  negotiate without TLS/ALPN (a deliberate `SocketsHttpHandler` override). That is the default endpoint
  of an `Http2`-only service, or a dedicated `Http2`-only `grpc` endpoint on the mixed-profile services
  (see Trade-offs).
- **Federated auth, not a shared secret (except one service-token edge)**: services validate forwarded JWTs against the issuer's
  JWKS (ADR-004) through `AddForwardedJwtBearer`, which fetches OIDC discovery and the JWKS from the
  configured authority and pins RS256
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:52`,
  `:109`). Under the AppHost the authority is wired by `WithJwksDiscovery(identity, gateway)`, whose
  gateway argument is optional (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:322-324`);
  in production the bicep points the authority straight at Identity's internal cleartext URL with
  `RequireHttpsMetadata=false`, not through the gateway (`MMCA.ADC/infra/main.bicep:2195`, `:2199`;
  `MMCA.Store/infra/main.bicep:1781`, `:1786`). This holds for every user token. The one
  shared-secret exception is Store's Sales -> Identity Customers edge: Identity registers
  `AddServiceTokenAuthentication`
  (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:179`), a second JwtBearer
  scheme that validates HS256 against the shared `Grpc:ServiceToken:SigningKey`
  (`ServiceTokenServiceCollectionExtensions.cs:141-144`) and is never the default scheme, and maps
  the Customers service under the `InternalCaller` policy
  (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:354`), which accepts an
  authenticated caller under either scheme (`ServiceTokenServiceCollectionExtensions.cs:84-87`): a
  forwarded user JWT, or a service token signed with the shared key and carrying a `svc` claim (the
  scheme refuses one without it, `:151-157`; it does not check which service the claim names).
  Sales is the only host that mints one, and attaches it on calls that have no user token to forward.
- **Disabled-module stubs**: when a multi-module host runs with a peer module switched off,
  `ModuleLoader` registers that module's `Disabled*` stubs so resolution always succeeds
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:119`). The extracted
  service hosts name only their own module assembly (for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:221`), so peers are never
  discovered, no stub is registered, and the gRPC adapter registration satisfies the interface.

## Rationale
- **No business-logic rewrite**: the gRPC adapter implements the interface modules already depend
  on; swapping in-process for cross-process is a registration change.
- **Transport stays at the edge**: `MicroserviceExtractionTests` forbid `MassTransit`/gRPC types in
  Application/Domain/Shared, so the choice is reversible and the core stays clean.
- **Strong contracts**: the `.proto` definitions plus the in-process interface the adapter
  implements are the wire surface. A `[ServiceContract(version)]` attribute (MMCA.Common.Shared) is
  provided to mark and version contract types explicitly, and a fitness rule stands behind it:
  `ServiceContractPurityTestsBase.ServiceContracts_ShouldNotDependOn_ServiceInternals`
  (MMCA.Common.Testing.Architecture, rule body
  `ArchitectureRules.ServiceContractsDoNotDependOnServiceInternals`) scans every assembly the repo's
  architecture map registers and fails any marked type that depends on the producing service's
  Domain, Application or Infrastructure. All four repos subclass it. A second rule,
  `ContractImplementationTestsBase.ServiceContractImplementations_ShouldNotBe_Public`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Contracts/ContractImplementationTestsBase.cs:33`,
  rule body `ArchitectureRules.ServiceContractImplementationsAreNotPublic` at
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Contracts.cs:81`),
  fails any public concrete class implementing a marked interface, with an
  `AllowedPublicImplementations` escape hatch (`ContractImplementationTestsBase.cs:30`); all four repos
  subclass it too. Both rules are **triggered in ADC and Store**, whose architecture maps register the
  module Shared assemblies (`AdcArchitectureMap.cs:31`, `:39`, `:47`, `:53`;
  `StoreArchitectureMap.cs:25`, `:33`, `:41`). ADC marks seven interfaces
  (`ISessionBookmarkValidationService.cs:10`, `IEventLiveValidationService.cs:12`,
  `IBookmarkCountService.cs:10`, `IUserEngagementExportService.cs:13`, `IAttendeeQueryService.cs:10`,
  `IUserNotificationExportService.cs:13`, `IUserConferenceExportService.cs:13`) and Store four (`IProductVariantService.cs:33`,
  `IUserCatalogExportService.cs:19`, `IUserSalesExportService.cs:20`, `ICustomerService.cs:25`), all
  with the parameterless form, so none passes a version. MMCA.Common and Helpdesk mark nothing
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:12-13`), so
  there the rules stay a ratchet that passes without asserting anything.

## Trade-offs
- **Bidirectional pairs need care.** Conference ↔ Engagement is a mutual gRPC pair; the AppHost
  deliberately omits a reciprocal `WaitFor` to avoid a startup deadlock: transient "peer not ready"
  errors self-heal via the resilience pipeline.
- **h2c assumptions.** Target services must serve HTTP/2 on cleartext; the Notification service runs
  `Http1AndHttp2` on its default endpoint for its SignalR WebSocket upgrade, unlike the `Http2`-only
  REST services, and carries a second, `Http2`-only `grpc` endpoint for its gRPC ingress (ADR-012)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:58-73`; `appsettings.json:13`,
  `:17`). Store's Sales service runs the same mixed profile: its default endpoints stay `Http1AndHttp2`
  because REST and the Stripe webhook arrive over HTTP/1.1, and a dedicated `Http2`-only `grpc`
  endpoint serves `IUserSalesExportService`
  (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:66-80`; `appsettings.json:13`, `:17`).
- **Operational surface.** gRPC adds proto tooling, service discovery, and resilience tuning to the
  deployment.

## Revision (2026-10-06)
- The `[ServiceContract]` purity rule is no longer an untriggered ratchet: ADC marks six interfaces
  and Store four (including `ICustomerService`), so the rule asserts in both; Common and Helpdesk still
  mark nothing.
- Added the second fitness rule the ADR omitted, `ServiceContractImplementationsAreNotPublic` via
  `ContractImplementationTestsBase`, subclassed in all four repos.
- Federated auth: gateway-routed JWKS discovery is the AppHost wiring only; production bicep points
  the authority directly at Identity's internal cleartext URL.
- Disabled-module stubs apply to multi-module hosts with a module switched off; extracted service
  hosts never discover peers and rely on the gRPC adapter registration.
- h2c: Store Sales joins ADC Notification on the ADR-012 mixed profile (default `Http1AndHttp2` plus
  an `Http2`-only `grpc` endpoint).
- Anchors re-verified against current source.

## Revision (2026-10-07)
Re-verified against current source. The decision, the JWKS wiring and the `[ServiceContract]`
adoption are unchanged: ADC production bicep still sets the authority to Identity's internal
cleartext URL with `RequireHttpsMetadata=false`, and MMCA.Common and Helpdesk still mark no type.
Only anchors moved.

1. Anchors re-verified against current source: ADC JWKS authority and `RequireHttpsMetadata`
   re-pointed to `MMCA.ADC/infra/main.bicep:2003`, `:2007` (the same pair repeats at `:2139`,
   `:2143` and `:2293`, `:2297`); the "MMCA.Common applies to no type" remark re-pointed to
   `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:12-13`;
   Store's `MMCA.Store/infra/main.bicep:1684`, `:1689` still hold.

## Revision (2026-10-21)
Re-verified against current source. The decision, the h2c profiles and the production JWKS wiring
are unchanged: both bicep files still set the authority to `http://${identityApp.name}` with
`RequireHttpsMetadata=false`, and MMCA.Common and Helpdesk still mark no type. The
`[ServiceContract]` adoption count and the auth description moved.

1. ADC marks seven `[ServiceContract]` interfaces, not six: the seventh is
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Exports/IUserConferenceExportService.cs:13`,
   parameterless like the rest. Store's four are unchanged.
2. Federated auth now carries one shared-secret exception, recorded in the Decision: Store Identity
   registers `AddServiceTokenAuthentication`
   (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:173`), an HS256 scheme over
   the shared `Grpc:ServiceToken:SigningKey`
   (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:141-144`),
   and maps the Customers gRPC service under the `InternalCaller` policy, which accepts a user JWT
   or a service token carrying a `svc` claim, minted today only by Sales
   (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:343`). User tokens stay RS256
   over JWKS.
3. The typed-client bullet now records the per-client `WithServiceToken()` opt-in: Store's Customers
   client (`MMCA.Store/Source/Services/MMCA.Store.Identity.Contracts/DependencyInjection.cs:46`)
   with `AddServiceTokenClient` in Sales
   (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:289`). ADC uses neither.
4. Anchors re-verified against current source: `WithJwksDiscovery` signature re-pointed to
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:321-323`; ADC JWKS authority
   and `RequireHttpsMetadata` to `MMCA.ADC/infra/main.bicep:2159`, `:2163` (repeating at `:2295`,
   `:2299` and `:2449`, `:2453`); Store's to `MMCA.Store/infra/main.bicep:1775`, `:1780` (repeating
   at `:1911`, `:1916`); the Engagement host's single module assembly to
   `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:214-216`; Store Sales mixed
   profile to `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:65-79`
   (`appsettings.json:13`, `:17` still hold).

## Revision (2026-10-26)
Re-verified against current source. The decision, the ACL convention, the service-token edge, the
production JWKS wiring, the h2c profiles and the `[ServiceContract]` adoption (ADC seven, Store four)
are unchanged: both bicep files still set the authority to `http://${identityApp.name}` with
`RequireHttpsMetadata=false`, and the Engagement host still names only its own module assembly, so
no `Disabled*` stub is registered. Only anchors moved.

1. Anchors re-verified against current source: the ACL convention quote re-pointed to
   `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:74-76` and the class
   remarks to `:16-25`; `WithJwksDiscovery` to
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:322-324`; ADC JWKS authority
   and `RequireHttpsMetadata` to `MMCA.ADC/infra/main.bicep:2195`, `:2199` (repeating at `:2331`,
   `:2335` and `:2485`, `:2489`); Store's to `MMCA.Store/infra/main.bicep:1781`, `:1786` (repeating
   at `:1917`, `:1922`); `AddServiceTokenClient` in Sales to
   `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:300`;
   `AddServiceTokenAuthentication` in Identity to
   `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:179` and the Customers mapping
   under `InternalCaller` to `:354`; the Engagement host's single module assembly to
   `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:221`; ADC Notification mixed
   profile to `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:58-73`; Store Sales
   mixed profile to `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:66-80`
   (`appsettings.json:13`, `:17` still hold for both).

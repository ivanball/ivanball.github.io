# ADR-140: Machine Clients Through OAuth Client Credentials Backed by Service Accounts

## Status
Accepted (2026-11-08). Ships in MMCA.Common v1.281.0. Off unless the host calls
`AddMachineClients`, registers its own `IServiceAccountProvisioner` and sets
`MachineClients:Enabled`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/MachineClients/MachineClientSettings.cs:35-36`,
default false).

## Context
Only a person could obtain a token: every token-issuing path in the framework is an interactive
sign-in. A program (a nightly sync, a partner's server, a server-side MCP client) had no way to call a
host's APIs or its permissioned MCP tools, and access tokens last 15 minutes
([ADR-138](138-mcp-endpoint-over-module-queries.md), point 7), so pasting a person's token into a
program works for minutes.

Four forces shaped the decision:

- **Every service already validates the same tokens.** Identity signs RS256 and every service validates
  through JWKS ([ADR-004](004-authentication-dual-fetch.md)). A credential that ended in an ordinary
  access token would need no new validation path in any service or the gateway.
- **Audit, ownership and rate limiting key on an integer user id.** Audit stamps and ownership rules
  read the token's `sub`, and the per-user rate-limit partition is the caller's user id
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:183-186`).
  A caller that is not a user id breaks all three.
- **Common has no user entity.** The user row is the app's
  ([ADR-116](116-identity-completions-opt-in.md)); `IAuthUser` is a narrow contract
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs`), so creating an account is the
  app's job.
- **Revocation already has a cross-service mechanism.** Deleting an account writes a soft-deleted
  marker every service reads, so `SoftDeletedUserMiddleware` rejects that user's outstanding tokens
  ([ADR-047](047-soft-deleted-user-session-revocation.md);
  `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:35`, `:59`).

## Decision
**A program authenticates with the OAuth 2.0 client credentials grant and receives a short-lived
access token for its own service-account user. Permissions come from that user's role, revocation
writes the soft-deleted marker, and a role that could escalate can never back a client.**

1. **Each client is backed one to one by its own service-account user.** The consumer implements
   `IServiceAccountProvisioner` over its own user aggregate: `CreateAsync(name, role)` creates a user
   with that role and no password and returns its id, and `FindAsync(userId)` returns a
   `ServiceAccount` or null when the account is gone, locked or not a service account
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/MachineClients/IServiceAccountProvisioner.cs:15-34`),
   the ADR-116 consumer-supplied-store shape. `IAuthUser.IsServiceAccount` is a defaulted member
   (false), so an app that never adopts machine clients implements nothing (`IAuthUser.cs:25-33`).
2. **A service account never signs in interactively.** Password login
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:836-841`),
   sign-in links (`:510-513`) and passkeys (`:555-561`) refuse it, and `IssueTokensAsync` refuses it
   as the backstop behind every interactive path, the app-level external login included (`:612-638`).
   View-as refuses it as a target through `ViewAsSubject.IsServiceAccount`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ViewAs/ViewAsService.cs:177-179`).
3. **One call registers it, and two checks catch a half-configuration.**
   `services.AddMachineClients(configuration)` binds the `MachineClients` section with
   `ValidateOnStart` and registers the EF client store and `IMachineClientService`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.MachineClients.cs:37-53`).
   The settings validator fails an enabled host that has no `IServiceAccountProvisioner`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/MachineClients/MachineClientSettingsValidator.cs:37-40`),
   and the startup tripwire fails `MachineClients:Enabled` true without the call
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:44-49`,
   `:71-75`).
4. **The token endpoint is its own controller base.** `MachineTokenControllerBase` (the app's sealed
   subclass routes it at `auth/token`) serves one anonymous `POST` on the `auth-ip` policy, form
   encoded with `grant_type=client_credentials`, the client authenticating with HTTP Basic or with
   `client_id` and `client_secret` form fields, and answers RFC 6749 JSON (`access_token`,
   `token_type`, `expires_in`) or `invalid_client` (401) / `unsupported_grant_type` /
   `invalid_request` (400), both with `Cache-Control: no-store`; it answers 404 while machine clients
   are off
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/MachineClients/MachineTokenControllerBase.cs:16-76`,
   `:115-131`). It is a base of its own rather than an action on `AuthControllerBase`, which every
   consumer already inherits, so a consumer that does not adopt machine clients gets no new route and
   no change to its committed OpenAPI documents.
5. **The token is a person-shaped token for the service account.** `MachineClientService.IssueTokenAsync`
   checks the secret, reads the account through the provisioner on every mint, and mints through the
   raw `ITokenService.GenerateShortLivedAccessToken`, the view-as precedent, with `client_id` and
   `token_use=machine` added
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/MachineClients/MachineClientService.cs:66-120`;
   `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:110-126`). The token's `sub` is
   the service account and its permission claims are the role's, baked in exactly as for a person
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:118-128`, `:159-171`). It
   carries no refresh token, no session (`sid`), no `auth_time` and no `mfa`
   (`MachineClientService.cs:14-21`), so an `IRequiresMfa` use case refuses it with no special case.
6. **The lifetime is capped below the revocation marker.** `MachineClients:AccessTokenMinutes`
   defaults to 15 and is validated from 1 to 15
   (`MachineClientSettings.cs:24-33`, `:42`; `MachineClientSettingsValidator.cs:23-27`). The
   soft-deleted marker lives 20 minutes (`SoftDeletedUserCache.cs:35`) and the bearer handler allows 5
   minutes of clock skew, so a 15-minute token always lapses while the marker still exists; a longer
   token would outlive the revocation that is meant to stop it (`MachineClientSettings.cs:27-33`).
7. **Secrets are random, hashed and rotatable.** A secret is 32 random bytes shown once, stored as
   SHA-256 and compared in constant time
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/MachineClients/MachineClientSecret.cs:18-41`).
   Rotate issues a secondary secret beside the primary, promote retires the old primary, and both
   honor an optional expiry (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/MachineClients/MachineClient.cs:109`,
   `:130`, `:150`).
8. **Revocation reuses the soft-deleted marker.** `RevokeAsync` saves `RevokedOn` first, so no new
   token is minted, then writes the soft-deleted marker for the service account, so every service's
   `SoftDeletedUserMiddleware` answers 401 to the tokens the client already holds
   (`MachineClientService.cs:211-231`).
9. **Four permissions can never back a client.** A role granting any of them is refused at create,
   before the service account is provisioned, and at every mint, because a role can gain a permission
   after the client exists (`MachineClientService.cs:47-58`, `:95-101`, `:141-149`, `:244-248`):
   - `users:view-as` (`AdministrationPermissions.ViewAsUsers`): a program holding it could read as any
     user, which [ADR-137](137-read-only-view-as-support-access.md) reserves for a named staff member
     giving a reason;
   - `users:manage` (`ManageUsers`): it could lock, re-role or administer people's accounts;
   - `roles:manage` (`ManageRoles`): it could grant its own role anything, the three above included;
   - `clients:manage` (`ManageClients`): it could mint further clients, and fresh secrets, for itself
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/AdministrationPermissions.cs:18-40`).
10. **Administration is a separate, permissioned base.** `MachineClientsControllerBase` (abstract, no
    route, `[HasPermission(clients:manage)]`) lists, creates (the secret returned once), rotates,
    promotes and revokes
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/MachineClients/MachineClientsControllerBase.cs:37-38`,
    `:47`, `:67`, `:92`, `:114`, `:139`), and a routeless Common.UI page sits over it
    (`AddMachineClientAdministrationUI`,
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:349`).
11. **The table is gated.** `MachineClients` is mapped only where enabled
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:389`,
    `:477`, `:1052`), and `DesignTimeDbContextOptions.EnableMachineClients` opens the gate for
    `dotnet ef` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:143`).
12. **MCP needs no change.** A permissioned MCP tool checks the same `perm:` policy as `[HasPermission]`
    through the host's bearer handler (ADR-138, point 4), and a machine token is such a bearer token
    with the role's permission claims, so server-to-server MCP callers are admitted with no MCP code.

## Rationale
- **A service account keeps one id space.** Audit stamps, ownership and the rate-limit partition all
  key on an integer user id; a client principal of its own would need a second id space in each, and
  a client id and a user id would collide.
- **Client credentials is the standard grant for this caller,** and an RFC 6749 response is what every
  OAuth library a program already uses expects.
- **No new validation path.** The result is an ordinary RS256 access token, validated by every service
  and the gateway exactly as today.
- **Revocation reuses a marker every service already reads,** instead of a per-request lookup against
  Identity's store.
- **The refused permissions are the escalation paths.** A program's blast radius is its role; denying
  the four permissions that widen a role, mint clients or act as a person keeps it there.

## Trade-offs
- **Turning it on needs consumer code:** the provisioner, the `IsServiceAccount` answer on the app's
  user type and the view-as resolver flag (`MMCA.Common/UPGRADING.md:39-52`). No consumer turns it on
  in v1.281.0, so only Common's tests exercise it.
- **A machine identity is a user row.** It shows up wherever the app lists users unless the app
  filters on `IsServiceAccount`.
- **Revocation takes effect through the marker's cache.** Outstanding tokens are refused within the
  soft-deleted check's window, not instantly, and the check fails open on a cache or validator error
  ([ADR-047](047-soft-deleted-user-session-revocation.md)).
- **No refresh token.** A program asks for a new token when one expires; at 15 minutes this is one
  request per quarter hour per program.
- **One more migration** on the Identity database where enabled.

## Alternatives rejected
- **API keys** (2026-11-08). Every service would need a lookup against Identity's store on each
  request, a second validation path beside JWKS.
- **A separate client principal type** (2026-11-08). Audit and ownership key on an integer user id,
  and a second id space would collide with it.
- **Putting the token action on `AuthControllerBase`** (2026-11-08). Every consumer inherits that base,
  so every consumer's OpenAPI documents would change for a feature none of them has turned on.
- **Refresh tokens for clients** (2026-11-08). A program holds its secret already; a refresh token
  adds a second long-lived credential and a session row for nothing.
- **An OAuth 2.1 authorization server with consent screens and dynamic client registration**
  (2026-11-08). Still deferred, as ADR-138 records. **Revisit:** a third-party MCP client that needs
  delegated user consent.

## Consequences
- A consumer that opts in implements the provisioner, calls `AddMachineClients`, adds the
  `MachineClients` migration on its Identity database, routes the two controller subclasses, and grants
  `clients:manage` to an operator role that no client can hold (`MMCA.Common/UPGRADING.md:39-52`).
- Machine activity is audited under a named service account.
- The *Enterprise-scale register* of [the Common backlog](../governance/common-RemediationBacklog.md)
  no longer holds client credentials; webhooks and versioned OpenAPI with Sunset stay there.

## Related
[ADR-004](004-authentication-dual-fetch.md) (the JWKS validation every service already does),
[ADR-020](020-permission-based-authorization.md) (the role-to-permission registry the token carries),
[ADR-047](047-soft-deleted-user-session-revocation.md) (the marker revocation reuses),
[ADR-116](116-identity-completions-opt-in.md) (the consumer-supplied-store shape),
[ADR-137](137-read-only-view-as-support-access.md) (the view-as permission a client can never hold),
[ADR-138](138-mcp-endpoint-over-module-queries.md) (the permissioned tools a machine token now reaches),
[ADR-139](139-passkeys-webauthn-opt-in-sign-in.md) (the other identity opt-in of this release).

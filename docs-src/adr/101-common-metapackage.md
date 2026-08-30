# ADR-101: An `MMCA.Common` Metapackage for the Core Six

## Status
Accepted (2026-08-29, framework v1.170.0). Extends
[ADR-053](053-dual-registry-package-publishing.md) (the metapackage ships to both registries from the
same tag, through the same workflow) and inherits
[ADR-016](016-lockstep-versioning-masstransit-pin.md) unchanged (it releases at the same version as
everything else, and adds one more entry to the set a consumer sweeps together). The authoritative
package list and count live in
[FACTS.md](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md); this record does not restate
them.

## Context
ADR-053 made the install path credential-free: `dotnet add package MMCA.Common.API` works for anyone,
from nuget.org, with no token and no hand-written `nuget.config`. What it did not shorten is the
number of lines that follow. A standard application host references six packages before it references
anything of its own, and their names are the layer names, so the list reads as the architecture but
also as six chances to get an incomplete set: an app that takes Application and Infrastructure but
not API compiles until the first controller, and one that omits Aspire compiles until
`AddServiceDefaults`.

The friction lands hardest exactly where this release is trying to lower the floor. A reader
following the getting-started path, or an adopter retrofitting an existing solution by hand, types
six `PackageReference` elements plus six `PackageVersion` pins under Central Package Management,
twelve lines of ceremony before a using directive.

Nothing about the layer packages themselves is wrong: the split is what makes the layer rules
enforceable at the package level and lets a Blazor WebAssembly project take `MMCA.Common.Shared`
alone. The question this record answers is only whether the common case has to be spelled out every
time.

## Decision
Publish a metapackage named `MMCA.Common` that carries dependencies and no code.

1. **It bundles the Core 6, in layer order.**
   `Source/MMCA.Common/MMCA.Common.csproj:26-31` references Shared, Domain, Application,
   Infrastructure, API and Aspire, ordered so the bundle reads as the architecture it installs
   (`:23-25`). One `PackageReference` replaces six.

2. **It ships no assembly.** `IncludeBuildOutput` is `false` (`:9`) because a metapackage ships
   dependencies, not code: the project has no compile items of its own, and packing its empty
   assembly would add a DLL every consumer loads for nothing (`:5-8`). `NU5128` (a dependency group
   with no matching `lib/` folder) is suppressed in this project alone, because that warning
   describes exactly the shape `IncludeBuildOutput=false` is meant to produce and
   `TreatWarningsAsErrors` would otherwise turn it into a pack failure (`:10-14`).

3. **It is an ordinary packable project in every other respect.** Version comes from MinVer off the
   same tag, packaging metadata from `Directory.Build.props`, and the repository README is packed
   with it (`:34`). It therefore publishes to both registries in the same release run with no
   workflow change (ADR-053).

4. **UI, Gateway, Grpc, Aspire.Hosting and the Testing packages stay out.** The bundle is what a
   standard **application host** needs. A Blazor host takes `MMCA.Common.UI` / `UI.Web`, a gateway
   takes `MMCA.Common.Gateway`, a service exposing gRPC takes `MMCA.Common.Grpc`, an AppHost takes
   `MMCA.Common.Aspire.Hosting`, and test projects take the `Testing.*` set. Each of those belongs to
   a specific project in the solution rather than to every host, and `MMCA.Common.UI.Maui` could not
   be included in any case: it is the one MAUI-TFM package, built outside the solution by dedicated
   Windows jobs (ADR-042), so a `net10.0` metapackage cannot reference it.

5. **The name is the bare prefix, deliberately.** `MMCA.Common` was the one unused id in the family
   and it is the one a reader guesses first. It carries the ADR-016 lockstep contract like every
   other `MMCA.Common.*` id.

6. **Nothing switches to it.** ADC, Store and MMCA.Helpdesk keep their explicit per-layer pins, and
   the `MMCA.Templates` scaffold still generates the six-line set. The metapackage is an option for a
   new adopter, not a migration anyone is asked to run.

## Rationale
- **The common case should cost one line.** Six references is not hard, it is repetitive and
  order-independent noise that a reader has to verify rather than read, and getting it wrong fails
  later than it should.
- **The set is not arbitrary.** Every application host in this workspace takes exactly these six.
  Bundling a set that real hosts already take together is a shortcut, not a new opinion about what
  belongs where.
- **A code-free package cannot drift from the layers.** With no assembly, there is nothing for the
  metapackage to expose, deprecate or version independently: it is a list of dependencies, and the
  layer rules keep being enforced by the packages it points at.
- **Lockstep makes it safe.** Because every package ships at one version from one tag (ADR-016), the
  metapackage can pin its six dependencies at exactly its own version with no risk of the set
  disagreeing, and a consumer bumping it bumps all six.
- **Excluding the specialised packages keeps the bundle honest.** A metapackage that also pulled UI
  and Testing would put MudBlazor and Playwright into a headless API host, which is the failure mode
  that makes people distrust metapackages in the first place.

## Trade-offs
- **A consumer mixing both forms has more pins to keep in step, not fewer.** An app taking
  `MMCA.Common` plus `MMCA.Common.UI` and the `Testing.*` set still has to sweep every entry to the
  same version in one pass (ADR-016), and the metapackage is one more entry in that sweep rather than
  a replacement for it. Nothing in the bundle relaxes the no-phased-rollout rule.
- **It hides which layer a type came from.** Part of the value of the split is that a
  `PackageReference` list states the layers a project participates in. A single reference gives that
  up, which matters most in the project where it matters least (the host, which takes all of them
  anyway).
- **It can pull more than a project needs.** A host that genuinely wants no Aspire dependency should
  keep the explicit five rather than take the bundle: the metapackage has one shape, and trimming it
  per consumer would defeat the point.
- **NU5128 is suppressed rather than avoided.** The suppression is scoped to this project and
  justified in place, but it is a warning switched off, and a future genuine packaging problem in
  this project would have to be caught by the pack output rather than by the build.
- **No consumer exercises it.** The package-consumption CI job packs and restores every package, so a
  pack break is caught, but no application in this workspace builds against the metapackage today, so
  its ergonomics are asserted rather than demonstrated. That is a deliberate consequence of point 6.

## Related
[ADR-053](053-dual-registry-package-publishing.md) (dual-registry publishing, which the metapackage
joins with no workflow change),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (one version for every package, one sweep per
consumer: the property that makes bundling safe),
[ADR-042](042-device-capability-abstraction.md) (`MMCA.Common.UI.Maui`, the MAUI-TFM package built
outside the solution and therefore unreferenceable from a `net10.0` bundle),
[ADR-015](015-architecture-fitness-functions.md) (the layer rules and the public-API surface gate that
keep operating on the individual packages the bundle points at),
[ADR-065](065-scaffolding-templates.md) (the scaffold, which is the other answer to the same
adoption-floor problem and still emits the explicit set).

# ADR-057: Expand/Contract Schema Evolution Enforced as a CI Gate

## Status
Accepted (2026-07-28).

## Context
ADR-030 decides **who** applies a migration: every service host runs `DatabaseInitStrategy = Migrate`
and self-applies its pending EF Core migrations at startup as the sole migrator, with no deploy-step
`sqlcmd` backstop (`MMCA.Store/.github/workflows/deploy.yml:935-943`,
`MMCA.ADC/.github/workflows/deploy.yml:1015-1025`). It says nothing about what **shape** a migration
may take.

That gap is load-bearing because production rollback is **revision-only**. When the post-deploy smoke
gate fails, the deploy rolls every container app back to its previous revision with
`az containerapp revision copy --from-revision` (`MMCA.Store/.github/workflows/deploy.yml:951,994-1002`,
`MMCA.ADC/.github/workflows/deploy.yml:1036,1088-1099`). That reverts the **image** and nothing else:
the new revision already migrated the database on boot, and no down-migration runs. The previous
release therefore keeps serving traffic against the **new** schema, which is exactly the statement
both repos' CONTRIBUTING makes (`MMCA.Store/CONTRIBUTING.md:57-60`, `MMCA.ADC/CONTRIBUTING.md:57-60`).
A `DropColumn` shipped alongside the code that stopped reading it makes the rollback path a broken
release rather than a recovery.

The existing build-time gate does not cover this. `dotnet ef migrations has-pending-model-changes`
(`MMCA.Store/.github/workflows/deploy.yml:168-182`, `MMCA.ADC/.github/workflows/deploy.yml:223-237`)
asserts a migration **exists** for every model change; it has no opinion on whether that migration is
survivable one release back. The gate below is the shape rule that ADR-030 left open. It arrived in
MMCA.ADC with the 2026-07-19 security/resilience/ops review batch (commit `adee5058`, PR #38) and was
ported to MMCA.Store on 2026-07-25 (commit `1dfdc991`, PR #52).

## Decision
Schema changes follow **expand/contract**, and a CI step enforces the contract half.

- **Expand now, contract later, as a written rule.** Adding nullable columns, new tables and new
  indexes is safe in any release; `DropColumn` / `DropTable` / `DropIndex` belong to a LATER release,
  once no revision that reads the old shape can still be rolled back to
  (`MMCA.Store/CONTRIBUTING.md:62-65`, `MMCA.ADC/CONTRIBUTING.md:62-65`).
- **A migration ADDED by a PR may not drop without a marker.** The `Expand/contract migration guard
  (schema rollback safety)` step fails the build when a newly added migration's `Up()` matches
  `\.(DropColumn|DropTable|DropIndex)\s*(<[^>]*>)?\s*\(` and the same `Up()` body does not carry the
  override marker (`MMCA.Store/.github/workflows/deploy.yml:184-224`,
  `MMCA.ADC/.github/workflows/deploy.yml:113-151`). Those three operations are the entire matched set.
- **The marker's documented format is one comment line:**
  `// EXPAND-CONTRACT-OVERRIDE: <why this drop is safe one release back>`
  (`MMCA.Store/CONTRIBUTING.md:73-75`, `MMCA.ADC/CONTRIBUTING.md:73-75`). What the step actually
  enforces is looser: `grep -q 'EXPAND-CONTRACT-OVERRIDE'` over the `Up()` body
  (`MMCA.Store/.github/workflows/deploy.yml:217`, `MMCA.ADC/.github/workflows/deploy.yml:144`), so the
  token must appear inside `Up()`, but the `//` prefix, the colon and the reason text are convention,
  not validation.
- **"Added by this PR" means git-added, base-relative, path-scoped.** The step fetches the PR base and
  runs `git diff --diff-filter=A --name-only "origin/<base_ref>...HEAD"` limited to
  `Source/Hosting/MMCA.Store.Migrations.SqlServer.*/Migrations/*.cs` (respectively
  `MMCA.ADC.Migrations.SqlServer.*`) (`MMCA.Store/.github/workflows/deploy.yml:202-204`,
  `MMCA.ADC/.github/workflows/deploy.yml:129-131`). `*.Designer.cs` files are skipped explicitly
  (`MMCA.Store/.github/workflows/deploy.yml:212-214`, `MMCA.ADC/.github/workflows/deploy.yml:139-141`),
  the model snapshot is a modification rather than an addition so it never enters the list, and the
  frozen combined-archive projects (`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer/`,
  `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer/`) fall outside the pathspec.
- **Only the `Up()` body is scanned.** The body is extracted with
  `awk '/protected override void Up\(/{flag=1} /protected override void Down\(/{flag=0} flag'`
  (`MMCA.Store/.github/workflows/deploy.yml:215`, `MMCA.ADC/.github/workflows/deploy.yml:142`), because
  every additive migration's `Down()` legitimately drops what `Up()` added and `Down()` never runs at
  startup: down-migration is explicit tooling only.
- **It is a merge gate, not a deploy gate.** The step lives in the `build-and-test` job, which both
  repos run only on `pull_request` (`MMCA.Store/.github/workflows/deploy.yml:96`,
  `MMCA.ADC/.github/workflows/deploy.yml:104`) and document as a required merge check
  (`MMCA.Store/CONTRIBUTING.md:38-39`, `MMCA.ADC/CONTRIBUTING.md:37-38`). Nothing re-checks the shape
  on the push to `main` that deploys.
- **The common legitimate override is an index rebuilt in place.** Adding INCLUDE columns or a filter
  emits a `DropIndex` immediately followed by a `CreateIndex` under the same name, which a
  one-release-back revision reads as a superset of what it expects
  (`MMCA.Store/CONTRIBUTING.md:77-79`). The live markers say exactly that:
  `MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Sales/Migrations/20260725133726_AddOutboxInboxRetentionIndexes.cs:13-17`
  (outbox pending index gains INCLUDE columns) and
  `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260720031638_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs:14-17`
  (unique index gains an `[IsDeleted] = 0` filter). The second legitimate case is an index replaced by
  a wider composite with the same leading column, reasoned out in
  `MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Sales/Migrations/20260725044543_AddOrderStatusAndCreatedOnIndexes.cs:13-17`.

**Adoption is partial, and deliberately so at the deployed repos only.** MMCA.ADC and MMCA.Store both
run the gate, in identical form. **MMCA.Helpdesk does not have it**: its CI is a single build-and-test
job with no migration steps at all (`MMCA.Helpdesk/.github/workflows/ci.yml:13-45`), and its tree
already carries an unmarked `DropIndex` in an `Up()` body
(`MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/Migrations/20260725121253_AddOutboxInboxRetentionIndexes.cs:13-16`),
which is consistent: Helpdesk has no deploy workflow and therefore no revision-rollback model to
protect. **MMCA.Common does not have it either, and cannot**: the framework owns no migrations
(there is no `Migrations` directory anywhere in the repo) even though consumer migrations create the
shared `OutboxMessages` / `InboxMessages` tables it defines, so a framework-driven shape change lands
as an added migration in each consumer, which is where the gate sees it.

## Rationale
- **Rollback is one-way for schema, so the check belongs where the drop is still cheap.** The only
  moment a destructive migration can be reconsidered for free is the PR that adds it; after the deploy
  the options are roll forward or restore (ADR-009).
- **A grep is enough, and cheap enough to always run.** The gate needs no database, no EF invocation
  and no new tool; it is a diff plus two greps inside a job that already runs on every PR, so it costs
  seconds and cannot itself become a flaky gate.
- **An override that carries a reason beats a bypass label.** The marker lives in the migration file
  next to the operation it excuses, so the next reader of that migration gets the argument for why the
  drop was safe, rather than a green check whose reasoning died with the PR thread.
- **Up-only scanning keeps the false-positive rate at zero.** Every additive migration's `Down()`
  drops what it added; scanning both bodies would flag essentially every migration and the gate would
  be disabled within a week.
- **Invariant over discipline.** This is the same posture as the architecture fitness functions
  (ADR-015) and the integration-event schema rule (ADR-010): a compatibility convention that a code
  review is expected to catch is a convention that eventually ships broken.

## Trade-offs
- **Three operations, not a model of compatibility.** `AlterColumn` narrowing a type or flipping a
  column to NOT NULL, `DropForeignKey`, `DropPrimaryKey`, `DropSchema`, `RenameColumn` and a raw
  `migrationBuilder.Sql("DROP ...")` all pass unflagged. The gate catches the common destructive
  shapes, not every one.
- **The marker is per-migration and unvalidated.** One occurrence anywhere in `Up()` exempts every
  destructive operation in that `Up()`, and nothing checks that the text after the token is a real
  reason, so the gate ultimately enforces "state a reason", not "have a good one".
- **Added-only, and pull-request-only.** A destructive statement appended to a migration file that is
  already on `main` is a modification, not an addition, and is never scanned; neither is anything that
  reaches `main` without a PR.
- **The diff is fail-open.** Both repos compute the added-file list as `$(git diff ... || true)`, and
  an empty list prints "No new migration files in this diff" and exits 0
  (`MMCA.Store/.github/workflows/deploy.yml:203-208`, `MMCA.ADC/.github/workflows/deploy.yml:130-135`),
  so a diff that cannot be computed passes rather than fails. MMCA.ADC checks out full history
  explicitly for this step (`MMCA.ADC/.github/workflows/deploy.yml:108-111`); the MMCA.Store
  `build-and-test` checkout sets no `fetch-depth`
  (`MMCA.Store/.github/workflows/deploy.yml:100`), so the two repos do not run the same step against
  the same git object graph.
- **It gates the migration, not the application.** Nothing verifies that the previous release's code
  tolerates the new schema; an expand migration that adds a required column the old revision never
  writes is invisible to the gate.
- **Partial adoption is a real gap for the reference app.** MMCA.Helpdesk is the seed developers copy,
  and the rule it teaches by example today is the unmarked drop.

## Related
ADR-030 (decides that each service self-applies its migrations at startup, which is precisely why a
rolled-back revision meets the new schema; this ADR constrains what those migrations may contain),
ADR-006 (database-per-service bounds a bad migration to one service's database), ADR-009 (a drilled
restore is the backstop when a schema change cannot be rolled forward), ADR-010 (the message-contract
sibling: additive changes stay compatible, breaking ones need a parallel path), ADR-015 (the
invariant-over-discipline posture this gate applies to schema).

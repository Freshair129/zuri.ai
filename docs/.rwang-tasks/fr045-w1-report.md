## Writer Report — FR-045 W1: Additive schema

**Status**: DONE

**Scope**: Prisma SQLite/Postgres schema, one additive migration, schema-focused
test and this report only. No service, route, UI, legacy-contract, documentation
or external filesystem changes were made.

### Changed files

- `prisma/schema.prisma` — added `LocalWorkspaceMount`, `FileAsset` and `FileLink`
  with required inverse relations; left `ProjectFile` unchanged.
- `prisma/schema.postgres.prisma` — regenerated from the canonical SQLite schema.
- `prisma/migrations/20260814010000_add_managed_local_file_metadata/migration.sql`
  — additive tables, indexes and foreign keys only; no backfill, drop or alteration
  of `ProjectFile`.
- `tests/unit/fr045-schema-contract.test.js` — executable schema, migration,
  inverse-relation and SQLite/Postgres parity contract.

### RED → GREEN evidence

**RED** — before schema/migration implementation:

```text
npx vitest run tests/unit/fr045-schema-contract.test.js
exit 1; 1 file failed, 4 tests failed
missing LocalWorkspaceMount, FileAsset and FileLink models; missing Tenant inverse relation
```

**GREEN** — after implementation and PostgreSQL generation:

```text
npx vitest run tests/unit/fr045-schema-contract.test.js
exit 0; 1 file passed, 5 tests passed
```

### Verification

| Command | Result |
|---|---|
| `npm run db:pg:schema` | PASS — regenerated `prisma/schema.postgres.prisma` from `prisma/schema.prisma`. |
| `npx prisma validate --schema prisma/schema.prisma` | PASS — SQLite schema valid. |
| `$env:DIRECT_URL='postgresql://postgres:postgres@127.0.0.1:5432/zuri'; npx prisma validate --schema prisma/schema.postgres.prisma` | PASS — Postgres schema valid. The inert value only satisfies Prisma configuration parsing; no connection was made. |
| `npx vitest run tests/unit/fr045-schema-contract.test.js` | PASS — 5/5 focused tests. |
| `npx prisma migrate diff --from-url 'file:./prisma/test.db' --to-schema-datamodel prisma/schema.prisma --script` | PASS — `-- This is an empty migration.` The test database, synchronized by the focused Vitest setup, matches the canonical schema. |
| `git diff --check -- prisma/schema.prisma prisma/schema.postgres.prisma tests/unit/fr045-schema-contract.test.js` | PASS — no whitespace errors in tracked W1 diffs. |

### Concerns / handoff

- The first direct Postgres validation reported only a missing local `DIRECT_URL`.
  The recorded verification above succeeds with an inert process-local placeholder;
  it does not contact or mutate Postgres.
- `prisma migrate diff --from-migrations prisma/migrations` is unavailable because
  this repository has no `migration_lock.toml` (`Could not determine the connector
  from the migrations directory`). The direct database-to-canonical-schema diff is
  empty, and the focused contract asserts the additive migration contains no
  `ALTER`/`DROP` of `ProjectFile`. A later baseline/migration-history governance
  decision is needed before claiming a full Prisma migration-history proof.
- W1 intentionally does not backfill `ProjectFile`, validate polymorphic
  `FileLink` targets, or enforce storage-kind/path rules; those are later service
  and migration slices under ZV2-CR-001.

---

## Independent Review Gate — W1

**Reviewer:** ATHER (independent W1 schema review)
**Reviewed:** 2026-08-14 (ICT)
**Scope:** review-only; no schema, migration, or test implementation changed.

| # | Rubric | Result | Evidence |
|---|---|---|---|
| 1 | Additive-only and ProjectFile preservation | PASS | `git show HEAD:prisma/schema.prisma` matches the current `ProjectFile` model byte-for-byte; the W1 migration creates only the three new tables and their indexes, with no `ProjectFile` DDL, backfill, drop, or alteration. The frozen W0 field/value fixture remains compatible. |
| 2 | Models, relation cardinality and compatibility | PASS | `LocalWorkspaceMount` has required Tenant/Business relations and one `Business + deviceKey` mapping; `FileAsset` has the specified required/optional fields and inverse Tenant/Business/Project/WorkItem relations; `FileLink` belongs to exactly one asset and cascades on asset deletion. Project/work-item containment and polymorphic target validity are correctly left to the later service contract, not falsely claimed as schema enforcement. |
| 3 | Uniqueness and lookup indexes | PASS | The mount mapping, global human `FileAsset.code`, and FileLink tuple uniqueness are represented in both Prisma models and migration SQL. Tenant, business, project, work-item and typed entity lookup indexes are present. `rootPath` is deliberately not an identity key. |
| 4 | Migration completeness and SQL validity | WARN | The additive SQL includes all three tables, foreign keys and declared indexes, and executed successfully against a disposable SQLite database. Repository migration-history validation remains unavailable because there is no `migration_lock.toml`; therefore a full `--from-migrations` proof cannot be claimed until the baseline/governance gap is resolved. |
| 5 | SQLite/Postgres parity | PASS | The generated Postgres schema differs from canonical SQLite only at datasource/header level; the four reviewed model bodies (`ProjectFile`, `LocalWorkspaceMount`, `FileAsset`, `FileLink`) are identical. `prisma validate` passed for both providers. |
| 6 | TDD evidence and exclusive W1 scope | WARN | The focused contract test passed (5/5) and covers model fields, inverse relations, tuple/index constraints, migration DDL and provider parity. The recorded RED result is author-reported rather than independently replayable from repository history; green proof is current. The W1 implementation artifacts stay within the declared schema/migration/test/report lane; other dirty files belong to parallel lanes. |

**Focused verification:** `npx vitest run tests/unit/fr045-schema-contract.test.js` — 1 file / 5 tests passed; `npx prisma validate --schema prisma/schema.prisma` and Postgres equivalent — passed; additive SQL executed successfully against a disposable SQLite database.

**Verdict: WARN** — W1’s additive schema contract, legacy `ProjectFile` preservation, constraints, migration SQL and SQLite/Postgres parity pass. Do not claim a fully reproducible migration-history or RED-phase proof until the missing Prisma migration baseline/lock and durable RED evidence are addressed.

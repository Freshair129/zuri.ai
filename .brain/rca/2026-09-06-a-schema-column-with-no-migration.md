---
version: "0.1.0b"
created_at: "2026-09-06T10:30:00+07:00,CLAUDE"
last_update: "2026-09-06T10:30:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "integration"
  doc_type: "root-cause-analysis"
  scope: "A column entered the schema with tests and no migration, and production lost an endpoint for seven days while every check stayed green"
---

# RCA — a schema column with no migration

## Symptom

`GET /api/backup/export` returned 500 on production from 2026-08-29 until it
was read on 2026-09-05:

```
The column RawExternalRecord.artifactId does not exist in the current database.
  src/modules/project-manager/application/backup-service.js — exportSnapshot
  for (const model of SNAPSHOT_MODELS) tables[model] = await db[model].findMany()
```

`exportSnapshot` walks every snapshot model with a `findMany`, and a Prisma
`findMany` selects every column the schema declares. `RawExternalRecord` is
the eleventh model in that list, and on production it had no `artifactId`
column, so the export failed there and never reached the rest. The table held
zero rows; the column's value never mattered. Its absence did.

## How the column got there

`RawExternalRecord.artifactId String?` with `@@index([artifactId])` entered
`prisma/schema.prisma` at ced1fba (2026-08-29, PR #165) to close the
knowledge-ingestion catalog's third acceptance criterion: a raw payload must
be recoverable from the artifact id a knowledge-ingestion run carries. The
change was complete by every measure this repository applies to a change: the
column, the index, a scoped `findByArtifactId` read, seven unit tests, and a
real-database integration test that wrote a row with the column set and read
it back.

What it did not have was a migration. Not under `supabase/migrations/`, which
is the only thing that changes production, and not under `prisma/migrations/`
either. The generated `prisma/schema.postgres.prisma` was regenerated and
carried the column, so the schema production is *supposed* to match declared
it from that day; nothing ever told production.

## Why nothing caught it — and why that is structural, not careless

**Local development cannot notice.** The dev and test database is SQLite
under `prisma db push`, which reconciles the schema file against the database
directly. A field with no migration is not an error there; it is the normal
case, and `prisma/migrations/` is kept for history, not applied by the dev
loop. Every test that touched the column ran against a database that had it.

**The integration test proved the wrong thing.** "Proven against the real
database" meant the real *local* database, freshly pushed from the schema.
That proves the code, and it is right to exist. It cannot prove that
production has the column, because nothing that runs in a test has ever seen
production's DDL.

**No check related the two files that disagreed.** The repository ratchets
route anchors, viewer fixtures, enum copies, snapshot-model coverage,
untracked docs and table integrity. It had no check that asked whether
`prisma/schema.postgres.prisma` and `supabase/migrations/*.sql` describe the
same columns. They had disagreed since 2026-08-19 (see below) and nothing was
positioned to say so.

**The failing endpoint was one nobody calls routinely.** Backup export is an
operator action. The column was added on a Saturday; the first person to run
the export and read the error did so a week later, while diagnosing a
different deploy hazard.

## What a first guard would have got wrong

The obvious rule — *every field in `prisma/schema.prisma` must have a
migration* — was proposed and would have been wrong for this repository.
`prisma/schema.prisma` is the SQLite dev schema and its workflow is `db push`;
a field appearing there without a migration is legitimate and frequent. A
guard on that file fires on every ordinary change, and a guard that fires on
every ordinary change is muted within a week — at which point it protects
nothing and costs a line in every report. The deploy-role session made this
point on 2026-09-05 and it changed the design.

The pair whose disagreement *is* the defect is `prisma/schema.postgres.prisma`
(generated from the canonical schema by `scripts/gen-postgres-schema.mjs`;
what production is supposed to match) and `supabase/migrations/*.sql` (the
only lineage that changes production, per c727cda "move FR-122's production
DDL into the Supabase lineage it belongs in"). A guard on that pair fires when,
and only when, production has been told something different from what the
code expects.

## What was found when the guard first ran

Anchoring on the right pair surfaced more than one column. On the day the
check landed, the production schema declared 34 columns that no Supabase
migration creates:

| Table | Columns | Entered the schema | Why |
|---|---|---|---|
| `RawExternalRecord` | `artifactId` | 2026-08-29, ced1fba | this RCA; repaired in the same change |
| `PersonCredential` | all five | 2026-08-19, 9a149d6 | declared *because* the tables already existed on production, created outside the migration tree, "so a routine db push stops proposing to drop them" |
| `PasswordResetToken` | all six | 2026-08-19, 9a149d6 | same |
| `PlanImportReceipt` | all fourteen | 2026-08-19, be14e20 (PR #67) | shipped with a `prisma/migrations/` file only, one day after the Supabase application schema was dumped from `prisma/postgres/0001_init.sql` |
| `Workstream` | eight execution-contract columns | 2026-08-19, be14e20 (PR #67) | same |

The last two rows are the same shape as this RCA's defect and are
**unverified on production**. `Workstream` is a snapshot model that sits after
`RawExternalRecord` in `SNAPSHOT_MODELS`, so if production lacks those eight
columns the export will fail on `Workstream.executionModeId` as soon as the
`artifactId` migration is applied. That is the next thing for the deploy-role
session to check, and it is stated here rather than assumed either way.

The first two rows are the opposite case — real on production, absent from
the lineage — and their repayment is a migration that *records* them with
`CREATE TABLE IF NOT EXISTS`, so the lineage stops depending on memory.

All 33 of these are the guard's shrink-only baseline
(`docs/.schema-migration-baseline.json`), each group with its reason and its
repayment written in the file. `artifactId` is deliberately not in it: its
migration ships with the guard, and the unit test removes that migration to
prove the check fires.

## Prevention

Landed as `schema-migration-drift` (Check 18) in `scripts/doc-preflight.mjs`,
with the rules in `scripts/schema-migration-drift.mjs` where a test can reach
them:

- parse the columns every model declares in `prisma/schema.postgres.prisma`
  (scalar and enum fields; relation fields have no column; `@map`/`@@map`
  honoured);
- parse every `CREATE TABLE` and `ALTER TABLE … ADD [COLUMN]` across
  `supabase/migrations/*.sql` in apply order — `IF NOT EXISTS`, quoted and
  unquoted identifiers with Postgres case folding, schema qualifiers,
  multi-column `ADD COLUMN` lists, DDL inside `DO $$ … $$` blocks, `RENAME`
  and `DROP` — after stripping comments and blanking string literals so prose
  can neither satisfy nor fail the check;
- CRITICAL on any declared column no migration creates that the baseline does
  not list; INFO when a baseline entry gains a migration, so the file shrinks.

Pure static diff, no database, so CI runs it on every pull request. Presence
only: types, defaults and indexes are out of scope on purpose, because a
checker that tries to understand DDL well enough to catch a wrong type is
wrong often enough to be muted for the same reason the first guard would have
been.

`tests/unit/schema-migration-drift.test.js` proves the parser on every SQL
shape the real migrations use, runs the rule against the real schema and the
real migration directory, and then removes the repairing migration and asserts
`RawExternalRecord.artifactId` comes back as the one introduced column.

## What this change does not do

It does not apply anything to production. The Supabase migration is
idempotent and unapplied; applying it is an owner-instructed operator step
(ADR-057) for the deploy-role session, with the dry-run-then-apply procedure
in `docs/runbooks/line-oa-provider-merge.md` §4. It does not write migrations
for the other four tables in the baseline; each needs its lane's owner to
decide the DDL, and a baseline entry with its reason written down is the
honest state until then.

## The transferable lesson

"Proven against the real database" is a claim about *a* database. A test that
pushes the schema it is testing cannot tell whether any other database has
been told. The repository already knew the general shape — a hand-maintained
mirror of the schema with nothing holding the two together
(`.brain/rca/2026-08-18-snapshot-model-list-drifted-from-the-schema.md`) —
and the migration directory is another such mirror, one whose failure lands
on production instead of in a test.

The second half is about *which* files to compare. A guard is only as good as
the pair it anchors on: the SQLite schema was the obvious anchor and the wrong
one, and the difference between a guard that lives and one that is muted in a
week was choosing the generated Postgres schema instead. That reasoning is
written at the top of `scripts/schema-migration-drift.mjs` so the next person
who reaches for the obvious anchor reads why it was not taken.

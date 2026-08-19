---
version: "0.1.0"
created_at: "2026-08-20T04:15:00+07:00,CLAUDE"
last_update: "2026-08-20T04:15:00+07:00,CLAUDE"
status: "final"
superseded_by: null
attributes:
  domain: "session-record"
  doc_type: "session-summary"
  scope: "2026-08-19 to 2026-08-20 — Supabase migration application, the missing ledger row, the two Postgres lineages, repo hygiene"
---

# Session summary — 2026-08-19 (ran into 2026-08-20)

One question, asked six times in sequence: **does the repository's record of the
Postgres schema match the database that actually exists?** It did not, in two
different ways, and neither was visible from the repository alone.

Outcome: PR #72 merged as `5ec3499`, two production DDL changes applied and
recorded, and the drift between the repository's two Postgres lineages closed
with a test that fails if it reopens.

## What the database looked like versus what the repository claimed

Two gaps, found in that order:

1. **PR #71's migration had never been applied.** `20260819120000_scope_external_ids_by_tenant`
   replaces the global unique indexes on `Conversation.externalThreadId` and
   `Message.externalMessageId` with tenant- and conversation-scoped ones. It
   existed in `prisma/migrations/` (the **SQLite** ledger) and nowhere else.
2. **A change applied the previous day had never been recorded.** The Team and
   priority push (FR-087, FR-088, FR-089) had reached production as a direct
   additive push whose SQL text was never captured — no ledger row, no file.

## The thing that was not understood at the start

The repository carries **two independent Postgres lineages**, and they are not
alternatives — they answer different questions:

| Path | What it is | How it changes |
|---|---|---|
| `supabase/migrations/<version>_<name>.sql` | the **production history**; filenames map 1:1 with `version` in `supabase_migrations.schema_migrations` | one new file per applied change, appended forever |
| `prisma/postgres/0001_init.sql` | a **whole-schema snapshot rebuilt from empty** | regenerated in full by `npm run db:pg:sql`; never appended to |

Two further facts that were load-bearing and are easy to get wrong:

- The applied-migration ledger is **`supabase_migrations.schema_migrations`**.
  There is no `_prisma_migrations` table on this database. `prisma/migrations/`
  is the SQLite ledger only and says nothing about production.
- Postgres distinguishes a plain unique **index** from a constraint-backed one;
  `DROP INDEX` fails on the latter. SQLite has no such distinction, so migration
  SQL authored against SQLite cannot be replayed verbatim on Postgres. PR #71's
  SQL was therefore regenerated with `prisma migrate diff` rather than run as
  written.

## What was applied to production

Both writes went through a single transaction with the preconditions re-checked
*inside* the transaction, so a race between the check and the write rolls back
rather than half-applies.

**PR #71's DDL.** Three preconditions proven first: both indexes were plain
unique indexes (`backing_constraint: null`, so `DROP INDEX` is legal), both
tables held zero rows, and zero duplicate groups existed under the new narrower
keys. Then drop two, create two, insert the ledger row, verify the resulting
index set, commit.

**The backfilled ledger row.** The original SQL was gone, so the 20 statements
were reconstructed from `pg_indexes.indexdef`, `pg_get_constraintdef()` and
`information_schema.columns`. The reconstructed count matched the "20 statements
in one transaction" recorded at the time, which is independent corroboration
rather than a restatement of the same source. The insert was guarded by an
in-transaction existence check of all five claimed objects, so a ledger row can
never assert an object the database does not have.

The row and the file both say **explicitly** that they are a reconstruction
recorded after the fact. A migration file that would fail on replay against
production is correct here: it exists so a database rebuilt from this lineage
reaches the same shape, not so it can be run again.

## Artifacts

| Action | Path | Why |
|---|---|---|
| created | `supabase/migrations/20260819161900_projects_dashboard_team_and_project_priority.sql` | the missing production-history record — 2 nullable `ADD COLUMN`, 3 `CREATE TABLE`, 9 indexes, 6 FKs |
| created | `tests/unit/projects-dashboard-schema-migration.test.js` | pins behaviour, not wording: additive-only, the three tables, BR-018 (a Team grants nothing), the exact per-relation referential actions, and a **cross-lineage drift guard** |
| regenerated | `prisma/postgres/0001_init.sql` | +129 lines — `Team`, `TeamMembership`, `ProjectTeam`, `PersonCredential`, `PasswordResetToken`, `Workstream.laneId`, `Project.priority` and `Project.picPersonId` |
| updated | `docs/.doc-graph.json` | FR-090 `changed` to `current` |

The drift guard is the part worth keeping: every `CREATE INDEX` and
`ADD CONSTRAINT` in the production-history file must also appear, whitespace-
normalized, in the regenerated snapshot. `tests/unit/scope-external-ids-migration.test.js`
already did the same for PR #71's migration, so **both** Postgres lineages are now
pinned to each other. A schema change that reaches only one of them fails a test
instead of being discovered months later against a live database.

## Two claims made in this session that were wrong

Recorded because the correction, not the claim, is the useful part.

1. *"`prisma/postgres/` stops at `0002`, so both 2026-08-19 changes exist only in
   the ledger."* Wrong — commit `14ef0f4` (PR #71) had already regenerated
   `0001_init.sql`.
2. *"`0003` and `0004` are the right artifacts to add there."* Wrong, and this
   one was requested directly. `package.json`'s `db:pg:sql` proves the file is a
   from-empty snapshot, so a hand-written `0003` carrying
   `DROP INDEX "Conversation_externalThreadId_key"` would drop an index the
   regenerated `0001` never creates — breaking replay for anyone rebuilding from
   this lineage. The files were **not** written; the concern was stated and
   `npm run db:pg:sql` was run instead, and the one genuinely missing artifact
   (the `supabase/migrations/` file) was added once the second lineage was found.

`0002_phase1_line_primary_connection.sql` remains the single legitimate
hand-written extra there — a partial unique index Prisma cannot express.

## Repo hygiene (this record's own commit)

- `output/playwright/fr060-business-home.png` — written by
  `tests/e2e/fr060-business-home.spec.js` on every run and cited by no document.
  Untracked and gitignored; `npm run test:e2e` no longer dirties the tree.
- `JULES_REPORT.md` — a nightly-report template belonging to a different project
  (it names `robinbakshi007/ollama-direct-custom-agent` and counts VS Code
  marketplace releases; every figure is `0`). Nothing in this repository
  generates it. Removed and gitignored; recoverable from commit `7a4df1f`.
- `prisma/dev.db.bak-20260819-113451` and a scratchpad file holding a real scrypt
  password hash were deleted from disk. Neither was ever tracked.

## Open — needs a product decision, not merge mechanics

The local branch `codex/postgres-primary-runtime` declares **FR-082** and
**FR-083** for statements `main` has already spent:

| id | `main` | `codex/postgres-primary-runtime` |
|---|---|---|
| FR-082 | Structure editing by direct manipulation (canvas) | Production authentication and password reset |
| FR-083 | Edge creation by direct manipulation (canvas) | Development Overview Dashboard and Workstream Execution Lanes |

Ids are keys (AGENTS.md section 18), and `main` holds them, so the branch is the
side that must move. Two decisions are needed before it can land:

1. **The auth requirement** is a pure numbering collision — nothing on `main`
   describes it. It needs a free id (`FR-091` is the next unused number).
2. **The dashboard requirement overlaps FR-086** (Projects Dashboard, design-only,
   ADR-036). Either the branch's dashboard *is* FR-086 and its code should
   implement that row, or it is a distinct requirement and needs its own id and
   a statement of how the two surfaces differ. That is a product call.

The collision cannot land silently — both branches edit the same registry rows,
so git conflicts on merge — and FR-090's row on `main` already carries the note.
No guard was added for it, because one would only duplicate what git and the
registry already do.

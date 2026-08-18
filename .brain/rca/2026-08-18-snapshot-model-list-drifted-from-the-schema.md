---
version: "0.1.0b"
created_at: "2026-08-18T16:20:00+07:00,CLAUDE"
last_update: "2026-08-18T16:20:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "SNAPSHOT_MODELS is a hand-maintained mirror of the Prisma schema with nothing holding the two together"
---

# RCA — the snapshot model list drifted from the schema, twice, silently

## Symptom

Adding five Prisma models under FR-081 turned the full suite red in two files
that FR-081 does not touch:

```
tests/integration/backup.test.js
tests/integration/fr075-restore-authorization.test.js

Foreign key constraint violated: `foreign key`
  src/modules/project-manager/application/backup-service.js:149
  for (const model of [...SNAPSHOT_MODELS].reverse()) await tx[model].deleteMany()
```

`importSnapshot()` clears the existing graph by walking `SNAPSHOT_MODELS` in
reverse and deleting each table. The new ingestion tables were not in that list,
so their rows survived the sweep and still referenced the `Tenant` and
`Business` rows the sweep then tried to delete.

## What made this worth an RCA

The failure was easy to fix and is not interesting on its own. Two other facts
are.

**It was found twice, independently.** `codex/integration-platform-p1` hit the
same wall on the same day and wrote its own RCA
(`.brain/rca/2026-08-18-p1-backup-reset-fk.md`, discarded with that branch). Two
agents, working in parallel on the same substrate, each spent time discovering
the same defect from scratch. A defect that reproduces on contact is a defect
the build should have been reporting on its own.

**It was already there, and had been shipped.** `IntegrationProvider`,
`IntegrationConnection` and `IntegrationCredential` arrived with FR-079/FR-080
and were **never** added to `SNAPSHOT_MODELS`. Before FR-081 those three were
already unlisted, already carried a `tenantId` foreign key, and already made the
same reverse-delete illegal. The build stayed green for exactly one reason: at
`61eeaea^`, **no test in the repository ever created an `IntegrationConnection`
row.** Every FR-079/FR-080 test is a `tests/unit/*` file working against doubles
or against the page source as text.

So FR-081 did not introduce this. FR-081 added the first fixture that writes a
real connection row, and the pre-existing defect became reachable.

## Root cause

`SNAPSHOT_MODELS` is a hand-maintained list that must mirror `prisma/schema.prisma`
in both **membership** and **order** — parents before children for restore, the
reverse for deletion. Nothing ties the two together. Adding a model is a Prisma
edit; remembering the snapshot list is a convention, and the schema file gives no
hint that a second file depends on it.

Both failure modes are bad, and which one you get is luck:

- If the new model has a foreign key **into** something the sweep deletes, the
  restore crashes — loud, and the good case.
- If it does not, the restore silently succeeds while never exporting, deleting
  or restoring that table. A "restored" installation then carries rows from
  before the restore, pointing at ids that no longer mean the same thing. That
  is the state `IntegrationProvider` was in for the life of FR-079/FR-080.

## Why nothing caught it

1. **No check relates the two files.** The repository ratchets route viewers,
   viewer fixtures, enum copies and doc coverage. Snapshot coverage is not
   ratcheted at all.
2. **The models existed but no row did.** Coverage of a model's *code* is not
   coverage of its *presence in the database*, and only the second one exercises
   the restore path.
3. **The backup test asserted too little.** It checked that
   `snapshot.tables.project` and `snapshot.tables.portfolio` were populated —
   two tables that have been in the list since the beginning. A missing table is
   invisible to an assertion that only names tables already present.

## What was fixed

PR #58 added all eight integration models in restore order, and extended
`tests/integration/backup.test.js` to assert the new tables appear in the
snapshot at all.

## What is still broken

Comparing `prisma/schema.prisma` against `SNAPSHOT_MODELS` on `main` at
`a1eee96` — 42 models, 36 listed — six models are absent:

| Model | Foreign keys | Row ever created in a test? |
|---|---|---|
| `BusinessRoadmap` | businessId | no |
| `BusinessRoadmapHorizon` | roadmapId | no |
| `BusinessGoal` | businessId, roadmapId, horizonId | no |
| `ProjectGoal` | projectId, goalId | no |
| `RoleBinding` | personId, tenantId, businessId | no — the FR-076 test uses a `db` double |
| `LocalWorkspaceMount` | tenantId, businessId | deliberate: deleted explicitly, never restored (device-local paths) |

`LocalWorkspaceMount` is handled on purpose. The other five are the same defect
in the same latent state the integration models were in: every one of them
references `Business`, `Tenant` or `Project`, none has ever had a real row in a
test, and the first fixture that creates one will fail the restore.

This RCA does not fix them. Adding five names to a list without a test that
would have caught their absence repeats the mistake at a smaller scale.

## Prevention

The fix that matches how this repository already works is a preflight check that
derives the expected set from the schema instead of trusting a person to
maintain it:

- enumerate `^model (\w+)` from `prisma/schema.prisma`;
- assert every model appears in `SNAPSHOT_MODELS`, or in an **explicit,
  annotated exclusion list** stating why it is not restorable — `LocalWorkspaceMount`
  is the first legitimate entry and shows the exclusion must carry a reason,
  not just a name;
- fail as a CRITICAL, since the silent branch of this bug is data corruption
  during disaster recovery, which is the worst possible moment to discover it.

Ordering cannot be checked this way — parent-before-child is a property of the
relation graph, not the model list. But membership is where both of this RCA's
incidents came from, and membership is mechanically checkable today.

## The transferable lesson

A model list that must track a schema is not documentation drift, it is a second
source of truth. This repository already refuses hand-copied enum lists for
exactly this reason (`src/lib/validation/enums.js`, `enum-copy` in preflight).
`SNAPSHOT_MODELS` is the same shape of hazard with a worse failure mode, and it
was missed because it does not look like an enum.

The other half of the lesson is about test fixtures. Three models sat unlisted
across two shipped requirements and a full green suite, because no test ever
made one exist. A guard that can only fail when a row is present is not proven
by tests that never write one — the same reason this repository builds viewers
through `tests/factories/viewer.js` rather than by hand.

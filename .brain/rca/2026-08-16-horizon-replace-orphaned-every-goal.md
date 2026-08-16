---
version: "0.1.0b"
created_at: "2026-08-16T23:47:00+07:00,CLAUDE"
last_update: "2026-08-16T23:47:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "FR-059 roadmap horizon replace destroyed every goal on the roadmap"
---

# Incident — delete-and-recreate turned an FK default into permanent data loss

## Symptom

`PATCH /api/business/roadmaps/[id]` with a `horizons` array was specified as a
full replace. The implementation did the obvious thing:

```js
await tx.businessRoadmapHorizon.deleteMany({ where: { roadmapId: id } })
await tx.businessRoadmapHorizon.createMany({ data: data.horizons.map(...) })
```

Renaming one horizon's label made **every goal on that roadmap disappear
permanently** from the only read contract.

## Root cause — three facts that are each harmless alone

1. The FK is `ON DELETE SET NULL`:
   ```sql
   CONSTRAINT "BusinessGoal_horizonId_fkey" FOREIGN KEY ("horizonId")
     REFERENCES "BusinessRoadmapHorizon" ("id") ON DELETE SET NULL
   ```
   Deleting horizons therefore nulls `BusinessGoal.horizonId` instead of
   failing — the schema's own safety valve.

2. Recreated horizons get **new uuids**, so even an identical-content replace
   cannot re-attach anything.

3. `getBusinessStrategy` surfaces goals **only** nested under
   `roadmap.horizons.goals`. A goal with `horizonId = null` is not "unsorted" —
   it is unreachable. No endpoint lists it, and the only recovery is a PATCH
   against an id the client no longer possesses.

Individually: a sensible referential action, a normal insert, a nested read
projection. Composed: silent, unrecoverable deletion through the documented
happy path.

## Why the tests walked past it

The integration test performed exactly this replace — on a roadmap with **no
goals**. The goal-bearing roadmap lived in a different `describe` block. The
test exercised the mechanism and missed the consequence, which is the most
common shape of a test that provides false confidence.

## How it was found

The reviewer did not trust `prisma/schema.prisma`. It extracted the live DDL
from `prisma/dev.db` to confirm the referential action, then traced the read
model to establish that a nulled `horizonId` is not merely detached but
invisible. Reading the schema file alone would have shown the same `ON DELETE
SET NULL` — but the severity conclusion required joining it to the read shape.

## Fix

Reconcile by the stable `key` instead of delete-and-recreate:

- a surviving key is `update`d in place, so the row id — and every
  `BusinessGoal.horizonId` pointing at it — is never touched;
- a genuinely new key is created;
- a removed key is deleted **only after** a `businessGoal.count` guard, and the
  whole PATCH is refused with 400 when goals are still attached.

Positions are staged through sentinel values first to avoid a mid-transaction
`@@unique([roadmapId, position])` collision. That trick later needed its own
guard — see the position/seed incident.

Regression test: create a goal under a horizon → PATCH the roadmap's horizons →
assert the goal is still visible **through the real GET route**. It fails
against the pre-fix code.

## Prevention

- **`ON DELETE SET NULL` on a column the read path requires is a deletion, not a
  detach.** Wherever a projection only surfaces rows through a parent, a nulled
  FK means gone. Audit the other nullable FKs against their read models.
- **A "full replace" of child rows must reconcile by a stable business key**, not
  by primary key lifetime, whenever anything else points at those rows.
- **Test the destructive path on populated data.** A destructive operation
  verified only against an empty parent is untested.

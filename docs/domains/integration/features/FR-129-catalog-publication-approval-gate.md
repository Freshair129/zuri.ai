---
domain: integration
feature: FR-129
module: integration
source: v2-native
version: "0.1.0b"
status: "declared"
---

# FR-129 — Catalog publication approval gate

## Intent

A `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1` run reaches a point where it holds a
candidate projection — a catalog version that would become what the business
reads — and today nothing decides whether that version becomes readable. The
stage catalog has always named both outcomes:

```text
DPS-PUBLISH   (90)  Publish approved projection
DPS-ROLLBACK  (99)  Rollback failed or rejected run
```

"Approved" and "rejected" are in those labels, and nothing produces either
verdict. FR-129 is the missing verdict: a named human signs a specific
candidate version, and the signature — with the evidence they acted on — is on
the run's own ledger, so "who published this catalog and what did they see"
is answerable from the record rather than from memory.

## The shape this does **not** take

CR-003 proposed a `DataPipelineRun` model carrying `catalogVersion`, `vaultId`,
`approvedAt` and `approvedBy`. Every part of that is already here, and the
review in `docs/change-requests/README.md` found half of it. Working it through
the code found the other half: **the gate is not new either.**

| CR-003 field | Where it already lives |
|---|---|
| the run itself | `PipelineRun` (FR-071) — `tenantId`, `businessId`, `status`, `correlationId`, per-outcome counters, replay lineage, `auditEventId` |
| `lane` / "multi-lane" | `IngestionRun.lane` (FR-081) for acquisition; `dataPipelineDefinitionId` for execution |
| the counters in `summary` | `PipelineReconciliation` — `expectedCount`, `actualCount`, `insertedCount`, `updatedCount`, `unchangedCount`, `rejectedCount`, `duplicateCount`, plus source/artifact/staging/destination hashes |
| the per-step trace | `PipelineStep`, `PipelineRecordEvent` |
| `approvedBy` | `PipelineGateDecision.decidedByPersonId` |
| `approvedAt` | that decision row's own `createdAt` |
| the decision itself | `PipelineGateDecision.status` — `PENDING` / `APPROVED` / `REJECTED` / `WAIVED` |
| the event that carries it | `GATE_UPDATED`, already in `EVENT_TYPES`, already refined to require a gate payload |
| `catalogVersion` | `PipelineGateDecision.evidenceJson` (SDD-075) — the column exists; the write path does not |
| `vaultId` | nowhere, deliberately — resolved from scope through API-010 (FR-057, ADR-022) |

So FR-129 declares **no model, no column and no migration.** It declares a use
of machinery that has been in this repository since FR-071 and has never had a
requirement saying what it is for.

## Which run model, and why the two are not a duplication

Both `IngestionRun` and `PipelineRun` are claimed by this domain's charter
(`owns_models`), and a reader meeting them for the first time will suspect one
is a leftover. They are not, and the distinction decides where FR-129 sits:

- **`IngestionRun` is acquisition evidence.** It is scoped to one
  `IntegrationConnection` and one `resourceType`, it advances a `SyncCursor`,
  and it answers "what did this provider hand us on this pull". FR-081 owns it.
  It has no stages, no gate relation, and no reachable path to
  `PipelineGateDecision`.
- **`PipelineRun` is the execution ledger.** It is scoped to a
  `dataPipelineDefinitionId` and carries the stage/record/reconciliation/gate
  trace beneath it. FR-071 owns it, SDD-066 made it definition-neutral, and it
  is the model `PipelineGateDecision` relates to.

A FlowAccount pull (FR-125) opens an `IngestionRun`. Turning what it acquired
into a published catalog version is a pipeline execution, and that is a
`PipelineRun`. The two describe different events about the same data and
neither is a copy of the other; FR-129 is entirely on the second, and adding a
third — CR-003's `DataPipelineRun` — is what SDD-057 already refused, because
it would make the reconciliation evidence something that has to be believed
twice.

## What FR-129 requires

1. A run whose definition is `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1` and which has
   produced a candidate projection does not enter `DPS-PUBLISH` until an
   `APPROVED` `PipelineGateDecision` exists for it. A `REJECTED` decision sends
   it to `DPS-ROLLBACK`.
2. The decision names a person (`decidedByPersonId`) and, when rejecting, a
   `reason`. A `WAIVED` decision is a decision and is recorded as one —
   `required: false` is how a gate says it was optional, not a way to have no
   record.
3. The decision carries the evidence it was made on in `evidenceJson`: the
   candidate publication's identity, and the counts the reviewer was shown.
   A signature with an empty `evidenceJson` records that somebody approved and
   not what they approved, which is not auditable. SDD-075 is the write path.
4. The gate is scoped like everything else on the ledger. A decision is visible
   to, and may be made by, someone the run's Tenant/Business scope admits
   (SEC-001); who specifically may sign is an unmade product decision and is a
   named blocker below, not an omission.

## What it deliberately does not do

**It does not make the ledger enforce anything.** ADR-043 D2.1 and ADR-050 D3
put Tier 1 in the position of recording runs it does not execute, and the
Supabase apply is performed by a Codex-mediated worker (FR-071's approved local
slice), not by this application. An interlock this repository cannot enforce
would be a guard blind to its own subject: it would pass green while the worker
published anything it liked.

So the gate is a **precondition the executing worker observes, and the ledger
makes checkable afterwards.** A run whose `DPS-PUBLISH` step succeeded with no
prior `APPROVED` decision on the same run is a detectable violation — visible
in the same `GET /api/pipelines/runs/{executionRunId}` response that already
returns `gates` alongside `steps`. Detectability is what this tier can honestly
offer; claiming prevention would be claiming control it does not have.

**It does not build a reviewer UI.** CR-003 §2.B asks for four surfaces — a
FlowAccount connection monitor, a drag-and-drop upload portal, a visual diff
viewer and a provenance search. That is a feature programme spanning several
requirements and several product decisions nobody has made. FR-129 is the
record the eventual diff viewer would read and write; it is not that viewer.

## Distinct from FR-110's Stage 17 quality gate

Worth stating permanently, because both will answer to "approval gate on a
pipeline run" in a future search and they share one table:

| | FR-110 Stage 17 | FR-129 |
|---|---|---|
| Pipeline definition | `DPL-KNOWLEDGE-INGEST-V1` | `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1` |
| Who decides | automated — the §23 quality gate | a named person |
| Vocabulary | `PASS` / `PASS_WITH_WARNINGS` / `QUARANTINE` / `FAIL`, projected onto `GATE_STATUSES` | `GATE_STATUSES` directly |
| What is published | a knowledge snapshot (`knowledge_snapshot_id`) | a business-knowledge catalog version |
| Built? | no — declared, 🔜 | no — declared, 🔜 |

Both are unbuilt, which is exactly the condition in which one gets built on the
other's model by a reader who found whichever row first. They are the same
table and different decisions: an automated verdict about corpus quality, and a
human signature accepting a business change. Neither substitutes for the other,
and a run in the knowledge lane never satisfies this requirement.

## Status and named blockers

Declared only. The schema FR-129 needs exists in `prisma/schema.prisma`, exists
in production DDL (`supabase/migrations/20260820221703_smartgift_pipeline_tracking.sql`,
under `FORCE ROW LEVEL SECURITY`), and is asserted by
`tests/unit/platform/pipeline-tracking-migration.test.js`. Nothing else does:

- `zGate` in `src/platform/integrations/core/pipeline-tracking-contract.js` is a
  five-field `.strict()` object — `gateId`, `status`, `required`,
  `decidedByPersonId`, `reason` — with no evidence member, so the envelope
  cannot carry what a reviewer saw.
- `recordPipelineEvent` writes `evidenceJson: '{}'` unconditionally for both
  gate decisions and reconciliations. The column has never held anything.
- `gateSummary` omits `evidenceJson` from the read model, so even a row that
  held evidence would not reach a reader.
- Nothing anywhere reads a gate decision before a publish stage, or after one.
- **Unmade product decision:** who may sign. `decidedByPersonId` is a `Person`,
  and no policy says which Membership or `PlatformGrant` authorizes a catalog
  publication for a Business, or whether the gate is required per definition or
  per run. That is a product question, and FR-129 is blocked on it rather than
  on effort.

## Related

- FR-071 — the execution ledger this is recorded on (SDD-042, ADR-030).
- FR-081 — the acquisition substrate; `IngestionRun` and the raw evidence beneath it.
- FR-125 — the FlowAccount pull CR-003's Lane 1 describes; declared, unbuilt, ADR-053.
- FR-110 — the other gate, distinguished above.
- SDD-066 — why the six tables are definition-neutral, and why no `catalogVersion` column.
- SDD-070 — the precedent: an FR-071 column present since the beginning and written by nothing.
- `docs/change-requests/CR-003-ACCEPTED-SHAPE.md` — the reworked proposal for CR-003's author.

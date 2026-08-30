---
doc_type: intake-note
status: active
version: "1.0.0"
updated_at: "2026-08-30"
---

# CR-003 — the shape this repository will accept

**Status:** Active
**Version:** 1.0.0

A companion to `CR-003-DATA-PIPELINE-GOVERNANCE-AND-APPROVAL-GATES.md`, written
the way `README.md` records the other findings: **next to the document, not
inside it.** CR-003's text stays as its author wrote it. This file says what of
it this repository will take, in what shape, and what it has instead of the
parts it refuses.

The short version: **your central insight was right, and the thing you asked
for is smaller than you thought — most of it is already built.** One requirement
has been declared out of CR-003, **FR-129**, and it adds no model, no column and
no migration.

## What CR-003 got right

Recorded first, because a reply that lists only refusals reads as a rejection
and this is not one.

1. **The approval gate is the real ask.** CR-003 §2.B.3 — a human reviewing a
   candidate against a diff and then publishing or rejecting — is a genuine gap
   in what this repository *does*, and it is the part that had no requirement
   declaring it. That is now FR-129.
2. **"Publish or roll back" is the right pair.** The stage catalog this
   repository has carried since FR-071 names exactly those two outcomes —
   `DPS-PUBLISH` "Publish approved projection" and `DPS-ROLLBACK` "Rollback
   failed or rejected run" — and until FR-129 nothing produced either verdict.
   CR-003 arrived at the same two outcomes independently.
3. **`approvedBy` and `approvedAt` are the right facts to want.** They are the
   ones an auditor asks for. They already exist under different names, which is
   a naming difference, not a disagreement.
4. **Immutable SHA-256 archiving and read-only source files** (§3) are not
   contested at all. They match what is already here: `PipelineRun.sourceSha256`
   / `artifactSha256`, `PipelineRecordEvent.sourceSha256`, and FR-081's rule
   that raw payloads are replayable evidence persisted verbatim and translated
   by a separate path.

## What is refused, and what stands in its place

### `DataPipelineRun` — refused, and there are already two run models

`README.md` recorded that `DataPipelineRun` restates `IngestionRun`. That was
right and incomplete. There is a **second** run model, and it is the one that
matters here:

| Model | Owner | Answers | Has a gate relation? |
|---|---|---|---|
| `IngestionRun` | FR-081 | "what did this provider hand us on this pull" — one connection, one resource type, advances a `SyncCursor` | no |
| `PipelineRun` | FR-071 | "what did this pipeline execution do" — one `dataPipelineDefinitionId`, with stage / record / reconciliation / gate trace beneath it | **yes** |

These are not duplicates of each other: a FlowAccount pull opens an
`IngestionRun`; turning what it acquired into a published catalog version is a
`PipelineRun`. A third table describing the same events is what SDD-057
refused, in one sentence worth quoting because it is the whole argument: a
second execution ledger "would give one question two answers and make the
reconciliation evidence something that has to be believed twice."

### The gate model — already exists

This is the part `README.md` did not know, and the reason this note exists at
all. `PipelineGateDecision` (`prisma/schema.prisma`) has been in this
repository since FR-071:

```prisma
model PipelineGateDecision {
  id                String
  runId             String    // → PipelineRun
  gateId            String?
  status            String    // PENDING | APPROVED | REJECTED | WAIVED
  required          Boolean   @default(true)
  decidedByPersonId String?   // ← your approvedBy
  reason            String?
  evidenceJson      String    @default("{}")
  auditEventId      String?
  createdAt         DateTime  @default(now())   // ← your approvedAt
  updatedAt         DateTime  @updatedAt
}
```

It is in the production DDL too
(`supabase/migrations/20260820221703_smartgift_pipeline_tracking.sql`, under
`FORCE ROW LEVEL SECURITY`), and `GATE_UPDATED` is already an accepted event
type on the ledger's write path, refined to require a gate payload.

So the mapping from CR-003's proposed model is:

| CR-003 field | Accepted shape |
|---|---|
| `runId` | `PipelineRun.executionRunId` |
| `workspaceId`, `tenantId`, `businessId` | already on `PipelineRun` |
| `status` `PROCESSING` / `PENDING_APPROVAL` / `PUBLISHED` / `FAILED` | split in two, deliberately: the **run's** lifecycle is `PipelineRun.status`, the **decision's** is `PipelineGateDecision.status`. One column meaning both is why a run that failed after approval has no honest value |
| `summary` counters | `PipelineReconciliation` — `expectedCount`, `actualCount`, `insertedCount`, `updatedCount`, `unchangedCount`, `rejectedCount`, `duplicateCount`, with source / artifact / staging / destination hashes |
| `approvedBy` | `PipelineGateDecision.decidedByPersonId` |
| `approvedAt` | that row's `createdAt` |
| `catalogVersion` | `PipelineGateDecision.evidenceJson` — **see below** |
| `vaultId` | not stored — **see below** |

### `catalogVersion` as a column — refused; `evidenceJson` instead

SDD-066 deliberately made the six `Pipeline*` tables definition-neutral so more
than one pipeline definition could share them; they currently carry two. A
`catalogVersion` column is one definition's vocabulary in a table both write.
The rejected alternative is recorded in SDD-075: a typed column would be the
same mistake SDD-066 already refused in the validator, moved into the schema
where no validator can refuse it.

`evidenceJson` is where the candidate version's identity and the reviewed diff
go. Being honest about the cost: it is untyped `text`, so that evidence is only
as checkable as the Zod member that writes it — which is why SDD-075 declares
the member rather than leaving the first caller to invent one.

### `vaultId` as a column — refused

The vault a scope maps to is resolved through API-010 (FR-057, ADR-022), from
Tenant/Business scope. Storing a copy on the run creates a second answer to
that question, and a stale one the first time a scope is re-vaulted. This is the
same reasoning as BR-002 applied to an internal identifier: the mapping is a
lookup, not a column.

### The four-part dashboard (§2.B) — not refused, but not one requirement

`README.md`'s route stands: this is a feature programme, and it needs product
decisions nobody here has made — who may sign a publication, what a diff view
shows for a BOM drift, whether an upload portal is a fifth intake surface or a
converter onto the existing envelope (BR-009 and SDD-009 require the latter).

Two of the four already have declared homes:

- **Lane 1, the FlowAccount monitor** is FR-125 (ADR-053) — declared, and
  explicitly not authorized to be built yet: its provider facts carry a
  2026-08-20 as-of date needing re-verification, and the `DATA_SOURCE`
  connection kind it assumes is not in `CONNECTION_KINDS`.
- **Traceability and provenance search** is largely FR-071's monitor read
  model: `GET /api/pipelines/runs/{executionRunId}` already returns the run,
  stage timeline, record failures, reconciliation and gate evidence, and
  `PipelineRecordEvent` already carries `sourceRecordKey`, `sourceRowNumber`,
  `sourceSha256`, `docId`, `picId` and `factId` per record.

The remaining two — the upload portal and the visual diff viewer — are the ones
that need FRs of their own, and each should be proposed separately rather than
as one dashboard.

## What FR-129 declares

> A `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1` run holding a candidate projection does
> not reach `DPS-PUBLISH` until an authorized person records an `APPROVED`
> `PipelineGateDecision` against it; a `REJECTED` decision routes it to
> `DPS-ROLLBACK`. The decision names the person, carries the reviewed evidence
> in `evidenceJson`, and adds no model and no column.

Full statement in `docs/PRD-SDD-v1.0.md`; the design note is
`docs/domains/integration/features/FR-129-catalog-publication-approval-gate.md`;
the schema decision is SDD-075.

**One boundary that matters if you build against this.** The gate is *not* an
interlock this repository enforces. Tier 1 records runs it does not execute
(ADR-043 D2.1, ADR-050 D3) and the Supabase apply is performed by a
Codex-mediated worker. The approval is a precondition **the worker must
observe**, which the ledger then makes checkable: a run whose publish stage
succeeded with no prior `APPROVED` decision is a detectable violation. If you
need prevention rather than detection, it has to live in the worker, and that
is not this repository.

## What is still missing, stated plainly

FR-129 is **declared and unbuilt**, and it is honest about why. The schema is
there; the write path is not:

- `zGate` is a five-field `.strict()` object with no evidence member.
- `recordPipelineEvent` writes `evidenceJson: '{}'` unconditionally.
- `gateSummary` drops the column from the read model.
- Nothing consults a gate decision before or after a publish stage.
- Nobody has decided who may sign.

That last one is a product decision, not an engineering task, and it blocks the
rest.

## If you want to take this further

The route is `CLAUDE.md` → *Adding a feature*, and `README.md` in this folder
states it for CRs specifically. Nothing about arriving as a CR shortens it. But
note what FR-129 cost: **one FR, one SDD, no schema, no migration.** The
proposal shrank because most of what it asked for was already here — which is
the usual outcome of checking a proposal against the tree before designing
against it, and the reason these notes are written where the tree can see them.

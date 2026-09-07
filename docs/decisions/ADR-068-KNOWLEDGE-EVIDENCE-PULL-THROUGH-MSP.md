---
id: ZAI:ADR-068
version: "1.0.0"
status: accepted
created_at: "2026-09-07T00:00:00+07:00,Claude Fable 5.1"
last_update: "2026-09-07T00:00:00+07:00,Claude Fable 5.1"
attributes:
  domain: knowledge
  doc_type: architecture-decision
  scope: "how Tier-3 stage evidence actually reaches this ledger — zuri-ai pulls GKS's export through MSP, owns the cursor per scope, and attributes each exported row to a run or names why it cannot"
relations:
  - type: relates_to
    target: ZAI:ADR-043
  - type: relates_to
    target: ZAI:ADR-046
  - type: relates_to
    target: ZAI:ADR-050
  - type: relates_to
    target: ZAI:ADR-063
  - type: relates_to
    target: ZAI:ADR-067
---

# ADR-068 — Tier-3 stage evidence is pulled: zuri-ai → MSP → `gks_stage_evidence_export`, cursor owned here, every row attributed or named

**Status:** Accepted by owner instruction, 2026-09-07 ("สาย pull ทั้งสาย GKS→MSP→zuri-ai", chosen from four scoped options).
**Date:** 2026-09-07
**Decided by:** Boss (scope), Claude Fable 5.1 (design)
**Relates to:** [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md), [ADR-046](ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md), [ADR-050](ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md), [ADR-063](ADR-063-RETIRE-TIER1-GENESISBLOCKDB-DIRECT-CLIENTS.md), [ADR-067](ADR-067-KNOWLEDGE-INGESTION-REPORTER-AND-RUN-CLOSE.md)
**Touches:** FR-109 (AC-109.12), FR-110, FR-057, `docs/domains/integration/CHARTER.md` (`KnowledgeEvidenceCursor`), `docs/domains/knowledge/CHARTER.md`, `docs/domains/agent/CHARTER.md` (the transport), and — in their own repositories — GKS's `ADR-GKS-LEDGER-REPORTING` (its accepted design, now built) and MSP's `TIER-BOUNDARY-17-STAGE` (the relay).

## Context

ADR-067 gave this ledger a receiver and a push surface for Stages 9–17. The same day, read against the external repositories rather than against our own plan, that turned out to be half an answer: GKS's accepted `ADR-GKS-LEDGER-REPORTING` (Option B, accepted 2026-08-31) had already decided that GKS **never calls outward** — its evidence leaves as a cursor **pull** through a read-only registry tool, `gks_stage_evidence_export`, and "zuri-ai needs a scheduled pull importer" was the companion change request it could not file itself. Both sides were therefore waiting: GKS's tool was accepted with no code, and this repository could validate the evidence and had nothing that fetched it.

The lawful direction is fixed twice over — `Zuri / GoVibe -> MSP -> GKS` in GKS's own `CLAUDE.md`, and "never talks directly to GenesisBlockDB or bypasses MSP governance" in ADR-043 D2.1 — so the importer rides the MSP client zuri-ai is already authorized to hold (FR-057), and MSP relays one more read-only tool. This decision records the three pieces built together on 2026-09-07 and proven end to end against the real MSP and the real GKS: the GKS export (their repository), the MSP relay `msp_knowledge_evidence_export` (their repository), and this repository's importer, transport and cursor.

## Decision

[ADR-070](ADR-070-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md) adds the
approved isolated forward worker and exact-attempt v1 evidence path on top of
this legacy pull slice. Cursor advancement still follows durable writes; a
legacy row without an attempt never completes a newer attempt.

### D1 — zuri-ai reaches MSP by spawning it, from deployment configuration, and fails closed without it

`src/modules/agent/msp-stdio-transport.js` is the transport: Node built-ins only, MSP's own NDJSON JSON-RPC framing (`initialize` → `notifications/initialized` → `tools/call`), one child process per call closed in `finally`, and the `(name, input) => Promise<structuredContent>` shape `createMspMemoryPort` already accepts — so the memory port (API-009) and the evidence pull share one transport rather than each inventing one. It is built from `ZURI_MSP_COMMAND` / `ZURI_MSP_ARGS` / `ZURI_MSP_CWD`; when the command is unset the factory returns `null` and the route answers 503 at its own boundary, never a silent empty pull. Nothing here imports from the MSP repository; the wire is the contract, and the live chain test is what holds the two sides to it.

### D2 — Cursor ownership is zuri-ai's, per `KnowledgeScope`, and it advances only past rows that landed

`KnowledgeEvidenceCursor` — one row per exact scope tuple (`portfolioId`, `tenantId`, `businessId`, `workspaceId`, `projectId`, `sharing`), unique on the tuple — is the integration lane's bookkeeping for the pull, the mirror image of FR-100's decision export where the *other* side owned the cursor. There is no wildcard scope: a caller pulls each scope it wants on that scope's own cursor, exactly the rule GKS's port contract states. The cursor moves once per page, to the page's `next_cursor`, **after** that page's ledger writes committed; when a row blocks (D3) it moves only to the last row that landed. A crash between the writes and the upsert replays the page next time, and the receiver's derived idempotency keys (ADR-067 D2) turn the replay into `UNCHANGED` rather than duplicates — GKS guarantees a re-read is harmless and non-lossy (commit-time cursors); this side guarantees a re-apply is harmless. This is a new model with its Supabase migration in the same change; it is not a ledger model, so ADR-050 D4's "no new model for the ledger" holds — the ledger stays the six `Pipeline*` tables.

### D3 — Every exported row is applied, passed over, held, or blocked — and the reason is returned, never inferred

GKS's row names the `run_id` it was executed for (the `pipeline_job_id`), a `DPS-KI-*` stage, six NFR-020 metrics, execution-level `evidence` and per-record `records`. `classifyEvidenceRow` decides, purely:

| Disposition | When | Cursor |
|---|---|---|
| **apply** | an external stage (9–16) on a `DPL-KNOWLEDGE-INGEST-V1` run this ledger holds, with its materialised step | advances |
| **unattributed** | no `run_id` (a backfilled promotion, a human bind or merge), a `run_id` this ledger never minted, or a run of another definition | advances; the row is listed |
| **held** | GKS's half of Stage 17 — dimensions without a verdict; a verdict is not this importer's to invent | advances; listed |
| **blocked** | an attributable row that breaks the contract — a Tier 1 stage id from a Tier 3 export, a GKS scope contradicting the run's Tenant or Business, no materialised step, or a receiver refusal (409 conflict, validation) | **stops before the row**; listed; seen again next pull |

The blocking rule is GKS's CR draft's own ("an unmappable one is logged and blocks cursor advancement past it, not skipped"), narrowed to what *unmappable* means: a contract violation. Evidence of an execution no run of ours owns is not unmappable, it is not ours — passing it over with its reason named is the answer to the draft's first open assumption. The draft's second assumption — that evidence lands as one `PipelineRecordEvent` per catalog record — is answered **no**: a row is one stage *execution* and lands as `STEP_STARTED`/`STEP_SUCCEEDED` on the run's materialised step with four of the six metrics (ADR-067 D5), timed from `produced_at − processing_time_ms` (ADR-067 D2); `records` entries stay in GKS, because this repository persists no derived objects (AC-109.4/.5 remain open by SDD-059) and would otherwise be inventing a store to hold them. A row applies as `SUCCEEDED`: GKS's export has no failure outcome — a row exists because the stage ran — and a failed *record* is a count on a succeeded *stage*, the same reading the Tier 1 path gives a normalization decline (SDD-061).

### D4 — What this decision does not do

- It does not build the forward handoff. Nothing in this repository yet sends Stage 8's entity candidates to MSP's `msp_knowledge_promote` naming the run; the live chain test plays that caller. That handoff is FR-057's API-010 question and stays open (`PLAN-PENDING-KNOWLEDGE-20260831` MSP-01/MSP-02).
- It does not retire ADR-067's push surface. The four routes remain the route for a tier that *may* call outward — GenesisBlockDB, whose half of Stages 13/15/16/17 GKS's ADR says "travels its own route to FR-071" — and the receiver functions are what the importer calls.
- It does not schedule. `POST /api/pipelines/knowledge/evidence/pull` is one installation-operator tick over one scope; the interval and the scope roster are operational choices GKS's CR explicitly left to this side, and a scheduler is a separate change.

## Consequences

- **AC-109.12 closes for every external stage that exists.** Stage 9, executed in the real GKS through the real MSP with the run named, reaches this ledger as `DPS-KI-ENTITY-RESOLVE` on that run — `tests/integration/fr110-knowledge-evidence-chain.test.js`, live across three repositories when `ZURI_MSP_REPO_ROOT` and `ZURI_GKS_REPO_ROOT` are set. Stages 10–14, once GKS builds them, report through the same table and the same pull with no change here; the criterion's other half — zuri-ai executes none of them — holds as before.
- GKS's `ADR-GKS-LEDGER-REPORTING` is implemented (its port version 3, `stage_evidence`, `gks_stage_evidence_export`, and the backfill that puts Stage 9's `HUMAN`/`BACKFILL` evidence on the same path — its own Task 1 finding), MSP relays `msp_knowledge_evidence_export` and keeps no cursor, and the companion CR draft's two assumptions are answered above. Each repository records its own half in its own documents.
- One new model (`KnowledgeEvidenceCursor`, integration lane, migration `20260907120000` in both trees, **not applied** to production — ADR-057), one new route, three new env variables (`ZURI_MSP_*`). Handing this deployment an MSP, and MSP a GKS, is operator configuration, not code.
- A reader can grep `msp_knowledge_evidence_export` in this repository and find exactly one caller — the importer — and no `gks_` string outside tests and this document: ADR-050 D3 still describes the tree.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 1.0.0 | 2026-09-07 | accepted | The pull half: spawned-MSP transport, per-scope cursor model, four-way row attribution, and the live three-repository proof; GKS export and MSP relay built the same day in their own repositories | Claude Fable 5.1 |

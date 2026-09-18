---
version: "0.2.0b"
created_at: "2026-09-18T00:00:00+07:00,Codex"
last_update: "2026-09-18T18:36:08+07:00,Codex"
status: "candidate"
superseded_by: null
attributes:
  domain: "knowledge"
  doc_type: "root-cause-analysis"
  scope: "TASK-ZAI-050 production SmartGift catalog admission"
---

# RCA — production per-record admissions were gated by an aggregate benchmark

## Symptom

The corrected SmartGift ProductMaster projection admitted 16 records and
completed Tier 1 Stages 1–8. The GenesisBlock worker created Stage 13–16
physical evidence for each claimed decision, but every decision remained
`held_by_quality_gate` and the corresponding zuri-ai ingestions remained
`RUNNING`.

## Evidence

- The production worker boots one static
  `GENESIS_WORKER_BENCHMARK_FIXTURE`.
- The derived fixture is a union of nine queries from the four-record
  acceptance corpus, while the production adapter creates one decision per
  admitted record.
- A candidate generation contains only its own record's chunks. For example,
  the `PM-AROMA` candidate has two chunks, while the union fixture has no
  `PM-AROMA` query. The worker consequently reported `recallAt5: 0` and
  `mrr: 0` for every candidate.
- The worker's quality-gate denial path records `held_by_quality_gate` and
  returns without a publication receipt or Stage 17 failure evidence. zuri-ai
  therefore has no terminal Stage 17 event with which to close a denied run.
- After the repaired image was promoted, the MSP evidence relay returned nine
  rows for a live run, but the zuri-ai importer failed before committing any
  row with Prisma `P2028` (`Transaction API error: Transaction not found`).
  The stack showed `applyRows` opening `$transaction` on the interactive
  transaction client already supplied by its page-level transaction.

## Root cause

The production deployment translated an acceptance fixture that is scoped per
record into one aggregate fixture without adding a per-candidate binding
contract. The worker then evaluated irrelevant queries against isolated
generations. Separately, the worker treated a terminal GKS `FAIL` verdict as a
retryable hold even though the Tier 1 importer can close a run only from
materialized Stage 17 failure evidence or a publication receipt. Once evidence
was available, the importer added a second transaction boundary inside its
page transaction; PostgreSQL rejected that nested interactive transaction with
`P2028`, so the durable run never received local Stage 9–17 evidence.

## Why detection escaped

The acceptance suite reboots the worker with each record's fixture, so it did
not exercise the long-running production container's static union fixture.
The deploy helper documented the union as a derived artifact but left the
union-vs-per-record quality decision to a later acceptance gate; production
was started before that gate had a corresponding runtime contract test.

## Proposed prevention

1. Bind benchmark rows to the candidate record (or require an explicit
   per-record fixture) and compute metrics only over applicable rows. A
   candidate with no applicable rows must fail closed with a deterministic
   terminal error rather than receive fabricated quality metrics.
2. Preserve the existing WARN hold behavior, but materialize a Stage 17
   failure through the approved MSP contract for a terminal FAIL/publication
   denial so Tier 1 reaches `FAILED` with evidence.
3. Add worker contract tests for a static multi-record fixture, a no-applicable
   query set, and Stage 17 failure delivery; add a deployment test that proves
   the production fixture shape matches the admission granularity.
4. Keep evidence import on one page-level transaction and reject nested
   transaction clients in acceptance coverage.

## Scope and release limit

This RCA authorizes diagnosis and contract repair only. It does not mark the
16 production runs successful, delete the failed V1 evidence, or bypass the
GKS quality gate. Publication remains blocked until the repaired worker and
the exact production image produce terminal Stage 17 evidence and a matching
publication receipt.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-18 | superseded | Recorded per-record benchmark scope drift and missing terminal Stage 17 failure evidence. | working-tree | Codex |
| 0.2.0b | 2026-09-18 | candidate | Added production P2028 evidence and the single-page transaction repair boundary. | working-tree | Codex |

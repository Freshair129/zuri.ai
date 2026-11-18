---
id: ZAI:ADR-119
title: Remove SmartGift and GoVibe from Zuri
version: "1.1.0"
status: accepted
created_at: "2026-11-15"
last_update: "2026-11-16"
author: Claude Sonnet 5.5
superseded_by: null
approval_scope: decision-record-only-supersede-adr-040-and-adr-075-withdraw-fr-187-no-code-data-or-production-change
approved_on: "2026-11-15"
approved_by: "Delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08, on owner instruction 2026-11-15 relayed by the lead Claude session; this is not human approval and no other approval is claimed"
attributes:
  doc_type: architecture-decision
  domain: platform-control
  scope: "SmartGift (a former customer and business pipeline) and GoVibe (external prior art) are not part of Zuri; this record supersedes ADR-040 and ADR-075 and withdraws FR-187, and states the retention rule for the generic mechanisms that stay; it changes no code, data, migration or production state"
relations:
  - type: supersedes
    target: ZAI:ADR-040
  - type: supersedes
    target: ZAI:ADR-075
  - type: relates_to
    target: ZAI:FR-187
  - type: relates_to
    target: ZAI:ADR-039
  - type: relates_to
    target: ZAI:ADR-024
  - type: relates_to
    target: ZAI:ADR-118
  - type: relates_to
    target: ZAI:ADR-110
---

# ADR-119 — Remove SmartGift and GoVibe from Zuri

**Status:** Accepted on 2026-11-15 as a decision record. It records a
delegated product-owner decision (Astra, gpt-6-astra) under owner instruction
2026-11-08, taken on owner instruction given on 2026-11-15 and relayed by the
lead Claude session. It is not human approval. It moves no file, edits no code,
data row or migration, and has no production effect.

## Context

SmartGift began as a customer and business pipeline embedded in Zuri, and its
tenant (`BUS-SMARTGIFT`) became the only real tenant behind several generic
features: catalogue ingestion, pricing rules, customer-import review, Edge
pricing and catalogue RAG, and migrations that seed it. GoVibe is external prior
art kept under `reference/GoVibe/`; its only live relationship to Zuri is the
MSP protocol, which Zuri uses under its own name (API-009, API-010).

On 2026-11-15 the owner decided that SmartGift and GoVibe are not part of Zuri,
that their data is unused and unimportant, and that the repository must be
cleaned. If that data is ever needed again it re-enters through the normal
customer and user import channel with its normal import log, not as embedded
artifacts or scripts.

## Decision

### D1 — Supersede ADR-040 and ADR-075

ADR-040 (Codex-mediated SmartGift pipeline evidence bridge) and ADR-075
(SmartGift catalogue enters GenesisBlockDB only through the 17-stage source
adapter) are superseded by this record. Their identifiers stay burnt and their
files stay as history; they no longer direct new work. The generic mechanisms
they describe survive under D3 on their own authority, not theirs.

### D2 — Withdraw FR-187

FR-187 (the structured-record source adapter for SmartGift catalogue data) is
withdrawn. Its number is never reused or renumbered (AGENTS.md §18, ADR-039).
Its ledger entry is recorded with `docs:ids --supersede` and a written reason;
its subject anchor does not move. FR-188 and FR-189, FEAT-026 membership, and
the historical acceptance evidence are not rewritten here; any FR whose only
purpose was SmartGift is handled per ID in the removal change that deletes its
code, never by this record.

### D3 — Generic mechanisms are kept

These stay, and only SmartGift-specific names or data are removed from them in
later changes: supplier cost sheets (FR-164), pipeline run tracking and the
`/api/pipelines/runs` surface, document intake, the SCM tables and inventory
services, and migrations 20260820221703 and 20260910120000. Applied migrations
are never edited. Renames of SmartGift-named constants are behaviour-preserving.

### D4 — GoVibe is removed

`reference/GoVibe/**`, `docs/GAP-ANALYSIS-ZURI-GOVIBE.md` and
`docs/GOVIBE-INTEGRATION.md` are removed in a follow-up change. The MSP protocol
keeps its identity and behaviour; only the GoVibe label goes.

### D5 — Data and history

Customer artifacts under `artifacts/migrations/MIS-SG-*` are removed from HEAD in
a follow-up change. This record does not purge git history and does not drop
production data; both need separate owner-run steps.

## Out of scope

Production actions, database changes, new migrations, removal of the
SmartGift-only features (pricing rules, customer-import review, catalogue
adapter), Edge and `services/scm` triage, and any history rewrite. Each needs its
own change under the normal Git review and exact-head CI.

## Consequences

- New work is not derived from ADR-040, ADR-075 or FR-187.
- Documents that cite them stay as history until the change that removes the
  code they describe.
- The id ledger records FR-187 as superseded and ADR-040 and ADR-075 as
  superseded; no subject anchor moves.

## Amendment 1 — Edge SmartGift catalog serving path removed (2026-11-16, option X)

**Basis:** owner instruction 2026-11-16 ("option X"), relayed by the lead Claude session, recorded as a
delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08. Not human
approval. It is also the ADR-118 D5 approval for the `apps/edge/docs` documents removed with the code
they describe (and no other Edge document).

**Decision.** `apps/edge` no longer carries the SmartGift catalog: the Edge pricing engine, the catalog
build/ingest/eval pipeline and the local catalog serving path (local RAG service :8888 and embed sidecars,
GenesisBlock MCP server, taxonomy tooling) are removed (PRs 6b, 6c-1, 6c-2). This **partially supersedes
ADR-110** only where it says `apps/edge` keeps a local Knowledge/RAG runtime (D1 closing paragraph as it
applies to `apps/edge`, the Alternatives bullet on removing the whole `apps/edge` tree, and the matching
Verification bullet). Everything else in ADR-110 stands: device/harness retirement (D1 list, D3, D4, D5),
PRP key flow (D2), and the server-side Knowledge 17-stage pipeline, GenesisRAG, MSP/GKS, MinIO and Files
work, which this amendment does not touch. `apps/edge` is not deleted; it keeps the CLI and the
Conversation executor over the published GenesisRAG17 corpus.

**Ids.** No id moves: ADR-110 stays `approved` and is not marked superseded in the ledger because most of
its decisions remain in force; its body carries a pointer to this amendment. No FR, SDD or ADR number is
reused or renumbered.

## Version history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-11-15 | Claude Sonnet 5.5 | Initial record: supersedes ADR-040 and ADR-075 and withdraws FR-187 (ledger moves recorded with docs:ids --supersede). |
| 1.1.0 | 2026-11-16 | Claude Sonnet 5.5 | Amendment 1: owner option X removes the Edge SmartGift catalog serving path and partially supersedes ADR-110 retained Edge Knowledge/RAG scope (pointer only; no id moves). |

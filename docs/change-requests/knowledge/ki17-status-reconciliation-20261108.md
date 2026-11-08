---
doc_type: change-request
version: "1.0.0"
status: approved
migration_base_revision: 98b708f11a51578333c52f828f31bec814df1e66
approval_scope: FR-187-and-FR-188-status-reconciliation-and-FR-189-retirement
approved_by: "Astra (gpt-6-astra), delegated product owner"
---

# KI-17 status reconciliation and FR-189 retirement

## Approval

Approval basis: delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08. This is not human approval.

The delegated decision approves the bounded FR-187/FR-188 status migration and FR-189 retirement recorded below. Canonical document approval, requirement delivery, task completion, deployment and current production state remain distinct facts.

## Scope and decision boundary

This is a v1 reviewed source-row migration from zuri-ai 98b708f11a51578333c52f828f31bec814df1e66. It preserves the three existing IDs, FEAT-026 membership, subject anchors, projection positions and retained implementation/history.

FR-187 and FR-188 are marked deployed and accepted only for their stated SmartGift structured-record profiles, based on the evidence and limitations below. This does not mean every Knowledge profile is accepted, current production health was inspected, or TASK-ZAI-050 or TASK-ZAI-095 is complete.

FR-189 is superseded as an active Edge LINE shadow/cutover delivery obligation. This is a new product decision, not a claim that ADR-110 explicitly superseded FR-189. The retained Knowledge/RAG reader, tests, databases and v4 implementation are preserved. No cutover, fallback-window completion, sunset or deletion is asserted. Server LINE grounding remains FR-235/ADR-090; FR-189 is not renamed into a Server requirement.

## Reviewed source-row changes

The full before and after rows are reproduced exactly. FR-187/FR-188 statement cells are unchanged. FR-189 retains the original statement text, surrounded by strikethrough markers as required for retirement.

### ZAI:FR-187

Canonical record: [FR-187](../../features/FEAT-026/requirements/FR-187.md).

#### Before row

```text
| FR-187 | A structured-record source adapter enters the 17-stage knowledge ingestion pipeline before Stage 1 for SmartGift catalog data (ADR-075 D2, proposed) — SmartGift's 5-stage ETL becomes a source producer: its prepared JSON projection plus its own SHA-256-versioned registry is the version identity the adapter authorizes, freezes and enqueues into `DPL-KNOWLEDGE-INGEST-V1`, never synthesizing any stage result (extension map, `KNOWLEDGE-INGESTION-17-STAGE-FLOW.md` "Before Stage 1" row). Classification at Stage 5 (`DPS-KI-CLASSIFY`) enforces Zero-PII with the same deny policy SmartGift already runs (`pipeline/knowledge_registry/core.py` `DENIED` regex), so a customer/contact/quotation record can never be admitted as a product occurrence. SKU / FlowAccount codes travel as an attribute of the occurrence, never as its `resolutionKey`, and resolve through the existing per-Tenant `Product.flowAccountSku` (FR-174…FR-181 / ADR-074 D5) rather than a new catalog-vault mapping (BR-002). Replaces SmartGift Stage 5's direct `vaults/vlt-catalog-product/genesis-db` write; opens no Stage 18. | 🟢 implemented locally (tests), not deployed — ADR-075 Phase 1 only (adapter, admission fan-out, Stage 5 Zero-PII gate); no model, no column, no migration; parser profile/`ontology_v2` remain FR-188 |
```

#### After row

```text
| FR-187 | A structured-record source adapter enters the 17-stage knowledge ingestion pipeline before Stage 1 for SmartGift catalog data (ADR-075 D2, proposed) — SmartGift's 5-stage ETL becomes a source producer: its prepared JSON projection plus its own SHA-256-versioned registry is the version identity the adapter authorizes, freezes and enqueues into `DPL-KNOWLEDGE-INGEST-V1`, never synthesizing any stage result (extension map, `KNOWLEDGE-INGESTION-17-STAGE-FLOW.md` "Before Stage 1" row). Classification at Stage 5 (`DPS-KI-CLASSIFY`) enforces Zero-PII with the same deny policy SmartGift already runs (`pipeline/knowledge_registry/core.py` `DENIED` regex), so a customer/contact/quotation record can never be admitted as a product occurrence. SKU / FlowAccount codes travel as an attribute of the occurrence, never as its `resolutionKey`, and resolve through the existing per-Tenant `Product.flowAccountSku` (FR-174…FR-181 / ADR-074 D5) rather than a new catalog-vault mapping (BR-002). Replaces SmartGift Stage 5's direct `vaults/vlt-catalog-product/genesis-db` write; opens no Stage 18. | deployed and accepted for the SmartGift structured-record profile — historical Linux acceptance 2026-09-16, production publication evidence 2026-09-24/28, MSP alignment evidence 2026-10-24, and native Windows acceptance 42/42 on 2026-11-08. Current production state and TASK-ZAI-050 activation closure are not verified by this migration. |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `ff93df06f38a33839e805f3f60b25aa65e21fb2b21595cdccc09b1f92f16d828`.

### ZAI:FR-188

Canonical record: [FR-188](../../features/FEAT-026/requirements/FR-188.md).

#### Before row

```text
| FR-188 | A structured parser profile, typed product mentions and an `ontology_v2` contract extend GenesisRAG17 for catalog data (ADR-075 D6, proposed) — a parser profile distinct from `genesisrag17-parser-1` produces Stage 8 (`DPS-KI-ENTITY-EXTRACT`) occurrences typed as catalog entities (e.g. `ProductMaster` / `CatalogOffer` / `BOM`), and `ontology_v2` declares the predicate(s) a product catalog needs beyond the frozen `ontology_v1` (`WORKS_FOR`, `PURCHASED`). Schema, hash, policy and receipt changes are agreed by zuri-ai, MSP, GKS and the GenesisBlock worker together before any one repo adds a field, per the flow doc's own "ขั้นตอนเพิ่มความสามารถ" change protocol; existing `ontology_v1` snapshots remain queryable as an older generation and are never rewritten. | 🟡 implemented locally (PR #327, tests) — rollout step 3, merges after GenesisBlock#174 and Genesis-Knowledge-System#7; not deployed; four-process acceptance run pending |
```

#### After row

```text
| FR-188 | A structured parser profile, typed product mentions and an `ontology_v2` contract extend GenesisRAG17 for catalog data (ADR-075 D6, proposed) — a parser profile distinct from `genesisrag17-parser-1` produces Stage 8 (`DPS-KI-ENTITY-EXTRACT`) occurrences typed as catalog entities (e.g. `ProductMaster` / `CatalogOffer` / `BOM`), and `ontology_v2` declares the predicate(s) a product catalog needs beyond the frozen `ontology_v1` (`WORKS_FOR`, `PURCHASED`). Schema, hash, policy and receipt changes are agreed by zuri-ai, MSP, GKS and the GenesisBlock worker together before any one repo adds a field, per the flow doc's own "ขั้นตอนเพิ่มความสามารถ" change protocol; existing `ontology_v1` snapshots remain queryable as an older generation and are never rewritten. | deployed and accepted for the SmartGift parser-2 / ontology_v2 profile — historical Linux SmartGift acceptance and production parser-2 / ontology_v2 evidence, supplemented by MSP alignment evidence 2026-10-24 and native Windows acceptance 42/42 on 2026-11-08. Future tuple changes still require exact-image G-3 qualification; this is not product-wide acceptance. |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `90766e9afacda1cb852404f569dddd4cd29ba40c757e1faa5a26b7dc0545ef17`.

### ZAI:FR-189

Canonical record: [FR-189](../../features/FEAT-026/requirements/FR-189.md).

#### Before row

```text
| FR-189 | Edge answers SmartGift catalog queries from the published GenesisRAG17 generation through MSP, with Genesis RAG v4 as a transitional fallback (ADR-075 D7, proposed) — the edge query path becomes source caller → MSP credential/scope check → worker loopback query → one published generation → citation (the existing post-Stage-17 query flow), instead of `apps/edge`'s v4 pipeline re-deriving and serving its own store directly from a sibling checkout's file (`apps/edge/src/rag/v4/paths.ts` `defaultUpstream`) with no MSP/GKS mediation. v4 remains available only as an explicit, time-boxed fallback during the Phase 4 shadow-then-cutover and is sunset on an owner-set date; it is never a second production write path into GenesisBlockDB. | 🔜 approved 2026-09-11 (ADR-075 approved); fallback window set 2026-09-11 (120 days after cutover or end of the New Year 2027 season, whichever is later) — Phase 4 needs its own gate; no code, no cutover |
```

#### After row

```text
| FR-189 | ~~Edge answers SmartGift catalog queries from the published GenesisRAG17 generation through MSP, with Genesis RAG v4 as a transitional fallback (ADR-075 D7, proposed) — the edge query path becomes source caller → MSP credential/scope check → worker loopback query → one published generation → citation (the existing post-Stage-17 query flow), instead of `apps/edge`'s v4 pipeline re-deriving and serving its own store directly from a sibling checkout's file (`apps/edge/src/rag/v4/paths.ts` `defaultUpstream`) with no MSP/GKS mediation. v4 remains available only as an explicit, time-boxed fallback during the Phase 4 shadow-then-cutover and is sunset on an owner-set date; it is never a second production write path into GenesisBlockDB.~~ | superseded — ASTRA-D1 D1, 2026-11-08: retire the Edge LINE shadow/cutover obligation; retain existing Knowledge/RAG implementation, tests and historical evidence. Server LINE grounding remains FR-235/ADR-090. No cutover, sunset or deletion is asserted. |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `e2763bda03c61146f3860d2647b637cfb42bca875cc83021b57ed9fa6a57eaed`.

## Evidence and limitations

| Evidence | Supports | Limitation |
|---|---|---|
| G-3, 2026-09-16, 35/35 | Historical Linux image acceptance, including SmartGift `ontology_v2`, crash/replay and quality thresholds | MSP `49fe7de7` / GKS `ecf1e4de` / GenesisBlock `7c9261c4`; not the current tuple |
| Production probe, 2026-09-24 | Historical publication evidence: 22 published ingestions/receipts, parser-2 and `ontology_v2` | Observation, not the activation event or present-day health |
| Release, 2026-09-28 | Historical deployment and both relay-hop smoke results | Smoke alone does not establish complete acceptance |
| MSP plan ?6, 2026-10-24 | Recorded d0 MSP image qualification, restored canary, production publication/query/denial and persistence evidence | Operator-attested record; underlying private artifacts were not inspected here |
| Native acceptance, 2026-11-08, 42/42 | Current pinned runtime tuple with zuri `58991a10`, including SmartGift and LINE cases | Windows developer acceptance; not Linux image or live LINE production acceptance |

Sources: [deployment plan](../../plans/GENESISRAG17-EDGE-DEPLOYMENT.md), [production probe](../../../.brain/reports/2026-09-24-genesisrag17-production-probe.md), [native acceptance report](../../../.brain/reports/2026-11-08-ki17-native-acceptance.md), and [MSP alignment plan](../../IMPLEMENTATION-PLAN-MSP-GENESISRAG17-ALIGNMENT.md).

## Parent and peer impacts

- ADR-075 receives a dated pointer; its original D7/D8 decisions are preserved. The deployment plan points to this migration.
- ADR-110 preserves Knowledge/RAG and excludes deletion of the entire Edge tree; the FR-189 retirement does not delete any reader or tests.
- TASK-ZAI-042's obsolete Edge LINE criteria must be recorded as superseded, not successfully executed. Its remaining delivery/recovery obligations require separate reconciliation; this P0 migration does not modify task containers.
- FR-187/FR-188 status changes do not close TASK-ZAI-050/095, change runtime pins, authorize deployment or certify current production state.

## Verification requirements

Run the scoped registry, ID-ledger, graph/view, document-registry tests, governance and diff checks serially in the approved implementation order. These checks validate the document migration and generated projections; they do not replace Linux exact-image acceptance, live LINE production evidence, independent review or operational approval.

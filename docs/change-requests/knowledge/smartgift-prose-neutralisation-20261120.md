---
doc_type: change-request
version: "1.0.0"
status: approved
migration_base_revision: b51d6e426e10626dcdc08467cda1366e86bbab9a
approval_scope: B1-canonical-record-prose-under-ADR-119
prior_art:
  - docs/decisions/ADR-119-REMOVE-SMARTGIFT-AND-GOVIBE-FROM-ZURI.md
  - docs/change-requests/knowledge/smartgift-fr187-withdrawal-20261115.md (precedent reviewed source-row migration)
---

# ADR-119 B1 — neutralise SmartGift/GoVibe prose in canonical records

## Approval

Approval basis: the owner's ADR-119 decision to neutralise SmartGift/GoVibe prose while keeping persisted and operator names, and the owner's explicit instruction in chat on 2026-11-20 to prepare this reviewed migration for the B1 records. No separate delegated product-owner (Astra) or human sign-off on the exact rows below is claimed; the lead session's review of the pull request is the remaining gate. Document approval, requirement delivery, task state, deployment and current production state remain distinct facts.

## Scope and decision boundary

This is a reviewed source-row migration from zuri-ai b51d6e426e10626dcdc08467cda1366e86bbab9a, the revision that holds each prior canonical wrapper. Each change replaces one product-name phrase in the middle of a statement or note with neutral wording. Every ID, FEAT membership, subject anchor, status text, cell structure and projection position is preserved, and no identity is allocated.

Kept unchanged on purpose: persisted and operator names (`SMARTGIFT_CATALOG_V1`, `SMARTGIFT_DOCUMENT_INTAKE`, `zuri_line_smartgift_ro`, `mcp__smartgift__*`), FEAT-025/FEAT-026 titles and subject anchors, SDD-042, and withdrawn rows FR-187/FR-188/FR-189. FR-079 and FR-131 contain only persisted names and are not changed. SDD-091 is also unchanged: the reviewed-migration wrapper supports existing FEAT/FR registry rows only, so an SDD row cannot be migrated this way.

## Reviewed source-row changes

### `ZAI:FR-047`

Canonical record: [FR-047](../../../docs/requirements/FR-047.md).

#### Before row

```text
| FR-047 | Curated business-knowledge read contract: the SmartGift pilot exposes only an allow-listed, versioned public product projection through `BusinessKnowledgeReadPort`; DuckDB and Supabase are adapters. PII, cost, margin, invoice, unrestricted SQL and local paths are excluded. | Phase 1 active - owner-approved 2026-08-14 |
```

#### After row

```text
| FR-047 | Curated business-knowledge read contract: the pilot Business exposes only an allow-listed, versioned public product projection through `BusinessKnowledgeReadPort`; DuckDB and Supabase are adapters. PII, cost, margin, invoice, unrestricted SQL and local paths are excluded. | Phase 1 active - owner-approved 2026-08-14 |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `764cb5490ecd0a58cbf3bec02598debe12479fce02b86448b6abebd5ef46ae7a`.

### `ZAI:FR-051`

Canonical record: [FR-051](../../../docs/requirements/FR-051.md).

#### Before row

```text
| FR-051 | Production Supabase tenant isolation: SmartGift knowledge lives in private `zuri_core`, every row carries the reserved Tenant and Business UUIDs, composite foreign keys enforce ancestry, forced RLS plus tenant-leading indexes protect reads, and the DuckDB import retains SHA-256 lineage plus an immutable import audit event. | Production migration and verified 74-row price-disabled import complete |
```

#### After row

```text
| FR-051 | Production Supabase tenant isolation: the pilot Business knowledge lives in private `zuri_core`, every row carries the reserved Tenant and Business UUIDs, composite foreign keys enforce ancestry, forced RLS plus tenant-leading indexes protect reads, and the DuckDB import retains SHA-256 lineage plus an immutable import audit event. | Production migration and verified 74-row price-disabled import complete |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `3e7b0ea75e2b3854aa151fe933a434537fda78f98aff681991ff20e652ee6e90`.

### `ZAI:FR-057`

Canonical record: [FR-057](../../../docs/requirements/FR-057.md).

#### Before row

```text
| FR-057 | Authorized agent context: every LINE turn resolves ExternalIdentity, Person, Membership, thread/session assurance and server-owned agent/workspace/project scope, then calls GoVibe/MSP API-010 `msp_vault_resolve` before API-009 retrieval; the model, prompt, client payload and stale session cannot widen the canonical authorized vault set. | Owner-approved beta; API-010 integration in progress |
```

#### After row

```text
| FR-057 | Authorized agent context: every LINE turn resolves ExternalIdentity, Person, Membership, thread/session assurance and server-owned agent/workspace/project scope, then calls MSP API-010 `msp_vault_resolve` before API-009 retrieval; the model, prompt, client payload and stale session cannot widen the canonical authorized vault set. | Owner-approved beta; API-010 integration in progress |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `8a40d6efcea4cbff01462330d70a07c9dae20530f3653f1f27bacd791827c270`.

### `ZAI:FR-071`

Canonical record: [FR-071](../../../docs/requirements/FR-071.md).

#### Before row

```text
| FR-071 | Supabase data pipeline monitor and replay: the governed SmartGift DuckDB/source-artifact → Supabase pipeline exposes stable definition, run, stage, step, attempt, record, batch, `doc_id`, `pic_id`, `fact_id`, destination and audit IDs, plus the complete supporting identity envelope (`node_id`, `edge_id`, `artifact_id`, `contract_id` (CRM Contact), `meeting_id`, `call_id`, `followup_id`, `req_id`, `verify_id`, `gate_id`, `integration_id`, `graph_id`, `workflow_contract_id`, `workflow_id`, `runbook_id`, `promotion_id`, `skill_id`, `tool_id`) on every stage/record event; monitors hashes/counts/status/tags/failure points; and supports authorized full, failed-stage, failed-record and provenance-filtered replay with immutable lineage, scope checks, RLS and idempotent destination writes. | 🟠 server-owned ledger, Data Migration monitor and local Codex EVIDENCE_ONLY bridge implemented; non-production Supabase RLS/apply probe, canonical apply, Product/Customer promotion and publish remain pending |
```

#### After row

```text
| FR-071 | Supabase data pipeline monitor and replay: the governed DuckDB/source-artifact → Supabase pipeline exposes stable definition, run, stage, step, attempt, record, batch, `doc_id`, `pic_id`, `fact_id`, destination and audit IDs, plus the complete supporting identity envelope (`node_id`, `edge_id`, `artifact_id`, `contract_id` (CRM Contact), `meeting_id`, `call_id`, `followup_id`, `req_id`, `verify_id`, `gate_id`, `integration_id`, `graph_id`, `workflow_contract_id`, `workflow_id`, `runbook_id`, `promotion_id`, `skill_id`, `tool_id`) on every stage/record event; monitors hashes/counts/status/tags/failure points; and supports authorized full, failed-stage, failed-record and provenance-filtered replay with immutable lineage, scope checks, RLS and idempotent destination writes. | 🟠 server-owned ledger, Data Migration monitor and local Codex EVIDENCE_ONLY bridge implemented; non-production Supabase RLS/apply probe, canonical apply, Product/Customer promotion and publish remain pending |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `e4440e7e47ef5408786e1e607a49f3a1e3c4b075d6e520996c9b2db674d1bcdc`.

### `ZAI:FR-277`

Canonical record: [FR-277](../../../docs/requirements/FR-277.md).

#### Before row

```text
| FR-277 | LINE grounding shadow-compare harness: a LINE OA account carries a publisher/operator-set `knowledgeGroundingShadow` flag, default false and independent of `knowledgeGrounding` itself. When true, a SERVER job's primary answer is unchanged; right after that answer's text is final, a second, best-effort, non-blocking generation runs under the account's PAIRED grounding mode (`BUSINESS_KNOWLEDGE` and `GKS_THEN_BUSINESS_KNOWLEDGE` mirror each other; `GKS_CORPUS` has no defined partner and produces no comparison) using the same resolved model and question but no MSP memory context, and records one `LineGroundingShadowComparison` row per job — evidence source and reason on each side, retrieval references, both (bounded-length) answer texts, a divergence signal, latency and outcome (`COMPLETED`, `FAILED` or `TIMED_OUT`). The shadow answer is recorded only: it is never sent to the customer, never appended to CRM or MSP thread memory, and never traced into the job's own `AgentTraceEvent` journal. A shadow failure of any kind — a thrown reader/model error, a timeout, or the comparison write itself failing — never affects the primary answer, the job's outcome or its trace; every account not explicitly switched on behaves byte-identically to before this requirement. This harness produces the comparison data for TASK-ZAI-095's owner-triggered switch of one SmartGift DIRECT account; the switch/rollback operator runbook itself is separate. | ✅ built — `LineOaAccount.knowledgeGroundingShadow`, `LineGroundingShadowComparison`, `line-grounding-shadow-compare.js`, the `CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW` account action and the fire-and-forget hook in `server-line-answer.js`; migration `20260927120000`, not applied |
```

#### After row

```text
| FR-277 | LINE grounding shadow-compare harness: a LINE OA account carries a publisher/operator-set `knowledgeGroundingShadow` flag, default false and independent of `knowledgeGrounding` itself. When true, a SERVER job's primary answer is unchanged; right after that answer's text is final, a second, best-effort, non-blocking generation runs under the account's PAIRED grounding mode (`BUSINESS_KNOWLEDGE` and `GKS_THEN_BUSINESS_KNOWLEDGE` mirror each other; `GKS_CORPUS` has no defined partner and produces no comparison) using the same resolved model and question but no MSP memory context, and records one `LineGroundingShadowComparison` row per job — evidence source and reason on each side, retrieval references, both (bounded-length) answer texts, a divergence signal, latency and outcome (`COMPLETED`, `FAILED` or `TIMED_OUT`). The shadow answer is recorded only: it is never sent to the customer, never appended to CRM or MSP thread memory, and never traced into the job's own `AgentTraceEvent` journal. A shadow failure of any kind — a thrown reader/model error, a timeout, or the comparison write itself failing — never affects the primary answer, the job's outcome or its trace; every account not explicitly switched on behaves byte-identically to before this requirement. This harness produces the comparison data for TASK-ZAI-095's owner-triggered switch of one DIRECT account; the switch/rollback operator runbook itself is separate. | ✅ built — `LineOaAccount.knowledgeGroundingShadow`, `LineGroundingShadowComparison`, `line-grounding-shadow-compare.js`, the `CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW` account action and the fire-and-forget hook in `server-line-answer.js`; migration `20260927120000`, not applied |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `9c32356b76c1e798672c3b23bc9e77e7fc755915f7ab98aa55142befc26a1944`.

### `ZAI:FR-078`

Canonical record: [FR-078](../../../docs/features/FEAT-006/requirements/FR-078.md).

#### Before row

```text
| FR-078 | Customer Profile backfill contract: the SmartGift historical customer pipeline has a fixed Tenant/Business scope, read-only source snapshot, machine-validated record/provenance envelope, explicit tax/name/corroboration resolution rules, duplicate/unresolved review queue, PII/financial/LINE exclusions, target Person/Customer schema gate, server-owned idempotent transaction and batch rollback; the first batch is applied with 3,439 Customer rows and 130 held review rows. The v0.3.0B review extension adds deterministic review IDs, redacted evidence, append-only Business-scoped decisions and a separate no-publish apply gate. | 🟢 production queue, application schema/identity projection and `CUSTOMER_DATA_REVIEWER` binding verified; hosted review-store secret remains an explicit deployment configuration |
```

#### After row

```text
| FR-078 | Customer Profile backfill contract: the historical customer pipeline has a fixed Tenant/Business scope, read-only source snapshot, machine-validated record/provenance envelope, explicit tax/name/corroboration resolution rules, duplicate/unresolved review queue, PII/financial/LINE exclusions, target Person/Customer schema gate, server-owned idempotent transaction and batch rollback; the first batch is applied with 3,439 Customer rows and 130 held review rows. The v0.3.0B review extension adds deterministic review IDs, redacted evidence, append-only Business-scoped decisions and a separate no-publish apply gate. | 🟢 production queue, application schema/identity projection and `CUSTOMER_DATA_REVIEWER` binding verified; hosted review-store secret remains an explicit deployment configuration |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `68479b32092013939d16e0bfbce4e3e2782b9333953828ef53dc9686a1e7a0d3`.

### `ZAI:FR-147`

Canonical record: [FR-147](../../../docs/features/FEAT-018/requirements/FR-147.md).

#### Before row

```text
| FR-147 | LINE binding status read contract — a read-only, Tenant/Business-scoped reader over the agent lane's `zuri_core.line_channel_binding` (`createPostgresLineBindingStatusReader`, `src/modules/agent/line-binding-status.js`) that answers one question, "is there a currently valid ACTIVE binding with this code for this Tenant and Business", and nothing else. It selects `code`, `status`, `valid_from`, `expires_at`, `rotated_at` and `version` and never a hash or credential column; runs through the same `zuri_line_smartgift_ro` read role, short transaction and forced-RLS path as the Phase 1 runtime (FR-052, SEC-010); and takes Tenant, Business and code from the caller's server-owned row (FR-146's account), never from a request. Because that role's policy exposes only ACTIVE, in-window rows of the scope it is granted for, the contract has exactly four honest labels: `ACTIVE` (a row is visible and ACTIVE), `NOT_ACTIVE` (a reader is configured and no such row is visible — pending, inactive, expired, rotated, absent and out-of-policy are indistinguishable by design), `NO_BINDING` (the account carries no binding code), and `UNKNOWN` (no reader is configured: `ZURI_LINE_BUSINESS_AGENT_ENABLED` is not `true` or `ZURI_LINE_DB_URL` is unset — the dev/test default). FR-146's account health reports the label with its source, and `effectiveStatus` reaches `LIVE` only on `ACTIVE`. The contract activates, rotates or expires nothing: ADR-020 stays the only mutation path. | 🟠 implemented locally 2026-09-05 — reader, env factory (shares the Phase 1 runtime pool and read-role wrapper) and the FR-146 default port; `tests/unit/line-binding-status.test.js`, `tests/integration/fr146-line-oa-account.test.js` AC-146.7. Not exercised against production Postgres in this slice, and the read policy is still pinned to the SmartGift Tenant/Business — widening it per Tenant is operator migration work, so other Tenants read NOT_ACTIVE until then |
```

#### After row

```text
| FR-147 | LINE binding status read contract — a read-only, Tenant/Business-scoped reader over the agent lane's `zuri_core.line_channel_binding` (`createPostgresLineBindingStatusReader`, `src/modules/agent/line-binding-status.js`) that answers one question, "is there a currently valid ACTIVE binding with this code for this Tenant and Business", and nothing else. It selects `code`, `status`, `valid_from`, `expires_at`, `rotated_at` and `version` and never a hash or credential column; runs through the same `zuri_line_smartgift_ro` read role, short transaction and forced-RLS path as the Phase 1 runtime (FR-052, SEC-010); and takes Tenant, Business and code from the caller's server-owned row (FR-146's account), never from a request. Because that role's policy exposes only ACTIVE, in-window rows of the scope it is granted for, the contract has exactly four honest labels: `ACTIVE` (a row is visible and ACTIVE), `NOT_ACTIVE` (a reader is configured and no such row is visible — pending, inactive, expired, rotated, absent and out-of-policy are indistinguishable by design), `NO_BINDING` (the account carries no binding code), and `UNKNOWN` (no reader is configured: `ZURI_LINE_BUSINESS_AGENT_ENABLED` is not `true` or `ZURI_LINE_DB_URL` is unset — the dev/test default). FR-146's account health reports the label with its source, and `effectiveStatus` reaches `LIVE` only on `ACTIVE`. The contract activates, rotates or expires nothing: ADR-020 stays the only mutation path. | 🟠 implemented locally 2026-09-05 — reader, env factory (shares the Phase 1 runtime pool and read-role wrapper) and the FR-146 default port; `tests/unit/line-binding-status.test.js`, `tests/integration/fr146-line-oa-account.test.js` AC-146.7. Not exercised against production Postgres in this slice, and the read policy is still pinned to the pilot Tenant/Business — widening it per Tenant is operator migration work, so other Tenants read NOT_ACTIVE until then |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `4ecd867177f2676c5fbfa45d12a6a6df0c9847a4f5effe26eff0a32c0927df70`.

### `ZAI:FR-235`

Canonical record: [FR-235](../../../docs/features/FEAT-038/requirements/FR-235.md).

#### Before row

```text
| FR-235 | LINE answer grounding from the published knowledge corpus: a LINE OA account carries a publisher-set `knowledgeGrounding` mode — `BUSINESS_KNOWLEDGE` (default, today's behaviour), `GKS_CORPUS` or `GKS_THEN_BUSINESS_KNOWLEDGE`. In a corpus mode a server-owned LINE job's answer reads the Business's published corpus generation through an in-process reader that implements the existing `knowledge.query` port over `queryKnowledgeCorpus` under the scoped runtime knowledge capability, within a configurable budget (2 500 ms, five results, an evidence packet of at most 8 KiB). A timeout or error is `GKS_UNAVAILABLE` and an empty result `NO_EVIDENCE`; either falls back to business knowledge only in `GKS_THEN_BUSINESS_KNOWLEDGE`, and every hop is traced as `EVIDENCE_SELECTED` with its source, reason, budget and retrieval references (citation, source, snapshot and corpus generation). No evidence from any allowed source means the deterministic reply and no model call. The first Business switched is SmartGift, after ADR-075 Phase 3 is deployed. A separate default-off GENESISRAG17_CUSTOMER_PRODUCTS descriptive path reads only enabled per-Product/per-field policies that a Business OWNER approved after previewing the exact source record and live Product binding for the current LINE OA account and constrains retrieval to their source IDs before querying. It resolves one Product from an exact approved public SKU or unique approved name, then verifies current owner authority and manifest/receipt/byte lineage for the existing PCAT projection under its current identity rules or a generic active same-Business managed FILE source admitted as one exact typed ProductMaster record by the existing SMARTGIFT_CATALOG_V1 adapter. For the generic source, `record.provenance.upstreamRecordId === liveProduct.id` and `record.externalId === record.code === liveProduct.code` must hold for the active same-Tenant/Business live Product; owner selection cannot remap a mismatch. A generic asset code or title alone grants no eligibility. The reader verifies the exact record-to-live-Product binding and projection hash. Its packet contains only owner-selected and previewed metadata values from the fixed whitelist (bound live Product SKU and base unit; ProductMaster Thai/English name, category, product family, dimensions and unit weight) and opaque fact IDs; cost, price, price tiers, discounts, stock, customer/order/provenance fields and arbitrary values are never selectable or serialized; model output is strict JSON factIds, unknown/duplicate/extra values and prose are rejected, and a fixed Thai renderer emits exact approved facts. Missing approval, ambiguity or stale proof prevents inference. Invalid model selection yields the deterministic no-evidence reply; neither case allows fixture, broad-corpus or business-knowledge fallback. It does not use memory, grant stock/price access or widen FR-291; owner policy, source and Product are revalidated before and after generation and at the durable SENDING authorization claim. Policy changes serialize with that claim and return a retryable conflict without mutation while an attempt is SENDING; after settlement/recovery withdrawal remains possible even when the source is unavailable. An already claimed network attempt cannot be recalled. Existing GKS_CORPUS and GKS_THEN_BUSINESS_KNOWLEDGE behavior is unchanged. | ✅ merged #407 2026-09-14 (main af3f7822; not deployed; TASK-ZAI-093, ADR-090 D1–D5, FEAT-038) — `LineOaAccount.knowledgeGrounding`, the in-process `knowledge.query` reader and the traced mode-gated fallback; the SmartGift switch itself is TASK-ZAI-095, blocked on ADR-075 Phase 3; the existing PCAT customer-product path is implemented, default OFF; the generic managed-file ProductMaster implementation candidate is present; hosted checks and main-dev preview acceptance pending; main-dev activation and live customer-product RAG/LINE acceptance remain pending |
```

#### After row

```text
| FR-235 | LINE answer grounding from the published knowledge corpus: a LINE OA account carries a publisher-set `knowledgeGrounding` mode — `BUSINESS_KNOWLEDGE` (default, today's behaviour), `GKS_CORPUS` or `GKS_THEN_BUSINESS_KNOWLEDGE`. In a corpus mode a server-owned LINE job's answer reads the Business's published corpus generation through an in-process reader that implements the existing `knowledge.query` port over `queryKnowledgeCorpus` under the scoped runtime knowledge capability, within a configurable budget (2 500 ms, five results, an evidence packet of at most 8 KiB). A timeout or error is `GKS_UNAVAILABLE` and an empty result `NO_EVIDENCE`; either falls back to business knowledge only in `GKS_THEN_BUSINESS_KNOWLEDGE`, and every hop is traced as `EVIDENCE_SELECTED` with its source, reason, budget and retrieval references (citation, source, snapshot and corpus generation). No evidence from any allowed source means the deterministic reply and no model call. The first Business switched is the pilot Business, after ADR-075 Phase 3 is deployed. A separate default-off GENESISRAG17_CUSTOMER_PRODUCTS descriptive path reads only enabled per-Product/per-field policies that a Business OWNER approved after previewing the exact source record and live Product binding for the current LINE OA account and constrains retrieval to their source IDs before querying. It resolves one Product from an exact approved public SKU or unique approved name, then verifies current owner authority and manifest/receipt/byte lineage for the existing PCAT projection under its current identity rules or a generic active same-Business managed FILE source admitted as one exact typed ProductMaster record by the existing SMARTGIFT_CATALOG_V1 adapter. For the generic source, `record.provenance.upstreamRecordId === liveProduct.id` and `record.externalId === record.code === liveProduct.code` must hold for the active same-Tenant/Business live Product; owner selection cannot remap a mismatch. A generic asset code or title alone grants no eligibility. The reader verifies the exact record-to-live-Product binding and projection hash. Its packet contains only owner-selected and previewed metadata values from the fixed whitelist (bound live Product SKU and base unit; ProductMaster Thai/English name, category, product family, dimensions and unit weight) and opaque fact IDs; cost, price, price tiers, discounts, stock, customer/order/provenance fields and arbitrary values are never selectable or serialized; model output is strict JSON factIds, unknown/duplicate/extra values and prose are rejected, and a fixed Thai renderer emits exact approved facts. Missing approval, ambiguity or stale proof prevents inference. Invalid model selection yields the deterministic no-evidence reply; neither case allows fixture, broad-corpus or business-knowledge fallback. It does not use memory, grant stock/price access or widen FR-291; owner policy, source and Product are revalidated before and after generation and at the durable SENDING authorization claim. Policy changes serialize with that claim and return a retryable conflict without mutation while an attempt is SENDING; after settlement/recovery withdrawal remains possible even when the source is unavailable. An already claimed network attempt cannot be recalled. Existing GKS_CORPUS and GKS_THEN_BUSINESS_KNOWLEDGE behavior is unchanged. | ✅ merged #407 2026-09-14 (main af3f7822; not deployed; TASK-ZAI-093, ADR-090 D1–D5, FEAT-038) — `LineOaAccount.knowledgeGrounding`, the in-process `knowledge.query` reader and the traced mode-gated fallback; the pilot switch itself is TASK-ZAI-095, blocked on ADR-075 Phase 3; the existing PCAT customer-product path is implemented, default OFF; the generic managed-file ProductMaster implementation candidate is present; hosted checks and main-dev preview acceptance pending; main-dev activation and live customer-product RAG/LINE acceptance remain pending |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `97454a5093b3ec7dd887ee4cb357ef4c8f06deb5db4567ddc232ed1d79303490`.

## Verification requirements

Run the document-registry write, ID-ledger, graph and view checks, and `npm run govern`, serially. These validate the document migration and its generated projections; they do not replace independent review or any production step.

---
doc_type: change-request
version: "1.0.0"
status: approved
migration_base_revision: 4ad3dd3db215d37484fdf976cb9c87a1e59a51b1
approval_scope: FR-187-withdrawal-under-ADR-119
prior_art:
  - docs/change-requests/knowledge/ki17-status-reconciliation-20261108.md (prior reviewed wrapper for FR-187)
  - docs/decisions/ADR-119-REMOVE-SMARTGIFT-AND-GOVIBE-FROM-ZURI.md
approved_by: "Astra (gpt-6-astra), delegated product owner"
---

# SmartGift FR-187 withdrawal

## Approval

Approval basis: delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08, on owner instruction 2026-11-15 relayed by the lead Claude session. This is not human approval.

The delegated decision approves the bounded FR-187 withdrawal recorded below and in [ADR-119](../../decisions/ADR-119-REMOVE-SMARTGIFT-AND-GOVIBE-FROM-ZURI.md). Document approval, requirement delivery, task state, deployment and current production state remain distinct facts.

## Scope and decision boundary

This is a v1 reviewed source-row migration from zuri-ai 4ad3dd3db215d37484fdf976cb9c87a1e59a51b1, the revision that holds the prior ASTRA-D1 wrapper for FR-187. It preserves the existing ID, FEAT-026 membership, subject anchor and projection position, and never allocates a new identity. It withdraws the SmartGift catalogue adapter requirement because SmartGift is not part of Zuri. FR-188 and FR-189 are not changed here. No code, data, migration or production state changes.

## Reviewed source-row change

### `ZAI:FR-187`

Canonical record: [FR-187](../../features/FEAT-026/requirements/FR-187.md).

#### Before row

```text
| FR-187 | A structured-record source adapter enters the 17-stage knowledge ingestion pipeline before Stage 1 for SmartGift catalog data (ADR-075 D2, proposed) — SmartGift's 5-stage ETL becomes a source producer: its prepared JSON projection plus its own SHA-256-versioned registry is the version identity the adapter authorizes, freezes and enqueues into `DPL-KNOWLEDGE-INGEST-V1`, never synthesizing any stage result (extension map, `KNOWLEDGE-INGESTION-17-STAGE-FLOW.md` "Before Stage 1" row). Classification at Stage 5 (`DPS-KI-CLASSIFY`) enforces Zero-PII with the same deny policy SmartGift already runs (`pipeline/knowledge_registry/core.py` `DENIED` regex), so a customer/contact/quotation record can never be admitted as a product occurrence. SKU / FlowAccount codes travel as an attribute of the occurrence, never as its `resolutionKey`, and resolve through the existing per-Tenant `Product.flowAccountSku` (FR-174…FR-181 / ADR-074 D5) rather than a new catalog-vault mapping (BR-002). Replaces SmartGift Stage 5's direct `vaults/vlt-catalog-product/genesis-db` write; opens no Stage 18. | deployed and accepted for the SmartGift structured-record profile — historical Linux acceptance 2026-09-16, production publication evidence 2026-09-24/28, MSP alignment evidence 2026-10-24, and native Windows acceptance 42/42 on 2026-11-08. Current production state and TASK-ZAI-050 activation closure are not verified by this migration. |
```

#### After row

```text
| FR-187 | ~~A structured-record source adapter enters the 17-stage knowledge ingestion pipeline before Stage 1 for SmartGift catalog data (ADR-075 D2, proposed) — SmartGift's 5-stage ETL becomes a source producer: its prepared JSON projection plus its own SHA-256-versioned registry is the version identity the adapter authorizes, freezes and enqueues into `DPL-KNOWLEDGE-INGEST-V1`, never synthesizing any stage result (extension map, `KNOWLEDGE-INGESTION-17-STAGE-FLOW.md` "Before Stage 1" row). Classification at Stage 5 (`DPS-KI-CLASSIFY`) enforces Zero-PII with the same deny policy SmartGift already runs (`pipeline/knowledge_registry/core.py` `DENIED` regex), so a customer/contact/quotation record can never be admitted as a product occurrence. SKU / FlowAccount codes travel as an attribute of the occurrence, never as its `resolutionKey`, and resolve through the existing per-Tenant `Product.flowAccountSku` (FR-174…FR-181 / ADR-074 D5) rather than a new catalog-vault mapping (BR-002). Replaces SmartGift Stage 5's direct `vaults/vlt-catalog-product/genesis-db` write; opens no Stage 18.~~ | Withdrawn by ADR-119 (delegated product-owner decision, Astra gpt-6-astra, under owner instruction 2026-11-08, on owner instruction 2026-11-15) — SmartGift is not part of Zuri; the id stays burnt and the historical acceptance evidence is preserved as history only |
```

SHA-256 of the exact after-row UTF-8 bytes including LF: `7b203de6caf4661ba7920eafee4c7e36cd2a8d58daad2c43c209770547cacf56`.

## Verification requirements

Run the document-registry write, ID-ledger, graph and view checks, and `npm run govern`, serially. These validate the document migration and its generated projections; they do not replace independent review or any production step.

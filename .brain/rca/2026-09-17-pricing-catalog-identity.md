---
version: "0.1.0b"
created_at: "2026-09-17T03:30:00+07:00,RWANG,uncommitted"
last_update: "2026-09-17T03:30:00+07:00,RWANG"
status: beta
attributes:
  domain: commerce
  doc_type: root-cause-analysis
---

# Computed catalog identity at the Stage 2 boundary

## Symptom

The new computed ProductMaster projection passed the strict admission schema,
but would fail Stage 2 before any publication.

## Evidence

`pricing-catalog-projection.js` assigned `externalId=commerce-sku:<product UUID>`
while `code` was the Inventory SKU code. The pinned parser's `ownCode()` in
`genesisrag17-structured-record.js` explicitly rejects ProductMaster records
whose `code` differs from `externalId`.

## Root cause

The projection combined a new source identity with an existing display code,
without satisfying the existing parser's identity equality contract.

## Why the issue escaped detection

Initial integration tests proved schema admission, immutable snapshots and
queueing only. The admission schema does not enforce the parser's semantic
identity invariant; those tests did not execute Stage 2.

## Proposed prevention and correction

Keep the separate computed namespace, set `code=externalId`, and retain the
actual Inventory SKU in the permitted product display name. Do not mislabel
it as a FlowAccount code. Extend integration coverage through the real Stage 2
renderer, then exercise both computed product and price records through the
isolated native four-process acceptance harness and receipt-backed Stage 17.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Identified admission/parser identity mismatch before deployment | uncommitted | RWANG |

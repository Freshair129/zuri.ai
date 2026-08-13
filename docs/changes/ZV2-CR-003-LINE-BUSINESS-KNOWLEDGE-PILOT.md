---
title: "ZV2-CR-003: LINE Business Knowledge Pilot"
change_id: ZV2-CR-003
status: beta
version: "0.1.2b"
created_at: "2026-08-14T02:18:06+07:00,ATHER"
last_update: "2026-08-14T03:52:31+07:00,ATHER"
attributes:
  domain: line-ai
  doc_type: change-request
  scope: Phase 1 only
---

# ZV2-CR-003 - LINE Business Knowledge Pilot

## Approved scope

Implement FR-047..050 only. The pilot receives normalized, signature-verified LINE direct-message
events, reads allow-listed SmartGift product evidence, invokes one configured provider, verifies
the answer, and returns reply text to the existing `zuri-cli` transport.

## Impact classification

| Target | Classification | Reason / required proof |
|---|---|---|
| `D:\zuri-ai\docs\PRD-SDD-v1.0.md` | MUST UPDATE | Canonical IDs and security/design boundaries |
| `D:\zuri-ai\docs\ADR-007-LINE-AI-STACK-SEQUENCING.md` | MUST UPDATE | Records bounded pilot exception without changing production order |
| `D:\zuri-ai\src\modules\knowledge` | MUST UPDATE | New business-knowledge port/adapters; preserve FR-024 graph contract |
| `D:\zuri-ai\src\modules\agent` | MUST UPDATE | Provider port and evidence-grounded read-only answer path |
| `D:\zuri-ai\src\app\api\agent\line-webhook` | MUST UPDATE | Return verified reply payload and dedupe identity; remains normalized/internal |
| `D:\workspace\zuri-cli\src\history\webhook-server.ts` | MUST UPDATE | Await stack answer behind flag and keep exactly one reply owner |
| `D:\workspace\zuri-cli\src\line-poc\client.ts` | TEST ONLY | Existing Reply API client remains transport authority |
| SmartGift `data\sot.duckdb` | READ ONLY | Export source; never mutate or copy wholesale |
| Existing CRM/identity/MSP/GKS/Genesis modules | NO IMPACT | Their contracts are preserved and not Phase 1 dependencies |
| Supabase target project | PROJECT IDENTIFIED, SECURITY GATED | Project `qcnmhyglarzcpudjorzc` is designated; ADR-018/ZV2-CR-004 isolation and migration credential gates remain |

## Rollback

Disable the stack-answer feature flag in `zuri-cli`; no LINE credential change is required. Keep
DuckDB unchanged and make any migrated Supabase projection read-disabled rather than deleting the
source data.

## Dataset approval

The owner approved the bounded Phase 1 public dataset on 2026-08-14. The approval is recorded in
`contracts/approvals/smartgift-phase1-pilot.json` and covers exactly one verified source hash. It
does not approve prices, costs, margins, customer data, invoices, or additional catalog sources.
The reconciled export contains 74 rows; Supabase deployment remains an external credential gate.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-approved Phase 1 impact and rollback boundary | working-tree | ATHER |
| 0.1.1b | 2026-08-14 | beta | Owner-approved one-source public dataset boundary; price publication remains disabled | working-tree | ATHER |
| 0.1.2b | 2026-08-14 | beta | Supabase project identified; remote mutation remains blocked by production isolation and credential gates | working-tree | ATHER |

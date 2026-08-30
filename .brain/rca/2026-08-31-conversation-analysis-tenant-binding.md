---
version: "0.1.0b"
created_at: "2026-08-31T05:44:56+07:00,ATHER"
last_update: "2026-08-31T05:44:56+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "crm"
  doc_type: "root-cause-analysis"
  scope: "FR-127 ConversationAnalysis tenant binding"
---

# RCA — ConversationAnalysis tenant binding was not correlated

This RCA belongs to the approved Business P5 C3/HIGH implementation wave for
FR-127. It is limited to tenant correlation in the new analysis writer and
tenant-bound PDPA cleanup; unrelated CRM review findings remain out of scope.

## Symptom

An owner spanning two tenants could persist an analysis for a malformed
Conversation whose `tenantId` belonged to Tenant A while its non-null
`businessId` belonged to Tenant B. PDPA erasure could also delete an analysis
from a malformed Conversation in another tenant when that Conversation pointed
at a Customer being erased in the current tenant.

## Evidence

The RED integration regressions construct both malformed rows against the real
SQLite schema. Before the fix, the writer promise resolved and erasure reported
two deleted analyses instead of one. The same suite also proves valid owner
pairs in both tenants remain writable and that the malformed rows create no
audit event or are retained after erasure.

## Root Cause

The writer used independent `tenantId IN ownedTenantIds` and `businessId IN
ownedBusinessIds` predicates. Those sets were individually valid but their
relationship was lost. Erasure selected Conversations by `customerId` alone,
so a malformed cross-tenant Conversation was included in the purge.

## Why the issue escaped detection

The first FR-127 tests covered single-tenant ownership and ordinary
cross-tenant rows, where independent sets happen to agree. No test combined one
viewer owning Businesses in both tenants or created an inconsistent
Conversation/Customer edge. The schema permits these legacy inconsistencies
because it has no composite tenant/business foreign key.

## Proposed prevention

Keep tenant/business correlation in every derived write predicate by building
`(tenantId, businessId)` pairs from the resolved Business rows. Keep erasure
lookups tenant-bound even when the Customer foreign key is inconsistent. Retain
the malformed-row integration cases as regression gates; do not broaden this
fix into a schema migration or changes to unrelated CRM readers.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-31 | beta | Initial RCA for FR-127 tenant/business correlation and tenant-bound erasure | pending | ATHER |

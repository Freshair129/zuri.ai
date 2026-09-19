---
id: ZAI:RCA-2026-09-17-ERASURE-TRANSACTION-INJECTION
title: Erasure orchestration discarded its injected database
version: "0.1.1b"
status: beta
created_at: "2026-09-17T12:30:00+07:00,RWANG,bd99651f"
last_update: "2026-09-17T12:30:00+07:00,RWANG"
attributes:
  domain: identity
  risk: HIGH
relations:
  - type: references
    target: ZAI:FR-022
  - type: references
    target: ZAI:FR-252-P1
---

# Erasure transaction injection

## Symptom

The approved PM reviewed-text erasure port must run in the same transaction
as Identity, CRM and Integration erasure. Passing a transaction to the existing
customer erasure orchestrator did not select that transaction for its writes.

## Evidence

At bd99651f, eraseCustomerPrincipal accepts injected db and uses it for Business
and Customer lookups, then calls erasePrincipal without forwarding db.
erasePrincipal unconditionally opens prisma.$transaction on its module
singleton. Existing integration tests use that singleton for every call.

## Root cause

The outer lookup dependency was injectable while the downstream transaction
owner was hard-bound to the singleton. The API shape suggested transaction
composition without implementing it. This is a source-proven cause; no
production incident or historical data corruption is inferred from it.

## Why the issue escaped detection

Tests verified data effects in the default database but did not require a
caller-owned transaction to roll back customer/PM/audit effects together.

## Proposed prevention and approved fix

Owner-approved decision26 defines injected db and internal reviewed context
for both services. Forward the dependency; open one transaction for a root
client and reuse an explicit transaction client. PM validates and applies
reviewed targets inside it. Add real rollback and injection regressions,
unchanged public request validation, stale-manifest refusal and retained
shared/immutable evidence. Preserve the concurrent CRM legal-hold behavior.

## Validation

Local isolated SQLite validation passes: seven new composition tests plus
25 existing Identity/CRM erasure and legal-hold cases (32 total). The new cases
prove injected root client use, caller-owned transaction rollback after audit,
reviewed fields only, stale refusal, pending status, exact replay and changed
replay refusal. Public request bodies still reject internal review context.
The dedicated actual PostgreSQL adapter proof additionally verifies scoped
PM erasure and restoration of transaction-local settings. No production use.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-17 | beta | Record first composed regression proof and actual PostgreSQL scope restoration | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | beta | Record dropped dependency before approved erasure integration | bd99651f | RWANG |

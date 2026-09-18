---
id: ZAI:RCA-2026-09-17-CRM-HOLD-AUDIT-ATOMICITY
title: CRM legal-hold creation can survive a failed audit
version: "0.1.5b"
status: beta
created_at: "2026-09-17T17:08:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T18:32:03+07:00,RWANG"
attributes:
  domain: crm
  risk: HIGH
  scope: SEC-034 retention and Identity erasure composition
relations:
  - type: references
    target: ZAI:SEC-034
  - type: references
    target: ZAI:ADR-093
---

# Legal-hold audit atomicity

## Symptom and evidence

The current legal-hold public route calls recordCustomerLegalHold with the
root Prisma client. The service creates CustomerLegalHold and then writes
LEGAL_HOLD_RECORDED through a separate awaited call. A source-level isolated
fault harness made the audit writer fail after creation and observed one hold
row and zero audit rows. This proves the non-atomic operation ordering; it is
not PostgreSQL isolation evidence.

Evidence: operator QA phase-b-crm-closure-proposal.md and
crm-hold-audit-orphan-harness.mjs/log, captured by an independent Luna Max
reviewer. Source hashes and exact results are retained in that proposal.

## Root cause

The service does not open a transaction around the hold and its audit when
called from the public route. An injected transaction works only when a caller
already provides one; the actual public caller does not.

## Why it escaped detection

Existing tests cover sequential successful holds, expiry and erasure. They do
not inject an audit failure on the root-client path. Separately, no controlled
hold-versus-key-delete interleaving proves the concurrency winner; that race
outcome remains unproven rather than a claimed reproduced failure.

## Proposed prevention

Keep destroyCustomerArchiveKey as the sole key-delete seam. Within the existing
SEC-034/ADR-093 behavior, make hold plus audit one transaction and use a shared
tenant-bound Customer lock before hold insertion or the final key-deletion
decision. Reuse Identity's existing transaction and make standalone expiry
calls transactional. No new schema, role, route or DTO is proposed.

The proposed source boundary is chat-evidence-archive-service.js and
chat-evidence-legal-hold-service.js plus focused integration tests; the expiry
caller may need only a minimal transaction wrapper. Verify audit-failure
rollback, unchanged sequential behavior, both PostgreSQL race winners and
full Identity rollback. Unknown provider/lock capability must refuse safely.

## Status

The owner explicitly approved phase-b-crm-closure-proposal.md v0.1.0b with
"อนุมัติแก้ CRM ตามข้อเสนอ". This closes the R5/R6 documentation approval gate
for the narrow transaction and locking changes described above. Implementation
and independent final verification are recorded below; approval is not test evidence.
Phase B production release still requires the composed retention checks.

## Composition finding

The worker's focused SQLite run passed 16 cases. Root static review then found
that the PostgreSQL lock projects only Customer.id, while the hold callback
reads lockedCustomer.tenantId for both the required hold field and audit scope.
Returning the raw lock row therefore omitted the tenant on PostgreSQL only.
The adapter must return id plus the tenantId already proven by the bound SQL
predicate. Strengthen the contract-stub assertion to check this callback scope;
actual PostgreSQL hold/delete races remain a separate required proof.

### Confirmed PostgreSQL snapshot race

The independent provider harness reproduced a second defect with the actual
recordCustomerLegalHold and destroyCustomerArchiveKey services. A supplied
Serializable transaction established its snapshot before waiting for the
Customer lock. The earlier lock holder committed a legal hold, but the waiting
transaction then returned destroyed:true with hold:null and deleted the key.
The committed hold remained. Evidence: phase-b-crm-postgres-proof.json/log,
2026-09-17T11:10:27Z; the harness uses the real service writers for both sides.

A row lock alone does not advance a Serializable snapshot when the locked
Customer row itself has not changed. The original hold writer only inserted a
child row, so the stale snapshot could still see an empty hold predicate.
Ordinary sequential and Read Committed tests cannot reveal this case.

The shared PostgreSQL protocol now self-assigns the already locked Customer.id
to itself before either callback. This creates a database row-version change
without changing any logical Customer field, UUID, domain version or timestamp.
A waiting Serializable transaction with a stale snapshot must abort instead of
entering the key-delete callback. Both writers use this same marker; SQLite
retains its existing transaction behavior. No schema, public API or automatic
retry is added. Preserve the exact predicate and prove actual provider rollback
and unchanged logical Customer values in the independent recheck.

The next actual PostgreSQL run passed all 14 cases at 11:16Z, including the
previously unsafe supplied Serializable transaction, which now rolls back on
SQLSTATE 40001. The focused SQLite/Identity/archive regression passed 53 cases.
The raw Prisma conflict still mapped to HTTP 500, however, while the approved
proposal requires a retryable infrastructure refusal. The helper now maps only
known transaction conflict codes to its existing ARCHIVE_CUSTOMER_LOCK_UNAVAILABLE
error (503, retryable true), preserving the original cause internally and the
existing public error envelope. It awaits either transaction path so commit
conflicts are covered; it never retries internally. Other failures propagate
unchanged. New tests cover the supplied stale transaction and four known
conflict forms. The independent provider proof must rerun against this final
mapping and verify that logical Customer fields remain equal.

## Verified closure

Independent Luna Max review v0.1.2b is PASS against the final service hash
E69F9BBAF24A542E477094A9288B5C1F4291110B399B45B6D5B882B274364FC6.
The final actual PostgreSQL attempt 12 passes 14/14 with frozen sources,
logical Customer-field equality, the explicit 503/retryable wrapper and
preserved SQLSTATE 40001 cause. Both lock orders, hold/audit rollback and full
Identity rollback pass with a synthetic non-bypass login. Its harness exits
nonzero on semantic failure. The final focused SQLite suite passes 21/21.
The original failing interleaving remains in attempt 06; the independent report
and exact proof hashes are retained in the operator QA packet.

This closes the approved service/transaction defect locally. Public HTTP
transport under database contention and production role/readiness checks are
not established by this synthetic provider proof. Composed build, browser and
release gates remain separate.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Record confirmed audit orphan, distinguish unproven race, propose narrow transaction closure | 052821a7 | RWANG |
| 0.1.1b | 2026-09-17 | beta | Record explicit owner approval for the narrow CRM closure; implementation evidence remains pending | 052821a7 | RWANG |
| 0.1.2b | 2026-09-17 | beta | Record SQLite closure evidence and root PostgreSQL lock projection finding; preserve verified tenant scope in callback | 052821a7 | RWANG |
| 0.1.3b | 2026-09-17 | beta | Record real-service PostgreSQL stale Serializable snapshot race and shared row-version marker correction; provider recheck remains required | 052821a7 | RWANG |
| 0.1.4b | 2026-09-17 | beta | Record 14 provider and 53 regression passes; map known serialization/deadlock/writer conflicts to the existing retryable 503 refusal without internal retries | 052821a7 | RWANG |
| 0.1.5b | 2026-09-17 | beta | Record independent final PASS, frozen-source PostgreSQL 14/14, logical Customer equality and focused SQLite 21/21 with explicit limits | 052821a7 | RWANG |

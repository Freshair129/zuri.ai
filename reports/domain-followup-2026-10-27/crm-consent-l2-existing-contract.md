---
doc_type: verification-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
source_revision: "7c628d14f69db831ddee339aaf392306cddd62d4"
---

# CRM L2: consent is re-read at the blanking transaction

The existing L2 case in `tests/integration/crm-retention-consent.test.js`
passed **1/1 on its first selected run**, in **7.54 seconds**. The other
**23 cases were unselected/skipped**, not passed. It used a separate fresh
fixture after the [M4 receipt](crm-archive-m4-existing-contract.md) was committed.
Source was clean at the revision above; application code remains identical to
Compact baseline `4061f511`.

This is bounded existing behavior under [ZAI:FR-230 v1](../../docs/features/FEAT-037/requirements/FR-230.md),
[FR-245 v1](../../docs/features/FEAT-041/requirements/FR-245.md),
[SEC-034](../../docs/requirements/SEC-034.md), SDD-103 and accepted ADR-093 v1.2.1.
It changes no consent, retention, erasure or legal-hold policy or canonical phase.

```text
node scripts/assert-tests-ran.mjs vitest run --config <private-qa>/vitest.case.config.mjs
# private config: testNamePattern L2:
```

[Sanitized observation](crm-consent-l2-observation.json) records the source,
executed-harness hashes, actual counts and isolation postconditions. The test
body/assertions were unchanged; a pinned transform alters only the `beforeEach`
archive-directory allocation to this run's private root outside `os.tmpdir()`.

## Actual transaction-boundary assertions

The synthetic fixture erases one customer's key before the sweep and selects
the orphaned staff line as a candidate. A Prisma proxy revokes the other
customer's retention consent **after that candidate pre-read and immediately
before opening the blanking transaction**. The service must then read current
consent inside that transaction, instead of trusting the earlier candidate read.

The unchanged case asserts the staff body is the retention tombstone, the result
has **`blankedMessages: 1`, `deferredMessages: 0`**, and the staff line is not
recoverable from the archive. Post-run read-only metadata independently confirms
one OUTBOUND fixture row, one retention-tombstoned OUTBOUND row and one revoked
consent row. OUTBOUND here is a synthetic stored staff note, not message delivery.

This is a deterministic injected ordering on SQLite, **not a parallel two-session
race or native PostgreSQL concurrency proof**. There were **0 archive manifests,
0 archive keys and 0 archive files** in this cohort; it does not establish
encrypted-file creation/retrieval or archive-expiry acceptance.

## Isolation and limits

The harness exclusively created an empty SQLite DB and used a byte-verified
20-file private generated client copy. Default global setup, stale-file cleanup
and client generation were not invoked. Both shared client schema hashes stayed
unchanged. Login credentials/Sessions, Memberships, WorkspaceMemberships,
platform grants, provider secrets and MFA factors remained absent. The stored
`ConversationSession` is synthetic CRM data, not an authentication Session.

Real KEK selectors were absent, `NODE_ENV=test`, and the checked keyring mode
was the fixed test-only `v0`; no archive key row was needed in this scenario.
The single owned archive root and DB remain retained. Guards observed **0 file
deletes/appends, 0 blocked file/create operations, 0 fetch attempts**, and five
instrumented Node records showed **0 refused network/env-read attempts**.
The owned Windows Job exited with **0 active processes and 0 stragglers**.

No app/DB server, scheduler, sender, LINE/MSP call, real key, main-dev, UAT or
production operation ran. This does not qualify production invocation, physical
mount/offline copy, ten-year retention, full FR-245 adoption, device MFA or
host-wide syscall/network capture. No product, route, schema or assertion changed.

Independent GPT-6 Luna Max review cleared the separate fixture before execution
and verified the retained results, hashes, metadata and bounded scope afterward.
The public observation explicitly includes `MfaFactor: 0` from the retained DB
metadata. `npm run govern` passed (0 critical, 0 warning, 43 information items;
553 canonical records and 96 document views).

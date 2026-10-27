---
doc_type: verification-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
source_revision: "62728e733faff5387d228bedc3745d6147232454"
---

# CRM M4: broken archive chain refuses erasure

The existing M4 case in `tests/integration/crm-retention-consent.test.js`
passed **1/1 on its first selected run**, in **8.30 seconds**. The other
**23 cases were unselected/skipped**, not passed. Source was clean at the
revision above; application code is unchanged from `4061f511`.

This is bounded evidence for [ZAI:FR-230 v1](../../docs/features/FEAT-037/requirements/FR-230.md),
[ZAI:FR-245 v1](../../docs/features/FEAT-041/requirements/FR-245.md),
[SEC-034](../../docs/requirements/SEC-034.md), SDD-103 and accepted ADR-093 v1.2.1.
It changes no retention/legal-hold default, counsel decision or canonical phase.

```text
node scripts/assert-tests-ran.mjs vitest run --config <private-qa>/vitest.case.config.mjs
# private config: testNamePattern M4:
```

[Sanitized observation](crm-archive-m4-observation.json) records the executed
source/harness hashes, actual counts and postconditions. The original case
body and assertions were unchanged. A pinned transform changes only the
`beforeEach` archive-directory allocation to this run's new private fixture,
outside `os.tmpdir()`, so the original broad temp-directory teardown does not run.

## Actual failure-path assertions

The fixture first archives synthetic conversation records and records the
existing hold/consent scenario. It then appends to **one newly created archive
file**, under the single owned fixture, to deliberately break that chain.

- Erasure refuses with `ERASURE_BLOCKED_ARCHIVE_CHAIN_INVALID`, status 409,
  and the injected alert callback receives the expected critical code.
- The affected Customer remains undeleted and its archive key remains present;
  no legal-hold archive key was created by the refused erasure.
- The first refusal persists an `ERASURE_BLOCKED` audit and durable error event
  outside the rolled-back erasure transaction.
- A second refusal within the same case leaves **2 blocked-erasure audits**,
  **1 deduplicated error event**, and **occurrenceCount 2**. These expected
  refusal/retry assertions are one passing test, not two passing tests.

There was no external alert or message delivery. The alert callback and durable
events are test-local evidence, not operator notification acceptance.

## Isolation and limits

The harness exclusively created an empty SQLite DB from retained current-schema
DDL and used a byte-verified, 20-file private generated client copy. It invoked
neither default global setup nor client generation. Both shared SQLite/PostgreSQL
client schema hashes remained unchanged. Credentials/login Sessions, Memberships,
WorkspaceMemberships, platform grants and integration secret rows stayed empty.
One known nonfunctional MFA placeholder fixture was used; this is not HTTP,
session extraction or MFA-device evidence.

Real archive/secret KEK selectors were absent, `NODE_ENV=test`, with only `v0`
archive-key labels observed. File guards allowed the single scoped append,
observed **0 deletes, 0 blocked file/create operations and 0 fetch attempts**.
Five instrumented Node guard records had **0 refused network/env-read attempts**.
The bounded owned Windows Job exited with **0 active processes and 0 stragglers**.
The DB, intentionally corrupted new archive file and all QA evidence remain
private and retained. No original archive, backup or other environment was touched.

This does not qualify native PostgreSQL, a production scheduler/invocation,
production disk/mount, off-host/offline copies, ten-year retention, real keys,
LINE/MSP acknowledgements, full FR-245 adoption or host-wide syscall capture.
The next selected L2 case has a separate fresh fixture; it has not run in this
receipt. No product, route, policy, schema or test assertion changed.

Independent GPT-6 Luna Max harness review cleared the bounded run beforehand;
final evidence review verified source/harness hashes, retained results, archive
hash/size and public/private metadata equality with no findings.
`npm run govern` passed (0 critical, 0 warning, 43 information items;
553 canonical records and 96 document views).

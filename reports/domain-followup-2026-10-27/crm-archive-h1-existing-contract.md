---
doc_type: verification-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
source_revision: "3041e62175f7ea1084628d03d7ea7099ddb4e072"
---

# Existing CRM archive H1 contract: isolated expiry/hold check

The selected existing **H1 passed 1/1 on its first attempt** in 8.19 seconds.
The other **23 cases were unselected/skipped**, not passed. The test checkout
was clean at the source revision above; application code remains identical to
Compact baseline `4061f511`. No product, API, permission, schema, test-source or
shared-harness edit was made. This follows the separate [FR-195 evidence](access-invite-existing-contract.md).

Applicable sources are canonical [ZAI:FEAT-037 / FR-230 v1](../../docs/features/FEAT-037/requirements/FR-230.md),
[ZAI:FEAT-041 / FR-245 v1](../../docs/features/FEAT-041/requirements/FR-245.md),
SEC-034 / SDD-103 and accepted [ADR-093 v1.2.1](../../docs/decisions/ADR-093-SWEPT-CHAT-CONTENT-MOVES-TO-AN-ENCRYPTED-LOCAL-COLD-ARCHIVE.md).
This execution does not amend their defaults, pending counsel questions,
canonical phase/lifecycle or production invocation contract.

## Actual scope and result

```text
npm test -- --config <private-qa>/vitest.h1.config.mjs tests/integration/crm-retention-consent.test.js
# private config selects testNamePattern: H1:
```

The normal zero-test wrapper confirmed one executed test. [Observation](crm-archive-h1-observation.json)
records actual counts, source/harness hashes and isolation results. The original
[H1 body](../../apps/server/tests/integration/crm-retention-consent.test.js) was
unchanged. Real service code, SQLite transactions, encryption/decryption and
archive file/hash/chain checks ran against synthetic data.

| H1 phase | Observed assertion |
|---|---|
| Hold still active | Expiry destroys no hold key |
| First hold ended | Exactly that hold's key is destroyed; the re-seal file is not selected for deletion; hold-key count becomes zero at that phase |
| Read/chain after expiry | A's held lines are no longer recoverable; the full manifest/file chain remains valid |
| Repeated expiry | The run is not incorrectly skipped |
| Later hold and re-seal | A new held/consenting B can retain C's evidence under the new legal-hold key; retrieval chain remains valid |

Final state contains one new legal-hold key from the later phase; this does not
contradict the earlier zero-key assertion. No 10-year age/file-destruction or
whole retention suite result is inferred from this single lapsed-hold case.

## Isolation without destructive teardown

The private config replaces the sweeping standard SQLite global setup with a
new, exclusively reserved empty database. It preserves the installed client's
fingerprint gate, compares formatted private schema copies, and never generates
or overwrites a shared client. PostgreSQL aliases are removed before app imports.
Both shared client schema byte hashes stayed unchanged.

A source-pinned Vite hook changes only the existing `beforeEach` archive-allocation
line to an exclusive private parent outside `os.tmpdir()`. The original teardown
therefore does not remove it. The integrator compared the actual transformed
source byte-for-byte to the original plus that one replacement; the H1 body is
also compared with the pinned physical source before and after transformation.
No test assertion, source file or service behavior was changed.

The worker records the real path of exactly one fixture created this run.
Instrumented `rm`/`unlink` refuse recursive, sibling, symlink, non-regular or
out-of-fixture targets and verify the physical parent before allowing an action.
A second/unowned fixture allocation is refused. Review corrected an initial
broader-parent guard before execution. The actual run observed **0 blocked
creates, 0 blocked deletes, 0 instrumented file-delete attempts and 0 fetch
attempts**. Four new encrypted archive files, the private DB and all QA evidence
remain retained. This is not a complete host syscall/network capture claim.

Real archive/Integration KEK selectors were removed in the test worker, with
`NODE_ENV=test`. The initial keyring and a post-run read of retained archive-key
version labels both confirm `v0` test mode; no operational key was configured or
exported. Existing H1 setup uses two known nonfunctional MFA placeholder rows
and in-memory session objects, not real account enrollment or HTTP step-up.
Credential/login-Session/PlatformGrant/Membership/RoleBinding/API-key rows stayed
empty. `ConversationSession` is synthetic CRM record data, not a login Session.

The H1 scenario's principal erasure and hold-key destruction affect only newly
created test rows. Synthetic incoming and OUTBOUND staff-note records are not
LINE delivery. Source composition records pending memory erasure in the fixture
DB without calling MSP; no sender, scheduler, app server, database server or live
provider was started by this harness.

## Limits and closeout

This is SQLite/direct-service evidence for the selected existing H1 only. It
does not prove HTTP/session/MFA-device behavior, native PostgreSQL races/runtime
roles, production scheduling, production archive mounts, separate physical disk,
off-host copies, MSP acknowledgements or live LINE. FR-230's other domains and
external memory copies remain separately owned. Production expiry wiring and
its invocation contract were not selected or changed. No campaign work started.

The private harness and its single-current-fixture correction received
independent GPT-6 Luna Max review before execution. The reviewer did not run
tests. Final independent GPT-6 Luna Max review compared the public observation,
retained logs, source/harness hashes and private isolation metadata and found no
remaining issue. `npm run govern` passed (0 critical, 0 warning, 43 information
items; 553 registry records and 96 document views); `git diff --check` passed.
No canonical lifecycle promotion, deployment or publication is implied.

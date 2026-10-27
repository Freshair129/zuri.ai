---
doc_type: verification-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
source_revision: "8462109f6923de67f5c4bba99d219bc04a4cdf73"
---

# Existing AccessInvite contract: isolated service integration

The unchanged six-case FR-195 integration suite passed **6/6, zero failures and
zero skips** in 27.53 seconds at the source revision above. This closes the
selected bounded TEST follow-up from the read-only domain ledger. No product,
API, permission, schema, test-source or shared-harness change was made. The
Compact code/artifact baseline remains `4061f511`; its separate closeout is
[Task7](../compact-selfhost-2026-10-27/task7-core-matrix.md).

Authority is the Identity [charter](../../docs/domains/identity/CHARTER.md) and
canonical [ZAI:FEAT-029 v1](../../docs/features/FEAT-029/feature.md) /
[ZAI:FR-195 v1](../../docs/features/FEAT-029/requirements/FR-195.md), with their
existing ADR-077 D8 / ADR-079 / SEC-014 / BR-016 contracts. No new product or
security decision was introduced, and canonical rows/membership/lifecycle remain
unchanged. The parent selected only the first existing-contract TEST item; CRM
H1 and other domain implementation were not started.

## What actually ran

```text
npm test -- --config <private-qa>/vitest.fr195.config.mjs tests/integration/fr195-access-invite.test.js
```

The repository's zero-test wrapper executed the exact existing
[suite](../../apps/server/tests/integration/fr195-access-invite.test.js).
[Sanitized observation](access-invite-observation.json) records source/test,
canonical-record and private-harness hashes. Private raw logs, schemas, config,
guards and the owned SQLite DB remain retained locally, not in this repository.
This is a private isolated invocation, not an unrun normal/hosted-profile claim.

| Existing case | Observed acceptance |
|---|---|
| TENANT mint | Owner path succeeds; requested OWNER role refuses 400 and non-owner scope refuses 404 |
| TENANT acceptance | Membership binds to supplied accepting person, not account holding invited email; invite/member audit events checked |
| BUSINESS acceptance | Scoped MEMBER row created; unrecognized domain key filtered |
| Generic refusal | Unknown, expired, revoked and wrong-target tokens give the same service refusal; repeat revoke refuses |
| Decline | Targeted decline persists and later acceptance refuses |
| PORTFOLIO compatibility | Existing WorkspaceMembership delegation remains functional |

These are service calls using canonical viewer factories. They do not exercise
HTTP auth/session extraction, UI, live invite handover, PostgreSQL custody/races,
all-scope role combinations, or full FEAT-029 segregation/operator lifecycle.
No one-use/concurrency result beyond the six actual cases is inferred from a
source comment. No external invite/email/LINE sender or application server was
started by this test invocation.

## Isolation and retained first failure

The normal SQLite setup sweeps old test databases. To honor the no-destructive-
action boundary, this invocation replaced it only in the private config. It
created one exclusively reserved DB under the private QA directory, with all
application tables initially empty; it ran no stale sweep and deletes nothing.
The private file URL is injected before test-source imports, ambient PostgreSQL
aliases are removed, and fetch is disabled as a guard. Source inspection found
only direct DB operations in the selected service/audit call tree; this is not a
claim that all network packets were independently captured.

The installed shared client's recorded schema fingerprint must already match;
the harness refuses mismatch and never generates/replaces a client. Its first
preflight also compared raw generated-schema text, which failed before DDL/DB
creation because Prisma's generated copy uses different alignment. **No tests
ran in that failed attempt.** The original log is retained. Independent review
accepted a correction that formats exclusive private copies of both schemas and
compares normalized formatted hashes before DDL/DB creation. The fingerprint gate
and byte hashes of the actual shared clients remain unchanged.

The subsequent actual test run passed. Teardown derives its status from actual
protected-table counts and before/after client hashes; it records FAIL before
raising if any protected row exists or a client changes. Credential/session/
PlatformGrant tables stayed empty. Four synthetic Persons, eight AccessInvites,
two Memberships and one WorkspaceMembership remain only in the owned retained
fixture DB. No login credential was created and no existing application access
data was selected or modified. Neither real credentials nor fixture raw invite
tokens are included in public evidence.

Independent GPT-6 Luna Max review inspected the private harness, selected source
call tree and corrective changes. It did not run tests. Final documentation and
observation reconciliation is recorded at closeout; this evidence does not grant
production, publication or a broader implementation selection.

Closeout: independent report/observation/hash review is complete, and the dated
report is linked from `reports/README.md`. Final governance after that index edit
passed with 0 critical / 0 warning / 43 info (553 records, 96 views). This is an
evidence-only commit; no application or canonical record was changed.

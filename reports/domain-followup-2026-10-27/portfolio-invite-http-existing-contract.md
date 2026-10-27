---
doc_type: verification-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
source_revision: "764b480de6429e84fb9f0f4f2a10922ca64829b2"
---

# Portfolio invite: actual HTTP session binding

One bounded HTTP regression scenario passed **1/1, 0 failed, 0 skipped**, using
**11 sequential loopback POST requests** at the clean source revision above.
The scenario took **12.343 seconds**; the Node report's total elapsed time,
including shutdown/waits, was **42.073 seconds**. The initial outer launcher
failed on a report-format assertion after the test and both jobs had exited
successfully. That failure is retained and was reconciled from the original
report without rerunning the test or sending another HTTP request.

This adds transport evidence for [ZAI:FR-067 v1](../../docs/requirements/FR-067.md),
SEC-014 and BR-016, using the existing Portfolio case of the shared
[FR-195 AccessInvite model](../../docs/features/FEAT-029/requirements/FR-195.md).
It does not add or qualify Tenant/Business invitation endpoints. Product,
route, schema and permission code remained unchanged from `4061f511`.

## Selected boundary and observed responses

The private harness derives the case from existing workspace-onboarding service
and route tests. Its own new Node regression calls only `/api/auth/login`,
`/api/workspace-invites` and `/api/workspace-invites/accept` through the real Next
handler. Login, cookie/session resolution, request viewer and invite services
are unmodified; no viewer mock or authentication bypass is used.

| Selected step | Actual assertion |
|---|---|
| Two synthetic logins | 200/200; HttpOnly session cookies issued; persisted Sessions map to the two fixture principals |
| Anonymous mint | 401 |
| Owner-role invite request | 400 |
| Non-owner mint | 404; refused mint attempts leave no invite row |
| Authorized owner mint | 200; one Portfolio-scoped pending invite, SHA-256 token hash only |
| Anonymous acceptance | 401 |
| Wrong session (owner holding the invitee's token) | 400, generic `INVALID_OR_EXPIRED_INVITE` |
| Body-supplied person claim | 400; refused accepts neither grant membership nor burn the pending token |
| Actual invitee session acceptance | 200; ACTIVE MEMBER WorkspaceMembership and acceptedByPersonId bind to that session's principal |
| Replay | 400, same generic refusal; only one acceptance audit and one new invitee membership |

The seeded owner membership keeps its role/status/version. No Tenant, Business,
operating Workspace, Project, Business Membership, platform grant, role binding,
API key or provider secret row appears. This does not prove access behavior
against an existing Business in another cohort; those entities are absent here.

```text
node --test --test-concurrency=1 <private-qa>/portfolio-invite.test.cjs
```

[Sanitized observation](portfolio-invite-http-observation.json) records source
and executed-harness hashes, request statuses, checks and post-run counts.
The private fixture started with an exclusively created empty SQLite DB and a
verified 20-file private generated client. It seeded two completed synthetic
profiles/credentials, one Portfolio and one owner WorkspaceMembership. Fixture
hashing uses the application's pure `hashPassword` source compiled in memory;
only its unused DB import is stubbed during that fixture preparation, not in
the server's login/session path. Passwords, cookies and the raw invite token stay
in memory and out of test logs. Neither raw invite token nor its digest appears
in audit events; only the invite digest is stored on the AccessInvite row.

## Retention, cleanup and report reconciliation

The retained test DB has **2 synthetic credentials, 2 login Sessions,
2 WorkspaceMemberships** (one seeded owner and one accepted invitee), one accepted
Portfolio invite and no real or platform access expansion. Both server and test
jobs exited normally with **0 active processes, 0 stragglers and no timeout**.
Four instrumented Node guard records report **0 refused network/env-read
attempts**. Both shared Prisma client schema hashes stayed unchanged. The
private DB, logs and all QA evidence remain retained, with the server stopped.

The file named `http-first.tap` actually contains Node 24's **spec reporter**.
The original launcher's TAP-prefix parser therefore exited 1 despite the Node
scenario reporting 1 pass and its job exiting 0. The executed launcher/hash
snapshot and that failure log were preserved. A separate post-run parser checked
the retained report's tests/pass/fail/skip/cancel/todo totals, job/guard results
and hashes, then recorded the reconciled receipt. No test/request was replayed;
this is a report-format correction, not a hidden product retry or assertion edit.

This is SQLite/native HTTP proof for a targeted Portfolio invite only. Expiry,
revocation HTTP paths, parallel acceptance races, native PostgreSQL, browser UI,
broader IAM lifecycle, Tenant/Business invitations and full FR-067/FR-195 adoption
remain outside it. No sender, provider, main-dev/UAT, production, migration,
release or host-wide syscall/network qualification is implied.

Independent GPT-6 Luna Max review cleared the bounded harness before execution
and verified the retained report reconciliation, source/harness/client hashes,
public/private observation equality, fixture metadata and scope with no findings.
`npm run govern` passed (0 critical, 0 warning, 43 information items;
553 canonical records and 96 document views).

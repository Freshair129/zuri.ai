# TASK-ZAI-001 closeout evidence and production-tail runbook

Version: 0.1.0b  
Date: 2026-09-20  
Status: REVIEW — implementation is merged; production acceptance remains open  
Task owner: ATHER  
Approver: Owen  
Executor: Codex

## Scope and evidence boundary

This report is limited to `TASK-ZAI-001`, “Close the production request-session
and credential boundary”. It records repository and pull-request evidence and
prepares the remaining owner-run production gates. It does not deploy, rotate a
secret, apply a migration, use a production credential, or change another task.

The isolated closeout branch starts from `origin/main` at
`01a6712b422d73e1892b647953729d8da7f410cb`. The shared primary checkout was not
used for changes because it contains unrelated dirty report files and its local
`main` is behind the remote branch.

## Current SOT and DoD

The canonical ledger in `docs/roadmap/ROADMAP.md` records:

| Field | Current value | Evidence |
|---|---|---|
| Status | `review` | canonical TASK-ZAI-001 row |
| Proof scope | `UNKNOWN` | canonical TASK-ZAI-001 row |
| Implementation state | `IN_PROGRESS` | canonical TASK-ZAI-001 row |
| Task container | `TC-TASK-ZAI-001`, version `0.2.0` | `docs/roadmap/ROADMAP-zuri-ai-24w-program.md` |
| Acceptance criterion | unchecked | request without trusted session must refuse before the service runs |
| Success criterion | checked | FR-090 password-reset token is single-use and expires |
| Exit criterion | unchecked | `fr046-entry-contract.spec.js` unauthenticated negative case under `npm run test:e2e` |

The checked success criterion is repository/test evidence. It is not evidence
that the production request-session boundary is accepted. The unchecked
acceptance and exit criteria remain intentionally unchanged.

## Implementation evidence already on main

The approved implementation is not an unstarted coding task. The relevant
merged pull requests are:

| PR | Merge commit | Delivered evidence |
|---|---|---|
| [#100](https://github.com/Freshair129/zuri.ai/pull/100) | `0f636e61c040769a331120e9f1a4041151288680` | Canonical Issue #99 IAM boundary, persisted sessions, shared authorization and negative tests |
| [#346](https://github.com/Freshair129/zuri.ai/pull/346) | `315a5d9759cc40c5a0e50acb022393e805bcbe7b` | FR-097 verified LINE channel onboarding and identity binding |
| [#347](https://github.com/Freshair129/zuri.ai/pull/347) | `e829b80e487ef275d6fa2fa6088688d9b2b08416` | TOTP MFA and session-assurance step-up |
| [#462](https://github.com/Freshair129/zuri.ai/pull/462) | `a627d9013e39d3e832b426b724099124f864a395` | WebAuthn/FIDO2 authentication readiness |

The implementation and test inventory includes the identity resolver/session
seam, shared authorization context, agent/tool authorizer, channel identity
integration and the session-assurance/password-reset/WebAuthn suites. Examples
are:

- `apps/server/src/modules/identity/resolve-viewer.js`
- `apps/server/src/modules/identity/session-port.js`
- `apps/server/src/modules/identity/authorization-context.js`
- `apps/server/src/modules/identity/agent-tool-authorizer.js`
- `apps/server/tests/integration/iam-authorization.test.js`
- `apps/server/tests/integration/fr097-line-channel-onboarding.test.js`
- `apps/server/tests/unit/iam-session.test.js`
- `apps/server/tests/unit/identity/agent-tool-authorizer.test.js`
- `apps/server/tests/unit/identity/session-assurance.test.js`
- `apps/server/tests/unit/identity/webauthn.test.js`

This is merged repository evidence only. It does not prove that the deployed
production artifact, database schema, runtime role, provider binding and live
data all match this commit.

## Existing production evidence and open gates

`docs/roadmap/PLAN-FR-094-PRODUCTION-IAM.md` records W7/W8 runtime-role and
negative-auth-canary evidence from 2026-08-23. The same plan explicitly leaves
the authenticated session canary open. This closeout treats that record as
historical evidence requiring freshness verification, not as a current claim
that `main` is deployed or production-accepted.

| Gate | State in this closeout | Required owner evidence |
|---|---|---|
| Code and local contract tests | `MERGED` | exact merged commits and repository test results |
| Runtime database role/RLS proof | `RECORDED; REFRESH_REQUIRED` | read-only catalog proof for the deployed artifact and `zuri_web_login` path |
| Authenticated session canary | `NOT_RUN` | owner-controlled production login, protected read, logout/revocation and next-request denial |
| Membership/cross-tenant isolation canary | `NOT_RUN` | two-scope denial proof with no payload or audit leakage |
| Provider/channel onboarding proof | `NOT_RUN` | signed transport origin, pending unlinked subject, server-owned link and active Membership |
| Agent/tool/MSP side-effect denial | `NOT_RUN` | forged scope/vault inputs denied before retrieval or side effects, with redacted audit evidence |
| Production deployment/activation | `NOT_RUN` | explicit owner release gate and deployment receipt; not performed by this branch |

## Owner-run production-tail runbook

Run these gates against the exact release candidate and record sanitized
receipts outside the repository. Do not place passwords, cookies, raw bearer
tokens, connection URLs, LINE secrets, reply tokens or customer content in a
report, PR, log or chat.

1. **Freeze the candidate.** Record the deployed image/artifact digest, source
   SHA, compose overlays, environment fingerprint and rollback artifact. Confirm
   that the candidate is the reviewed `main` composition; do not infer this from
   a branch name.
2. **Prove the runtime database boundary read-only.** In a controlled deploy
   session, verify the runtime identity is the non-privileged login role, the
   IAM tables are reachable through the intended grants, forced RLS remains in
   force, and the role has no migration/DDL privilege. Keep the SQL receipt
   redacted and separate from application logs.
3. **Run the authenticated session canary.** With an owner-approved test
   account supplied out-of-band: log in, confirm only a signed HttpOnly session
   is returned, read the protected entry/scope surface, revoke or log out,
   retry the protected request and record the expected denial. Confirm that no
   credential or token is echoed in the response, log or audit payload.
4. **Run lifecycle and scope denial probes.** Suspend or revoke the test
   Membership/session, retry immediately, and attempt a cross-tenant/business
   resource identifier. The request must deny before protected retrieval and
   must not reveal unrelated labels, counts or customer data.
5. **Run the channel boundary probe.** Verify a valid LINE signature proves
   transport origin only; an unknown channel subject remains pending and cannot
   read private data. Complete the server-owned link/onboarding path, then prove
   that only an active Membership authorizes the private turn.
6. **Run the agent/tool boundary probe.** Supply forged tenant, business,
   principal, role and vault-looking arguments through the public test seam.
   The immutable server authorization context must win, denial must occur before
   the handler/model/MSP side effect, and the audit record must be redacted.
7. **Owner review and SOT transition.** Owen/ATHER review the sanitized
   receipts against the checklist. Only after all required gates pass may the
   task container acceptance/exit flags and canonical proof scope be updated.
   Until then keep `review / UNKNOWN / IN_PROGRESS`; do not mark the task done.

### Rollback boundary

No rollback or deployment is performed by this PR. If a live canary fails, use
the deployment system to restore the previously verified connection secret and
application artifact, preserve additive schema/role evidence for inspection,
and do not return the application to a privileged runtime role without a named
incident gate. A schema rollback requires an inspected migration and backup; it
is not an automatic step.

## Verification run — 2026-09-20

These checks were run in the isolated `codex/task-zai-001-closeout` worktree
from `origin/main` at `01a6712b422d73e1892b647953729d8da7f410cb`:

- `node apps/server/scripts/programme-containers.mjs --check` — PASS; 119
  containers, modules in step.
- `npm run govern` — PASS; exit 0, 0 critical, 22 warnings and 31 info.
- Focused Vitest IAM/roadmap suite — PASS; 10 files, 56 tests.
- `npm --prefix apps/server run test:e2e -- tests/e2e/fr046-entry-contract.spec.js --project=e2e --no-deps` — PASS; 1 test, 41.2s. The `--no-deps` flag skips the unrelated warmup dependency for this bounded contract check.
- `npm run build` — PASS; Next.js production build compiled, type-checked and
  generated 99 static pages.
- `git diff --check` — PASS.

These are repository/local checks only. The E2E result proves the local seeded
contract path and does not convert the open production authenticated-session,
membership, provider/channel, agent/tool, runtime-role or owner-acceptance
gates into production evidence.

## Closeout decision

The implementation portion is complete on the merged repository history. This
PR closes the documentation/evidence preparation portion only. TASK-ZAI-001
remains open for production proof and owner acceptance; no deployment or
production readiness claim is made.

Version diff: new `0.1.0b` closeout report; no requirement ids, code contracts,
DoD flags or production state were changed.

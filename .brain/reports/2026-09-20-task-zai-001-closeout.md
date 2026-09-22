# TASK-ZAI-001 closeout evidence and production-tail runbook

Version: 0.3.0b
Date: 2026-09-20  
Status: BLOCKED — production activation/boundary evidence exists, but the authenticated memory canary is blocked by the dedicated DB role credential
Task owner: ATHER  
Approver: Owen  
Executor: Codex

## Scope and evidence boundary

This report is limited to `TASK-ZAI-001`, “Close the production request-session
and credential boundary”. It records repository evidence and a controlled
production activation attempt for the MSP memory boundary. It does not rotate
or reset a secret, apply a migration, use a customer credential, or change
another task. The live activation attempt is not a task-acceptance claim.

The isolated closeout branch starts from the deployed baseline
`5c5f12d3729a077ac7bdc5928b400af548a6cf7f`. The shared primary checkout was not
used for branch changes because it contains unrelated dirty files.

## Current SOT and DoD

The canonical ledger in `docs/roadmap/ROADMAP.md` records:

| Field | Current value | Evidence |
|---|---|---|
| Status | `blocked` | canonical TASK-ZAI-001 row; dedicated DB role credential blocks the authenticated memory canary |
| Proof scope | `PRODUCTION` | live activation/boundary evidence only; full acceptance is not proven |
| Implementation state | `BLOCKED` | deployed candidate and live configuration exist; end-to-end canary cannot execute |
| Task container | `TC-TASK-ZAI-001`, version `0.3.0` | `docs/roadmap/ROADMAP-zuri-ai-24w-program.md` |
| Acceptance criterion | unchecked | request without trusted session must refuse before the service runs |
| Success criterion | checked | FR-090 password-reset token is single-use and expires |
| Exit criterion | unchecked | `fr046-entry-contract.spec.js` unauthenticated negative case under `npm run test:e2e` |

The checked success criterion is repository/test evidence. The live production
activation and direct MSP boundary are additional scoped evidence, not evidence
that the task acceptance or exit criterion is complete. The unchecked
acceptance and exit criteria remain intentionally unchanged.

## Existing implementation evidence

The approved FEAT-010 implementation is not an unstarted coding task. The
relevant merged pull requests are:

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

## Bounded implementation changes on this branch

The branch is limited to the production boundary defects found during the
controlled tail run:

- apply the server-owned effective channel key consistently when a legacy LINE
  account has no `bindingCode`;
- forward the pinned MSP private-grant/HMAC controls through the explicit child
  environment allowlist; and
- pass the configured MSP `agentId` and `workspaceId` from the server LINE
  runtime into the thread-memory port.

The null-binding-code Project/Work regression, transport allowlist regression
and runtime composition regression are included in the focused test set. The
existing Session-store fail-closed implementation is already present in the
deployed baseline; this branch does not reopen that unrelated patch.

## Existing production evidence and open gates

`docs/roadmap/PLAN-FR-094-PRODUCTION-IAM.md` records W7/W8 runtime-role and
negative-auth-canary evidence from 2026-08-23. The same plan explicitly leaves
the authenticated session canary open. This closeout treats that record as
historical evidence requiring freshness verification, not as a current claim
that `main` is deployed or production-accepted.

| Gate | State in this closeout | Required owner evidence |
|---|---|---|
| Existing identity code and local contract tests | `MERGED` | exact merged commits and repository test results |
| Missing production Session-store fail-closed patch | `PATCH_READY` | branch diff, RCA and 15 focused tests; merge still required |
| Runtime database role/RLS proof | `RECORDED; REFRESH_REQUIRED` | read-only catalog proof for the deployed artifact and `zuri_web_login` path |
| Authenticated session canary | `NOT_RUN` | owner-controlled production login, protected read, logout/revocation and next-request denial |
| Membership/cross-tenant isolation canary | `NOT_RUN` | two-scope denial proof with no payload or audit leakage |
| Provider/channel onboarding proof | `NOT_RUN` | signed transport origin, pending unlinked subject, server-owned link and active Membership |
| Agent/tool/MSP side-effect denial | `PARTIAL` | effective channel-key tool boundary, direct MSP resolve/context, and forged-principal denial passed; full app memory side-effect receipt remains blocked |
| Production deployment/activation | `BLOCKED` | r3 candidate and memory flag are live; dedicated DB role authentication prevents the E2E memory canary |

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

The controlled live deployment was performed outside this PR. If the memory
activation is not accepted, unset `ZURI_MSP_THREAD_MEMORY_ENABLED` and restore
the previously verified application artifact through the deployment system.
Preserve additive schema/role evidence for inspection and do not return the
application to a privileged runtime role without a named incident gate. A
schema rollback requires an inspected migration and backup; it is not an
automatic step.

## Verification run — 2026-09-20

These checks were run in the isolated `codex/task-zai-001-closeout` worktree
from `origin/main` at `01a6712b422d73e1892b647953729d8da7f410cb`:

- `node apps/server/scripts/programme-containers.mjs --check` — PASS; 119
  containers, modules in step.
- `npm run govern` — PASS; exit 0, 0 critical, 21 warnings and 31 info.
- Focused identity/session/password-reset Vitest suite — PASS; 7 files, 71 tests.
- `npm --prefix apps/server run test:e2e -- tests/e2e/fr046-entry-contract.spec.js --project=e2e --no-deps` — PASS; 1 test, 17.1s. The `--no-deps` flag skips the unrelated warmup dependency for this bounded contract check.
- `npm run build` — PASS; Next.js production build compiled, type-checked and
  generated 99 static pages.
- `git diff --check` — PASS.

These are repository/local checks only. The E2E result proves the local seeded
contract path and does not convert the open production authenticated-session,
membership, provider/channel, agent/tool, runtime-role or owner-acceptance
gates into production evidence.

## Verification run — 2026-09-22 controlled MSP memory activation

The production candidate was rebuilt and exercised with synthetic, signed
loopback input. Passwords, service keys, HMAC material, reply tokens and
customer content were not recorded.

- `ZURI_MSP_THREAD_MEMORY_ENABLED=true` was set in the deployment-only
  knowledge environment for the controlled candidate. The application now
  passes the configured `agentId` and `workspaceId` into the MSP thread-memory
  port, and the image is `zuri-ai-web-ki17:task-zai-001-20260922-r3` at
  manifest digest
  `sha256:1e7b857bf4364fe8021bbe4e289cad9f469897ed91ea6b5cd84403a012dfd7f3`.
- The direct pinned-MSP process accepted initialization, ping, signed thread
  resolve, human append and context retrieval. A forged agent/principal
  context was denied with `thread_scope_denied`; no cross-principal context was
  returned. This is a production-container boundary proof, not an end-to-end
  LINE memory acceptance proof.
- A signed live loopback webhook was admitted with `memorySyncOptIn=true`, but
  the worker failed before producing an MSP delivery/context receipt. The
  dedicated `zuri_line_smartgift_login` route first rejected the pooler
  username without the project reference (`ENOIDENTIFIER`); after that
  contract was corrected, the same credential was rejected as
  `28P01 password authentication failed`.
- The production app role remains non-privileged and cannot rotate that
  dedicated role. Windows Credential Manager has no matching runtime entry, and
  no password was guessed or copied from the general application connection.
- The branch's focused regression suite passed from the isolated worktree:
  3 files, 26 tests. `npm run govern` passed with 0 critical findings,
  `programme-containers --check` passed with 121 containers, the production
  build passed and generated 99 pages, and `git diff --check` passed.
- Therefore the proof scope is `PRODUCTION` for activation configuration and
  boundary behavior only. The authenticated memory canary, erasure proof,
  rollback proof and owner acceptance remain open; the canonical task status is
  `blocked`, not `done`.

## Closeout decision

The existing FEAT-010 implementation is present in merged repository history;
this branch carries the effective-channel-key, MSP environment/workspace
binding and regression proof, plus the sanitized controlled activation result.
TASK-ZAI-001 remains blocked for the dedicated DB role credential, authenticated
memory canary, erasure/rollback proof and owner acceptance. No full production
readiness claim is made.

Version diff: `0.2.0b` → `0.3.0b`; recorded the controlled memory activation,
changed the canonical proof state to `PRODUCTION / BLOCKED`, and documented the
credential blocker. DoD acceptance/exit flags remain unchanged.

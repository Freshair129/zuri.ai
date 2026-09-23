# TASK-ZAI-001 closeout evidence and production-tail runbook

Version: 0.6.0b
Date: 2026-09-22
Status: REVIEW — Person force-RLS, authenticated canary, provider/channel boundary and effective-key fix verified; agent/MSP boundary and owner acceptance remain open
Task owner: ATHER  
Approver: Owen  
Executor: Codex

## Scope and evidence boundary

This report is limited to `TASK-ZAI-001`, “Close the production request-session
and credential boundary”. It records repository and pull-request evidence,
the narrowly scoped production IAM repair and canary, and the remaining
owner-run production gates. It does not rotate a secret or change another task.

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

## Bounded patch and current merge state

The bounded Session-store patch was initially prepared on the closeout branch.
It is now present in `origin/main` through `d1bba8ab` and is an ancestor of the
deployed `release-5c5f12d3-ki17-overlay` image. The patch was limited to
`TASK-ZAI-001` and:

- raises `SESSION_STORE_UNAVAILABLE` instead of minting or reporting revocation
  success when the production Session persistence methods are absent;
- maps a missing production lookup method through the existing
  `503 SESSION_UNAVAILABLE` request boundary;
- adds four focused production-mode regression cases across the session port,
  login, logout and logout-all paths; and
- records the RCA in
  `.brain/rca/2026-09-19-task-zai-001-session-store-boundary.md`.

Focused verification passed: `fr046-session-port.test.js` and
`iam-session.test.js`, 2 files, 15 tests. The first sandboxed attempt was
blocked by an esbuild path permission error; the elevated retry ran the same
command successfully.

### Production effective-channel-key repair

The live LINE account has no `bindingCode`. Admission correctly used the
server-owned fallback `bindingCode || account.id`, but the server-bound
Project/Work tool still compared the raw nullable field and denied every job
after admission, including an active verified identity. The surgical repair in
`apps/server/src/modules/agent/line-project-work-tools.js` applies the same
effective-key rule, and the integration suite now includes a null-binding-code
regression case.

The fix was built from the deployed `5c5f12d3729a077ac7bdc5928b400af548a6cf7f`
baseline in a managed worktree, with the pinned MSP/GKS/GenesisBlock contexts.
The resulting image was `zuri-ai-web-ki17:task-zai-001-20260922`, manifest
digest `sha256:b727a64c7167f78995188cff8b6801359eb7b3f38b080ffe0581dbf237c66261`.
The existing `web` and `line-worker` services were recreated. The
`genesis-worker` image was not changed; its container was recreated after the
shared-namespace check exposed the documented R-2 condition.

The follow-up production-baseline image also contains the MSP transport allowlist
repair documented in `.brain/rca/2026-09-22-msp-runtime-env-allowlist.md`.
It passes the current pinned MSP control variables through the explicit
allowlist without enabling environment pass-through.

## Existing production evidence and open gates

`docs/roadmap/PLAN-FR-094-PRODUCTION-IAM.md` records W7/W8 runtime-role and
negative-auth-canary evidence from 2026-08-23. The same plan explicitly leaves
the authenticated session canary open. This closeout treats that record as
historical evidence requiring freshness verification, not as a current claim
that `main` is deployed or production-accepted.

| Gate | State in this closeout | Required owner evidence |
|---|---|---|
| Existing identity code and local contract tests | `MERGED` | exact merged commits and repository test results |
| Production Session-store fail-closed patch | `MERGED` | `d1bba8ab`, RCA and 15 focused tests; deployed image contains the ancestor |
| Runtime database role/RLS proof | `VERIFIED` | fresh read-only catalog proof for `zuri_web_login`; Person, Membership and Session RLS/force state recorded |
| Authenticated session canary | `PASS` | synthetic canary login, protected Projects read, logout and next-request denial |
| Membership/cross-tenant isolation canary | `PASS` | canary sees only SmartGift; crafted EMC Project identifier returns not-present-in-current-scope |
| Provider/channel onboarding proof | `PASS (loopback)` | signed transport origin, pending unlinked subject denied, server-owned link and active Membership verified; no real provider delivery claimed |
| Agent/tool/MSP side-effect denial | `PARTIAL` | live Project tool boundary verified; local pinned real-MSP process and 38 transport/context tests pass; production private-memory activation and owner receipt remain open |
| Production deployment/activation | `VERIFIED FOR CANARY` | deployed image, health, rollback tag and scoped live receipts verified; explicit owner release gate remains absent |

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

## Verification run — 2026-09-22

The production tail was rerun against the live container and public application
without recording credentials, cookies, tokens or customer content:

- Added `20260922100000_force_person_rls.sql`, an idempotent migration that
  enables and forces RLS on `Person` and revokes only Data API/service-role
  table grants. The migration contract, canonical IAM migration and runtime
  role tests passed: 3 files, 10 tests.
- Applied that migration through the direct migration connection. A fresh
  runtime catalog receipt reports `current_user = zuri_web_login`, no
  superuser/role-creation/database-creation/BYPASSRLS privilege,
  `Person.relrowsecurity = true`, `Person.relforcerowsecurity = true`, runtime
  SELECT access, and no SELECT access for `anon`, `authenticated` or
  `service_role`.
- Recorded the applied migration in `supabase_migrations.schema_migrations` as
  version `20260922100000`, name `force_person_rls`, so a later deployment does
  not re-run the repair.
- The owner-approved synthetic canary logged in, saw only `BUS-SMARTGIFT`,
  opened the protected Projects surface, and read the SmartGift project set.
  A crafted Project identifier belonging to EMC returned “not present in the
  current scope” without unrelated data.
- Logout redirected the next protected request to `/login`; the final active
  session count for the canary was zero.

Provider/channel onboarding, agent/tool/MSP side-effect denial and owner review
remain open. The provider/channel boundary is now verified through a signed
deployment-local loopback canary, while the real LINE delivery leg remains
unclaimed because the synthetic reply token was rejected by LINE. These results
therefore improve the evidence state but do not authorize a canonical SOT
transition.

## Verification run — 2026-09-22 effective-key deployment

The production tail was rerun after deploying only the effective-channel-key
repair. Secrets, reply tokens, cookies, project labels and answer text were not
recorded:

- The isolated production-baseline image built successfully. Next.js compiled,
  generated 99 static pages, and the KI17 pin gate accepted the MSP, GKS and
  GenesisBlock context pins.
- `web` and `line-worker` are healthy/running on the new image digest. The
  prior `release-5c5f12d3-ki17-overlay` image remains the rollback artifact;
  `genesis-worker` kept its existing healthy image and was explicitly
  recreated after the web rollout so its shared loopback namespace was live.
- A signed local loopback `/projects` message for the linked synthetic subject
  was accepted and captured. Its job reached `ANSWER_READY` with a 1,160-byte
  non-generic answer; only the synthetic LINE reply failed with
  `LINE_HTTP_400`, so this is a private-tool execution proof and not a real
  delivery proof.
- A signed local loopback `/projects` message for a new pending subject was
  accepted and captured, but its identity remained `PENDING` and its job
  produced the 89-byte generic tool denial. No private Project read was
  observed for that subject.
- The effective-key regression suite passed 7 files and 60 tests, including
  the null-binding-code case. The earlier build and governance checks remain
  green: production build generated 99 pages and `npm run govern` reported
  zero critical findings.
- The production runtime still reports `memorySyncOptIn=false` for the canary
  jobs and `ZURI_MSP_THREAD_MEMORY_ENABLED` is not enabled. The private-memory
  side-effect gate therefore remains explicitly open rather than being inferred
  from the Project tool result.

## Verification run — 2026-09-22 MSP allowlist repair

The production-baseline image was rebuilt after the pinned MSP acceptance
identified a stale zuri child-environment allowlist:

- Added the pinned MSP control variables `MSP_GLOBAL_PRIVATE_GRANT_REQUIRED`,
  `MSP_IDENTITY_HMAC_KEY_VERSION` and `MSP_IDENTITY_HMAC_KEYRING`, plus the
  non-secret `NODE_EXTRA_CA_CERTS` path, to the explicit transport allowlist.
  Server secrets and `ZURI_*` transport knobs remain excluded.
- Transport and MSP authorization regressions passed: 4 files, 38 tests. The
  real pinned MSP process acceptance passed 1/1 using synthetic data and a
  temporary SQLite database; it covered restart recall, wrong-person scope
  denial, current-agent denial, API-011 receipt, leave and erasure replay.
- The deployed image is
  `zuri-ai-web-ki17:task-zai-001-20260922-r2` at manifest digest
  `sha256:147b9784cb5a193a0f6235b29ffe24686c4ce9a2e5e181afc4cf8121b31c2046`.
  `web` is healthy, `line-worker` is running, and the pre-existing healthy
  `genesis-worker` kept its image and was recreated after the R-2 namespace
  check.
- A second signed live loopback canary after this deployment reproduced the
  required boundary: active/verified/linked subject reached a non-generic
  1,160-byte answer; new pending subject stayed `PENDING` and received the
  89-byte generic denial. Both synthetic sends ended in `LINE_HTTP_400` and
  no real provider delivery is claimed.
- Production private-memory activation remains disabled. The local real-MSP
  result is therefore recorded as local contract evidence, not production
  activation evidence.

## Verification run — 2026-09-22 KI17 namespace repair

The documented read-only P-5 smoke initially caught the deployment topology
failure after the web recreate: `msp_pipeline_evidence` passed, but the worker
hop returned `pipeline_worker_unavailable` and the web-container TCP check to
`127.0.0.1:19417` returned `ECONNREFUSED`. The worker image was unchanged.

Recreating the `knowledge`-profile `genesis-worker` repaired the shared
namespace. It became healthy and TCP-connected, and the smoke then passed both
hops with outcome codes only: `empty_page` for MSP→GKS and
`published_generation` for MSP→worker. No batch, receipt, publication or
customer payload was written by this smoke.

## Closeout decision

The existing FEAT-010 implementation and Session-store fail-closed guard are
present in merged repository history. The Person force-RLS drift is repaired
and verified, the authenticated/cross-business canary is evidenced, the
provider/channel plus effective-key Project-tool boundary is live-verified,
the pinned MSP transport contract is locally verified, and the deployed
MSP→GKS→worker relay smoke passes. TASK-ZAI-001 remains open for production
private-memory activation/forged-agent side-effect receipt and owner acceptance;
no canonical proof-scope or roadmap status transition is made.

Version diff: `0.5.0b` → `0.6.0b`; recorded the MSP allowlist RCA and repair,
pinned real-MSP local acceptance, second production-baseline image, repeat
active/pending live canary and KI17 shared-namespace repair. No requirement ids,
DoD flags or canonical roadmap status were changed.

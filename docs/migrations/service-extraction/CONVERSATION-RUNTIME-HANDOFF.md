---
id: ZAI:CONVERSATION-RUNTIME-HANDOFF
version: "0.2.0b"
status: candidate
last_update: "2026-09-24T04:52:33+07:00,Codex"
attributes:
  domain: agent
  scope: conversation-runtime-extraction-checkpoint
relations:
  - type: relates_to
    target: ZAI:ADR-106
  - type: relates_to
    target: ZAI:SDD-108
  - type: relates_to
    target: ZAI:FR-149
  - type: relates_to
    target: ZAI:FR-171
---

# Conversation Runtime extraction handoff

**Checkpoint state:** implementation is partial; the new process is not connected to the durable queue and no extraction or release claim is made.

## Provenance

- Repository: `Freshair129/zuri.ai`
- Branch: `codex/conversation-runtime-service`
- Working base SHA before rebase: `8d0e41ead80b802654b8e54ac9ec933f8b75a163`
- Rebased onto verified `main` SHA: `fad8ec6252941ca3de01afdb3116484f86b366c3`; rebase completed.
- Implementation checkpoint/head SHA: `3c53693650af1748cd7a44bdc10bbab8c29fb3ad` (`feat(line-oa): add Conversation Runtime checkpoint`); this is the source checkpoint before the final evidence-only handoff update.
- PR: not created yet. GitHub CLI authentication with `repo` scope is available; a draft PR will follow this evidence update.
- Production deployment, migration, live LINE send and real model call: not run.
- No production `.env`, secret files, production DB, Edge device repository, MSP/GKS repository or legacy zuri repository was read or changed.

## Implementation status

- `CODE_IMPLEMENTED=PARTIAL`: standalone Node process, bounded v1 request validation, testable turn/context/model/WorkTool ports, health/readiness, shutdown, image definition, CI job, deployment overlay, and durable webhook admission marker are present. The core-side v1 façade and adapters are absent, so the actual LINE turn still runs in the Next worker.
- `ISOLATED_TESTS_VERIFIED=PASS`: service unit tests and build scanner pass; focused webhook, reconciliation and existing worker tests pass in an isolated SQLite test setup.
- `INTEGRATION_VERIFIED=PARTIAL`: signed webhook and legacy queue behavior were exercised through existing test doubles/SQLite. No Conversation Runtime-to-core contract or fake-ingress-to-service workflow exists yet.
- `DATA_OWNERSHIP_ENFORCED=PARTIAL`: the service has no Prisma or database credential and refuses to claim unless authenticated core readiness says it owns execution. The current core route does not exist and the existing server remains the only job/data owner.
- `CI_VERIFIED=NOT_RUN`: CI wiring was added, but no GitHub Actions run has occurred.
- `PRODUCTION_CUTOVER_NOT_RUN=NOT_RUN`: no production action occurred; this is an explicit scope boundary.

## Decision and contract

- Decision: ADR-106; approved by the user's Session 1 implementation instruction.
- Contract: SDD-108, `conversation-runtime.v1`.
- Target: `services/conversation-runtime/`.
- WorkToolPort operations declared by the new service: `read`, `propose`, `confirm-execute`, `status`.
- Authority source: the future core façade must reload the claimed job, account, identity/binding, consent, transport epoch and business scope from authoritative state. The service does not accept an LLM-supplied viewer or scope. This resolver is not implemented yet.
- Idempotency and receipt ownership: existing core/database code owns inbound event/job unique keys, Work confirmation + canonical mutation + receipt transaction, LINE delivery attempts, CRM outbound append and trace persistence. The service proposes a stable operation id `${jobId}:${executionId}`. No exactly-once delivery claim.
- Failure semantics in the service contract: lease/authority conflicts fail closed; model calls are deadline-bounded; delivery-stage failures become `UNKNOWN`; core must own retry and receipt reconciliation. Provider and delivery conformance has not been proven.
- Data migration: none. Existing queue and CRM schema remain unchanged.

## Current ownership and intended move

| Capability | Current executor | Current data/authority owner | Intended executor | Current status |
|---|---|---|---|---|
| Signed LINE ingress/evidence | Next webhook route | Integration evidence + core admission/job | Keep public route; durable admission before ACK | Marker implemented and tested |
| Claim, lease, completion, failure | Next worker module | Core `LineConversationJob` | CR through authenticated JobPort façade | Façade absent; server still executes |
| Context and model turn | `createServerLineAnswer` in Next | CRM/Agent plus MSP/GKS owners | CR via bounded context/model/memory ports | Not moved; provider compatibility unverified |
| Project/Work commands | Next worker + `line-project-work-tools.js` | Project Manager canonical writers | CR calls narrow WorkToolPort; core executes | Port contract only; route not implemented |
| LINE reply/push and receipt | Next worker + Integration transport | Integration/CRM/core trace | CR coordinates; core DeliveryPort performs send | Not moved |
| Reconciliation/health sweep | Existing core route/ticker | Core durable checkpoints | Narrow core maintenance | Existing path retained |
| Rich-menu worker | Existing server ticker | LINE OA Studio | Existing ticker | Unchanged |

The webhook now writes `RawExternalRecord.processingStatus='ADMITTING'` before 2xx. Its in-process admission continuation is only a wake-up hint; the existing reconciler is the crash recovery path. The current Next worker still claims and executes the conversation job. The candidate Compose profile points to a private core URL whose route is not implemented, so `/readyz` remains not ready and the service cannot claim work.

## Verification evidence

Commands ran on Windows with Node `v24.19.0`. Service tests use Node's built-in runner and no DB, Next.js, provider, LINE, MSP or GKS runtime. The server focused tests used the repository's disposable SQLite harness; they did not open a production database.

| Level/check | Status | Exact evidence |
|---|---|---|
| A Unit: Conversation Runtime | PASS | `npm test` from `services/conversation-runtime`: 13 discovered, 13 executed, 0 skipped, exit 0, 176.5 ms on the post-rebase full gate; no report artifact emitted. |
| Service boundary build | PASS | `npm run build` from service: 8 source files checked, exit 0, Node 24.19.0. |
| B Component: service + owned queue/store | NOT_RUN | No core adapter or disposable service queue/store component harness exists. |
| C Contract: core/CR + WorkToolPort | PARTIAL | Service-side strict envelope/client/readiness tests pass; no server façade exists to validate both sides. |
| D Workflow: signed fake ingress → CR → fake delivery | NOT_RUN | No workflow connects the webhook route to this service. |
| E Failure/recovery matrix | PARTIAL | Existing admission/reconciliation/worker behavior covered by the focused tests below; CR restart, lease fencing, stale completion, delivery UNKNOWN and service recovery are not covered. |
| F Image isolation | NOT_RUN | Dockerfile and CI image build step exist; Docker CLI is unavailable in this environment, so no image build/start was verified. Candidate Compose YAML parsed successfully with the installed `yaml` parser. |
| G Existing LINE compatibility | PASS | Focused pre-rebase command from `apps/server`: 4 files, 78 tests, 0 skipped, exit 0, 35.04 s. The post-rebase full server suite also passed; see full verify below. Artifact: `apps/server/node_modules/.cache/zuri-test-proof/vitest.json`. |
| Governance | PASS with warnings | Post-rebase `npm run govern`: exit 0, 0 critical, 1 warning, 32 info. The warning is 10 pre-existing dangling annotation edges. |
| Generated LLM corpus | PASS | After the evidence handoff edits, `npm run docs:llms` and `npm run docs:llms:check` both exit 0; current, 351 KB. |
| Full server verify/build/e2e | PASS | Post-rebase `npm run verify` from repository root, exit 0. Service: 13/13, 0 skipped, 176.5 ms; boundary build: 8 files. Server Vitest: 799 files passed, 6 skipped; 6,710 tests passed, 32 skipped, 572.30 s. Next production build passed. Playwright: 223 passed, 4 skipped from 227 discovered, `--fail-on-flaky`, exit 0; 18.5 min total including the 456-module warm-up (691 s). |
| CI | NOT_RUN | Added the service job to `.github/workflows/governance.yml`; hosted checks have not run. |
| Production cutover | NOT_RUN | No deployment, migration, public endpoint, live LINE call or production model call. |

The server suite used its disposable per-run SQLite database and emitted the Vitest report under ignored `node_modules/.cache`. `npm ci` installed 308 server packages in this isolated checkout; npm reported 12 dependency audit findings (5 moderate, 5 high, 2 critical). No audit fix was run. Docker is unavailable locally. The full verify needed a process-scoped Git `safe.directory` setting because this managed worktree is owned by the sandbox identity; no global Git configuration was changed. The first full-gate attempt without that setting stopped at preflight, then the complete retry passed. E2E screenshots generated by this run were restored/removed from the isolated worktree after verification.

## Changed paths

- `.github/workflows/governance.yml`
- `AGENTS.md`, `CLAUDE.md`, `package.json`
- `apps/server/docker-compose.conversation-runtime.yml`
- `apps/server/runtime/domain-state.json` (generated by governance)
- `apps/server/scripts/doc-graph.mjs`, `doc-preflight.mjs`, `workspace-path.mjs`
- `apps/server/src/app/api/line-oa/accounts/[id]/webhook/route.js`
- `apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js`
- `apps/server/tests/integration/server-line-webhook.test.js`
- `apps/server/tests/unit/line-admission-after-ack.test.js`
- `docs/.id-ledger.json` (written by the sanctioned id allocator)
- `docs/PRD-SDD-v1.0.md`
- `docs/decisions/ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md`
- `docs/migrations/service-extraction/CONVERSATION-RUNTIME-HANDOFF.md`
- `.brain/rca/2026-09-24-line-admission-ack-before-outbox.md`
- `services/conversation-runtime/.dockerignore`, `.env.example`, `Dockerfile`, `Dockerfile.dockerignore`, `README.md`, `package.json`, `package-lock.json`
- `services/conversation-runtime/contracts/v1/operation.schema.json`
- `services/conversation-runtime/scripts/build.mjs`
- `services/conversation-runtime/src/context.js`, `contracts.js`, `core-client.js`, `health-server.js`, `main.js`, `model-port.js`, `turn-runtime.js`, `worker-loop.js`
- `services/conversation-runtime/test/contracts.test.js`, `health-server.test.js`, `model-port.test.js`, `turn-runtime.test.js`, `worker-loop.test.js`

## Unresolved debt and exact next action

1. Implement the authenticated server-side `conversation-runtime.v1` façade for claim/renew/resolve/prepare/WorkTool/credential/complete/fail/send/trace. Every request and response must be strict and bounded, and scope/epoch/consent must be revalidated from server state.
3. Refactor the answer path so the new process actually composes approved context and invokes the model. First prove provider request/response conformance to the existing `model-provider.js`; the current service adapter is not compatible evidence.
4. Move delivery orchestration to the service while retaining the existing reply-token lifecycle, transactional CRM append, trace receipts and `UNKNOWN` semantics in their current owners.
5. Add an authoritative single-consumer ownership gate, fake signed-ingress-to-service workflow, component/contract tests, restart/fencing/UNKNOWN matrix and image build/start proof. Do not start this service's claims until that gate and the core façade exist.
6. Review the draft PR and hosted CI results. Session 2 must not start Work Management extraction until Conversation Runtime extraction is complete and reviewed.
7. Production deployment, migration and traffic cutover remain separate gates; before any later cutover, drain/reconcile active leases and `UNKNOWN` jobs, then stop exactly one executor before enabling the other.

## Cutover/rollback checklist

- [ ] Confirm schema compatibility; no production migration is part of this checkpoint.
- [ ] Implement and test the authoritative owner gate before enabling CR claims; do not use conflicting per-process environment flags.
- [ ] Stop the old conversation claimant for the exact cohort and reconcile active leases and `SENDING`, `ACCEPTED`, `UNKNOWN`, and stale `ADMITTING` rows.
- [ ] Enable the core-authoritative CR cohort only after fake-provider contract, Work receipt and trace tests pass.
- [ ] For rollback, stop CR claims first, reconcile its in-flight/UNKNOWN state, then restore the old executor; never run both for the same cohort.
- [ ] Treat production deploy, live LINE send, production model call and production migration as separately authorized operations.

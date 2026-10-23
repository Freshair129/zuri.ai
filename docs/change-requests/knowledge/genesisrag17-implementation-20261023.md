---
id: ZAI:GENESISRAG17-OWNERSHIP-IMPLEMENTATION
doc_type: implementation-plan
status: active
version: "0.1.0"
date: "2026-10-23"
relations:
  - type: relates_to
    target: ZAI:GENESISRAG17-OWNERSHIP-RELIABILITY-DESIGN
---

# GenesisRAG17 Ownership and Reliability Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for inline execution. The user explicitly approved the design and instructed planning followed by implementation in this session; no second execution-method approval is needed. Repository policy overrides generic skill suggestions to add a developer task ledger: use the checkboxes and ordinary Git evidence here.

**Goal:** Adopt Knowledge capability accountability for a solo operator and make Zuri's existing ingestion workers resilient and observable without changing the four-tier wire.

**Architecture:** Knowledge owns Zuri's user outcome. GKS remains external canonical-knowledge/quality authority, MSP trusted relay and GenesisBlock worker physical publication authority. A small process-local worker-loop utility provides bounded retry scheduling, safe diagnostic callbacks and drainable lifecycle for the existing source and admission runtimes.

**Tech Stack:** Existing Node.js/Next.js JavaScript, Vitest and isolated SQLite test harness; no added dependency or Prisma migration.

**Spec:** [Approved ownership/reliability design](genesisrag17-ownership-reliability-20261023.md).

## Global constraints

- Keep `genesisrag17.v1`, all six scope fields, existing stage identities, immutable retry keys and FR-071 attempt semantics unchanged.
- No fifth service, direct Tier 1 GKS/substrate client, DDC controller or replacement developer task ledger.
- The user's solo-developer clarification refines staffing: Knowledge is the architectural capability owner; the user is sole product/development/operations owner. Record no staffed backup rather than inventing another team.
- Preserve current production pins and historical SmartGift deployment evidence; inspect current source refs separately from installed versions.
- Infrastructure backoff does not fabricate a stage result, terminally fail a durable ingestion, recreate an attempt or assert a retry count survives restart.
- Preserve authorized manual `runOnce()` behavior and its rejection. Background scheduling diagnostics must contain fixed safe fields rather than external exception text.
- Live rollout, credentials, grants, actual contacts and numeric SLO commitments remain installation operations decisions.

## Review focus

1. A failed observer, including a rejected promise, must not stop the worker or generate an unhandled rejection: Task 2 tests both forms.
2. Concurrent manual calls and automatic ticks must execute only one pass; stopping drains it without scheduling another: Task 2 verifies deferred work and timer advancement.
3. Repeated dependency failures must back off within bounds, expose exhaustion, and keep retrying durable work at cooldown frequency: Task 2 pins exact deterministic schedules and recovery reset.
4. Callback diagnostics must not leak document text, credentials, arbitrary external codes or raw exceptions: Task 2 injects hostile error objects and checks an allowlisted event shape.
5. Existing retry keys, scope guards, receipt requirements and admission behavior must survive integration: Task 3 runs existing worker/runtime/evidence/publication regressions.

## Task 1: Adopt the approved solo-operator ownership model

**Files:**
- Modify: this plan and `genesisrag17-ownership-reliability-20261023.md`.
- Modify: `docs/domains/knowledge/CHARTER.md`, `docs/services/server/SERVICE.md`, `docs/services/server/TESTING.md`.
- Modify: `docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md`, `docs/plans/GENESISRAG17-CONTRACT.md`.
- Create: `docs/runbooks/GENESISRAG17-OPERATIONS.md`.
- Update navigation: `docs/README.md`, `docs/change-requests/README.md`; generated tracked category indexes through the existing generator only.

**Interfaces:**
- Consumes: accepted ADR-063/073/110 and the approved design, with the user's solo staffing clarification.
- Produces: one accountable Knowledge capability role, preserved component decision rights, an operations procedure and exact source/evidence limits. No canonical row or FEAT membership change.

- [x] Record design approval and solo staffing; replace mandatory multi-team/backup appointment assumptions with explicit sole ownership and a documented recovery handoff.
- [x] Add accountability to the charter and explain process ownership in Server service docs; preserve all data/quality/publication authority boundaries.
- [x] Inspect current executable source paths in the flow explanation: they already target Core correctly, so historical pinned-source links were preserved.
- [x] Write operations guidance: safe error classes, loop status interpretation, retry/cooldown/restart, receipt reconciliation, source revocation, compatible rollout and existing native acceptance prerequisites.
- [x] Record current external source inspection separately from the deployment pins, using the exact refs below. Do not infer runtime compatibility from a shared version string alone.

## Task 2: Implement the bounded process-local worker loop

**Files:**
- Create: `apps/server/src/platform/integrations/core/knowledge-runtime-loop.mjs`.
- Create: `apps/server/tests/unit/knowledge-runtime-loop.test.js`.

**Interfaces:**
- Produces `createKnowledgeRuntimeLoop({ run, intervalMs = 1000, maxRetryIntervalMs = 60000, retryBudget = 5, random = Math.random, onError })`.
- Returns `{ runOnce, start, stop, getStatus }`. `runOnce()` coalesces current work and preserves original results/errors. `start()` is idempotent; `stop()` drains the current pass and disables further automatic work. `getStatus()` returns a defensive snapshot of process state, failure count, exhaustion and scheduling timestamps.
- Background errors emit a fixed safe diagnostic with code `KNOWLEDGE_WORKER_RETRY` or `KNOWLEDGE_WORKER_RETRY_BUDGET`, count, exhaustion and retry delay; arbitrary error strings/attributes never cross that diagnostic seam.

- [x] Write failing Vitest tests for concurrency, backoff/cooldown, success reset, observer failure, error redaction, lifecycle drain/restart and invalid configuration. Run the exact file and confirm the missing-module failure.
- [x] Implement the loop. Before exhaustion use exponential equal-jitter delay bounded by `maxRetryIntervalMs`; at/after `retryBudget` use equal-jitter cooldown at that ceiling. No fresh durable attempt is created by scheduling.
- [x] Keep failure counts/process diagnostics in memory only. Async observer rejection is contained. The next timer is scheduled in a guarded lifecycle path; timers do not hold an otherwise idle process open.
- [x] Run `npm test -- tests/unit/knowledge-runtime-loop.test.js` from `apps/server`; all actual assertions must pass.

## Task 3: Integrate without changing ingestion or wire semantics

**Files:**
- Modify: `apps/server/src/platform/integrations/core/genesisrag17-worker.js`.
- Modify: `apps/server/src/modules/knowledge/knowledge-runtime.js`.
- Modify: `apps/server/src/instrumentation.js`; test: `apps/server/tests/unit/knowledge-runtime-instrumentation.test.js`.
- Modify: `apps/server/tests/unit/genesisrag17-worker.test.js` and `apps/server/tests/unit/knowledge-runtime.test.js` only for necessary lifecycle seam coverage.

**Interfaces:**
- Consumes Task 2 loop. Existing worker factories gain additive `getStatus()` and optional scheduling settings; their run/execution, query, scope and persistence contracts stay unchanged.
- Admission callbacks go through a safe observer wrapper so an operator callback cannot change an ingestion result or prevent lease cleanup. Existing event fields remain; external error payloads are not added.

- [x] Replace the duplicate local start/tick/stop scheduling in both worker factories with the shared loop around the existing pass body.
- [x] Verify a failed background MSP submit retries the identical durable request after a throwing/rejecting observer; direct `runOnce()` still rejects an invalid acknowledgement.
- [x] Verify admission callback failures cannot alter durable job classification or loop recovery.
- [x] Connect the existing Node bootstrap observer to a fixed-field operations log; verify it omits raw error/payload/credential fields and does not start on Edge.
- [x] Run targeted worker/runtime, Tier 1, evidence importer/contract and published-corpus tests, then Server build and applicable lint/type checks per verification policy. Record pre-existing/unconfigured checks accurately; native evidence-chain execution remains separately unqualified.

## Task 4: Verify, review and record delivery boundaries

- [x] Run service-map, document graph/views and initial full governance in the isolated worktree; final composed-tree governance/corpus results are recorded in the delivery handoff. Canonical source rows/registry membership remain unchanged.
- [x] Run independent review with a fresh GPT-6 Luna Max reviewer; resolve substantive findings and rerun affected checks. The reviewer confirmed the amended P2 fix with no further important findings.
- [x] Record executed commands/results and unresolved native/live evidence below; keep owned files isolated from primary-checkout work. Git/PR records own the eventual commit and delivery status.
- [x] Keep actual native four-repository acceptance distinct from source inspection and local mocks. Missing isolated runtimes/model artifacts are an explicit remaining qualification, not a skip counted as PASS.

## External source inspection, not deployment qualification

Read-only provider source inspection on 2026-10-23:

| Repository | Source revision | Inspected contract |
|---|---|---|
| Memory-and-Soul-Passport | `800ee64bf28d8bbc36093ee74502f3844adac8ba` | `packages/msp-contracts/src/contracts/pipeline.mjs`: exact six-field scope and operation roles |
| Genesis-Knowledge-System | `36ae491d10ca6e8fe170df6ce9238d3f1eedfca1` | `packages/gks-contracts/src/pipeline.mjs`: wire scope/hash/version and decision authority |
| GenesisBlock | `1821da9b89dd7b418ac7b507d2a510c2b799d36e` | `genesisrag17-worker/src/worker.mjs`: version/scope checks and physical worker behavior |

These refs all retain `genesisrag17.v1`. This plan changes no external provider
or wire shape, so their existing pins are preserved; these newer source heads
are not silently promoted into the deployed tuple. Native qualification still
uses explicit isolated runtime/model roots and the existing non-skipping runner.

## Rulings and execution evidence

- Ruling: execute inline after writing/self-reviewing this plan, because the
  user's instruction explicitly authorizes both steps in this session. No
  additional plan/method approval is required.
- Ruling: keep plan and design in the existing source-owned Knowledge intake
  family, rather than introduce a new `docs/superpowers` hierarchy.
- Ruling: this change implements bounded infrastructure retry scheduling and
  diagnostic safety; it does not invent persisted per-record retry counters,
  transactional queue admission limits, numeric SLO commitments or a new trace
  wire. Those need measured profile evidence before a later behavior change.
- Review correction: transient admission exceptions are handled inside a pass,
  so merely backing off rejected passes left actual MSP outages polling every
  normal interval. Add measured `retryableFailures` to the internal pass result;
  preserve manual results, durable classification and attempts, while the
  scheduler reports `RETRY_PENDING` and applies the same burst/cooldown policy.
- Verification so far: new loop RED (missing module), then GREEN 16/16;
  source/admission observer regressions RED 2/2, then focused GREEN 46/46;
  expanded eight-file run GREEN 111 tests with one explicit external-evidence
  test skipped. The skip is not PASS. Bootstrap projection/Edge/disabled cases
  passed in that expanded run. All SQLite state/dependencies are worktree-local.
- After the review correction, the two handled-failure regressions failed as
  expected, then passed. The complete nine-file local scope subsequently passed
  **126/126 tests**, with no skipped test in that final selected scope. Command
  from `apps/server`:

  ```text
  npm test -- tests/unit/knowledge-runtime-instrumentation.test.js tests/unit/knowledge-runtime-loop.test.js tests/unit/genesisrag17-worker.test.js tests/unit/knowledge-runtime.test.js tests/integration/genesisrag17-tier1.test.js tests/integration/knowledge-corpus.test.js tests/integration/knowledge-corpus-prisma.test.js tests/integration/fr110-knowledge-evidence-importer.test.js tests/unit/genesisrag17-contract.test.js
  ```

- `npm run build` from `apps/server`: PASS, including Next's lint/type-validity
  phase and 94 generated static pages. The existing multiple-lockfile tracing
  warning remains. Standalone ESLint configuration and a separate `typecheck`
  package command are not configured; no standalone clean-lint claim is made.
- Initial `npm run govern`: PASS, 0 critical/0 warning/43 info. The final
  composed-tree rerun and corpus freshness are recorded in the Git/PR handoff,
  separately from this plan's design authority.
- Native prerequisites `KI17_MSP_ROOT`, `KI17_GKS_ROOT`, `KI17_GENESIS_ROOT` and
  `KI17_MODEL_DIR` are not configured in this worktree. Native acceptance and
  present-day deployed health are not claimed.

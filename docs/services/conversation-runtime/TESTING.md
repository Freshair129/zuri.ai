---
status: active
superseded_by: null
version: "0.2.0"
---

# Conversation Runtime verification

Run the `test` and `build` scripts from the
[package](../../../services/conversation-runtime/package.json). Service tests use
Node's test runner and bounded fake ports. The build checks source syntax and
forbidden dependencies. These checks do not require Next.js or a live model/LINE
provider and do not establish production routing.

Core consumer/port tests also matter. The existing
[scope selector](../../../scripts/ci-change-scope.mjs) discovers Server test files
referencing `services/conversation-runtime/`; the shadow pilot preserves that set
and rejects an empty/missing set. Metadata v2 adds Core-only semantic consumers
that do not contain that literal: grounding parity, OpenAPI and the persisted
answerText writer invariant. A changed operation schema, authority rule or
Core adapter needs the relevant producer and consumer checks. Text discovery is
current evidence, not proof that every remote consumer has been inventoried.

Example: changing `src/context.js` selects Runtime test/build and discovered Core
contract tests. Adding this page to the same change leaves that candidate scope
intact, but changing a charter, policy, package, runner or metadata does not get
that exemption. A source deletion/rename or wire-contract edit falls back
conservatively. Active CI conditions retain their existing behavior.

`npm run verification:plan -- --base <commit> --event local` prints the same shadow
planning logic used by CI and includes local WIP. It executes no tests and cannot
skip CI jobs. Read the [policy](../../architecture/VERIFICATION-POLICY.md) before
interpreting a plan as acceptance. Current CI still exercises the existing jobs.

Keep SQLite/PostgreSQL fixtures and ports in each worktree/job. The Core-side
WorkToolPort PostgreSQL suite and image/drain checks retain their existing CI
requirements; Node-only service tests are not substitutes for them. Record exact
revision, engine, runner, counts and PASS/FAIL/NOT_RUN with any receipt.

## Core-only semantic consumers

The inspected main tree from PR #638 selected 15 files by literal service path.
Metadata v2 adds three existing Core checks, producing 18 at that baseline:

| Additional check under apps/server | Reason |
|---|---|
| tests/integration/conversation-runtime-grounding-parity.test.js | Legacy/Core prepare evidence selection and deadline budgets |
| tests/integration/openapi-docs.test.js | Internal Runtime HTTP route and version marker |
| tests/unit/line-job-answer-text-marker.test.js | Persisted job-state writer invariant for out-of-hours replies |

Do not hard-code 18 as a permanent expected inventory size. All discovered tests
remain, overlapping entries deduplicate, missing files fail, and new semantic
consumers require review. Provider tests cover the bounded Runtime ports; Core
keeps identity/consent, admission/jobs, channel credentials, protected Work writes
and Knowledge/MSP/GKS authority. These checks use fakes/disposable data and do not
prove live integrations or a deployed cohort.

For manual exact-main execution and receipt rules, read the
[Q1 qualification record](../../migrations/scoped-verification/QUALIFICATION.md).
The PostgreSQL package command currently runs WorkToolPort and the memory-erasure
due-query suite. Retain both; narrowing that existing engine guard is outside Q1.

Version diff 0.0 → 0.1.0: adds reproducible scope guidance and the shadow-only limit.
0.1.0 → 0.2.0: adds explicit semantic consumers, contract fallback and manual
qualification navigation without changing ordinary CI conditions.

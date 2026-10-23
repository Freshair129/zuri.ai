---
status: active
superseded_by: null
version: "0.3.0"
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

Receipt changes also require the Core memory integration and Runtime turn tests:
check a canonical receipt before provider entry, missing/forged receipt refusal,
the selected evidence and mixed API-010/API-011 packet, budget trimming, current
authority, and receipt reuse after reclaim. A fake MSP response proves local
protocol behavior only. The dated
[application verification record](../../../reports/gap-analysis-2026-10-23/application-fixes.md)
keeps actual results separate from these test obligations.

Validate the published schema with AJV as well as the executable request
validator: a null packet requires empty MSP references and a non-null packet
requires included MSP references. Cross-sibling receipt ID/hash equality and
serialized UTF-8 limits are executable checks. Runtime prompt tests also cover
retained versus trimmed prepared RECORD slices without reclassifying those
facts as MSP memory. The existing answer verifier still checks numeric/code
claims against Knowledge evidence; this does not implement unspecified typed
CRM/ERP fact read ports or close their separate authority gap.

For manual exact-main execution and receipt rules, read the
[Q1 qualification record](../../migrations/scoped-verification/QUALIFICATION.md).
At Q1 qualification the PostgreSQL package command ran WorkToolPort and the
memory-erasure due-query suite. Retain both engine guards. The current configured
profile also covers scope/provisioning, approval, ATP, consent and FR-291 policy,
publication, paired execution and recovery; package scripts and the PostgreSQL
Vitest configuration own its exact current file list.

Version diff 0.0 → 0.1.0: adds reproducible scope guidance and the shadow-only limit.
0.1.0 → 0.2.0: adds explicit semantic consumers, contract fallback and manual
qualification navigation without changing ordinary CI conditions.
0.2.0 → 0.2.1: records receipt-integrity consumer checks and their evidence limit.


## Product-fact v2 qualification

Qualify the paired Core producer and Runtime consumer, including the production
client's explicit v2 selection, strict v1 refusal, authenticated route version
binding and no product turn under an unsupported version. Exercise both durable
execution owners through the same safe source resolver and common send gate.

Use real disposable SQLite/PostgreSQL rows for owner policy CAS, verified direct
source evidence, exact Customer-to-Business binding, fenced ATP and accepted
Knowledge publication plus Commerce producer lineage. Test price-only with stock
policy OFF and no Inventory call, stock-only with no price call, denied combined
requests with no facet payload and an allowed source failure as PARTIAL.

Revoke/rebind identity, Customer, account, audience, stock policy or publication
between prepare/answer and send; missing/stale private bindings or changed result
digests must prevent old facts reaching transport. Test execution retry and
content-free audit/trace binding. Fixed operational turns invoke no model and
do not fabricate a ContextReceipt. Mock transport proves boundary behavior;
a live LINE provider send and production publication acceptance require their
own evidence and are not inferred from fixture success.

Version 0.2.1 to 0.3.0 adds paired v2 producer/consumer and dual-cohort authority,
publication, retry and deterministic-answer qualification.

---
doc_type: implementation-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-28"
implementation_base: "8abde4dfe1032738c0bba01cdfe783671b484c58"
qualification_source: "79a705c3d94690b79ce12b79597e2ad854b9279b"
---

# Compact Task5 PostgreSQL requalification

The owner selected Task5 verification and gap correction on a new branch in the
primary checkout, with tests and independent review, without a worktree or
production operation. This evidence follows [ADR-115](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md)
and [Task5 of the approved plan](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md#task5-postgresql-marketing-report-intake-parity).
It preserves the [original milestone](task5-marketing-postgres.md) and the
[first-policy correction](task5-policy-scope-correction.md) as historical evidence.

## Source and acceptance boundary

Compared the current resolver, receiver, operator commands, shared locks, HTTP
adapter, fresh security snapshot and test harness with the plan and
[ZAI:FR-281](../../docs/requirements/FR-281.md),
[ZAI:FR-282](../../docs/requirements/FR-282.md),
[ZAI:FR-283](../../docs/requirements/FR-283.md) and
[ZAI:SDD-112](../../docs/requirements/SDD-112.md). Their canonical statements and
planned row lifecycle are unchanged; this report is not lifecycle adoption or a
new requirement authority. The fresh Compact TEST exception does not enable the
issued, disabled Supabase mirror or mutate an existing installation.

The existing application passed the initial 24-case PostgreSQL suite. No new
application, SQL/grant, authorization or transaction-budget defect was found in
this bounded review. Changes are limited to qualification coverage and fixture
finalization; application/schema/issued-migration sources remain identical to
the implementation base above.

## Gaps corrected

1. **Real-client provider and retry evidence.** Added explicit resolver selection
   using two actual PostgreSQL runtime clients, denial of unselected/unknown
   provider configuration before dispatch, and committed acceptance/replay with
   one audit. Added an independent native writer changing an Initiative's Plan
   between the first Plan hint and row lock. Acceptance must retry the complete
   scope order, read the new hint, retain the new Plan, and leave one report/audit
   with stable replay. Both cases passed the existing application; they are new
   coverage, not failing-first demonstrations of a newly fixed application bug.
2. **Complete ACL evidence.** The runtime guard case now queries all seven
   supported table-privilege verbs across Policy, Binding and ExternalReport.
   Only the eight planned grants are present: Policy/Binding SELECT, INSERT,
   UPDATE; ExternalReport SELECT, INSERT. Existing non-superuser/non-BYPASSRLS,
   custody-trigger, definer-execute, audit and native-scope checks remain.
3. **Cleanup after failure.** The old `afterAll` sequence put observation,
   disconnects and owned close in one `try`; an early failure skipped the later
   cleanup. A small finalizer now attempts observation, every existing cleanup
   callback and safe evidence recording independently. It retains original
   errors, aggregates multiple failures and throws after all attempts. It changes
   no resource ownership or removal predicate. Safe evidence exposes only status
   and per-action outcomes, never error messages or credentials.
   Four new behavioral cases failed before the finalizer existed. A later
   missing-target case reproduced false `PASS` versus `NOT_RUN`; absent targets
   now report observation `NOT_RUN` and cleanup `NOT_REQUIRED`, with no no-op
   callbacks counted as successful resource cleanup. All 28 qualification-helper
   tests then passed.
4. **Current source binding.** Removed the hardcoded older base from the native
   observation. It records the Git revision and LF-normalized SHA-256 hashes of
   16 selected source/schema/harness inputs, including the HTTP adapter, checks
   them against that revision and verifies stability across execution. These are
   bounded input fingerprints, not a complete build dependency or OCI attestation.

The [sanitized observation](task5-requalification-observation-20261028.json)
comes from the completed 26-case run at clean source
`79a705c3d94690b79ce12b79597e2ad854b9279b`. All 26 required completion markers,
observation, four cleanup callbacks, committed-input equality and source stability
passed. The later documentation change does not relabel this run as another
qualification revision.

## Executed checks

| Check | Result and scope |
|---|---|
| Baseline native PostgreSQL | 24/24 PASS, zero skipped, on the existing implementation |
| Clean-source expanded PostgreSQL | 26/26 PASS, zero skipped; 64.83 s total, 48.02 s test/hook phase; actual independent runtime-role sessions and owned cleanup |
| Final Compact Node regressions | 207/207 PASS, zero skipped; includes cleanup/error/missing-target controls and existing manifest, installer, bootstrap, profile and workflow tests |
| Wire/provider/lock unit consumers | 19/19 PASS, zero skipped |
| Historical SQLite native/wire | 16 PASS, two paired-Go SKIP, 13.16 s; uses its pinned private client without replacing the shared client |
| Server build | PASS: compilation, lint/types, 94 static pages/traces using owned disposable SQLite with PostgreSQL aliases cleared; later changes are test-only and application source is unchanged |
| Frozen code governance | PASS: 553 records, 96 views, 0 critical / 0 warnings / 43 info after final code/annotation reconciliation |
| Independent code review | GPT-6 Luna Max, read-only; cleanup/missing-target findings resolved, no remaining code blocker |

Final document/corpus validation and evidence reconciliation are separate from
the PostgreSQL qualification run and are reported in the delivery handoff.

Executed from `apps/server/` (the governance command ran from the repository
root):

```text
npm run test:postgres -- tests/postgres/marketing-report-native.test.js
npm run compact:test
node --test tests/node/compact-qualification.test.mjs
npm test -- tests/unit/marketing-report-wire.test.js tests/unit/marketing-report-database.test.js tests/unit/marketing-report-lock.test.js
node scripts/run-marketing-report-native.mjs
npm run govern
```

The retained `build-isolated.mjs` wrapper initialized the existing owned SQLite
test fixture, cleared PostgreSQL aliases through the existing environment helper,
invoked `node node_modules/next/dist/bin/next build`, and cleaned up in `finally`.
It is a build wrapper, not an installer or another database authority.

## Interrupted run and resource custody

One composed attempt passed 17 cases and failed nine after its owned TEST
container stopped with exit 255 and `OOMKilled=false`; observation and cleanup
correctly remained FAIL. The operator confirmed a Docker/WSL stop or restart
during that window. Its first test log, FAIL observation, container state/labels
and PostgreSQL logs are retained separately. This is not a passing run, a reason
to raise timeouts, or proof of a PostgreSQL application defect.

After the engine was available, exact TEST/project/target labels and the stopped
container identity were checked before completing cleanup of only that run's
container, two volumes and private network. Subsequent targets were freshly
created; the interrupted container was not restarted. The clean-source run above
is separate evidence. No global prune or existing-stack cleanup was performed.
Final inventories found no resources remaining for any of the five run target
IDs. Pre-existing container/state, volume and named-network inventories matched.
The default bridge identity differed across the operator-confirmed restart;
no task command targeted it, and no deeper Docker restart diagnosis is claimed.

The following exact files are retained privately under the Task5 evidence
directory; hashes provide stable references without publishing raw local logs:

| Retained interrupted-run evidence | SHA-256 |
|---|---|
| `review-postgres.log` | `ca652ed4ea14d9c8b329cf1c805b640aca748dc09991d93fb0eebb1132a313fa` |
| `review-marketing-observation.json` | `515db73cf8ca0572dec277224905da6f8748b2366b58ca6e6bc93d8964064d3d` |
| `failed-owned-container-state.json` | `54a32a1b2b3844a4154d27b25b8c8a7c1a7e2ead8952852e2a6b44bd18941fd6` |
| `failed-owned-container.log` | `7de0e71eda8545b2ba8b3be38819d6fda5097b66cc9ec0ab746762e7497ccb04` |
| `interrupted-run-cleanup.json` | `dc192df718b0f41051802c8facfe4aeff04e686970a2ff0fb9cc7b3dadeeaa38` |

## Limits

- The PostgreSQL image is pinned to
  `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
  Execution used Windows Docker Desktop with Linux containers and Node 24.20.0.
  This is host resolver/receiver acceptance against an actual fresh database,
  with synthetic package inputs, not a qualified packaged web artifact.
- The resolver case supplies actual runtime clients to its existing injection
  boundary. The HTTP route is source-inspected/hash-bound and covered by existing
  wire/structural regressions; no PostgreSQL HTTP/browser E2E or deployment is
  claimed by these function-level cases.
- Paired Go, live Marketing delivery, persistent credentials, existing-data
  migration, Linux-host installation, complete operational restore and release
  remain separate. No production, provider activation or live send occurred.
- Hosted exact-head CI and PR/publication are not performed by this local
  requalification. AI profiles, Task6 and Task7 are not selected by this task.

Version diff: adds current source-bound Task5 qualification and error-path fixture
correction evidence; preserves issued identities, previous reports and release
boundaries. No canonical record, ADR or implementation-plan statement changed.

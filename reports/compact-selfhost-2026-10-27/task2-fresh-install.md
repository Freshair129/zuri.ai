---
doc_type: implementation-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
approved_plan_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
implementation_base: "eb888992be1b00e4b7d594a7737fd769c06130f8"
---

# Compact Task2 fresh PostgreSQL evidence

The owner selected Task2 of the approved [plan](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md)
on the existing `codex/compact-selfhost-plan-20261027` branch in the primary
checkout, explicitly permitting disposable PostgreSQL isolated from main-dev/UAT
and requiring independent review. This record is delivery evidence, not a new
requirement source, deployment approval or developer admission record. Tasks3–7
remain unselected. Production and existing runtime resources were not changed.

## Delivered behavior

The [operator contract](../../apps/server/deploy/compact/README.md) documents the
strict TEST target, separate private bootstrap/runtime files, build-time baseline
producer and bundled bare-Node CLI. The pure target planner has no I/O. Native
argument-array Docker execution pins the validated local daemon endpoint and
selected immutable image identities; it never invokes a shell, pulls an image,
deletes data or repairs an existing target. Package inventory and all payload
hashes are verified before runtime access. Private passwords enter contained
process environments, not argv, package files or generic diagnostics.

Fresh initialization rechecks physical database identity and emptiness inside a
single SQL transaction, applies current Prisma schema-diff DDL plus a reviewed
security snapshot, and records target/artifact/catalog identity atomically.
No Supabase migration history, backfill, seed, fake migration ledger, import or
upgrade is executed. The source inventory of130 migration hashes is a build-time
reconciliation guard. The snapshot includes 108 current CHECK constraints: 79 on
the six Phase B tables and 29 additional checks on 12 current public models.
It preserves eight exact Phase B scoped policy definitions, forced RLS, current
pricing restrictions and the non-owner runtime group/login contract.

An installed retry reads state only. Schema/ACL drift, preexisting large objects,
foreign volumes, nonempty databases and stale observations are refused. The
native catalog fingerprint covers schema plus database/table/sequence/function
and default ACLs, excluding the tool's own installation metadata. `status` and
`stop` still work when private credential files are absent; stopped status is
explicitly unverified and stop retains volumes/network. The Compose tools entry
point refuses the legacy `db push`; web/LINE use only the runtime DB aliases.

## Executed verification

Local toolchain: Node24.20.0, Windows Docker Desktop Linux engine29.9.2,
Compose5.6.1. The disposable image was already cached and selected by immutable
digest `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`
(`linux/amd64`, PostgreSQL16). Commands below are Server-relative unless stated.
The new Linux CI workflow declares Node22 and the same exact acceptance command;
no hosted run or Linux-host qualification is claimed.

| Command / observation | Actual result and scope |
|---|---|
| Corrected initial Node target/executor tests | RED:28 executed,28 failed for absent implementation; first51-case attempt duplicated test registration and was corrected |
| Baseline and portable bundled-CLI regressions | Observed missing baseline/producer and missing relocated CLI before fixes; retained first failures |
| Native initial PostgreSQL assertions | RED:5 executed,5 failed for missing implementation; two earlier setup errors executed zero assertions and are not proof |
| Additional real-engine regressions | Observed missing large-object refusal, schema/CONNECT drift coverage and pricing restrictions before fixes |
| Strict target types, lost private files and CI source filters | Observed failing Node cases before fixes |
| `npm run compact:test` | PASS: 111 executed, 111 passed, 0 failed/skipped; includes Task1 package/manifest/OCI and new target/baseline/executor/CI cases |
| `npm run test:postgres -- tests/postgres/compact-fresh-install.test.js` | PASS: 10 executed, 10 passed, 0 skipped; final evidence run 279.45s, with observations in the companion JSON |
| `node --test tests/node/document-profile-validation.test.mjs tests/node/canonical-document-registry.test.mjs` | PASS: 19 executed, 19 passed, 0 failed/skipped |
| `npm run build` | PASS: Next compilation, lint/type checks, 94 generated static pages and build traces; existing multiple-lockfile workspace warning retained |
| `npm test -- tests/unit/canonical-iam-runtime-role-cutover.test.js tests/unit/phase-b-feature-migration.test.js tests/unit/person-rls-hardening-migration.test.js tests/unit/ci-change-scope.test.js tests/unit/docker-publication-containment.test.js tests/unit/knowledge-studio/docker-runtime.test.js` | PASS: 6 files, 38 tests, 0 skipped; existing IAM/SQL/CI and Docker contracts |
| Root `npm run docs:registry`, `docs:graph`, `docs:views`, then `npm run govern` | Final PASS: 553 canonical records, graph freshness, 96 feature views; strict preflight 0 critical, 0 warning, 43 info |
| Root `npm run docs:llms` and `docs:llms:check` | PASS: local generated corpus current; ignored generated output is not staged |

The ten actual PostgreSQL cases cover all 210 current model tables and 2990 columns,
plus PK/FK/unique catalog parity against a separate generated-schema reference; Phase B CHECK and
policy definitions against its established isolated reference; actual runtime
role/GUC and cross-Business refusal; data-preserving installed retry; atomic
DDL/role rollback; owned populated-target and foreign-volume refusal; schema and
CONNECT-ACL drift; current pricing and IAM checks beyond Prisma; large objects;
a writer appearing between the last Docker observation and atomic SQL; and the
relocated packaged CLI with private files absent and volume-preserving stop.

The [redacted observations](task2-postgres-observations.json) retain exact TEST
target/project/container/network/volume identities, database system/OID identity,
baseline hashes, native catalog hashes and assertions.
The pricing/IAM and racing-writer records repeat one postcondition snapshot in
both slots; they do not measure a before/after unchanged catalog. Refusal and
rollback records compare distinct observations; the core record compares an
installed retry after data writes. Stop's after-state has no live DB observation
and cannot establish its catalog. An additional owner-label-verified read-only
catalog query counted 108 actual public CHECK constraints.
Fixture package component identities and storage/license assertions are synthetic, deliberately using the
PostgreSQL image for component slots. They test the installer and real database,
not a real Zuri release image, object store or license qualification. The recorded
schema-source commit identifies unchanged canonical model inputs; it is not an
assertion that the test package is a production release at that commit.

The Docker default subnet pools were exhausted on this machine. We retained the
failure and checked Docker IPAM plus host routes before choosing an explicit
disjoint private TEST subnet; no existing network was removed. Fixtures clean up
only exact run-owned resources after checking labels/IDs and physical temp paths.
The installer itself has no destructive cleanup command. Quoting errors in two
focused Windows regex invocations launched no tests; corrected native argv runs
and the final full wrapped command supply the evidence above.

The first governance attempt encountered a stale graph while the CI-selector
regression created its temporary `zz-ci-scope-probe` test file. The test removed
its own probe on completion. That failure is retained; generators and governance
were rerun serially after the regression finished, against the stable tree.

## Review and remaining gates

An independent GPT-6 Luna Max reviewer examined the same Task2 patch. Three
findings were corrected with regressions: incomplete ACL drift observation,
missing schema-producer CI path coverage, and status/stop requiring private files.
The final bounded review confirmed those fixes, the 108 CHECK/130 source-pin
reconciliation and the 10-case evidence JSON, with no remaining concrete Task2
blocker. The reviewer did not rerun Docker/PostgreSQL or hosted CI; its earlier
109-test Node pass predates the integrator's final 111-test composition.
Review evidence and command logs remain in the private
checkpoint alongside the original failures, without credential values.

`INSTALLED` proves the tested fresh database baseline only. Web/storage startup,
operator/login/signup, seven execution views, full business parity, actual
storage provider, LINE/Knowledge, restart/recovery matrix, hardware envelope,
exact-head hosted CI and release/production qualification remain their later
gates. No new worktree, push, PR, merge, publication or production action occurred.

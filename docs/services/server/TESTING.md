---
status: active
superseded_by: null
version: "0.2.0"
---

# Core / Server verification

[Package scripts](../../../apps/server/package.json) define `test`, `test:unit`,
`test:integration`, `test:postgres`, `test:e2e`, `test:e2e:changed` and `verify`.
The local `verify` chain remains governance, Server tests, build and E2E. The
repository-root command additionally runs Conversation Runtime test/build; it is
not a complete MI/SCM release qualification command.

The [related selector](../../../scripts/ci-change-scope.mjs) combines imports,
requirements, explicit test references, changed tests, source-pinning tests,
directory scanners and computed imports. Shared inputs, failed computation,
deleted source, empty selection and broad fan-out retain conservative fallback.
Do not bypass the zero-test or flaky-result guards.

The [Vitest config](../../../apps/server/vitest.config.js) serializes test files
for SQLite writer contention. Parallel CI shards require independent fixtures;
turning file parallelism on is not a substitute for fixture isolation. PostgreSQL
specific behavior needs the corresponding engine evidence.

Hosted PR/main policy and the new shadow pilot are defined in
[VERIFICATION-POLICY](../../architecture/VERIFICATION-POLICY.md). E2E in hosted
governance is scheduled/manual. Local `test:e2e:changed` narrows specs with the
existing selector but preserves warm-up. UI acceptance remains explicit.

Example: pricing changes select Commerce observers plus the SCM generated kernel,
drift/parity and relevant workflows. Identity/shared-authority changes expand to
affected consumers rather than testing only files under `identity/`.

## Knowledge worker lifecycle

`tests/unit/knowledge-runtime-loop.test.js` uses controlled clocks and deferred
work to exercise single-flight execution, drain/restart, bounded jittered
backoff, retry-budget cooldown and success reset. Throwing/rejecting observers
and hostile external errors verify that diagnostic delivery cannot stop work
or leak raw error text.

`tests/unit/genesisrag17-worker.test.js` checks the actual source-worker seam:
background observer failure still retries the exact persisted batch, while a
direct invalid acknowledgement rejects. `tests/unit/knowledge-runtime.test.js`
uses isolated Prisma state to check that a failed observer leaves the admitted
job's real run, retry classification and lease cleanup intact. Existing Tier 1,
evidence, publication and corpus regressions remain required for their boundaries.

These tests do not establish cross-repository native acceptance, live service
health or numeric SLO performance. The non-skipping `test:genesisrag17` command
requires explicit isolated provider/model roots; see
[operations](../../runbooks/GENESISRAG17-OPERATIONS.md).

Version diff 0.0 → 0.1.0: makes local/hosted coverage and cross-root inputs explicit.
Version diff 0.1.0 → 0.2.0: records worker lifecycle/observer regression scope
and native-acceptance limits under the approved ownership design.

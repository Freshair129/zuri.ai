---
version: "0.1.0b"
created_at: "2026-09-17T03:51:00+07:00,RWANG,uncommitted"
last_update: "2026-09-17T03:51:00+07:00,RWANG"
status: beta
attributes:
  domain: commerce
  doc_type: root-cause-analysis
---

# Catalog fixture left runnable jobs in the shared test database

## Symptom

The full regression suite failed the first durable Knowledge queue assertion:
`executionRunId` remained null after one `runOnce()`. The same seven runtime
tests passed alone against a fresh database.

## Evidence

The full-run log `.brain/reports/fr252/full-before-fixture-cleanup.log` records 6135 passed,
one failed and 32 skipped. The isolated run in
`.brain/reports/fr252/queue-isolated.log` passes all seven tests.
The seven-file reproduction in
`.brain/reports/fr252/queue-before.log`, using
`--sequence.shuffle.files --sequence.seed=17`, repeats exactly the same failure
after the catalog, SmartGift, corpus and candidate admission fixtures: 79 pass,
one fails. A smaller four-file admission set passes 30 tests.

`tests/global-setup.js` creates one database per run, shared by test files.
`knowledge-runtime.js:runOnce` selects at most 20 rows; the repository selects
the oldest runnable rows globally before `processJob` checks the configured
Business. The new catalog fixture adds three QUEUED rows and had no cleanup.
Its assertions prove those rows remain runnable with no execution identity.

## Root cause

The FR-252 fixture left its runnable queue rows behind. Combined with older
admission fixtures, those rows fill the first global batch before the later
runtime test's own job is selected. Its first tick therefore cannot attach a
pipeline identity. This is deterministic fixture interference, not clock drift
or a timeout in the tested executor.

## Why the issue escaped detection

Focused catalog and runtime runs each use a fresh database. Their independent
passes do not exercise the accumulated queue from the full suite.

## Proposed prevention and correction

After all catalog assertions, delete only ingestion rows belonging to the
Business created by this test. Keep production queue selection, batch sizes,
timeouts and existing assertions unchanged. Repeat the same seven-file order
to prove the failure is removed, then rerun the full regression suite. Global
worker fairness across unconfigured Businesses remains a separate finding.

## Verification

The identical seven-file sequence passes **80/80** after the scoped cleanup,
including all seven durable-runtime tests. Evidence:
`.brain/reports/fr252/queue-after.log`. The subsequent full regression run
passed all **6,136 executed tests**, with 32 existing skips and exit 0;
evidence: `.brain/reports/fr252/full-verified.log`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Reproduced catalog fixture queue interference and scoped its cleanup | uncommitted | RWANG |

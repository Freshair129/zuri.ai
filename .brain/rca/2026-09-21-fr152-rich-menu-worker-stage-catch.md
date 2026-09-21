---
version: "0.1.0b"
created_at: "2026-09-21T07:50:16+07:00,Luna Max"
last_update: "2026-09-21T07:50:16+07:00,Luna Max"
status: "candidate"
superseded_by: null
attributes:
  domain: "line-oa-studio"
  doc_type: "root-cause-analysis"
  scope: "TASK-ZAI-036 FR-152 rich-menu upload-stage catch"
---

# RCA — thrown rich-menu upload errors used the stale CREATE stage

## Symptom

When a rich-menu `PUBLISH` job successfully creates a LINE rich menu, persists
its external id, advances to `UPLOAD`, and then the upload transport throws, the
worker can classify the job using the original `CREATE` stage. The job is
reported as `UNKNOWN` instead of remaining retryable at `UPLOAD`.

## Evidence

- `apps/server/src/modules/line-oa-studio/application/line-oa-rich-menu-jobs.js`
  advances the mutable stage to `UPLOAD` after persisting the created external
  rich-menu id, but the outer catch previously read `job.stage` from the
  original claimed row.
- The catch maps `CREATE` to `UNKNOWN` and every later stage to `QUEUED`, so a
  thrown upload error exercised the wrong branch after a successful create.
- `apps/server/tests/integration/fr152-line-oa-rich-menu-jobs.test.js` covered
  returned retryable and permanent upload outcomes, but not a thrown upload
  transport error.

## Root Cause

The current publish stage was scoped inside the `PUBLISH` branch, while the
catch path used the immutable job snapshot instead of the stage updated during
execution. The persisted database stage was correct, but the in-memory outcome
classification was stale when the upload call threw.

## Why the issue escaped detection

The transport contract normally returns structured outcomes, and the existing
integration coverage exercised those returned retryable/permanent results.
Neither the test double nor the regression suite forced the exceptional path
where the upload transport rejects or throws after the create id has been
persisted.

## Proposed prevention

Keep the mutable execution stage in scope across the `try`/`catch`, and add a
regression test that accepts the create, throws during upload, and asserts
`QUEUED` at `UPLOAD` with the external id retained and create called only once.
This preserves the existing retry/UNKNOWN contract without adding a schema,
migration, provider call, credential, or production activation step.

## Evidence scope

The implementation and regression are local source/test changes using a fake
transport. They prove only the worker state transition. They do not prove
hosted CI, LINE provider reachability, a real-LINE canary, deployment, or
production health.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-21 | candidate | Preserved the current upload stage when a rich-menu transport throws and added regression coverage | working-tree | Luna Max |

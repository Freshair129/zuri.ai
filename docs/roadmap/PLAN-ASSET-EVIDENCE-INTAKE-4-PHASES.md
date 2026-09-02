---
version: "0.2.0b"
created_at: "2026-09-02T10:30:00+07:00,RWANG"
last_update: "2026-09-02T11:05:00+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "implementation-plan"
  scope: "Four ordered phases for ZV2-CR-010"
---

# Asset Evidence Intake — Four-phase plan

## Objective and success

Deliver the approved evidence-to-reviewed-intake slice on an isolated worktree. It is
successful only when the same canonical contract works through Web/API, Excel, Sheet
snapshot and trusted LINE handoff; AI remains candidate-only; the highest state is
`READY_FOR_REGISTRATION`; and the complete verification chain passes.

## Phase 1 — Survey repository documents and code

Work:

1. Read repository governance and enumerate branch/worktree/status.
2. Enumerate docs, modules, routes, Prisma models/migrations and tests.
3. Record authority/generation rules and run unchanged baseline tests/build/govern.

Verify: baseline commit, counts and command results are recorded in W1; no product
source is changed by the survey.

## Phase 2 — Survey relevant documents and code

Work:

1. Inspect Asset foundation, `FileAsset`, viewer/RBAC/audit, import/Excel, LINE transport,
   OpenAPI, backup and schema-parity seams.
2. Verify current OpenAI/Supabase contracts against official sources.
3. Freeze single-writer, data, route, security, idempotency, provider and rollback design.
4. Present the exact document topology and implementation defaults for owner approval.

Verify: W2 contains evidence, threat/authority matrix and exact file classes. Owner
approval is recorded before product code.

## Phase 3 — Update documentation and write RED tests

Work:

1. Add CR-015, ADR-056, ZV2-CR-010, FR-137..140 and this plan.
2. Update global requirement/feature/roadmap/API authorities and reserve IDs.
3. Add unit/integration/API/UI tests for storage, content policy, extraction, review,
   idempotent intake, RBAC, Excel, Sheet snapshot and LINE handoff.
4. Run focused tests and prove failures are missing implementation, not broken fixtures.
5. Run documentation governance.

Verify: W3 records IDs, changed docs and intentional RED output. No RED commit is sent
or merged independently.

## Phase 4 — Update code and test before delivery

Implementation order:

1. additive schema/migration and role registry;
2. object storage/file-management boundaries and upload policy;
3. Asset draft/evidence/review application services;
4. OpenAI extraction adapter;
5. Excel/Sheet/LINE adapters and routes;
6. receiving UI and OpenAPI inventory;
7. targeted tests, all tests, build, govern and E2E;
8. diff review, W4 evidence and commit.

Verify:

```text
npm test
npm run build
npm run govern
npm run test:e2e
npm run verify
git diff --check
```

## Scope gate

This plan does not authorize Asset ID issuance, `RegisteredAsset` creation, custody,
maintenance, stocktake, disposal, Procurement writes, Finance posting, native Google
OAuth/sync or LINE byte fetching inside zuri-ai.

## Owner approval

The owner approved this plan and its proposed document structure by replying `approve`
on 2026-09-02.

## Completion

All four phases are complete in the isolated feature worktree. W1–W4 preserve the
baseline, impact decisions, intentional RED checkpoint and final verification evidence.
Deployment credentials, production migration and live provider calls remain separate
operational gates and do not change this plan's local-delivery completion.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | beta | Recorded the owner-approved survey → impact → docs/RED → code/full-verification order | working-tree | RWANG |
| 0.2.0b | 2026-09-02 | beta | Completed all four phases with W4 full-verification evidence; deployment gates remain explicit | working-tree | RWANG |

# RCA: Phase-B frozen schema binding rejected Conversation Runtime owner fields

## Symptom

Hosted CI at S1 head `2e2154def4ede0a382f672bbf807eb4221f4fa92` failed to load
`tests/integration/phase-b-recovery.test.js`. The suite reported that the
committed frozen target inventory could not be loaded.

## Evidence

- The inventory and recovery loader pinned canonical `schema.prisma` bytes to
  `9ca8618d758d29387a0eaf79877a370c2ee8f24aadf09a07b4c103e0fe7f974a`.
- S1 added `runtimeOwner` with default `SERVER` to the existing
  `LineOaAccount` and `LineConversationJob` models. The exact current schema
  hash is `ffa2c121e08891b4de556480130d5a6e116979f151133a58fd0f23a98ba61f2d`.
- The application model count and public model/table mapping remain 188.
- The Phase-B decision requires an exact schema binding and refuses mismatches
  before database writes. Both LINE models are included in export; restore
  preserves `runtimeOwner`, disables the account and increments its epoch, and
  removes reply-token/claim-lease capabilities from restored jobs.

## Root cause

The S1 schema change was correctly rejected by the exact-byte fail-closed pin,
but the inventory, code-pinned digest constants, and their assertions were not
rebound in the same patch. The mismatch is a missing reviewed binding, not a
table-count or table-mapping change.

## Why it surfaced late

The Phase-B integration file failed during module initialization, so it could
not collect its recovery tests. Earlier S1 closeout work had deferred changes
to the Phase-B inventory while contract ownership was being escalated; the
hosted run then made the remaining mismatch explicit.

## Correction and prevention

Issue a new binding for the exact current schema bytes and recompute the target
binding from the unchanged 188-entry model/table map. Keep all fail-closed
checks, clean-target proof, and erasure/recovery behavior unchanged. Preserve
the old binding as historical and reject old schema-bound snapshots; do not
rewrite or rehash existing artifacts. Add regression coverage for rejecting
the old binding and preserving runtime-owner state under restore safeguards.

## Validation

The user-directed S1 rebind was independently read-only checked; this does not
represent S2 or contract-owner approval. Focused Phase-B and LINE backup
integration tests passed: 2 files, 13 tests. `npm run govern` passed with 0
critical, 1 warning, and 32 info; `docs:check` is current.

The prior `npm run verify` reached and passed governance, Server Vitest (787
files passed, 5 skipped; 6,819 tests passed, 42 skipped), Server build, and
Conversation Runtime unit/build (33/33 tests; 8 source files). Its E2E leg
failed to start because port 3100 was already occupied; that process was left
untouched. A separate full `npm run test:e2e` at `E2E_PORT=31920` completed
with 207 passed and 4 skipped (211 executed). The standalone E2E result does
not turn the prior `npm run verify` invocation into a passing aggregate run.

No hosted CI/image build, production database operation, recovery operation,
migration, live LINE send, or real model call was performed for this local
patch.

For published PR head `2e2154def4ede0a382f672bbf807eb4221f4fa92`, GitHub run
`36182888167` passed Conversation Runtime (including Compose path verification,
hosted image build/recording, and disposable drain/stop smoke) and governance;
Edge CI run `36182888222` passed. The Server tests job at that published head
failed only at module load because the frozen Phase-B inventory hash did not
match the schema. These hosted passes apply to the published head, not the
local re-pin candidate.

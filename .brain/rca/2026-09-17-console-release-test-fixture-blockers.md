# Console release test fixture blockers

Version: 0.1.1b

Status: APPROVED — user approved fixture repair and public source publication on 2026-09-17. Implemented; verification pending.

Scope: verification of TASK-ZAI-047 release candidate 13c3e2da1576ce3f337a275ddb006ab3ffb89635. Complexity C-2; proposed change risk LOW (two test files only, no runtime or schema changes). Production deployment remains HIGH risk and gated separately.

## Symptom

The complete Server suite finished with 6,024 passed, 32 skipped and two failed tests (726 files). Knowledge runtime did not attach the fixture admission to a run. Usage rollup replay returned a second receipt. Production has not changed.

## Evidence

- `.brain/knowledge-console-release-tests-complete.log`: full run, exit receipt 1, duration 471.42 seconds; failures at knowledge-runtime.test.js:75 and usage-events.test.js:181.
- `.brain/knowledge-console-release-repro.log`: runtime passes all seven tests alone alongside usage; usage replay still fails, 16 passed / 1 failed.
- `.brain/knowledge-console-release-queue-repro-3.log`: Console, SmartGift catalog, FR-236 candidate, FR-236 Stage 5 agreement, FR-238 description and runtime reproduce the same missing executionRunId assertion, 78 passed / 1 failed.
- Console integration fixtures leave three QUEUED admissions, dated 2026-09-17T01:00:00.001Z, without cleanup. The five contributing fixture suites leave 22 QUEUED rows: SmartGift 14, candidate 1, Stage 5 agreement 1, descriptions 3, Console 3. Runtime's new row follows these in createdAt order.
- `knowledge-repository.js:listPending` selects the oldest 20 rows before processing. Null lease expiry makes the Console rows eligible even with their fake claimToken. A source withdrawal may leave a queued admission until processing; it still occupies the selected page.
- Usage test passes September 16 as its explicit clock, but fake audit persistence at usage-events.test.js:89 stamps new Date(). Replay lookup filters the receipt to September 16. On September 17 the first receipt is outside that day. The usage service, test and audit helper are byte-identical between live11675e59 and release13c3e2da; this fixture was introduced in a12c5f57.

## Root cause

The Console read tests contaminate the shared per-run database with pending work. Combined with existing admission fixtures, they push the runtime fixture beyond the queue's page size. Separately, the inherited usage replay test mixes a fixed service clock with the host clock in fake persistence. Neither failure justifies changing production behavior or weakening assertions.

## Why detection missed this

Focused suites do not fill the queue enough to expose cross-file state. The inherited usage test happened to run on the same UTC day as its fixed fixture when introduced. Previous partial runs and the memory-exhausted run were not complete proof; they must not substitute for the failed complete run.

## Proposed prevention and exact changes

1. In `apps/server/tests/integration/fr253-knowledge-console.test.js`, add afterEach cleanup deleting only KnowledgeIngestion rows whose corpus belongs to the current fixture's two businesses. Include its project corpora via the same business predicate. Preserve original statuses and every assertion; do not clear unrelated suites' data.
2. In `apps/server/tests/unit/usage-events.test.js`, freeze Date only for the UTC-day replay case to its supplied timestamp; advance it to the replay timestamp and restore real timers in finally. Preserve receipt identity, alreadyRanToday and single-audit assertions.
3. Run the combined six-suite reproduction plus usage; then complete Server suite serially, governance and full ordinary E2E. Stop at failures; never replace the full run with focused green results. No production service, schema, security, runtime capability or GKS/MSP contract edit is proposed.

Acceptance: original failing assertions pass in the combined reproduction and full suite; no skipped/newly weakened assertions; full E2E has zero failure/flaky results. Record exact final source SHA before building/deploying.

## Independent publication blocker

Automatic approval review initially rejected pushing the release and frozen production-base branches and opening a PR because this exports source to the public Freshair129/zuri.ai repository without destination-specific authorization. Read-only verification confirmed the repository is public and the live baseline commit already exists there. The user subsequently explicitly approved fixture repair and publication to that named public repository on 2026-09-17. Publication may now proceed after recording the repaired source revision.

## Completed deployment preparation

Candidate image release-13c3e2da was built successfully from the exact Git archive. Offline image route checks retain both Console and live CRM legal-hold routes. Live read-only database preflight found all nine required tables. The prepared final Compose mount override retains the two live web mounts and zero worker mounts; comparison found no changed or added configured environment variables. Knowledge runtime remains disabled. Live web is healthy on release-11675e59; rollback preserves that image. No production mutation occurred.

## Version diff

RCA 0.1.0b proposal -> 0.1.1b approved. The two test changes above are applied on top of 13c3e2da. Production behavior and schema are unchanged. Operational receipts retain the original failed run and will record subsequent verification separately.

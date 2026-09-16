# Knowledge ingress readiness gap

## Symptom

Users can store files or stage extracted documents, but those surfaces do not create a complete user-visible GenesisRAG ingestion/query journey.

## Evidence

Tracked Server route and caller enumeration at dfdbaf11 found `/api/files` calling createManagedFileAsset, `/api/ingest/documents` and MCP document_stage calling CloudSoTAgent staging. Neither invokes ingestGenesisRag17Raw. That function and queryGenesisRag17 have only internal runtime/acceptance callers. The source-worker start is in acceptance harnesses. A focused 14-file intake test run passed 81 tests, demonstrating separate components, not their connection.

## Root Cause

The approved original delivery intentionally excluded new UI and production source integration. No shared user-facing admission, source-to-corpus registry or public query/citation adapter had been implemented. Individual component success was broader than the evidence needed for an end-user readiness claim.

## Why the issue escaped detection

Native acceptance proved the internal raw entrypoint through 17 stages. File and staging tests proved their separate responsibilities. Neither test started in the actual Files UI or a generic knowledge HTTP admission and ended with a published corpus query.

## Proposed prevention

Implement owner-approved ADR-072 phases 0–4. Separate admitted/staged/published/corpus-ready statuses, preserve scope/source/receipt identities, test from actual UI/API/MCP surfaces, and maintain an endpoint inventory that labels unconnected and proposed paths. Do not weaken operator or tenant guards to attach ordinary users to an internal executor.

## Implementation regression caught before integration

The focused runtime failure test initially left an admission RUNNING after Stage 1 committed FAILED evidence. The private runtime had reporter authority but `finishKnowledgeIngestionRun` called `getPipelineMonitor`, whose guard accepted only ordinary visibility or the old external reporter. Thus the newly scoped runtime could write the exact run but could not read it to derive its terminal outcome.

The monitor now recognizes only `hasKnowledgeRunAuthority` for the capability's exact executionRunId, knowledge definition, Business and Tenant. Ordinary pipeline listing and replay remain unchanged. The queue also distinguishes persisted failed intent from transport reply loss: it closes actual failure evidence instead of retrying a terminal attempt. `tests/unit/knowledge-runtime.test.js` reproduces the failed Stage 1 case and verifies both admission and PipelineRun become FAILED; the seven runtime tests pass. This was caught in focused implementation tests, not observed or claimed on production.
### Integration verification: shared generated-client path

The 2026-09-08 native regression passed 24 of 25 tests. The last source-process crash test failed before Stage 8 with Prisma P2021 (`main.Business` missing), while the earlier Stage 3 child and the parent had read the same disposable database successfully. Parallel worktrees share a generated Prisma client; its baked schema directory can change when a sibling runs generation. A relative SQLite URL then resolves against the new schema directory in a newly spawned child. The test setup already documents this generated-client behavior. The child must validate its disposable database path, then pass that exact absolute path to Prisma. This changes test-process addressing only; it does not retry a failed assertion or weaken the crash gate.
### Actual surface acceptance: native query response mismatch

The first real Files UI + HTTP run published two independent documents with all 17 successful stage records and matching native receipts. Its first HTTP corpus query then failed: the strict zuri query schema rejected `results.*.snapshotId` and `results.*.generation`. GenesisBlock's `searchGeneration` returns those identities on each hit, and MSP relays them unchanged. Earlier native acceptance called MSP directly, bypassing zuri's query parser; mocked corpus queries also bypassed that parser. Align the strict zuri schema with the actual pinned worker response and require each hit's snapshot/generation to equal its response envelope. Keep unknown-field rejection and add a mismatch regression. Full UI/API acceptance must pass through this parser.
### Actual MCP acceptance: valid string request ids rejected

The actual `/api/mcp` initialization returned HTTP 400 for id `knowledge-initialize`. `validateRequest` allowed type string or number, but then applied `Number.isFinite` to both types, rejecting every string. Previous transport examples used numeric ids, so they never exercised the documented string branch. Apply the finite-number check only to numbers; regression tests cover string/number ids and still reject null, booleans and non-finite numbers. The native MCP test retains string ids rather than working around this failure.

### Final native surface acceptance

Both new surface scenarios passed, but their report hook initially used `findUnique({executionRunId})` for GenesisRag17Batch, whose identity is `(executionRunId, stage9AttemptId)`. The export now selects the exact Stage 9 evidence attempt and validates complete corpus manifest hashes. The complete suite then passed 2/2 including export: four runs, 17 terminal evidence rows each, four native snapshots and five corpus generations.

The dev harness also exposed module-local MCP session loss after lazy HTTP route compilation. MCP stores sessions in a transport closure created by the route module. Warming all knowledge HTTP/MCP routes before initialization follows the existing E2E warmup pattern; unauthenticated probes must return 401. Explicit Next restarts initialize new protocol sessions. This is isolated development-server evidence, not a production session incident.

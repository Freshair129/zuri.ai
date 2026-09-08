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

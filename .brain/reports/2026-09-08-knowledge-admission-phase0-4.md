---
version: "1.0.0b"
status: beta
created_at: "2026-09-08T19:36:00+07:00,RWANG,base dfdbaf11"
last_update: "2026-09-08T19:36:00+07:00,RWANG"
---

# Knowledge admission — phases 0–4

Status: phases 0–4 implemented and validated in the isolated profile. Risk HIGH / C-3. Owner-approved isolated implementation; no production activation or deployment.

## Delivered behavior

Existing Files and Project Files share Text/Markdown and readable UTF-8 FileAsset admission with five HTTP paths/six operations and six authenticated MCP tools. Immutable admission, source versions and runtime leases persist before processing. A private runtime capability binds the exact execution run; ordinary viewers cannot impersonate a publisher.

Every admitted document executes the existing 17-stage chain through MSP, GKS and the native worker. Only a successful run with a matching publication receipt can enter a corpus generation. The Tier 1 corpus manifest combines independently published document snapshots. It is not an aggregate native graph or a replacement GKS gate. Correction replaces only its source; withdrawal changes membership without deleting historical native snapshots.

Query pins one manifest, queries explicit native snapshots, ranks with RRF k=60 and verifies citation lineage. Live Business/Project/FileAsset/source authorization is checked again before content is disclosed. Corpus owners can withdraw membership after a FileAsset is deleted; that operation neither reads nor mutates the deleted file.

## Validation

| Check | Result | Evidence boundary |
|---|---|---|
| Full Server unit/integration suite | 4,344 passed; 14 skipped; 0 failed | 532 passed files; external prerequisites below |
| Next build | Passed | Local integration worktree |
| Actual four-process 17-stage recovery | 25/25 passed; zero skips | Real native CPU embeddings, processes, crash/reply-loss/replay, two populated tenants and backup restore |
| Files browser regression | 5/5 passed; zero flaky | Includes warmup and FR-045/FR-058 browser cases |
| Genesis worker tests | 14/14 passed; zero skips | Actual native store; worker tests use their declared embedding/gate seams |
| New Business surface/native suite | 2/2 passed; zero skips; report export passed | Actual Next UI + session HTTP/MCP + native worker; no manual stage success |
| Governance | Passed: zero critical, duplicate IDs, dangling edges or link findings | Root alone ran graph/check/strict preflight; 527 stable IDs, 135 models |

The 14 skipped Server tests are nine PostgreSQL LINE activation/isolation tests and five LINE/zuri-cli round-trip tests. They are unrelated external-service profiles, not skipped knowledge acceptance. The complete repository-wide Playwright suite and production PostgreSQL migration application were not run; do not describe this as a full `npm run verify` or a production release.

The new native surface suite covers browser Text admission, MCP Text admission/idempotency, HTTP status/list/query/citation/correction/withdrawal, MCP query/citation, real restart/lease recovery, two-document serving, retained historical citations, managed Markdown upload followed by FILE admission and binary FILE rejection. Browser query controls, Project-scoped native execution and bearer/API-grant native execution are not covered by that harness. Project/authorization/delayed-revocation behavior has unit and real-Prisma service evidence; native publication and lineage seams in those service tests are explicitly mocked.

## Reproducible identities

| Component | Revision |
|---|---|
| zuri baseline | `dfdbaf116cf942adbd8b5f9406a0384ad116bb04` |
| zuri integrated agent checkpoint | `03256b74` plus reviewed integration fixes in this report's commit |
| MSP | `8e16a54aa8c6893f383ca7bfe046d5e2ca75422c` (unchanged in phases 0–4) |
| GKS | `faa946f3df2bbf318f575879d070cda2b4afd116` (unchanged in phases 0–4) |
| GenesisBlock worker/test checkout | `a11bc2a7e235740cce80ec1291ed1dc0dded4a40` |
| Native engine pin | `e15e35b0093394e0a8880af7f4e6f63cf81223b7` |
| Model | `intfloat/multilingual-e5-small`, revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`, CPU, 384 dimensions, cosine |
| Runtime | Node `v24.18.0`, Windows x64 |
| Protocols | `genesisrag17.v1`, `knowledge-corpus.v1`, `knowledge-admission-recovery.v1` |
| Migration | `20260908100000_knowledge_admission`, additive SQLite and PostgreSQL schemas |

[Recovery evidence](knowledge-admission-recovery-native.json) records a real raw-to-published run and the fixed fixture benchmark: Recall@5=1, MRR=1, citation correctness=1, cross-tenant leaks=0. Those are fixture measurements, not production quality claims. [Surface evidence](knowledge-admission-native.json) must be produced by the passing suite and retains four document-run identities, all 17 evidence rows per run, raw/parsed/chunk lineage, publication receipts, native snapshots and corpus manifests.

Logs and machine test reports remain in `C:/Users/pc/workspace/ki17-runtime/`: `knowledge-final-regression-r2.*`, `knowledge-final-build.log`, `knowledge-native-regression-r2.*`, `knowledge-files-e2e.log`, `knowledge-genesis-worker-final.log`, and the final `knowledge-surface-native-r6.log`. Earlier failed runs are retained as debugging evidence, not silently reclassified as passes.

## Constraints and extension points

This profile uses one configured Business scope/native store per runtime. The code path is shared; tenant/business data and corpus membership are not globally shared. More than one binding fails closed. Cross-store routing, organization-wide sharing, binary parsers/OCR, URL retrieval, domain-record connectors, LINE promotion and aggregate cross-document graph traversal remain later work.

Start extensions at the [stage flow map](../../docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md) and [surface inventory](../../docs/KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS.md). Source adapters enter before Stage 1; transformations use the existing stage owner contract; corpus membership is composed after Stage 17. There is no Stage 18.

## Integration findings

The actual surface tests exposed strict query-schema drift (native hit snapshot/generation fields), invalid rejection of string MCP request ids, and the acceptance report's incomplete Stage 9 composite lookup. The source crash harness also needed an absolute, validated disposable DB path because worktrees share a generated Prisma client. See the [RCA](../rca/2026-09-08-knowledge-ingress-not-connected.md).

Next dev lazily loads route modules; the MCP registry is process/module-local. The acceptance harness now warms knowledge HTTP/MCP routes before initialization, asserts every unauthenticated probe returns 401, and opens fresh protocol sessions after server restarts. No retry hides a failed tool call and no authentication guard is bypassed.

## Version diff

Spec `1.4.0b → 1.4.1b`; flow `1.3.0b → 1.3.1b`; surface inventory `1.1.0b → 1.1.1b`; admission ADR/contract/feature note `1.0.0b → 1.0.1b`; native contract `1.3.0b → 1.3.1b`; API appendix `1.52.0b → 1.53.0b`. Stable requirement/stage IDs are preserved. Generated metadata and graph views are regenerated by `npm run govern`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-09-08 | beta | Isolated phases 0–4 delivery, acceptance evidence and explicit runtime/test limits | this report's commit | RWANG |

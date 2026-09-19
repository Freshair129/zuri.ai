> Historical implementation evidence: this report used unpublished Console ID FR-253. During release composition, published Pricing owned FR-253 and Console moved to FR-254 under AGENTS section18. Historical run filenames below remain unchanged.

# TASK-ZAI-047 — Knowledge Console phase report

Version: 0.2.0b

Status: REVIEW — Console gates validated locally; full regression blocked by inherited FR-213 keyboard failure

Date: 2026-09-17

Requirement: FR-253 / FEAT-013

Complexity/risk: C-3 / HIGH

Branch: codex/task-zai-047-knowledge-console-20260917

Base: 099ebc8fcb72eafdead0b4530f02a4f72b925ee1

## Approved scope and result

The owner approved the 0.1.0b Console specification on 2026-09-17. The isolated implementation adds `/knowledge/console`, six API handlers plus GET source history, an owning integration read port, and Files/Dashboard navigation. It reuses existing admission, query, scope, manifest and publication validators. No schema migration, GKS contract, production deployment or live import is included.

Source versions, complete run attempts including unlinked Business-only legacy runs, current/historical corpus generations and exact citation artifacts are paged/scoped read projections. Raw/parsed downloads resolve immutable citation lineage rather than mutable FileAsset bytes. Runtime unavailable, empty and failed reads are distinct. Missing or inconsistent publication evidence never becomes a verified snapshot.

## Verification ledger

| Check | Observed result |
|---|---|
| Initial full Server baseline | 5,252 passed, 15 skipped, one generated programme-container mismatch after approved documentation update; regenerated through the sanctioned command |
| New backend/route tests and adjacent inventory/warmup checks | 53 passed, zero failures; log `.brain/knowledge-console-targeted-final.log` |
| Full Server final run | 5,287 passed, 15 skipped, zero failures across 647 files; log `.brain/knowledge-console-test-final.log`. The earlier run's two route-registration bookkeeping failures were corrected before this clean run |
| Governance | PASSED, exit 0: zero critical, one existing dangling-test-ID warning; final log `.brain/knowledge-console-govern-release-final.log`. A changelog table separator found during final regeneration was corrected before this clean run |
| Final generated-state checks | 26 passed across programme-container, task-evidence and domain-state suites; zero skipped/failures; log `.brain/knowledge-console-generated-tests.log` |
| Browser fixtures | 6 Console scenarios + warmup = 7 passed, zero retries/skips. Navigation/Dashboard unit checks: 8 passed. Early locator ambiguities were corrected before this clean run |
| Native browser admission → publication → query → three citation layers | PASSED: 2 tests, zero skips; 4 actual native runs with 17 successful stages each, immutable publication receipts and 5 corpus generations. Final log `.brain/knowledge-console-native-complete.log`; machine-readable proof [knowledge-admission-native.json](knowledge-admission-native.json) |
| Production build | PASSED locally, exit 0, repeated after final generated data changes; compilation, lint/type validation, static generation and build tracing completed; final log `.brain/knowledge-console-build-final.log` |
| Full ordinary browser regression | FAILED, exit 1: 178 passed, 4 skipped, 1 failed, 0 flaky (183 unique tests, 14.6 minutes). FR-213 map keyboard selection fails both attempts; the baseline redesign removed its keyboard handler. All 6 FR-253 cases pass. Retained JSON/stdout: `apps/server/node_modules/.cache/zuri-test-proof/fr253-full-playwright.json` and `fr253-full-e2e.log` |
| Production/hosted CI | NOT_RUN; not authorized by this implementation approval |

Backend coverage includes 121 tied-timestamp source rows, foreign scope/cursor rejection, source/file/domain revocation, permission changes during reads, corrupt source/corpus bindings, all legacy step attempts, unavailable publication evidence, immutable older content after a new file version, tamper/missing-artifact rejection and complete UTF-8 downloads. Browser fixtures are explicitly not native evidence.

The full Server run's 15 skipped tests belong to line-binding-activation.postgres (5), controlled-line-activation.postgres (3), line-oa-cross-repo-round-trip (5), fr110-knowledge-evidence-chain (1) and runtime-isolation-probe.postgres (1). They are not counted as passing or as live integration evidence.

The four ordinary browser skips are existing adaptive-shell cases in `smoke.spec.js`, superseded by FR-041. The failed map file is unchanged by this branch; base commit `099ebc8f` / PR #391 removed Enter/Space activation from its SVG nodes. See [inherited regression RCA](../rca/2026-09-17-existing-pipeline-map-keyboard-regression.md). It is recorded outside the approved FR-253 scope under AGENTS R9. The complete `verify` gate is therefore not green; this report is not release clearance.

## Native acceptance prerequisites

The actual existing admission harness uses disposable Tier 1 SQLite, MSP/GKS SQLite and native store paths, isolated fixture credentials and a local E5 model. No external store is read directly by the Console.

| Component | Selected revision/path |
|---|---|
| MSP | 4ca98c3008d43c6295e886a2c1382d49172d274f |
| GKS | ecf1e4de269e949406a6a5f791f9ff8fe30c9578 |
| GenesisBlock native worker | 7c9261c4a4d4193af4e2613db48896533eb28072; GKS task's immutable `pricing-native-runtime` archive. Four runtime sources match the commit after CRLF normalization; addon SHA256 108c1fca91be9179ff7c70cd968cb30249e5b8b6415d6035cb4d963e6ed22347 |
| E5 model | intfloat/multilingual-e5-small, 614241f622f53c4eeff9890bdc4f31cfecc418b3; worker verifies pinned local artifact hashes |
| Python | task-local environment; onnxruntime 1.30.0, tokenizers 0.23.2 |

The first worker selection at 610c1047 accepted only ontology_v1 and was incompatible with current GKS. Exact read-only validation returned DECISION_VERSION_INVALID for its two ontology_v2 decisions. That stalled run was stopped without changing a validator. See [runtime-selection RCA](../rca/2026-09-17-knowledge-console-native-profile.md). The replacement is Windows isolated acceptance, not the Linux deployment-image acceptance described by the companion pin manifest.

The successful run admitted text through the Console, inspected source versions, the real processing run and corpus history, searched the published corpus, opened all three cited artifact layers and downloaded the exact raw text. It also exercised HTTP correction, source withdrawal, MCP querying and the existing Files admission/binary-refusal flow. Screenshot: [native Console artifact view](../knowledge-console-native.png). Before the final clean run, the browser helper's corpus-field locator was scoped to its query form, and the following MCP regression starts a fresh protocol handshake after Next dev cold-compilation; assertions and runtime validators were preserved.

| Native admission | executionRunId | snapshotId |
|---|---|---|
| Console text A v1 | 58b97ef6-cea6-4e2d-8c1d-64adb23b4ac3 | snap-d1700404127e9d0d3281ee8e3143cd12 |
| MCP text B v1 | e8902dcc-e2ac-4e4e-96f6-d9ab78f45afc | snap-7fe3f3ba96487fd3a1328a41fd090f68 |
| HTTP correction A v2 | 78ce507e-aa7e-4d9e-93f9-d873123e70f1 | snap-d317d09ed52ef236fb11d66aa4c8c640 |
| Files admission | 6f092d08-2278-40aa-8282-3fac9cbd0d08 | snap-25b0ea2c63315ba5e1637142bb883684 |

## Version diff

| Document | Before → after |
|---|---|
| Console specification | absent → 0.1.0b candidate → 0.2.0b approved → 0.2.1b evidence link |
| PRD registry | 1.213.0b → 1.214.0b; new FR-253, existing IDs unchanged |
| Feature registry | 1.51.0b → 1.52.0b; FR-253 joins FEAT-013 |
| API appendix | 1.70.0b → 1.71.0b; 276 handlers / 372 operations |
| Interface inventory | 1.24.0b → 1.25.0b; 106 pages / 56 navigation entries |
| Delivery roadmap | 2.79.0b → 2.80.0b; TASK-ZAI-047 owns FR-253 |
| Programme roadmap / task container | 0.4.5 → 0.4.6 / 0.1.0 → 0.3.0; TASK-ZAI-047 in review with checked local criteria; SPR-ZAI-03 7%, PHASE-ZAI-02 5% |
| Feature note | absent → 0.1.0b approved → 0.1.1b evidence link |

## Limits

An empty Files list still means no matching managed FileAssets; the Console does not fabricate files, backfill unknown GKS sources or activate an unavailable pipeline. Binary parsing, durable production storage, runtime activation and concurrency remain the separately defined tasks. TASK-ZAI-047 remains in review: its local Console/native/build gates passed, but full browser regression has the inherited FR-213 blocker above, and hosted CI/production deployment were not run.

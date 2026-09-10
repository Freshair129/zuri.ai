---
version: "1.0.0b"
status: beta
created_at: "2026-09-11T00:30:00+07:00,RWANG,984b7324"
last_update: "2026-09-11T00:30:00+07:00,RWANG"
---

# Memory thread and execution-trace finish

This isolated lane started from `origin/main` `f320e888a7f6fbb978fd274a791eca89bf3eb7e4` in `codex/finish-memory-20260910`. It reconciles the approved P3 execution-trace memory linkage (`FR-171`) with main's existing P1/P2 work and carries forward the reviewed LINE thread-memory/context/delivery adapter slice. It does not replay the parent squash, introduce a new requirement id, activate production runtime, send LINE messages, or edit the MSP repository.

## Delivered in source commit `984b7324`

- Added the canonical MSP thread adapter and bounded context packet. It resolves opaque LINE routes, labels HUMAN/AGENT messages, enforces DIRECT-only private recall, keeps tenant/business identity fences, and fails closed when configured service-key or transport prerequisites are absent.
- Added the two-pass agent turn seam: resolve and append the trusted inbound message, retrieve the current exchange, inject only an `ALLOW` packet into the model, append the Zuri outbound as `QUEUED`, and re-check authorization before outbound append.
- Added provider injection receipts with API-010 ordering `RESOLVED -> SUBMITTED -> COMPLETED/FAILED`; `SUBMITTED` is recorded after invocation starts. A lost receipt write produces `UNKNOWN` and does not relabel a successful model as `FAILED` or permit a fallback effect.
- Added FR-171 `memory-write-trace.v1` linkage validation at append and replay. Replay exposes memory evidence only as reference data and marks MSP session authority unavailable when API-009 has not attested a replayable session.
- Added LINE delivery receipt lookup against the persisted scoped CRM outbound row. `line-conversation-jobs.js` was intentionally untouched: its admission, claim, settle, reconcile and provider-send ownership remain with the OA lane. The memory seams are `handleAgentTurn`, `assembleAgentContext`, `createMspThreadMemoryPort`, the LINE webhook route, and the delivery route's persisted-reply receipt hook.
- Recorded the contract-drift RCA and a reproducible cross-repository evidence command. The actual MSP handlers/storage accepted a signed direct inbound append without an authorization/requesterId claim (the append contract authorizes the HUMAN speaker and this is non-private input), while mismatched cached tenant/business scope and mismatched delivery business were rejected.

## Verification

| Check | Result |
|---|---|
| Independent install | `npm --prefix apps/server ci` and `npm --prefix apps/edge ci` passed |
| Server regression | 558 files passed; 4,568 tests passed; 15 skipped; zero failures |
| Focused memory/context/receipt tests | 2 files, 17 tests passed after final receipt change |
| Real MSP cross gate | From the MSP worktree, `MSP_TEST_ZURI_ROOT='C:\\Users\\pc\\workspace\\zuri-ai-finish-memory-20260910'; npm run test:cross-zuri` passed 1 file / 1 test using actual MSP handlers/storage |
| Server build | Passed (`npm --prefix apps/server run build`) |
| Governance | Passed: strict preflight zero critical/warning; docs graph/check refreshed |
| Diff hygiene | `git diff --check` passed |
| Lint | Blocked by repository tooling: `next lint` opens the interactive ESLint setup prompt because no `eslint.config.*` is present; no lint result is claimed |

## Approved boundary and remaining phases

The completed boundary is the reviewed adapter/context/receipt plus incremental FR-171 linkage. The following remain future work and are deliberately inventory-only: DM onboarding/provisioning with signup-owned personal-data collection; policy/rights inspector UI; production compaction/session-worker host and model credentials; retention/erasure deployment; browser/native acceptance; production activation and real LINE delivery/read evidence; and an authorized producer for automatic protected-memory extraction. The current lane does not claim those phases, private-memory production readiness, runtime activation, or real-provider delivery.

Root integration must resolve this source commit before merging the parallel OA worker. When OA injects memory, it should pass the trusted `threadMemory`/`threadRoute` at the agent answer seam, preserve CRM/transport delivery ownership, and retain `QUEUED`/`ACCEPTED`/`DELIVERED`/`UNKNOWN` evidence semantics. No MSP source files were changed.

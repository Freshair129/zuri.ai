# RCA - Edge Device surfaces remained in the standalone Edge app

**Date:** 2026-09-26
**Scope:** `apps/edge` active UI, configuration, CLI/API client, Tauri harness, and associated tests
**Baseline:** `26a77deab050135ab159fcc768c6584cd395d3c5`

## Symptom

After the server-side Edge Device retirement work, `apps/edge` still contained an active pairing/token panel, device-specific environment configuration, a `zuri-api` command client, and test-only Tauri supervisor/credential/logging harnesses. The handoff's claim that the Edge callers had been removed was therefore ahead of the actual cross-app state.

## Evidence

- At the stated baseline, `apps/edge/edge-gui.html` still rendered pairing inputs and imported pairing JSON; `apps/edge/src/config/index.ts` still loaded `ZURI_AGENT_DEVICE_ID` and `ZURI_AGENT_DEVICE_TOKEN`; and `apps/edge/src/zuri-api/client.ts` still sent device identity/token headers.
- The same baseline included `apps/edge/src-tauri/src/supervisor.rs`, `durable_log.rs`, and `packaged_runtime_tests.rs` (all `#[cfg(test)]` only), plus `credential_store.rs`, which no module declared and so was never compiled.
- The current retirement diff removes those active paths. `apps/edge/tests/contract/edge-device-retirement.test.ts` asserts that legacy credentials are ignored, pairing/API callers and harness entrypoints are absent, and `package.json` still starts the RAG service.
- `git diff --quiet -- apps/edge/src/rag` confirmed that the RAG source tree is unchanged. The remaining search hits for `pairing` and `heartbeat` are a GPU-adapter test name and an outbox process-liveness comment, not Edge Device identity or transport behavior.

## Root Cause

The retirement was tracked as server-side route/extraction work and did not enumerate the separate `apps/edge` client application as part of the same removal. As a result, the server-side change left its UI, configuration, API caller, and local desktop harness in place.

## Why the issue escaped detection

Existing tests asserted the behavior of the device client and harness while they existed; there was no cross-app contract test that failed when retired device surfaces remained active. The separate Edge dependency tree and GUI/Tauri code also made a server-focused review insufficient to establish that the device feature was gone end to end.

## Proposed prevention

Keep `edge-device-retirement.test.ts` as the focused absence contract across the UI, environment configuration, CLI/API client, Tauri harness, and RAG launch command. Reconcile the handoff against that contract and review the app-wide diff before claiming retirement complete. Preserve RAG source and opaque historical records.

## Current disposition

The source retirement is committed to PR #542 (2026-09-27), after MC0 re-ran the checks below on the merged branch and an independent review passed it. `npm ci` installed 303 packages. `npm run typecheck` and `npm run build` passed. The focused retirement contract test passed 2/2, and the full host-permission `npm test` suite passed 767 tests across 144 suites (764 passed, 3 skipped, 0 failed); dotenv loading was disabled, LLM/headless were disabled, and the API key environment variable was blank. `cargo test --lib` passed 25 tests, with 3 ignored. The install reported 10 dependency audit findings (4 moderate, 5 high, 1 critical); no dependency update was applied. No push, merge, deployment, production secret access, real model call, or live LINE send was performed.

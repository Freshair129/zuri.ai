# Server-owned LINE / optional Edge implementation devlog

Date: 2026-09-06. Owner request: write ADR and implement the revised architecture in both repos.
Upstream decision/requirement: ADR-061 / FR-150, documented in `SERVER-LINE-OPTIONAL-EDGE.md`.

Implemented strict conversation execution v1 client, single-job polling worker, bounded local
answer adapter, CLI once/serve, device heartbeat, compute-only Docker/npm/PowerShell defaults,
explicit legacy webhook gate, and stateless headless execution. LINE transport and CRM writes
are absent from the compute client's API. Existing extraction and explicit legacy transport
remain available. The previous Codex dangerous sandbox-bypass flag was removed: all Codex
headless calls now select read-only sandbox with shell tools disabled.

Review tests cover default isolation, exact wire shape, remote HTTP/redirect restrictions,
redacted failures, revoked credentials, expired leases, uncertain completion, local-only
policy, scoped conversation key, no transcript replay/write, and stateless CLI arguments.

Verification: `npm test` — 853 tests, 848 passed, 5 optional native-store tests skipped, 0 failures.
The same 5 tests were skipped in baseline. Dependencies installed with `npm ci --ignore-scripts`;
native binary integration is not established by these skips. Typecheck/build and test-file registration checks passed. PowerShell and live third-party CLIs
are unavailable in this Linux review environment; their live behavior requires deployment
canary verification. No production credentials, LINE messages, configuration activation,
scheduled-task registration or existing process shutdown were performed.

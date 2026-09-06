---
version: "0.2.0b"
created_at: "2026-09-06T13:43:30+07:00, RWANG, a691ed4"
last_update: "2026-09-06T13:43:30+07:00, RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device / conversation execution"
  complexity: "C-2"
  risk: "HIGH"
  related_to:
    - "SERVER-LINE-OPTIONAL-EDGE.md"
    - "../.brain/rca/2026-09-06-codex-stateless-mcp-isolation.md"
    - "https://github.com/Freshair129/zuri.ai/blob/main/docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md"
---

# Approved: contain stateless Codex MCP configuration inheritance

Approved by the owner on 2026-09-06 and implemented. Local validation: 901 passed, 4 skipped; typecheck and build passed. Hosted checks remain a separate merge gate.

## Scope and parent alignment

This repairs the tool boundary of the existing upstream FR-150 Edge execution contract;
it creates no new business requirement or wire-contract version. Server continues to own
LINE transport, CRM and job authority under ADR-061. See
[runtime specification](SERVER-LINE-OPTIONAL-EDGE.md) and
[confirmed RCA](../.brain/rca/2026-09-06-codex-stateless-mcp-isolation.md).

## Implemented behavior

For stateless compute-only jobs, reject the Codex headless backend before spawning
the child process, using the existing bounded `LOCAL_POLICY_UNAVAILABLE` failure.
Apply the guard at the headless invocation boundary so a caller cannot bypass it by
calling that path directly; use the same backend classification as argument construction.
No automatic provider substitution, retry through another backend, or new auth copying.

The change temporarily makes Codex-backed stateless computation unavailable. Existing
HTTP/local-model paths and explicit legacy interactive behavior retain their contracts.
Claude remains subject to its existing strict MCP controls; this review does not certify
Claude isolation or real-provider end-to-end behavior.

## Files and verification

- `src/conversation/executor.ts`: reject before any answer or fallback path.
- `src/answer/headless.ts`: guard before process creation for stateless Codex.
- Existing headless/worker tests: assert blocked spawn, bounded failure, no fallback,
  and preserved non-Codex and legacy routing.
- `docs/SERVER-LINE-OPTIONAL-EDGE.md`: document temporary backend availability and error.
- RCA: retain the CLI configuration reproduction as regression evidence.
- Run test-registration check, typecheck, full tests and build; inspect documentation links.
- Push and merge only after the approved implementation and required hosted checks pass.

## Future re-enablement gate

Re-enabling Codex is separate work: define an executor-owned configuration boundary and
authentication provisioning, then verify effective MCP/tool configuration with an extra
inherited-server fixture on each supported CLI version. An empty table or argument-only
test is insufficient evidence. Do not copy the operator's credentials implicitly.

## Version diff

`0.1.0b` candidate → `0.2.0b` approved containment: adds executor and invocation guards plus regression tests. No wire schema or provider setting changes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Propose stateless Codex containment | a691ed4 (reviewed base) | RWANG |
| 0.2.0b | 2026-09-06 | beta | Owner approved containment; guard and regression tests implemented | pending commit | RWANG |

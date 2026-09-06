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
    - "../../docs/SERVER-LINE-OPTIONAL-EDGE.md"
    - "../../docs/CODEX-STATELESS-ISOLATION-PROPOSAL.md"
---

# RCA: inherited MCP survives stateless Codex overrides

## Symptom

PR #22 claims approved-tool-only stateless execution, but a separately configured MCP
server remains enabled when the production Codex arguments are applied. This is a
configuration isolation failure; this review did not observe actual unauthorized tool execution.

## Evidence

- Reviewed PR head: `4a6e7ca47257c97a46c3f85e70f7f4f58ea4776c`; local merge with master: `a691ed4`.
- `src/answer/headless.ts` emits `-c mcp_servers={}` and then configures `smartgift`.
- Its child environment preserves HOME/USERPROFILE, allowing normal user configuration discovery.
- Isolated reproduction on `codex-cli 0.151.0` used a fabricated CODEX_HOME containing
  `[mcp_servers.unapproved_fixture]`, with `enabled = true`.
- `codex mcp list --json` with overrides extracted from the actual built `buildArgs`
  returned BOTH `smartgift` and `unapproved_fixture` enabled.
- Control override `mcp_servers.unapproved_fixture.enabled=false` disabled the fixture.
- No real account config, authentication, model invocation or MCP execution was used.

## Root Cause

An empty table override does not erase inherited MCP entries in the tested CLI.
The implementation treated that override as an allowlist. Read-only sandbox and
disabled shell tools do not establish an MCP capability allowlist.

## Why the issue escaped detection

Existing tests assert argument strings, including the empty table, rather than the
effective CLI configuration after merging an inherited server. The merged tree's
899 passing tests and 4 skips therefore do not demonstrate this security boundary.

## Proposed prevention

See [candidate containment specification](../../docs/CODEX-STATELESS-ISOLATION-PROPOSAL.md).
Do not merge PR #22 until the approved remedy and regression checks pass.
Future re-enablement requires an executable inherited-config fixture proving that
only explicitly approved tools remain available, plus an explicit authentication design.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Initial evidence and proposed containment | a691ed4 (reviewed base) | RWANG |

| 0.2.0b | 2026-09-06 | beta | Owner approved containment; guard and regression tests implemented | pending commit | RWANG |

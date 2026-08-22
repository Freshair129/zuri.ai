# RCA — Issue #99 identity and access boundary gap

## Symptom

The repository can authenticate a local user and resolve Business visibility,
but it does not yet provide one revocable identity/session/policy contract for
web, LINE, API/MCP, agent turns and tool calls.

## Evidence

- `Person` and `ExternalIdentity` exist, but there is no persisted `Session` or
  first-class `ChannelIdentity` model.
- `Membership` has no lifecycle status, so viewer and LINE classification paths
  can treat a suspended relationship as active.
- `resolveViewer`, `src/modules/agent/auth-context.js`,
  `src/modules/agent/action-gate.js` and `src/modules/agent/tools.js` each own
  part of authorization rather than calling one policy-enforcement point.
- The signed browser token can be verified without a live server-side session
  row, and logout only clears the browser cookie.

## Root cause

Identity work was delivered as provider and feature slices over time without a
canonical IAM boundary. Authentication transport, principal resolution,
Membership lifecycle and capability enforcement were allowed to evolve as
separate seams, so revocation and scope invariants were not represented in one
server-owned contract.

## Why the issue escaped detection

Existing tests prove important individual seams — LINE identity resolution,
viewer visibility, agent action gating and signed login — but do not assert
equivalent decisions across all surfaces after session or Membership
revocation. Tool registration also proved read-only metadata, not authorization
at handler invocation.

## Proposed prevention

ADR-045 makes `Person`, persisted `Session`, active Membership and the shared
authorization context the identity-domain contract. Each protected surface must
resolve policy before work, negative tests must cover forged scope and
revocation, and governance must keep the schema, snapshot restore list and
feature traceability synchronized.

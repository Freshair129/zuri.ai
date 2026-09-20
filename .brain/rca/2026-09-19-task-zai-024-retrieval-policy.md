---
version: "0.1.0b"
created_at: "2026-09-19T00:00:00+07:00,Codex,working-tree"
last_update: "2026-09-19T00:00:00+07:00,Codex"
status: "candidate"
superseded_by: null
attributes:
  domain: "agent-governance"
  doc_type: "root-cause-analysis"
  scope: "TASK-ZAI-024 Second Brain retrieval by Business, Role and Permission"
---

# RCA — agent context lacked a task-level denied-retrieval proof

## Symptom

The role-partition port already returned an empty result and emitted an audit
for a cross-role private read, but the `assembleAgentContext` boundary had no
task-specific proof that a denied private partition is audited before the
memory port is called. Its gate also used only `privateMemoryAllowed`, leaving
an explicit MSP `read: false` permission weaker than the downstream port’s
canonical permission check.

## Evidence

- `apps/server/src/modules/agent/role-memory-partition.js` had the
  `ROLE_MEMORY_CROSS_PARTITION_DENIED` refusal and unit coverage, but no
  `ROLE_MEMORY_RETRIEVAL_DENIED` context event.
- `apps/server/src/modules/agent/context.js` selected an empty result for a
  denied policy, without recording an audit, and used `privateMemoryAllowed`
  rather than the combined private-memory and MSP-read decision.
- The TASK-ZAI-024 container marked acceptance and exit unchecked and declared
  its test link unavailable.

## Root cause

TASK-ZAI-008 implemented role-partition behavior as a standalone memory port,
while the agent context seam continued to own its own policy gate. No test
joined those contracts at the retrieval boundary, so an empty denied result
was treated as sufficient evidence even though the required audit and the
explicit MSP read permission were not enforced there.

## Why the issue escaped detection

The existing role-partition suite tested the port directly and the existing
context integration suite asserted empty memory for denied identities. Neither
asserted that the memory adapter was never invoked, that the refusal was
durably audited, or that an explicit MSP read denial was fail-closed.

## Proposed prevention

1. Keep the private-memory gate derived from both the immutable policy decision
   and `mspAuthorization.read`.
2. Audit denied private retrievals with server-resolved tenant, Business,
   principal and role metadata only; do not record customer content.
3. Keep the context seam covered by a database-free ordering test and retain
   the role-port cross-partition test as the role-specific isolation proof.

## Scope and release limit

This RCA covers the local context-boundary repair and its focused unit proof.
It does not claim hosted CI, production MSP activation, or production
knowledge-corpus readiness.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-19 | candidate | Added fail-closed private retrieval audit and context ordering proof for TASK-ZAI-024. | working-tree | Codex |

// @req FR-057 — deterministic Zuri compatibility scope for authorized private memory.
// @spec ADR-022 / SDD-030 — tenant, principal, agent and workspace are owners;
//   thread/session/instance/event are not vault owners.
// @tested tests/integration/agent-multi-principal.test.js

export function scopedMemoryKey({ tenantId, principalId, agentId, workspaceId = 'default', projectId = null }) {
  return [
    `tenant:${tenantId}`,
    `principal:${principalId}`,
    `agent:${agentId}`,
    `workspace:${workspaceId}`,
    ...(projectId ? [`project:${projectId}`] : []),
  ].join('/')
}

import { queryKnowledge } from '@/modules/knowledge'
import { memoryKey, createInMemoryMemory } from './memory-port'
import { defaultReadOnlyTools } from './tools'
import { resolveAgentAuthorization } from './auth-context'

// @req FR-025, FR-057 — assemble settled identity, policy-filtered memory and knowledge.
// @spec ADR-007 §P6 / ADR-022 / Gate E — authorization and vault selection happen before
//   retrieval; the model receives no raw scope authority.
// @tested tests/integration/agent-context.test.js, tests/integration/agent-multi-principal.test.js

/**
 * Assemble the read-only context an agent binds to at Gate E, for one LINE subject in
 * one tenant. Routes the subject through the ONE P3 identity seam, keys memory by the
 * resolved principal, pulls GKS knowledge, and exposes only read-only tools.
 *
 * Read-only w.r.t. Zuri: this function issues no writes. (resolveLinePrincipal may
 * mint-or-return the Person via the identity seam — that is the identity contract, not
 * an agent write.)
 *
 * @param {Object} input
 * @param {string} input.tenantId
 * @param {string} input.lineUserId
 * @param {string} [input.displayName]
 * @param {string} [input.threadId]
 * @param {object} [input.serverScope] server-owned agent/workspace/project context
 * @param {import('./memory-port').MemoryPort} [input.memory]  defaults to in-memory port
 * @param {import('./tools').ToolRegistry} [input.tools]       defaults to read-only tools
 * @returns {Promise<{
 *   identity: { principalId: string, principalType: string, roles: string[], customerId: string|null },
 *   memory: { key: string, entries: any[] },
 *   knowledge: { principalId: string, found: boolean, relations: any[] },
 *   tools: Array<{ name: string, description: string }>,
 *   capabilities: { readOnly: true, gate: 'E' },
 * }>}
 */
export async function assembleAgentContext({
  tenantId,
  businessId,
  lineUserId,
  displayName,
  threadId,
  sessionId,
  instanceId,
  eventId,
  capability,
  sensitivity,
  consent,
  serverScope,
  memory,
  tools,
  knowledge: knowledgeReader,
}) {
  const authorization = await resolveAgentAuthorization({
    tenantId,
    businessId,
    lineUserId,
    displayName,
    threadId,
    sessionId,
    instanceId,
    eventId,
    capability,
    sensitivity,
    consent,
    serverScope,
  })
  const { principal, authContext, policy, authorizedVaults } = authorization

  const identity = {
    principalId: principal.personId,
    principalType: principal.principalType,
    roles: principal.roles,
    customerId: principal.customerId,
    verified: principal.identityVerified,
  }

  const key = memoryKey(tenantId, principal.principalType, principal.personId)
  const scopedKey = authorizedVaults[0]?.scopeKey ?? key
  const memoryPort = memory ?? createInMemoryMemory()
  const mem = policy.privateMemoryAllowed
    ? typeof memoryPort.recallAuthorized === 'function'
      ? await memoryPort.recallAuthorized(authorization)
      : await memoryPort.recall(scopedKey)
    : { key: scopedKey, entries: [] }

  // Knowledge reader is injectable: the Prisma-relation default, or a GenesisBlockDB-backed
  // reader (createGraphKnowledgeReader) when the graph is wired — same {found,relations} shape.
  const knowledge = await (knowledgeReader ?? queryKnowledge)({
    tenantId,
    businessId: authContext.scope.businessId,
    principalId: principal.personId,
    authContext,
  })

  const toolList = (tools ?? defaultReadOnlyTools()).list()

  return {
    identity,
    memory: { key: mem.key ?? scopedKey, legacyKey: key, entries: mem.entries },
    knowledge,
    tools: toolList,
    capabilities: { readOnly: true, gate: 'E' },
    authContext,
    policy,
    authorizedVaults,
  }
}

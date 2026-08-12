import { resolveLinePrincipal } from '@/modules/identity/gate'
import { queryKnowledge } from '@/modules/knowledge'
import { memoryKey, createInMemoryMemory } from './memory-port'
import { defaultReadOnlyTools } from './tools'

// @req FR-025 — assemble the settled agent context the runtime binds to LAST:
//   Identity Context + Memory (principal-keyed) + GKS Knowledge + read-only Zuri Tools.
// @spec ADR-007 §P6 / Gate E — Agent Read-only Ready: search / read / recommend /
//   answer only. This assembler performs NO writes to Zuri; memory is keyed by the
//   classified principal (never the lineUserId), and capabilities are pinned read-only.
// @tested tests/integration/agent-context.test.js

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
export async function assembleAgentContext({ tenantId, lineUserId, displayName, memory, tools, knowledge: knowledgeReader }) {
  const principal = await resolveLinePrincipal({ tenantId, lineUserId, displayName })

  const identity = {
    principalId: principal.personId,
    principalType: principal.principalType,
    roles: principal.roles,
    customerId: principal.customerId,
  }

  const key = memoryKey(tenantId, principal.principalType, principal.personId)
  const mem = await (memory ?? createInMemoryMemory()).recall(key)

  // Knowledge reader is injectable: the Prisma-relation default, or a GenesisBlockDB-backed
  // reader (createGraphKnowledgeReader) when the graph is wired — same {found,relations} shape.
  const knowledge = await (knowledgeReader ?? queryKnowledge)({ tenantId, principalId: principal.personId })

  const toolList = (tools ?? defaultReadOnlyTools()).list()

  return {
    identity,
    memory: { key, ...mem },
    knowledge,
    tools: toolList,
    capabilities: { readOnly: true, gate: 'E' },
  }
}

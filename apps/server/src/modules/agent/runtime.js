import { queryKnowledge, createGraphKnowledgeReader } from '@/modules/knowledge'
import { createInMemoryMemory } from './memory-port'
import { createMspMemoryPort } from './msp-memory-port'
import { createMspVaultResolver } from './msp-vault-resolver'

// @req FR-029 — bind the agent to the REAL backends: MSP memory + GenesisBlockDB
//   knowledge, as the ports assembleAgentContext/handleAgentTurn consume.
// @spec ADR-007 §P6 — the agent consumes settled contracts (Identity + MSP + GKS +
//   Tools); each is a separate authority/store (not bundled as in GoVibe), wired here.
//   Graceful fallback: an unconfigured backend degrades to the in-memory / Prisma
//   default so the same turn runs in tests, demo, and production.
// @tested tests/integration/agent-runtime.test.js

/**
 * Compose the agent's runtime ports from whatever real backends are configured.
 * - MSP memory when an `mspTransport` is given, else the in-memory port.
 * - GenesisBlockDB knowledge when a `graphTraverse` is given, else the Prisma read.
 * MSP and GKS stay independent — configuring one never requires the other.
 *
 * @param {Object} [backends]
 * @param {Function} [backends.mspTransport]   injected MSP tool-caller (name,input)=>result
 * @param {Function} [backends.graphTraverse]  injected graph read ({tenantId,principalId})=>relations[]
 * @param {{resolve: Function}|Function} [backends.mspVaultResolver] canonical API-010 resolver
 * @param {boolean} [backends.mspCompatibilityMode] explicitly enable legacy scopeKey mode
 * @returns {{ memory: import('./memory-port').MemoryPort, knowledge: Function }}
 */
export function createAgentPorts({ mspTransport, mspVaultResolver, mspCompatibilityMode = false, mspActor = 'zuri-agent', graphTraverse } = {}) {
  const memory = mspTransport
    ? mspCompatibilityMode
      ? createMspMemoryPort({ transport: mspTransport, vaultResolver: mspVaultResolver, compatibilityMode: true })
      : createMspMemoryPort({
          transport: mspTransport,
          vaultSetResolver: mspVaultResolver ?? createMspVaultResolver({ transport: mspTransport, actor: mspActor }),
        })
    : createInMemoryMemory()
  const knowledge = graphTraverse ? createGraphKnowledgeReader({ traverse: graphTraverse }) : queryKnowledge
  return { memory, knowledge }
}

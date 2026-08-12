import { queryKnowledge } from './query'

// @req FR-024 — GenesisBlockDB-backed knowledge READ for the agent (the read side of
//   the P5 seam; the sink is the write side). Same {principalId,found,relations} shape
//   as the Prisma default, so it drops straight into assembleAgentContext.
// @spec ADR-007 §P5 — GKS holds relations; the agent reads a principal's neighbourhood
//   from the graph (multi-hop traversal), while live facts still come from Zuri queries.
// @tested tests/integration/agent-runtime.test.js
//
// `traverse` is injected — the owner binds it to the real GenesisBlockDB read (the NAPI
// GenesisDatabase query/traverse), exactly as the sink injects its write client. It must
// return the principal's relations as `Array<{ rel, node: { id, type, label } }>`.

/**
 * Build a knowledge reader that reads a principal's neighbourhood from the graph.
 * @param {Object} opts
 * @param {(args: { tenantId: string, principalId: string }) => Promise<Array<{rel,node}>>} opts.traverse
 * @param {Function} [opts.fallback]  used when traverse yields nothing/throws (default: Prisma queryKnowledge)
 * @returns {(args: { tenantId, principalId }) => Promise<{ principalId, found, relations }>}
 */
export function createGraphKnowledgeReader({ traverse, fallback = queryKnowledge } = {}) {
  if (typeof traverse !== 'function') {
    throw new Error('createGraphKnowledgeReader requires a traverse(args) function bound to the graph')
  }
  return async function graphKnowledge({ tenantId, principalId }) {
    const relations = await traverse({ tenantId, principalId })
    if (Array.isArray(relations) && relations.length > 0) {
      return { principalId, found: true, relations }
    }
    // Empty graph result: fall back to the Zuri-relation read so the agent is never left
    // blind while the projection is catching up. (fallback:null disables this.)
    if (fallback) return fallback({ tenantId, principalId })
    return { principalId, found: false, relations: [] }
  }
}

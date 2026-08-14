// @req FR-025, FR-057 — the principal-keyed memory contract and authorized context seam: memory is
//   keyed by the classified principal, NOT by the raw LINE channel handle.
// @spec ADR-007 §P6 / Gate E — the demo's `vault: line:Uxxxx` is the forbidden
//   anti-pattern; production key is `tenant:{tenantId}/principal:{type}:{principalId}`.
//   The port is read-only-safe: an unknown key recalls an empty entry list.
// @tested tests/integration/agent-context.test.js

/**
 * Build the principal-keyed memory key. This is the whole point of FR-025: memory
 * follows the person, not the channel. A lineUserId (or any raw channel handle) must
 * NEVER appear here — it is resolved to a Person by the P3 gate before we get here.
 *
 * @param {string} tenantId
 * @param {string} principalType  STAFF | CUSTOMER | UNKNOWN (any case; lowercased here)
 * @param {string} principalId    a Person.id
 * @returns {string} `tenant:${tenantId}/principal:${type}:${principalId}`
 */
export function memoryKey(tenantId, principalType, principalId) {
  return `tenant:${tenantId}/principal:${String(principalType).toLowerCase()}:${principalId}`
}

/**
 * @typedef {Object} MemoryEntry  an opaque remembered fact; shape owned by the caller.
 * @typedef {{ key: string, entries: MemoryEntry[] }} MemoryRecall
 *
 * @typedef {Object} MemoryPort
 * @property {(key: string) => Promise<MemoryRecall>} recall  read entries for a key;
 *   unknown key returns `{ key, entries: [] }` (never throws — read-only-safe).
 * @property {(key: string, entry: MemoryEntry) => Promise<MemoryRecall>} remember
 *   append one entry and return the updated recall.
 */

/**
 * The default in-memory MemoryPort, backed by a Map. This is the local stand-in for
 * the real MSP store; the production seam wires an MSP stdio client that satisfies the
 * same `{ recall, remember }` interface, so `assembleAgentContext` never changes when
 * the backing store does. Gate E only ever calls `recall`.
 *
 * @returns {MemoryPort}
 */
export function createInMemoryMemory() {
  const store = new Map()
  return {
    async recall(key) {
      return { key, entries: store.get(key) ?? [] }
    },
    async remember(key, entry) {
      const entries = store.get(key) ?? []
      entries.push(entry)
      store.set(key, entries)
      return { key, entries }
    },
    async recallAuthorized(authorization) {
      if (authorization?.authContext?.policy?.decision !== 'ALLOW' || authorization.authorizedVaults?.length !== 1) {
        throw new Error('In-memory memory port: private retrieval requires one authorized vault')
      }
      return this.recall(authorization.authorizedVaults[0].scopeKey)
    },
    async rememberAuthorized(authorization, entry) {
      if (authorization?.authContext?.policy?.decision !== 'ALLOW' || authorization.authorizedVaults?.length !== 1) {
        throw new Error('In-memory memory port: private write requires one authorized vault')
      }
      return this.remember(authorization.authorizedVaults[0].scopeKey, entry)
    },
  }
}

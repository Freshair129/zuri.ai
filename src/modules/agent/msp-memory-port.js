// @req FR-025 — MSP-backed memory port (principal-keyed), the real adapter behind the P6 memory seam.
// @spec ADR-007 §P6 — memory keyed by principal, not channel; vault = the principal key.
// @tested tests/integration/agent-msp-port.test.js

/**
 * @typedef {import('./memory-port.js').MemoryPort} MemoryPort
 * @typedef {import('./memory-port.js').MemoryEntry} MemoryEntry
 * @typedef {import('./memory-port.js').MemoryRecall} MemoryRecall
 */

// ---------------------------------------------------------------------------
// What this file is
// ---------------------------------------------------------------------------
// The production stand-in for `createInMemoryMemory()`: a `{ recall, remember }`
// port that speaks the REAL GoVibe MSP "Persistent Memory" protocol (API-009)
// over an INJECTED transport. It does not spawn a process and does not import
// from D:\msp — the orchestrator injects the transport that carries the wire.
//
// MSP tools this adapter maps the port onto (exact names from
//   D:\msp\packages\msp-contracts\schemas\API-009.tools.json  and the verified
//   caller D:\workspace\zuri-command-agent\src\memory\msp-stdio-caller.ts):
//
//   remember(key, entry)  ->  msp_memory_upsert
//       { vault: { vault_id, vault_type }, category, key, body_json, ... }
//   recall(key)           ->  msp_memory_list
//       { vault_id }  ->  { entities: [ { body_json, ... } ] }
//
// (`msp_memory_search` is the query-driven read; `recall` wants EVERYTHING the
//  principal knows, so it lists the principal's vault rather than searching it.)
//
// The single ADR-007 §P6 invariant: the MSP `vault_id` is derived from the
// PRINCIPAL key (`…/principal:{type}:{id}`), never a channel handle. The demo's
// `vault: line:Uxxxx` is the forbidden anti-pattern — this adapter refuses it.

const DEFAULT_CATEGORY = 'agent-memory'
const DEFAULT_VAULT_TYPE = 'workspace_private' // per-principal private scope; the vault_id carries identity, not the type.

// A bare LINE user handle: 'U' + hex (LINE ids are U + 32 hex). Used only to
// reject channel-scoped keys — a legitimate principal key starts with `tenant:`.
const BARE_CHANNEL_HANDLE = /^u[0-9a-f]{16,}$/i

/**
 * Normalise the injected transport to a single tool-caller `(name, input) => Promise<payload>`.
 * Matches the surfaces the real MSP stack exposes:
 *   - the callable returned by `createMspStdioCaller` (a bare function), or
 *   - an object with `.call(name, input)`  (MspClient / createMspMemoryClient style), or
 *   - an object with `.request(name, input)`.
 * The caller is expected to already unwrap the MCP envelope and resolve to the
 * handler payload (`structuredContent`), exactly like the reference caller does.
 *
 * NOTE: the `typeof transport === 'function'` check MUST come first — every
 * function also carries `Function.prototype.call`, which is not our tool-caller.
 */
function resolveCaller(transport) {
  if (typeof transport === 'function') return (name, input) => transport(name, input)
  if (transport && typeof transport.call === 'function') return (name, input) => transport.call(name, input)
  if (transport && typeof transport.request === 'function') return (name, input) => transport.request(name, input)
  throw new Error(
    'createMspMemoryPort: `transport` must be a callable (name, input) => Promise, or expose .call/.request',
  )
}

/**
 * Fail-closed guard: the resolved MSP vault MUST name a principal and MUST NOT
 * name a channel. This is the ADR-007 §P6 enforcement point — a channel-scoped
 * vault would read/write another principal's memory, so we refuse before any
 * MSP round-trip happens.
 *
 * @param {string} vault  the vault_id about to be sent to MSP
 * @param {string} rawKey the port key it was derived from (for the message)
 */
function assertPrincipalScopedVault(vault, rawKey) {
  if (typeof vault !== 'string' || !vault) {
    throw new Error('MSP memory port: a non-empty principal key is required')
  }
  const lower = vault.toLowerCase()
  if (lower.includes('line:')) {
    throw new Error(
      `MSP memory port: refusing channel-scoped vault "${vault}" (contains "line:"). Memory is keyed by principal, not channel (ADR-007 §P6). Resolve the channel handle to a Person first.`,
    )
  }
  if (BARE_CHANNEL_HANDLE.test(vault)) {
    throw new Error(
      `MSP memory port: refusing raw channel handle "${vault}" as a vault. Expected a principal key (…/principal:{type}:{id}).`,
    )
  }
  if (!vault.includes('principal:')) {
    throw new Error(
      `MSP memory port: refusing non-principal vault "${vault}" (derived from "${rawKey}"). The vault MUST be the principal key (contains "principal:").`,
    )
  }
}

/** Pull the list of memory entities out of whatever shape msp_memory_list returns. */
function entitiesFrom(result) {
  if (!result) return []
  if (Array.isArray(result)) return result
  const list =
    result.entities ?? result.items ?? result.memories ?? result.records ?? result.hits ?? []
  return Array.isArray(list) ? list : []
}

/** One MSP entity (or search hit) -> the opaque entry the caller originally stored. */
function entryFromEntity(node) {
  const entity = node && typeof node === 'object' && node.entity ? node.entity : node
  if (entity && typeof entity === 'object' && 'body_json' in entity) return entity.body_json
  return entity
}

/**
 * The real MSP-backed MemoryPort. Drop-in for `createInMemoryMemory()`.
 *
 * @param {Object} deps
 * @param {Function|{call?:Function,request?:Function}} deps.transport  injected MSP tool-caller.
 * @param {(key: string) => string} [deps.vaultResolver]  maps the principal key -> MSP vault_id.
 *   Defaults to identity: the principal key IS the vault. Whatever it returns is
 *   still run through the fail-closed principal-scope guard.
 * @param {string} [deps.vaultType]  MSP vault_type for writes (default 'workspace_private').
 * @param {string} [deps.category]   MSP category for writes (default 'agent-memory').
 * @returns {MemoryPort}
 */
export function createMspMemoryPort({
  transport,
  vaultResolver = (key) => key,
  vaultType = DEFAULT_VAULT_TYPE,
  category = DEFAULT_CATEGORY,
} = {}) {
  const callTool = resolveCaller(transport)
  let counter = 0

  /** Derive + guard the MSP vault_id for a port key. Throws (fail-closed) on channel scope. */
  function vaultFor(key) {
    const vault = vaultResolver(key)
    assertPrincipalScopedVault(vault, key)
    return vault
  }

  async function recall(key) {
    const vault = vaultFor(key)
    const result = await callTool('msp_memory_list', { vault_id: vault })
    const entries = entitiesFrom(result).map(entryFromEntity)
    return { key, entries }
  }

  async function remember(key, entry) {
    const vault = vaultFor(key)

    // body_json must be an object (API-009 schema); wrap non-objects.
    const body_json =
      entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { value: entry }

    // Each remember is its own MSP entity — mirror the in-memory "append"
    // semantics. Honour a caller-supplied stable key, else mint a unique one so
    // upsert never collapses two distinct facts into one.
    const entityKey =
      (entry && (entry.key ?? entry.id)) ?? `${category}:${Date.now()}:${counter++}`

    const upsert = {
      vault: { vault_id: vault, vault_type: vaultType },
      category,
      key: String(entityKey),
      body_json,
    }
    // Pass through the optional epistemic/temporal fields when the caller sets them.
    if (entry && entry.epistemic_state) upsert.epistemic_state = entry.epistemic_state
    if (entry && typeof entry.confidence === 'number') upsert.confidence = entry.confidence
    if (entry && entry.valid_from) upsert.valid_from = entry.valid_from
    if (entry && entry.valid_to) upsert.valid_to = entry.valid_to

    await callTool('msp_memory_upsert', upsert)

    // Return the updated recall, matching the MemoryPort contract.
    return recall(key)
  }

  return { recall, remember }
}

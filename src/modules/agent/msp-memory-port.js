// @req FR-025, FR-057 — MSP-backed memory port with explicit authorized vault scopes.
// @spec ADR-007 §P6 / ADR-022 — API-010 is canonical; legacy principal keys remain
//   available only through explicit compatibility mode.
// @tested tests/integration/agent-msp-port.test.js, tests/integration/msp-vault-memory-port.test.js

import { validateVaultSet } from './msp-vault-resolver'

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
//   rememberAuthorized(auth, entry) -> msp_memory_upsert
//       { vault: { vault_id, vault_type }, category, key, body_json, ... }
//   recallAuthorized(auth) ->  msp_memory_list
//       { vault_id }  ->  { entities: [ { body_json, ... } ] }
//
// (`msp_memory_search` is the query-driven read; `recall` wants EVERYTHING the
//  principal knows, so it lists the principal's vault rather than searching it.)
//
// In canonical mode API-010 returns the opaque `vault_id`; this adapter never
// derives or accepts that ID from the channel, client, model, or scopeKey.
// The principal-key guard below applies only to explicit legacy compatibility mode.

const DEFAULT_CATEGORY = 'agent-memory'
const DEFAULT_VAULT_TYPE = 'workspace_private'

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
 * Fail-closed guard for explicit legacy compatibility mode: the resolved MSP
 * vault MUST name a principal and MUST NOT name a channel. A channel-scoped
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
 * @param {{resolve: Function}|Function} [deps.vaultSetResolver] canonical API-010
 *   resolver returning the opaque authorized vault set.
 * @param {(scope: object|string) => string} [deps.vaultResolver] legacy scopeKey
 *   resolver; allowed only with `compatibilityMode: true`.
 * @param {boolean} [deps.compatibilityMode] explicitly enable legacy API-009 mode.
 * @param {string} [deps.vaultType]  MSP vault_type for writes (default 'workspace_private').
 * @param {string} [deps.category]   MSP category for writes (default 'agent-memory').
 * @returns {MemoryPort}
 */
export function createMspMemoryPort({
  transport,
  vaultResolver,
  vaultSetResolver,
  compatibilityMode = false,
  vaultType = DEFAULT_VAULT_TYPE,
  category = DEFAULT_CATEGORY,
} = {}) {
  const callTool = resolveCaller(transport)
  const legacyResolver = vaultResolver ?? ((scope) => (typeof scope === 'string' ? scope : scope.scopeKey))
  if (!vaultSetResolver && !compatibilityMode) {
    throw new Error('createMspMemoryPort: API-010 vaultSetResolver required; enable compatibilityMode explicitly for legacy scopeKey access')
  }
  if (vaultSetResolver && typeof vaultSetResolver !== 'function' && typeof vaultSetResolver.resolve !== 'function') {
    throw new Error('createMspMemoryPort: vaultSetResolver must expose resolve()')
  }
  let counter = 0

  function assertCompatibilityMode() {
    if (!compatibilityMode) {
      throw new Error('MSP memory port: legacy scopeKey access requires compatibilityMode')
    }
  }

  /** Derive + guard the MSP vault_id for a port key. Throws (fail-closed) on channel scope. */
  function vaultFor(key) {
    assertCompatibilityMode()
    const vault = legacyResolver(key)
    assertPrincipalScopedVault(vault, key)
    return vault
  }

  function assertAuthorizedContext(authorization) {
    if (
      !authorization?.authContext ||
      authorization.authContext.policy?.decision !== 'ALLOW' ||
      authorization.authContext.policy?.privateMemoryAllowed !== true
    ) {
      throw new Error('MSP memory port: private retrieval requires an ALLOW policy decision')
    }
    const scopes = authorization.authorizedVaults
    if (!Array.isArray(scopes) || scopes.length === 0) {
      throw new Error('MSP memory port: authorized vault set is empty')
    }
    for (const scope of scopes) {
      if (
        scope?.scope !== 'private' ||
        scope.tenantId !== authorization.authContext.scope.tenantId ||
        scope.principalId !== authorization.authContext.actor.principalId ||
        scope.agentId !== authorization.authContext.request.agentId ||
        !scope.workspaceId ||
        scope.workspaceId !== authorization.authContext.scope.workspaceId ||
        scope.projectId !== authorization.authContext.scope.projectId
      ) {
        throw new Error('MSP memory port: authorized vault scope does not match AuthContext')
      }
    }
  }

  function vaultForScope(scope) {
    const vault = legacyResolver(scope)
    if (typeof vault !== 'string' || !vault.includes('tenant:') || !vault.includes('principal:')) {
      throw new Error('MSP memory port: resolver returned a non-scoped vault')
    }
    if (vault.toLowerCase().includes('line:') || BARE_CHANNEL_HANDLE.test(vault)) {
      throw new Error('MSP memory port: refusing a channel-scoped authorized vault')
    }
    return vault
  }

  async function listVault(vault) {
    const result = await callTool('msp_memory_list', { vault_id: vault })
    return entitiesFrom(result).map(entryFromEntity)
  }

  async function resolveCanonical(authorization, operation) {
    assertAuthorizedContext(authorization)
    if (!vaultSetResolver) throw new Error('MSP memory port: API-010 vault resolver is not configured')
    const result = typeof vaultSetResolver === 'function'
      ? await vaultSetResolver(authorization, { operation })
      : await vaultSetResolver.resolve(authorization, { operation })
    const vaultSet = validateVaultSet(result)
    if (operation === 'read' && vaultSet.permissions.read !== true) {
      throw new Error('MSP memory port: API-010 denied read permission')
    }
    if (operation === 'write' && vaultSet.permissions.writePrivate !== true) {
      throw new Error('MSP memory port: API-010 denied private write permission')
    }
    return vaultSet
  }

  async function recallAuthorized(authorization) {
    if (vaultSetResolver) {
      const vaultSet = await resolveCanonical(authorization, 'read')
      const entries = await listVault(vaultSet.workspacePrivateVaultId)
      return { key: vaultSet.workspacePrivateVaultId, entries, vaultSet }
    }
    assertAuthorizedContext(authorization)
    const entries = []
    for (const scope of authorization.authorizedVaults) {
      entries.push(...(await listVault(vaultForScope(scope))))
    }
    return { key: authorization.authorizedVaults.map((scope) => scope.scopeKey).join('|'), entries }
  }

  async function rememberAuthorized(authorization, entry) {
    if (vaultSetResolver) {
      const vaultSet = await resolveCanonical(authorization, 'write')
      const body_json = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { value: entry }
      const entityKey = (entry && (entry.key ?? entry.id)) ?? `${category}:${Date.now()}:${counter++}`
      await callTool('msp_memory_upsert', {
        vault: { vault_id: vaultSet.workspacePrivateVaultId, vault_type: vaultType },
        category,
        key: String(entityKey),
        body_json,
      })
      return recallAuthorized(authorization)
    }
    assertAuthorizedContext(authorization)
    if (authorization.authorizedVaults.length !== 1) {
      throw new Error('MSP memory port: remember requires exactly one authorized private vault')
    }
    const scope = authorization.authorizedVaults[0]
    const vault = vaultForScope(scope)
    const body_json = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { value: entry }
    const entityKey = (entry && (entry.key ?? entry.id)) ?? `${category}:${Date.now()}:${counter++}`
    await callTool('msp_memory_upsert', {
      vault: { vault_id: vault, vault_type: vaultType },
      category,
      key: String(entityKey),
      body_json,
    })
    return recallAuthorized(authorization)
  }

  async function recall(key) {
    assertCompatibilityMode()
    const vault = vaultFor(key)
    const entries = await listVault(vault)
    return { key, entries }
  }

  async function remember(key, entry) {
    assertCompatibilityMode()
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

  return { recall, remember, recallAuthorized, rememberAuthorized }
}

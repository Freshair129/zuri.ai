import { randomUUID } from 'node:crypto'
import { scopeFromGrants } from './delegation.js'
import { createUnavailableReferenceAuthority } from './reference-authority.js'
import { createScopeCache, scopeCacheKey } from './scope-cache.js'

// Core mode (contract scm-core.v1, PROPOSED; ADR-108 pattern): the scope and the
// Branch / Customer / Conversation facts both come from core's private façade,
// asked with the end user's own subject — never from anything the BFF asserts.
//
// Scope: `resolve-scope` (subject + the BFF's Business selector) → the SAME frozen
// scope object the delegation path builds (scopeFromGrants), so every authority
// ladder is unchanged. Its `delegationId` is a synthetic per-request id
// (`core-<uuid>`): there is no signed statement to name. Successful resolutions
// may be served from a short in-process cache (scope-cache.js — read its header
// for the revocation tradeoff); a cache hit still builds a fresh scope object.
//
// The subject has to travel with the scope to the fact calls made later in the
// same request, but must never be serialized, logged, audited or enumerated. It
// is therefore kept OUTSIDE the scope, in a module-private WeakMap keyed by the
// scope object: `JSON.stringify(scope)`, `Object.keys(scope)` and any log of it
// cannot reach it, and it is collected with the scope at the end of the request.
//
// Facts: core re-resolves the subject on every fact call and answers null for a
// Business the subject cannot see; SCM still applies its own legacy predicate to
// whatever comes back (tenant, Business, status, deletedAt), in the legacy order.
// fileAsset stays behind the separate SCM-FILES gate: refused retryably (503)
// exactly like the unavailable authority, never answered by core.

const subjects = new WeakMap()

/** The subject a core-resolved scope was resolved from, or throws (delegation scopes have none). */
function subjectOf(scope) {
  const subject = (scope && typeof scope === 'object') ? subjects.get(scope) : undefined
  if (!subject) throw Object.assign(new Error('scope has no core subject'), { status: 503, code: 'SCM_REFERENCE_AUTHORITY_UNAVAILABLE', retryable: true })
  return subject
}

/**
 * (subject, businessId) → scope, via core (or the success-only cache). Refusals and
 * outages propagate with their own status and are never cached. `cacheTtlMs` 0
 * (the default here; main.js passes the configured value) disables the cache.
 */
export function createCoreScopeResolver(coreClient, { cacheTtlMs = 0, cacheMaxEntries = 1000, now = Date.now } = {}) {
  const cache = createScopeCache({ ttlMs: cacheTtlMs, maxEntries: cacheMaxEntries, now })
  if (cache.enabled && (typeof coreClient.credentialId !== 'string' || !coreClient.credentialId)) {
    throw Object.assign(new Error('a cached core scope resolver needs the core credential id'), { code: 'SCM_CONFIG_INVALID' })
  }
  async function resolve(subject, businessId) {
    if (!cache.enabled) return coreClient.resolveScope(subject, businessId)
    const key = scopeCacheKey({ subject, businessId, credentialId: coreClient.credentialId })
    const hit = cache.get(key)
    if (hit) return hit
    const resolved = await coreClient.resolveScope(subject, businessId)
    cache.set(key, resolved)
    return resolved
  }
  return async function resolveScope(subject, businessId) {
    const resolved = await resolve(subject, businessId)
    const scope = scopeFromGrants({ actorId: resolved.actorId, tenantId: resolved.tenantId, delegationId: `core-${randomUUID()}`, grants: resolved.grants })
    subjects.set(scope, subject)
    return scope
  }
}

const withReference = (which) => (error) => {
  if (error?.code === 'SCM_CORE_UNAVAILABLE' && !error.details) error.details = { reference: which }
  throw error
}

export function createCoreReferenceAuthority(coreClient) {
  const files = createUnavailableReferenceAuthority()
  return {
    kind: 'core',
    branch: async (scope, { businessId, branchId }) => coreClient.branch(subjectOf(scope), { businessId, branchId }).catch(withReference('branch')),
    branches: async (scope, { businessId }) => coreClient.branches(subjectOf(scope), { businessId }).catch(withReference('branches')),
    customer: async (scope, { businessId, customerId }) => coreClient.customer(subjectOf(scope), { businessId, customerId }).catch(withReference('customer')),
    conversation: async (scope, { businessId, conversationId }) => coreClient.conversation(subjectOf(scope), { businessId, conversationId }).catch(withReference('conversation')),
    // Gate SCM-FILES: not part of scm-core.v1.
    fileAsset: files.fileAsset,
  }
}

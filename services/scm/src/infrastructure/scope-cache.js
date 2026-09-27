import { createHash } from 'node:crypto'

// In-process cache of SUCCESSFUL core resolve-scope answers (contract scm-core.v1).
//
// Tradeoff, accepted by the owner: a session revoked in core, or a grant changed
// there, can keep acting in SCM for up to the TTL (SCM_CORE_SCOPE_CACHE_TTL_MS,
// default 15 s, never above 60 s; 0 turns the cache off). In exchange a burst of
// requests from one user asks core once instead of once per request.
//
//   - Only a successful resolution is stored. A refusal (401/403/404/409), any
//     error and any core outage is never cached: the next request asks core again.
//   - Key = sha256 over (the subject, the selected businessId, the id of the core
//     credential in use) with JSON-array framing, so no two tuples share a key. The
//     raw subject is never a key, never stored and never logged; the cached value
//     is only {actorId, tenantId, grants} — it holds no subject either.
//   - Bounded (SCM_CORE_SCOPE_CACHE_MAX_ENTRIES), least-recently-used eviction;
//     an expired entry is dropped when it is next looked up or evicted.
//   - Branch / Customer / Conversation facts are NOT cached (core-reference-authority.js).
// The cache never hands out a scope object: the resolver builds a fresh frozen
// scope from the cached value on every request (fresh delegationId, its own
// subject binding), so nothing request-bound is ever shared across requests.

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

export function scopeCacheKey({ subject, businessId, credentialId }) {
  return createHash('sha256').update(JSON.stringify(['scm-scope-cache.v1', credentialId, subject, businessId]), 'utf8').digest('hex')
}

export function createScopeCache({ ttlMs, maxEntries, now = Date.now }) {
  if (!Number.isInteger(ttlMs) || ttlMs < 0 || !Number.isInteger(maxEntries) || maxEntries < 1) {
    throw Object.assign(new Error('scope cache bounds are invalid'), { code: 'SCM_CONFIG_INVALID' })
  }
  const entries = new Map() // key → { expiresAt, value }; Map order = recency (oldest first)
  return {
    enabled: ttlMs > 0,
    get size() { return entries.size },
    get(key) {
      if (ttlMs === 0) return undefined
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      if (entry.expiresAt <= now()) return undefined
      entries.set(key, entry)
      return entry.value
    },
    set(key, { actorId, tenantId, grants }) {
      if (ttlMs === 0) return
      entries.delete(key)
      entries.set(key, { expiresAt: now() + ttlMs, value: deepFreeze({ actorId, tenantId, grants: structuredClone(grants) }) })
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
    },
  }
}

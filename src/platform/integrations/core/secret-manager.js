// @req FR-074, FR-075 — resolve opaque connection secrets through an explicit runtime source.
// @spec ADR-031 §D1/D3, ADR-032 D2/D3, NFR-015, SEC-015/016 — production is Vault-backed,
// errors fail closed, and secret material is non-enumerable at the runtime boundary.
// @tested tests/unit/fr074-runtime-cutover.test.js

export const RUNTIME_SOURCES = Object.freeze(['PRODUCTION_LINE', 'LOCAL_DEV', 'TEST', 'EVAL'])
const SECRET_ERROR_CODES = new Set(['NotFound', 'Expired', 'Ambiguous', 'Unauthorized', 'Unavailable'])
const SUPABASE_VAULT_REF_PATTERN = /^supabase-vault:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const SUPABASE_VAULT_RESOLVER_SQL = `
  select secret_material, version, expires_at
  from zuri_core.resolve_phase1_line_secret($1, $2, $3)
`

export class SecretManagerError extends Error {
  constructor(code) {
    const normalized = SECRET_ERROR_CODES.has(code) ? code : 'Unavailable'
    super(`SECRET_MANAGER_${normalized.toUpperCase()}`)
    this.name = 'SecretManagerError'
    this.code = normalized
    this.status = normalized === 'Unauthorized' ? 403 : normalized === 'Unavailable' ? 503 : 502
  }
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new SecretManagerError('NotFound')
  return value
}

function assertScope(scope) {
  requiredText(scope?.tenantId, 'tenantId')
  requiredText(scope?.businessId, 'businessId')
}

function normalizeError(error) {
  if (error instanceof SecretManagerError) return error
  if (SECRET_ERROR_CODES.has(error?.code)) return new SecretManagerError(error.code)
  return new SecretManagerError('Unavailable')
}

function internalResolution({ material, version, expiresAt }, currentTime) {
  requiredText(material, 'material')
  requiredText(version, 'version')
  const expiry = new Date(expiresAt)
  if (Number.isNaN(expiry.getTime())) throw new SecretManagerError('Expired')
  if (expiry.getTime() <= currentTime.getTime()) throw new SecretManagerError('Expired')

  // Secret material is available to the model adapter but cannot accidentally enter
  // JSON logs, audit payloads or browser responses through normal enumeration.
  const result = { version, expiresAt: expiry }
  Object.defineProperty(result, 'material', { value: material, enumerable: false })
  return result
}

export function createVaultSecretManagerAdapter({ vault } = {}) {
  if (!vault || typeof vault.get !== 'function') throw new SecretManagerError('Unavailable')
  return {
    kind: 'file-vault',
    async resolve(secretRef) {
      const material = await vault.get(secretRef)
      if (!material) throw new SecretManagerError('NotFound')
      return { material, version: 'local-vault', expiresAt: new Date(Date.now() + 5 * 60_000) }
    },
  }
}

export function isSupabaseVaultSecretRef(secretRef) {
  return typeof secretRef === 'string' && SUPABASE_VAULT_REF_PATTERN.test(secretRef.trim())
}

export function createSupabaseVaultSecretManagerAdapter({ queryFn } = {}) {
  if (typeof queryFn !== 'function') throw new SecretManagerError('Unavailable')
  return {
    kind: 'supabase-vault',
    async resolve(secretRef, { tenantId, businessId } = {}) {
      if (!isSupabaseVaultSecretRef(secretRef)) throw new SecretManagerError('NotFound')
      requiredText(tenantId, 'tenantId')
      requiredText(businessId, 'businessId')

      let result
      try {
        result = await queryFn(SUPABASE_VAULT_RESOLVER_SQL, [secretRef.trim(), tenantId, businessId])
      } catch (error) {
        throw normalizeError(error)
      }
      const rows = Array.isArray(result?.rows) ? result.rows : []
      if (rows.length === 0) throw new SecretManagerError('NotFound')
      if (rows.length !== 1) throw new SecretManagerError('Ambiguous')
      const row = rows[0]
      return {
        material: row.secret_material,
        version: String(row.version ?? ''),
        expiresAt: row.expires_at,
      }
    },
  }
}

export function createSecretManagerPort({
  runtimeSource,
  adapter,
  cacheTtlMs = 5_000,
  now = () => new Date(),
} = {}) {
  if (!RUNTIME_SOURCES.includes(runtimeSource)) throw new SecretManagerError('Unauthorized')
  if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 1 || cacheTtlMs > 60_000) {
    throw new SecretManagerError('Unavailable')
  }
  if (!adapter || typeof adapter.resolve !== 'function') {
    if (runtimeSource === 'PRODUCTION_LINE') {
      throw new Error('PRODUCTION_SECRET_MANAGER_NOT_CONFIGURED: production secret manager is required')
    }
    throw new SecretManagerError('Unavailable')
  }
  if (runtimeSource === 'PRODUCTION_LINE' && adapter.kind === 'file-vault') {
    throw new Error('PRODUCTION_LOCAL_VAULT_FORBIDDEN')
  }

  const cache = new Map()
  const latestByScopeRef = new Map()

  function scopeCacheKey(secretRef, scope) {
    return `${secretRef}\u0000${scope.tenantId}\u0000${scope.businessId}`
  }

  function invalidateScope(secretRef, scope) {
    const scopeKey = scopeCacheKey(secretRef, scope)
    const cacheKey = latestByScopeRef.get(scopeKey)
    if (cacheKey) cache.delete(cacheKey)
    latestByScopeRef.delete(scopeKey)
  }

  function invalidate(secretRef) {
    for (const [scopeKey, cacheKey] of latestByScopeRef.entries()) {
      if (!scopeKey.startsWith(`${secretRef}\u0000`)) continue
      cache.delete(cacheKey)
      latestByScopeRef.delete(scopeKey)
    }
  }

  return {
    runtimeSource,
    async resolve(secretRef, scope) {
      requiredText(secretRef, 'secretRef')
      assertScope(scope)

      const nowValue = now()
      const scopeKey = scopeCacheKey(secretRef, scope)
      const latestKey = latestByScopeRef.get(scopeKey)
      const cached = latestKey ? cache.get(latestKey) : null
      if (cached && cached.cachedAt + cacheTtlMs > nowValue.getTime() && cached.expiresAt.getTime() > nowValue.getTime()) {
        return cached.result
      }
      if (cached) invalidateScope(secretRef, scope)

      let raw
      try {
        raw = await adapter.resolve(secretRef, { tenantId: scope.tenantId, businessId: scope.businessId })
      } catch (error) {
        throw normalizeError(error)
      }

      let result
      try {
        result = internalResolution(raw ?? {}, nowValue)
      } catch (error) {
        throw normalizeError(error)
      }
      if (result.expiresAt.getTime() <= nowValue.getTime()) throw new SecretManagerError('Expired')

      const cacheKey = `${scopeKey}\u0000${result.version}`
      cache.set(cacheKey, {
        result,
        cachedAt: nowValue.getTime(),
        expiresAt: result.expiresAt,
      })
      latestByScopeRef.set(scopeKey, cacheKey)
      return result
    },
    invalidate,
    clear() {
      cache.clear()
      latestByScopeRef.clear()
    },
  }
}

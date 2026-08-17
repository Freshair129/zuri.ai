// @req FR-074 — resolve opaque connection secrets through an explicit runtime source.
// @spec ADR-031 §D1/D3, NFR-015, SEC-015 — production is external-manager-only,
// errors fail closed, and secret material is non-enumerable at the runtime boundary.
// @tested tests/unit/fr074-runtime-cutover.test.js

export const RUNTIME_SOURCES = Object.freeze(['PRODUCTION_LINE', 'LOCAL_DEV', 'TEST', 'EVAL'])
const SECRET_ERROR_CODES = new Set(['NotFound', 'Expired', 'Ambiguous', 'Unauthorized', 'Unavailable'])

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
  const latestByRef = new Map()

  function invalidate(secretRef) {
    const cacheKey = latestByRef.get(secretRef)
    if (cacheKey) cache.delete(cacheKey)
    latestByRef.delete(secretRef)
  }

  return {
    runtimeSource,
    async resolve(secretRef, scope) {
      requiredText(secretRef, 'secretRef')
      assertScope(scope)

      const nowValue = now()
      const latestKey = latestByRef.get(secretRef)
      const cached = latestKey ? cache.get(latestKey) : null
      if (cached && cached.cachedAt + cacheTtlMs > nowValue.getTime() && cached.expiresAt.getTime() > nowValue.getTime()) {
        return cached.result
      }
      if (cached) invalidate(secretRef)

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

      const cacheKey = `${secretRef}\u0000${result.version}`
      cache.set(cacheKey, {
        result,
        cachedAt: nowValue.getTime(),
        expiresAt: result.expiresAt,
      })
      latestByRef.set(secretRef, cacheKey)
      return result
    },
    invalidate,
    clear() {
      cache.clear()
      latestByRef.clear()
    },
  }
}

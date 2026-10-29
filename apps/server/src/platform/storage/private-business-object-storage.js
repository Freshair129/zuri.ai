// @req FR-137, FR-173, FR-253 — private Asset/catalog bytes retain purpose and immutable version.
// @spec ADR-115, SEC-001, SEC-024
// @tested tests/unit/private-business-object-storage.test.js, tests/storage/compact-business-objects.test.js
import { createS3ObjectStoragePort } from './s3-object-storage'

const PURPOSES = Object.freeze({
  asset: { selector: 'ZURI_ASSET_STORAGE_PROVIDER', prefix: 'ZURI_ASSET_STORAGE', bucket: 'ZURI_ASSET_EVIDENCE_BUCKET', namespace: 'asset-evidence' },
  catalog: { selector: 'ZURI_KNOWLEDGE_CATALOG_STORAGE_PROVIDER', prefix: 'ZURI_KNOWLEDGE_CATALOG_STORAGE', bucket: 'ZURI_KNOWLEDGE_CATALOG_BUCKET', namespace: 'business-catalog' },
})
const invalid = (status = 400, code = 'BUSINESS_STORAGE_REF_INVALID') => Object.assign(new Error('Private business object storage request refused'), { status, code })
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const SEGMENT = /^[A-Za-z0-9_-]+$/
const SHA256 = /^[a-f0-9]{64}$/i
const immutableVersion = version => typeof version === 'string' && version.trim() !== '' && version.trim().toLowerCase() !== 'null'

export function businessStorageProvider(purpose, env = process.env) {
  const definition = PURPOSES[purpose]
  if (!definition) throw invalid()
  const provider = env[definition.selector] ?? 'supabase'
  if (!['supabase', 's3'].includes(provider)) throw invalid(503, 'BUSINESS_STORAGE_CONFIG_INVALID')
  return provider
}

export function parseBusinessObjectRef(ref) {
  if (typeof ref !== 'string' || ref.length > 8192) throw invalid()
  const match = /^s3-business:\/\/(asset|catalog)\/([^/?#]+)\/([^?#]+)\?versionId=([^&#]+)$/.exec(ref)
  if (!match) throw invalid()
  try {
    const key = match[3].split('/').map(decodeURIComponent).join('/'), versionId = decodeURIComponent(match[4])
    if (!BUCKET.test(match[2]) || !immutableVersion(versionId) || /[\x00-\x1f\x7f]/.test(versionId)) throw invalid()
    // Require a single canonical encoding: encoded separators and malformed refs
    // cannot alias a different scoped key after URL normalization.
    if (key.split('/').map(encodeURIComponent).join('/') !== match[3] || encodeURIComponent(versionId) !== match[4]) throw invalid()
    return { purpose: match[1], bucket: match[2], key, versionId }
  } catch { throw invalid() }
}

function scopedKey(key, definition, { tenantId, businessId } = {}) {
  if (typeof key !== 'string') throw invalid()
  const parts = key.split('/')
  if (parts.length < 5 || parts[0] !== definition.namespace || !SEGMENT.test(parts[1]) || !SEGMENT.test(parts[2])
    || parts.some(part => !part || part === '.' || part === '..' || /[\\?#\x00-\x1f\x7f]/.test(part))
    || (tenantId !== undefined && tenantId !== parts[1]) || (businessId !== undefined && businessId !== parts[2])) throw invalid()
  return key
}

export function createPrivateBusinessObjectStoragePort(purpose, env = process.env, options = {}) {
  const definition = PURPOSES[purpose]
  if (!definition || businessStorageProvider(purpose, env) !== 's3') throw invalid(503, 'BUSINESS_STORAGE_CONFIG_INVALID')
  const bucket = env[definition.bucket]
  const configuredBuckets = [env.ZURI_ASSET_EVIDENCE_BUCKET, env.ZURI_KNOWLEDGE_CATALOG_BUCKET, env.ZURI_KNOWLEDGE_STORAGE_BUCKET].filter(Boolean)
  if (!BUCKET.test(bucket || '') || configuredBuckets.filter(value => value === bucket).length !== 1) throw invalid(503, 'BUSINESS_STORAGE_CONFIG_INVALID')
  let transport
  try {
    const fetchFn = options.fetchFn || fetch
    const versionedFetch = async (url, init) => {
      const response = await fetchFn(url, init)
      if (response.ok && ['PUT', 'GET'].includes(init.method)
        && !immutableVersion(response.headers.get('x-amz-version-id') || response.headers.get('x-minio-version-id'))) {
        // A null version can be replaced; a missing GET version cannot confirm
        // that the provider honored the pinned request. Never erase "latest".
        throw invalid(503, 'BUSINESS_STORAGE_VERSION_UNAVAILABLE')
      }
      return response
    }
    // Credentials/endpoints are configuration authority, never ref/option input.
    transport = createS3ObjectStoragePort({ endpoint: env[`${definition.prefix}_ENDPOINT`], bucket,
      accessKeyId: env[`${definition.prefix}_ACCESS_KEY`], secretAccessKey: env[`${definition.prefix}_SECRET_KEY`],
      region: env[`${definition.prefix}_REGION`] || 'us-east-1',
      fetchFn: versionedFetch, ...(options.now ? { now: options.now } : {}),
    })
  } catch { throw invalid(503, 'BUSINESS_STORAGE_CONFIG_INVALID') }
  const owned = (ref, scope) => {
    const parsed = parseBusinessObjectRef(ref)
    if (parsed.purpose !== purpose || parsed.bucket !== bucket) throw invalid()
    scopedKey(parsed.key, definition, scope)
    return parsed
  }
  const safe = async operation => {
    try { return await operation() } catch (error) {
      // Provider/network exceptions may contain credentials or internal URLs.
      throw invalid([400, 404, 409].includes(error?.status) ? error.status : 503, 'BUSINESS_STORAGE_UNAVAILABLE')
    }
  }
  return Object.freeze({
    // @req FR-292 — preparation validates the configured exact ref without IO.
    // @tested tests/integration/managed-blob-recovery.test.js
    validateRef({ ref, tenantId, businessId }) {
      if (!tenantId || !businessId) throw invalid()
      owned(ref, { tenantId, businessId })
      return true
    },
    async put({ key, content, mime = 'application/octet-stream' }) {
      scopedKey(key, definition)
      const stored = await safe(() => transport.putImmutable({ key, content, contentType: mime }))
      const ref = `s3-business://${purpose}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}?versionId=${encodeURIComponent(stored.versionId)}`
      return { ref, sha256: stored.sha256, byteLength: stored.byteLength }
    },
    async get({ ref, tenantId, businessId, expectedSha256, expectedByteLength }) {
      const { key, versionId } = owned(ref, { tenantId, businessId })
      if (expectedSha256 !== undefined && (typeof expectedSha256 !== 'string' || !SHA256.test(expectedSha256))
        || expectedByteLength !== undefined && (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0)) throw invalid()
      return safe(async () => {
        const stored = await transport.readExact({ key, versionId })
        if (expectedSha256 !== undefined && stored.sha256 !== expectedSha256.toLowerCase()
          || expectedByteLength !== undefined && stored.byteLength !== expectedByteLength) throw invalid(409)
        return stored.bytes
      })
    },
    async remove({ ref, tenantId, businessId }) {
      const { key, versionId } = owned(ref, { tenantId, businessId })
      await safe(() => transport.eraseExactVersions({ key, versionIds: [versionId] }))
    },
  })
}

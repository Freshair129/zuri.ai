// @req FR-109, FR-173 — knowledge raw bytes cross a provider-neutral object
// storage boundary without exposing credentials or mutable latest-object reads.
// @spec TASK-ZAI-049 storage spec, ADR-072, ADR-050
// @tested tests/unit/knowledge-s3-object-storage.test.js

import { createHash, createHmac } from 'node:crypto'

const DEFAULT_REGION = 'us-east-1'
const SERVICE = 's3'
const SHA256 = /^[a-f0-9]{64}$/i

function storageError(message, status = 503, code = 'KNOWLEDGE_STORAGE_UNAVAILABLE') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw storageError(`${name} is not configured`, 503, 'KNOWLEDGE_STORAGE_CONFIG_INVALID')
  return value.trim()
}

function endpointUrl(value) {
  const raw = required(value, 'Object storage endpoint').replace(/\/+$/, '')
  let parsed
  try { parsed = new URL(raw) } catch { throw storageError('Object storage endpoint is invalid', 503, 'KNOWLEDGE_STORAGE_CONFIG_INVALID') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw storageError('Object storage endpoint must be an HTTP(S) origin', 503, 'KNOWLEDGE_STORAGE_CONFIG_INVALID')
  }
  return parsed
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function objectPath(bucket, key) {
  const segments = String(key).split('/')
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw storageError('Object storage key is invalid', 400, 'KNOWLEDGE_STORAGE_KEY_INVALID')
  }
  return `/${encodePathSegment(bucket)}/${segments.map(encodePathSegment).join('/')}`
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest()
}

function canonicalQuery(entries) {
  return [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${encodePathSegment(name)}=${encodePathSegment(value)}`)
    .join('&')
}

function canonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([left], [right]) => left.localeCompare(right))
  return {
    names: entries.map(([name]) => name).join(';'),
    value: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
  }
}

function signRequest({ method, url, headers, bodyHash, accessKeyId, secretAccessKey, region, now }) {
  const date = now instanceof Date ? now : new Date(now || Date.now())
  if (Number.isNaN(date.valueOf())) throw storageError('Object storage signing time is invalid', 500, 'KNOWLEDGE_STORAGE_SIGNING_INVALID')
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const shortDate = amzDate.slice(0, 8)
  const host = url.host
  const signedHeadersInput = { host, ...headers, 'x-amz-content-sha256': bodyHash, 'x-amz-date': amzDate }
  const signed = canonicalHeaders(signedHeadersInput)
  const canonicalRequest = [method, url.pathname, url.search.slice(1), signed.value, signed.names, bodyHash].join('\n')
  const scope = `${shortDate}/${region}/${SERVICE}/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, shortDate), region), SERVICE), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  return {
    ...headers,
    host,
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed.names}, Signature=${signature}`,
  }
}

function responseVersion(response) {
  return response.headers.get('x-amz-version-id') || response.headers.get('x-minio-version-id') || null
}

function exactResponseVersion(response, requestedVersion) {
  const returnedVersion = responseVersion(response)
  if (returnedVersion && returnedVersion !== requestedVersion) {
    throw storageError('Object storage returned a different object version', 409, 'KNOWLEDGE_STORAGE_VERSION_MISMATCH')
  }
  return returnedVersion || requestedVersion
}

async function providerRequest(fetchFn, url, init, expectedStatuses) {
  let response
  try { response = await fetchFn(url, init) } catch (error) {
    throw storageError(`Object storage request failed: ${error?.message || 'network error'}`)
  }
  if (!expectedStatuses.includes(response.status)) {
    const status = response.status === 404 ? 404 : response.status === 409 || response.status === 412 ? 409 : 503
    const code = response.status === 404 ? 'KNOWLEDGE_STORAGE_OBJECT_NOT_FOUND' : response.status === 409 || response.status === 412 ? 'KNOWLEDGE_STORAGE_OBJECT_EXISTS' : 'KNOWLEDGE_STORAGE_PROVIDER_ERROR'
    throw storageError('Object storage request was rejected', status, code)
  }
  return response
}

function toBuffer(content) {
  if (Buffer.isBuffer(content)) return Buffer.from(content)
  if (content instanceof Uint8Array) return Buffer.from(content)
  throw storageError('Object storage content must be bytes', 400, 'KNOWLEDGE_STORAGE_CONTENT_INVALID')
}

export function createS3ObjectStoragePort({
  endpoint,
  accessKeyId,
  secretAccessKey,
  bucket,
  region = DEFAULT_REGION,
  fetchFn = fetch,
  now = () => new Date(),
} = {}) {
  const root = endpointUrl(endpoint)
  const access = required(accessKeyId, 'Object storage access key')
  const secret = required(secretAccessKey, 'Object storage secret key')
  const bucketName = required(bucket, 'Object storage bucket')
  const regionName = required(region, 'Object storage region')
  if (typeof fetchFn !== 'function') throw storageError('Object storage fetch function is invalid', 500, 'KNOWLEDGE_STORAGE_CONFIG_INVALID')

  function request(method, key, { body = Buffer.alloc(0), query = [], headers = {}, statuses = [200] } = {}) {
    const url = new URL(root.href)
    url.pathname = `${root.pathname.replace(/\/$/, '')}${objectPath(bucketName, key)}`
    url.search = canonicalQuery(query)
    const payload = toBuffer(body)
    const bodyHash = sha256(payload)
    const signed = signRequest({ method, url, headers, bodyHash, accessKeyId: access, secretAccessKey: secret, region: regionName, now: typeof now === 'function' ? now() : now })
    return providerRequest(fetchFn, url.href, {
      method,
      headers: { ...signed, 'content-length': String(payload.length) },
      ...(method === 'GET' || method === 'HEAD' || payload.length === 0 ? {} : { body: payload }),
    }, statuses)
  }

  return Object.freeze({
    async putImmutable({ key, content, contentType = 'application/octet-stream', expectedSha256 } = {}) {
      const bytes = toBuffer(content)
      const digest = sha256(bytes)
      if (expectedSha256 !== undefined && (!SHA256.test(expectedSha256) || expectedSha256.toLowerCase() !== digest)) {
        throw storageError('Object storage content hash mismatch', 409, 'KNOWLEDGE_STORAGE_HASH_MISMATCH')
      }
      const response = await request('PUT', key, {
        body: bytes,
        headers: { 'content-type': contentType, 'if-none-match': '*' },
        statuses: [200, 201],
      })
      const versionId = responseVersion(response)
      if (!versionId) throw storageError('Object storage did not return an immutable version', 503, 'KNOWLEDGE_STORAGE_VERSION_UNAVAILABLE')
      return { key, versionId, sha256: digest, byteLength: bytes.length }
    },

    async readExact({ key, versionId } = {}) {
      const version = required(versionId, 'Object storage version')
      const response = await request('GET', key, { query: [['versionId', version]], statuses: [200] })
      const bytes = Buffer.from(await response.arrayBuffer())
      return { bytes, versionId: exactResponseVersion(response, version), contentType: response.headers.get('content-type') || 'application/octet-stream', sha256: sha256(bytes), byteLength: bytes.length }
    },

    async statExact({ key, versionId } = {}) {
      const version = required(versionId, 'Object storage version')
      const response = await request('HEAD', key, { query: [['versionId', version]], statuses: [200] })
      const contentLength = Number(response.headers.get('content-length'))
      return { versionId: exactResponseVersion(response, version), contentType: response.headers.get('content-type') || 'application/octet-stream', byteLength: Number.isSafeInteger(contentLength) ? contentLength : null, sha256: response.headers.get('x-amz-meta-sha256') || null }
    },

    async eraseExactVersions({ key, versionIds } = {}) {
      if (!Array.isArray(versionIds) || versionIds.length < 1 || versionIds.some((version) => typeof version !== 'string' || !version.trim())) throw storageError('Object storage erase requires exact versions', 400, 'KNOWLEDGE_STORAGE_VERSION_REQUIRED')
      for (const versionId of versionIds) await request('DELETE', key, { query: [['versionId', versionId]], statuses: [200, 204] })
      return { key, erasedVersionIds: [...versionIds] }
    },
  })
}

export function createConfiguredKnowledgeObjectStoragePort(env = process.env, options = {}) {
  if (env.ZURI_KNOWLEDGE_STORAGE_ENABLED !== '1') return null
  return createS3ObjectStoragePort({
    endpoint: env.ZURI_KNOWLEDGE_STORAGE_ENDPOINT,
    accessKeyId: env.ZURI_KNOWLEDGE_STORAGE_ACCESS_KEY,
    secretAccessKey: env.ZURI_KNOWLEDGE_STORAGE_SECRET_KEY,
    bucket: env.ZURI_KNOWLEDGE_STORAGE_BUCKET,
    region: env.ZURI_KNOWLEDGE_STORAGE_REGION || DEFAULT_REGION,
    ...options,
  })
}

// A MANAGED_BLOB FileAsset on the private knowledge store (MinIO) is referenced
// as `s3://<bucket>/<key>?versionId=<id>`. Pinning the version keeps the ref
// byte-stable: the bucket is versioned and writes are if-none-match, so a ref
// always resolves to the exact bytes it was created with.
const MANAGED_BLOB_REF = /^s3:\/\/([^/?]+)\/([^?]+)\?versionId=([^&]+)$/

export function knowledgeManagedBlobRef({ bucket, key, versionId }) {
  return `s3://${bucket}/${key}?versionId=${encodeURIComponent(versionId)}`
}

export function parseKnowledgeManagedBlobRef(ref) {
  const match = MANAGED_BLOB_REF.exec(String(ref || ''))
  if (!match) throw storageError('Managed blob reference is invalid', 400, 'KNOWLEDGE_STORAGE_REF_INVALID')
  return { bucket: match[1], key: match[2], versionId: decodeURIComponent(match[3]) }
}

export function isKnowledgeManagedBlobRef(ref, env = process.env) {
  const bucket = env.ZURI_KNOWLEDGE_STORAGE_BUCKET
  return typeof bucket === 'string' && bucket.trim() !== '' && typeof ref === 'string' && ref.startsWith(`s3://${bucket}/`)
}

/**
 * The `put/get/remove({ ref })` port FileAsset managed blobs use, backed by the
 * configured private knowledge store. Null when that store is not enabled, so a
 * caller can refuse instead of silently falling back to a hosted bucket.
 */
export function createConfiguredKnowledgeManagedBlobPort(env = process.env, options = {}) {
  const port = createConfiguredKnowledgeObjectStoragePort(env, options)
  if (!port) return null
  const bucket = env.ZURI_KNOWLEDGE_STORAGE_BUCKET
  const own = (ref) => {
    const parsed = parseKnowledgeManagedBlobRef(ref)
    if (parsed.bucket !== bucket) throw storageError('Managed blob reference names another bucket', 400, 'KNOWLEDGE_STORAGE_REF_INVALID')
    return parsed
  }
  return Object.freeze({
    async put({ key, content, mime = 'application/octet-stream' }) {
      const stored = await port.putImmutable({ key, content, contentType: mime })
      return { ref: knowledgeManagedBlobRef({ bucket, key, versionId: stored.versionId }), sha256: stored.sha256, byteLength: stored.byteLength }
    },
    async get({ ref }) {
      const { key, versionId } = own(ref)
      return (await port.readExact({ key, versionId })).bytes
    },
    async remove({ ref }) {
      const { key, versionId } = own(ref)
      await port.eraseExactVersions({ key, versionIds: [versionId] })
    },
  })
}

export { sha256 as sha256Bytes }

// @req FR-137 — first provider for the private evidence object port.
// @spec SDD-081, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-storage-contract.test.js

const DEFAULT_TIMEOUT_MS = 20_000

function storageError(message, status = 503) {
  const error = new Error(message)
  error.status = status
  return error
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw storageError(`${name} is not configured`)
  return value.replace(/\/+$/, '')
}

function encodeObjectPath(key) {
  return String(key).split('/').map(encodeURIComponent).join('/')
}

function refFor(bucket, key) {
  return `supabase://${bucket}/${key}`
}

function keyFromRef(ref, bucket) {
  const prefix = `supabase://${bucket}/`
  if (typeof ref !== 'string' || !ref.startsWith(prefix) || ref.length === prefix.length) {
    throw storageError('Managed object reference is invalid', 400)
  }
  return ref.slice(prefix.length)
}

async function request(fetchFn, url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      throw storageError(`Object storage request failed (${response.status})`)
    }
    return response
  } catch (error) {
    if (error?.name === 'AbortError') throw storageError('Object storage request timed out')
    if (Number(error?.status)) throw error
    throw storageError(`Object storage unavailable: ${error?.message || 'unknown error'}`)
  } finally {
    clearTimeout(timer)
  }
}

export function createSupabaseObjectStoragePort({
  baseUrl,
  serviceRoleKey,
  bucket,
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const root = required(baseUrl, 'Supabase URL')
  const credential = required(serviceRoleKey, 'Supabase service role key')
  const bucketId = required(bucket, 'Asset evidence bucket')
  const headers = { apikey: credential, Authorization: `Bearer ${credential}` }
  const objectUrl = (key) => `${root}/storage/v1/object/${encodeURIComponent(bucketId)}/${encodeObjectPath(key)}`

  return Object.freeze({
    async put({ key, content, mime }) {
      const body = Buffer.isBuffer(content) ? content : Buffer.from(content)
      await request(fetchFn, objectUrl(key), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': mime, 'x-upsert': 'false' },
        body,
      }, timeoutMs)
      return { ref: refFor(bucketId, key) }
    },
    async get({ ref }) {
      const key = keyFromRef(ref, bucketId)
      const response = await request(fetchFn, objectUrl(key), { method: 'GET', headers }, timeoutMs)
      return Buffer.from(await response.arrayBuffer())
    },
    async remove({ ref }) {
      const key = keyFromRef(ref, bucketId)
      await request(fetchFn, `${root}/storage/v1/object/${encodeURIComponent(bucketId)}`, {
        method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }),
      }, timeoutMs)
    },
  })
}

export function createConfiguredAssetObjectStoragePort(env = process.env, options = {}) {
  return createSupabaseObjectStoragePort({
    baseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_STORAGE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: env.ZURI_ASSET_EVIDENCE_BUCKET,
    ...options,
  })
}

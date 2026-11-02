// @req FR-293 — transfer bytes and custody are bounded by one explicit profile.
// @spec ADR-115
// @tested tests/unit/managed-blob-transfer-contract.test.js
import { createHmac } from 'node:crypto'
import { businessStorageProvider } from '@/platform/storage/private-business-object-storage'

export const MANAGED_BLOB_TRANSFER_CODEC_PROFILE = Object.freeze({
  maxManifestBytes: 2 * 1024 * 1024,
  maxSnapshotBytes: 16 * 1024 * 1024,
  maxEntries: 128,
  maxBindings: 4096,
  maxOriginalBytes: 96 * 1024 * 1024,
  maxPackageBytes: 128 * 1024 * 1024,
})

export const MANAGED_BLOB_TRANSFER_PROFILE = Object.freeze({
  ...MANAGED_BLOB_TRANSFER_CODEC_PROFILE,
  spoolQuotaBytes: 256 * 1024 * 1024,
  confirmationTtlMs: 15 * 60 * 1000,
  byteRetentionMs: 24 * 60 * 60 * 1000,
  providerOperationTimeoutMs: 20_000,
  jobDurationMs: 15 * 60 * 1000,
})

const names = Object.freeze({
  asset: ['ZURI_ASSET_STORAGE_PROVIDER', 'ZURI_ASSET_EVIDENCE_BUCKET', 'ZURI_ASSET_STORAGE_ENDPOINT',
    'ZURI_ASSET_STORAGE_REGION', 'ZURI_ASSET_STORAGE_ACCESS_KEY', 'ZURI_ASSET_STORAGE_SECRET_KEY'],
  catalog: ['ZURI_KNOWLEDGE_CATALOG_STORAGE_PROVIDER', 'ZURI_KNOWLEDGE_CATALOG_BUCKET',
    'ZURI_KNOWLEDGE_CATALOG_STORAGE_ENDPOINT', 'ZURI_KNOWLEDGE_CATALOG_STORAGE_REGION',
    'ZURI_KNOWLEDGE_CATALOG_STORAGE_ACCESS_KEY', 'ZURI_KNOWLEDGE_CATALOG_STORAGE_SECRET_KEY'],
})

const value = (env, name, defaultValue = '') => String(env?.[name] ?? defaultValue)

export function managedBlobTransferConfigHash(env = process.env) {
  const key = env?.ZURI_SESSION_SECRET
  if (typeof key !== 'string' || key.length < 32) throw Object.assign(new Error('Transfer profile unavailable'), { status: 503, code: 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE' })
  const config = {}
  for (const purpose of ['asset', 'catalog']) {
    const [providerName, bucketName, endpointName, regionName, accessName, secretName] = names[purpose]
    if (businessStorageProvider(purpose, env) !== 's3') throw Object.assign(new Error('Transfer profile unavailable'), { status: 503, code: 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE' })
    const endpoint = value(env, endpointName)
    const bucket = value(env, bucketName)
    const accessKey = value(env, accessName)
    const secretKey = value(env, secretName)
    if (!endpoint || !bucket || !accessKey || !secretKey) throw Object.assign(new Error('Transfer profile unavailable'), { status: 503, code: 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE' })
    let url
    try { url = new URL(endpoint) } catch { throw Object.assign(new Error('Transfer profile unavailable'), { status: 503, code: 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE' }) }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw Object.assign(new Error('Transfer profile unavailable'), { status: 503, code: 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE' })
    }
    config[purpose] = { provider: value(env, providerName, 's3'), bucket, endpoint: url.origin + url.pathname.replace(/\/$/, ''),
      region: value(env, regionName, 'us-east-1'), accessKey, secretKey }
  }
  return createHmac('sha256', key).update(JSON.stringify(config)).digest('hex')
}

export function managedBlobTransferSourceRevision(env = process.env) {
  const revision = env.ZURI_BUILD_REVISION ?? env.GITHUB_SHA ?? env.VERCEL_GIT_COMMIT_SHA
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) {
    throw Object.assign(new Error('Transfer source revision unavailable'), { status: 503, code: 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE' })
  }
  return revision
}

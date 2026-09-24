// @spec ADR-107 - private conditional writes and exact provider-version reads.
// @tested tests/s3-storage.test.js
import { createReadStream } from 'node:fs'
import { FileManagementError, fail } from './errors.js'

function storageFailure(error, fallbackCode = 'FILE_STORAGE_UNAVAILABLE') {
  if (error instanceof FileManagementError) return error
  const name = String(error?.name || '')
  if (name === 'NotFound' || name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return new FileManagementError('FILE_OBJECT_NOT_FOUND', 404, 'Stored file object was not found')
  if (name === 'PreconditionFailed' || error?.$metadata?.httpStatusCode === 412) return new FileManagementError('FILE_OBJECT_CONFLICT', 409, 'Storage object already exists with another receipt')
  return new FileManagementError(fallbackCode, 503, 'File storage request was not confirmed')
}

function validVersion(versionId) {
  return typeof versionId === 'string' && versionId.trim() !== '' && versionId !== 'null'
}

export function createS3FileStoragePort({ client, bindingId, bucket, commands }) {
  if (!client || !bindingId || !bucket || !commands?.PutObjectCommand || !commands?.HeadObjectCommand || !commands?.GetObjectCommand || !commands?.GetBucketVersioningCommand || !commands?.HeadBucketCommand) {
    throw new TypeError('S3 storage port requires client, binding identity, bucket, and S3 commands')
  }

  async function headCurrent(key) {
    return client.send(new commands.HeadObjectCommand({ Bucket: bucket, Key: key }))
  }

  function confirmHead(head, expected) {
    const versionId = head.VersionId
    const metadata = head.Metadata || {}
    if (!validVersion(versionId)) fail('FILE_STORAGE_VERSION_UNAVAILABLE', 503, 'Storage bucket did not return an immutable version ID')
    if (metadata.operationid !== expected.operationId || metadata.sha256 !== expected.sha256 || Number(head.ContentLength) !== expected.byteLength) {
      fail('FILE_OBJECT_CONFLICT', 409, 'Storage object does not match the pending file operation')
    }
    return { provider: 'S3_COMPATIBLE', bindingId, bucket, key: expected.key, versionId, sha256: expected.sha256, byteLength: expected.byteLength }
  }

  return Object.freeze({
    async binding() { return { provider: 'S3_COMPATIBLE', bindingId, bucket } },
    async health() {
      try {
        await client.send(new commands.HeadBucketCommand({ Bucket: bucket }))
        const versioning = await client.send(new commands.GetBucketVersioningCommand({ Bucket: bucket }))
        return versioning.Status === 'Enabled'
      } catch (error) {
        throw storageFailure(error)
      }
    },
    async putImmutable({ key, bodyPath, operationId, sha256, byteLength, contentType }) {
      const expected = { key, operationId, sha256, byteLength }
      try {
        const existing = await headCurrent(key)
        return confirmHead(existing, expected)
      } catch (error) {
        if (error instanceof FileManagementError && error.code === 'FILE_OBJECT_CONFLICT') throw error
        if (error?.name !== 'NotFound' && error?.name !== 'NoSuchKey' && error?.$metadata?.httpStatusCode !== 404) {
          if (error instanceof FileManagementError) throw error
          if (error?.$metadata?.httpStatusCode !== 404) throw storageFailure(error)
        }
      }

      try {
        const response = await client.send(new commands.PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(bodyPath),
          ContentLength: byteLength,
          ContentType: contentType,
          IfNoneMatch: '*',
          Metadata: { operationid: operationId, sha256 },
        }))
        const versionId = response.VersionId
        if (!validVersion(versionId)) fail('FILE_STORAGE_VERSION_UNAVAILABLE', 503, 'Storage bucket did not return an immutable version ID')
        return { provider: 'S3_COMPATIBLE', bindingId, bucket, key, versionId, sha256, byteLength }
      } catch (error) {
        if (error instanceof FileManagementError) throw error
        try {
          const reconciled = await headCurrent(key)
          return confirmHead(reconciled, expected)
        } catch (headError) {
          if (headError instanceof FileManagementError) throw headError
          throw storageFailure(error, 'FILE_STORAGE_WRITE_UNCERTAIN')
        }
      }
    },
    async readExact({ provider, bindingId: requestedBindingId, bucket: requestedBucket, key, versionId }) {
      if (!validVersion(versionId)) fail('FILE_STORAGE_VERSION_REQUIRED', 400, 'An exact storage version is required')
      if (provider !== 'S3_COMPATIBLE' || requestedBindingId !== bindingId || requestedBucket !== bucket) fail('FILE_STORAGE_BINDING_MISMATCH', 503, 'Recorded storage binding is not configured on this service')
      try {
        const result = await client.send(new commands.GetObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }))
        if (result.VersionId !== versionId || !validVersion(result.VersionId)) {
          result.Body?.destroy?.()
          fail('FILE_STORAGE_VERSION_MISMATCH', 409, 'Storage returned a different object version')
        }
        return { body: result.Body, versionId: result.VersionId, contentType: result.ContentType || 'application/octet-stream', byteLength: Number(result.ContentLength) }
      } catch (error) {
        if (error instanceof FileManagementError) throw error
        throw storageFailure(error, 'FILE_STORAGE_READ_FAILED')
      }
    },
    async close() { client.destroy?.() },
  })
}

export async function createConfiguredS3FileStoragePort(env = process.env) {
  const endpoint = env.FILE_STORAGE_ENDPOINT
  const bindingId = env.FILE_STORAGE_BINDING_ID
  const bucket = env.FILE_STORAGE_BUCKET
  const accessKeyId = env.FILE_STORAGE_ACCESS_KEY_ID
  const secretAccessKey = env.FILE_STORAGE_SECRET_ACCESS_KEY
  if (![endpoint, bindingId, bucket, accessKeyId, secretAccessKey].every((value) => typeof value === 'string' && value.trim())) return null
  const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, GetBucketVersioningCommand, HeadBucketCommand } = await import('@aws-sdk/client-s3')
  const parsed = new URL(endpoint)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail('FILE_STORAGE_CONFIG_INVALID', 500, 'File storage endpoint must be a clean HTTP(S) URL')
  }
  const client = new S3Client({
    endpoint: parsed.href.replace(/\/$/, ''),
    region: env.FILE_STORAGE_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
  })
  return createS3FileStoragePort({ client, bindingId: bindingId.trim(), bucket: bucket.trim(), commands: { PutObjectCommand, HeadObjectCommand, GetObjectCommand, GetBucketVersioningCommand, HeadBucketCommand } })
}

// @spec ADR-107 - exact provider binding and version proof.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createS3FileStoragePort } from '../src/s3-storage.js'

class PutObjectCommand { constructor(input) { this.input = input } }
class HeadObjectCommand { constructor(input) { this.input = input } }
class GetObjectCommand { constructor(input) { this.input = input } }
class GetBucketVersioningCommand { constructor(input) { this.input = input } }
class HeadBucketCommand { constructor(input) { this.input = input } }

const commands = { PutObjectCommand, HeadObjectCommand, GetObjectCommand, GetBucketVersioningCommand, HeadBucketCommand }

test('readiness requires a reachable bucket with versioning enabled', async () => {
  const client = { async send(command) {
    if (command instanceof GetBucketVersioningCommand) return { Status: 'Suspended' }
    return {}
  } }
  const storage = createS3FileStoragePort({ client, bindingId: 'local-minio-a', bucket: 'private-files', commands })
  assert.equal(await storage.health(), false)
})

test('conditional original write returns and records the exact provider version', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 's3-storage-test-'))
  t.after(async () => rm(directory, { recursive: true, force: true }))
  const bodyPath = join(directory, 'content')
  await writeFile(bodyPath, 'bytes', { flag: 'wx', mode: 0o600 })
  const calls = []
  const client = { async send(command) {
    calls.push(command)
    if (command instanceof HeadObjectCommand) throw Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
    if (command instanceof PutObjectCommand) return { VersionId: 'minio-version-1' }
    return {}
  } }
  const storage = createS3FileStoragePort({ client, bindingId: 'local-minio-a', bucket: 'private-files', commands })
  assert.deepEqual(await storage.binding(), { provider: 'S3_COMPATIBLE', bindingId: 'local-minio-a', bucket: 'private-files' })
  const stored = await storage.putImmutable({ key: 'originals/t/b/f/op', bodyPath, operationId: 'op-1', sha256: 'a'.repeat(64), byteLength: 5, contentType: 'text/plain' })
  assert.equal(stored.versionId, 'minio-version-1')
  assert.equal(stored.bindingId, 'local-minio-a')
  assert.equal(stored.bucket, 'private-files')
  const put = calls.find((call) => call instanceof PutObjectCommand).input
  assert.equal(put.IfNoneMatch, '*')
  assert.equal(put.Metadata.operationid, 'op-1')
})

test('exact reads request and validate the recorded storage version', async () => {
  let requestedVersion
  const client = { async send(command) {
    if (command instanceof GetObjectCommand) {
      requestedVersion = command.input.VersionId
      return { VersionId: 'minio-version-1', ContentLength: 4, ContentType: 'text/plain', Body: Readable.from([Buffer.from('data')]) }
    }
    return {}
  } }
  const storage = createS3FileStoragePort({ client, bindingId: 'local-minio-a', bucket: 'private-files', commands })
  const result = await storage.readExact({ provider: 'S3_COMPATIBLE', bindingId: 'local-minio-a', bucket: 'private-files', key: 'originals/t/b/f/op', versionId: 'minio-version-1' })
  assert.equal(requestedVersion, 'minio-version-1')
  assert.equal(result.versionId, 'minio-version-1')
  assert.equal(result.byteLength, 4)
  await assert.rejects(storage.readExact({ provider: 'S3_COMPATIBLE', bindingId: 'other-minio', bucket: 'private-files', key: 'originals/t/b/f/op', versionId: 'minio-version-1' }), (error) => error.code === 'FILE_STORAGE_BINDING_MISMATCH')
})

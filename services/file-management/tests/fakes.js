// @spec ADR-107 - deterministic isolated authority, repository and storage fixtures.
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { FileManagementError } from '../src/errors.js'

export const tenantId = '10000000-0000-4000-8000-000000000001'
export const businessA = '20000000-0000-4000-8000-000000000001'
export const businessB = '20000000-0000-4000-8000-000000000002'
export const actorId = '30000000-0000-4000-8000-000000000001'

export class MemoryRepository {
  operations = new Map()
  files = new Map()
  versions = new Map()
  operationKeys = new Map()
  auditEvents = []
  outboxEvents = []

  async health() { return true }
  async close() {}

  async beginOperation(input) {
    const key = [input.tenantId, input.businessId, input.actorId, input.operationType, input.idempotencyKey].join('|')
    const existing = this.operations.get(this.operationKeys.get(key))
    if (existing) return structuredClone(existing)
    const operation = { ...input, status: 'PENDING', result: null }
    this.operations.set(operation.operationId, operation)
    this.operationKeys.set(key, operation.operationId)
    return structuredClone(operation)
  }

  async commitOperation({ operation, stored, now }) {
    const current = this.operations.get(operation.operationId)
    if (current.status === 'COMMITTED') return structuredClone(current.result)
    if (current.operationType === 'CREATE') {
      this.files.set(current.fileId, { id: current.fileId, tenantId: current.tenantId, businessId: current.businessId, status: 'ACTIVE', deletedAt: null, currentVersionId: null, createdBy: current.actorId, createdAt: now, updatedAt: now })
    }
    const file = this.files.get(current.fileId)
    if (!file || file.tenantId !== current.tenantId || file.businessId !== current.businessId || file.status !== 'ACTIVE') throw new Error('scope mismatch')
    const prior = this.versions.get(current.fileId) || []
    const version = { id: current.versionId, fileId: current.fileId, versionNumber: prior.length + 1, fileName: current.fileName, contentType: current.contentType, detectedContentType: null, safetyState: 'UNSCANNED', byteLength: current.byteLength, sha256: current.sha256, storageProvider: stored.provider, storageBindingId: stored.bindingId, storageBucket: stored.bucket, storageKey: stored.key, storageVersionId: stored.versionId, provenance: current.provenance, createdBy: current.actorId, createdAt: now }
    prior.unshift(version)
    this.versions.set(current.fileId, prior)
    this.auditEvents.push({ operationId: current.operationId, fileId: current.fileId, type: 'FILE_VERSION_STORED', versionId: version.id })
    this.outboxEvents.push({ operationId: current.operationId, fileId: current.fileId, versionId: version.id, type: 'FILE_VERSION_READY', sha256: current.sha256, byteLength: current.byteLength, safetyState: 'UNSCANNED' })
    file.currentVersionId = version.id
    file.currentVersion = version
    file.updatedAt = now
    const result = { fileId: current.fileId, versionId: version.id, versionNumber: version.versionNumber, operationId: current.operationId, correlationId: current.correlationId, status: 'STORED', sha256: current.sha256, byteLength: current.byteLength, storageVersionId: stored.versionId }
    current.status = 'COMMITTED'
    current.result = result
    current.completedAt = now
    return structuredClone(result)
  }

  async getFile(id) { return structuredClone(this.files.get(id) || null) }
  async listFiles({ tenantId: requestedTenantId, businessId: requestedBusinessId, limit, cursor, query }) {
    const search = query?.toLowerCase()
    const cursorTime = cursor ? Date.parse(cursor.updatedAt) : null
    const rows = [...this.files.values()].filter((file) => {
      if (file.tenantId !== requestedTenantId || file.businessId !== requestedBusinessId || file.status !== 'ACTIVE' || file.deletedAt || !file.currentVersion) return false
      if (search && !file.currentVersion.fileName.toLowerCase().includes(search)) return false
      if (cursor) {
        const updatedAt = new Date(file.updatedAt).valueOf()
        if (!(updatedAt < cursorTime || updatedAt === cursorTime && file.id < cursor.id)) return false
      }
      return true
    }).sort((left, right) => new Date(right.updatedAt).valueOf() - new Date(left.updatedAt).valueOf() || right.id.localeCompare(left.id))
    return structuredClone(rows.slice(0, limit))
  }
  async getVersion(fileId, versionId) { return structuredClone((this.versions.get(fileId) || []).find((version) => version.id === versionId) || null) }
  async listVersions(fileId) { return structuredClone(this.versions.get(fileId) || []) }
  async getOperation(input) {
    const operation = [...this.operations.values()].find((item) => item.tenantId === input.tenantId && item.businessId === input.businessId && item.actorId === input.actorId && item.idempotencyKey === input.idempotencyKey)
    return operation ? { operationId: operation.operationId, fileId: operation.fileId, status: operation.status, result: operation.result } : null
  }
}

export class MemoryStorage {
  objects = new Map()
  putCount = 0
  loseNextResponse = false
  corruptReads = false
  bucket = 'test-private-files'
  bindingId = 'fixture-storage-a'

  async health() { return true }
  async binding() { return { provider: 'S3_COMPATIBLE', bindingId: this.bindingId, bucket: this.bucket } }
  async close() {}

  async putImmutable(input) {
    this.putCount += 1
    const existing = this.objects.get(input.key)
    if (existing) return { provider: 'S3_COMPATIBLE', bindingId: this.bindingId, bucket: this.bucket, key: input.key, versionId: existing.versionId, sha256: existing.sha256, byteLength: existing.byteLength }
    const body = await readFile(input.bodyPath)
    const object = { body, versionId: `provider-${randomUUID()}`, sha256: createHash('sha256').update(body).digest('hex'), byteLength: body.length, operationId: input.operationId }
    this.objects.set(input.key, object)
    if (this.loseNextResponse) {
      this.loseNextResponse = false
      throw new Error('simulated response loss after object write')
    }
    return { provider: 'S3_COMPATIBLE', bindingId: this.bindingId, bucket: this.bucket, key: input.key, versionId: object.versionId, sha256: object.sha256, byteLength: object.byteLength }
  }

  async readExact({ provider, bindingId, bucket, key, versionId }) {
    if (provider !== 'S3_COMPATIBLE' || bindingId !== this.bindingId || bucket !== this.bucket) throw new FileManagementError('FILE_STORAGE_BINDING_MISMATCH', 503)
    const object = [...this.objects.values()].find((item) => item.versionId === versionId)
    if (!object) throw new FileManagementError('FILE_OBJECT_NOT_FOUND', 404)
    const bytes = this.corruptReads ? Buffer.from(object.body.map((value, index) => index === 0 ? value ^ 1 : value)) : object.body
    return { body: Readable.from([bytes]), versionId, contentType: 'text/plain', byteLength: bytes.length }
  }
}

export function makeAuthority({ allowedTenant = tenantId, allowedBusiness = businessB, extraPermissions = [] } = {}) {
  return {
    calls: [],
    async authorize(input) {
      this.calls.push({ action: input.action, tenantId: input.tenantId, businessId: input.businessId, ...(input.provenance ? { provenance: structuredClone(input.provenance) } : {}) })
      if (input.tenantId !== allowedTenant || input.businessId !== allowedBusiness || input.bearerToken !== 'test-user-token') {
        throw new FileManagementError('FILE_AUTHORITY_DENIED', 403, 'denied')
      }
      return { actorId, tenantId: input.tenantId, businessId: input.businessId, permissions: [input.action, ...extraPermissions] }
    },
    async health() { return true },
  }
}

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { runRetentionSweep } from '@/modules/crm/retention-sweep-service'
import { runChatEvidenceArchiveExpiry } from '@/modules/crm/chat-evidence-archive-expiry-run-service'
import { expireChatEvidenceArchive } from '@/modules/crm/chat-evidence-archive-expiry-service'
import { RETENTION_SWEEP_TOMBSTONE } from '@/modules/crm/retention-sweep-tombstone'

// @req FR-245, SEC-034 — archive expiry dry runs simulate key destruction and retirement ordering without writes.
// @spec ADR-093 D5, D6; SDD-103
// @tested tests/integration/crm-archive-expiry-dry-run.test.js

const DAY_MS = 24 * 60 * 60 * 1000
const FIXED_NOW = new Date('2036-05-04T12:30:00.000Z')
const WRITE_METHODS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'])
const TENANT_LIST_MODELS = new Set(['archiveManifest', 'customerArchiveKey', 'legalHoldArchiveKey'])
const archiveDirectories = []
const symlinkSupported = await (async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-crm-expiry-symlink-probe-'))
  try {
    const target = path.join(directory, 'target')
    await fs.mkdir(target)
    try {
      await fs.symlink(target, path.join(directory, 'link'), 'dir')
      return true
    } catch (error) {
      if (['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error?.code)) return false
      throw error
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})()
const symlinkSupportLabel = symlinkSupported ? 'platform permits fs.symlink' : 'platform refuses fs.symlink'

afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of archiveDirectories.splice(0)) {
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
})

async function archiveDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-crm-expiry-dry-'))
  archiveDirectories.push(directory)
  return directory
}

function denyFsAccessAt(targetDirectory) {
  const originalAccess = fs.access.bind(fs)
  const deniedPath = path.resolve(targetDirectory)
  return vi.spyOn(fs, 'access').mockImplementation((target, mode) => {
    if (path.resolve(String(target)) === deniedPath) {
      const error = new Error('permission denied')
      error.code = 'EACCES'
      return Promise.reject(error)
    }
    return originalAccess(target, mode)
  })
}

async function freshScope(label) {
  const suffix = randomUUID().slice(0, 8)
  const portfolio = await createPortfolio({ name: `Archive expiry ${label} ${suffix}`, code: `PF-AEDR-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Archive expiry ${label}`, code: `TNT-AEDR-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `Archive expiry ${label}`, code: `BUS-AEDR-${suffix}` })
  return { tenant, business }
}

async function archiveOneMessage({ scope, label, ageYears, now, baseDir, env }) {
  const message = await ingestLineMessage({
    tenantId: scope.tenant.id,
    businessId: scope.business.id,
    lineUserId: `U-AEDR-${label}`,
    threadId: `TH-AEDR-${label}`,
    text: `archive expiry fixture ${label}`,
    externalMessageId: `MI-AEDR-${label}`,
  })
  const createdAt = new Date(now.getTime() - ageYears * 365 * DAY_MS)
  await prisma.message.update({ where: { id: message.messageId }, data: { createdAt } })
  const tenantDb = new Proxy(prisma, {
    get(client, property) {
      if (property === 'tenant') {
        return new Proxy(client.tenant, {
          get(delegate, method) {
            if (method === 'findMany') return (args = {}) => delegate.findMany({
              ...args,
              where: { AND: [args.where ?? {}, { id: scope.tenant.id }] },
            })
            const value = Reflect.get(delegate, method, delegate)
            return typeof value === 'function' ? value.bind(delegate) : value
          },
        })
      }
      const value = Reflect.get(client, property, client)
      return typeof value === 'function' ? value.bind(client) : value
    },
  })
  await runRetentionSweep({ db: tenantDb, now, env, baseDir })
  const archived = await prisma.message.findUnique({ where: { id: message.messageId }, select: { body: true } })
  expect(archived.body).toBe(RETENTION_SWEEP_TOMBSTONE)
  return message
}

async function seedDataset(label, { now, baseDir, env }) {
  const oldScope = await freshScope(`${label}-old`)
  const oldMessage = await archiveOneMessage({ scope: oldScope, label: `${label}-old`, ageYears: 11, now, baseDir, env })

  const youngScope = await freshScope(`${label}-young`)
  const youngMessage = await archiveOneMessage({ scope: youngScope, label: `${label}-young`, ageYears: 5, now, baseDir, env })

  const heldScope = await freshScope(`${label}-held`)
  const heldMessage = await archiveOneMessage({ scope: heldScope, label: `${label}-held`, ageYears: 11, now, baseDir, env })
  const heldPerson = await prisma.customer.findUnique({ where: { id: heldMessage.customerId }, select: { personId: true } })
  await prisma.customerLegalHold.create({ data: {
    tenantId: heldScope.tenant.id,
    customerId: heldMessage.customerId,
    reason: 'active expiry dry-run fixture',
    endDate: new Date(now.getTime() + 30 * DAY_MS),
    recordedByPersonId: heldPerson.personId,
  } })

  const retiredScope = await freshScope(`${label}-retired`)
  await archiveOneMessage({ scope: retiredScope, label: `${label}-retired-a`, ageYears: 11, now, baseDir, env })
  await archiveOneMessage({ scope: retiredScope, label: `${label}-retired-b`, ageYears: 11, now, baseDir, env })
  const retiredManifests = await prisma.archiveManifest.findMany({
    where: { tenantId: retiredScope.tenant.id, filePath: { endsWith: '.zca' } },
    orderBy: [{ createdAt: 'asc' }, { runId: 'asc' }],
  })
  const keepOnDisk = retiredManifests[0]
  const keptFileBytes = await fs.readFile(path.join(baseDir, keepOnDisk.filePath))
  await expireChatEvidenceArchive(prisma, { tenantId: retiredScope.tenant.id, now, baseDir, env })
  await fs.writeFile(path.join(baseDir, keepOnDisk.filePath), keptFileBytes)

  const brokenScope = await freshScope(`${label}-broken`)
  await archiveOneMessage({ scope: brokenScope, label: `${label}-broken`, ageYears: 11, now, baseDir, env })
  const brokenManifest = await prisma.archiveManifest.findFirst({ where: { tenantId: brokenScope.tenant.id } })
  await prisma.archiveManifest.update({ where: { id: brokenManifest.id }, data: { manifestHash: 'f'.repeat(64) } })

  const lapsedScope = await freshScope(`${label}-lapsed`)
  const lapsedMessage = await ingestLineMessage({
    tenantId: lapsedScope.tenant.id,
    businessId: lapsedScope.business.id,
    lineUserId: `U-AEDR-${label}-lapsed`,
    threadId: `TH-AEDR-${label}-lapsed`,
    text: 'lapsed hold fixture',
    externalMessageId: `MI-AEDR-${label}-lapsed`,
  })
  const hold = await prisma.customerLegalHold.create({ data: {
    tenantId: lapsedScope.tenant.id,
    customerId: lapsedMessage.customerId,
    reason: 'expired expiry dry-run fixture',
    endDate: new Date(now.getTime() - DAY_MS),
    recordedByPersonId: lapsedMessage.personId,
  } })
  await prisma.legalHoldArchiveKey.create({ data: {
    tenantId: lapsedScope.tenant.id,
    legalHoldId: hold.id,
    heldCustomerId: lapsedMessage.customerId,
    kekId: 'v0',
    wrappedDek: 'fixture-wrapped-key',
  } })

  const tenantIds = [oldScope, youngScope, heldScope, retiredScope, brokenScope, lapsedScope].map(({ tenant }) => tenant.id)
  const knownCustomerIds = [oldMessage, youngMessage, heldMessage, lapsedMessage].map((message) => message.customerId)
  const manifests = await prisma.archiveManifest.findMany({ where: { tenantId: { in: tenantIds } }, select: { id: true, filePath: true } })
  return {
    tenantIds,
    oldTenantId: oldScope.tenant.id,
    youngTenantId: youngScope.tenant.id,
    heldTenantId: heldScope.tenant.id,
    retiredTenantId: retiredScope.tenant.id,
    brokenTenantId: brokenScope.tenant.id,
    lapsedTenantId: lapsedScope.tenant.id,
    knownCustomerIds,
    knownManifestIds: manifests.map((manifest) => manifest.id),
    knownFilePaths: manifests.map((manifest) => manifest.filePath),
    retiredOnDiskPath: keepOnDisk.filePath,
  }
}

function scopedExpiryDb(tenantIds, { forbidWrites = false } = {}) {
  const readOrWriteGuard = forbidWrites ? new Proxy(prisma, {
    get(client, property) {
      if (['$transaction', '$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe', '$queryRawTyped'].includes(String(property))) {
        return () => { throw new Error(`DRY_RUN_WRITE_FORBIDDEN:${String(property)}`) }
      }
      const delegate = Reflect.get(client, property, client)
      if (!delegate || typeof delegate !== 'object') return typeof delegate === 'function' ? delegate.bind(client) : delegate
      const modelName = String(property)
      return new Proxy(delegate, {
        get(model, method) {
          if (WRITE_METHODS.has(String(method))) return () => { throw new Error(`DRY_RUN_WRITE_FORBIDDEN:${modelName}.${String(method)}`) }
          const value = Reflect.get(model, method, model)
          if (method === 'findMany' && TENANT_LIST_MODELS.has(modelName)) {
            return (args = {}) => {
              if (!args.where && args.select?.tenantId) {
                return value.call(model, { ...args, where: { tenantId: { in: tenantIds } } })
              }
              return value.call(model, args)
            }
          }
          return typeof value === 'function' ? value.bind(model) : value
        },
      })
    },
  }) : new Proxy(prisma, {
    get(client, property) {
      const delegate = Reflect.get(client, property, client)
      if (!delegate || typeof delegate !== 'object' || !TENANT_LIST_MODELS.has(String(property))) {
        return typeof delegate === 'function' ? delegate.bind(client) : delegate
      }
      return new Proxy(delegate, {
        get(model, method) {
          const value = Reflect.get(model, method, model)
          if (method === 'findMany') return (args = {}) => {
            if (!args.where && args.select?.tenantId) return value.call(model, { ...args, where: { tenantId: { in: tenantIds } } })
            return value.call(model, args)
          }
          return typeof value === 'function' ? value.bind(model) : value
        },
      })
    },
  })

  return readOrWriteGuard
}

function modelDelegateName(modelName) {
  return `${modelName[0].toLowerCase()}${modelName.slice(1)}`
}

function serializeRow(row) {
  return JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? value.toString() : value)
}

function tenantResultsByRole(tenants, seed) {
  const roles = {
    old: seed.oldTenantId,
    young: seed.youngTenantId,
    held: seed.heldTenantId,
    retired: seed.retiredTenantId,
    broken: seed.brokenTenantId,
    lapsed: seed.lapsedTenantId,
  }
  return Object.fromEntries(Object.entries(roles).map(([role, tenantId]) => {
    const row = tenants.find((tenant) => tenant.tenantId === tenantId)
    if (!row) throw new Error(`Missing ${role} expiry result`)
    const normalized = { ...row }
    delete normalized.tenantId
    return [role, normalized]
  }))
}

async function databaseSnapshot() {
  const snapshot = {}
  for (const model of Prisma.dmmf.datamodel.models) {
    const delegate = prisma[modelDelegateName(model.name)]
    if (!delegate || typeof delegate.findMany !== 'function') continue
    const primaryKey = model.primaryKey?.fields ?? model.fields.filter((field) => field.isId).map((field) => field.name)
    const orderBy = primaryKey.map((field) => ({ [field]: 'asc' }))
    const rows = await delegate.findMany(orderBy.length ? { orderBy } : {})
    snapshot[model.name] = rows.map(serializeRow).sort()
  }
  return snapshot
}

async function archiveSnapshot(directory) {
  let rootStat
  try {
    rootStat = await fs.lstat(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return [{ path: '.', type: 'missing' }]
    throw error
  }
  const files = [{ path: '.', type: rootStat.isDirectory() ? 'directory' : 'other' }]
  async function visit(current) {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        files.push({ path: path.relative(directory, absolute).split(path.sep).join('/'), type: 'directory' })
        await visit(absolute)
      } else if (entry.isFile()) {
        const bytes = await fs.readFile(absolute)
        files.push({
          path: path.relative(directory, absolute).split(path.sep).join('/'),
          type: 'file', sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      }
    }
  }
  if (rootStat.isDirectory()) await visit(directory)
  return files
}

async function stateSnapshot(directory) {
  return { database: await databaseSnapshot(), archiveFiles: await archiveSnapshot(directory) }
}

describe('CRM archive expiry count-only dry run', () => {
  it('rechecks a legal hold recorded after the initial expiry read before counting a key destruction', async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('hold-race', { now, baseDir, env })
    const message = await prisma.message.findFirst({
      where: { conversation: { tenantId: seed.oldTenantId } },
      orderBy: { createdAt: 'asc' },
      select: { conversation: { select: { customerId: true } } },
    })
    const customer = await prisma.customer.findUnique({
      where: { id: message.conversation.customerId }, select: { personId: true },
    })
    let holdInserted = false
    const db = new Proxy(prisma, {
      get(client, property) {
        const delegate = Reflect.get(client, property, client)
        if (property !== 'customerLegalHold' || !delegate) {
          return typeof delegate === 'function' ? delegate.bind(client) : delegate
        }
        return new Proxy(delegate, {
          get(model, method) {
            if (method === 'findFirst') return async (args) => {
              const result = await model.findFirst(args)
              if (!holdInserted) {
                holdInserted = true
                await prisma.customerLegalHold.create({ data: {
                  tenantId: seed.oldTenantId,
                  customerId: message.conversation.customerId,
                  reason: 'hold recorded during dry-run expiry preview',
                  endDate: new Date(now.getTime() + 30 * DAY_MS),
                  recordedByPersonId: customer.personId,
                } })
              }
              return result
            }
            const value = Reflect.get(model, method, model)
            return typeof value === 'function' ? value.bind(model) : value
          },
        })
      },
    })

    const result = await expireChatEvidenceArchive(db, {
      tenantId: seed.oldTenantId, now, baseDir, env, dryRun: true,
    })

    expect(holdInserted).toBe(true)
    expect(result.destroyedKeys).not.toContain(message.conversation.customerId)
    expect(result.retiredManifestIds).toEqual([])
    expect(result.deletedFiles).toEqual([])
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: message.conversation.customerId } })).toBeTruthy()
  })

  it('does not count a dry-run key destruction when its Customer key row disappeared during the preview', async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('key-race', { now, baseDir, env })
    const message = await prisma.message.findFirst({
      where: { conversation: { tenantId: seed.oldTenantId } },
      orderBy: { createdAt: 'asc' },
      select: { conversation: { select: { customerId: true } } },
    })
    let keyRemoved = false
    const db = new Proxy(prisma, {
      get(client, property) {
        const delegate = Reflect.get(client, property, client)
        if (property !== 'customerArchiveKey' || !delegate) {
          return typeof delegate === 'function' ? delegate.bind(client) : delegate
        }
        return new Proxy(delegate, {
          get(model, method) {
            if (method === 'findUnique') return async (args) => {
              if (!keyRemoved && args?.where?.customerId === message.conversation.customerId) {
                keyRemoved = true
                await prisma.customerArchiveKey.delete({ where: { customerId: message.conversation.customerId } })
                return null
              }
              const value = Reflect.get(model, method, model)
              return typeof value === 'function' ? value.call(model, args) : value
            }
            const value = Reflect.get(model, method, model)
            return typeof value === 'function' ? value.bind(model) : value
          },
        })
      },
    })

    const result = await expireChatEvidenceArchive(db, {
      tenantId: seed.oldTenantId, now, baseDir, env, dryRun: true,
    })

    expect(keyRemoved).toBe(true)
    expect(result.destroyedKeys).not.toContain(message.conversation.customerId)
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: message.conversation.customerId } })).toBeNull()
  })

  it('simulates key and retirement order without database or file writes and matches a fresh real run', async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('dry', { now, baseDir, env })
    const before = await stateSnapshot(baseDir)

    const preview = await runChatEvidenceArchiveExpiry(scopedExpiryDb(seed.tenantIds), { now, baseDir, env, dryRun: true })
    const brokenTenantPreview = await expireChatEvidenceArchive(prisma, {
      tenantId: seed.brokenTenantId, now, baseDir, env, dryRun: true,
    })

    expect(await stateSnapshot(baseDir)).toEqual(before)
    expect(brokenTenantPreview).toMatchObject({ skipped: true, dryRun: true, auditEventId: null })
    expect(preview).toMatchObject({ dryRun: true, counts: {
      tenantsVisited: 6,
      keysDestroyed: 1,
      holdKeysDestroyed: 1,
      manifestsRetired: 1,
      filesDeleted: 2,
      retiredFilesAlreadyAbsent: 1,
      retiredFilesStillPresent: 0,
      skipped: 1,
      failures: 0,
      tenantsDeferred: 0,
    } })
    expect(preview.tenants.find((tenant) => tenant.tenantId === seed.youngTenantId)).toMatchObject({
      keysDestroyed: 0, manifestsRetired: 0, filesDeleted: 0,
    })
    expect(preview.tenants.find((tenant) => tenant.tenantId === seed.heldTenantId)).toMatchObject({
      keysDestroyed: 0, manifestsRetired: 0, filesDeleted: 0,
    })
    expect(preview.tenants.find((tenant) => tenant.tenantId === seed.lapsedTenantId)).toMatchObject({
      holdKeysDestroyed: 1,
    })
    expect(preview.tenants.find((tenant) => tenant.tenantId === seed.brokenTenantId)).toMatchObject({
      skippedReason: expect.any(String),
    })
    expect(JSON.stringify(preview)).not.toContain(seed.retiredOnDiskPath)
    for (const identifier of [...seed.knownCustomerIds, ...seed.knownManifestIds]) {
      expect(JSON.stringify(preview)).not.toContain(identifier)
    }
    expect(await fs.stat(path.join(baseDir, seed.retiredOnDiskPath))).toBeTruthy()
    expect(await prisma.legalHoldArchiveKey.count({ where: { tenantId: seed.lapsedTenantId } })).toBe(1)

    const beforeForbidden = await stateSnapshot(baseDir)
    const forbidden = await runChatEvidenceArchiveExpiry(
      scopedExpiryDb(seed.tenantIds, { forbidWrites: true }), { now, baseDir, env, dryRun: true },
    )
    expect(forbidden).toEqual(preview)
    expect(await stateSnapshot(baseDir)).toEqual(beforeForbidden)

    const realBaseDir = await archiveDirectory()
    const realSeed = await seedDataset('parity', { now, baseDir: realBaseDir, env })
    const real = await runChatEvidenceArchiveExpiry(scopedExpiryDb(realSeed.tenantIds), { now, baseDir: realBaseDir, env })
    expect(real.counts).toEqual(preview.counts)
    const realAudit = await prisma.auditEvent.findUnique({
      where: { id: real.auditEventId },
      select: { payloadJson: true },
    })
    const realTenants = JSON.parse(realAudit.payloadJson).tenants
    expect(tenantResultsByRole(realTenants, realSeed)).toEqual(tenantResultsByRole(preview.tenants, seed))
  })

  it('reports an unwritable retired-file parent as a failure without counting deletions', async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('unwritable-retired-parent', { now, baseDir, env })
    const retiredFileParent = path.dirname(path.join(baseDir, seed.retiredOnDiskPath))
    const before = await stateSnapshot(baseDir)
    denyFsAccessAt(retiredFileParent)

    const preview = await runChatEvidenceArchiveExpiry(
      scopedExpiryDb([seed.retiredTenantId], { forbidWrites: true }), { now, baseDir, env, dryRun: true },
    )
    const tenant = preview.tenants.find((row) => row.tenantId === seed.retiredTenantId)

    expect(tenant).toMatchObject({ filesDeleted: 0, failureCode: 'ARCHIVE_STORAGE_NOT_WRITABLE' })
    expect(preview.counts).toMatchObject({ filesDeleted: 0, failures: 1 })
    expect(await stateSnapshot(baseDir)).toEqual(before)
  })

  it('reports a directory at an already-retired archive path as still present, never deleted', async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('directory', { now, baseDir, env })
    const retiredPath = path.join(baseDir, seed.retiredOnDiskPath)

    await fs.rm(retiredPath)
    await fs.mkdir(retiredPath)
    const before = await stateSnapshot(baseDir)

    const preview = await runChatEvidenceArchiveExpiry(
      scopedExpiryDb([seed.retiredTenantId]), { now, baseDir, env, dryRun: true },
    )
    const tenant = preview.tenants.find((row) => row.tenantId === seed.retiredTenantId)

    expect(tenant).toMatchObject({
      filesDeleted: 0,
      retiredFilesAlreadyAbsent: 1,
      retiredFilesStillPresent: 1,
    })
    expect(preview.counts).toMatchObject({
      filesDeleted: 0,
      retiredFilesAlreadyAbsent: 1,
      retiredFilesStillPresent: 1,
    })
    expect((await fs.lstat(retiredPath)).isDirectory()).toBe(true)
    expect(await stateSnapshot(baseDir)).toEqual(before)
  })

  it.skipIf(!symlinkSupported)(`counts a dangling archive symlink as deletable (${symlinkSupportLabel})`, async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('dangling-symlink', { now, baseDir, env })
    const linkPath = path.join(baseDir, seed.retiredOnDiskPath)
    await fs.rm(linkPath)
    await fs.symlink('missing-archive-target', linkPath, 'file')

    const preview = await runChatEvidenceArchiveExpiry(
      scopedExpiryDb([seed.retiredTenantId]), { now, baseDir, env, dryRun: true },
    )
    const tenant = preview.tenants.find((row) => row.tenantId === seed.retiredTenantId)

    expect(tenant).toMatchObject({ filesDeleted: 1, retiredFilesAlreadyAbsent: 1, retiredFilesStillPresent: 0 })
    expect((await fs.lstat(linkPath)).isSymbolicLink()).toBe(true)
  })

  it.skipIf(!symlinkSupported)(`counts a symlink to a directory as deletable (${symlinkSupportLabel})`, async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('directory-symlink', { now, baseDir, env })
    const linkPath = path.join(baseDir, seed.retiredOnDiskPath)
    const targetDirectory = path.join(baseDir, 'symlink-target-directory')
    await fs.mkdir(targetDirectory)
    await fs.rm(linkPath)
    await fs.symlink(targetDirectory, linkPath, 'dir')

    const preview = await runChatEvidenceArchiveExpiry(
      scopedExpiryDb([seed.retiredTenantId]), { now, baseDir, env, dryRun: true },
    )
    const tenant = preview.tenants.find((row) => row.tenantId === seed.retiredTenantId)

    expect(tenant).toMatchObject({ filesDeleted: 1, retiredFilesAlreadyAbsent: 1, retiredFilesStillPresent: 0 })
    expect((await fs.lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect((await fs.lstat(targetDirectory)).isDirectory()).toBe(true)
  })

  it('reports an unwritable archive destination as a retirement failure and preserves prior retired files', async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('read-only', { now, baseDir, env })
    const before = await stateSnapshot(baseDir)
    const priorManifest = await prisma.archiveManifest.findFirst({
      where: { tenantId: seed.retiredTenantId, filePath: { endsWith: '.zca' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    const readOnlyError = Object.assign(new Error('read-only filesystem'), { code: 'EROFS' })
    const access = vi.spyOn(fs, 'access').mockRejectedValue(readOnlyError)

    const newlyRetired = await expireChatEvidenceArchive(prisma, {
      tenantId: seed.oldTenantId, now, baseDir, env, dryRun: true,
    })
    const previouslyRetired = await expireChatEvidenceArchive(prisma, {
      tenantId: seed.retiredTenantId, now, baseDir, env, dryRun: true,
    })
    const run = await runChatEvidenceArchiveExpiry(scopedExpiryDb([seed.oldTenantId]), {
      now, baseDir, env, dryRun: true,
    })

    expect(access).toHaveBeenCalled()
    expect(newlyRetired).toMatchObject({
      retirementFailureReason: 'ARCHIVE_STORAGE_NOT_WRITABLE', retiredManifestIds: [], deletedFiles: [],
    })
    expect(previouslyRetired).toMatchObject({
      retirementFailureReason: 'ARCHIVE_STORAGE_NOT_WRITABLE', retiredManifestIds: [], deletedFiles: [],
    })
    expect(previouslyRetired.retiredFilesStillPresent).toContain(priorManifest.id)
    expect(run.counts.failures).toBeGreaterThan(0)
    expect(run.tenants.find((tenant) => tenant.tenantId === seed.oldTenantId)?.failureCode)
      .toBe('ARCHIVE_STORAGE_NOT_WRITABLE')
    expect(await stateSnapshot(baseDir)).toEqual(before)
  })
})

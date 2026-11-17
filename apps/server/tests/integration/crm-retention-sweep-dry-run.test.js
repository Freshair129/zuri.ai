import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { CUSTOMER_ERASURE_TOMBSTONE } from '@/modules/crm/conversation-redaction-service'
import { runRetentionSweep, RETENTION_SWEEP_TOMBSTONE } from '@/modules/crm/retention-sweep-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'
import {
  createIntegrationConnection,
  LINE_OA_PROVIDER_CODE,
  registerIntegrationProvider,
} from '@/platform/integrations/core/integration-registry'

// @req FR-230, FR-245, SEC-034 — CRM retention dry runs count the real eligibility decisions without writes.
// @spec ADR-091 D2; ADR-093 D2, D6; SEC-031
// @tested tests/integration/crm-retention-sweep-dry-run.test.js

const DAY_MS = 24 * 60 * 60 * 1000
const FIXED_NOW = new Date('2036-05-04T12:30:00.000Z')
const CLASS = 'MESSAGE_BODY_AND_ATTACHMENTS'
const WRITE_METHODS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'])
const archiveDirectories = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of archiveDirectories.splice(0)) {
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
})

async function archiveDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-crm-retention-dry-'))
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
  const portfolio = await createPortfolio({ name: `Retention dry run ${label} ${suffix}`, code: `PF-RDR-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Retention dry run ${label}`, code: `TNT-RDR-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `Retention dry run ${label}`, code: `BUS-RDR-${suffix}` })
  return { tenant, business }
}

async function oldLine({ tenant, business, now, threadId, lineUserId, suffix, attachment = false }) {
  const result = await ingestLineMessage({
    tenantId: tenant.id,
    businessId: business.id,
    lineUserId,
    threadId,
    text: `retention evidence ${suffix}`,
    externalMessageId: `MI-RDR-${suffix}`,
    ...(attachment ? { contentKind: 'MEDIA_REF', attachment: { kind: 'IMAGE', providerContentId: `line-rdr-${suffix}` } } : {}),
  })
  await prisma.message.update({
    where: { id: result.messageId },
    data: { createdAt: new Date(now.getTime() - (RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 30) * DAY_MS) },
  })
  return result
}

async function seedAttributionMembershipDataset(label, now) {
  const scope = await freshScope(label)
  const threadId = `TH-RDR-MEMBERSHIP-${label}`
  const ownerLine = await oldLine({
    ...scope, now, threadId, lineUserId: `U-RDR-OWNER-${label}`, suffix: `${label}-owner`,
  })
  const memberLine = await oldLine({
    ...scope, now, threadId, lineUserId: `U-RDR-MEMBER-${label}`, suffix: `${label}-member`,
  })
  const oldInboundAt = new Date(now.getTime()
    - (RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 30) * DAY_MS)
  await prisma.message.update({ where: { id: ownerLine.messageId }, data: {
    body: CUSTOMER_ERASURE_TOMBSTONE,
    createdAt: new Date(oldInboundAt.getTime() - 20_000),
  } })
  await prisma.message.update({ where: { id: memberLine.messageId }, data: {
    authorChannelIdentityId: null,
    createdAt: oldInboundAt,
  } })
  await prisma.customerRetentionConsent.create({ data: {
    tenantId: scope.tenant.id,
    customerId: memberLine.customerId,
    businessId: scope.business.id,
    recordedByPersonId: memberLine.personId,
    recordedAt: now,
  } })
  const staffReply = await prisma.message.create({ data: {
    conversationId: ownerLine.conversationId,
    direction: 'OUTBOUND',
    body: `staff reply ${label}`,
    createdAt: new Date(oldInboundAt.getTime() + 20_000),
  } })
  await prisma.customer.update({ where: { id: ownerLine.customerId }, data: { deletedAt: now } })
  return {
    tenantId: scope.tenant.id,
    memberMessageId: memberLine.messageId,
    staffReplyId: staffReply.id,
  }
}

async function createLineAccount({ tenant, business }) {
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })
  const suffix = randomUUID().slice(0, 8)
  const connection = await createIntegrationConnection({
    tenantId: tenant.id,
    businessId: business.id,
    providerId: provider.id,
    name: `Retention dry-run connection ${suffix}`,
    externalAccountId: `retention-rdr-${suffix}`,
    status: 'ACTIVE',
  })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id,
    businessId: business.id,
    integrationConnectionId: connection.id,
    code: `rdr-account-${suffix}`,
    displayName: `Retention dry-run ${suffix}`,
    bindingCode: `rdr-binding-${suffix}`,
    transportMode: 'CLOUD',
    serverEnabled: true,
    status: 'CONNECTED',
    executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED',
  } })
}

async function seedDataset(label, now) {
  const primary = await freshScope(`${label}-primary`)
  const secondary = await freshScope(`${label}-secondary`)
  const keyed = await oldLine({
    ...primary, now, threadId: `TH-RDR-KEYED-${label}`, lineUserId: `U-RDR-KEYED-${label}`,
    suffix: `${label}-keyed`, attachment: true,
  })
  const unattributed = await oldLine({
    ...primary, now, threadId: `TH-RDR-KEYED-${label}`, lineUserId: `U-RDR-UNATTRIBUTED-${label}`,
    suffix: `${label}-unattributed`, attachment: true,
  })
  await prisma.message.update({ where: { id: unattributed.messageId }, data: { authorChannelIdentityId: null } })

  const pinned = await oldLine({
    ...primary, now, threadId: `TH-RDR-PINNED-${label}`, lineUserId: `U-RDR-PINNED-${label}`,
    suffix: `${label}-pinned`,
  })
  const account = await createLineAccount(primary)
  await prisma.lineConversationJob.create({ data: {
    accountId: account.id,
    inboundMessageId: pinned.messageId,
    eventId: `rdr-event-${label}`,
    tenantId: primary.tenant.id,
    businessId: primary.business.id,
    channelAccountId: 'LEGACY:LINE',
    transportEpoch: 1,
    executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED',
    recipientId: 'rdr-recipient',
    sourceUserId: 'rdr-source',
    status: 'QUEUED',
    expiresAt: new Date(now.getTime() + DAY_MS),
    correlationId: `rdr-correlation-${label}`,
  } })

  const erasedOwner = await ingestLineMessage({
    tenantId: primary.tenant.id,
    businessId: primary.business.id,
    lineUserId: `U-RDR-ERASED-${label}`,
    threadId: `TH-RDR-ORPHAN-${label}`,
    text: `erased owner ${label}`,
    externalMessageId: `MI-RDR-ERASED-${label}`,
  })
  const orphanBase = now.getTime() - (RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 100) * DAY_MS
  await prisma.message.update({ where: { id: erasedOwner.messageId }, data: {
    body: CUSTOMER_ERASURE_TOMBSTONE, createdAt: new Date(orphanBase - 20_000),
  } })
  const staffBeforeMembership = await prisma.message.create({ data: {
    conversationId: erasedOwner.conversationId,
    direction: 'OUTBOUND',
    body: `staff before membership ${label}`,
    createdAt: new Date(orphanBase - 10_000),
  } })
  const consentingMember = await ingestLineMessage({
    tenantId: primary.tenant.id,
    businessId: primary.business.id,
    lineUserId: `U-RDR-CONSENTING-${label}`,
    threadId: `TH-RDR-ORPHAN-${label}`,
    text: `consenting member ${label}`,
    externalMessageId: `MI-RDR-CONSENTING-${label}`,
  })
  await prisma.message.update({ where: { id: consentingMember.messageId }, data: { createdAt: new Date(orphanBase) } })
  await prisma.customerRetentionConsent.create({ data: {
    tenantId: primary.tenant.id,
    customerId: consentingMember.customerId,
    businessId: primary.business.id,
    recordedByPersonId: consentingMember.personId,
    recordedAt: now,
  } })
  const staffAfterMembership = await prisma.message.create({ data: {
    conversationId: erasedOwner.conversationId,
    direction: 'OUTBOUND',
    body: `staff after membership ${label}`,
    createdAt: new Date(orphanBase + 10_000),
  } })
  await prisma.customer.update({ where: { id: erasedOwner.customerId }, data: { deletedAt: now } })

  await prisma.tenantRetentionOverride.create({ data: {
    tenantId: primary.tenant.id,
    dataClass: CLASS,
    windowDays: 0,
  } })
  const secondaryLine = await oldLine({
    ...secondary, now, threadId: `TH-RDR-SECONDARY-${label}`, lineUserId: `U-RDR-SECONDARY-${label}`,
    suffix: `${label}-secondary`, attachment: true,
  })

  return {
    tenantIds: [primary.tenant.id, secondary.tenant.id],
    primaryTenantId: primary.tenant.id,
    secondaryTenantId: secondary.tenant.id,
    primaryKeyedIds: [keyed.messageId, unattributed.messageId, consentingMember.messageId],
    primaryAttachmentMessageIds: [keyed.messageId, unattributed.messageId],
    secondaryKeyedIds: [secondaryLine.messageId],
    secondaryAttachmentMessageIds: [secondaryLine.messageId],
    pinnedMessageId: pinned.messageId,
    unattributedMessageId: unattributed.messageId,
    staffBeforeMembershipId: staffBeforeMembership.id,
    staffAfterMembershipId: staffAfterMembership.id,
  }
}

function scopedDb(tenantIds, { forbidWrites = false, messageSelects } = {}) {
  const modelDb = forbidWrites ? new Proxy(prisma, {
    get(client, property) {
      if (['$transaction', '$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe', '$queryRawTyped'].includes(String(property))) {
        return () => { throw new Error(`DRY_RUN_WRITE_FORBIDDEN:${String(property)}`) }
      }
      const delegate = Reflect.get(client, property, client)
      if (!delegate || typeof delegate !== 'object') return typeof delegate === 'function' ? delegate.bind(client) : delegate
      return new Proxy(delegate, {
        get(model, method) {
          if (WRITE_METHODS.has(String(method))) return () => { throw new Error(`DRY_RUN_WRITE_FORBIDDEN:${String(property)}.${String(method)}`) }
          const value = Reflect.get(model, method, model)
          return typeof value === 'function' ? value.bind(model) : value
        },
      })
    },
  }) : prisma

  return new Proxy(modelDb, {
    get(client, property) {
      if (property === 'message' && messageSelects) {
        const delegate = Reflect.get(client, property, client)
        return new Proxy(delegate, {
          get(model, method) {
            if (method === 'findMany') return (args = {}) => {
              messageSelects.push(args.select)
              return model.findMany(args)
            }
            const value = Reflect.get(model, method, model)
            return typeof value === 'function' ? value.bind(model) : value
          },
        })
      }
      if (property === 'tenant') {
        const delegate = Reflect.get(client, property, client)
        return new Proxy(delegate, {
          get(model, method) {
            if (method === 'findMany') return (args = {}) => model.findMany({
              ...args,
              where: { AND: [args.where ?? {}, { id: { in: tenantIds } }] },
            })
            const value = Reflect.get(model, method, model)
            return typeof value === 'function' ? value.bind(model) : value
          },
        })
      }
      const value = Reflect.get(client, property, client)
      return typeof value === 'function' ? value.bind(client) : value
    },
  })
}

function modelDelegateName(modelName) {
  return `${modelName[0].toLowerCase()}${modelName.slice(1)}`
}

function serializeRow(row) {
  return JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? value.toString() : value)
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

async function observedCounts(seed, tenantId) {
  const isPrimary = tenantId === seed.primaryTenantId
  const messageIds = isPrimary ? seed.primaryKeyedIds : seed.secondaryKeyedIds
  const attachmentMessageIds = isPrimary ? seed.primaryAttachmentMessageIds : seed.secondaryAttachmentMessageIds
  const [messages, pinned, before, after, attachments] = await Promise.all([
    prisma.message.findMany({ where: { id: { in: messageIds } }, select: { id: true, body: true } }),
    isPrimary ? prisma.message.findUnique({ where: { id: seed.pinnedMessageId }, select: { body: true } }) : null,
    isPrimary ? prisma.message.findUnique({ where: { id: seed.staffBeforeMembershipId }, select: { body: true } }) : null,
    isPrimary ? prisma.message.findUnique({ where: { id: seed.staffAfterMembershipId }, select: { body: true } }) : null,
    prisma.messageAttachment.findMany({ where: { messageId: { in: attachmentMessageIds } }, select: { messageId: true, fetchState: true } }),
  ])
  return {
    redactedMessages: messages.filter((row) => row.body === RETENTION_SWEEP_TOMBSTONE).length,
    redactedAttachments: attachments.filter((row) => row.fetchState === 'ERASED').length,
    skippedNonTerminalJob: isPrimary && pinned.body !== RETENTION_SWEEP_TOMBSTONE ? 1 : 0,
    deferredErasedKey: isPrimary && after.body !== RETENTION_SWEEP_TOMBSTONE ? 1 : 0,
    blankedWithoutArchive: isPrimary && before.body === RETENTION_SWEEP_TOMBSTONE ? 1 : 0,
  }
}

describe('CRM retention sweep count-only dry run', () => {
  it('reports an unwritable Tenant/year archive directory without counting redactions', async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('unwritable-storage', now)
    const targetDirectory = path.join(baseDir, seed.primaryTenantId, String(now.getUTCFullYear()))
    await fs.mkdir(targetDirectory, { recursive: true })
    const before = await stateSnapshot(baseDir)
    denyFsAccessAt(targetDirectory)

    const preview = await runRetentionSweep({
      db: scopedDb([seed.primaryTenantId], { forbidWrites: true }),
      now, env, baseDir, dryRun: true,
    })
    const tenant = preview.tenants.find((row) => row.tenantId === seed.primaryTenantId)

    expect(tenant).toMatchObject({
      redactedMessages: 0,
      redactedAttachments: 0,
      archiveFailed: true,
      archiveFailureReason: 'ARCHIVE_STORAGE_NOT_WRITABLE',
    })
    expect(preview.countsByClass[CLASS]).toMatchObject({ redactedMessages: 0, redactedAttachments: 0 })
    expect(await stateSnapshot(baseDir)).toEqual(before)
  })

  it('uses would-write author attribution when previewing orphaned-line membership', async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const dryBaseDir = await archiveDirectory()
    const drySeed = await seedAttributionMembershipDataset('membership-dry', now)

    const preview = await runRetentionSweep({
      db: scopedDb([drySeed.tenantId], { forbidWrites: true }),
      now, env, baseDir: dryBaseDir, dryRun: true,
    })
    const dryTenant = preview.tenants.find((tenant) => tenant.tenantId === drySeed.tenantId)
    expect(dryTenant).toMatchObject({ deferredErasedKey: 1, blankedWithoutArchive: 0 })
    expect((await prisma.message.findUnique({ where: { id: drySeed.memberMessageId } })).authorChannelIdentityId).toBeNull()

    const realBaseDir = await archiveDirectory()
    const realSeed = await seedAttributionMembershipDataset('membership-real', now)
    const real = await runRetentionSweep({
      db: scopedDb([realSeed.tenantId]), now, env, baseDir: realBaseDir,
    })
    const realCounts = real.countsByClass[CLASS]
    expect(dryTenant.deferredErasedKey).toBe(realCounts.deferredErasedKey)
    expect(dryTenant.blankedWithoutArchive).toBe(realCounts.blankedWithoutArchive ?? 0)
    expect((await prisma.message.findUnique({ where: { id: realSeed.memberMessageId } })).authorChannelIdentityId).not.toBeNull()
    expect((await prisma.message.findUnique({ where: { id: realSeed.staffReplyId } })).body).not.toBe(RETENTION_SWEEP_TOMBSTONE)
  })

  it('preserves the complete database and archive state, blocks every write, and matches a fresh real run', async () => {
    const now = new Date(FIXED_NOW)
    const baseDir = await archiveDirectory()
    const seed = await seedDataset('dry', now)
    const env = { NODE_ENV: 'test' }
    const messageSelects = []

    const before = await stateSnapshot(baseDir)
    const preview = await runRetentionSweep({
      db: scopedDb(seed.tenantIds, { messageSelects }), now, env, baseDir, dryRun: true,
    })
    const afterPreview = await stateSnapshot(baseDir)

    expect(afterPreview).toEqual(before)
    expect(messageSelects.length).toBeGreaterThan(0)
    expect(messageSelects.every((select) => !Object.hasOwn(select ?? {}, 'body'))).toBe(true)
    expect(preview).toMatchObject({ dryRun: true })
    expect(preview.countsByClass[CLASS]).not.toHaveProperty('manifests')
    expect(preview.tenants.map((tenant) => tenant.tenantId)).toEqual([...seed.tenantIds].sort())
    const primaryCounts = preview.tenants.find((tenant) => tenant.tenantId === seed.primaryTenantId)
    const secondaryCounts = preview.tenants.find((tenant) => tenant.tenantId === seed.secondaryTenantId)
    expect(primaryCounts).toMatchObject({
      redactedMessages: 3, redactedAttachments: 2, skippedNonTerminalJob: 1,
      deferredErasedKey: 1, blankedWithoutArchive: 1, invalidOverrideIgnored: true,
    })
    expect(secondaryCounts).toMatchObject({ redactedMessages: 1, redactedAttachments: 1, skippedNonTerminalJob: 0 })
    expect(await prisma.archiveManifest.findMany({ where: { tenantId: { in: seed.tenantIds } } })).toEqual([])
    expect(await prisma.customerArchiveKey.findMany({ where: { tenantId: { in: seed.tenantIds } } })).toEqual([])
    expect((await prisma.message.findUnique({ where: { id: seed.unattributedMessageId } })).authorChannelIdentityId).toBeNull()
    expect((await prisma.message.findUnique({ where: { id: seed.pinnedMessageId } })).body).not.toBe(RETENTION_SWEEP_TOMBSTONE)
    expect(await archiveSnapshot(baseDir)).toEqual([{ path: '.', type: 'directory' }])

    const invalidKekBefore = await stateSnapshot(baseDir)
    const invalidKek = await runRetentionSweep({
      db: scopedDb(seed.tenantIds), now, env: { ...env, ZURI_ARCHIVE_KEK: 'invalid' }, baseDir, dryRun: true,
    })
    expect(invalidKek.countsByClass[CLASS].archiveFailures).toHaveLength(2)
    expect(invalidKek.tenants.find((tenant) => tenant.tenantId === seed.primaryTenantId)).toMatchObject({
      archiveFailed: true, archiveFailureReason: 'ARCHIVE_KEK_UNAVAILABLE',
    })
    expect(await stateSnapshot(baseDir)).toEqual(invalidKekBefore)

    const forbiddenBefore = await stateSnapshot(baseDir)
    const forbiddenResult = await runRetentionSweep({
      db: scopedDb(seed.tenantIds, { forbidWrites: true }), now, env, baseDir, dryRun: true,
    })
    expect(forbiddenResult).toEqual(preview)
    expect(await stateSnapshot(baseDir)).toEqual(forbiddenBefore)

    const realBaseDir = await archiveDirectory()
    const realSeed = await seedDataset('parity', now)
    const real = await runRetentionSweep({ db: scopedDb(realSeed.tenantIds), now, env, baseDir: realBaseDir })
    const realAudit = await prisma.auditEvent.findUnique({
      where: { id: real.auditEventId },
      select: { payloadJson: true },
    })
    expect(JSON.parse(realAudit.payloadJson).invalidOverrides).toContainEqual({ tenantId: realSeed.primaryTenantId })
    for (const dryTenant of preview.tenants) {
      const realTenantId = dryTenant.tenantId === seed.primaryTenantId ? realSeed.primaryTenantId : realSeed.secondaryTenantId
      expect(await observedCounts(realSeed, realTenantId)).toMatchObject({
        redactedMessages: dryTenant.redactedMessages,
        redactedAttachments: dryTenant.redactedAttachments,
        skippedNonTerminalJob: dryTenant.skippedNonTerminalJob,
        deferredErasedKey: dryTenant.deferredErasedKey,
        blankedWithoutArchive: dryTenant.blankedWithoutArchive,
      })
    }
    expect(real.countsByClass[CLASS].redactedMessages).toBe(preview.countsByClass[CLASS].redactedMessages)
    expect(real.countsByClass[CLASS].redactedAttachments).toBe(preview.countsByClass[CLASS].redactedAttachments)

    const afterDryReal = await runRetentionSweep({ db: scopedDb(seed.tenantIds), now, env, baseDir })
    const afterDrySecondReal = await runRetentionSweep({ db: scopedDb(seed.tenantIds), now, env, baseDir })
    expect(afterDryReal.countsByClass[CLASS].redactedMessages).toBe(preview.countsByClass[CLASS].redactedMessages)
    expect(afterDrySecondReal.countsByClass[CLASS].redactedMessages).toBe(0)
    expect(afterDrySecondReal.countsByClass[CLASS].redactedAttachments).toBe(0)
  })

  it('reports an unwritable archive destination as a dry-run archive failure without changing the Tenant', async () => {
    const now = new Date(FIXED_NOW)
    const env = { NODE_ENV: 'test' }
    const archiveRoot = await archiveDirectory()
    const baseDir = path.join(archiveRoot, 'not-created', 'archive')
    const seed = await seedDataset('read-only', now)
    const before = await stateSnapshot(baseDir)
    const readOnlyError = Object.assign(new Error('read-only filesystem'), { code: 'EROFS' })
    const access = vi.spyOn(fs, 'access').mockRejectedValue(readOnlyError)

    const preview = await runRetentionSweep({
      db: scopedDb(seed.tenantIds, { forbidWrites: true }), now, env, baseDir, dryRun: true,
    })

    expect(access.mock.calls.some(([checkedPath]) => checkedPath === archiveRoot)).toBe(true)
    expect(preview.countsByClass[CLASS].archiveFailures).toHaveLength(2)
    expect(preview.tenants.filter((tenant) => tenant.archiveFailed)).toHaveLength(2)
    expect(preview.tenants.filter((tenant) => tenant.archiveFailed)
      .every((tenant) => tenant.archiveFailureReason === 'ARCHIVE_STORAGE_NOT_WRITABLE')).toBe(true)
    expect(await stateSnapshot(baseDir)).toEqual(before)
  })
})

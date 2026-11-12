// @req SEC-034 — archive key destruction and the legal hold (ADR-093 D5, D6;
//   TASK-ZAI-113): recording a hold, a PDPA erasure that destroys the archive
//   key unless a hold is active, and 10-year expiry that destroys keys and
//   deletes fully-expired files.
// @spec ADR-093 D5, D6; SEC-034; BR-001
// @tested tests/integration/crm-archive-legal-hold.test.js
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { runRetentionSweep } from '@/modules/crm/retention-sweep-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'
import { recordCustomerLegalHold } from '@/modules/crm/chat-evidence-legal-hold-service'
import { recordCustomerRetentionConsent } from '@/modules/crm/customer-retention-consent-service'
import { computeManifestHash, hashMessageIdList, verifyManifestChain, withLockedCustomer } from '@/modules/crm/chat-evidence-archive-service'
import { erasePrincipal } from '@/modules/identity/erase-principal'
import { expireChatEvidenceArchive } from '@/modules/crm/chat-evidence-archive-expiry-service'
import { runChatEvidenceArchiveExpiry } from '@/modules/crm/chat-evidence-archive-expiry-run-service'

const DAY_MS = 24 * 60 * 60 * 1000
const PAST = RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1
let baseDir

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-cea-legalhold-'))
})
afterEach(async () => {
  if (baseDir && path.resolve(baseDir).startsWith(path.resolve(os.tmpdir()))) {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

// Each fresh archive directory belongs to this fixture Tenant. A suite-wide
// sweep would archive earlier files' Tenants into it and break rollback proofs.
async function sweepFixtureTenant(tenantId, options) {
  const tenant = new Proxy(prisma.tenant, { get(delegate, key) {
    if (key === 'findMany') return args => delegate.findMany({...args,where:{AND:[args?.where || {},{id:tenantId}]}})
    const value=delegate[key];return typeof value==='function'?value.bind(delegate):value
  } })
  const db=new Proxy(prisma,{get(client,key){
    if(key==='tenant') return tenant
    const value=client[key];return typeof value==='function'?value.bind(client):value
  }})
  return runRetentionSweep({...options,db})
}

function expiryFixtureDb(tenantId) {
  const scopedModels = new Set(['archiveManifest', 'customerArchiveKey', 'legalHoldArchiveKey'])
  return new Proxy(prisma, { get(client, key) {
    const delegate = client[key]
    if (!scopedModels.has(key)) return typeof delegate === 'function' ? delegate.bind(client) : delegate
    return new Proxy(delegate, { get(model, method) {
      if (method === 'findMany') return args => {
        if (!args?.where && args?.select?.tenantId) return Promise.resolve([{ tenantId }])
        return model.findMany(args)
      }
      const value = model[method]
      return typeof value === 'function' ? value.bind(model) : value
    } })
  } })
}

async function freshScope(label) {
  const suffix = randomUUID().slice(0, 8)
  const pf = await createPortfolio({ name: `CEA-hold ${label} ${suffix}`, code: `PF-CEAH-${suffix}` })
  const tenant = await createTenant({ portfolioId: pf.id, name: `CEA-hold ${label} Tenant`, code: `TNT-CEAH-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'ร้านหลักฐาน', code: `BUS-CEAH-${suffix}` })
  return { tenant, business }
}

async function ownerOf(business) {
  const person = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Hold owner' } })
  return { person, viewer: makeViewer({ principal: { id: person.id, code: person.code, displayName: person.displayName }, ownedBusinessIds: [business.id], visibleBusinessIds: [business.id], visibleDomains: [...VIEWER_DOMAINS] }) }
}

async function backdatedMessage({ tenant, business, ageDays, threadId, text }) {
  const id = randomUUID().slice(0, 8)
  const result = await ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, lineUserId: `U-ceah-${id}`,
    threadId: threadId ?? `TH-CEAH-${id}`, text: text ?? `evidence ${id}`, externalMessageId: `MI-CEAH-${id}`,
  })
  await prisma.message.update({ where: { id: result.messageId }, data: { createdAt: new Date(Date.now() - ageDays * DAY_MS) } })
  return result
}

async function archiveFileSnapshot(directory) {
  const files = {}
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) files[path.relative(directory, absolute).split(path.sep).join('/')] = await fs.readFile(absolute)
    }
  }
  await visit(directory)
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)))
}

async function groupMessage({ tenant, business, threadId, speaker, text, createdAt }) {
  const result = await ingestLineMessage({
    tenantId: tenant.id,
    businessId: business.id,
    channelAccountId: 'ceah-reseal-fault',
    lineUserId: speaker,
    threadId,
    text,
    externalMessageId: `MI-CEAH-${randomUUID().slice(0, 8)}`,
  })
  await prisma.message.update({ where: { id: result.messageId }, data: { createdAt } })
  return result
}

function futureDateOnly(daysFromNow) {
  return new Date(Date.now() + daysFromNow * DAY_MS).toISOString().slice(0, 10)
}

describe('SEC-034 recordCustomerLegalHold (TASK-ZAI-113 P0)', () => {
  it('refuses a Business the viewer does not own (404-shaped)', async () => {
    const { business } = await freshScope('notowner')
    const { person } = await ownerOf(business)
    const strangerViewer = makeViewer({ principal: { id: person.id, code: person.code, displayName: person.displayName }, ownedBusinessIds: [], visibleBusinessIds: [business.id], visibleDomains: [...VIEWER_DOMAINS] })
    const fresh = await ingestLineMessage({ tenantId: business.tenantId, businessId: business.id, lineUserId: 'U-ceah-notowner', threadId: 'TH-CEAH-NOTOWNER', text: 'hi', externalMessageId: 'MI-CEAH-NOTOWNER' })
    await expect(recordCustomerLegalHold(fresh.customerId, { businessId: business.id, reason: 'ข้อพิพาท', endDate: futureDateOnly(30) }, { viewer: strangerViewer }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('rejects an empty reason and a past/today end date before any lookup', async () => {
    const { business } = await freshScope('validate')
    const { viewer } = await ownerOf(business)
    await expect(recordCustomerLegalHold('does-not-matter', { businessId: business.id, reason: '', endDate: futureDateOnly(30) }, { viewer }))
      .rejects.toThrow()
    await expect(recordCustomerLegalHold('does-not-matter', { businessId: business.id, reason: 'ข้อพิพาท', endDate: futureDateOnly(-1) }, { viewer }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('records a hold and audits it', async () => {
    const { tenant, business } = await freshScope('record')
    const { person, viewer } = await ownerOf(business)
    const fresh = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'U-ceah-record', threadId: 'TH-CEAH-RECORD', text: 'hi', externalMessageId: 'MI-CEAH-RECORD' })

    const result = await recordCustomerLegalHold(fresh.customerId, { businessId: business.id, reason: 'ข้อพิพาทเรื่องส่วนลด', endDate: futureDateOnly(365) }, { viewer })
    expect(result.customerId).toBe(fresh.customerId)
    expect(result.reason).toBe('ข้อพิพาทเรื่องส่วนลด')

    const row = await prisma.customerLegalHold.findUnique({ where: { id: result.legalHoldId } })
    expect(row.customerId).toBe(fresh.customerId)
    expect(row.recordedByPersonId).toBe(person.id)

    const audit = await prisma.auditEvent.findFirst({ where: { entityId: fresh.customerId, action: 'LEGAL_HOLD_RECORDED' } })
    expect(audit).toBeTruthy()
    expect(audit.reason).toBe('ข้อพิพาทเรื่องส่วนลด')
  })

  it('rolls back the hold when its audit append fails', async () => {
    const { tenant, business } = await freshScope('audit-rollback')
    const { viewer } = await ownerOf(business)
    const fresh = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'U-ceah-audit-rollback', threadId: 'TH-CEAH-AUDIT-ROLLBACK', text: 'hi', externalMessageId: 'MI-CEAH-AUDIT-ROLLBACK' })
    const failingDb = prisma.$extends({
      query: {
        auditEvent: {
          async create() {
            throw new Error('AUDIT_INJECTED_FAILURE')
          },
        },
      },
    })

    await expect(recordCustomerLegalHold(
      fresh.customerId,
      { businessId: business.id, reason: 'audit rollback', endDate: futureDateOnly(365) },
      { viewer, db: failingDb, dialect: 'sqlite' },
    )).rejects.toThrow('AUDIT_INJECTED_FAILURE')

    expect(await prisma.customerLegalHold.count({ where: { customerId: fresh.customerId } })).toBe(0)
    expect(await prisma.auditEvent.count({ where: { entityId: fresh.customerId, action: 'LEGAL_HOLD_RECORDED' } })).toBe(0)
  })

  it('refuses an unknown provider before opening a transaction or writing', async () => {
    const calls = []
    const db = {
      provider: 'mysql',
      $transaction: vi.fn(async () => calls.push('transaction')),
    }

    await expect(withLockedCustomer(
      db,
      { tenantId: 'tenant-unknown-provider', customerId: 'customer-unknown-provider' },
      async () => calls.push('callback'),
    )).rejects.toMatchObject({ code: 'ARCHIVE_CUSTOMER_PROVIDER_UNAVAILABLE', status: 503 })
    expect(calls).toEqual([])
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('binds the PostgreSQL lock to both Customer and Tenant before the callback', async () => {
    const customerId = 'customer-postgres-lock'
    const tenantId = 'tenant-postgres-lock'
    const queryRaw = vi.fn(async () => [{ id: customerId }])
    const tx = { _activeProvider: 'postgres', $queryRawUnsafe: queryRaw }

    await expect(withLockedCustomer(
      tx,
      { tenantId, customerId },
      async (lockedTx, { customer }) => ({ lockedTx, customer }),
      { transactionClient: true },
    )).resolves.toMatchObject({ customer: { id: customerId, tenantId } })
    expect(queryRaw).toHaveBeenCalledWith(
      'SELECT "id" FROM "Customer" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
      customerId,
      tenantId,
    )
    expect(queryRaw).toHaveBeenNthCalledWith(
      2,
      'UPDATE "Customer" SET "id" = "id" WHERE "id" = $1 AND "tenantId" = $2 RETURNING "id"',
      customerId,
      tenantId,
    )
    expect(queryRaw).toHaveBeenCalledTimes(2)
  })

  it('does not enter a hold or key effect when PostgreSQL rejects a stale transaction', async () => {
    const conflict = Object.assign(new Error('could not serialize access due to concurrent update'), { code: 'P2010', meta: { code: '40001' } })
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ id: 'stale-customer' }])
      .mockRejectedValueOnce(conflict)
    const effect = vi.fn()
    await expect(withLockedCustomer(
      { _activeProvider: 'postgres', $queryRawUnsafe: queryRaw },
      { tenantId: 'stale-tenant', customerId: 'stale-customer' },
      effect,
      { transactionClient: true },
    )).rejects.toMatchObject({ code: 'ARCHIVE_CUSTOMER_LOCK_UNAVAILABLE', status: 503, retryable: true, cause: conflict })
    expect(effect).not.toHaveBeenCalled()
  })

  it.each([
    { code: 'P2034' },
    { code: 'P2010', meta: { code: '40P01' } },
    { code: 'SQLITE_BUSY' },
    { code: 'SQLITE_LOCKED' },
  ])('maps a confirmed transaction conflict to a bounded retryable refusal: %j', async (details) => {
    const conflict = Object.assign(new Error('injected transaction conflict'), details)
    const effect = vi.fn()
    const db = { _activeProvider: 'sqlite', $transaction: vi.fn().mockRejectedValue(conflict) }
    await expect(withLockedCustomer(
      db,
      { tenantId: 'conflict-tenant', customerId: 'conflict-customer' },
      effect,
    )).rejects.toMatchObject({ code: 'ARCHIVE_CUSTOMER_LOCK_UNAVAILABLE', status: 503, retryable: true, cause: conflict })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(effect).not.toHaveBeenCalled()
  })

  it('refuses a Customer from another Tenant before creating a hold', async () => {
    const first = await freshScope('scope-source')
    const second = await freshScope('scope-target')
    const { viewer } = await ownerOf(second.business)
    const source = await ingestLineMessage({ tenantId: first.tenant.id, businessId: first.business.id, lineUserId: 'U-ceah-cross-tenant', threadId: 'TH-CEAH-CROSS-TENANT', text: 'hi', externalMessageId: 'MI-CEAH-CROSS-TENANT' })

    await expect(recordCustomerLegalHold(
      source.customerId,
      { businessId: second.business.id, reason: 'cross tenant', endDate: futureDateOnly(365) },
      { viewer },
    )).rejects.toMatchObject({ status: 404 })
    expect(await prisma.customerLegalHold.count({ where: { customerId: source.customerId } })).toBe(0)
  })

  it('allows a second, later hold on the same Customer — a history, not a single row', async () => {
    const { tenant, business } = await freshScope('history')
    const { viewer } = await ownerOf(business)
    const fresh = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'U-ceah-history', threadId: 'TH-CEAH-HISTORY', text: 'hi', externalMessageId: 'MI-CEAH-HISTORY' })

    await recordCustomerLegalHold(fresh.customerId, { businessId: business.id, reason: 'ข้อพิพาทที่ 1', endDate: futureDateOnly(10) }, { viewer })
    await recordCustomerLegalHold(fresh.customerId, { businessId: business.id, reason: 'ข้อพิพาทที่ 2', endDate: futureDateOnly(400) }, { viewer })

    const rows = await prisma.customerLegalHold.findMany({ where: { customerId: fresh.customerId } })
    expect(rows).toHaveLength(2)
  })
})

describe('SEC-034 erasure and the legal hold (TASK-ZAI-113 P1)', () => {
  it.each(['manifest-create', 'readback'])('removes a new reseal file when %s fails while preserving the prior archive, consent and hold', async (failureStage) => {
    const { tenant, business } = await freshScope('erase-reseal-rollback')
    const { viewer } = await ownerOf(business)
    const suffix = randomUUID().slice(0, 8)
    const threadId = `TH-CEAH-RESEAL-${suffix}`
    const start = new Date(Date.now() - PAST * DAY_MS)
    const aBeforeB = await groupMessage({
      tenant, business, threadId, speaker: `U-CEAH-A-${suffix}`,
      text: 'A spoke before B joined', createdAt: start,
    })
    const bMessage = await groupMessage({
      tenant, business, threadId, speaker: `U-CEAH-B-${suffix}`,
      text: 'B own line', createdAt: new Date(start.getTime() + 60_000),
    })
    const aAfterB = await groupMessage({
      tenant, business, threadId, speaker: `U-CEAH-A-${suffix}`,
      text: 'A line kept for held B', createdAt: new Date(start.getTime() + 120_000),
    })
    expect(aBeforeB.customerId).not.toBe(bMessage.customerId)
    expect(aAfterB.customerId).toBe(aBeforeB.customerId)

    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    const hold = await recordCustomerLegalHold(
      bMessage.customerId,
      { businessId: business.id, reason: 'active hold before rollback test', endDate: futureDateOnly(400) },
      { viewer },
    )
    const consent = await recordCustomerRetentionConsent(
      bMessage.customerId,
      { businessId: business.id, note: 'active retention consent before rollback test' },
      { viewer },
    )

    const personBefore = await prisma.person.findUnique({ where: { id: aBeforeB.personId } })
    const customerBefore = await prisma.customer.findUnique({ where: { id: aBeforeB.customerId } })
    const identitiesBefore = await prisma.channelIdentity.findMany({ where: { tenantId: tenant.id, personId: aBeforeB.personId }, orderBy: { id: 'asc' } })
    const messagesBefore = await prisma.message.findMany({
      where: { id: { in: [aBeforeB.messageId, bMessage.messageId, aAfterB.messageId] } },
      orderBy: { id: 'asc' },
    })
    const retentionBefore = await prisma.customerRetentionConsent.findMany({ where: { id: consent.id } })
    const holdBefore = await prisma.customerLegalHold.findMany({ where: { id: hold.legalHoldId } })
    const customerKeysBefore = await prisma.customerArchiveKey.findMany({ where: { tenantId: tenant.id }, orderBy: { customerId: 'asc' } })
    const manifestsBefore = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })
    expect(manifestsBefore).toHaveLength(1)
    const filesBefore = await archiveFileSnapshot(baseDir)
    expect(Object.keys(filesBefore)).toEqual([manifestsBefore[0].filePath])

    const injectedMessage = failureStage === 'readback'
      ? 'POST_RESEAL_READBACK_INJECTED_FAILURE'
      : 'POST_RESEAL_MANIFEST_INJECTED_FAILURE'
    let newlyWrittenArchivePath = null
    let archivePresentAtFailure = false
    let injectedFailureCount = 0
    let failingDb = prisma
    let readFileSpy = null

    if (failureStage === 'readback') {
      const originalReadFile = fs.readFile.bind(fs)
      readFileSpy = vi.spyOn(fs, 'readFile').mockImplementation(async (file, ...args) => {
        const absolute = path.resolve(String(file))
        const relative = path.relative(baseDir, absolute).split(path.sep).join('/')
        const isInsideArchiveRoot = relative && relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative)
        const isNewArchiveFile = isInsideArchiveRoot && relative.endsWith('.zca') && !Object.hasOwn(filesBefore, relative)
        if (isNewArchiveFile) {
          injectedFailureCount += 1
          newlyWrittenArchivePath = absolute
          archivePresentAtFailure = (await fs.stat(absolute)).isFile()
          throw new Error(injectedMessage)
        }
        return originalReadFile(file, ...args)
      })
    } else {
      failingDb = prisma.$extends({
        query: {
          archiveManifest: {
            async create({ args, query }) {
              if (args.data?.tenantId === tenant.id && args.data?.runId && !manifestsBefore.some((row) => row.runId === args.data.runId)) {
                injectedFailureCount += 1
                const filesAtFailure = await archiveFileSnapshot(baseDir)
                const newlyWritten = Object.keys(filesAtFailure).filter((file) => !Object.hasOwn(filesBefore, file))
                if (newlyWritten.length === 1) {
                  newlyWrittenArchivePath = path.resolve(baseDir, newlyWritten[0])
                  archivePresentAtFailure = (await fs.stat(newlyWrittenArchivePath)).isFile()
                }
                throw new Error(injectedMessage)
              }
              return query(args)
            },
          },
        },
      })
    }

    let thrown
    try {
      await erasePrincipal(
        { tenantId: tenant.id, personId: aBeforeB.personId, reason: 'TEST_RESEAL_ROLLBACK' },
        { db: failingDb, archiveBaseDir: baseDir },
      )
    } catch (error) {
      thrown = error
    } finally {
      readFileSpy?.mockRestore()
    }

    expect(thrown).toMatchObject({ message: injectedMessage })
    expect(injectedFailureCount).toBe(1)
    expect(archivePresentAtFailure).toBe(true)
    expect(newlyWrittenArchivePath).toBeTruthy()
    const relativePath = path.relative(baseDir, newlyWrittenArchivePath).split(path.sep).join('/')
    expect(relativePath).toMatch(/\.zca$/)
    expect(thrown.archiveFile).toEqual({
      runId: path.basename(newlyWrittenArchivePath, '.zca'),
      relativePath,
      baseDir,
    })

    // For readback failure, writeArchiveFile has already renamed the file but
    // throws before returning. Its error metadata reaches erasePrincipal, whose
    // rollback cleanup removes that unreferenced file. The manifest-create case
    // covers the distinct post-write database failure inside hold reseal.
    expect(await prisma.person.findUnique({ where: { id: aBeforeB.personId } })).toEqual(personBefore)
    expect(await prisma.customer.findUnique({ where: { id: aBeforeB.customerId } })).toEqual(customerBefore)
    expect(await prisma.channelIdentity.findMany({ where: { tenantId: tenant.id, personId: aBeforeB.personId }, orderBy: { id: 'asc' } })).toEqual(identitiesBefore)
    expect(await prisma.message.findMany({
      where: { id: { in: [aBeforeB.messageId, bMessage.messageId, aAfterB.messageId] } },
      orderBy: { id: 'asc' },
    })).toEqual(messagesBefore)
    expect(await prisma.customerRetentionConsent.findMany({ where: { id: consent.id } })).toEqual(retentionBefore)
    expect(await prisma.customerLegalHold.findMany({ where: { id: hold.legalHoldId } })).toEqual(holdBefore)
    expect(await prisma.customerArchiveKey.findMany({ where: { tenantId: tenant.id }, orderBy: { customerId: 'asc' } })).toEqual(customerKeysBefore)
    expect(await prisma.legalHoldArchiveKey.count({ where: { tenantId: tenant.id } })).toBe(0)
    expect(await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })).toEqual(manifestsBefore)
    expect(await prisma.auditEvent.count({ where: { entityType: 'PRINCIPAL', entityId: aBeforeB.personId, action: 'ERASED' } })).toBe(0)

    const filesAfter = await archiveFileSnapshot(baseDir)
    expect(Object.keys(filesAfter)).toEqual(Object.keys(filesBefore))
    expect(filesAfter).toEqual(filesBefore)
  })

  it('destroys the archive key on erasure when there is no legal hold', async () => {
    const { tenant, business } = await freshScope('erase-nohold')
    const backdated = await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })

    const keyBefore = await prisma.customerArchiveKey.findUnique({ where: { customerId: backdated.customerId } })
    expect(keyBefore).toBeTruthy()

    const customer = await prisma.customer.findUnique({ where: { id: backdated.customerId } })
    const result = await erasePrincipal({ tenantId: tenant.id, personId: customer.personId, reason: 'TEST' })

    expect(result.archiveKeys).toEqual([{ customerId: backdated.customerId, keyDestroyed: true, legalHold: null }])
    const keyAfter = await prisma.customerArchiveKey.findUnique({ where: { customerId: backdated.customerId } })
    expect(keyAfter).toBeNull()
  })

  it('leaves the archive key alone on erasure when an active legal hold is recorded, and reports the hold', async () => {
    const { tenant, business } = await freshScope('erase-hold')
    const { viewer } = await ownerOf(business)
    const backdated = await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })

    await recordCustomerLegalHold(backdated.customerId, { businessId: business.id, reason: 'ข้อพิพาทที่ยังไม่จบ', endDate: futureDateOnly(400) }, { viewer })

    const customer = await prisma.customer.findUnique({ where: { id: backdated.customerId } })
    const result = await erasePrincipal({ tenantId: tenant.id, personId: customer.personId, reason: 'TEST' })

    expect(result.archiveKeys).toHaveLength(1)
    expect(result.archiveKeys[0]).toMatchObject({ customerId: backdated.customerId, keyDestroyed: false })
    expect(result.archiveKeys[0].legalHold).toMatchObject({ reason: 'ข้อพิพาทที่ยังไม่จบ' })

    const keyAfter = await prisma.customerArchiveKey.findUnique({ where: { customerId: backdated.customerId } })
    expect(keyAfter).toBeTruthy() // survives

    // The audit event for the erasure itself carries the hold — "the erasure
    // status shows the hold" (ADR-093 D6) — without a second, parallel status reader.
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'PRINCIPAL', entityId: customer.personId, action: 'ERASED' } })
    const payload = JSON.parse(audit.payloadJson)
    expect(payload.archiveKeys[0].keyDestroyed).toBe(false)
    expect(payload.archiveKeys[0].legalHold.reason).toBe('ข้อพิพาทที่ยังไม่จบ')
  })

  it('erases exactly as before a Customer who was never archived — no new required field, no archive key ever created', async () => {
    const { tenant, business } = await freshScope('erase-never-archived')
    const fresh = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'U-ceah-never', threadId: 'TH-CEAH-NEVER', text: 'hi', externalMessageId: 'MI-CEAH-NEVER' })
    const customer = await prisma.customer.findUnique({ where: { id: fresh.customerId } })

    const result = await erasePrincipal({ tenantId: tenant.id, personId: customer.personId, reason: 'TEST' })
    expect(result.archiveKeys).toEqual([{ customerId: fresh.customerId, keyDestroyed: false, legalHold: null }])
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: fresh.customerId } })).toBeNull()
  })
})

describe('SEC-034 expireChatEvidenceArchive (ADR-093 D5)', () => {
  it('retires an expired archive in the chain before deleting its file', async () => {
    const { tenant, business } = await freshScope('expire')
    const firstMessageText = `retirement must not include message alpha ${randomUUID()}`
    const firstBackdated = await backdatedMessage({ tenant, business, ageDays: PAST, text: firstMessageText })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    const secondMessageText = `retirement must not include message bravo ${randomUUID()}`
    const secondBackdated = await backdatedMessage({ tenant, business, ageDays: PAST, text: secondMessageText })
    await sweepFixtureTenant(tenant.id, { now: new Date(Date.now() + 1000), baseDir })
    const manifestsBeforeExpiry = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })
    expect(manifestsBeforeExpiry).toHaveLength(2)
    const originalManifestHashes = new Map(manifestsBeforeExpiry.map((manifest) => [manifest.id, manifest.manifestHash]))
    for (const manifest of manifestsBeforeExpiry) {
      await expect(fs.stat(path.join(baseDir, manifest.filePath))).resolves.toBeTruthy()
    }

    // retentionYears: 0 — every archived line (already backdated by the sweep
    // fixture) is trivially "past the term" without waiting 10 real years.
    const result = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(Date.now() + 2000), baseDir, retentionYears: 0 })

    expect(result.skipped).toBe(false)
    expect(result.destroyedKeys.sort()).toEqual([firstBackdated.customerId, secondBackdated.customerId].sort())
    expect(result.deletedFiles.sort()).toEqual(manifestsBeforeExpiry.map((manifest) => manifest.id).sort())
    expect(result.retiredManifestIds.sort()).toEqual(manifestsBeforeExpiry.map((manifest) => manifest.id).sort())
    expect(result.retirementManifest).toMatchObject({ id: expect.any(String), manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(result.retirementFailureReason).toBeNull()
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: firstBackdated.customerId } })).toBeNull()
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: secondBackdated.customerId } })).toBeNull()
    for (const manifest of manifestsBeforeExpiry) {
      await expect(fs.stat(path.join(baseDir, manifest.filePath))).rejects.toThrow()
    }
    // The manifest row itself — the chain-of-custody record — is never deleted.
    for (const manifest of manifestsBeforeExpiry) {
      expect(await prisma.archiveManifest.findUnique({ where: { id: manifest.id } })).toBeTruthy()
    }

    const rows = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })
    for (const [manifestId, manifestHash] of originalManifestHashes) {
      expect(rows.find((row) => row.id === manifestId).manifestHash).toBe(manifestHash)
    }
    const retirementRow = rows.find((row) => row.filePath.endsWith('.zcr'))
    expect(retirementRow).toMatchObject({ messageCount: 0, messageIdListHash: hashMessageIdList([]) })
    expect(computeManifestHash(retirementRow)).toBe(retirementRow.manifestHash)
    const retirementText = await fs.readFile(path.join(baseDir, retirementRow.filePath), 'utf8')
    const retirementHeader = JSON.parse(retirementText.trim())
    expect(retirementText.trim().split('\n')).toHaveLength(1)
    expect(Object.keys(retirementHeader).sort()).toEqual(['createdAt', 'kind', 'reason', 'retentionYears', 'retired', 'runId', 'tenantId', 'v'].sort())
    expect(retirementHeader).toMatchObject({ v: 4, kind: 'RETIREMENT', tenantId: tenant.id, runId: retirementRow.runId, reason: 'RETENTION_EXPIRED', retentionYears: 0 })
    expect(retirementHeader.retired).toEqual(manifestsBeforeExpiry.map((manifest) => ({
      manifestId: manifest.id, runId: manifest.runId, filePath: manifest.filePath,
      fileSha256: manifest.fileSha256, manifestHash: originalManifestHashes.get(manifest.id),
      messageCount: manifest.messageCount, messageIdListHash: manifest.messageIdListHash,
    })))
    for (const sensitiveValue of [firstBackdated.customerId, secondBackdated.customerId, firstMessageText, secondMessageText]) {
      expect(retirementText).not.toContain(sensitiveValue)
    }
    await expect(verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true }))
      .resolves.toEqual({ valid: true, retiredManifestIds: manifestsBeforeExpiry.map((manifest) => manifest.id) })

    // A second run verifies the existing retirement, is not skipped, and writes
    // no duplicate retirement row for the same expired archive.
    const rowCount = rows.length
    const second = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(Date.now() + 3000), baseDir, retentionYears: 0 })
    expect(second.skipped).toBe(false)
    expect(second.retiredManifestIds).toEqual([])
    expect(second.retirementManifest).toBeNull()
    expect(await prisma.archiveManifest.count({ where: { tenantId: tenant.id } })).toBe(rowCount)
    await expect(fs.stat(path.join(baseDir, retirementRow.filePath))).resolves.toBeTruthy()
    const rowsAfterSecondRun = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })
    const retirementIndex = rowsAfterSecondRun.findIndex((row) => row.id === retirementRow.id)
    const laterRetirements = rowsAfterSecondRun.slice(retirementIndex + 1).filter((row) => row.filePath.endsWith('.zcr'))
    for (const laterRetirement of laterRetirements) {
      const laterHeader = JSON.parse(await fs.readFile(path.join(baseDir, laterRetirement.filePath), 'utf8'))
      expect(laterHeader.retired.map((entry) => entry.manifestId)).not.toContain(retirementRow.id)
    }
    await expect(verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true }))
      .resolves.toEqual({ valid: true, retiredManifestIds: manifestsBeforeExpiry.map((manifest) => manifest.id) })
  })

  it('writes no retirement file or manifest row when no archive has expired', async () => {
    const { tenant, business } = await freshScope('expire-nothing')
    await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    const before = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })
    expect(before).toHaveLength(1)

    const result = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(), baseDir, retentionYears: 10 })

    expect(result.skipped).toBe(false)
    expect(result.retiredManifestIds).toEqual([])
    expect(result.retirementManifest).toBeNull()
    const after = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })
    expect(after.map((manifest) => [manifest.id, manifest.manifestHash])).toEqual(before.map((manifest) => [manifest.id, manifest.manifestHash]))
    expect(after.some((manifest) => manifest.filePath.endsWith('.zcr'))).toBe(false)
    expect(Object.keys(await archiveFileSnapshot(baseDir))).toEqual(before.map((manifest) => manifest.filePath))
    await expect(verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true }))
      .resolves.toEqual({ valid: true, retiredManifestIds: [] })
  })

  it('writes one retirement file for all fully-expired files in one Tenant run', async () => {
    const { tenant, business } = await freshScope('expire-one-retirement')
    await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(Date.now() + 1000), baseDir })
    const archives = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })
    expect(archives).toHaveLength(2)

    const result = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(Date.now() + 2000), baseDir, retentionYears: 0 })

    expect(result.retiredManifestIds.sort()).toEqual(archives.map((row) => row.id).sort())
    const rows = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id } })
    const retirementRows = rows.filter((row) => row.filePath.endsWith('.zcr'))
    expect(retirementRows).toHaveLength(1)
    const header = JSON.parse(await fs.readFile(path.join(baseDir, retirementRows[0].filePath), 'utf8'))
    expect(header.retired.map((entry) => entry.manifestId).sort()).toEqual(archives.map((row) => row.id).sort())
  })

  it('leaves archive files and the chain intact when writing the retirement file fails', async () => {
    const { tenant, business } = await freshScope('expire-retirement-write-fails')
    await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    const archive = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })
    const originalOpen = fs.open.bind(fs)
    const openFailure = vi.spyOn(fs, 'open').mockImplementation((target, ...args) => {
      if (String(target).includes('.zcr.tmp-')) return Promise.reject(Object.assign(new Error('injected write failure'), { code: 'EIO' }))
      return originalOpen(target, ...args)
    })
    let result
    try {
      result = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(), baseDir, retentionYears: 0 })
    } finally {
      openFailure.mockRestore()
    }

    expect(result.deletedFiles).toEqual([])
    expect(result.retirementFailureReason).toBe('ARCHIVE_FILE_WRITE_FAILED')
    expect(await fs.stat(path.join(baseDir, archive.filePath))).toBeTruthy()
    expect(Object.keys(await archiveFileSnapshot(baseDir))).toEqual([archive.filePath])
    await expect(verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true }))
      .resolves.toEqual({ valid: true, retiredManifestIds: [] })
    const audit = await prisma.auditEvent.findFirst({ where: { tenantId: tenant.id, action: 'ARCHIVE_EXPIRY_COMPLETED' } })
    expect(JSON.parse(audit.payloadJson).retirementFailureReason).toBe('ARCHIVE_FILE_WRITE_FAILED')
  })

  it('uses a stable audit reason when retirement-file readback fails during an expiry run', async () => {
    const { tenant, business } = await freshScope('expire-retirement-readback-fails')
    const now = new Date()
    await backdatedMessage({ tenant, business, ageDays: 11 * 365 })
    await sweepFixtureTenant(tenant.id, { now, baseDir })
    const archive = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })
    const originalReadFile = fs.readFile.bind(fs)
    const readbackFailure = vi.spyOn(fs, 'readFile').mockImplementation((target, ...args) => {
      if (String(target).endsWith('.zcr')) {
        return Promise.reject(Object.assign(new Error('injected retirement readback failure'), { code: 'EIO' }))
      }
      return originalReadFile(target, ...args)
    })
    let run
    try {
      run = await runChatEvidenceArchiveExpiry(expiryFixtureDb(tenant.id), {
        now, baseDir, env: { NODE_ENV: 'test' },
      })
    } finally {
      readbackFailure.mockRestore()
    }

    expect(run.counts).toMatchObject({ tenantsVisited: 1, manifestsRetired: 0, filesDeleted: 0, failures: 1 })
    const rows = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(archive.id)
    expect(Object.keys(await archiveFileSnapshot(baseDir))).toEqual([archive.filePath])
    await expect(fs.stat(path.join(baseDir, archive.filePath))).resolves.toBeTruthy()
    await expect(verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true }))
      .resolves.toEqual({ valid: true, retiredManifestIds: [] })

    const tenantAudit = await prisma.auditEvent.findFirst({
      where: { tenantId: tenant.id, action: 'ARCHIVE_EXPIRY_COMPLETED' },
    })
    expect(JSON.parse(tenantAudit.payloadJson)).toMatchObject({
      deletedFiles: [], retiredManifestIds: [], retirementFailureReason: 'ARCHIVE_RETIREMENT_FAILED',
    })
    const runAudit = await prisma.auditEvent.findUnique({ where: { id: run.auditEventId } })
    expect(JSON.parse(runAudit.payloadJson).tenants).toMatchObject([{
      tenantId: tenant.id, filesDeleted: 0, manifestsRetired: 0, failureCode: 'ARCHIVE_RETIREMENT_FAILED',
    }])
  })

  it('leaves archive files and the chain intact when the retirement transaction fails', async () => {
    const { tenant, business } = await freshScope('expire-retirement-transaction-fails')
    await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    const archive = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })
    const failingDb = prisma.$extends({
      query: {
        archiveManifest: {
          async create({ args, query }) {
            if (args.data?.filePath?.endsWith('.zcr')) {
              throw Object.assign(new Error('injected transaction failure'), { code: 'ARCHIVE_TRANSACTION_INJECTED' })
            }
            return query(args)
          },
        },
      },
    })

    const result = await expireChatEvidenceArchive(failingDb, { tenantId: tenant.id, now: new Date(), baseDir, retentionYears: 0 })

    expect(result.deletedFiles).toEqual([])
    expect(result.retirementFailureReason).toBe('ARCHIVE_TRANSACTION_INJECTED')
    expect(await fs.stat(path.join(baseDir, archive.filePath))).toBeTruthy()
    expect(Object.keys(await archiveFileSnapshot(baseDir))).toEqual([archive.filePath])
    await expect(verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true }))
      .resolves.toEqual({ valid: true, retiredManifestIds: [] })
    const audit = await prisma.auditEvent.findFirst({ where: { tenantId: tenant.id, action: 'ARCHIVE_EXPIRY_COMPLETED' } })
    expect(JSON.parse(audit.payloadJson).retirementFailureReason).toBe('ARCHIVE_TRANSACTION_INJECTED')
  })

  it('reports a post-commit delete failure and retries it without appending another retirement', async () => {
    const { tenant, business } = await freshScope('expire-delete-retry')
    await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    const archive = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })
    const originalUnlink = fs.unlink.bind(fs)
    const unlinkFailure = vi.spyOn(fs, 'unlink').mockImplementation((target, ...args) => {
      if (path.resolve(String(target)) === path.resolve(baseDir, archive.filePath)) {
        return Promise.reject(Object.assign(new Error('injected delete failure'), { code: 'EACCES' }))
      }
      return originalUnlink(target, ...args)
    })
    let first
    try {
      first = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(), baseDir, retentionYears: 0 })
    } finally {
      unlinkFailure.mockRestore()
    }
    expect(first.retiredManifestIds).toEqual([archive.id])
    expect(first.deletedFiles).toEqual([])
    expect(first.retiredFilesStillPresent).toEqual([archive.id])
    expect(await fs.stat(path.join(baseDir, archive.filePath))).toBeTruthy()
    await expect(verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true }))
      .resolves.toEqual({ valid: true, retiredManifestIds: [archive.id] })

    const countBeforeRetry = await prisma.archiveManifest.count({ where: { tenantId: tenant.id } })
    const retry = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(Date.now() + 1000), baseDir, retentionYears: 0 })
    expect(retry.skipped).toBe(false)
    expect(retry.retiredManifestIds).toEqual([])
    expect(retry.deletedFiles).toEqual([archive.id])
    expect(retry.retiredFilesStillPresent).toEqual([])
    expect(await prisma.archiveManifest.count({ where: { tenantId: tenant.id } })).toBe(countBeforeRetry)
    await expect(fs.stat(path.join(baseDir, archive.filePath))).rejects.toThrow()
  })

  it('never destroys a key or deletes a file for a Customer under an active legal hold', async () => {
    const { tenant, business } = await freshScope('expire-hold')
    const { viewer } = await ownerOf(business)
    const backdated = await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    await recordCustomerLegalHold(backdated.customerId, { businessId: business.id, reason: 'ข้อพิพาทระหว่างพิจารณา', endDate: futureDateOnly(400) }, { viewer })

    const manifest = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })
    const filePath = path.join(baseDir, manifest.filePath)

    const result = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(), baseDir, retentionYears: 0 })

    expect(result.destroyedKeys).toEqual([])
    expect(result.deletedFiles).toEqual([])
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: backdated.customerId } })).toBeTruthy()
    await expect(fs.stat(filePath)).resolves.toBeTruthy()
  })

  it('does not delete a file that mixes an expired Customer with a held one', async () => {
    const { tenant, business } = await freshScope('expire-mixed')
    const { viewer } = await ownerOf(business)
    const threadId = 'TH-CEAH-MIXED'
    // Two different Customers archived into the SAME sweep run (and so the
    // same file): one goes on hold, the other does not.
    const held = await backdatedMessage({ tenant, business, ageDays: PAST, threadId: `${threadId}-A`, text: 'ลูกค้าที่ถือครอง' })
    const notHeld = await backdatedMessage({ tenant, business, ageDays: PAST, threadId: `${threadId}-B`, text: 'ลูกค้าที่ไม่ถือครอง' })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    await recordCustomerLegalHold(held.customerId, { businessId: business.id, reason: 'ข้อพิพาทของลูกค้า A', endDate: futureDateOnly(400) }, { viewer })

    const manifest = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })
    const filePath = path.join(baseDir, manifest.filePath)

    const result = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(), baseDir, retentionYears: 0 })

    // The unheld Customer's key is destroyed even though the file survives.
    expect(result.destroyedKeys).toEqual([notHeld.customerId])
    expect(result.deletedFiles).toEqual([])
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: held.customerId } })).toBeTruthy()
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: notHeld.customerId } })).toBeNull()
    await expect(fs.stat(filePath)).resolves.toBeTruthy()
  })

  it('destroys nothing and deletes nothing when the Tenant chain is broken', async () => {
    const { tenant, business } = await freshScope('expire-chain-broken')
    const backdated = await backdatedMessage({ tenant, business, ageDays: PAST })
    await sweepFixtureTenant(tenant.id, { now: new Date(), baseDir })
    const manifest = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })
    const originalManifest = { fileSha256: manifest.fileSha256, manifestHash: manifest.manifestHash }
    try {
      await prisma.archiveManifest.update({ where: { id: manifest.id }, data: { fileSha256: 'f'.repeat(64) } })

      const result = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(), baseDir, retentionYears: 0 })

      expect(result.skipped).toBe(true)
      expect(result.chainIntegrity.valid).toBe(false)
      expect(result.destroyedKeys).toEqual([])
      expect(result.deletedFiles).toEqual([])
      expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: backdated.customerId } })).toBeTruthy()

      const audit = await prisma.auditEvent.findFirst({ where: { action: 'ARCHIVE_EXPIRY_COMPLETED', tenantId: tenant.id } })
      expect(audit).toBeTruthy()
      expect(JSON.parse(audit.payloadJson).skipped).toBe(true)
    } finally {
      await prisma.archiveManifest.update({ where: { id: manifest.id }, data: originalManifest })
    }
  })

  it('leaves a Customer with no archived lines alone (a key that has none to check)', async () => {
    const { tenant, business } = await freshScope('expire-empty')
    const result = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(), baseDir, retentionYears: 0 })
    expect(result.skipped).toBe(false)
    expect(result.destroyedKeys).toEqual([])
    expect(result.deletedFiles).toEqual([])
    expect(result.retiredManifestIds).toEqual([])
    expect(result.retirementManifest).toBeNull()
    expect(await prisma.archiveManifest.count({ where: { tenantId: tenant.id } })).toBe(0)
    expect(await fs.readdir(baseDir)).toEqual([])
  })
})

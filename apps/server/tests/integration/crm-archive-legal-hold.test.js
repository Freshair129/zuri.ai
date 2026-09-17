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
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { runRetentionSweep } from '@/modules/crm/retention-sweep-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'
import { recordCustomerLegalHold } from '@/modules/crm/chat-evidence-legal-hold-service'
import { erasePrincipal } from '@/modules/identity/erase-principal'
import { expireChatEvidenceArchive } from '@/modules/crm/chat-evidence-archive-expiry-service'

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
  it('destroys the archive key on erasure when there is no legal hold', async () => {
    const { tenant, business } = await freshScope('erase-nohold')
    const backdated = await backdatedMessage({ tenant, business, ageDays: PAST })
    await runRetentionSweep({ now: new Date(), baseDir })

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
    await runRetentionSweep({ now: new Date(), baseDir })

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

describe('SEC-034 expireChatEvidenceArchive (TASK-ZAI-113 P2)', () => {
  it('destroys a Customer key once every archived line is past the retention term, and deletes the now-fully-expired file', async () => {
    const { tenant, business } = await freshScope('expire')
    const backdated = await backdatedMessage({ tenant, business, ageDays: PAST })
    await runRetentionSweep({ now: new Date(), baseDir })
    const manifest = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })
    expect(manifest).toBeTruthy()
    const filePath = path.join(baseDir, manifest.filePath)
    await expect(fs.stat(filePath)).resolves.toBeTruthy()

    // retentionYears: 0 — every archived line (already backdated by the sweep
    // fixture) is trivially "past the term" without waiting 10 real years.
    const result = await expireChatEvidenceArchive(prisma, { tenantId: tenant.id, now: new Date(), baseDir, retentionYears: 0 })

    expect(result.skipped).toBe(false)
    expect(result.destroyedKeys).toEqual([backdated.customerId])
    expect(result.deletedFiles).toEqual([manifest.id])
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: backdated.customerId } })).toBeNull()
    await expect(fs.stat(filePath)).rejects.toThrow()
    // The manifest row itself — the chain-of-custody record — is never deleted.
    expect(await prisma.archiveManifest.findUnique({ where: { id: manifest.id } })).toBeTruthy()
  })

  it('never destroys a key or deletes a file for a Customer under an active legal hold', async () => {
    const { tenant, business } = await freshScope('expire-hold')
    const { viewer } = await ownerOf(business)
    const backdated = await backdatedMessage({ tenant, business, ageDays: PAST })
    await runRetentionSweep({ now: new Date(), baseDir })
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
    await runRetentionSweep({ now: new Date(), baseDir })
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
    await runRetentionSweep({ now: new Date(), baseDir })
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
  })
})

// @req SEC-034 — an OWNER-recorded legal hold defers a Customer's chat
//   evidence archive key destruction — on PDPA erasure or the ADR-093 D5 term
//   expiry — until the hold ends (ADR-093 D6, TASK-ZAI-113).
// @spec ADR-093 D5, D6; SEC-034
// @tested tests/integration/crm-archive-legal-hold.test.js
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, makeOperatorViewer } from '../factories/viewer'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { runRetentionSweep } from '@/modules/crm/retention-sweep-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'
import { recordArchiveLegalHold, activeLegalHolds } from '@/modules/crm/archive-legal-hold-service'
import { sweepArchiveExpiry } from '@/modules/crm/chat-evidence-archive-expiry-service'
import { eraseCustomerPrincipal } from '@/modules/identity/erase-customer-principal'

const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_MS = 365 * DAY_MS
const PAST = RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1
let baseDir

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-archive-legal-hold-'))
})
afterEach(async () => {
  if (baseDir && path.resolve(baseDir).startsWith(path.resolve(os.tmpdir()))) {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

async function freshScope(label) {
  const suffix = randomUUID().slice(0, 8)
  const pf = await createPortfolio({ name: `ALH ${label} ${suffix}`, code: `PF-ALH-${suffix}` })
  const tenant = await createTenant({ portfolioId: pf.id, name: `ALH ${label} Tenant`, code: `TNT-ALH-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'ร้านหลักฐาน', code: `BUS-ALH-${suffix}` })
  return { tenant, business }
}

async function ownerFor(business) {
  const person = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Legal hold owner' } })
  return { person, viewer: makeViewer({ principal: { id: person.id, code: person.code, displayName: person.displayName }, ownedBusinessIds: [business.id], visibleBusinessIds: [business.id], visibleDomains: ['customer'] }) }
}

/** A message archived `ageYears` ago (its original createdAt, which the archived line carries verbatim). */
async function archivedMessage({ tenant, business, ageYears, text }) {
  const id = randomUUID().slice(0, 8)
  const result = await ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, lineUserId: `U-alh-${id}`,
    threadId: `TH-ALH-${id}`, text: text ?? `evidence ${id}`, externalMessageId: `MI-ALH-${id}`,
  })
  const createdAt = new Date(Date.now() - (ageYears * YEAR_MS + PAST * DAY_MS))
  await prisma.message.update({ where: { id: result.messageId }, data: { createdAt } })
  await runRetentionSweep({ now: new Date(), baseDir })
  return { ...result, createdAt }
}

function futureDateString(days) {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10)
}

describe('SEC-034 archive legal hold (TASK-ZAI-113)', () => {
  describe('recording a hold', () => {
    it('refuses a Business the viewer does not own', async () => {
      const { business } = await freshScope('record-notowner')
      const { person } = await ownerFor(business)
      const stranger = makeViewer({ principal: { id: person.id, code: person.code, displayName: person.displayName }, ownedBusinessIds: [], visibleBusinessIds: [business.id], visibleDomains: ['customer'] })
      await expect(recordArchiveLegalHold('does-not-matter', { businessId: business.id, reason: 'Dispute', endDate: futureDateString(30) }, { viewer: stranger }))
        .rejects.toMatchObject({ status: 403 })
    })

    it('refuses an end date that is not in the future', async () => {
      const { business } = await freshScope('record-pastend')
      const { viewer } = await ownerFor(business)
      const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10)
      await expect(recordArchiveLegalHold('does-not-matter', { businessId: business.id, reason: 'Dispute', endDate: yesterday }, { viewer }))
        .rejects.toMatchObject({ status: 400 })
    })

    it('records a hold for a real Customer in the owner\'s tenant and audits it', async () => {
      const { tenant, business } = await freshScope('record-ok')
      const { viewer } = await ownerFor(business)
      const message = await archivedMessage({ tenant, business, ageYears: 1 })

      const hold = await recordArchiveLegalHold(message.customerId, { businessId: business.id, reason: 'ลูกค้าฟ้องร้องเรื่องส่วนลด', endDate: futureDateString(90) }, { viewer })
      expect(hold.customerId).toBe(message.customerId)
      expect(hold.reason).toBe('ลูกค้าฟ้องร้องเรื่องส่วนลด')

      const active = await activeLegalHolds(prisma, { customerId: message.customerId })
      expect(active).toHaveLength(1)

      const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'ARCHIVE', action: 'ARCHIVE_LEGAL_HOLD_RECORDED', entityId: message.customerId } })
      expect(audit).toBeTruthy()
      expect(audit.reason).toBe('ลูกค้าฟ้องร้องเรื่องส่วนลด')
    })
  })

  describe('erasure interaction (P1)', () => {
    it('acceptance: erasure destroys the archive key when no hold is active', async () => {
      const { tenant, business } = await freshScope('erase-nohold')
      const message = await archivedMessage({ tenant, business, ageYears: 1 })
      expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: message.customerId } })).toBeTruthy()

      const result = await eraseCustomerPrincipal(message.customerId, { businessId: business.id, confirmation: 'ERASE' }, { viewer: makeOperatorViewer() })
      expect(result.archiveKeyStatus).toEqual({ customerId: message.customerId, status: 'destroyed' })
      expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: message.customerId } })).toBeNull()
    })

    it('success: erasure preserves the archive key under an active hold, and the erasure status shows it', async () => {
      const { tenant, business } = await freshScope('erase-hold')
      const { viewer } = await ownerFor(business)
      const message = await archivedMessage({ tenant, business, ageYears: 1 })
      await recordArchiveLegalHold(message.customerId, { businessId: business.id, reason: 'Active dispute', endDate: futureDateString(60) }, { viewer })

      const result = await eraseCustomerPrincipal(message.customerId, { businessId: business.id, confirmation: 'ERASE' }, { viewer: makeOperatorViewer() })
      expect(result.archiveKeyStatus).toEqual({ customerId: message.customerId, status: 'held', reason: 'ARCHIVE_LEGAL_HOLD_ACTIVE' })
      expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: message.customerId } })).toBeTruthy()

      // The hold protects only the archive key — the Customer is still erased
      // everywhere else (soft-deleted, redacted), same as a Customer with no hold.
      const customer = await prisma.customer.findUnique({ where: { id: message.customerId } })
      expect(customer.deletedAt).toBeTruthy()
    })
  })

  describe('term expiry (P2)', () => {
    it('exit: destroys a Customer\'s key once no unexpired line remains, and deletes a fully-expired file', async () => {
      const { tenant, business } = await freshScope('expiry-destroy')
      const message = await archivedMessage({ tenant, business, ageYears: 11, text: 'สัญญาเก่าเกินอายุความ' })
      const manifestBefore = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })
      expect(manifestBefore.fileDeletedAt).toBeNull()
      await expect(fs.access(path.join(baseDir, manifestBefore.filePath))).resolves.toBeUndefined()

      const result = await sweepArchiveExpiry({ now: new Date(), termYears: 10, baseDir })
      expect(result.destroyedArchiveKeys).toBe(1)
      expect(result.deletedFiles).toBe(1)

      expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: message.customerId } })).toBeNull()
      const manifestAfter = await prisma.archiveManifest.findUnique({ where: { id: manifestBefore.id } })
      expect(manifestAfter.fileDeletedAt).toBeTruthy() // row survives — chain of custody
      await expect(fs.access(path.join(baseDir, manifestBefore.filePath))).rejects.toThrow()
    })

    it('does not destroy a key or delete a file while any line is still within the term', async () => {
      const { tenant, business } = await freshScope('expiry-notyet')
      const message = await archivedMessage({ tenant, business, ageYears: 3 })

      const result = await sweepArchiveExpiry({ now: new Date(), termYears: 10, baseDir })
      expect(result.destroyedArchiveKeys).toBe(0)
      expect(result.deletedFiles).toBe(0)
      expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: message.customerId } })).toBeTruthy()
    })

    it('respects an active legal hold: neither the key nor the file is touched even though the content is past the term', async () => {
      const { tenant, business } = await freshScope('expiry-hold')
      const { viewer } = await ownerFor(business)
      const message = await archivedMessage({ tenant, business, ageYears: 11 })
      await recordArchiveLegalHold(message.customerId, { businessId: business.id, reason: 'Still disputed after ten years', endDate: futureDateString(30) }, { viewer })
      const manifest = await prisma.archiveManifest.findFirst({ where: { tenantId: tenant.id } })

      const result = await sweepArchiveExpiry({ now: new Date(), termYears: 10, baseDir })
      expect(result.destroyedArchiveKeys).toBe(0)
      expect(result.deletedFiles).toBe(0)

      expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: message.customerId } })).toBeTruthy()
      expect((await prisma.archiveManifest.findUnique({ where: { id: manifest.id } })).fileDeletedAt).toBeNull()
      await expect(fs.access(path.join(baseDir, manifest.filePath))).resolves.toBeUndefined()
    })

    it('keeps a file that holds one expired and one still-current Customer segment, but still destroys the expired Customer\'s key', async () => {
      const { tenant, business } = await freshScope('expiry-mixed')
      // Both messages backdated and archived by the SAME sweep run — deliberately
      // not the archivedMessage() helper, which would call runRetentionSweep
      // once per message and put each in its own file. runRetentionSweep groups
      // every Tenant candidate of one run into one file, one segment per
      // Customer, which is the shared-file scenario this test needs.
      const old = await ingestLineMessage({
        tenantId: tenant.id, businessId: business.id, lineUserId: 'U-alh-old',
        threadId: 'TH-ALH-OLD', text: 'เก่าเกินอายุ', externalMessageId: 'MI-ALH-OLD',
      })
      await prisma.message.update({ where: { id: old.messageId }, data: { createdAt: new Date(Date.now() - (11 * YEAR_MS + PAST * DAY_MS)) } })
      const fresh = await ingestLineMessage({
        tenantId: tenant.id, businessId: business.id, lineUserId: 'U-alh-fresh',
        threadId: 'TH-ALH-FRESH', text: 'ยังอยู่ในอายุความ', externalMessageId: 'MI-ALH-FRESH',
      })
      await prisma.message.update({ where: { id: fresh.messageId }, data: { createdAt: new Date(Date.now() - (1 * YEAR_MS + PAST * DAY_MS)) } })
      await runRetentionSweep({ now: new Date(), baseDir })

      const result = await sweepArchiveExpiry({ now: new Date(), termYears: 10, baseDir })
      expect(result.destroyedArchiveKeys).toBe(1)
      expect(result.deletedFiles).toBe(0) // the file still holds the fresh Customer's live segment

      expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: old.customerId } })).toBeNull()
      expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: fresh.customerId } })).toBeTruthy()
    })

    it('writes exactly one audit event per run, naming the totals', async () => {
      const { tenant, business } = await freshScope('expiry-audit')
      await archivedMessage({ tenant, business, ageYears: 11 })
      const before = await prisma.auditEvent.count({ where: { entityType: 'ARCHIVE', action: 'ARCHIVE_EXPIRY_SWEEP_COMPLETED' } })

      const result = await sweepArchiveExpiry({ now: new Date(), termYears: 10, baseDir })
      const after = await prisma.auditEvent.count({ where: { entityType: 'ARCHIVE', action: 'ARCHIVE_EXPIRY_SWEEP_COMPLETED' } })
      expect(after).toBe(before + 1)

      const event = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } })
      const payload = JSON.parse(event.payloadJson)
      expect(payload.destroyedArchiveKeys).toBeGreaterThanOrEqual(1)
      expect(payload.termYears).toBe(10)
    })
  })
})

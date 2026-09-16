// @req FR-245 — an OWNER at AAL2 recovers one Customer's archived messages for
//   a date range, grouped by session, with a case reference; every attempt is
//   audited, and a file or manifest that cannot be verified is reported
//   rather than failing the whole retrieval (ADR-093 D7, TASK-ZAI-112).
// @spec ADR-093 D4, D7; SEC-034
// @tested tests/integration/crm-chat-evidence-retrieval.test.js
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { runRetentionSweep } from '@/modules/crm/retention-sweep-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'
import { retrieveArchivedChatEvidence } from '@/modules/crm/chat-evidence-retrieval-service'

const DAY_MS = 24 * 60 * 60 * 1000
const PAST = RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1
let baseDir, owner, ownerViewer, session

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-cea-retrieve-'))
  session = { id: randomUUID(), personId: owner?.id, status: 'ACTIVE', elevatedUntil: new Date(Date.now() + 900_000), expiresAt: new Date(Date.now() + 3600_000) }
})
afterEach(async () => {
  if (baseDir && path.resolve(baseDir).startsWith(path.resolve(os.tmpdir()))) {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

/** A fresh Portfolio → Tenant → Business, isolated to one test — same shape crm-chat-evidence-archive.test.js uses. */
async function freshScope(label) {
  const suffix = randomUUID().slice(0, 8)
  const pf = await createPortfolio({ name: `CEA-retrieve ${label} ${suffix}`, code: `PF-CEAR-${suffix}` })
  const tenant = await createTenant({ portfolioId: pf.id, name: `CEA-retrieve ${label} Tenant`, code: `TNT-CEAR-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'ร้านหลักฐาน', code: `BUS-CEAR-${suffix}` })
  return { tenant, business }
}

async function backdatedMessage({ tenant, business, ageDays, threadId, externalMessageId, text }) {
  const id = randomUUID().slice(0, 8)
  const result = await ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, lineUserId: `U-cear-${id}`,
    threadId: threadId ?? `TH-CEAR-${id}`, text: text ?? `evidence ${id}`, externalMessageId: externalMessageId ?? `MI-CEAR-${id}`,
  })
  await prisma.message.update({ where: { id: result.messageId }, data: { createdAt: new Date(Date.now() - ageDays * DAY_MS) } })
  return result
}

function todayRange(spanDays = PAST + 5) {
  const iso = (d) => d.toISOString().slice(0, 10)
  return { startDate: iso(new Date(Date.now() - spanDays * DAY_MS)), endDate: iso(new Date()) }
}

async function ownerFor(business) {
  const person = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Retrieval owner' } })
  await prisma.mfaFactor.create({ data: { personId: person.id, type: 'TOTP', secret: 'mfa.v0.sealed-in-test.placeholder.value', status: 'ACTIVE' } })
  return { person, viewer: makeViewer({ principal: { id: person.id, code: person.code, displayName: person.displayName }, ownedBusinessIds: [business.id], visibleBusinessIds: [business.id], visibleDomains: ['customer'] }) }
}

describe('FR-245 chat evidence retrieval (TASK-ZAI-112)', () => {
  it('refuses an AAL1 (or expired-elevation) session before any lookup', async () => {
    const { business } = await freshScope('aal1')
    const { viewer } = await ownerFor(business)
    const aal1 = { ...session, personId: viewer.principal.id, elevatedUntil: null }
    const { startDate, endDate } = todayRange()
    await expect(retrieveArchivedChatEvidence('does-not-matter', { businessId: business.id, startDate, endDate, caseReference: 'DSP-AAL1' }, { viewer, session: aal1, baseDir }))
      .rejects.toMatchObject({ status: 403, message: 'ASSURANCE_LEVEL_INSUFFICIENT' })
  })

  it('refuses a Business the viewer does not own', async () => {
    const { business } = await freshScope('notowner')
    const { person } = await ownerFor(business)
    const strangerViewer = makeViewer({ principal: { id: person.id, code: person.code, displayName: person.displayName }, ownedBusinessIds: [], visibleBusinessIds: [business.id], visibleDomains: ['customer'] })
    const live = { ...session, personId: person.id }
    const { startDate, endDate } = todayRange()
    await expect(retrieveArchivedChatEvidence('does-not-matter', { businessId: business.id, startDate, endDate, caseReference: 'DSP-NOTOWNER' }, { viewer: strangerViewer, session: live, baseDir }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('rejects a request with no case reference before any lookup', async () => {
    const { business } = await freshScope('nocase')
    const { viewer } = await ownerFor(business)
    const live = { ...session, personId: viewer.principal.id }
    const { startDate, endDate } = todayRange()
    await expect(retrieveArchivedChatEvidence('does-not-matter', { businessId: business.id, startDate, endDate, caseReference: '' }, { viewer, session: live, baseDir }))
      .rejects.toThrow()
  })

  it('recovers an archived message grouped by its archived session, with the manifest that proves it, and audits the attempt', async () => {
    const { tenant, business } = await freshScope('recover')
    const { viewer } = await ownerFor(business)
    const live = { ...session, personId: viewer.principal.id }

    const backdated = await backdatedMessage({ tenant, business, ageDays: PAST, text: 'ขอใบเสนอราคาย้อนหลัง' })
    const before = await prisma.message.findUnique({ where: { id: backdated.messageId } })
    expect(before.sessionId).toBeTruthy() // FR-243 assigns one on admission

    await runRetentionSweep({ now: new Date(), baseDir })

    const { startDate, endDate } = todayRange()
    const result = await retrieveArchivedChatEvidence(backdated.customerId, { businessId: business.id, startDate, endDate, caseReference: 'DSP-42' }, { viewer, session: live, baseDir })

    expect(result.missingMessageIds).toEqual([])
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].sessionId).toBe(before.sessionId)
    expect(result.sessions[0].messages).toHaveLength(1)
    expect(result.sessions[0].messages[0].body).toBe('ขอใบเสนอราคาย้อนหลัง')
    expect(result.sessions[0].messages[0].messageId).toBe(backdated.messageId)
    expect(result.manifests).toHaveLength(1)
    expect(result.manifests[0].manifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.manifests[0].fileSha256).toMatch(/^[a-f0-9]{64}$/)

    const audit = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } })
    expect(audit.action).toBe('ARCHIVE_RETRIEVED')
    expect(audit.entityType).toBe('ARCHIVE')
    expect(audit.entityId).toBe(backdated.customerId)
    expect(audit.reason).toBe('DSP-42')
    const payload = JSON.parse(audit.payloadJson)
    expect(payload.messageCount).toBe(1)
    expect(payload.missingMessageIds).toEqual([])
  })

  it('reports missingMessageIds, returns no sessions, and still audits — rather than failing — when the archive file cannot be read from this root', async () => {
    const { tenant, business } = await freshScope('missing')
    const { viewer } = await ownerFor(business)
    const live = { ...session, personId: viewer.principal.id }

    const backdated = await backdatedMessage({ tenant, business, ageDays: PAST, text: 'ข้อความที่กู้คืนไม่ได้ในรอบนี้' })
    await runRetentionSweep({ now: new Date(), baseDir })

    const wrongBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-cea-retrieve-wrong-'))
    const { startDate, endDate } = todayRange()
    const result = await retrieveArchivedChatEvidence(backdated.customerId, { businessId: business.id, startDate, endDate, caseReference: 'DSP-MISSING' }, { viewer, session: live, baseDir: wrongBaseDir })

    expect(result.sessions).toEqual([])
    expect(result.manifests).toEqual([])
    expect(result.missingMessageIds).toEqual([backdated.messageId])

    const audit = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } })
    expect(audit.action).toBe('ARCHIVE_RETRIEVED')
    const payload = JSON.parse(audit.payloadJson)
    expect(payload.messageCount).toBe(0)
    expect(payload.missingMessageIds).toEqual([backdated.messageId])
    await fs.rm(wrongBaseDir, { recursive: true, force: true })
  })

  it('refuses the whole retrieval — nothing decrypted, nothing partially recovered — when the Tenant chain is broken, even though the affected manifest is individually self-consistent', async () => {
    const { tenant, business } = await freshScope('chain-broken')
    const { viewer } = await ownerFor(business)
    const live = { ...session, personId: viewer.principal.id }

    // Two separate sweep runs, so the Tenant has two chained manifests. Both
    // messages share one thread — and so one Customer — so this retrieval
    // must recover both once the chain is intact, and neither once it isn't.
    const threadId = 'TH-CEAR-CHAINBROKEN'
    const first = await backdatedMessage({ tenant, business, ageDays: PAST, threadId, text: 'ข้อความแรกในเชน' })
    await runRetentionSweep({ now: new Date(Date.now() - DAY_MS), baseDir })
    const second = await backdatedMessage({ tenant, business, ageDays: PAST, threadId, text: 'ข้อความที่สองในเชน' })
    await runRetentionSweep({ now: new Date(), baseDir })

    const manifestsBefore = await prisma.archiveManifest.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } })
    expect(manifestsBefore).toHaveLength(2)

    // Simulate the second manifest row being detached from the chain — the
    // shape a deleted-and-reinserted row, or a direct DB edit, would take.
    // The row's OWN fields+hash still reproduce each other (the per-row
    // self-consistency check alone would accept this), but its claimed
    // previousManifestHash no longer names the first manifest's real hash.
    await prisma.archiveManifest.update({
      where: { id: manifestsBefore[1].id },
      data: { previousManifestHash: 'f'.repeat(64), previousManifestId: null },
    })

    const { startDate, endDate } = todayRange()
    const result = await retrieveArchivedChatEvidence(
      first.customerId,
      { businessId: business.id, startDate, endDate, caseReference: 'DSP-CHAIN-BROKEN' },
      { viewer, session: live, baseDir },
    )

    // Nothing recovered — including the FIRST message, whose own manifest is
    // untouched: a broken chain anywhere in the Tenant refuses the whole
    // retrieval, not only the manifest named in the break.
    expect(result.sessions).toEqual([])
    expect(result.manifests).toEqual([])
    expect(result.missingMessageIds.sort()).toEqual([first.messageId, second.messageId].sort())
    expect(result.chainIntegrity).toMatchObject({ valid: false, brokenAtManifestId: manifestsBefore[1].id })

    const audit = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } })
    expect(audit.action).toBe('ARCHIVE_RETRIEVED')
    const payload = JSON.parse(audit.payloadJson)
    expect(payload.messageCount).toBe(0)
    expect(payload.chainIntegrity).toMatchObject({ valid: false, brokenAtManifestId: manifestsBefore[1].id })
  })

  it('returns no sessions and still audits when nothing in range was ever archived', async () => {
    const { tenant, business } = await freshScope('never')
    const { viewer } = await ownerFor(business)
    const live = { ...session, personId: viewer.principal.id }

    const fresh = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'U-cear-never',
      threadId: 'TH-CEAR-NEVER', text: 'ข้อความปัจจุบัน ยังไม่ถูก sweep', externalMessageId: 'MI-CEAR-NEVER',
    })
    const { startDate, endDate } = todayRange()
    const result = await retrieveArchivedChatEvidence(fresh.customerId, { businessId: business.id, startDate, endDate, caseReference: 'DSP-EMPTY' }, { viewer, session: live, baseDir })

    expect(result.sessions).toEqual([])
    expect(result.missingMessageIds).toEqual([])
    expect(result.auditEventId).toBeTruthy()
  })

  it('rejects an unknown Customer id, and a real Customer id from another tenant, the same way (404)', async () => {
    const { business } = await freshScope('404')
    const { viewer } = await ownerFor(business)
    const live = { ...session, personId: viewer.principal.id }

    const other = await freshScope('404-other')
    const otherPerson = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Other tenant customer' } })
    const otherCustomer = await prisma.customer.create({
      data: { code: `CUS-OTHER-${randomUUID().slice(0, 8)}`, tenantId: other.tenant.id, businessId: other.business.id, personId: otherPerson.id, displayName: 'Other tenant customer' },
    })

    const { startDate, endDate } = todayRange()
    await expect(retrieveArchivedChatEvidence(randomUUID(), { businessId: business.id, startDate, endDate, caseReference: 'DSP-404' }, { viewer, session: live, baseDir }))
      .rejects.toMatchObject({ status: 404 })
    await expect(retrieveArchivedChatEvidence(otherCustomer.id, { businessId: business.id, startDate, endDate, caseReference: 'DSP-404' }, { viewer, session: live, baseDir }))
      .rejects.toMatchObject({ status: 404 })
  })
})

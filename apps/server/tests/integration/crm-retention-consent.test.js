// @req FR-022, FR-103, SEC-034 — "consent to retain = keep" (owner ruling 2026-09-27,
//   ADR-093 1.2.0). A sales user records a Customer's advance consent to retention;
//   (Q1) erasing Customer A re-seals, under the legal hold's own key, the lines A's
//   key would shred in a thread whose other member B is under an active hold AND
//   has an active consent — and only then; the hold key dies with the hold, with
//   B's consent, or with B. (Q2) a line past retention whose key Customer is erased
//   is kept only on a consent and otherwise blanked without being archived.
//   Erasure also clears the FR-103 consent note and recorder.
// @spec ADR-093 1.2.0, SEC-034, SDD-103, BR-001
// @tested tests/integration/crm-retention-consent.test.js
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_SALES_REP } from '@/modules/identity/rbac'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { runRetentionSweep } from '@/modules/crm/retention-sweep-service'
import { verifyManifestChain } from '@/modules/crm/chat-evidence-archive-service'
import {
  openArchiveSegment, openCustomerArchiveKey, openHoldArchiveSegment, openLegalHoldArchiveKey,
} from '@/modules/crm/chat-evidence-archive-crypto'
import { recordCustomerLegalHold } from '@/modules/crm/chat-evidence-legal-hold-service'
import { retrieveArchivedChatEvidence } from '@/modules/crm/chat-evidence-retrieval-service'
import { expireChatEvidenceArchive } from '@/modules/crm/chat-evidence-archive-expiry-service'
import { recordCustomerConsent } from '@/modules/crm/customer-consent-service'
import {
  customersWithActiveRetentionConsent, recordCustomerRetentionConsent, revokeCustomerRetentionConsent,
} from '@/modules/crm/customer-retention-consent-service'
import { erasePrincipal } from '@/modules/identity/erase-principal'
import { CUSTOMER_ERASURE_TOMBSTONE } from '@/modules/crm/conversation-redaction-service'
import { RETENTION_SWEEP_TOMBSTONE } from '@/modules/crm/retention-sweep-tombstone'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'

const DAY_MS = 24 * 60 * 60 * 1000
const PAST = RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1
const CHANNEL_ACCOUNT = 'rc-binding'
const CRM = ['customer']
let baseDir

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-retention-consent-'))
})
afterEach(async () => {
  if (baseDir && path.resolve(baseDir).startsWith(path.resolve(os.tmpdir()))) {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

const old = () => new Date(Date.now() - PAST * DAY_MS)
const futureDateOnly = (days) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10)

async function freshScope(label) {
  const suffix = randomUUID().slice(0, 8)
  const pf = await createPortfolio({ name: `RC ${label} ${suffix}`, code: `PF-RC-${suffix}` })
  const tenant = await createTenant({ portfolioId: pf.id, name: `RC ${label} Tenant`, code: `TNT-RC-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'ร้านเก็บหลักฐาน', code: `BUS-RC-${suffix}` })
  return { tenant, business }
}

async function person(label) {
  return prisma.person.create({ data: { code: `PER-RC-${randomUUID().slice(0, 8)}`, displayName: label } })
}

async function ownerFor(business) {
  const owner = await person('Retention owner')
  await prisma.mfaFactor.create({ data: { personId: owner.id, type: 'TOTP', secret: 'mfa.v0.sealed-in-test.placeholder.value', status: 'ACTIVE' } })
  const viewer = makeViewer({ principal: { id: owner.id, code: owner.code, displayName: owner.displayName },
    ownedBusinessIds: [business.id], visibleBusinessIds: [business.id], visibleDomains: CRM })
  const session = { id: randomUUID(), personId: owner.id, status: 'ACTIVE',
    elevatedUntil: new Date(Date.now() + 900_000), expiresAt: new Date(Date.now() + 3600_000) }
  return { viewer, session }
}

async function salesRepFor(business) {
  const rep = await person('Sales rep')
  return makeViewer({ principal: { id: rep.id, code: rep.code, displayName: rep.displayName },
    visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: CRM,
    rolesByBusinessId: { [business.id]: [ROLE_SALES_REP] } })
}

async function memberFor(business) {
  const member = await person('Plain member')
  return makeViewer({ principal: { id: member.id, code: member.code, displayName: member.displayName },
    visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: CRM })
}

async function say({ scope, speaker, thread, text, at = old() }) {
  const result = await ingestLineMessage({
    tenantId: scope.tenant.id, businessId: scope.business.id, channelAccountId: CHANNEL_ACCOUNT,
    lineUserId: speaker, threadId: thread, text, externalMessageId: `MI-RC-${randomUUID().slice(0, 8)}`,
  })
  await prisma.message.update({ where: { id: result.messageId }, data: { createdAt: at } })
  return result
}

/**
 * A group thread A owns (A speaks first), B also speaks, staff post a note; all
 * past retention. A also has one recent line the sweep will not reach yet.
 */
async function scene(scope) {
  const suffix = randomUUID().slice(0, 8)
  const A = `U-rc-a-${suffix}`
  const B = `U-rc-b-${suffix}`
  const group = `C-rc-${suffix}`
  const aLine = await say({ scope, speaker: A, thread: group, text: 'A line kept for B' })
  const bLine = await say({ scope, speaker: B, thread: group, text: 'B own line' })
  const staff = await prisma.message.create({ data: { conversationId: aLine.conversationId, direction: 'OUTBOUND',
    body: 'Staff note in A\'s group', createdAt: old() } })
  const aRecent = await say({ scope, speaker: A, thread: group, text: 'A recent line, not yet swept', at: new Date(Date.now() - DAY_MS) })
  const customerOf = async (subject) => {
    const identity = await prisma.channelIdentity.findFirst({ where: { tenantId: scope.tenant.id, providerSubject: subject } })
    return prisma.customer.findFirst({ where: { tenantId: scope.tenant.id, personId: identity.personId } })
  }
  return {
    customerA: await customerOf(A), customerB: await customerOf(B), B,
    groupConversationId: aLine.conversationId,
    aArchived: { [aLine.messageId]: 'A line kept for B', [staff.id]: 'Staff note in A\'s group' },
    aRecent: { [aRecent.messageId]: 'A recent line, not yet swept' },
    b: { [bLine.messageId]: 'B own line' },
    ids: { aLine: aLine.messageId, staff: staff.id, aRecent: aRecent.messageId, bLine: bLine.messageId },
  }
}

/** Every line of this tenant readable under any still-existing Customer OR legal-hold key. */
async function recoverable(tenantId) {
  const out = new Map()
  const manifests = await prisma.archiveManifest.findMany({ where: { tenantId } })
  for (const manifest of manifests) {
    const lines = (await fs.readFile(path.join(baseDir, manifest.filePath), 'utf8')).trim().split('\n')
    const header = JSON.parse(lines[0])
    for (const raw of lines.slice(1)) {
      const segment = JSON.parse(raw)
      let gz
      if (segment.keyScope === 'LEGAL_HOLD') {
        const row = await prisma.legalHoldArchiveKey.findUnique({ where: { legalHoldId: segment.legalHoldId } })
        if (!row) continue
        const dek = openLegalHoldArchiveKey(row, { legalHoldId: segment.legalHoldId, tenantId })
        gz = openHoldArchiveSegment(segment, { dek, tenantId, legalHoldId: segment.legalHoldId, runId: header.runId })
      } else {
        const row = await prisma.customerArchiveKey.findUnique({ where: { customerId: segment.customerId } })
        if (!row) continue
        const dek = openCustomerArchiveKey(row, { customerId: segment.customerId, tenantId })
        gz = openArchiveSegment(segment, { dek, tenantId, customerId: segment.customerId, runId: header.runId })
      }
      for (const line of gunzipSync(gz).toString('utf8').trim().split('\n')) {
        const archived = JSON.parse(line)
        out.set(archived.messageId, { body: archived.body, scope: segment.keyScope ?? 'CUSTOMER', key: segment.legalHoldId ?? segment.customerId, v: header.v })
      }
    }
  }
  return out
}

const expectReadable = (lines, expected) => { for (const [id, body] of Object.entries(expected)) expect(lines.get(id)?.body, id).toBe(body) }
const expectGone = (lines, expected) => { for (const id of Object.keys(expected)) expect(lines.has(id), id).toBe(false) }

function range() {
  const iso = (d) => d.toISOString().slice(0, 10)
  return { startDate: iso(new Date(Date.now() - (PAST + 5) * DAY_MS)), endDate: iso(new Date()) }
}
const bodiesOf = (result) => Object.fromEntries(result.sessions.flatMap((row) => row.messages).map((line) => [line.messageId, line.body]))

/** B under an active hold, with (or without) a retention consent recorded by a sales rep. */
async function holdB(scope, s, { consent = true } = {}) {
  const { viewer } = await ownerFor(scope.business)
  const hold = await recordCustomerLegalHold(s.customerB.id, { businessId: scope.business.id, reason: 'คดีของ B', endDate: futureDateOnly(400) }, { viewer })
  if (consent) {
    const rep = await salesRepFor(scope.business)
    await recordCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id, note: 'ลูกค้ายินยอมให้เก็บ' }, { viewer: rep })
  }
  return hold
}

describe('retention consent — who records it (FR-022, ADR-093 1.2.0)', () => {
  it('a SALES_REP records it, audited, and a second recording returns the active one', async () => {
    const scope = await freshScope('rep')
    const s = await scene(scope)
    const rep = await salesRepFor(scope.business)

    const first = await recordCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id, note: 'ok' }, { viewer: rep })
    const again = await recordCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: rep })

    expect(first).toMatchObject({ customerId: s.customerB.id, recordedByPersonId: rep.principal.id, revokedAt: null, alreadyActive: false })
    expect(again).toMatchObject({ id: first.id, alreadyActive: true })
    expect(await prisma.customerRetentionConsent.count({ where: { customerId: s.customerB.id } })).toBe(1)
    const audit = await prisma.auditEvent.findUnique({ where: { id: first.auditEventId } })
    expect(audit).toMatchObject({ action: 'CUSTOMER_RETENTION_CONSENT_GRANTED', entityId: s.customerB.id, actorId: rep.principal.id, tenantId: scope.tenant.id })
  })

  it('a Business OWNER records it without a SALES_REP binding', async () => {
    const scope = await freshScope('owner')
    const s = await scene(scope)
    const { viewer } = await ownerFor(scope.business)
    await expect(recordCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer }))
      .resolves.toMatchObject({ customerId: s.customerB.id })
  })

  it('a member without the sales permission is refused 403 and nothing is written', async () => {
    const scope = await freshScope('member')
    const s = await scene(scope)
    const member = await memberFor(scope.business)
    await expect(recordCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: member }))
      .rejects.toMatchObject({ status: 403 })
    await expect(revokeCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: member }))
      .rejects.toMatchObject({ status: 403 })
    expect(await prisma.customerRetentionConsent.count({ where: { customerId: s.customerB.id } })).toBe(0)
  })

  it('is tenant-bound: another tenant\'s sales rep cannot reach the Customer, and a consent is only read in its own tenant', async () => {
    const scope = await freshScope('tenant-1')
    const other = await freshScope('tenant-2')
    const s = await scene(scope)
    const foreignRep = await salesRepFor(other.business)

    await expect(recordCustomerRetentionConsent(s.customerB.id, { businessId: other.business.id }, { viewer: foreignRep }))
      .rejects.toMatchObject({ status: 404 })
    const rep = await salesRepFor(scope.business)
    await recordCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: rep })
    expect([...await customersWithActiveRetentionConsent(prisma, { tenantId: scope.tenant.id, customerIds: [s.customerB.id] })]).toEqual([s.customerB.id])
    expect([...await customersWithActiveRetentionConsent(prisma, { tenantId: other.tenant.id, customerIds: [s.customerB.id] })]).toEqual([])
  })

  it('revoking is audited and ends the consent', async () => {
    const scope = await freshScope('revoke')
    const s = await scene(scope)
    const rep = await salesRepFor(scope.business)
    await recordCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: rep })

    const revoked = await revokeCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: rep })

    expect(revoked).toMatchObject({ customerId: s.customerB.id, revoked: 1 })
    expect(await customersWithActiveRetentionConsent(prisma, { tenantId: scope.tenant.id, customerIds: [s.customerB.id] })).toEqual(new Set())
    const audit = await prisma.auditEvent.findUnique({ where: { id: revoked.auditEventId } })
    expect(audit).toMatchObject({ action: 'CUSTOMER_RETENTION_CONSENT_REVOKED', actorId: rep.principal.id })
  })
})

describe('Q1 — erasing A keeps the evidence of a held, consenting B (ADR-093 1.2.0)', () => {
  it('with hold + consent: A\'s lines and the staff note in A\'s thread are re-sealed under B\'s hold key before A\'s key is destroyed', async () => {
    const scope = await freshScope('q1-keep')
    const { viewer, session } = await ownerFor(scope.business)
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    const hold = await holdB(scope, s)
    const manifestsBefore = await prisma.archiveManifest.count({ where: { tenantId: scope.tenant.id } })

    const erased = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })

    expect(erased.archiveKeys).toEqual([{ customerId: s.customerA.id, keyDestroyed: true, legalHold: null }])
    expect(erased.retainedForLegalHolds).toEqual([{ legalHoldId: hold.legalHoldId, messageCount: 3 }])
    // The unswept line was still tombstoned in the database, as erasure always does.
    expect((await prisma.message.findUnique({ where: { id: s.ids.aRecent } })).body).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    const lines = await recoverable(scope.tenant.id)
    expectReadable(lines, { ...s.aArchived, ...s.aRecent, ...s.b })
    for (const id of [...Object.keys(s.aArchived), ...Object.keys(s.aRecent)]) {
      expect(lines.get(id)).toMatchObject({ scope: 'LEGAL_HOLD', key: hold.legalHoldId, v: 3 })
    }
    // One appended manifest; the chain and every earlier file still verify.
    expect(await prisma.archiveManifest.count({ where: { tenantId: scope.tenant.id } })).toBe(manifestsBefore + 1)
    await expect(verifyManifestChain(prisma, scope.tenant.id, { baseDir, checkFiles: true })).resolves.toEqual({ valid: true })
    // B's retrieval opens the hold key while the hold and consent are active.
    const forB = await retrieveArchivedChatEvidence(s.customerB.id, { businessId: scope.business.id, ...range(), caseReference: 'DSP-B' }, { viewer, session, baseDir })
    expect(bodiesOf(forB)).toEqual({ ...s.b, ...s.aArchived, ...s.aRecent })
  })

  it('with a hold but no consent: A\'s lines are shredded exactly as before and no hold key exists', async () => {
    const scope = await freshScope('q1-no-consent')
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    await holdB(scope, s, { consent: false })
    const manifestsBefore = await prisma.archiveManifest.count({ where: { tenantId: scope.tenant.id } })

    const erased = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })

    expect(erased.retainedForLegalHolds).toEqual([])
    expect(await prisma.legalHoldArchiveKey.count({ where: { tenantId: scope.tenant.id } })).toBe(0)
    expect(await prisma.archiveManifest.count({ where: { tenantId: scope.tenant.id } })).toBe(manifestsBefore)
    const lines = await recoverable(scope.tenant.id)
    expectGone(lines, { ...s.aArchived, ...s.aRecent })
    expectReadable(lines, s.b)
  })

  it('with consent but no active hold, or a consent revoked before the erasure: nothing is kept', async () => {
    const scope = await freshScope('q1-revoked')
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    await holdB(scope, s)
    const rep = await salesRepFor(scope.business)
    await revokeCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: rep })

    const erased = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })

    expect(erased.retainedForLegalHolds).toEqual([])
    expectGone(await recoverable(scope.tenant.id), s.aArchived)

    const scope2 = await freshScope('q1-no-hold')
    const s2 = await scene(scope2)
    await runRetentionSweep({ now: new Date(), baseDir })
    await recordCustomerRetentionConsent(s2.customerB.id, { businessId: scope2.business.id }, { viewer: await salesRepFor(scope2.business) })
    const erased2 = await erasePrincipal({ tenantId: scope2.tenant.id, personId: s2.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })
    expect(erased2.retainedForLegalHolds).toEqual([])
    expectGone(await recoverable(scope2.tenant.id), s2.aArchived)
  })

  it('a consent row carrying another tenant\'s id does not count', async () => {
    const scope = await freshScope('q1-foreign')
    const other = await freshScope('q1-foreign-other')
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    await holdB(scope, s, { consent: false })
    const rep = await person('Foreign recorder')
    await prisma.customerRetentionConsent.create({ data: { tenantId: other.tenant.id, customerId: s.customerB.id, businessId: other.business.id, recordedByPersonId: rep.id } })

    const erased = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })

    expect(erased.retainedForLegalHolds).toEqual([])
    expectGone(await recoverable(scope.tenant.id), s.aArchived)
  })

  it('revoking B\'s consent destroys the hold key in the same transaction; B\'s retrieval no longer returns A\'s lines', async () => {
    const scope = await freshScope('q1-revoke-after')
    const { viewer, session } = await ownerFor(scope.business)
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    const hold = await holdB(scope, s)
    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })
    expect(await prisma.legalHoldArchiveKey.findUnique({ where: { legalHoldId: hold.legalHoldId } })).toBeTruthy()

    const rep = await salesRepFor(scope.business)
    const revoked = await revokeCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: rep })

    expect(revoked.destroyedHoldKeys).toEqual([hold.legalHoldId])
    expect(await prisma.legalHoldArchiveKey.findUnique({ where: { legalHoldId: hold.legalHoldId } })).toBeNull()
    expectGone(await recoverable(scope.tenant.id), { ...s.aArchived, ...s.aRecent })
    const forB = await retrieveArchivedChatEvidence(s.customerB.id, { businessId: scope.business.id, ...range(), caseReference: 'DSP-B2' }, { viewer, session, baseDir })
    expect(bodiesOf(forB)).toEqual(s.b)
  })

  it('the hold ending destroys the hold key at the next expiry run, and the re-seal file can then go', async () => {
    const scope = await freshScope('q1-expiry')
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    const hold = await holdB(scope, s)
    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })

    const stillHeld = await expireChatEvidenceArchive(prisma, { tenantId: scope.tenant.id, now: new Date(), baseDir })
    expect(stillHeld.destroyedHoldKeys).toEqual([])
    const afterHold = await expireChatEvidenceArchive(prisma, { tenantId: scope.tenant.id, now: new Date(Date.now() + 500 * DAY_MS), baseDir })

    expect(afterHold.destroyedHoldKeys).toEqual([hold.legalHoldId])
    expect(await prisma.legalHoldArchiveKey.count({ where: { tenantId: scope.tenant.id } })).toBe(0)
    const reseal = (await prisma.archiveManifest.findMany({ where: { tenantId: scope.tenant.id }, orderBy: { createdAt: 'desc' } }))[0]
    expect(afterHold.deletedFiles).toContain(reseal.id)
  })

  it('erasing B afterwards destroys the hold key too', async () => {
    const scope = await freshScope('q1-erase-b')
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    const hold = await holdB(scope, s)
    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })

    const erasedB = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerB.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })

    expect(erasedB.retainedForLegalHolds).toEqual([])
    expect(await prisma.legalHoldArchiveKey.findUnique({ where: { legalHoldId: hold.legalHoldId } })).toBeNull()
    expect(await customersWithActiveRetentionConsent(prisma, { tenantId: scope.tenant.id, customerIds: [s.customerB.id] })).toEqual(new Set())
    expectGone(await recoverable(scope.tenant.id), { ...s.aArchived, ...s.aRecent })
  })
})

describe('Q2 — a line past retention whose key Customer is erased (ADR-093 1.2.0)', () => {
  /** A erased before anything was swept: the staff note in A's thread is now keyless. */
  async function erasedBeforeSweep(label, { consentB }) {
    const scope = await freshScope(label)
    const s = await scene(scope)
    if (consentB) await recordCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: await salesRepFor(scope.business) })
    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })
    return { scope, s }
  }

  it('a staff line is archived under a consenting live member\'s key', async () => {
    const { scope, s } = await erasedBeforeSweep('q2-staff-keep', { consentB: true })
    const { viewer, session } = await ownerFor(scope.business)

    const sweep = await runRetentionSweep({ now: new Date(), baseDir })

    expect((await prisma.message.findUnique({ where: { id: s.ids.staff } })).body).toBe(RETENTION_SWEEP_TOMBSTONE)
    expect(sweep.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS.blankedWithoutArchive).toBeUndefined()
    const lines = await recoverable(scope.tenant.id)
    expect(lines.get(s.ids.staff)).toMatchObject({ body: 'Staff note in A\'s group', key: s.customerB.id })
    const forB = await retrieveArchivedChatEvidence(s.customerB.id, { businessId: scope.business.id, ...range(), caseReference: 'DSP-Q2' }, { viewer, session, baseDir })
    expect(bodiesOf(forB)).toEqual({ ...s.b, [s.ids.staff]: 'Staff note in A\'s group' })
  })

  it('without any consenting member, the staff line is blanked and never archived', async () => {
    const { scope, s } = await erasedBeforeSweep('q2-staff-blank', { consentB: false })

    const sweep = await runRetentionSweep({ now: new Date(), baseDir })

    expect((await prisma.message.findUnique({ where: { id: s.ids.staff } })).body).toBe(RETENTION_SWEEP_TOMBSTONE)
    expect(sweep.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS).toMatchObject({ blankedWithoutArchive: 1 })
    expect(sweep.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS.deferredErasedKey).toBeUndefined()
    expect((await recoverable(scope.tenant.id)).has(s.ids.staff)).toBe(false)
  })

  it('a consent that was revoked does not keep it', async () => {
    const { scope, s } = await erasedBeforeSweep('q2-staff-revoked', { consentB: true })
    await revokeCustomerRetentionConsent(s.customerB.id, { businessId: scope.business.id }, { viewer: await salesRepFor(scope.business) })

    await runRetentionSweep({ now: new Date(), baseDir })

    expect((await prisma.message.findUnique({ where: { id: s.ids.staff } })).body).toBe(RETENTION_SWEEP_TOMBSTONE)
    expect((await recoverable(scope.tenant.id)).has(s.ids.staff)).toBe(false)
  })

  it('a customer-authored line is kept (left deferred) only while its speaker has an active consent, else blanked', async () => {
    for (const consented of [false, true]) {
      const { scope, s } = await erasedBeforeSweep(`q2-speaker-${consented}`, { consentB: false })
      // A line A wrote that the erasure did not reach (e.g. written by a lagging
      // ingest): keyed to A, who is erased and keyless.
      const identity = await prisma.channelIdentity.findFirst({ where: { tenantId: scope.tenant.id, personId: s.customerA.personId } })
      const late = await prisma.message.create({ data: { conversationId: s.groupConversationId, direction: 'INBOUND',
        body: 'A late line', authorChannelIdentityId: identity.id, createdAt: old() } })
      if (consented) {
        const recorder = await person('Recorder')
        await prisma.customerRetentionConsent.create({ data: { tenantId: scope.tenant.id, customerId: s.customerA.id, businessId: scope.business.id, recordedByPersonId: recorder.id } })
      }

      const sweep = await runRetentionSweep({ now: new Date(), baseDir })

      const counts = sweep.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS
      if (consented) {
        expect((await prisma.message.findUnique({ where: { id: late.id } })).body).toBe('A late line')
        expect(counts.deferredErasedKey).toBeGreaterThanOrEqual(1)
      } else {
        // The sweep spans every tenant; only this run's own tenant can have a deferral yet.
        expect((await prisma.message.findUnique({ where: { id: late.id } })).body).toBe(RETENTION_SWEEP_TOMBSTONE)
        expect(counts.deferredErasedKey).toBeUndefined()
      }
      expect((await recoverable(scope.tenant.id)).has(late.id)).toBe(false)
    }
  })
})

describe('erasure clears consent details (FR-103 side finding, FR-022)', () => {
  it('clears the FR-103 consent note and recorder, and revokes and clears the retention consent', async () => {
    const scope = await freshScope('clear')
    const s = await scene(scope)
    const { viewer } = await ownerFor(scope.business)
    await recordCustomerConsent(s.customerA.id, { businessId: scope.business.id, status: 'GRANTED', note: 'คุยทางโทรศัพท์กับคุณเอ' }, { viewer })
    await recordCustomerRetentionConsent(s.customerA.id, { businessId: scope.business.id, note: 'เอยินยอม' }, { viewer: await salesRepFor(scope.business) })

    const erased = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' }, { archiveBaseDir: baseDir })

    const customer = await prisma.customer.findUnique({ where: { id: s.customerA.id } })
    expect(customer).toMatchObject({ consentStatus: 'GRANTED', consentNote: null, consentRecordedByPersonId: null })
    const rows = await prisma.customerRetentionConsent.findMany({ where: { customerId: s.customerA.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].revokedAt).toBeInstanceOf(Date)
    expect(rows[0].note).toBeNull()
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: s.customerA.id, action: 'CUSTOMER_RETENTION_CONSENT_REVOKED' } })
    expect(audit).toMatchObject({ actorType: 'SYSTEM', reason: 'CUSTOMER_ERASED' })
    expect(erased.retainedForLegalHolds).toEqual([])
  })
})

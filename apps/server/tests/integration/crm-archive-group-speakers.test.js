// @req FR-022, SEC-034 — the chat evidence archive seals each line of a shared LINE
//   group or room thread under its SPEAKER's Customer key (format v2), so erasing one
//   member crypto-shreds exactly that member's archived lines: erasing a later
//   speaker (B) reaches B's lines in the thread the first speaker's (A's) Customer
//   owns, and erasing A no longer shreds B's. The legal hold keeps protecting exactly
//   the held Customer's lines, and a direct chat is sealed exactly as before.
//   The sweep never outlives an erasure: a row erased between its read and the
//   tombstone transaction is never sealed under a new key nor re-tombstoned, and a
//   row with no author is attributed (and written back) before it is sealed.
// @spec ADR-093 D4, D6, D7; SEC-034; SDD-103
// @tested tests/integration/crm-archive-group-speakers.test.js
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { appendOutbound } from '@/modules/crm/reply-record-service'
import { runRetentionSweep } from '@/modules/crm/retention-sweep-service'
import { archiveAndTombstoneTenantMessages } from '@/modules/crm/chat-evidence-archive-service'
import { openArchiveSegment, openCustomerArchiveKey } from '@/modules/crm/chat-evidence-archive-crypto'
import { recordCustomerLegalHold } from '@/modules/crm/chat-evidence-legal-hold-service'
import { retrieveArchivedChatEvidence } from '@/modules/crm/chat-evidence-retrieval-service'
import { erasePrincipal } from '@/modules/identity/erase-principal'
import { CUSTOMER_ERASURE_TOMBSTONE } from '@/modules/crm/conversation-redaction-service'
import { LINE_UNSEND_TOMBSTONE } from '@/modules/crm/line-ingest-service'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'

const DAY_MS = 24 * 60 * 60 * 1000
const PAST = RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1
const CHANNEL_ACCOUNT = 'cea-grp-binding'
let baseDir

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-cea-group-'))
})
afterEach(async () => {
  if (baseDir && path.resolve(baseDir).startsWith(path.resolve(os.tmpdir()))) {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

const old = () => new Date(Date.now() - PAST * DAY_MS)

async function freshScope(label) {
  const suffix = randomUUID().slice(0, 8)
  const pf = await createPortfolio({ name: `CEA-group ${label} ${suffix}`, code: `PF-CEAG-${suffix}` })
  const tenant = await createTenant({ portfolioId: pf.id, name: `CEA-group ${label} Tenant`, code: `TNT-CEAG-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'ร้านกลุ่ม', code: `BUS-CEAG-${suffix}` })
  return { tenant, business }
}

async function say({ scope, speaker, thread, text }) {
  const result = await ingestLineMessage({
    tenantId: scope.tenant.id, businessId: scope.business.id, channelAccountId: CHANNEL_ACCOUNT,
    lineUserId: speaker, threadId: thread, text, externalMessageId: `MI-CEAG-${randomUUID().slice(0, 8)}`,
  })
  await prisma.message.update({ where: { id: result.messageId }, data: { createdAt: old() } })
  return result
}

async function reply({ scope, inboundMessageId, text }) {
  const outbound = await appendOutbound({ tenantId: scope.tenant.id, businessId: scope.business.id,
    channelAccountId: CHANNEL_ACCOUNT, acceptedAt: old().toISOString(), receipt: { inboundMessageId, text, source: 'STACK' } })
  return outbound.messageId
}

/**
 * A group thread: A speaks first (A's Customer owns it), then B; each asks and gets a
 * stack reply, and staff post a note. B also has a direct chat with its own reply.
 * Everything is past the retention window.
 */
async function scene(scope) {
  const suffix = randomUUID().slice(0, 8)
  const A = `U-ceag-a-${suffix}`
  const B = `U-ceag-b-${suffix}`
  const group = `C-ceag-${suffix}`
  const aLine = await say({ scope, speaker: A, thread: group, text: 'A archived group line' })
  const bLine = await say({ scope, speaker: B, thread: group, text: 'B archived group line' })
  const aAsk = await say({ scope, speaker: A, thread: group, text: 'A asks about order A-1' })
  const bAsk = await say({ scope, speaker: B, thread: group, text: 'B asks about order B-1' })
  const aReply = await reply({ scope, inboundMessageId: aAsk.messageId, text: 'Reply to A about order A-1' })
  const bReply = await reply({ scope, inboundMessageId: bAsk.messageId, text: 'Reply to B about order B-1' })
  const staff = await prisma.message.create({ data: { conversationId: aLine.conversationId, direction: 'OUTBOUND',
    body: 'Staff note to the group', createdAt: old() } })
  const bDirect = await say({ scope, speaker: B, thread: B, text: 'B direct archived line' })
  const bDirectReply = await reply({ scope, inboundMessageId: bDirect.messageId, text: 'Direct reply to B' })
  const customerOf = async (subject) => {
    const identity = await prisma.channelIdentity.findFirst({ where: { tenantId: scope.tenant.id, providerSubject: subject } })
    return prisma.customer.findFirst({ where: { tenantId: scope.tenant.id, personId: identity.personId } })
  }
  const customerA = await customerOf(A)
  const customerB = await customerOf(B)
  return {
    customerA, customerB,
    groupConversationId: aLine.conversationId, directConversationId: bDirect.conversationId,
    a: { [aLine.messageId]: 'A archived group line', [aAsk.messageId]: 'A asks about order A-1',
      [aReply]: 'Reply to A about order A-1', [staff.id]: 'Staff note to the group' },
    b: { [bLine.messageId]: 'B archived group line', [bAsk.messageId]: 'B asks about order B-1',
      [bReply]: 'Reply to B about order B-1' },
    bDirect: { [bDirect.messageId]: 'B direct archived line', [bDirectReply]: 'Direct reply to B' },
    ids: { aLine: aLine.messageId, bLine: bLine.messageId, staff: staff.id },
  }
}

/** The retention sweep's own candidate read (retention-sweep-service.js), for a stale-read race. */
function readCandidates(tenantId) {
  return prisma.message.findMany({
    where: { conversation: { tenantId } },
    select: { id: true, conversationId: true, direction: true, body: true, contentKind: true, sessionId: true, createdAt: true,
      externalMessageId: true, authorChannelIdentityId: true,
      conversation: { select: { id: true, customerId: true, businessId: true } },
      attachments: { select: { id: true, kind: true, providerContentId: true, fileAssetId: true, fetchState: true, mimeType: true, sizeBytes: true } } },
  })
}

async function archiveFiles() {
  const files = []
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else files.push(full)
    }
  }
  await walk(baseDir)
  return files
}

/**
 * Every archived line of this tenant that any still-existing archive key can open,
 * straight from the files: messageId → { body, keyCustomerId, customerId, v }.
 */
async function recoverable(tenantId) {
  const out = new Map()
  const manifests = await prisma.archiveManifest.findMany({ where: { tenantId } })
  for (const manifest of manifests) {
    const lines = (await fs.readFile(path.join(baseDir, manifest.filePath), 'utf8')).trim().split('\n')
    const header = JSON.parse(lines[0])
    for (const raw of lines.slice(1)) {
      const segment = JSON.parse(raw)
      const keyRow = await prisma.customerArchiveKey.findUnique({ where: { customerId: segment.customerId } })
      if (!keyRow) continue
      const dek = openCustomerArchiveKey(keyRow, { customerId: segment.customerId, tenantId })
      try {
        const plaintext = gunzipSync(openArchiveSegment(segment, { dek, tenantId, customerId: segment.customerId, runId: header.runId })).toString('utf8')
        for (const line of plaintext.trim().split('\n')) {
          const archived = JSON.parse(line)
          out.set(archived.messageId, { body: archived.body, keyCustomerId: segment.customerId, customerId: archived.customerId, v: header.v })
        }
      } finally {
        dek.fill(0)
      }
    }
  }
  return out
}

function expectReadable(lines, expected) {
  for (const [id, body] of Object.entries(expected)) expect(lines.get(id)?.body, id).toBe(body)
}

function expectGone(lines, expected) {
  for (const id of Object.keys(expected)) expect(lines.has(id), id).toBe(false)
}

async function ownerFor(business) {
  const person = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Group archive owner' } })
  await prisma.mfaFactor.create({ data: { personId: person.id, type: 'TOTP', secret: 'mfa.v0.sealed-in-test.placeholder.value', status: 'ACTIVE' } })
  const viewer = makeViewer({ principal: { id: person.id, code: person.code, displayName: person.displayName },
    ownedBusinessIds: [business.id], visibleBusinessIds: [business.id], visibleDomains: ['customer'] })
  const session = { id: randomUUID(), personId: person.id, status: 'ACTIVE',
    elevatedUntil: new Date(Date.now() + 900_000), expiresAt: new Date(Date.now() + 3600_000) }
  return { viewer, session }
}

function range() {
  const iso = (d) => d.toISOString().slice(0, 10)
  return { startDate: iso(new Date(Date.now() - (PAST + 5) * DAY_MS)), endDate: iso(new Date()) }
}

const futureDateOnly = (days) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10)

describe('chat evidence archive in a shared LINE group thread (FR-022, SEC-034)', () => {
  it('erasing a later speaker (B) makes B\'s archived group lines unrecoverable and leaves A\'s readable', async () => {
    const scope = await freshScope('erase-b')
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    expectReadable(await recoverable(scope.tenant.id), { ...s.a, ...s.b, ...s.bDirect })

    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerB.personId, reason: 'TEST_ERASURE' })

    const after = await recoverable(scope.tenant.id)
    expectGone(after, { ...s.b, ...s.bDirect })
    expectReadable(after, s.a)
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: s.customerA.id } })).toBeTruthy()
  })

  it('erasing the first speaker (A) shreds A\'s archived lines and leaves B\'s readable', async () => {
    const scope = await freshScope('erase-a')
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })

    const result = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' })

    expect(result.archiveKeys).toEqual([{ customerId: s.customerA.id, keyDestroyed: true, legalHold: null }])
    const after = await recoverable(scope.tenant.id)
    expectGone(after, s.a)
    expectReadable(after, { ...s.b, ...s.bDirect })
  })

  it('a legal hold on B keeps exactly B\'s archived lines through both erasures', async () => {
    const scope = await freshScope('hold-b')
    const { viewer } = await ownerFor(scope.business)
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    await recordCustomerLegalHold(s.customerB.id, { businessId: scope.business.id, reason: 'ข้อพิพาทของ B', endDate: futureDateOnly(400) }, { viewer })

    const erasedA = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' })
    const erasedB = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerB.personId, reason: 'TEST_ERASURE' })

    expect(erasedA.archiveKeys).toEqual([{ customerId: s.customerA.id, keyDestroyed: true, legalHold: null }])
    expect(erasedB.archiveKeys[0]).toMatchObject({ customerId: s.customerB.id, keyDestroyed: false, legalHold: { reason: 'ข้อพิพาทของ B' } })
    const after = await recoverable(scope.tenant.id)
    expectReadable(after, { ...s.b, ...s.bDirect })
    expectGone(after, s.a)
  })

  it('seals a direct chat under its own Customer\'s key exactly as before, in the segment that also carries that speaker\'s group lines', async () => {
    const scope = await freshScope('direct')
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })

    const lines = await recoverable(scope.tenant.id)
    for (const id of Object.keys(s.bDirect)) {
      expect(lines.get(id)).toMatchObject({ keyCustomerId: s.customerB.id, customerId: s.customerB.id, v: 2 })
    }
    // Group lines still name the thread's owner as their Customer; only the key moved.
    for (const id of Object.keys(s.b)) {
      expect(lines.get(id)).toMatchObject({ keyCustomerId: s.customerB.id, customerId: s.customerA.id })
    }
    for (const id of Object.keys(s.a)) {
      expect(lines.get(id)).toMatchObject({ keyCustomerId: s.customerA.id, customerId: s.customerA.id })
    }
    // Erasing B still destroys B's direct archive, as the direct-chat path always has.
    const result = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerB.personId, reason: 'TEST_ERASURE' })
    expect(result.archiveKeys).toEqual([{ customerId: s.customerB.id, keyDestroyed: true, legalHold: null }])
    expectGone(await recoverable(scope.tenant.id), s.bDirect)
  })

  it('retrieval recovers a group thread across its members\' keys, and a member\'s own lines in a thread someone else owns', async () => {
    const scope = await freshScope('retrieve')
    const { viewer, session } = await ownerFor(scope.business)
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })

    const bodiesOf = (result) => Object.fromEntries(result.sessions.flatMap((row) => row.messages).map((line) => [line.messageId, line.body]))
    const forA = await retrieveArchivedChatEvidence(s.customerA.id, { businessId: scope.business.id, ...range(), caseReference: 'DSP-GRP-A' }, { viewer, session, baseDir })
    expect(forA.missingMessageIds).toEqual([])
    expect(bodiesOf(forA)).toEqual({ ...s.a, ...s.b })

    const forB = await retrieveArchivedChatEvidence(s.customerB.id, { businessId: scope.business.id, ...range(), caseReference: 'DSP-GRP-B' }, { viewer, session, baseDir })
    expect(forB.missingMessageIds).toEqual([])
    expect(bodiesOf(forB)).toEqual({ ...s.b, ...s.bDirect })
  })

  it('retrieval still reads a group line an owner-keyed (pre-v2) archive sealed under the thread owner\'s key', async () => {
    const scope = await freshScope('legacy')
    const { viewer, session } = await ownerFor(scope.business)
    const s = await scene(scope)
    // Candidates without the author column seal exactly as v1 did: under the thread owner.
    const candidates = (await prisma.message.findMany({
      where: { conversation: { tenantId: scope.tenant.id } },
      select: { id: true, conversationId: true, direction: true, body: true, contentKind: true, sessionId: true, createdAt: true,
        externalMessageId: true, conversation: { select: { id: true, customerId: true, businessId: true } }, attachments: true },
    }))
    await archiveAndTombstoneTenantMessages(prisma, { tenantId: scope.tenant.id, candidates, now: new Date(), baseDir })
    const lines = await recoverable(scope.tenant.id)
    for (const id of Object.keys(s.b)) expect(lines.get(id)).toMatchObject({ keyCustomerId: s.customerA.id })

    const forB = await retrieveArchivedChatEvidence(s.customerB.id, { businessId: scope.business.id, ...range(), caseReference: 'DSP-GRP-LEGACY' }, { viewer, session, baseDir })
    expect(forB.missingMessageIds).toEqual([])
    expect(Object.fromEntries(forB.sessions.flatMap((row) => row.messages).map((line) => [line.messageId, line.body])))
      .toEqual({ ...s.b, ...s.bDirect })
  })

  it('never seals or re-tombstones a speaker erased between the sweep read and its seal', async () => {
    const scope = await freshScope('race-erasure')
    const s = await scene(scope)
    const stale = await readCandidates(scope.tenant.id)

    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerB.personId, reason: 'TEST_ERASURE' })
    const result = await archiveAndTombstoneTenantMessages(prisma, { tenantId: scope.tenant.id, candidates: stale, now: new Date(), baseDir })

    // B's five lines are deferred: no key minted for the erased Customer, nothing sealed.
    expect(result).toMatchObject({ archived: true, deferredMessages: 5 })
    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: s.customerB.id } })).toBeNull()
    for (const id of Object.keys({ ...s.b, ...s.bDirect })) {
      expect((await prisma.message.findUnique({ where: { id } })).body, id).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    }
    const lines = await recoverable(scope.tenant.id)
    expectGone(lines, { ...s.b, ...s.bDirect })
    expectReadable(lines, s.a)
  })

  it('rolls back and deletes its file when a candidate loses its content before the tombstone commits', async () => {
    const scope = await freshScope('race-unsend')
    const s = await scene(scope)
    const stale = await readCandidates(scope.tenant.id)
    await prisma.message.update({ where: { id: s.ids.aLine }, data: { body: LINE_UNSEND_TOMBSTONE } })

    await expect(archiveAndTombstoneTenantMessages(prisma, { tenantId: scope.tenant.id, candidates: stale, now: new Date(), baseDir }))
      .rejects.toMatchObject({ code: 'ARCHIVE_CANDIDATES_CHANGED' })

    expect(await prisma.archiveManifest.count({ where: { tenantId: scope.tenant.id } })).toBe(0)
    expect((await archiveFiles()).filter((file) => file.endsWith('.zca'))).toEqual([])
    expect((await prisma.message.findUnique({ where: { id: s.ids.aLine } })).body).toBe(LINE_UNSEND_TOMBSTONE)
    expect((await prisma.message.findUnique({ where: { id: s.ids.bLine } })).body).toBe('B archived group line')
  })

  it('attributes a group line with no author before sealing it, so it follows its speaker', async () => {
    const scope = await freshScope('null-author')
    const s = await scene(scope)
    await prisma.message.update({ where: { id: s.ids.bLine }, data: { authorChannelIdentityId: null } })
    const bIdentity = await prisma.channelIdentity.findFirst({ where: { tenantId: scope.tenant.id, personId: s.customerB.personId } })

    await runRetentionSweep({ now: new Date(), baseDir })

    expect((await prisma.message.findUnique({ where: { id: s.ids.bLine } })).authorChannelIdentityId).toBe(bIdentity.id)
    expect((await recoverable(scope.tenant.id)).get(s.ids.bLine)).toMatchObject({ keyCustomerId: s.customerB.id })

    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' })
    expectReadable(await recoverable(scope.tenant.id), { [s.ids.bLine]: 'B archived group line' })
    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerB.personId, reason: 'TEST_ERASURE' })
    expectGone(await recoverable(scope.tenant.id), { [s.ids.bLine]: true })
  })

  it('retrieval never mints a key for an erased Customer, and still returns the other members lines', async () => {
    const scope = await freshScope('retrieve-erased')
    const { viewer, session } = await ownerFor(scope.business)
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerA.personId, reason: 'TEST_ERASURE' })

    const forA = await retrieveArchivedChatEvidence(s.customerA.id, { businessId: scope.business.id, ...range(), caseReference: 'DSP-GRP-ERASED' }, { viewer, session, baseDir })

    expect(await prisma.customerArchiveKey.findUnique({ where: { customerId: s.customerA.id } })).toBeNull()
    expect(Object.fromEntries(forA.sessions.flatMap((row) => row.messages).map((line) => [line.messageId, line.body]))).toEqual(s.b)
    // The staff note was sealed under A's destroyed key.
    expect(forA.missingMessageIds).toEqual([s.ids.staff])
  })

  it('is idempotent: erasing B again changes no key and no recoverable line', async () => {
    const scope = await freshScope('idempotent')
    const s = await scene(scope)
    await runRetentionSweep({ now: new Date(), baseDir })
    await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerB.personId, reason: 'TEST_ERASURE' })
    const before = await recoverable(scope.tenant.id)
    const keysBefore = await prisma.customerArchiveKey.findMany({ where: { tenantId: scope.tenant.id }, orderBy: { customerId: 'asc' } })

    const second = await erasePrincipal({ tenantId: scope.tenant.id, personId: s.customerB.personId, reason: 'TEST_ERASURE' })

    expect(second.archiveKeys).toEqual([{ customerId: s.customerB.id, keyDestroyed: false, legalHold: null }])
    expect(await prisma.customerArchiveKey.findMany({ where: { tenantId: scope.tenant.id }, orderBy: { customerId: 'asc' } })).toEqual(keysBefore)
    const after = await recoverable(scope.tenant.id)
    expect(after).toEqual(before)
    expectGone(after, { ...s.b, ...s.bDirect })
    expectReadable(after, s.a)
  })
})

// @req FR-236 — TASK-ZAI-099: LINE FAQ knowledge candidates are off by
//   default per Business (ADR-090 D6, revised 2026-09-14: owner decision),
//   and the switch that turns them on is OWNER-scoped, expected-version CAS,
//   and audited with who asked, when, and for which Business.
// @spec ADR-090 D6; BR-001; SEC-003
// @tested tests/integration/fr236-knowledge-candidates-business-toggle.test.js
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { setKnowledgeCandidatesEnabled } from '@/modules/business/application/business-knowledge-candidates-service'
import { businessHasKnowledgeCandidatesEnabled } from '@/lib/business-knowledge-candidates'
import { draftKnowledgeCandidate } from '@/modules/knowledge/application/knowledge-candidate-service'

const saved = {}
let portfolio, tenant, business
let owner, memberNoRole

async function person(code) {
  return prisma.person.create({ data: { id: randomUUID(), code: `PER-KCT-${code}-${randomUUID().slice(0, 6)}`, displayName: `Person ${code}` } })
}
async function viewerFor(personRow, over) {
  return makeViewer({ ...over, principal: { id: personRow.id, code: personRow.code, displayName: personRow.displayName } })
}

async function draftAConversation(suffix) {
  const result = await ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, lineUserId: `Ukct${suffix}`, displayName: `ลูกค้า ${suffix}`,
    threadId: `TH-KCT-${suffix}`, text: 'สอบถามค่าจัดส่ง', externalMessageId: `MSG-KCT-${suffix}`,
  })
  await prisma.customer.update({ where: { id: result.customerId }, data: { consentStatus: 'GRANTED' } })
  return result
}

const CLEAN = { question: 'ค่าจัดส่งไปต่างจังหวัดเท่าไหร่', answer: 'ค่าจัดส่งมาตรฐานคือ 50 บาท (Product.code: SHIP-STD)' }

describe('FR-236 Business.knowledgeCandidatesEnabled toggle and draft gate (TASK-ZAI-099)', () => {
  beforeAll(async () => {
    for (const name of ['ZURI_KNOWLEDGE_ENABLED', 'ZURI_KNOWLEDGE_BINDINGS', 'MSP_PIPELINE_PRINCIPALS', 'ZURI_MSP_COMMAND']) saved[name] = process.env[name]
    const suffix = randomUUID().slice(0, 8)
    portfolio = await createPortfolio({ name: `KCT portfolio ${suffix}`, code: `KCT-PF-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `KCT tenant ${suffix}`, code: `KCT-TN-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `KCT business ${suffix}`, code: `KCT-BU-${suffix}` })

    const scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: 'workspace-kct', agentId: 'agent-kct', visibility: 'private' }
    process.env.ZURI_KNOWLEDGE_ENABLED = '1'
    process.env.ZURI_KNOWLEDGE_BINDINGS = JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }])
    process.env.MSP_PIPELINE_PRINCIPALS = JSON.stringify([{ role: 'source', credential: 'test-credential', scope }])
    process.env.ZURI_MSP_COMMAND = process.execPath

    const ownerPerson = await person('OWNER')
    const memberPerson = await person('MEMBER')
    await prisma.membership.create({ data: { personId: ownerPerson.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' } })
    await prisma.membership.create({ data: { personId: memberPerson.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: JSON.stringify(['customer', 'knowledge']) } })

    owner = await viewerFor(ownerPerson, { visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: [...VIEWER_DOMAINS] })
    memberNoRole = await viewerFor(memberPerson, { visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['customer', 'knowledge'] })
  })

  afterAll(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await prisma.$disconnect()
  })

  it('a freshly created Business defaults knowledgeCandidatesEnabled to false — no flag row does not mean true, and reading it never throws', async () => {
    const row = await prisma.business.findUnique({ where: { id: business.id } })
    expect(row.knowledgeCandidatesEnabled).toBe(false)
    expect(businessHasKnowledgeCandidatesEnabled(row)).toBe(false)
  })

  it('an OWNER drafting against a disabled Business is refused KNOWLEDGE_CANDIDATES_DISABLED, before any role check', async () => {
    const drafted = await draftAConversation('owner-off')
    await expect(
      draftKnowledgeCandidate({ businessId: business.id, conversationId: drafted.conversationId, messageIds: [drafted.messageId], ...CLEAN }, { viewer: owner }),
    ).rejects.toMatchObject({ status: 403, code: 'KNOWLEDGE_CANDIDATES_DISABLED' })
  })

  it('an ordinary MEMBER (no OWNER/LINE_OA_PUBLISHER authority) gets the exact same refusal as the OWNER did — the flag check leaks nothing about authority', async () => {
    const drafted = await draftAConversation('member-off')
    let ownerError, memberError
    try {
      await draftKnowledgeCandidate({ businessId: business.id, conversationId: drafted.conversationId, messageIds: [drafted.messageId], ...CLEAN }, { viewer: owner })
    } catch (error) { ownerError = error }
    try {
      await draftKnowledgeCandidate({ businessId: business.id, conversationId: drafted.conversationId, messageIds: [drafted.messageId], ...CLEAN }, { viewer: memberNoRole })
    } catch (error) { memberError = error }
    expect(ownerError).toMatchObject({ status: 403, code: 'KNOWLEDGE_CANDIDATES_DISABLED' })
    expect(memberError).toMatchObject({ status: 403, code: 'KNOWLEDGE_CANDIDATES_DISABLED' })
    expect(memberError.message).toBe(ownerError.message)
  })

  it('refuses the toggle from a non-owner (400) and from a viewer who does not own this Business (400)', async () => {
    const row = await prisma.business.findUnique({ where: { id: business.id } })
    await expect(
      setKnowledgeCandidatesEnabled(business.id, { version: row.version, enabled: true, requestedBy: 'Owen' }, { viewer: memberNoRole }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      setKnowledgeCandidatesEnabled(business.id, { version: row.version, enabled: true, requestedBy: 'Owen' }, { viewer: ownsElsewhere() }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a stale version (409) and writes nothing', async () => {
    const row = await prisma.business.findUnique({ where: { id: business.id } })
    // +1, not -1: at this point in the suite the Business is still at its
    // original version 1, and -1 would be 0 — a shape zod's own
    // `.positive()` refuses before the CAS check ever runs. Any mismatched
    // version (higher or lower) exercises the same compare-and-set conflict.
    await expect(
      setKnowledgeCandidatesEnabled(business.id, { version: row.version + 1, enabled: true, requestedBy: 'Owen' }, { viewer: owner }),
    ).rejects.toMatchObject({ status: 409 })
    expect(businessHasKnowledgeCandidatesEnabled(await prisma.business.findUnique({ where: { id: business.id } }))).toBe(false)
  })

  it('requires requestedBy — TASK-ZAI-099 asks for "who asked", not only who acted', async () => {
    const row = await prisma.business.findUnique({ where: { id: business.id } })
    await expect(
      setKnowledgeCandidatesEnabled(business.id, { version: row.version, enabled: true }, { viewer: owner }),
    ).rejects.toThrow()
  })

  it('an OWNER turns the flag on, bumps version, and records one AuditEvent with who asked, when, and which Business', async () => {
    const before = await prisma.business.findUnique({ where: { id: business.id } })
    const beforeAudit = new Date()
    const result = await setKnowledgeCandidatesEnabled(
      business.id,
      { version: before.version, enabled: true, requestedBy: 'Owen', reason: "owner's instruction 2026-09-14: enable for this Business" },
      { viewer: owner },
    )
    expect(result.knowledgeCandidatesEnabled).toBe(true)
    expect(result.version).toBe(before.version + 1)

    const row = await prisma.business.findUnique({ where: { id: business.id } })
    expect(businessHasKnowledgeCandidatesEnabled(row)).toBe(true)
    expect(row.version).toBe(before.version + 1)

    const event = await prisma.auditEvent.findFirst({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'KNOWLEDGE_CANDIDATES_ENABLED_CHANGED' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(event).toBeTruthy()
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(beforeAudit.getTime() - 1000) // recorded with its date
    expect(event.actorId).toBe(owner.principal.id)
    const payload = JSON.parse(event.payloadJson)
    expect(payload).toMatchObject({ from: false, to: true, requestedBy: 'Owen' }) // recorded with who asked
  })

  it('setting the same value again is a no-op: no version bump, no new AuditEvent', async () => {
    const before = await prisma.business.findUnique({ where: { id: business.id } })
    const countBefore = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS', entityId: business.id, action: 'KNOWLEDGE_CANDIDATES_ENABLED_CHANGED' } })
    const result = await setKnowledgeCandidatesEnabled(business.id, { version: before.version, enabled: true, requestedBy: 'Owen' }, { viewer: owner })
    expect(result.version).toBe(before.version)
    const countAfter = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS', entityId: business.id, action: 'KNOWLEDGE_CANDIDATES_ENABLED_CHANGED' } })
    expect(countAfter).toBe(countBefore)
  })

  it('once enabled, drafting reaches the existing role check instead of the flag (a MEMBER with no OWNER/LINE_OA_PUBLISHER authority is now refused KNOWLEDGE_CANDIDATE_FORBIDDEN, not KNOWLEDGE_CANDIDATES_DISABLED)', async () => {
    const drafted = await draftAConversation('member-on')
    await expect(
      draftKnowledgeCandidate({ businessId: business.id, conversationId: drafted.conversationId, messageIds: [drafted.messageId], ...CLEAN }, { viewer: memberNoRole }),
    ).rejects.toMatchObject({ status: 403, code: 'KNOWLEDGE_CANDIDATE_FORBIDDEN' })
  })

  it('once enabled, an OWNER drafts successfully', async () => {
    const drafted = await draftAConversation('owner-on')
    const result = await draftKnowledgeCandidate({ businessId: business.id, conversationId: drafted.conversationId, messageIds: [drafted.messageId], ...CLEAN }, { viewer: owner })
    expect(result).toMatchObject({ status: 'PENDING_REVIEW', businessId: business.id })
  })
})

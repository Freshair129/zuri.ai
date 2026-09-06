import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeDevViewer, makeViewer, ownsElsewhere } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { recordCustomerConsent } from '@/modules/crm/customer-consent-service'
import { recordConversationAnalysis, getConversationAnalyses } from '@/modules/crm/conversation-analysis-service'
import { erasePrincipal } from '@/modules/identity/erase-principal'
import { exportSnapshot, importSnapshot } from '@/modules/project-manager/application/backup-service'

// @req FR-127 — a consent-gated analysis belongs to the internal Conversation
// identity and can be read back as a projected CRM record.
// @spec ADR-054 D3-D6, BR-001, SEC-005
// @tested tests/integration/crm-conversation-analysis.test.js

let tenant
let business
let siblingBusiness
let otherTenant
let otherBusiness
let conversationId
let customerId

async function ownerOf(...businessIds) {
  const person = await prisma.person.create({
    data: { id: randomUUID(), code: `PER-ANALYSIS-${randomUUID().slice(0, 8)}`, displayName: 'Analysis owner' },
  })
  return makeViewer({
    role: 'OWNER',
    visibleBusinessIds: businessIds,
    ownedBusinessIds: businessIds,
    // @req FR-061 — every domain, which is what an OWNER Membership derives from its
    // role per Membership (SDD-034). Stated because `recordCustomerConsent`, used in
    // this suite's setup, now asks for the `customer` grant.
    visibleDomains: [...VIEWER_DOMAINS],
    principal: { id: person.id, code: person.code, displayName: person.displayName },
  })
}

describe('ConversationAnalysis persistence and projected reads (FR-127)', () => {
  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8)
    const portfolio = await createPortfolio({ name: `Analysis Group ${suffix}`, code: `PF-ANALYSIS-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `Analysis Tenant ${suffix}`, code: `TNT-ANALYSIS-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `Analysis Business ${suffix}`, code: `BUS-ANALYSIS-${suffix}` })
    siblingBusiness = await createBusiness({ tenantId: tenant.id, name: `Analysis Sibling ${suffix}`, code: `BUS-ANALYSIS-SIBLING-${suffix}` })

    const otherPortfolio = await createPortfolio({ name: `Other Analysis Group ${suffix}`, code: `PF-ANALYSIS-OTHER-${suffix}` })
    otherTenant = await createTenant({ portfolioId: otherPortfolio.id, name: `Other Analysis Tenant ${suffix}`, code: `TNT-ANALYSIS-OTHER-${suffix}` })
    otherBusiness = await createBusiness({ tenantId: otherTenant.id, name: `Other Analysis Business ${suffix}`, code: `BUS-ANALYSIS-OTHER-${suffix}` })

    const ingested = await ingestLineMessage({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: `U-analysis-${suffix}`,
      displayName: 'Analysis customer',
      threadId: `TH-analysis-${suffix}`,
      text: 'สนใจสินค้า',
      externalMessageId: `MSG-analysis-${suffix}`,
    })
    conversationId = ingested.conversationId
    customerId = ingested.customerId

    await recordCustomerConsent(
      ingested.customerId,
      { businessId: business.id, status: 'GRANTED', note: 'analysis test consent' },
      { viewer: await ownerOf(business.id) },
    )
  })

  it('persists separate internal conversation analysis runs and omits raw output from reads and audit', async () => {
    const viewer = await ownerOf(business.id)
    const first = await recordConversationAnalysis(
      conversationId,
      {
        analyzedDate: '2026-08-30T00:00:00.000Z',
        analyzedAt: '2026-08-30T09:00:00.000Z',
        contactType: 'NEW_LEAD',
        state: 'HOT',
        cta: 'ส่งใบเสนอราคา',
        tags: ['pricing', 'urgent'],
        summary: 'ลูกค้าขอราคา',
        rawOutputJson: JSON.stringify({ secret: 'do-not-leak' }),
      },
      { viewer },
    )
    const second = await recordConversationAnalysis(
      conversationId,
      {
        analyzedDate: '2026-08-30T00:00:00.000Z',
        analyzedAt: '2026-08-30T10:00:00.000Z',
        contactType: 'RETURNING',
        state: 'WARM',
        cta: null,
        tags: ['follow-up'],
        summary: 'ลูกค้ากลับมาสอบถาม',
        rawOutputJson: JSON.stringify({ followUp: true }),
      },
      { viewer },
    )

    expect(first.conversationId).toBe(conversationId)
    expect(second.conversationId).toBe(conversationId)
    expect(first.id).not.toBe(second.id)
    const result = await getConversationAnalyses({ viewer, businessId: business.id, conversationId })
    expect(result.analyses).toHaveLength(2)
    expect(result.analyses.map((row) => row.contactType)).toEqual(['NEW_LEAD', 'RETURNING'])
    expect(result.analyses[0]).not.toHaveProperty('rawOutputJson')

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'CONVERSATION_ANALYSIS', entityId: first.id },
    })
    expect(events).toHaveLength(1)
    expect(events[0].payloadJson).not.toContain('do-not-leak')
    expect(events[0].payloadJson).not.toContain('ลูกค้าขอราคา')
  })

  it('allows a visible Member to read but requires Business ownership to write', async () => {
    const member = makeViewer({ role: 'MEMBER', visibleBusinessIds: [business.id], ownedBusinessIds: [] })
    const before = await prisma.conversationAnalysis.count({ where: { conversationId } })
    const auditBefore = await countAnalysisAuditsForConversation(conversationId)
    const read = await getConversationAnalyses({ viewer: member, businessId: business.id, conversationId })
    expect(read.analyses).toHaveLength(2)

    await expect(recordConversationAnalysis(conversationId, analysisInput(), { viewer: member })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.conversationAnalysis.count({ where: { conversationId } })).toBe(before)
    expect(await countAnalysisAuditsForConversation(conversationId)).toBe(auditBefore)
  })

  it('does not let ownership elsewhere write a visible Business-bound Conversation', async () => {
    const attacker = ownsElsewhere({ owns: siblingBusiness.id, sees: business.id })
    const auditBefore = await countAnalysisAuditsForConversation(conversationId)
    await expect(recordConversationAnalysis(conversationId, analysisInput(), { viewer: attacker })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.conversationAnalysis.count({ where: { conversationId } })).toBe(2)
    expect(await countAnalysisAuditsForConversation(conversationId)).toBe(auditBefore)
  })

  it('rejects scope overrides, invalid enums and invalid raw JSON before persistence', async () => {
    const viewer = await ownerOf(business.id)
    const base = analysisInput()
    await expect(recordConversationAnalysis(conversationId, { ...base, tenantId: otherTenant.id }, { viewer })).rejects.toThrow()
    await expect(recordConversationAnalysis(conversationId, { ...base, contactType: 'SPAM' }, { viewer })).rejects.toThrow()
    await expect(recordConversationAnalysis(conversationId, { ...base, rawOutputJson: '{bad' }, { viewer })).rejects.toThrow(/valid JSON/)
    expect(await prisma.conversationAnalysis.count({ where: { conversationId } })).toBe(2)
  })

  it('requires current consent for writes and reads, including after revocation', async () => {
    const suffix = randomUUID().slice(0, 8)
    const ingested = await ingestLineMessage({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: `U-analysis-consent-${suffix}`,
      threadId: `TH-analysis-consent-${suffix}`,
      text: 'no consent yet',
    })
    const viewer = await ownerOf(business.id)
    const auditBefore = await countAnalysisAuditsForConversation(ingested.conversationId)
    await expect(recordConversationAnalysis(ingested.conversationId, analysisInput(), { viewer })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: ingested.conversationId } })).toBe(0)
    expect(await countAnalysisAuditsForConversation(ingested.conversationId)).toBe(auditBefore)

    await recordCustomerConsent(ingested.customerId, { businessId: business.id, status: 'GRANTED' }, { viewer })
    await recordConversationAnalysis(ingested.conversationId, analysisInput(), { viewer })
    await recordCustomerConsent(ingested.customerId, { businessId: business.id, status: 'DECLINED' }, { viewer })

    await expect(getConversationAnalyses({ viewer, businessId: business.id, conversationId: ingested.conversationId })).rejects.toMatchObject({ status: 404 })
    await expect(recordConversationAnalysis(ingested.conversationId, analysisInput(), { viewer })).rejects.toMatchObject({ status: 404 })
    // Revocation hides and blocks the row; it does not pretend the derived data
    // was never persisted, so a later approved recomputation can replace it.
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: ingested.conversationId } })).toBe(1)
    expect(await countAnalysisAuditsForConversation(ingested.conversationId)).toBe(1)
  })

  it('keeps tenant and Business visibility isolated even when external thread ids match', async () => {
    const suffix = randomUUID().slice(0, 8)
    const first = await ingestLineMessage({
      tenantId: tenant.id,
      businessId: siblingBusiness.id,
      lineUserId: `U-analysis-sibling-${suffix}`,
      threadId: `TH-same-external-${suffix}`,
      text: 'sibling',
    })
    const second = await ingestLineMessage({
      tenantId: otherTenant.id,
      businessId: otherBusiness.id,
      lineUserId: `U-analysis-other-${suffix}`,
      threadId: `TH-same-external-${suffix}`,
      text: 'other tenant',
    })
    const siblingOwner = await ownerOf(siblingBusiness.id)
    const otherOwner = await ownerOf(otherBusiness.id)
    await recordCustomerConsent(first.customerId, { businessId: siblingBusiness.id, status: 'GRANTED' }, { viewer: siblingOwner })
    await recordCustomerConsent(second.customerId, { businessId: otherBusiness.id, status: 'GRANTED' }, { viewer: otherOwner })
    const firstAnalysis = await recordConversationAnalysis(first.conversationId, analysisInput(), { viewer: siblingOwner })
    const secondAnalysis = await recordConversationAnalysis(second.conversationId, analysisInput(), { viewer: otherOwner })
    expect(firstAnalysis.conversationId).not.toBe(secondAnalysis.conversationId)
    expect(firstAnalysis.id).not.toBe(secondAnalysis.id)
    await expect(getConversationAnalyses({ viewer: await ownerOf(business.id), businessId: business.id, conversationId: second.conversationId })).rejects.toMatchObject({ status: 404 })
    expect((await getConversationAnalyses({ viewer: otherOwner, businessId: otherBusiness.id, conversationId: second.conversationId })).analyses).toHaveLength(1)
  })

  it('correlates each owned Business with its tenant before allowing a write', async () => {
    const suffix = randomUUID().slice(0, 8)
    const viewer = await ownerOf(business.id, otherBusiness.id)
    const person = await prisma.person.create({ data: { id: randomUUID(), code: `PER-ANALYSIS-PAIR-${suffix}`, displayName: 'Pair mismatch' } })
    const customer = await prisma.customer.create({
      data: { code: `CUS-ANALYSIS-PAIR-${suffix}`, tenantId: tenant.id, businessId: business.id, personId: person.id, displayName: 'Pair mismatch customer', consentStatus: 'GRANTED' },
    })
    const malformed = await prisma.conversation.create({
      // The Business belongs to otherTenant, while the Conversation and Customer
      // claim tenant. This is possible because the legacy schema has no composite
      // tenant/business foreign key.
      data: { tenantId: tenant.id, businessId: otherBusiness.id, customerId: customer.id, channel: 'LINE', externalThreadId: `TH-analysis-pair-bad-${suffix}` },
    })
    const auditBefore = await countAnalysisAuditsForConversation(malformed.id)
    await expect(recordConversationAnalysis(malformed.id, analysisInput(), { viewer })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: malformed.id } })).toBe(0)
    expect(await countAnalysisAuditsForConversation(malformed.id)).toBe(auditBefore)

    const validA = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: `U-analysis-pair-a-${suffix}`, threadId: `TH-analysis-pair-a-${suffix}`, text: 'valid A' })
    const validB = await ingestLineMessage({ tenantId: otherTenant.id, businessId: otherBusiness.id, lineUserId: `U-analysis-pair-b-${suffix}`, threadId: `TH-analysis-pair-b-${suffix}`, text: 'valid B' })
    await recordCustomerConsent(validA.customerId, { businessId: business.id, status: 'GRANTED' }, { viewer })
    await recordCustomerConsent(validB.customerId, { businessId: otherBusiness.id, status: 'GRANTED' }, { viewer })
    await expect(recordConversationAnalysis(validA.conversationId, analysisInput(), { viewer })).resolves.toMatchObject({ conversationId: validA.conversationId })
    await expect(recordConversationAnalysis(validB.conversationId, analysisInput(), { viewer })).resolves.toMatchObject({ conversationId: validB.conversationId })
  })

  it('fails closed when Conversation and Customer tenant columns disagree', async () => {
    const suffix = randomUUID().slice(0, 8)
    const person = await prisma.person.create({ data: { id: randomUUID(), code: `PER-ANALYSIS-MISMATCH-${suffix}`, displayName: 'Mismatch customer' } })
    const customer = await prisma.customer.create({
      data: { code: `CUS-ANALYSIS-MISMATCH-${suffix}`, tenantId: otherTenant.id, businessId: otherBusiness.id, personId: person.id, displayName: 'Mismatched tenant', consentStatus: 'GRANTED' },
    })
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, businessId: business.id, customerId: customer.id, channel: 'LINE', externalThreadId: `TH-analysis-mismatch-${suffix}` },
    })
    const viewer = await ownerOf(business.id)
    await expect(recordConversationAnalysis(conversation.id, analysisInput(), { viewer })).rejects.toMatchObject({ status: 404 })
    await expect(getConversationAnalyses({ viewer, businessId: business.id, conversationId: conversation.id })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: conversation.id } })).toBe(0)
    expect(await countAnalysisAuditsForConversation(conversation.id)).toBe(0)
  })

  it('permits a same-tenant owner to analyze a tenant-shared Conversation', async () => {
    const suffix = randomUUID().slice(0, 8)
    const shared = await ingestLineMessage({
      tenantId: tenant.id,
      lineUserId: `U-analysis-shared-${suffix}`,
      threadId: `TH-analysis-shared-${suffix}`,
      text: 'shared tenant conversation',
    })
    const firstOwner = await ownerOf(business.id)
    const siblingOwner = await ownerOf(siblingBusiness.id)
    await recordCustomerConsent(shared.customerId, { businessId: business.id, status: 'GRANTED' }, { viewer: firstOwner })
    await recordConversationAnalysis(shared.conversationId, analysisInput(), { viewer: siblingOwner })
    expect((await getConversationAnalyses({ viewer: firstOwner, businessId: business.id, conversationId: shared.conversationId })).analyses).toHaveLength(1)
  })

  it('physically deletes analyses during PDPA erasure, including an already-deleted Customer', async () => {
    const suffix = randomUUID().slice(0, 8)
    const person = await prisma.person.create({ data: { id: randomUUID(), code: `PER-ANALYSIS-ERASE-${suffix}`, displayName: 'Erase analysis' } })
    const customer = await prisma.customer.create({
      data: { code: `CUS-ANALYSIS-ERASE-${suffix}`, tenantId: tenant.id, businessId: business.id, personId: person.id, displayName: 'Erase analysis customer', consentStatus: 'GRANTED' },
    })
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, businessId: business.id, customerId: customer.id, channel: 'LINE', externalThreadId: `TH-analysis-erase-${suffix}` },
    })
    await prisma.conversationAnalysis.create({
      data: { conversationId: conversation.id, analyzedDate: new Date('2026-08-30T00:00:00Z'), contactType: 'NEW_LEAD', state: 'HOT', cta: null, tags: '[]', summary: 'erase me', rawOutputJson: '{"pii":"erase me"}' },
    })
    await prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: new Date() } })
    const summary = await erasePrincipal({ tenantId: tenant.id, personId: person.id })
    expect(summary.erasedAnalyses).toBe(1)
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: conversation.id } })).toBe(0)
  })

  it('keeps an analysis whose malformed Conversation tenant differs from the erased Customer tenant', async () => {
    const suffix = randomUUID().slice(0, 8)
    const person = await prisma.person.create({ data: { id: randomUUID(), code: `PER-ANALYSIS-ERASE-PAIR-${suffix}`, displayName: 'Erase pair' } })
    const customer = await prisma.customer.create({
      data: { code: `CUS-ANALYSIS-ERASE-PAIR-${suffix}`, tenantId: tenant.id, businessId: business.id, personId: person.id, displayName: 'Erase pair customer' },
    })
    const sameTenant = await prisma.conversation.create({
      data: { tenantId: tenant.id, businessId: business.id, customerId: customer.id, channel: 'LINE', externalThreadId: `TH-analysis-erase-pair-a-${suffix}` },
    })
    const malformed = await prisma.conversation.create({
      // This row points at Customer A but claims Tenant B. Erasure of A must
      // not cross the Conversation tenant boundary while cleaning derived data.
      data: { tenantId: otherTenant.id, businessId: otherBusiness.id, customerId: customer.id, channel: 'LINE', externalThreadId: `TH-analysis-erase-pair-b-${suffix}` },
    })
    for (const conversation of [sameTenant, malformed]) {
      await prisma.conversationAnalysis.create({
        data: { conversationId: conversation.id, analyzedDate: new Date('2026-08-30T00:00:00Z'), contactType: 'SUPPORT', state: 'COLD', cta: null, tags: '[]', summary: 'erase pair', rawOutputJson: '{"erasePair":true}' },
      })
    }

    const summary = await erasePrincipal({ tenantId: tenant.id, personId: person.id })
    expect(summary.erasedAnalyses).toBe(1)
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: sameTenant.id } })).toBe(0)
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: malformed.id } })).toBe(1)
  })

  it('keeps another tenant Customer and its analysis when erasure is tenant-scoped', async () => {
    const suffix = randomUUID().slice(0, 8)
    const person = await prisma.person.create({ data: { id: randomUUID(), code: `PER-ANALYSIS-CROSS-${suffix}`, displayName: 'Cross tenant erase' } })
    const customerA = await prisma.customer.create({
      data: { code: `CUS-ANALYSIS-CROSS-A-${suffix}`, tenantId: tenant.id, businessId: business.id, personId: person.id, displayName: 'Tenant A customer' },
    })
    const customerB = await prisma.customer.create({
      data: { code: `CUS-ANALYSIS-CROSS-B-${suffix}`, tenantId: otherTenant.id, businessId: otherBusiness.id, personId: person.id, displayName: 'Tenant B customer' },
    })
    const conversationA = await prisma.conversation.create({
      data: { tenantId: tenant.id, businessId: business.id, customerId: customerA.id, channel: 'LINE', externalThreadId: `TH-analysis-cross-a-${suffix}` },
    })
    const conversationB = await prisma.conversation.create({
      data: { tenantId: otherTenant.id, businessId: otherBusiness.id, customerId: customerB.id, channel: 'LINE', externalThreadId: `TH-analysis-cross-b-${suffix}` },
    })
    for (const conversation of [conversationA, conversationB]) {
      await prisma.conversationAnalysis.create({
        data: { conversationId: conversation.id, analyzedDate: new Date('2026-08-30T00:00:00Z'), contactType: 'SUPPORT', state: 'COLD', cta: null, tags: '[]', summary: 'tenant scoped', rawOutputJson: '{"tenantScoped":true}' },
      })
    }
    await erasePrincipal({ tenantId: tenant.id, personId: person.id })
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: conversationA.id } })).toBe(0)
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: conversationB.id } })).toBe(1)
    expect((await prisma.customer.findUnique({ where: { id: customerB.id } })).deletedAt).toBeNull()
  })

  it('round trips an analysis row through the existing snapshot service', async () => {
    const viewer = await ownerOf(business.id)
    const before = await prisma.conversationAnalysis.findFirst({ where: { conversationId }, orderBy: { createdAt: 'asc' } })
    const snapshot = await exportSnapshot()
    expect(snapshot.tables.conversationAnalysis).toContainEqual(expect.objectContaining({ id: before.id, conversationId }))
    await prisma.conversationAnalysis.delete({ where: { id: before.id } })
    expect(await prisma.conversationAnalysis.findUnique({ where: { id: before.id } })).toBeNull()
    await importSnapshot(snapshot, { confirm: true, viewer: makeDevViewer({ visibleBusinessIds: [] }) })
    const restored = await prisma.conversationAnalysis.findUnique({ where: { id: before.id } })
    expect(restored.rawOutputJson).toBe(before.rawOutputJson)
    expect((await getConversationAnalyses({ viewer, businessId: business.id, conversationId })).analyses.length).toBeGreaterThan(0)
  })
})

function analysisInput(overrides = {}) {
  return {
    analyzedDate: '2026-08-31T00:00:00.000Z',
    contactType: 'NEW_LEAD',
    state: 'HOT',
    cta: null,
    tags: [],
    summary: 'test summary',
    rawOutputJson: JSON.stringify({ result: 'test' }),
    ...overrides,
  }
}

async function countAnalysisAuditsForConversation(id) {
  const events = await prisma.auditEvent.findMany({ where: { entityType: 'CONVERSATION_ANALYSIS' }, select: { payloadJson: true } })
  return events.filter((event) => {
    try {
      return JSON.parse(event.payloadJson).conversationId === id
    } catch {
      return false
    }
  }).length
}

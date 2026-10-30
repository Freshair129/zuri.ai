import { describe, expect, it } from 'vitest'
import { makeViewer } from '../factories/viewer'
import { getConversationAnalyses } from '@/modules/crm/conversation-analysis-service'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'

const business = { id: 'b-1', tenantId: 't-1', name: 'Selected Business' }
const owner = makeViewer({
  role: 'OWNER',
  visibleBusinessIds: ['b-1', 'b-2'],
  ownedBusinessIds: ['b-1', 'b-2'],
  visibleDomains: [...VIEWER_DOMAINS],
})

function conversation({ id = 'c-1', businessId = 'b-1', consentStatus = 'GRANTED', deletedAt = null } = {}) {
  return {
    id,
    tenantId: 't-1',
    businessId,
    customer: { tenantId: 't-1', consentStatus, deletedAt },
  }
}

function fakeDb(source, analysisRows = []) {
  const calls = { business: 0, conversation: [], analyses: 0 }
  const db = {
    $transaction: (run) => run(db),
    business: {
      findUnique: async () => { calls.business += 1; return business },
    },
    conversation: {
      findFirst: async ({ where }) => {
        calls.conversation.push(where)
        if (!source || source.id !== where.id || source.tenantId !== where.tenantId) return null
        const allowedBusiness = where.OR.some((condition) =>
          condition.businessId === null
            ? source.businessId === null
            : condition.businessId === source.businessId)
        const consent = where.customer
        if (!allowedBusiness || source.customer.tenantId !== consent.tenantId) return null
        if (consent.deletedAt === null && source.customer.deletedAt !== null) return null
        if (consent.consentStatus && source.customer.consentStatus !== consent.consentStatus) return null
        return source
      },
    },
    conversationAnalysis: {
      findMany: async () => { calls.analyses += 1; return analysisRows },
    },
  }
  return { db, calls }
}

const analysis = {
  id: 'a-1',
  conversationId: 'c-1',
  analyzedDate: new Date('2026-10-28T00:00:00.000Z'),
  analyzedAt: new Date('2026-10-28T09:30:00.000Z'),
  contactType: 'NEW_LEAD',
  state: 'WARM',
  cta: null,
  tags: '["follow-up"]',
  summary: 'ลูกค้าขอรายละเอียดสินค้า',
  rawOutputJson: '{"private":"must not be returned"}',
  createdAt: new Date('2026-10-28T09:30:01.000Z'),
  updatedAt: new Date('2026-10-28T09:30:01.000Z'),
}

describe('getConversationAnalyses Inbox scope (CRM-READ-01)', () => {
  it('reads selected-Business and tenant-shared conversations and returns only the existing redacted DTO', async () => {
    for (const source of [conversation(), conversation({ businessId: null })]) {
      const { db, calls } = fakeDb(source, [analysis])
      const result = await getConversationAnalyses({ viewer: owner, businessId: 'b-1', conversationId: source.id, db })
      expect(result.analyses).toHaveLength(1)
      expect(result.analyses[0]).toMatchObject({ id: 'a-1', summary: analysis.summary, tags: ['follow-up'] })
      expect(result.analyses[0]).not.toHaveProperty('rawOutputJson')
      expect(calls.conversation[0].OR).toEqual([{ businessId: null }, { businessId: 'b-1' }])
    }
  })

  it('refuses sibling-Business conversations even when the viewer can see both Businesses', async () => {
    const { db, calls } = fakeDb(conversation({ id: 'c-sibling', businessId: 'b-2' }), [analysis])
    await expect(getConversationAnalyses({ viewer: owner, businessId: 'b-1', conversationId: 'c-sibling', db }))
      .rejects.toMatchObject({ status: 404 })
    expect(calls.analyses).toBe(0)
    expect(calls.conversation[0].OR).toEqual([{ businessId: null }, { businessId: 'b-1' }])
  })

  it('requires the customer-domain grant before any database lookup', async () => {
    const memberWithoutCustomerDomain = makeViewer({
      role: 'MEMBER',
      visibleBusinessIds: ['b-1'],
      visibleDomains: ['projects'],
      domainsByBusinessId: { 'b-1': ['projects'] },
    })
    const { db, calls } = fakeDb(conversation(), [analysis])
    await expect(getConversationAnalyses({ viewer: memberWithoutCustomerDomain, businessId: 'b-1', conversationId: 'c-1', db }))
      .rejects.toMatchObject({ status: 404 })
    expect(calls.business).toBe(0)
    expect(calls.conversation).toHaveLength(0)
    expect(calls.analyses).toBe(0)
  })

  it.each([
    ['consent changed from GRANTED', conversation({ consentStatus: 'DECLINED' })],
    ['customer erased', conversation({ deletedAt: new Date('2026-10-28T10:00:00.000Z') })],
    ['conversation is missing', null],
  ])('fails closed when %s', async (_label, source) => {
    const { db, calls } = fakeDb(source, [analysis])
    await expect(getConversationAnalyses({ viewer: owner, businessId: 'b-1', conversationId: 'c-1', db }))
      .rejects.toMatchObject({ status: 404 })
    expect(calls.conversation[0].customer).toMatchObject({ tenantId: 't-1', deletedAt: null, consentStatus: 'GRANTED' })
    expect(calls.analyses).toBe(0)
  })

  it('returns a valid empty projection when the consented conversation has no analyses', async () => {
    const { db, calls } = fakeDb(conversation(), [])
    const result = await getConversationAnalyses({ viewer: owner, businessId: 'b-1', conversationId: 'c-1', db })
    expect(result.analyses).toEqual([])
    expect(calls.analyses).toBe(1)
  })
})

import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { recordConversationAnalysis } from '@/modules/crm/conversation-analysis-service'
import { recordCustomerProfileInference } from '@/modules/crm/customer-profile-service'
import { computeDailyBrief } from '@/modules/crm/daily-brief-service'

// @req FR-126, FR-127, FR-128 — the FEAT-014 storage seam end to end: ingest →
//   analysis rows → profile inference → recomputed daily brief.
// @spec BR-001, BR-002, SEC-001 — ADR-054 D3/D4/D6

const DATE = '2026-08-30'

let tenant, business, tenant2, business2
let convA, convB, convOther

describe('FEAT-014 conversation intelligence (FR-126/127/128)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'CI Group', code: 'PF-CI14' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'CI Tenant', code: 'TNT-CI14' })
    business = await createBusiness({ tenantId: tenant.id, name: 'CI Business', code: 'BUS-CI14' })

    const pf2 = await createPortfolio({ name: 'CI Group 2', code: 'PF-CI14B' })
    tenant2 = await createTenant({ portfolioId: pf2.id, name: 'CI Tenant 2', code: 'TNT-CI14B' })
    business2 = await createBusiness({ tenantId: tenant2.id, name: 'CI Business 2', code: 'BUS-CI14B' })

    // Two conversations in the subject tenant: one tenant-shared (businessId null,
    // the unbound-binding common case), one bound to the Business.
    convA = await ingestLineMessage({ tenantId: tenant.id, lineUserId: 'Uci14a', threadId: 'T-CI14A', text: 'สนใจคอร์สค่ะ', externalMessageId: 'MCI-1' })
    convB = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Uci14b', threadId: 'T-CI14B', text: 'ราคาเท่าไหร่ครับ', externalMessageId: 'MCI-2' })
    convOther = await ingestLineMessage({ tenantId: tenant2.id, lineUserId: 'Uci14c', threadId: 'T-CI14C', text: 'hi', externalMessageId: 'MCI-3' })
  })

  it('FR-127: records an analysis run keyed to the internal conversation id', async () => {
    const r = await recordConversationAnalysis({
      tenantId: tenant.id,
      conversationId: convA.conversationId,
      analysis: { analyzedDate: DATE, contactType: 'NEW_LEAD', state: 'HOT', cta: 'BOOKED', tags: ['course', 'price'], summary: 'ลูกค้าจองคอร์ส' },
    })
    expect(r.analysisId).toBeTruthy()
    const row = await prisma.conversationAnalysis.findUnique({ where: { id: r.analysisId } })
    expect(row.conversationId).toBe(convA.conversationId)
    expect(JSON.parse(row.tagsJson)).toEqual(['course', 'price'])
  })

  it('FR-127: a conversation in another tenant does not resolve — unsayable, not refused', async () => {
    await expect(recordConversationAnalysis({
      tenantId: tenant.id,
      conversationId: convOther.conversationId,
      analysis: { analyzedDate: DATE, contactType: 'NEW_LEAD', state: 'HOT' },
    })).rejects.toThrow('CONVERSATION_NOT_FOUND')
  })

  it('FR-127: re-analysis appends a run; it never mutates the earlier row', async () => {
    const before = await prisma.conversationAnalysis.count({ where: { conversationId: convA.conversationId } })
    await recordConversationAnalysis({
      tenantId: tenant.id,
      conversationId: convA.conversationId,
      analysis: { analyzedDate: DATE, contactType: 'RETURNING', state: 'CLOSED_WON', cta: 'BOOKED' },
    })
    const after = await prisma.conversationAnalysis.count({ where: { conversationId: convA.conversationId } })
    expect(after).toBe(before + 1)
  })

  it('FR-126: profile inference upserts one 1:1 row and accumulates provenance only', async () => {
    const first = await recordCustomerProfileInference({
      tenantId: tenant.id,
      customerId: convA.customerId,
      profile: { occupation: 'พนักงานออฟฟิศ', motivations: ['hobby'], budgetSignal: 'MID' },
    })
    expect(first.inferenceCount).toBe(1)
    const second = await recordCustomerProfileInference({
      tenantId: tenant.id,
      customerId: convA.customerId,
      profile: { motivations: ['career'], budgetSignal: 'HIGH' },
    })
    expect(second.profileId).toBe(first.profileId)
    expect(second.inferenceCount).toBe(2)
    const row = await prisma.customerProfile.findUnique({ where: { customerId: convA.customerId } })
    // Attributes replace whole (regenerable, ADR-054 D6): occupation was not
    // re-asserted, so it is gone, not remembered.
    expect(row.occupation).toBeNull()
    expect(JSON.parse(row.motivationsJson)).toEqual(['career'])
    expect(row.budgetSignal).toBe('HIGH')
  })

  it('FR-126: a customer in another tenant does not resolve', async () => {
    await expect(recordCustomerProfileInference({
      tenantId: tenant2.id,
      customerId: convA.customerId,
      profile: { budgetSignal: 'LOW' },
    })).rejects.toThrow('CUSTOMER_NOT_FOUND')
  })

  it('FR-128: the brief covers tenant-shared and business-bound conversations, and takes the latest run per conversation', async () => {
    await recordConversationAnalysis({
      tenantId: tenant.id,
      conversationId: convB.conversationId,
      analysis: { analyzedDate: DATE, contactType: 'NEW_LEAD', state: 'WARM', cta: 'ASKED_PRICE', tags: ['price'] },
    })
    const r = await computeDailyBrief({ tenantId: tenant.id, businessId: business.id, briefDate: DATE })
    expect(r.status).toBe('PROCESSED')
    expect(r.totalConversations).toBe(2)
    expect(r.totalAnalyzed).toBe(2)
    const row = await prisma.dailyBrief.findUnique({ where: { businessId_briefDate: { businessId: business.id, briefDate: DATE } } })
    // convA's LATEST run is CLOSED_WON — the earlier HOT run must not leak in.
    expect(JSON.parse(row.stateCountsJson)).toEqual({ CLOSED_WON: 1, WARM: 1 })
    expect(JSON.parse(row.topCtasJson)).toEqual([
      { value: 'ASKED_PRICE', count: 1 }, { value: 'BOOKED', count: 1 },
    ])
  })

  it('FR-128: recompute overwrites the row whole — never increments (ADR-054 D6)', async () => {
    const before = await prisma.dailyBrief.findUnique({ where: { businessId_briefDate: { businessId: business.id, briefDate: DATE } } })
    const r = await computeDailyBrief({ tenantId: tenant.id, businessId: business.id, briefDate: DATE })
    const after = await prisma.dailyBrief.findUnique({ where: { businessId_briefDate: { businessId: business.id, briefDate: DATE } } })
    expect(r.briefId).toBe(before.id)
    expect(after.totalAnalyzed).toBe(before.totalAnalyzed)
    expect(after.stateCountsJson).toBe(before.stateCountsJson)
    expect(after.version).toBe(before.version + 1)
    const count = await prisma.dailyBrief.count({ where: { businessId: business.id, briefDate: DATE } })
    expect(count).toBe(1)
  })

  it('FR-128: a business in another tenant does not resolve', async () => {
    await expect(computeDailyBrief({ tenantId: tenant.id, businessId: business2.id, briefDate: DATE }))
      .rejects.toThrow('BUSINESS_NOT_FOUND')
  })

  it('erasure follows the aggregate: deleting the customer takes profile, conversations, analyses with it', async () => {
    const scratch = await ingestLineMessage({ tenantId: tenant.id, lineUserId: 'Uci14z', threadId: 'T-CI14Z', text: 'x', externalMessageId: 'MCI-9' })
    await recordConversationAnalysis({
      tenantId: tenant.id, conversationId: scratch.conversationId,
      analysis: { analyzedDate: DATE, contactType: 'SUPPORT', state: 'COLD' },
    })
    await recordCustomerProfileInference({ tenantId: tenant.id, customerId: scratch.customerId, profile: {} })
    await prisma.customer.delete({ where: { id: scratch.customerId } })
    expect(await prisma.customerProfile.findUnique({ where: { customerId: scratch.customerId } })).toBeNull()
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: scratch.conversationId } })).toBe(0)
  })
})

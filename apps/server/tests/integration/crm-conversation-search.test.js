import { describe, it, expect, beforeAll } from 'vitest'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ingestLineMessage, ingestLineConversationEvent } from '@/modules/crm/line-ingest-service'
import {
  searchConversationMessages,
  getConversationEventCounts,
} from '@/modules/crm/conversation-search-service'

// @req FR-233 — the CRM inbox's third, read-only reader: message search
//   (LIKE on SQLite; trigram on Postgres is asserted by the migration test) and
//   per-account follow/unfollow counts from ConversationEvent.
// @spec BR-001, SEC-001, SDD-050

let tenantA, busA1, busA2, tenantB, busB1
let matchInA1, matchInA2, matchInB1

const ownerOf = (...businessIds) => makeViewer({
  role: 'OWNER',
  visibleBusinessIds: businessIds,
  ownedBusinessIds: businessIds,
  visibleDomains: [...VIEWER_DOMAINS],
})

describe('CRM conversation search and event counts (FR-233)', () => {
  beforeAll(async () => {
    const pfA = await createPortfolio({ name: 'Search Group A', code: 'PF-SEARCH-A' })
    tenantA = await createTenant({ portfolioId: pfA.id, name: 'Search Tenant A', code: 'TNT-SEARCH-A' })
    busA1 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านค้นหา 1', code: 'BUS-SEARCH-A1' })
    busA2 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านค้นหา 2', code: 'BUS-SEARCH-A2' })

    const pfB = await createPortfolio({ name: 'Search Group B', code: 'PF-SEARCH-B' })
    tenantB = await createTenant({ portfolioId: pfB.id, name: 'Search Tenant B', code: 'TNT-SEARCH-B' })
    busB1 = await createBusiness({ tenantId: tenantB.id, name: 'คู่แข่งค้นหา', code: 'BUS-SEARCH-B1' })

    matchInA1 = await ingestLineMessage({
      tenantId: tenantA.id, businessId: busA1.id, lineUserId: 'U-search-a1',
      threadId: 'TH-SEARCH-A1', text: 'สนใจโปรโมชั่นพิเศษ', externalMessageId: 'MI-SEARCH-A1',
      channelAccountId: 'ACC-SEARCH-A1',
    })
    matchInA2 = await ingestLineMessage({
      tenantId: tenantA.id, businessId: busA2.id, lineUserId: 'U-search-a2',
      threadId: 'TH-SEARCH-A2', text: 'อยากได้โปรโมชั่นด้วยครับ', externalMessageId: 'MI-SEARCH-A2',
      channelAccountId: 'ACC-SEARCH-A2',
    })
    matchInB1 = await ingestLineMessage({
      tenantId: tenantB.id, businessId: busB1.id, lineUserId: 'U-search-b1',
      threadId: 'TH-SEARCH-B1', text: 'โปรโมชั่นของอีกเทนแนนต์', externalMessageId: 'MI-SEARCH-B1',
    })

    await ingestLineConversationEvent({
      tenantId: tenantA.id, businessId: busA1.id, lineUserId: 'U-search-follow-1', threadId: 'TH-SEARCH-FOLLOW-1',
      kind: 'FOLLOW', externalEventId: 'EVT-FOLLOW-1', channelAccountId: 'ACC-SEARCH-A1',
    })
    await ingestLineConversationEvent({
      tenantId: tenantA.id, businessId: busA1.id, lineUserId: 'U-search-follow-2', threadId: 'TH-SEARCH-FOLLOW-2',
      kind: 'FOLLOW', externalEventId: 'EVT-FOLLOW-2', channelAccountId: 'ACC-SEARCH-A1',
    })
    await ingestLineConversationEvent({
      tenantId: tenantA.id, businessId: busA1.id, lineUserId: 'U-search-follow-1', threadId: 'TH-SEARCH-FOLLOW-1',
      kind: 'UNFOLLOW', externalEventId: 'EVT-UNFOLLOW-1', channelAccountId: 'ACC-SEARCH-A1',
    })
    // A different account, so account-scoped counts must exclude it.
    await ingestLineConversationEvent({
      tenantId: tenantA.id, businessId: busA2.id, lineUserId: 'U-search-follow-3', threadId: 'TH-SEARCH-FOLLOW-3',
      kind: 'FOLLOW', externalEventId: 'EVT-FOLLOW-3', channelAccountId: 'ACC-SEARCH-A2',
    })
  })

  it('finds a message by substring within the open Business only', async () => {
    const result = await searchConversationMessages({
      viewer: ownerOf(busA1.id), businessId: busA1.id, query: 'โปรโมชั่น',
    })
    const ids = result.results.map((row) => row.conversationId)
    expect(ids).toContain(matchInA1.conversationId)
    expect(ids).not.toContain(matchInA2.conversationId)
    expect(ids).not.toContain(matchInB1.conversationId)
  })

  it("never returns another tenant's message, even for a viewer who owns businesses in both", async () => {
    const result = await searchConversationMessages({
      viewer: ownerOf(busA1.id, busB1.id), businessId: busA1.id, query: 'โปรโมชั่น',
    })
    const bodies = JSON.stringify(result)
    expect(bodies).not.toContain(matchInB1.conversationId)
  })

  it('excludes a same-tenant Business the viewer cannot see', async () => {
    const result = await searchConversationMessages({
      viewer: ownerOf(busA1.id), businessId: busA1.id, query: 'โปรโมชั่น',
    })
    const ids = result.results.map((row) => row.conversationId)
    expect(ids).not.toContain(matchInA2.conversationId)
  })

  it('scopes to one LINE OA account when given', async () => {
    const result = await searchConversationMessages({
      viewer: ownerOf(busA1.id), businessId: busA1.id, query: 'โปรโมชั่น', channelAccountId: 'ACC-SEARCH-A1',
    })
    expect(result.results.map((row) => row.conversationId)).toContain(matchInA1.conversationId)

    const wrongAccount = await searchConversationMessages({
      viewer: ownerOf(busA1.id), businessId: busA1.id, query: 'โปรโมชั่น', channelAccountId: 'ACC-DOES-NOT-EXIST',
    })
    expect(wrongAccount.results).toHaveLength(0)
  })

  it('refuses a Business the viewer cannot see, before reading anything', async () => {
    await expect(
      searchConversationMessages({ viewer: ownerOf(busA1.id), businessId: busB1.id, query: 'x' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('reads without writing', async () => {
    const prisma = (await import('@/lib/db')).default
    const before = await prisma.message.count()
    await searchConversationMessages({ viewer: ownerOf(busA1.id), businessId: busA1.id, query: 'โปรโมชั่น' })
    expect(await prisma.message.count()).toBe(before)
  })

  it('counts follow/unfollow per account from ConversationEvent, scoped to visible Businesses', async () => {
    const result = await getConversationEventCounts({
      viewer: ownerOf(busA1.id), businessId: busA1.id, channelAccountId: 'ACC-SEARCH-A1',
    })
    expect(result.counts).toEqual({ follow: 2, unfollow: 1 })
  })

  it("does not mix another Business's own account into this one's counts", async () => {
    const result = await getConversationEventCounts({
      viewer: ownerOf(busA1.id, busA2.id), businessId: busA2.id, channelAccountId: 'ACC-SEARCH-A2',
    })
    expect(result.counts).toEqual({ follow: 1, unfollow: 0 })
  })
})

import { describe, expect, it, vi } from 'vitest'

import { readConversationFact, readCustomerFact } from '@/modules/crm/scm-reference-reader'

// @req FR-166 — CRM's read port for the scm-core.v1 Customer / Conversation facts
//   (ADR-111 D5): Tenant-bounded, null on a miss, and only the contract's columns.
// @spec ADR-111, BR-001, SEC-001

const DELETED = new Date('2026-09-01T00:00:00.000Z')
// Rows carry more than the port may answer: nothing beyond the allow-list leaves.
const CUSTOMERS = [
  { id: 'c-1', code: 'CUS-1', tenantId: 't-1', businessId: 'b-1', deletedAt: null, displayName: 'Synthetic', consentStatus: 'GRANTED', personId: 'p-1' },
  { id: 'c-shared', code: 'CUS-S', tenantId: 't-1', businessId: null, deletedAt: DELETED, displayName: 'Shared' },
  { id: 'c-x', code: 'CUS-X', tenantId: 't-2', businessId: 'b-x', deletedAt: null },
]
const CONVERSATIONS = [
  { id: 'cv-1', tenantId: 't-1', businessId: 'b-1', customerId: 'c-1', externalThreadId: 'TH-1', lastMessagePreview: 'hello' },
  { id: 'cv-shared', tenantId: 't-1', businessId: null, customerId: null },
  { id: 'cv-x', tenantId: 't-2', businessId: 'b-x', customerId: 'c-x' },
]

// Honours `select` like Prisma, but a real row would too — so the port's own
// projection is what the allow-list test checks, by handing it every column.
function fakeDb({ honourSelect = true } = {}) {
  const lookup = (rows) => vi.fn(async ({ where, select }) => {
    const row = rows.find((candidate) => candidate.id === where.id)
    if (!row) return null
    return honourSelect ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row }
  })
  return { customer: { findUnique: lookup(CUSTOMERS) }, conversation: { findUnique: lookup(CONVERSATIONS) } }
}

describe('crm scm-reference-reader: readCustomerFact', () => {
  it('answers the contract columns for a Customer of the Tenant', async () => {
    const db = fakeDb()
    expect(await readCustomerFact({ tenantId: 't-1', customerId: 'c-1' }, { db }))
      .toEqual({ id: 'c-1', code: 'CUS-1', tenantId: 't-1', businessId: 'b-1', deletedAt: null })
    expect(await readCustomerFact({ tenantId: 't-1', customerId: 'c-shared' }, { db }))
      .toEqual({ id: 'c-shared', code: 'CUS-S', tenantId: 't-1', businessId: null, deletedAt: DELETED })
    expect(db.customer.findUnique).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      select: { id: true, code: true, tenantId: true, businessId: true, deletedAt: true },
    })
  })

  it('never answers a column outside the allow-list, even if the row carries it', async () => {
    const fact = await readCustomerFact({ tenantId: 't-1', customerId: 'c-1' }, { db: fakeDb({ honourSelect: false }) })
    expect(Object.keys(fact).sort()).toEqual(['businessId', 'code', 'deletedAt', 'id', 'tenantId'])
  })

  it('null for another Tenant, a missing id or malformed input', async () => {
    const db = fakeDb()
    expect(await readCustomerFact({ tenantId: 't-1', customerId: 'c-x' }, { db })).toBeNull()
    expect(await readCustomerFact({ tenantId: 't-2', customerId: 'c-1' }, { db })).toBeNull()
    expect(await readCustomerFact({ tenantId: 't-1', customerId: 'nope' }, { db })).toBeNull()
    const calls = db.customer.findUnique.mock.calls.length
    expect(await readCustomerFact({ tenantId: '', customerId: 'c-1' }, { db })).toBeNull()
    expect(await readCustomerFact({ tenantId: 't-1', customerId: '' }, { db })).toBeNull()
    expect(await readCustomerFact({ tenantId: 't-1' }, { db })).toBeNull()
    expect(await readCustomerFact(undefined, { db })).toBeNull()
    // Malformed input never reaches the database.
    expect(db.customer.findUnique.mock.calls.length).toBe(calls)
  })
})

describe('crm scm-reference-reader: readConversationFact', () => {
  it('answers the contract columns for a Conversation of the Tenant', async () => {
    const db = fakeDb()
    expect(await readConversationFact({ tenantId: 't-1', conversationId: 'cv-1' }, { db }))
      .toEqual({ id: 'cv-1', tenantId: 't-1', businessId: 'b-1', customerId: 'c-1' })
    expect(await readConversationFact({ tenantId: 't-1', conversationId: 'cv-shared' }, { db }))
      .toEqual({ id: 'cv-shared', tenantId: 't-1', businessId: null, customerId: null })
    expect(db.conversation.findUnique).toHaveBeenCalledWith({
      where: { id: 'cv-1' },
      select: { id: true, tenantId: true, businessId: true, customerId: true },
    })
  })

  it('never answers a column outside the allow-list, even if the row carries it', async () => {
    const fact = await readConversationFact({ tenantId: 't-1', conversationId: 'cv-1' }, { db: fakeDb({ honourSelect: false }) })
    expect(Object.keys(fact).sort()).toEqual(['businessId', 'customerId', 'id', 'tenantId'])
  })

  it('null for another Tenant, a missing id or malformed input', async () => {
    const db = fakeDb()
    expect(await readConversationFact({ tenantId: 't-1', conversationId: 'cv-x' }, { db })).toBeNull()
    expect(await readConversationFact({ tenantId: 't-2', conversationId: 'cv-1' }, { db })).toBeNull()
    expect(await readConversationFact({ tenantId: 't-1', conversationId: 'nope' }, { db })).toBeNull()
    const calls = db.conversation.findUnique.mock.calls.length
    expect(await readConversationFact({ tenantId: null, conversationId: 'cv-1' }, { db })).toBeNull()
    expect(await readConversationFact({ tenantId: 't-1', conversationId: 42 }, { db })).toBeNull()
    expect(await readConversationFact(undefined, { db })).toBeNull()
    expect(db.conversation.findUnique.mock.calls.length).toBe(calls)
  })
})

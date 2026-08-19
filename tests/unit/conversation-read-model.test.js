import { describe, expect, it, vi, beforeEach } from 'vitest'

// @req FR-091 — the read model's shape claims, held by counted calls rather than by
// the comment that states them.
// @spec SDD-049, SEC-001
//
// SDD-049 says the query count is "constant in the number of conversations". Prose
// cannot hold that: the N+1 it forbids is one `map` away and reads perfectly
// naturally. So the calls are counted, at one row and at two hundred.

const calls = { conversation: 0, groupBy: 0, findMany: 0 }
let rows = []
let businessRow = { id: 'b-1', tenantId: 't-1', name: 'ร้านทดสอบ' }

vi.mock('@/lib/db', () => ({
  default: {
    business: {
      findUnique: async () => businessRow,
      findMany: async () => (businessRow ? [{ id: 'b-1', name: businessRow.name }] : []),
    },
    conversation: {
      findMany: async () => {
        calls.conversation += 1
        return rows
      },
      findFirst: async () => null,
    },
    message: {
      groupBy: async () => {
        calls.groupBy += 1
        return []
      },
      findMany: async () => {
        calls.findMany += 1
        return []
      },
    },
  },
}))

const { getConversationInbox, getConversationThread, INBOX_ROW_LIMIT, PREVIEW_LENGTH, parseConversationInboxQuery } =
  await import('@/modules/crm/conversation-read-model')

const viewer = { visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] }

const conversationsFor = (count) =>
  Array.from({ length: count }, (unusedValue, index) => ({
    id: `c-${index}`,
    businessId: null,
    channel: 'LINE',
    status: 'OPEN',
    externalThreadId: `t-${index}`,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    customer: { id: `cust-${index}`, code: `CUS-${index}`, displayName: 'ลูกค้า', lifecycleStage: 'LEAD' },
  }))

beforeEach(() => {
  calls.conversation = 0
  calls.groupBy = 0
  calls.findMany = 0
  businessRow = { id: 'b-1', tenantId: 't-1', name: 'ร้านทดสอบ' }
  rows = []
})

describe('conversation read model query shape (SDD-049)', () => {
  it('costs the same three queries for one conversation and for two hundred', async () => {
    rows = conversationsFor(1)
    await getConversationInbox({ viewer, businessId: 'b-1' })
    const one = { ...calls }

    calls.conversation = 0; calls.groupBy = 0; calls.findMany = 0
    rows = conversationsFor(200)
    await getConversationInbox({ viewer, businessId: 'b-1' })

    expect(one).toEqual({ conversation: 1, groupBy: 1, findMany: 1 })
    expect(calls).toEqual(one)
  })

  it('asks for no messages at all when there are no conversations to ask about', async () => {
    rows = []
    await getConversationInbox({ viewer, businessId: 'b-1' })
    expect(calls.groupBy).toBe(0)
    expect(calls.findMany).toBe(0)
  })
})

describe('conversation read model scope (SEC-001)', () => {
  it('refuses a Business the viewer cannot see without reading a single row', async () => {
    await expect(getConversationInbox({ viewer, businessId: 'b-other' })).rejects.toMatchObject({ status: 403 })
    expect(calls.conversation).toBe(0)
  })

  it('refuses a viewer carrying no grants at all, rather than defaulting to open', async () => {
    await expect(getConversationInbox({ viewer: {}, businessId: 'b-1' })).rejects.toMatchObject({ status: 403 })
    await expect(getConversationInbox({ viewer: null, businessId: 'b-1' })).rejects.toMatchObject({ status: 403 })
  })

  it('reports a Business that passed the grant check but does not exist as absent', async () => {
    businessRow = null
    await expect(getConversationInbox({ viewer, businessId: 'b-1' })).rejects.toMatchObject({ status: 404 })
  })

  it('answers an unreadable conversation id as absent, never as forbidden', async () => {
    await expect(
      getConversationThread({ viewer, businessId: 'b-1', conversationId: 'c-elsewhere' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('conversation read model query contract', () => {
  it('requires a Business — there is no tenant-wide default to fall back on', () => {
    expect(() => parseConversationInboxQuery({})).toThrow()
    expect(() => parseConversationInboxQuery({ businessId: '   ' })).toThrow()
  })

  it('caps a caller-supplied limit instead of trusting it', () => {
    expect(parseConversationInboxQuery({ businessId: 'b-1', limit: '5' }).limit).toBe(5)
    expect(parseConversationInboxQuery({ businessId: 'b-1', limit: '99999' }).limit).toBe(INBOX_ROW_LIMIT)
  })

  it('rejects an unknown parameter rather than ignoring it', () => {
    expect(() => parseConversationInboxQuery({ businessId: 'b-1', tenantId: 't-1' })).toThrow()
  })
})

describe('conversation read model preview', () => {
  it('truncates a long message and collapses the whitespace a chat app produces', async () => {
    const longBody = 'ก'.repeat(PREVIEW_LENGTH + 50)
    rows = conversationsFor(1)
    const db = (await import('@/lib/db')).default
    db.message.findMany = async () => [
      { id: 'm-1', conversationId: 'c-0', direction: 'INBOUND', body: `  หนึ่ง\n\nสอง  ${longBody}`, createdAt: new Date(0) },
    ]

    const result = await getConversationInbox({ viewer, businessId: 'b-1' })
    const { preview } = result.conversations[0].lastMessage
    expect(preview).not.toMatch(/\n/)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview.length).toBe(PREVIEW_LENGTH + 1)
  })
})

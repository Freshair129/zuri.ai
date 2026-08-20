import { describe, expect, it, vi, beforeEach } from 'vitest'

// @req FR-093 — the receipt contract and the ordering that makes a cross-tenant
// attachment unsayable, held without a database.
// @spec SDD-051, SEC-001, BR-011

const calls = { findFirst: 0, findUnique: 0, create: 0, transaction: 0 }
let inboundRow = null

vi.mock('@/lib/db', () => ({
  default: {
    message: {
      findFirst: async () => {
        calls.findFirst += 1
        return inboundRow
      },
      findUnique: async () => {
        calls.findUnique += 1
        return null
      },
    },
    $transaction: async (fn) => {
      calls.transaction += 1
      return fn({
        message: {
          create: async ({ data }) => {
            calls.create += 1
            return { id: 'msg-new', ...data }
          },
        },
        auditEvent: { create: async () => ({}) },
      })
    },
  },
}))

const { recordLineReply, replyExternalId, zReplyReceipt, REPLY_SOURCES } =
  await import('@/modules/crm/reply-record-service')

const receipt = (over = {}) => ({ inboundMessageId: 'inbound-1', text: 'ราคา 450 บาทครับ', ...over })

beforeEach(() => {
  calls.findFirst = 0
  calls.findUnique = 0
  calls.create = 0
  calls.transaction = 0
  inboundRow = { id: 'inbound-1', conversationId: 'conv-1', direction: 'INBOUND' }
})

describe('reply receipt contract', () => {
  it('defaults source to STACK, the ordinary case', () => {
    expect(zReplyReceipt.parse(receipt()).source).toBe('STACK')
    expect(REPLY_SOURCES).toEqual(['STACK', 'TRANSPORT_FALLBACK'])
  })

  it('refuses an empty reply — a sent message always had text', () => {
    expect(() => zReplyReceipt.parse(receipt({ text: '' }))).toThrow()
  })

  it('refuses text longer than the transport can have sent', () => {
    // The runtime slices to 5000 before calling the Reply API, so anything longer is
    // not a record of what happened.
    expect(() => zReplyReceipt.parse(receipt({ text: 'ก'.repeat(5001) }))).toThrow()
  })

  it('refuses a source it does not recognise rather than storing an unknown provenance', () => {
    expect(() => zReplyReceipt.parse(receipt({ source: 'GUESS' }))).toThrow()
  })

  it('refuses an unknown field instead of ignoring it', () => {
    expect(() => zReplyReceipt.parse(receipt({ replyToken: 'never-send-this' }))).toThrow()
  })
})

describe('reply external id', () => {
  it('derives from our own row, never from anything the caller supplies', () => {
    expect(replyExternalId('inbound-1')).toBe('reply:inbound-1')
    // A provider id in the receipt must not participate: idempotency would then
    // depend on the transport still remembering it across a restart.
    expect(replyExternalId('inbound-1')).toBe(replyExternalId('inbound-1'))
  })
})

describe('reply recording order', () => {
  it('writes nothing when the inbound message is outside the tenant', async () => {
    inboundRow = null
    await expect(recordLineReply({ tenantId: 't-1', receipt: receipt() })).rejects.toMatchObject({ status: 404 })
    expect(calls.transaction).toBe(0)
    expect(calls.create).toBe(0)
  })

  it('writes nothing when the named message is itself outbound', async () => {
    inboundRow = { id: 'inbound-1', conversationId: 'conv-1', direction: 'OUTBOUND' }
    await expect(recordLineReply({ tenantId: 't-1', receipt: receipt() })).rejects.toMatchObject({ status: 400 })
    expect(calls.transaction).toBe(0)
  })

  it('writes nothing without a tenant, and does not read to find out', async () => {
    await expect(recordLineReply({ tenantId: '', receipt: receipt() })).rejects.toMatchObject({ status: 400 })
    expect(calls.findFirst).toBe(0)
  })

  it('takes the conversation from the resolved row, never from the request', async () => {
    const result = await recordLineReply({
      tenantId: 't-1',
      // A caller cannot name a conversation at all — the contract has no field for
      // one, and this is what makes cross-tenant attachment unsayable rather than
      // refused. Proven by the write landing on the row's conversation.
      receipt: receipt(),
    })
    expect(result.conversationId).toBe('conv-1')
    expect(calls.create).toBe(1)
  })

  it('validates before reading, so a malformed receipt costs no query', async () => {
    await expect(
      recordLineReply({ tenantId: 't-1', receipt: receipt({ text: '' }) }),
    ).rejects.toThrow()
    expect(calls.findFirst).toBe(0)
  })
})

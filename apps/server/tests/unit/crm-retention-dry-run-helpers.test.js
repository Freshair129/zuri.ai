import { describe, expect, it, vi } from 'vitest'
import { attributeInboundMessageAuthors } from '@/modules/crm/conversation-redaction-service'
import { decideOrphanedLineSettlement, resolveArchiveKeyAttribution } from '@/modules/crm/chat-evidence-archive-service'

// @req FR-230, FR-245, SEC-034 — shared dry-run decisions match the live paths without write-back.
// @spec ADR-093 D6; SDD-103
// @tested tests/unit/crm-retention-dry-run-helpers.test.js

describe('CRM retention dry-run shared decisions', () => {
  it('defers a staff line only while a consenting Customer was a member for that line', () => {
    const createdAt = new Date('2026-01-02T00:00:00.000Z')
    const members = new Map([['conversation-1', new Map([
      ['owner-1', null],
      ['speaker-1', new Date('2025-12-31T00:00:00.000Z')],
      ['late-speaker', new Date('2026-01-03T00:00:00.000Z')],
    ])]])
    const message = { id: 'message-1', conversation: { id: 'conversation-1' }, createdAt }

    expect(decideOrphanedLineSettlement({
      message, members, consentingCustomerIds: new Set(['owner-1']), speakerCustomerId: null,
    })).toBe('DEFERRED')
    expect(decideOrphanedLineSettlement({
      message, members, consentingCustomerIds: new Set(['late-speaker']), speakerCustomerId: null,
    })).toBe('BLANKED')
    expect(decideOrphanedLineSettlement({
      message, members, consentingCustomerIds: new Set(['speaker-1']), speakerCustomerId: 'erased-speaker',
    })).toBe('BLANKED')
  })

  it('returns the author-attribution map in dry-run mode without writing any author column', async () => {
    const messageUpdateMany = vi.fn()
    const db = {
      message: { findMany: vi.fn().mockResolvedValue([{
        id: 'message-1', conversationId: 'conversation-1',
        conversation: { channel: 'LINE', channelAccountId: 'oa-1' },
      }]), updateMany: messageUpdateMany },
      lineConversationJob: { findMany: vi.fn().mockResolvedValue([]) },
      auditEvent: { findMany: vi.fn().mockResolvedValue([{
        entityId: 'conversation-1',
        payloadJson: JSON.stringify({ tenantId: 'tenant-1', messageId: 'message-1', customerId: 'customer-1', channelAccountId: 'oa-1' }),
      }]) },
      customer: { findMany: vi.fn().mockResolvedValue([{ id: 'customer-1', personId: 'person-1' }]) },
      channelIdentity: { findFirst: vi.fn().mockResolvedValue({ id: 'identity-1' }) },
    }

    const found = await attributeInboundMessageAuthors(db, {
      tenantId: 'tenant-1', messageIds: ['message-1'], dryRun: true,
    })

    expect(found).toEqual(new Map([['message-1', 'identity-1']]))
    expect(db.message.findMany).toHaveBeenCalledTimes(1)
    expect(db.lineConversationJob.findMany).toHaveBeenCalledTimes(1)
    expect(db.auditEvent.findMany).toHaveBeenCalledTimes(1)
    expect(db.customer.findMany).toHaveBeenCalledTimes(1)
    expect(db.channelIdentity.findFirst).toHaveBeenCalledTimes(1)
    expect(messageUpdateMany).not.toHaveBeenCalled()
  })

  it('uses would-write attribution in memory when resolving the archive key customer', async () => {
    const messageUpdateMany = vi.fn()
    const db = {
      message: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'message-1', conversationId: 'conversation-1',
          conversation: { channel: 'LINE', channelAccountId: 'oa-1' },
        }]),
        updateMany: messageUpdateMany,
      },
      lineConversationJob: { findMany: vi.fn().mockResolvedValue([]) },
      auditEvent: { findMany: vi.fn().mockResolvedValue([{
        entityId: 'conversation-1',
        payloadJson: JSON.stringify({ tenantId: 'tenant-1', messageId: 'message-1', customerId: 'speaker-customer', channelAccountId: 'oa-1' }),
      }]) },
      customer: { findMany: vi.fn().mockResolvedValue([{ id: 'speaker-customer', personId: 'speaker-person' }]) },
      channelIdentity: {
        findFirst: vi.fn().mockResolvedValue({ id: 'speaker-identity' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'speaker-identity', personId: 'speaker-person' }]),
      },
    }

    const attribution = await resolveArchiveKeyAttribution(db, {
      tenantId: 'tenant-1',
      messages: [{ id: 'message-1', direction: 'INBOUND', authorChannelIdentityId: null,
        conversation: { id: 'conversation-1', customerId: 'thread-owner' } }],
      attribute: true,
      dryRun: true,
    })

    expect(attribution).toEqual(new Map([['message-1', {
      keyCustomerId: 'speaker-customer', speakerCustomerId: 'speaker-customer',
    }]]))
    expect(messageUpdateMany).not.toHaveBeenCalled()
  })
})

import { describe, expect, it } from 'vitest'
import { readConversationConsentStatus } from '@/modules/crm/conversation-consent-reader'

// @req FR-236 — a narrow, internal (non-viewer) consent reader: returns only
//   the Customer's consentStatus for a Conversation the caller already scoped
//   to a Tenant/Business, or null ("not readable") on any mismatch, missing
//   row, or missing/malformed input — never a throw, so every caller is
//   forced to treat "unknown" as "not GRANTED" (fail closed).
// @spec ADR-090 D6, D8; BR-001; SEC-001

function fakeDb(conversation) {
  return { conversation: { findUnique: async () => conversation } }
}

describe('readConversationConsentStatus (FR-236)', () => {
  it('returns the consent status for a Conversation within the exact Tenant/Business', async () => {
    const db = fakeDb({ tenantId: 't-1', businessId: 'b-1', customer: { consentStatus: 'GRANTED' } })
    expect(await readConversationConsentStatus({ tenantId: 't-1', businessId: 'b-1', conversationId: 'c-1' }, { db })).toBe('GRANTED')
  })

  it('returns the status even when not GRANTED — the caller decides what to do with it', async () => {
    const db = fakeDb({ tenantId: 't-1', businessId: 'b-1', customer: { consentStatus: 'DECLINED' } })
    expect(await readConversationConsentStatus({ tenantId: 't-1', businessId: 'b-1', conversationId: 'c-1' }, { db })).toBe('DECLINED')
  })

  it('reaches a tenant-shared Conversation (businessId null) from any Business of that Tenant (BR-001)', async () => {
    const db = fakeDb({ tenantId: 't-1', businessId: null, customer: { consentStatus: 'GRANTED' } })
    expect(await readConversationConsentStatus({ tenantId: 't-1', businessId: 'b-1', conversationId: 'c-1' }, { db })).toBe('GRANTED')
  })

  it('returns null for a Conversation in a different Tenant', async () => {
    const db = fakeDb({ tenantId: 't-2', businessId: 'b-1', customer: { consentStatus: 'GRANTED' } })
    expect(await readConversationConsentStatus({ tenantId: 't-1', businessId: 'b-1', conversationId: 'c-1' }, { db })).toBeNull()
  })

  it('returns null for a Conversation bound to a different Business', async () => {
    const db = fakeDb({ tenantId: 't-1', businessId: 'b-2', customer: { consentStatus: 'GRANTED' } })
    expect(await readConversationConsentStatus({ tenantId: 't-1', businessId: 'b-1', conversationId: 'c-1' }, { db })).toBeNull()
  })

  it('returns null for a Conversation that does not exist', async () => {
    const db = fakeDb(null)
    expect(await readConversationConsentStatus({ tenantId: 't-1', businessId: 'b-1', conversationId: 'c-1' }, { db })).toBeNull()
  })

  it('fails closed (null) on missing or malformed input, never querying the database', async () => {
    let queried = false
    const db = { conversation: { findUnique: async () => { queried = true; return null } } }
    for (const input of [
      {},
      { tenantId: 't-1', businessId: 'b-1' }, // no conversationId
      { tenantId: 't-1', conversationId: 'c-1' }, // no businessId
      { businessId: 'b-1', conversationId: 'c-1' }, // no tenantId
      { tenantId: 't-1', businessId: 'b-1', conversationId: '' },
      { tenantId: 't-1', businessId: 'b-1', conversationId: null },
      undefined,
    ]) {
      expect(await readConversationConsentStatus(input, { db })).toBeNull()
    }
    expect(queried).toBe(false)
  })
})

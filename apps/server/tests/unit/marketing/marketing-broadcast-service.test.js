import { describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../../factories/viewer'
import {
  hashMarketingBroadcastPayload,
  serializeMarketingBroadcastPayload,
} from '@/modules/marketing/domain/marketing-broadcast-contract'

const viewer = makeViewer({
  principal: { id: 'broadcast-owner' },
  visibleBusinessIds: ['business-1'],
  ownedBusinessIds: ['business-1'],
  visibleDomains: ['growth'],
})

function payload(suffix = '') {
  return {
    channel: 'LINE',
    account: { lineOaAccountId: 'account-1', accountVersion: 1 },
    content: { briefId: `brief-${suffix || '1'}`, contentVersionId: `content-${suffix || '1'}`, payloadHash: 'a'.repeat(64) },
    audience: { source: 'CRM_CONVERSATION_READ_MODEL', sourceVersion: null, audienceSpecVersion: '1.0', filter: { consentStatus: 'GRANTED' }, criteriaHash: '40a2ec2eb918a1ac9ba76e6a0f811b8b3e38eec32f0fe654388123122b780268', resolutionState: 'UNAVAILABLE', resolutionRef: null },
    consent: { source: 'CRM_CUSTOMER.consentStatus', requiredValue: 'GRANTED', policyReference: 'FR-103', policyVersion: null, snapshotRef: null, snapshotVersion: null, state: 'UNAVAILABLE' },
  }
}

function revision(id, revision, value) {
  const payloadJson = serializeMarketingBroadcastPayload(value)
  return { id, revision, payloadJson, payloadHash: hashMarketingBroadcastPayload(value), createdBy: 'broadcast-owner', createdAt: new Date('2026-09-11T00:00:00Z') }
}

function dbFor(intent) {
  return {
    business: { findUnique: vi.fn(async () => ({ id: 'business-1', tenantId: 'tenant-1', status: 'ACTIVE' })) },
    marketingBroadcastIntent: { findUnique: vi.fn(async () => intent), findMany: vi.fn(async () => [intent]) },
    marketingBroadcastIntentVersion: {},
  }
}

describe('Marketing Broadcast application service', () => {
  it('lists the actual current revision and preserves UNKNOWN owner reads', async () => {
    const first = payload()
    const second = payload('2')
    const intent = {
      id: 'intent-1', tenantId: 'tenant-1', businessId: 'business-1', code: 'BRD-1', status: 'PLANNING', currentRevision: 2, version: 2,
      idempotencyKey: 'request-1', createdBy: 'broadcast-owner', createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      revisions: [revision('version-1', 1, first), revision('version-2', 2, second)],
    }
    const { listMarketingBroadcastIntents, getMarketingBroadcastIntent } = await import('@/modules/marketing/application/marketing-broadcast-service')
    const db = dbFor(intent)
    const ports = { getLineOaAccount: vi.fn(async () => ({ id: 'account-1', businessId: 'business-1', status: 'CONNECTED', version: 1 })), getMarketingContent: vi.fn(async () => ({ businessId: 'business-1', currentVersion: { id: 'content-2', payloadHash: 'a'.repeat(64) } })) }
    const listed = await listMarketingBroadcastIntents({ businessId: 'business-1', viewer }, { db, ports })
    expect(listed.intents[0]).toMatchObject({ currentRevision: 2, state: 'READY' })
    const read = await getMarketingBroadcastIntent({ id: intent.id, businessId: 'business-1', viewer }, {
      db,
      ports: { getLineOaAccount: vi.fn(async () => { throw new Error('owner timeout') }), getMarketingContent: vi.fn() },
    })
    expect(read.referenceState).toEqual({ state: 'UNKNOWN', reasonCodes: ['BROADCAST_REFERENCE_READ_UNKNOWN'] })
  })

  it('replays the original idempotent create after a later revision without duplicating it', async () => {
    const first = payload()
    const second = payload('2')
    const intent = {
      id: 'intent-1', tenantId: 'tenant-1', businessId: 'business-1', code: 'BRD-1', status: 'PLANNING', currentRevision: 2, version: 2,
      idempotencyKey: 'request-1', createdBy: 'broadcast-owner', createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      revisions: [revision('version-1', 1, first), revision('version-2', 2, second)],
    }
    const { createMarketingBroadcastIntent } = await import('@/modules/marketing/application/marketing-broadcast-service')
    const db = dbFor(intent)
    const result = await createMarketingBroadcastIntent({ businessId: 'business-1', idempotencyKey: 'request-1', payload: first }, {
      viewer, db,
      ports: { getLineOaAccount: vi.fn(async () => ({ id: 'account-1', businessId: 'business-1', status: 'CONNECTED', version: 1 })), getMarketingContent: vi.fn(async () => ({ businessId: 'business-1', currentVersion: { id: 'content-1', payloadHash: 'a'.repeat(64) } })) },
    })
    expect(result.id).toBe(intent.id)
    expect(result.currentRevision).toBe(2)
    expect(db.marketingBroadcastIntent.findUnique).toHaveBeenCalledTimes(1)
  })

  it('rejects a supplied account reference when the owner cannot resolve it', async () => {
    const { createMarketingBroadcastIntent } = await import('@/modules/marketing/application/marketing-broadcast-service')
    const db = dbFor(null)
    const ports = {
      getLineOaAccount: vi.fn(async () => { const error = new Error('hidden account'); error.status = 404; throw error }),
      getMarketingContent: vi.fn(async () => ({ businessId: 'business-1', currentVersion: { id: 'content-1', payloadHash: 'a'.repeat(64) } })),
    }
    await expect(createMarketingBroadcastIntent({ businessId: 'business-1', idempotencyKey: 'hidden-account', payload: payload() }, { viewer, db, ports })).rejects.toMatchObject({ status: 422, message: 'BROADCAST_LINE_ACCOUNT_UNAVAILABLE' })
  })
})

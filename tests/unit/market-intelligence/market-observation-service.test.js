import { describe, expect, it, vi } from 'vitest'

import {
  loadTranslateAndPersistRawMarketRecord,
  persistMarketObservationDraft,
  translateAndPersistRawMarketRecord,
} from '@/modules/market-intelligence/application/market-observation-service'

function createRepository() {
  const rows = new Map()
  return {
    rows,
    findByLineageKey: vi.fn(async (lineageKey) => rows.get(lineageKey) ?? null),
    insert: vi.fn(async (draft) => {
      const row = { id: `obs-${rows.size + 1}`, ...draft }
      rows.set(draft.lineageKey, row)
      return row
    }),
  }
}

const rawRecord = {
  id: 'raw-1',
  tenantId: 'tenant-a',
  businessId: 'business-a',
  connectionId: 'conn-a',
  provider: 'MARKET_TEST',
  entityType: 'LISTING',
  externalId: 'listing-100',
  payloadJson: JSON.stringify({ title: 'RTX 3060', price: 4900 }),
  payloadHash: 'a'.repeat(64),
  receivedAt: new Date('2026-08-20T00:00:00.000Z'),
}

const extractCandidate = async ({ payload }) => ({
  observationType: 'EXTERNAL_OFFER',
  candidate: { title: payload.title, price: payload.price },
})

const draft = {
  tenantId: 'tenant-a',
  businessId: 'business-a',
  rawRecordId: 'raw-1',
  connectionId: 'conn-a',
  provider: 'MARKET_TEST',
  sourceEntityType: 'LISTING',
  externalId: 'listing-100',
  sourcePayloadHash: 'a'.repeat(64),
  sourceUri: null,
  translationSchemaVersion: 'market-observation.v1',
  observationType: 'EXTERNAL_OFFER',
  candidateJson: JSON.stringify({ title: 'RTX 3060' }),
  canonicalProductRef: null,
  canonicalCategoryRef: null,
  resolutionStatus: 'UNRESOLVED',
  resolutionConfidence: null,
  observedAt: new Date('2026-08-20T00:00:00.000Z'),
  translatedAt: new Date('2026-08-20T00:01:00.000Z'),
  lineageKey: 'lineage-1',
}

describe('MarketObservation persistence application seam (#76)', () => {
  it('creates a new logical observation once', async () => {
    const repository = createRepository()

    const result = await persistMarketObservationDraft(draft, { repository })

    expect(result.status).toBe('CREATED')
    expect(result.observation.id).toBe('obs-1')
    expect(repository.insert).toHaveBeenCalledTimes(1)
  })

  it('returns UNCHANGED for replay of the same lineage key', async () => {
    const repository = createRepository()

    const first = await persistMarketObservationDraft(draft, { repository })
    const second = await persistMarketObservationDraft(draft, { repository })

    expect(first.status).toBe('CREATED')
    expect(second.status).toBe('UNCHANGED')
    expect(second.observation.id).toBe(first.observation.id)
    expect(repository.insert).toHaveBeenCalledTimes(1)
  })

  it('requires the persistence port rather than writing through Integration', async () => {
    await expect(persistMarketObservationDraft(draft)).rejects.toThrow(/repository/i)
  })

  it('composes translation then persistence without mutating raw evidence', async () => {
    const repository = createRepository()
    const before = structuredClone(rawRecord)

    const first = await translateAndPersistRawMarketRecord(rawRecord, {
      repository,
      extractCandidate,
      now: () => new Date('2026-08-20T00:01:00.000Z'),
    })
    const second = await translateAndPersistRawMarketRecord(rawRecord, {
      repository,
      extractCandidate,
      now: () => new Date('2026-08-20T00:02:00.000Z'),
    })

    expect(first.status).toBe('CREATED')
    expect(second.status).toBe('UNCHANGED')
    expect(repository.insert).toHaveBeenCalledTimes(1)
    expect(rawRecord).toEqual(before)
  })

  it('loads raw evidence by id through the scoped Integration repository before translating', async () => {
    const repository = createRepository()
    const rawRepository = {
      findById: vi.fn(async (id) => (id === rawRecord.id ? rawRecord : null)),
    }

    const result = await loadTranslateAndPersistRawMarketRecord('raw-1', {
      rawRepository,
      repository,
      extractCandidate,
      now: () => new Date('2026-08-20T00:01:00.000Z'),
    })

    expect(rawRepository.findById).toHaveBeenCalledWith('raw-1')
    expect(result.status).toBe('CREATED')
    expect(result.observation.rawRecordId).toBe('raw-1')
    expect(result.observation.tenantId).toBe('tenant-a')
  })

  it('returns NOT_FOUND when the scoped Integration repository cannot see the raw record', async () => {
    const repository = createRepository()
    const rawRepository = { findById: vi.fn(async () => null) }

    const result = await loadTranslateAndPersistRawMarketRecord('raw-hidden', {
      rawRepository,
      repository,
      extractCandidate,
    })

    expect(result).toEqual({ status: 'NOT_FOUND', observation: null })
    expect(repository.insert).not.toHaveBeenCalled()
  })

  it('requires the Integration scoped read port for the preferred entry point', async () => {
    const repository = createRepository()

    await expect(
      loadTranslateAndPersistRawMarketRecord('raw-1', {
        repository,
        extractCandidate,
      }),
    ).rejects.toThrow(/scoped Integration raw-record repository/i)
  })
})

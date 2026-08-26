import { describe, expect, it, vi } from 'vitest'

import {
  MARKET_RESOLUTION_STATUS,
  buildMarketObservationLineageKey,
  translateRawRecordToMarketObservation,
} from '@/modules/market-intelligence/application/translate-raw-record'

const rawRecord = {
  id: 'raw-1',
  tenantId: 'tenant-a',
  businessId: 'business-a',
  connectionId: 'conn-a',
  provider: 'MARKET_TEST',
  lane: 'MARKET',
  entityType: 'LISTING',
  externalId: 'listing-100',
  sourceType: 'PULL',
  sourceUri: 'https://example.invalid/listing-100',
  schemaVersion: 'market.test.listing.v1',
  payloadJson: JSON.stringify({
    tenantId: 'tenant-evil',
    businessId: 'business-evil',
    connectionId: 'conn-evil',
    title: 'GALAX RTX 3060 12GB',
    price: 4900,
  }),
  payloadHash: 'a'.repeat(64),
  receivedAt: new Date('2026-08-20T00:00:00.000Z'),
}

const extractor = vi.fn(async ({ payload }) => ({
  observationType: 'EXTERNAL_OFFER',
  candidate: {
    title: payload.title,
    price: payload.price,
    // Deliberately spoofed values must never become trusted lineage.
    tenantId: payload.tenantId,
    businessId: payload.businessId,
  },
  observedAt: '2026-08-19T23:59:00.000Z',
}))

describe('Market Intelligence raw translation contract (#76)', () => {
  it('copies trusted scope and source lineage only from RawExternalRecord', async () => {
    const result = await translateRawRecordToMarketObservation(rawRecord, {
      extractCandidate: extractor,
      now: () => new Date('2026-08-20T00:01:00.000Z'),
    })

    expect(result.tenantId).toBe('tenant-a')
    expect(result.businessId).toBe('business-a')
    expect(result.connectionId).toBe('conn-a')
    expect(result.rawRecordId).toBe('raw-1')
    expect(result.provider).toBe('MARKET_TEST')
    expect(result.externalId).toBe('listing-100')
    expect(result.sourcePayloadHash).toBe(rawRecord.payloadHash)

    const candidate = JSON.parse(result.candidateJson)
    expect(candidate.tenantId).toBe('tenant-evil')
    expect(candidate.businessId).toBe('business-evil')
    expect(result.tenantId).not.toBe(candidate.tenantId)
    expect(result.businessId).not.toBe(candidate.businessId)
  })

  it('treats a missing knowledge resolver as a valid UNRESOLVED state', async () => {
    const result = await translateRawRecordToMarketObservation(rawRecord, {
      extractCandidate: extractor,
    })

    expect(result.resolutionStatus).toBe(MARKET_RESOLUTION_STATUS.UNRESOLVED)
    expect(result.canonicalProductRef).toBeNull()
    expect(result.canonicalCategoryRef).toBeNull()
    expect(result.resolutionConfidence).toBeNull()
  })

  it('accepts a governed resolver result without letting it alter source scope', async () => {
    const knowledgeResolver = vi.fn(async () => ({
      status: MARKET_RESOLUTION_STATUS.RESOLVED,
      canonicalProductRef: 'gks:product:rtx-3060',
      canonicalCategoryRef: 'gks:category:gpu',
      confidence: 0.98,
      tenantId: 'tenant-evil',
    }))

    const result = await translateRawRecordToMarketObservation(rawRecord, {
      extractCandidate: extractor,
      knowledgeResolver,
    })

    expect(result.resolutionStatus).toBe(MARKET_RESOLUTION_STATUS.RESOLVED)
    expect(result.canonicalProductRef).toBe('gks:product:rtx-3060')
    expect(result.canonicalCategoryRef).toBe('gks:category:gpu')
    expect(result.resolutionConfidence).toBe(0.98)
    expect(result.tenantId).toBe('tenant-a')
  })

  it('builds the same lineage key when the same raw evidence is replayed', async () => {
    const first = await translateRawRecordToMarketObservation(rawRecord, {
      extractCandidate: extractor,
      translationSchemaVersion: 'market-observation.v1',
    })
    const second = await translateRawRecordToMarketObservation(rawRecord, {
      extractCandidate: extractor,
      translationSchemaVersion: 'market-observation.v1',
    })

    expect(first.lineageKey).toBe(second.lineageKey)
    expect(first.lineageKey).toBe(
      buildMarketObservationLineageKey({
        rawRecordId: rawRecord.id,
        payloadHash: rawRecord.payloadHash,
        translationSchemaVersion: 'market-observation.v1',
        observationType: 'EXTERNAL_OFFER',
      }),
    )
  })

  it('changes the lineage key when the immutable source payload version changes', async () => {
    const first = await translateRawRecordToMarketObservation(rawRecord, {
      extractCandidate: extractor,
    })
    const changed = await translateRawRecordToMarketObservation(
      { ...rawRecord, payloadHash: 'b'.repeat(64) },
      { extractCandidate: extractor },
    )

    expect(changed.lineageKey).not.toBe(first.lineageKey)
  })

  it('does not mutate Integration-owned raw evidence on success', async () => {
    const before = structuredClone(rawRecord)

    await translateRawRecordToMarketObservation(rawRecord, {
      extractCandidate: extractor,
    })

    expect(rawRecord).toEqual(before)
  })

  it('does not mutate Integration-owned raw evidence when translation fails', async () => {
    const before = structuredClone(rawRecord)

    await expect(
      translateRawRecordToMarketObservation(rawRecord, {
        extractCandidate: async () => {
          throw new Error('translator failed')
        },
      }),
    ).rejects.toThrow('translator failed')

    expect(rawRecord).toEqual(before)
  })

  it('rejects malformed raw evidence before extractor execution', async () => {
    const extractCandidate = vi.fn()

    await expect(
      translateRawRecordToMarketObservation(
        { ...rawRecord, payloadJson: '{bad-json' },
        { extractCandidate },
      ),
    ).rejects.toThrow(/invalid JSON/i)

    expect(extractCandidate).not.toHaveBeenCalled()
  })

  it('rejects invalid resolver confidence instead of silently accepting bad evidence', async () => {
    await expect(
      translateRawRecordToMarketObservation(rawRecord, {
        extractCandidate: extractor,
        knowledgeResolver: async () => ({
          status: MARKET_RESOLUTION_STATUS.RESOLVED,
          canonicalProductRef: 'gks:product:rtx-3060',
          confidence: 1.5,
        }),
      }),
    ).rejects.toThrow(/confidence/i)
  })
})

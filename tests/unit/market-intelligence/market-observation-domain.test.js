import { describe, expect, it } from 'vitest'

import {
  MARKET_RESOLUTION_STATUS,
  normalizeMarketObservationDraft,
  zMarketObservationDraft,
} from '@/modules/market-intelligence/domain/market-observation'

const validDraft = {
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
  resolutionStatus: MARKET_RESOLUTION_STATUS.UNRESOLVED,
  resolutionConfidence: null,
  observedAt: new Date('2026-08-20T00:00:00.000Z'),
  translatedAt: new Date('2026-08-20T00:01:00.000Z'),
  lineageKey: 'b'.repeat(64),
}

describe('MarketObservation domain schema (#76)', () => {
  it('accepts the canonical provider-neutral observation shape', () => {
    expect(zMarketObservationDraft.safeParse(validDraft).success).toBe(true)
    expect(normalizeMarketObservationDraft(validDraft)).toMatchObject({
      tenantId: 'tenant-a',
      resolutionStatus: 'UNRESOLVED',
    })
  })

  it('rejects unknown fields so source payload shape cannot leak into Market persistence', () => {
    expect(zMarketObservationDraft.safeParse({
      ...validDraft,
      facebookGroupId: 'source-specific-field',
    }).success).toBe(false)
  })

  it('requires SHA-256 source and lineage identities', () => {
    expect(zMarketObservationDraft.safeParse({
      ...validDraft,
      sourcePayloadHash: 'short',
    }).success).toBe(false)

    expect(zMarketObservationDraft.safeParse({
      ...validDraft,
      lineageKey: 'short',
    }).success).toBe(false)
  })

  it('rejects malformed candidate JSON', () => {
    expect(() => normalizeMarketObservationDraft({
      ...validDraft,
      candidateJson: '{bad-json',
    })).toThrow(/candidateJson/i)
  })

  it('requires candidateJson to encode an object, not a scalar or array', () => {
    expect(() => normalizeMarketObservationDraft({
      ...validDraft,
      candidateJson: '[]',
    })).toThrow(/candidate/i)

    expect(() => normalizeMarketObservationDraft({
      ...validDraft,
      candidateJson: '"RTX 3060"',
    })).toThrow(/candidate/i)
  })

  it('rejects invalid resolution status and confidence', () => {
    expect(zMarketObservationDraft.safeParse({
      ...validDraft,
      resolutionStatus: 'GUESSED',
    }).success).toBe(false)

    expect(zMarketObservationDraft.safeParse({
      ...validDraft,
      resolutionConfidence: -0.1,
    }).success).toBe(false)
  })

  it('does not allow RESOLVED without a canonical identity reference', () => {
    const result = zMarketObservationDraft.safeParse({
      ...validDraft,
      resolutionStatus: MARKET_RESOLUTION_STATUS.RESOLVED,
      resolutionConfidence: 0.99,
    })

    expect(result.success).toBe(false)
  })

  it('does not allow UNRESOLVED to carry a canonical identity reference', () => {
    const result = zMarketObservationDraft.safeParse({
      ...validDraft,
      canonicalProductRef: 'gks:business-knowledge:KN-RTX3060',
    })

    expect(result.success).toBe(false)
  })

  it('accepts RESOLVED when a governed canonical reference exists', () => {
    expect(zMarketObservationDraft.safeParse({
      ...validDraft,
      resolutionStatus: MARKET_RESOLUTION_STATUS.RESOLVED,
      canonicalProductRef: 'gks:business-knowledge:KN-RTX3060',
      resolutionConfidence: 1,
    }).success).toBe(true)
  })
})

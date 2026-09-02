import { describe, expect, it, vi } from 'vitest'

import { makeViewer, ownsElsewhere } from '../../factories/viewer'
import {
  MARKET_OBSERVATION_FEED_LIMIT,
  MARKET_OBSERVATION_FEED_MAX_LIMIT,
  getMarketObservationFeed,
  parseMarketObservationFeedQuery,
} from '@/modules/market-intelligence/application/market-observation-service'

// @req FR-092 — the `/market` read contract: the authorization gate, the scope the
// repository is built with, and the row shape the surface renders.
// @spec SDD-049, BR-001, SEC-001, ADR-038
//
// The repository is a fake here on purpose. What this suite is for is the decisions
// the application layer owns — who may read, which scope the adapter is handed, and
// what an untrustworthy candidate payload is allowed to become on a page. The Prisma
// behaviour behind `listRecent` is proved against a real database in
// tests/integration/market-intelligence-observation-feed.test.js.

const BUSINESS = { id: 'b-1', tenantId: 't-1', name: 'ร้านทดสอบ' }

const observationRow = (over = {}) => ({
  id: 'obs-1',
  provider: 'FACEBOOK_MARKETPLACE',
  observationType: 'EXTERNAL_OFFER',
  sourceEntityType: 'LISTING',
  externalId: 'listing-1',
  sourceUri: 'https://market.example/listing/1',
  translationSchemaVersion: 'market-observation.v1',
  resolutionStatus: 'UNRESOLVED',
  resolutionConfidence: null,
  canonicalProductRef: null,
  canonicalCategoryRef: null,
  candidateJson: JSON.stringify({ title: 'RTX 3060 12GB', price: 4900, currency: 'THB' }),
  observedAt: new Date('2026-08-20T00:00:00.000Z'),
  translatedAt: new Date('2026-08-20T00:01:00.000Z'),
  ...over,
})

function harness({ rows = [observationRow()], business = BUSINESS } = {}) {
  const listRecent = vi.fn(async () => rows)
  const createRepository = vi.fn(() => ({ listRecent }))
  const findUnique = vi.fn(async () => business)
  const db = { business: { findUnique } }
  return { db, createRepository, listRecent, findUnique }
}

describe('parseMarketObservationFeedQuery (FR-092)', () => {
  it('requires a businessId and defaults the limit', () => {
    expect(parseMarketObservationFeedQuery({ businessId: ' b-1 ' }))
      .toEqual({ businessId: 'b-1', limit: MARKET_OBSERVATION_FEED_LIMIT })
    expect(() => parseMarketObservationFeedQuery({})).toThrow()
    expect(() => parseMarketObservationFeedQuery({ businessId: '   ' })).toThrow()
  })

  it('caps the limit server-side and refuses an unknown parameter', () => {
    expect(parseMarketObservationFeedQuery({ businessId: 'b-1', limit: '99999' }).limit)
      .toBe(MARKET_OBSERVATION_FEED_MAX_LIMIT)
    // A caller cannot smuggle a filter the reader never promised to honour.
    expect(() => parseMarketObservationFeedQuery({ businessId: 'b-1', tenantId: 't-9' })).toThrow()
  })
})

describe('getMarketObservationFeed (FR-092)', () => {
  it('refuses a Business the viewer cannot see, before any query runs', async () => {
    const { db, createRepository, findUnique } = harness()
    const viewer = makeViewer({ visibleBusinessIds: ['b-other'] })

    await expect(getMarketObservationFeed({ viewer, businessId: 'b-1' }, { db, createRepository }))
      .rejects.toMatchObject({ status: 403 })
    expect(findUnique).not.toHaveBeenCalled()
    expect(createRepository).not.toHaveBeenCalled()
  })

  it('reads for a viewer who only SEES the Business — ownership is not required to read', async () => {
    const { db, createRepository } = harness()
    // OWNER of one Business, merely a member of the one being read: the shape that
    // hid three authorization holes. Reading market evidence is not a write, so this
    // viewer is allowed through — and the test says so explicitly rather than leaving
    // it to whichever predicate was reached for.
    const viewer = ownsElsewhere({ owns: 'b-owned', sees: 'b-1' })

    const result = await getMarketObservationFeed({ viewer, businessId: 'b-1' }, { db, createRepository })

    expect(result.observations).toHaveLength(1)
    expect(result.scope).toEqual({ businessId: 'b-1', businessName: 'ร้านทดสอบ', tenantId: 't-1' })
  })

  it('answers 404 for a Business the viewer may see but which does not exist', async () => {
    const { db, createRepository } = harness({ business: null })
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'] })

    await expect(getMarketObservationFeed({ viewer, businessId: 'b-1' }, { db, createRepository }))
      .rejects.toMatchObject({ status: 404 })
    expect(createRepository).not.toHaveBeenCalled()
  })

  it('builds the repository with the tenant read from the Business row, never from the caller', async () => {
    const { db, createRepository, listRecent } = harness()
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'] })

    await getMarketObservationFeed({ viewer, businessId: 'b-1', limit: 7 }, { db, createRepository })

    expect(createRepository).toHaveBeenCalledWith(db, { tenantId: 't-1', businessId: 'b-1' })
    expect(listRecent).toHaveBeenCalledWith({ limit: 7 })
  })

  it('normalizes the candidate into renderable fields and counts what it actually returned', async () => {
    const { db, createRepository } = harness({
      rows: [
        observationRow({ id: 'a', resolutionStatus: 'RESOLVED', canonicalProductRef: 'prd-1', resolutionConfidence: 0.9 }),
        observationRow({ id: 'b', provider: 'RETAIL_LOTUS', candidateJson: JSON.stringify({ name: 'น้ำส้ม 250ml', unitPrice: 26, currency: 'THB', sellerName: "Lotus's" }) }),
      ],
    })
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'] })

    const result = await getMarketObservationFeed({ viewer, businessId: 'b-1' }, { db, createRepository })

    expect(result.counts).toEqual({
      observations: 2,
      providers: 2,
      byResolutionStatus: { RESOLVED: 1, UNRESOLVED: 1 },
    })
    expect(result.observations[0]).toMatchObject({ title: 'RTX 3060 12GB', price: 4900, currency: 'THB' })
    expect(result.observations[1]).toMatchObject({ title: 'น้ำส้ม 250ml', price: 26, seller: "Lotus's" })
    expect(result.observations[0].observedAt).toBe('2026-08-20T00:00:00.000Z')
    expect(result.truncated).toBe(false)
  })

  it('never invents a title or a price when the candidate does not carry one', async () => {
    // The candidate is external payload. A page that filled in a plausible-looking
    // title here would be the fixture problem again, one row at a time.
    const { db, createRepository } = harness({
      rows: [observationRow({ candidateJson: JSON.stringify({ title: 42, price: 'ถูกมาก' }) })],
    })
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'] })

    const [row] = (await getMarketObservationFeed({ viewer, businessId: 'b-1' }, { db, createRepository })).observations

    expect(row.title).toBeNull()
    expect(row.price).toBeNull()
    expect(row.externalId).toBe('listing-1')
  })

  it('degrades one unreadable candidate to null instead of failing the whole page', async () => {
    const { db, createRepository } = harness({ rows: [observationRow({ candidateJson: 'not json' })] })
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'] })

    const result = await getMarketObservationFeed({ viewer, businessId: 'b-1' }, { db, createRepository })

    expect(result.observations).toHaveLength(1)
    expect(result.observations[0].candidate).toBeNull()
    expect(result.observations[0].title).toBeNull()
  })

  it('reports truncation when the page filled the requested limit', async () => {
    const { db, createRepository } = harness({
      rows: [observationRow({ id: 'a' }), observationRow({ id: 'b' })],
    })
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'] })

    const result = await getMarketObservationFeed({ viewer, businessId: 'b-1', limit: 2 }, { db, createRepository })

    expect(result.truncated).toBe(true)
  })

  it('refuses to run without an injected database and repository factory', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'] })
    await expect(getMarketObservationFeed({ viewer, businessId: 'b-1' }, {})).rejects.toThrow(/Prisma client/)
    await expect(getMarketObservationFeed({ viewer, businessId: 'b-1' }, { db: harness().db }))
      .rejects.toThrow(/repository factory/)
  })
})

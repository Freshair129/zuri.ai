import { describe, expect, it, vi } from 'vitest'

import { makeViewer, ownsElsewhere } from '../../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import {
  parseMarketTranslationRunInput,
  runMarketTranslationForBusiness,
} from '@/modules/market-intelligence/application/market-observation-service'

// @req FR-092 — the production translation trigger's application seam:
// `runMarketTranslationForBusiness` (the service `POST /api/market/translations`
// calls) and its request parser. The route wiring and the real-database path are
// proved separately — this suite is about the authorization gate, the candidate
// filtering and the run's own bookkeeping (counts, failures, one audit event).
// @spec SDD-049, BR-001, SEC-001, SEC-017, ADR-038
// @tested tests/unit/market-intelligence/market-translation-run.test.js,
//   tests/unit/market-intelligence/market-translations-route.test.js,
//   tests/integration/market-intelligence-translation-run.test.js

function createObservationRepository({ alreadyTranslated = [] } = {}) {
  const rows = new Map()
  return {
    alreadyTranslated: new Set(alreadyTranslated),
    findTranslatedRawRecordIds: vi.fn(async function findTranslatedRawRecordIds(ids) {
      return ids.filter((id) => this.alreadyTranslated.has(id))
    }),
    insertIfAbsent: vi.fn(async (draft) => {
      const existing = rows.get(draft.lineageKey)
      if (existing) return { status: 'UNCHANGED', observation: existing }
      const row = { id: `obs-${rows.size + 1}`, ...draft }
      rows.set(draft.lineageKey, row)
      return { status: 'CREATED', observation: row }
    }),
  }
}

function rawRecord(id, overrides = {}) {
  return {
    id,
    tenantId: 'tenant-a',
    businessId: 'business-a',
    connectionId: 'conn-a',
    provider: 'MARKET_TEST',
    entityType: 'LISTING',
    externalId: `listing-${id}`,
    payloadJson: JSON.stringify({ title: `Item ${id}`, price: 100 }),
    payloadHash: 'a'.repeat(64),
    receivedAt: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  }
}

const extractCandidate = async ({ payload }) => ({
  observationType: 'EXTERNAL_OFFER',
  candidate: { title: payload.title, price: payload.price },
})

function createDb({ business = { id: 'business-a', tenantId: 'tenant-a' } } = {}) {
  return {
    business: { findUnique: vi.fn(async () => business) },
    auditEvent: { create: vi.fn(async (args) => args) },
  }
}

const viewer = makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })

describe('parseMarketTranslationRunInput', () => {
  it('requires businessId', () => {
    expect(() => parseMarketTranslationRunInput({})).toThrow()
  })

  it('defaults and caps the limit', () => {
    expect(parseMarketTranslationRunInput({ businessId: 'business-a' }).limit).toBe(20)
    expect(parseMarketTranslationRunInput({ businessId: 'business-a', limit: 5 }).limit).toBe(5)
    expect(parseMarketTranslationRunInput({ businessId: 'business-a', limit: 100000 }).limit).toBe(100)
  })
})

describe('runMarketTranslationForBusiness (FR-092)', () => {
  it('translates every eligible untranslated candidate and records one audit event', async () => {
    const db = createDb()
    const repository = createObservationRepository()
    const createRepository = vi.fn(() => repository)
    const candidates = [rawRecord('raw-1'), rawRecord('raw-2')]
    const listCandidates = vi.fn(async () => candidates)

    const result = await runMarketTranslationForBusiness(
      { viewer, businessId: 'business-a', limit: 10 },
      { db, createRepository, listCandidates, extractCandidate },
    )

    expect(createRepository).toHaveBeenCalledWith(db, { tenantId: 'tenant-a', businessId: 'business-a' })
    expect(result).toEqual({ translated: 2, unchanged: 0, failed: [] })
    expect(db.auditEvent.create).toHaveBeenCalledTimes(1)
    const [[auditCall]] = db.auditEvent.create.mock.calls
    expect(auditCall.data.entityType).toBe('MarketObservation')
    expect(auditCall.data.action).toBe('MARKET_TRANSLATION_RUN')
    const payload = JSON.parse(auditCall.data.payloadJson)
    expect(payload).toMatchObject({ businessId: 'business-a', translated: 2, unchanged: 0, failed: 0 })
  })

  it('excludes raw records that already have a MarketObservation from this run', async () => {
    const db = createDb()
    const repository = createObservationRepository({ alreadyTranslated: ['raw-1'] })
    const listCandidates = vi.fn(async () => [rawRecord('raw-1'), rawRecord('raw-2')])

    const result = await runMarketTranslationForBusiness(
      { viewer, businessId: 'business-a', limit: 10 },
      { db, createRepository: () => repository, listCandidates, extractCandidate },
    )

    expect(repository.findTranslatedRawRecordIds).toHaveBeenCalledWith(['raw-1', 'raw-2'])
    expect(result.translated).toBe(1)
  })

  it('reports UNCHANGED when the persistence layer replays the same lineage identity', async () => {
    const db = createDb()
    const repository = createObservationRepository()
    const listCandidates = vi.fn(async () => [rawRecord('raw-1')])

    const first = await runMarketTranslationForBusiness(
      { viewer, businessId: 'business-a', limit: 10 },
      { db, createRepository: () => repository, listCandidates, extractCandidate },
    )
    // Second run against the same (not-yet-marked-translated, from this fake's
    // perspective) candidate exercises the atomic insertIfAbsent path directly.
    const second = await runMarketTranslationForBusiness(
      { viewer, businessId: 'business-a', limit: 10 },
      { db, createRepository: () => repository, listCandidates, extractCandidate },
    )

    expect(first.translated).toBe(1)
    expect(second.unchanged).toBe(1)
    expect(second.translated).toBe(0)
  })

  it('honours the limit against the filtered eligible set, not the raw candidate scan', async () => {
    const db = createDb()
    const repository = createObservationRepository()
    const listCandidates = vi.fn(async () => [rawRecord('raw-1'), rawRecord('raw-2'), rawRecord('raw-3')])

    const result = await runMarketTranslationForBusiness(
      { viewer, businessId: 'business-a', limit: 1 },
      { db, createRepository: () => repository, listCandidates, extractCandidate },
    )

    expect(result.translated).toBe(1)
  })

  it('records a per-row failure without aborting the rest of the run', async () => {
    const db = createDb()
    const repository = createObservationRepository()
    const listCandidates = vi.fn(async () => [rawRecord('raw-1'), rawRecord('raw-2')])
    const flakyExtractor = vi.fn(async ({ source }) => {
      if (source.externalId === 'listing-raw-1') throw new Error('bad payload')
      return { observationType: 'EXTERNAL_OFFER', candidate: { title: 'ok' } }
    })

    const result = await runMarketTranslationForBusiness(
      { viewer, businessId: 'business-a', limit: 10 },
      { db, createRepository: () => repository, listCandidates, extractCandidate: flakyExtractor },
    )

    expect(result.translated).toBe(1)
    expect(result.failed).toEqual([{ rawRecordId: 'raw-1', reason: 'bad payload' }])
  })

  it('never invents a canonical identity when no knowledgeResolver is configured (fail-closed)', async () => {
    const db = createDb()
    const repository = createObservationRepository()
    const listCandidates = vi.fn(async () => [rawRecord('raw-1')])

    await runMarketTranslationForBusiness(
      { viewer, businessId: 'business-a', limit: 10 },
      { db, createRepository: () => repository, listCandidates, extractCandidate },
    )

    const [[draft]] = repository.insertIfAbsent.mock.calls
    expect(draft.resolutionStatus).toBe('UNRESOLVED')
    expect(draft.canonicalProductRef).toBeNull()
  })

  it('refuses a viewer who does not own the Business, 404-shaped like a nonexistent one', async () => {
    const db = createDb()
    const listCandidates = vi.fn()
    const attacker = ownsElsewhere({ visibleDomains: [...VIEWER_DOMAINS], owns: 'business-elsewhere', sees: 'business-a' })

    await expect(
      runMarketTranslationForBusiness(
        { viewer: attacker, businessId: 'business-a', limit: 10 },
        { db, createRepository: vi.fn(), listCandidates, extractCandidate },
      ),
    ).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    expect(listCandidates).not.toHaveBeenCalled()
    expect(db.auditEvent.create).not.toHaveBeenCalled()
  })

  it('answers a nonexistent Business with the identical message and status', async () => {
    const db = createDb({ business: null })
    const listCandidates = vi.fn()

    await expect(
      runMarketTranslationForBusiness(
        { viewer, businessId: 'business-missing', limit: 10 },
        { db, createRepository: vi.fn(), listCandidates, extractCandidate },
      ),
    ).rejects.toMatchObject({ status: 404, message: 'Business not found' })
  })

  it('does nothing and still records the audit event when there is no backlog', async () => {
    const db = createDb()
    const repository = createObservationRepository()
    const listCandidates = vi.fn(async () => [])

    const result = await runMarketTranslationForBusiness(
      { viewer, businessId: 'business-a', limit: 10 },
      { db, createRepository: () => repository, listCandidates, extractCandidate },
    )

    expect(result).toEqual({ translated: 0, unchanged: 0, failed: [] })
    expect(repository.findTranslatedRawRecordIds).not.toHaveBeenCalled()
    expect(db.auditEvent.create).toHaveBeenCalledTimes(1)
  })
})

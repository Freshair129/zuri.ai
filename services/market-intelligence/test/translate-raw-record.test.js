import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MARKET_RESOLUTION_STATUS,
  buildMarketObservationLineageKey,
  translateRawRecordToMarketObservation,
} from '../src/index.js'
import { rawRecord } from './fakes.js'

const extractor = async ({ payload }) => ({
  observationType: 'EXTERNAL_OFFER',
  candidate: { title: payload.title, tenantId: payload.tenantId },
})

test('scope and lineage come only from the raw envelope, never the payload or extractor', async () => {
  const raw = rawRecord({ payloadJson: JSON.stringify({ title: 'T', tenantId: 'tenant-evil', businessId: 'business-evil' }) })
  const draft = await translateRawRecordToMarketObservation(raw, {
    extractCandidate: async () => ({ observationType: 'EXTERNAL_OFFER', candidate: { title: 'T' }, tenantId: 'x', businessId: 'y' }),
  })
  assert.equal(draft.tenantId, raw.tenantId)
  assert.equal(draft.businessId, raw.businessId)
  assert.equal(draft.connectionId, raw.connectionId)
  assert.equal(draft.sourcePayloadHash, raw.payloadHash)
})

test('replay of the same raw record yields the same lineage key', async () => {
  const options = { extractCandidate: extractor, now: () => new Date('2026-09-24T00:00:00Z') }
  const first = await translateRawRecordToMarketObservation(rawRecord(), options)
  const second = await translateRawRecordToMarketObservation(rawRecord(), { ...options, now: () => new Date('2026-09-25T00:00:00Z') })
  assert.equal(first.lineageKey, second.lineageKey)
})

test('a new translation schema version is a new lineage identity', () => {
  const parts = { rawRecordId: 'r', payloadHash: 'a'.repeat(64), observationType: 'EXTERNAL_OFFER' }
  assert.notEqual(
    buildMarketObservationLineageKey({ ...parts, translationSchemaVersion: 'market-observation.v1' }),
    buildMarketObservationLineageKey({ ...parts, translationSchemaVersion: 'market-observation.v2' }),
  )
})

test('absent resolver is a truthful UNRESOLVED, never a fabricated identity', async () => {
  const draft = await translateRawRecordToMarketObservation(rawRecord(), { extractCandidate: extractor })
  assert.equal(draft.resolutionStatus, MARKET_RESOLUTION_STATUS.UNRESOLVED)
  assert.equal(draft.canonicalProductRef, null)
  assert.equal(draft.resolutionConfidence, null)
})

test('a resolver error is not swallowed into UNRESOLVED', async () => {
  await assert.rejects(
    translateRawRecordToMarketObservation(rawRecord(), {
      extractCandidate: extractor,
      knowledgeResolver: async () => { throw new Error('knowledge reader unavailable') },
    }),
    /knowledge reader unavailable/,
  )
})

test('observedAt keeps source time; translatedAt is processing time', async () => {
  const draft = await translateRawRecordToMarketObservation(rawRecord(), {
    extractCandidate: async () => ({ observationType: 'EXTERNAL_OFFER', candidate: {}, observedAt: '2026-08-01T00:00:00Z' }),
    now: () => new Date('2026-09-24T00:00:00Z'),
  })
  assert.equal(draft.observedAt.toISOString(), '2026-08-01T00:00:00.000Z')
  assert.equal(draft.translatedAt.toISOString(), '2026-09-24T00:00:00.000Z')
})

test('extractor without observationType or candidate object is rejected', async () => {
  await assert.rejects(
    translateRawRecordToMarketObservation(rawRecord(), { extractCandidate: async () => ({ candidate: {} }) }),
    /observationType/,
  )
  await assert.rejects(
    translateRawRecordToMarketObservation(rawRecord(), { extractCandidate: async () => ({ observationType: 'X', candidate: [] }) }),
    /candidate object/,
  )
})

test('an extractor port is required', async () => {
  await assert.rejects(translateRawRecordToMarketObservation(rawRecord(), {}), /extractCandidate port is required/)
})

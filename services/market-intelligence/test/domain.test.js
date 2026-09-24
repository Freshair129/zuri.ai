import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeMarketObservationDraft } from '../src/index.js'

const draft = {
  tenantId: 't',
  businessId: null,
  rawRecordId: 'r',
  connectionId: 'c',
  provider: 'P',
  sourceEntityType: 'listing',
  externalId: 'e',
  sourcePayloadHash: 'a'.repeat(64),
  sourceUri: null,
  translationSchemaVersion: 'market-observation.v1',
  observationType: 'EXTERNAL_OFFER',
  candidateJson: '{}',
  canonicalProductRef: null,
  canonicalCategoryRef: null,
  resolutionStatus: 'UNRESOLVED',
  resolutionConfidence: null,
  observedAt: new Date(),
  translatedAt: new Date(),
  lineageKey: 'b'.repeat(64),
}

test('businessId must be explicit: omitted is not the same as null', () => {
  assert.doesNotThrow(() => normalizeMarketObservationDraft(draft))
  const { businessId, ...omitted } = draft
  assert.throws(() => normalizeMarketObservationDraft(omitted))
})

test('unmodelled fields cannot be smuggled into Market state', () => {
  assert.throws(() => normalizeMarketObservationDraft({ ...draft, role: 'OWNER' }))
})

test('RESOLVED needs a canonical reference and UNRESOLVED must not carry one', () => {
  assert.throws(() => normalizeMarketObservationDraft({ ...draft, resolutionStatus: 'RESOLVED' }), /RESOLVED requires/)
  assert.throws(() => normalizeMarketObservationDraft({ ...draft, canonicalProductRef: 'gks:x' }), /UNRESOLVED cannot/)
  assert.doesNotThrow(() => normalizeMarketObservationDraft({ ...draft, resolutionStatus: 'RESOLVED', canonicalProductRef: 'gks:x' }))
})

test('hashes and candidate JSON are validated', () => {
  assert.throws(() => normalizeMarketObservationDraft({ ...draft, sourcePayloadHash: 'nope' }))
  assert.throws(() => normalizeMarketObservationDraft({ ...draft, candidateJson: '[1]' }), /candidateJson is invalid/)
})

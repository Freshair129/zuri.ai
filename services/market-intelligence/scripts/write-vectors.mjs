import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  extractGenericMarketCandidate,
  toFeedRow,
  translateRawRecordToMarketObservation,
} from '../src/index.js'

// Writes contracts/v1/translation-vectors.json: fixed inputs and the outputs this
// core produces for them. apps/server's parity test replays the SAME inputs through
// the legacy module and must get the SAME outputs, which is how two copies of the
// translation core are kept identical until M3 removes one.
//
// Regenerate only when translation semantics change on purpose, and then bump
// translationSchemaVersion: a changed vector under an unchanged version means old
// lineage keys no longer describe the rows they were written for.
// @req FR-092
// @spec SDD-049, ADR-038

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NOW = '2026-09-24T01:00:00.000Z'
const HASH = 'b'.repeat(64)

const base = {
  id: 'raw-v1',
  tenantId: 'tenant-t',
  businessId: 'business-a',
  connectionId: 'conn-a',
  provider: 'MARKET_TEST',
  lane: 'MARKET_INTELLIGENCE',
  entityType: 'listing',
  externalId: 'listing-1',
  sourceType: 'PULL',
  sourceUri: 'https://example.invalid/listing-1',
  schemaVersion: 'market.test.listing.v1',
  payloadJson: JSON.stringify({ title: 'GALAX RTX 3060 12GB', price: 4900, currency: 'THB', sellerName: 'Shop 1' }),
  payloadHash: HASH,
  receivedAt: '2026-09-20T03:00:00.000Z',
}

const translationCases = [
  { name: 'listing-unresolved', raw: base, resolution: null },
  {
    name: 'retail-price-resolved',
    raw: { ...base, id: 'raw-v2', entityType: 'retail_price', externalId: 'sku-9',
      payloadJson: JSON.stringify({ productName: 'Thai Jasmine Rice 5kg', sku: 'RICE-5', unitPrice: 245, currency: 'THB', unit: 'bag', inStock: true }) },
    resolution: { status: 'RESOLVED', canonicalProductRef: 'gks:business-knowledge:k-1', canonicalCategoryRef: null, confidence: 1 },
  },
  {
    name: 'unknown-entity-null-business-partial',
    raw: { ...base, id: 'raw-v3', businessId: null, entityType: 'forum_post', sourceUri: null,
      payloadJson: JSON.stringify({ name: 'Used GPU', seller: 'someone' }) },
    resolution: { status: 'PARTIAL', canonicalProductRef: null, canonicalCategoryRef: null, confidence: null },
  },
  {
    name: 'spoofed-scope-in-payload-is-ignored',
    raw: { ...base, id: 'raw-v4',
      payloadJson: JSON.stringify({ tenantId: 'tenant-evil', businessId: 'business-evil', connectionId: 'conn-evil', title: 'X', price: 1 }) },
    resolution: null,
  },
  {
    name: 'no-received-at-uses-translated-at',
    raw: { ...base, id: 'raw-v5', receivedAt: null },
    resolution: null,
  },
  { name: 'invalid-payload-json', raw: { ...base, id: 'raw-v6', payloadJson: '{not json' }, resolution: null, errorIncludes: 'RawExternalRecord.payloadJson is invalid JSON' },
  { name: 'missing-payload-hash', raw: { ...base, id: 'raw-v7', payloadHash: '' }, resolution: null, errorIncludes: 'RawExternalRecord.payloadHash is required' },
  {
    name: 'resolved-without-reference-is-rejected',
    raw: { ...base, id: 'raw-v8' },
    resolution: { status: 'RESOLVED', canonicalProductRef: null, canonicalCategoryRef: null, confidence: 1 },
    errorIncludes: 'RESOLVED requires at least one canonical identity reference',
  },
]

function revive(raw) {
  return { ...raw, receivedAt: raw.receivedAt ? new Date(raw.receivedAt) : raw.receivedAt }
}

function serialize(draft) {
  return { ...draft, observedAt: draft.observedAt.toISOString(), translatedAt: draft.translatedAt.toISOString() }
}

const translations = []
for (const testCase of translationCases) {
  const { errorIncludes, ...entry } = testCase
  try {
    const draft = await translateRawRecordToMarketObservation(revive(testCase.raw), {
      extractCandidate: extractGenericMarketCandidate,
      knowledgeResolver: testCase.resolution ? async () => testCase.resolution : undefined,
      now: () => new Date(NOW),
    })
    if (errorIncludes) throw new Error(`${testCase.name}: expected an error, got a draft`)
    entry.expected = serialize(draft)
  } catch (error) {
    if (!errorIncludes || !error.message.includes(errorIncludes)) throw error
    entry.expectedErrorIncludes = errorIncludes
  }
  translations.push(entry)
}

const row = {
  id: 'obs-1',
  provider: 'MARKET_TEST',
  observationType: 'EXTERNAL_OFFER',
  sourceEntityType: 'listing',
  externalId: 'listing-1',
  sourceUri: null,
  translationSchemaVersion: 'market-observation.v1',
  resolutionStatus: 'UNRESOLVED',
  resolutionConfidence: null,
  canonicalProductRef: null,
  canonicalCategoryRef: null,
  observedAt: '2026-09-20T03:00:00.000Z',
  translatedAt: NOW,
}
const feedCases = [
  { name: 'full-candidate', row: { ...row, candidateJson: JSON.stringify({ title: '  GPU  ', price: 10, currency: 'THB', sellerName: 'S', condition: 'used' }) } },
  { name: 'fallback-fields', row: { ...row, candidateJson: JSON.stringify({ productTitle: 'P', unitPrice: 5, price: 9, seller: 'T' }) } },
  { name: 'non-finite-price-and-blank-title', row: { ...row, candidateJson: JSON.stringify({ title: '   ', price: '12' }) } },
  { name: 'corrupt-candidate-json', row: { ...row, candidateJson: '{oops' } },
  { name: 'array-candidate', row: { ...row, candidateJson: '[1,2]' } },
]
const feedRows = feedCases.map((testCase) => ({ ...testCase, expected: toFeedRow(testCase.row) }))

const vectors = {
  contract: 'market-intelligence.translation-vectors',
  version: 1,
  translationSchemaVersion: 'market-observation.v1',
  now: NOW,
  extractor: 'generic-candidate-extractor',
  translations,
  feedRows,
}

await writeFile(path.join(root, 'contracts', 'v1', 'translation-vectors.json'), `${JSON.stringify(vectors, null, 2)}\n`)
process.stdout.write(`wrote ${translations.length} translation and ${feedRows.length} feed vectors\n`)

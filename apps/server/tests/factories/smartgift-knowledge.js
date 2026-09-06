// SmartGift business-knowledge fixture — the compliant stand-in for the retired
// GenesisBlockDB seed.
//
// Until ADR-063 D2a, the SmartGift webhook e2e test seeded the curated catalog
// through `seedSmartGiftKnowledge`, which required a `GenesisDatabase` instance
// and called addNode / addEdge / flushIndex / hybridSearch — a Tier 4 client
// living in Tier 1 (ADR-043 D2.1, ADR-050 D3). This factory replaces it with the
// thing Tier 1 actually owns: the PUBLIC business-knowledge projection (FR-047)
// behind the in-memory knowledge reader the agent already consumes. No node, no
// edge, no index, no embedding — records in, a registered query out.
//
// @spec ADR-063, FR-047, SEC-009 — records carry no price and no live fact; the
//   reader serves only PUBLIC rows for the one Business named.
// @tested tests/integration/smartgift-webhook-e2e.test.js

import { createHash } from 'node:crypto'
import {
  SMARTGIFT_CATEGORIES,
  SMARTGIFT_POLICIES,
  SMARTGIFT_PRODUCTS,
} from '@/modules/knowledge/smartgift-knowledge-catalog'
import { createInMemoryBusinessKnowledgeReader } from '@/modules/knowledge/business-contract'

const AS_OF = '2026-09-06T00:00:00.000Z'

/**
 * Map the curated SmartGift catalog onto business-knowledge records for one Business.
 * Categories become the record's `category`; the sample/mockup policy rides in
 * `specification` so a grounded answer can cite it; prices stay null on purpose.
 * @param {string} businessId
 */
export function smartGiftBusinessKnowledgeRecords(businessId) {
  const categories = new Map(SMARTGIFT_CATEGORIES.map((category) => [category.id, category]))
  const samplePolicy = SMARTGIFT_POLICIES.find((policy) => policy.id === 'policy:sg-sample-mockup')

  return SMARTGIFT_PRODUCTS.map((product) => ({
    knowledge_id: `sg:${product.id}`,
    business_id: businessId,
    knowledge_type: 'PRODUCT',
    product_code: product.code,
    name: product.title,
    category: categories.get(product.categoryId)?.title ?? null,
    description: product.text,
    unit: 'ชิ้น',
    sell_price: null,
    currency: null,
    moq: product.moq,
    colors: [],
    specification: {
      lead_time_days: product.leadTimeDays,
      printing_methods: (product.printingMethods ?? []).join(', '),
      sample_policy: samplePolicy?.text ?? null,
    },
    source_ref: `catalog:${product.id}`,
    source_sha256: createHash('sha256').update(JSON.stringify(product)).digest('hex'),
    as_of: AS_OF,
    approved_at: AS_OF,
    is_active: true,
    sensitivity: 'PUBLIC',
    contract_version: '1.0.0',
  }))
}

/** The knowledge port a SmartGift turn reads from in tests. */
export function createSmartGiftKnowledgeReader(businessId) {
  return createInMemoryBusinessKnowledgeReader(smartGiftBusinessKnowledgeRecords(businessId))
}

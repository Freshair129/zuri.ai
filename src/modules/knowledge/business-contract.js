import { z } from 'zod'

// @req FR-047 — curated business knowledge is a strict public projection behind registered reads.
// @spec SDD-025, SEC-009 — adapters may change; the allowlist and query contract do not.
// @tested tests/unit/business-knowledge-contract.test.js

export const PUBLIC_BUSINESS_KNOWLEDGE_FIELDS = Object.freeze([
  'knowledge_id',
  'business_id',
  'knowledge_type',
  'product_code',
  'name',
  'category',
  'description',
  'unit',
  'sell_price',
  'currency',
  'moq',
  'colors',
  'specification',
  'source_ref',
  'source_sha256',
  'as_of',
  'approved_at',
  'is_active',
  'sensitivity',
  'contract_version',
])

const nullableText = z.string().trim().max(4000).nullable()

const zBusinessKnowledgeRecord = z.object({
  knowledge_id: z.string().min(1).max(240),
  business_id: z.string().min(1).max(120),
  knowledge_type: z.literal('PRODUCT'),
  product_code: z.string().min(1).max(120),
  name: z.string().min(1).max(500),
  category: nullableText,
  description: nullableText,
  unit: nullableText,
  sell_price: z.number().nonnegative().nullable(),
  currency: z.string().trim().min(3).max(3).nullable(),
  moq: z.number().int().nonnegative().nullable(),
  colors: z.array(z.string().trim().min(1).max(120)).max(40),
  specification: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  source_ref: z.string().min(1).max(1000),
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  as_of: z.string().datetime(),
  approved_at: z.string().datetime(),
  is_active: z.literal(true),
  sensitivity: z.literal('PUBLIC'),
  contract_version: z.literal('1.0.0'),
}).strict('forbidden or unrecognized business knowledge field')

const querySchemas = Object.freeze({
  product_search: z.object({ term: z.string().trim().min(1).max(160) }).strict(),
  product_detail: z.object({ productCode: z.string().trim().min(1).max(120) }).strict(),
  product_compare: z.object({ productCodes: z.array(z.string().trim().min(1).max(120)).min(2).max(3) }).strict(),
})

const zQuery = z.object({
  businessId: z.string().trim().min(1).max(120),
  queryId: z.string().trim().min(1),
  params: z.record(z.unknown()),
  limit: z.number().int().min(1).max(10).default(5),
}).strict()

export function normalizeBusinessKnowledgeRecord(input) {
  return zBusinessKnowledgeRecord.parse(input)
}

export function parseBusinessKnowledgeQuery(input) {
  const query = zQuery.parse(input)
  const paramsSchema = querySchemas[query.queryId]
  if (!paramsSchema) throw new Error(`Business knowledge registered query required: ${query.queryId}`)
  return { ...query, params: paramsSchema.parse(query.params) }
}

function searchable(record) {
  return [record.product_code, record.name, record.category, record.description, ...record.colors]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('th-TH')
}

function searchMatches(record, term) {
  const haystack = searchable(record)
  const tokens = term.toLocaleLowerCase('th-TH').split(/[^\p{L}\p{N}._-]+/u).filter((token) => token.length >= 2)
  return tokens.length === 0 ? false : tokens.some((token) => haystack.includes(token))
}

function packet(query, records) {
  const asOf = records.map((record) => record.as_of).sort().at(-1) ?? null
  return {
    queryId: query.queryId,
    queryVersion: '1.0.0',
    businessId: query.businessId,
    sensitivity: 'PUBLIC',
    asOf,
    records,
  }
}

export function createInMemoryBusinessKnowledgeReader(inputRecords = []) {
  const records = inputRecords.map(normalizeBusinessKnowledgeRecord)

  return {
    async query(input) {
      const query = parseBusinessKnowledgeQuery(input)
      const scoped = records
        .filter((record) => record.business_id === query.businessId && record.is_active && record.sensitivity === 'PUBLIC')
        .sort((a, b) => a.product_code.localeCompare(b.product_code))

      let matched
      if (query.queryId === 'product_detail') {
        matched = scoped.filter((record) => record.product_code.toLocaleLowerCase() === query.params.productCode.toLocaleLowerCase())
      } else if (query.queryId === 'product_compare') {
        const codes = new Set(query.params.productCodes.map((code) => code.toLocaleLowerCase()))
        matched = scoped.filter((record) => codes.has(record.product_code.toLocaleLowerCase()))
      } else {
        matched = scoped.filter((record) => searchMatches(record, query.params.term))
      }

      return packet(query, matched.slice(0, query.limit))
    },
  }
}

export function buildBusinessKnowledgePacket(query, records) {
  const parsedQuery = parseBusinessKnowledgeQuery(query)
  const normalized = records.map(normalizeBusinessKnowledgeRecord)
    .filter((record) => record.business_id === parsedQuery.businessId)
    .slice(0, parsedQuery.limit)
  return packet(parsedQuery, normalized)
}

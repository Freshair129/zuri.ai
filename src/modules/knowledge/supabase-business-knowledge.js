import { z } from 'zod'
import {
  PUBLIC_BUSINESS_KNOWLEDGE_FIELDS,
  buildBusinessKnowledgePacket,
  parseBusinessKnowledgeQuery,
} from './business-contract'

// @req FR-047 — server-only Supabase adapter for the curated knowledge read contract.
// @spec SDD-025, SEC-009 — fixed select/filter/query shapes; secret key never leaves the server.
// @tested tests/unit/supabase-business-knowledge.test.js

const zOptions = z.object({
  supabaseUrl: z.string().url(),
  secretKey: z.string().min(1),
  timeoutMs: z.number().int().min(100).max(25000).default(5000),
}).strict()

function appendRegisteredFilter(params, query) {
  if (query.queryId === 'product_detail') {
    params.set('product_code', `eq.${query.params.productCode}`)
    return
  }
  if (query.queryId === 'product_compare') {
    params.set('product_code', `in.(${query.params.productCodes.join(',')})`)
    return
  }
  const safeTerm = query.params.term.replaceAll(/[,*()]/g, ' ').trim()
  params.set('or', `(product_code.ilike.*${safeTerm}*,name.ilike.*${safeTerm}*,category.ilike.*${safeTerm}*,description.ilike.*${safeTerm}*)`)
}

export function createSupabaseBusinessKnowledgeReader(inputOptions) {
  const options = zOptions.parse({
    supabaseUrl: inputOptions.supabaseUrl,
    secretKey: inputOptions.secretKey,
    timeoutMs: inputOptions.timeoutMs,
  })
  const fetchFn = inputOptions.fetchFn ?? fetch

  return {
    async query(input) {
      const query = parseBusinessKnowledgeQuery(input)
      const params = new URLSearchParams()
      params.set('select', PUBLIC_BUSINESS_KNOWLEDGE_FIELDS.join(','))
      params.set('business_id', `eq.${query.businessId}`)
      params.set('sensitivity', 'eq.PUBLIC')
      params.set('is_active', 'eq.true')
      params.set('order', 'product_code.asc')
      params.set('limit', String(query.limit))
      appendRegisteredFilter(params, query)

      const baseUrl = options.supabaseUrl.replace(/\/$/, '')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
      let response
      try {
        response = await fetchFn(`${baseUrl}/rest/v1/business_knowledge?${params}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            apikey: options.secretKey,
            Authorization: `Bearer ${options.secretKey}`,
          },
          signal: controller.signal,
        })
      } catch {
        throw new Error('SUPABASE_BUSINESS_KNOWLEDGE_NETWORK_ERROR')
      } finally {
        clearTimeout(timeout)
      }

      if (!response.ok) throw new Error(`SUPABASE_BUSINESS_KNOWLEDGE_HTTP_${response.status}`)

      let rows
      try {
        rows = await response.json()
      } catch {
        throw new Error('SUPABASE_BUSINESS_KNOWLEDGE_INVALID_JSON')
      }
      if (!Array.isArray(rows)) throw new Error('SUPABASE_BUSINESS_KNOWLEDGE_INVALID_PAYLOAD')
      return buildBusinessKnowledgePacket(query, rows)
    },
  }
}

import { z } from 'zod'
import { PUBLIC_BUSINESS_KNOWLEDGE_FIELDS, buildBusinessKnowledgePacket, parseBusinessKnowledgeQuery } from './business-contract'

// @req FR-051 — production knowledge reads are tenant-leading direct Postgres queries.
// @spec SDD-026, SEC-010 — the scope-bound DB role and forced RLS are both mandatory.
// @tested tests/unit/postgres-business-knowledge.test.js

const zScope = z.object({
  tenantId: z.string().uuid(),
  businessId: z.string().uuid(),
}).strict()

function normalizedRows(rows) {
  return rows.map((row) => ({
    ...row,
    sell_price: row.sell_price === null ? null : Number(row.sell_price),
    as_of: row.as_of instanceof Date ? row.as_of.toISOString() : row.as_of,
    approved_at: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at,
  }))
}

function registeredPredicate(query, values) {
  if (query.queryId === 'product_detail') {
    values.push(query.params.productCode)
    return `product_code = $${values.length}`
  }
  if (query.queryId === 'product_compare') {
    values.push(query.params.productCodes)
    return `product_code = any($${values.length}::text[])`
  }
  values.push(`%${query.params.term}%`)
  const slot = `$${values.length}`
  return `(product_code ilike ${slot} or name ilike ${slot} or category ilike ${slot} or description ilike ${slot})`
}

export function createPostgresBusinessKnowledgeReader({ queryFn }) {
  if (typeof queryFn !== 'function') throw new Error('POSTGRES_QUERY_FUNCTION_REQUIRED')
  return {
    async query(input) {
      const scope = zScope.parse({ tenantId: input.tenantId, businessId: input.businessId })
      const query = parseBusinessKnowledgeQuery({
        tenantId: scope.tenantId,
        businessId: scope.businessId,
        queryId: input.queryId,
        params: input.params,
        limit: input.limit,
      })
      const values = [scope.tenantId, scope.businessId]
      const predicate = registeredPredicate(query, values)
      values.push(query.limit)
      const sql = `
        select ${PUBLIC_BUSINESS_KNOWLEDGE_FIELDS.join(', ')}
        from zuri_core.business_knowledge
        where tenant_id = $1
          and business_id = $2
          and sensitivity = 'PUBLIC'
          and is_active
          and ${predicate}
        order by product_code asc
        limit $${values.length}
      `
      const result = await queryFn(sql, values)
      return buildBusinessKnowledgePacket(query, normalizedRows(result.rows ?? []))
    },
  }
}

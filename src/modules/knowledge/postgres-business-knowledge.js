import { Pool } from 'pg'
import { z } from 'zod'
import { PUBLIC_BUSINESS_KNOWLEDGE_FIELDS, buildBusinessKnowledgePacket, parseBusinessKnowledgeQuery } from './business-contract'

// @req FR-051 — tenant-leading registered reads use a least-privilege direct Postgres role.
// @spec SDD-026, SEC-010
// @tested tests/unit/postgres-business-knowledge.test.js, tests/unit/phase1-business-agent-runtime.test.js

const zOptions = z.object({
  tenantId: z.string().min(1),
  businessId: z.string().min(1),
  connectionString: z.string().url().optional(),
  timeoutMs: z.number().int().min(100).max(25000).default(5000),
}).strict()

function registeredWhere(query, params) {
  if (query.queryId === 'product_detail') {
    params.push(query.params.productCode)
    return `product_code = $${params.length}`
  }
  if (query.queryId === 'product_compare') {
    params.push(query.params.productCodes)
    return `product_code = any($${params.length}::text[])`
  }
  params.push(`%${query.params.term}%`)
  const p = `$${params.length}`
  return `(product_code ilike ${p} or name ilike ${p} or category ilike ${p} or description ilike ${p})`
}

export function assertLineRuntimeDatabaseUrl(value) {
  let parsed
  try { parsed = new URL(value) } catch { throw new Error('PHASE1_DATABASE_URL_INVALID') }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('PHASE1_DATABASE_URL_INVALID')
  const role = decodeURIComponent(parsed.username || '')
  if (!/^zuri_line_[a-z0-9_]+_ro$/.test(role)) throw new Error('PHASE1_DATABASE_ROLE_FORBIDDEN')
  return value
}

export function createPostgresBusinessKnowledgeReader(inputOptions) {
  const options = zOptions.parse({
    tenantId: inputOptions.tenantId,
    businessId: inputOptions.businessId,
    connectionString: inputOptions.connectionString,
    timeoutMs: inputOptions.timeoutMs,
  })
  let queryFn = inputOptions.queryFn
  if (!queryFn) {
    const connectionString = assertLineRuntimeDatabaseUrl(options.connectionString)
    const pool = new Pool({ connectionString, connectionTimeoutMillis: options.timeoutMs, query_timeout: options.timeoutMs, max: 2 })
    queryFn = (text, values) => pool.query({ text, values, statement_timeout: options.timeoutMs })
  }

  return {
    async query(input) {
      const query = parseBusinessKnowledgeQuery(input)
      if (query.businessId !== options.businessId) throw new Error('BUSINESS_KNOWLEDGE_SCOPE_MISMATCH')
      const params = [options.tenantId, options.businessId]
      const registered = registeredWhere(query, params)
      params.push(query.limit)
      const fields = ['tenant_id', ...PUBLIC_BUSINESS_KNOWLEDGE_FIELDS].join(', ')
      const sql = `select ${fields}
        from zuri_core.business_knowledge
        where tenant_id = $1 and business_id = $2
          and sensitivity = 'PUBLIC' and is_active = true and ${registered}
        order by product_code asc limit $${params.length}`
      const result = await queryFn(sql, params)
      const rows = (result?.rows || []).map(({ tenant_id: tenantId, ...record }) => {
        if (tenantId !== options.tenantId) throw new Error('BUSINESS_KNOWLEDGE_TENANT_VIOLATION')
        return {
          ...record,
          as_of: record.as_of instanceof Date ? record.as_of.toISOString() : record.as_of,
          approved_at: record.approved_at instanceof Date ? record.approved_at.toISOString() : record.approved_at,
        }
      })
      return buildBusinessKnowledgePacket(query, rows)
    },
  }
}

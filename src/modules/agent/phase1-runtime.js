import { createPostgresBusinessKnowledgeReader } from '@/modules/knowledge'
import { createModelProviderPort } from './model-provider'
import { createPostgresLineBindingResolver } from './line-binding-resolver'
import pg from 'pg'

// @req FR-047, FR-048, FR-052 — compose Phase 1 ports only from server-owned scope and configuration.
// @spec SDD-025, SDD-026, SEC-009, SEC-010 — disabled by default; partial configuration fails closed.
// @tested tests/unit/phase1-business-agent-runtime.test.js

function assertRuntimeDatabaseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('PHASE1_DATABASE_URL_INVALID')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.username !== 'zuri_line_smartgift_login') {
    throw new Error('PHASE1_DATABASE_ROLE_FORBIDDEN')
  }
  return value
}

let sharedPool = null
let sharedPoolDatabaseUrl = null

function runtimePool(databaseUrl, timeoutMs) {
  if (sharedPool && sharedPoolDatabaseUrl !== databaseUrl) {
    throw new Error('PHASE1_DATABASE_URL_CHANGED_RESTART_REQUIRED')
  }
  if (!sharedPool) {
    sharedPool = new pg.Pool({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: timeoutMs,
      idleTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: true },
    })
    sharedPoolDatabaseUrl = databaseUrl
  }
  return sharedPool
}

export async function executeAsLineReadRole(pool, sql, values) {
  const client = await pool.connect()
  let transactionStarted = false
  try {
    await client.query('begin')
    transactionStarted = true
    await client.query('set local role zuri_line_smartgift_ro')
    const result = await client.query(sql, values)
    await client.query('commit')
    return result
  } catch (error) {
    if (transactionStarted) await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export function createPhase1BusinessAgentPortsFromEnv(env = process.env, { fetchFn, queryFn } = {}) {
  if (env.ZURI_LINE_BUSINESS_AGENT_ENABLED !== 'true') return null

  if (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('PHASE1_SUPABASE_SECRET_FORBIDDEN: secret/service credentials bypass RLS')
  }

  const required = {
    ZURI_LINE_DB_URL: env.ZURI_LINE_DB_URL,
    ZURI_LINE_BINDING_HASH_PEPPER: env.ZURI_LINE_BINDING_HASH_PEPPER,
    ZURI_MODEL_PROVIDER: env.ZURI_MODEL_PROVIDER,
    ZURI_MODEL_NAME: env.ZURI_MODEL_NAME,
    ZURI_MODEL_CREDENTIAL: env.ZURI_MODEL_CREDENTIAL,
  }
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error(`PHASE1_CONFIGURATION_MISSING: ${missing.join(', ')}`)

  const databaseUrl = assertRuntimeDatabaseUrl(required.ZURI_LINE_DB_URL)
  const pool = queryFn ? null : runtimePool(
    databaseUrl,
    Number(env.ZURI_KNOWLEDGE_TIMEOUT_MS ?? 5000),
  )
  const execute = queryFn ?? ((sql, values) => executeAsLineReadRole(pool, sql, values))

  return {
    businessKnowledge: createPostgresBusinessKnowledgeReader({ queryFn: execute }),
    bindingResolver: createPostgresLineBindingResolver({
      queryFn: execute,
      pepper: required.ZURI_LINE_BINDING_HASH_PEPPER,
    }),
    model: createModelProviderPort({
      provider: required.ZURI_MODEL_PROVIDER,
      model: required.ZURI_MODEL_NAME,
      credential: required.ZURI_MODEL_CREDENTIAL,
      timeoutMs: Number(env.ZURI_MODEL_TIMEOUT_MS ?? 10000),
      fetchFn,
    }),
    close: async () => {},
  }
}

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

export async function resolvePhase1RequestScope({ runtime, headers, body }) {
  if (!runtime) {
    if (!body.tenantId) throw badRequest('TENANT_ID_REQUIRED')
    return { tenantId: body.tenantId, businessId: body.businessId }
  }
  if (body.tenantId !== undefined || body.businessId !== undefined) {
    throw badRequest('PHASE1_CLIENT_SCOPE_FORBIDDEN')
  }
  if (!body.bindingId || !body.destination) throw badRequest('PHASE1_BINDING_REQUIRED')
  return runtime.bindingResolver.resolve({
    bindingId: body.bindingId,
    destination: body.destination,
    authorization: headers.get('authorization') ?? '',
  })
}

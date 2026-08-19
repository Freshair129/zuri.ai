import { createPostgresBusinessKnowledgeReader } from '@/modules/knowledge'
import { createModelProviderPort } from './model-provider'
import { createPostgresLineBindingResolver } from './line-binding-resolver'
import {
  PHASE1_LINE_LLM_PURPOSE,
  resolvePhase1PrimaryConnection,
  resolvePhase1PrimaryConnectionByQuery,
} from '@/platform/integrations/core/integration-registry'
import { createEnvCredentialVault } from '@/platform/integrations/core/credential-vault'
import {
  createSecretManagerPort,
  createSupabaseVaultSecretManagerAdapter,
  createVaultSecretManagerAdapter,
} from '@/platform/integrations/core/secret-manager'
import {
  parseDedicatedRuntimeDatabaseUrl,
  readRuntimeDatabaseCa,
} from '../knowledge/runtime-postgres-config.js'
import pg from 'pg'

// @req FR-047, FR-048, FR-052, FR-080 — compose Phase 1 ports only from server-owned scope and configuration.
// @spec SDD-025, SDD-026, SDD-044, SEC-009, SEC-010, SEC-016 — disabled by default; partial configuration fails closed.
// @tested tests/unit/phase1-business-agent-runtime.test.js

function assertRuntimeDatabaseUrl(value) {
  parseDedicatedRuntimeDatabaseUrl(value)
  return value
}

let sharedPool = null
let sharedPoolDatabaseUrl = null

const RUNTIME_DB_ROLE_SQL = Object.freeze({
  zuri_line_smartgift_ro: 'set local role zuri_line_smartgift_ro',
  zuri_line_runtime: 'set local role zuri_line_runtime',
})

function runtimePool(databaseUrl, timeoutMs, ssl) {
  if (sharedPool && sharedPoolDatabaseUrl !== databaseUrl) {
    throw new Error('PHASE1_DATABASE_URL_CHANGED_RESTART_REQUIRED')
  }
  if (!sharedPool) {
    sharedPool = new pg.Pool({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: timeoutMs,
      idleTimeoutMillis: 10000,
      ssl,
    })
    sharedPoolDatabaseUrl = databaseUrl
  }
  return sharedPool
}

async function executeAsRole(pool, role, sql, values) {
  const roleSql = Object.prototype.hasOwnProperty.call(RUNTIME_DB_ROLE_SQL, role)
    ? RUNTIME_DB_ROLE_SQL[role]
    : null
  if (!roleSql) throw new Error('PHASE1_DATABASE_ROLE_FORBIDDEN')

  const client = await pool.connect()
  let transactionStarted = false
  try {
    await client.query('begin')
    transactionStarted = true
    await client.query(roleSql)
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

export async function executeAsLineReadRole(pool, sql, values) {
  return executeAsRole(pool, 'zuri_line_smartgift_ro', sql, values)
}

export async function executeAsLineSecretRole(pool, sql, values) {
  return executeAsRole(pool, 'zuri_line_runtime', sql, values)
}

function runtimeSourceFor(env) {
  const source = env.ZURI_PHASE1_RUNTIME_SOURCE
    ?? (env.NODE_ENV === 'production' ? null : env.NODE_ENV === 'test' ? 'TEST' : 'LOCAL_DEV')
  if (!source) throw new Error('PHASE1_RUNTIME_SOURCE_REQUIRED')
  if (env.NODE_ENV === 'production' && source !== 'PRODUCTION_LINE') {
    throw new Error('PHASE1_PRODUCTION_RUNTIME_SOURCE_FORBIDDEN')
  }
  if (!['PRODUCTION_LINE', 'LOCAL_DEV', 'TEST', 'EVAL'].includes(source)) {
    throw new Error('PHASE1_RUNTIME_SOURCE_INVALID')
  }
  return source
}

function parseConnectionMetadata(connection) {
  try {
    const parsed = JSON.parse(connection.metadataJson ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new Error('PHASE1_CONNECTION_METADATA_INVALID')
  }
}

export function createPhase1BusinessAgentPortsFromEnv(
  env = process.env,
  { fetchFn, queryFn, secretQueryFn, integrationDb, connectionResolver, secretManager } = {},
) {
  if (env.ZURI_LINE_BUSINESS_AGENT_ENABLED !== 'true') return null

  const runtimeSource = runtimeSourceFor(env)

  if (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('PHASE1_SUPABASE_SECRET_FORBIDDEN: secret/service credentials bypass RLS')
  }

  const required = {
    ZURI_LINE_DB_URL: env.ZURI_LINE_DB_URL,
    ZURI_LINE_BINDING_HASH_PEPPER: env.ZURI_LINE_BINDING_HASH_PEPPER,
  }
  if (runtimeSource !== 'PRODUCTION_LINE') {
    required.ZURI_MODEL_PROVIDER = env.ZURI_MODEL_PROVIDER
    required.ZURI_MODEL_NAME = env.ZURI_MODEL_NAME
    if (env.ZURI_MODEL_PROVIDER !== 'ollama') required.ZURI_MODEL_CREDENTIAL = env.ZURI_MODEL_CREDENTIAL
  } else if (env.ZURI_MODEL_PROVIDER || env.ZURI_MODEL_NAME || env.ZURI_MODEL_CREDENTIAL) {
    throw new Error('PHASE1_PRODUCTION_LEGACY_MODEL_CONFIG_FORBIDDEN')
  }
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error(`PHASE1_CONFIGURATION_MISSING: ${missing.join(', ')}`)

  const databaseUrl = assertRuntimeDatabaseUrl(required.ZURI_LINE_DB_URL)
  const pool = queryFn ? null : runtimePool(
    databaseUrl,
    Number(env.ZURI_KNOWLEDGE_TIMEOUT_MS ?? 5000),
    readRuntimeDatabaseCa(env),
  )
  const execute = queryFn ?? ((sql, values) => executeAsLineReadRole(pool, sql, values))

  const secretBackend = env.ZURI_PHASE1_SECRET_BACKEND
    ?? (runtimeSource === 'PRODUCTION_LINE' ? 'SUPABASE_VAULT' : 'LOCAL_FILE')
  if (!['SUPABASE_VAULT', 'LOCAL_FILE'].includes(secretBackend)) {
    throw new Error('PHASE1_SECRET_BACKEND_INVALID')
  }
  if (runtimeSource === 'PRODUCTION_LINE' && secretBackend !== 'SUPABASE_VAULT') {
    throw new Error('PHASE1_PRODUCTION_SECRET_BACKEND_FORBIDDEN')
  }

  const runtimeSecretManager = secretManager ?? (() => {
    if (secretBackend === 'SUPABASE_VAULT') {
      const resolverQuery = runtimeSource === 'PRODUCTION_LINE'
        ? (secretQueryFn
          ?? (pool ? ((sql, values) => executeAsLineSecretRole(pool, sql, values)) : null))
        : (secretQueryFn ?? queryFn)
      if (typeof resolverQuery !== 'function') {
        throw new Error('SUPABASE_VAULT_QUERY_NOT_CONFIGURED')
      }
      return createSecretManagerPort({
        runtimeSource,
        adapter: createSupabaseVaultSecretManagerAdapter({ queryFn: resolverQuery }),
      })
    }
    if (!env.ZURI_CREDENTIAL_VAULT_MASTER_KEY) return null
    return createSecretManagerPort({
      runtimeSource,
      adapter: createVaultSecretManagerAdapter({ vault: createEnvCredentialVault({ env }) }),
    })
  })()
  if (runtimeSource === 'PRODUCTION_LINE' && runtimeSecretManager?.runtimeSource !== 'PRODUCTION_LINE') {
    throw new Error('PRODUCTION_SECRET_MANAGER_NOT_CONFIGURED: production SecretManagerPort is required')
  }

  const legacyModel = runtimeSource === 'PRODUCTION_LINE'
    ? null
    : createModelProviderPort({
      runtimeSource,
      provider: required.ZURI_MODEL_PROVIDER,
      model: required.ZURI_MODEL_NAME,
      credential: env.ZURI_MODEL_CREDENTIAL,
      baseUrl: required.ZURI_MODEL_PROVIDER === 'ollama' ? env.ZURI_OLLAMA_BASE_URL : undefined,
      timeoutMs: Number(env.ZURI_MODEL_TIMEOUT_MS ?? 10000),
      fetchFn,
    })

  const resolveConnection = connectionResolver ?? (integrationDb
    ? ((scope) => resolvePhase1PrimaryConnection({
      db: integrationDb,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      purpose: PHASE1_LINE_LLM_PURPOSE,
    }))
    : ((scope) => resolvePhase1PrimaryConnectionByQuery({
      queryFn: execute,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      purpose: PHASE1_LINE_LLM_PURPOSE,
    })))
  async function resolveModel(scope) {
    let connection
    try {
      connection = await resolveConnection({ tenantId: scope.tenantId, businessId: scope.businessId })
    } catch (error) {
      // Local/test direct provider configuration remains a compatibility seam. It
      // is never reachable from PRODUCTION_LINE and never hides ambiguity or a
      // secret-manager failure.
      if (runtimeSource !== 'PRODUCTION_LINE' && error?.message === 'PHASE1_CONNECTION_NOT_FOUND' && legacyModel) {
        return legacyModel
      }
      throw error
    }
    const provider = String(connection.provider?.code ?? '').trim().toLowerCase()
    const metadata = parseConnectionMetadata(connection)
    const model = metadata.model
    if (!provider || !model) throw new Error('PHASE1_CONNECTION_MODEL_MISSING')

    if (provider === 'ollama') {
      return createModelProviderPort({
        runtimeSource,
        provider,
        model,
        baseUrl: metadata.baseUrl ?? env.ZURI_OLLAMA_BASE_URL,
        timeoutMs: Number(env.ZURI_MODEL_TIMEOUT_MS ?? 10000),
        fetchFn,
      })
    }

    const secretRef = connection.credential?.secretRef
    if (!secretRef) throw new Error('PHASE1_CONNECTION_SECRET_REF_MISSING')
    if (!runtimeSecretManager) throw new Error('SECRET_MANAGER_NOT_CONFIGURED')
    const secret = await runtimeSecretManager.resolve(secretRef, {
      tenantId: scope.tenantId,
      businessId: scope.businessId,
    })
    return createModelProviderPort({
      runtimeSource,
      provider,
      model,
      credential: secret.material,
      baseUrl: metadata.baseUrl,
      timeoutMs: Number(env.ZURI_MODEL_TIMEOUT_MS ?? 10000),
      fetchFn,
    })
  }

  const ports = {
    runtimeSource,
    businessKnowledge: createPostgresBusinessKnowledgeReader({ queryFn: execute }),
    bindingResolver: createPostgresLineBindingResolver({
      queryFn: execute,
      pepper: required.ZURI_LINE_BINDING_HASH_PEPPER,
    }),
    model: legacyModel,
    resolveModel,
    close: async () => {},
  }
  return ports
}

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function unauthorized(message) {
  const error = new Error(message)
  error.status = 401
  return error
}

/**
 * Resolve the trusted Tenant/Business scope for one inbound LINE webhook batch.
 *
 * With a composed Phase 1 runtime the only accepted evidence is binding identity +
 * destination + binding-scoped bearer, verified by the resolver (FR-052).
 *
 * Without one there is nothing to verify scope against, so the client-scope branch
 * is a lab/test compatibility seam only. It stays open outside production and is
 * closed in production: BR-012 makes Tenant/Business server authority, and an
 * unbound caller selecting its own tenant would be an unauthenticated write path
 * into ingestLineMessage (Person/Customer/Conversation/Message + audit).
 */
export async function resolvePhase1RequestScope({ runtime, headers, body, env = process.env }) {
  if (!runtime) {
    // Deny-by-default (SEC-010). One status for every unbound production shape so
    // the response never tells an unauthenticated caller which field to add next.
    if (env.NODE_ENV === 'production') throw unauthorized('PHASE1_BINDING_REQUIRED')
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

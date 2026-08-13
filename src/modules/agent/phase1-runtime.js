import { createPostgresBusinessKnowledgeReader, assertLineRuntimeDatabaseUrl } from '@/modules/knowledge'
import { createModelProviderPort } from './model-provider'
import { createConfiguredLineBindingResolver } from './line-channel-binding'
import crypto from 'node:crypto'

// @req FR-047, FR-048, FR-051 — compose Phase 1 ports only from server-side configuration.
// @spec SDD-025, SDD-026, SEC-009, SEC-010 — disabled by default; partial or privileged configuration fails closed.
// @tested tests/unit/phase1-business-agent-runtime.test.js, tests/unit/postgres-business-knowledge.test.js

export function createPhase1BusinessAgentPortsFromEnv(env = process.env, { fetchFn, queryFn } = {}) {
  if (env.ZURI_LINE_BUSINESS_AGENT_ENABLED !== 'true') return null

  if (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('PHASE1_SERVICE_ROLE_CONFIGURATION_FORBIDDEN')
  }

  const required = {
    ZURI_LINE_DATABASE_URL: env.ZURI_LINE_DATABASE_URL,
    ZURI_LINE_BINDING_ID: env.ZURI_LINE_BINDING_ID,
    ZURI_LINE_BINDING_DESTINATION_SHA256: env.ZURI_LINE_BINDING_DESTINATION_SHA256,
    ZURI_LINE_BINDING_TENANT_ID: env.ZURI_LINE_BINDING_TENANT_ID,
    ZURI_LINE_BINDING_BUSINESS_ID: env.ZURI_LINE_BINDING_BUSINESS_ID,
    ZURI_LINE_BINDING_STATUS: env.ZURI_LINE_BINDING_STATUS,
    ZURI_MODEL_PROVIDER: env.ZURI_MODEL_PROVIDER,
    ZURI_MODEL_NAME: env.ZURI_MODEL_NAME,
    ZURI_MODEL_CREDENTIAL: env.ZURI_MODEL_CREDENTIAL,
    ZURI_LINE_TRANSPORT_TOKEN: env.ZURI_LINE_TRANSPORT_TOKEN,
  }
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error(`PHASE1_CONFIGURATION_MISSING: ${missing.join(', ')}`)
  assertLineRuntimeDatabaseUrl(required.ZURI_LINE_DATABASE_URL)

  return {
    binding: createConfiguredLineBindingResolver(env),
    businessKnowledge: createPostgresBusinessKnowledgeReader({
      connectionString: required.ZURI_LINE_DATABASE_URL,
      tenantId: required.ZURI_LINE_BINDING_TENANT_ID,
      businessId: required.ZURI_LINE_BINDING_BUSINESS_ID,
      timeoutMs: Number(env.ZURI_KNOWLEDGE_TIMEOUT_MS ?? 5000),
      queryFn,
    }),
    model: createModelProviderPort({
      provider: required.ZURI_MODEL_PROVIDER,
      model: required.ZURI_MODEL_NAME,
      credential: required.ZURI_MODEL_CREDENTIAL,
      timeoutMs: Number(env.ZURI_MODEL_TIMEOUT_MS ?? 10000),
      fetchFn,
    }),
  }
}

export function assertPhase1TransportAuthorization(headers, env = process.env) {
  if (env.ZURI_LINE_BUSINESS_AGENT_ENABLED !== 'true') return true
  const expectedToken = env.ZURI_LINE_TRANSPORT_TOKEN
  const authorization = headers.get('authorization') ?? ''
  const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!expectedToken || expectedToken.length < 16 || suppliedToken.length !== expectedToken.length) {
    const error = new Error('PHASE1_TRANSPORT_UNAUTHORIZED')
    error.status = 401
    throw error
  }
  const allowed = crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(expectedToken))
  if (!allowed) {
    const error = new Error('PHASE1_TRANSPORT_UNAUTHORIZED')
    error.status = 401
    throw error
  }
  return true
}

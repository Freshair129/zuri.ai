import { createSupabaseBusinessKnowledgeReader } from '@/modules/knowledge'
import { createModelProviderPort } from './model-provider'
import crypto from 'node:crypto'

// @req FR-047, FR-048 — compose Phase 1 ports only from server-side configuration.
// @spec SDD-025, SEC-009 — disabled by default; partial configuration fails closed.
// @tested tests/unit/phase1-business-agent-runtime.test.js

export function createPhase1BusinessAgentPortsFromEnv(env = process.env, { fetchFn } = {}) {
  if (env.ZURI_LINE_BUSINESS_AGENT_ENABLED !== 'true') return null

  const required = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
    ZURI_MODEL_PROVIDER: env.ZURI_MODEL_PROVIDER,
    ZURI_MODEL_NAME: env.ZURI_MODEL_NAME,
    ZURI_MODEL_CREDENTIAL: env.ZURI_MODEL_CREDENTIAL,
    ZURI_LINE_TRANSPORT_TOKEN: env.ZURI_LINE_TRANSPORT_TOKEN,
  }
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error(`PHASE1_CONFIGURATION_MISSING: ${missing.join(', ')}`)

  return {
    businessKnowledge: createSupabaseBusinessKnowledgeReader({
      supabaseUrl: required.SUPABASE_URL,
      secretKey: required.SUPABASE_SECRET_KEY,
      timeoutMs: Number(env.ZURI_KNOWLEDGE_TIMEOUT_MS ?? 5000),
      fetchFn,
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

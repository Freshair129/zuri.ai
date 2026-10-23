import { MODEL_ID_PATTERN } from '@/lib/validation/enums'
import path from 'node:path'

// @req FR-079, FR-080 — guard the default-off main-dev model source and its owner-scoped model discovery.
// @spec ADR-100 D9, SEC-001 — verify server/database identity and exact Tenant, Business, and LINE OA scope; Ollama receives no credentials.
// @tested tests/unit/main-dev-local-ollama.test.js
export const MAIN_DEV_LOCAL_OLLAMA_SOURCE = 'MAIN_DEV_LOCAL_OLLAMA'
export const MAIN_DEV_LOCAL_OLLAMA_ORIGIN = 'http://host.docker.internal:11434'

const DATABASE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_ALLOWLIST_ENTRIES = 32
const MAX_TAGS_RESPONSE_BYTES = 64 * 1024
const MAX_INSTALLED_MODELS = 256
const TAGS_TIMEOUT_MS = 5000

function fail(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function requiredAllowlist(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || !value.trim()) throw fail('MAIN_DEV_LOCAL_OLLAMA_CONFIGURATION_INVALID')

  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_CONFIGURATION_INVALID')
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_ALLOWLIST_ENTRIES) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_CONFIGURATION_INVALID')
  }

  const unique = new Set()
  for (const id of parsed) {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id) || unique.has(id)) {
      throw fail('MAIN_DEV_LOCAL_OLLAMA_CONFIGURATION_INVALID')
    }
    unique.add(id)
  }
  return Object.freeze([...unique])
}

function requiredFixturePath(env) {
  const value = env.ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH
  if (typeof value !== 'string' || !value || value.includes('\0')
    || /^(?:\\\\|\/\/)/.test(value) || /^\\\\\?\\UNC\\/i.test(value)
    || !path.isAbsolute(value) || path.normalize(value) !== value) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_CONFIGURATION_INVALID')
  }
  return value
}

/**
 * Read the private, default-off main-dev profile. This profile is explicit and
 * identity-bound even when the Docker image keeps NODE_ENV=production.
 */
export function readMainDevLocalOllamaProfile(env = process.env) {
  if (env.ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED !== 'true') return null
  if (env.ZURI_PHASE1_RUNTIME_SOURCE !== MAIN_DEV_LOCAL_OLLAMA_SOURCE) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_PROFILE_MISMATCH')
  }

  const expectedDatabase = env.ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE
  if (typeof expectedDatabase !== 'string' || !DATABASE_NAME_PATTERN.test(expectedDatabase)) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_CONFIGURATION_INVALID')
  }
  if (env.ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL !== MAIN_DEV_LOCAL_OLLAMA_ORIGIN) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_ORIGIN_INVALID')
  }
  const testFixtureSha256 = env.ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256
  if (typeof testFixtureSha256 !== 'string' || !SHA256_PATTERN.test(testFixtureSha256)) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_CONFIGURATION_INVALID')
  }

  return Object.freeze({
    enabled: true,
    runtimeSource: MAIN_DEV_LOCAL_OLLAMA_SOURCE,
    expectedDatabase,
    baseUrl: MAIN_DEV_LOCAL_OLLAMA_ORIGIN,
    testFixturePath: requiredFixturePath(env),
    testFixtureSha256,
    allowedTenantIds: requiredAllowlist(env, 'ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS'),
    allowedBusinessIds: requiredAllowlist(env, 'ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS'),
    allowedLineOaAccountIds: requiredAllowlist(env, 'ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS'),
  })
}

/** Return whether a request is explicitly attempting to use the test profile. */
export function isMainDevLocalOllamaRequested(env = process.env) {
  return env.ZURI_PHASE1_RUNTIME_SOURCE === MAIN_DEV_LOCAL_OLLAMA_SOURCE
    || env.ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED === 'true'
}

/** Refuse memory, corpus, shadow, or non-Server jobs before composing the test turn. */
export function assertMainDevLocalOllamaJob({ env = process.env, job } = {}) {
  if (!isMainDevLocalOllamaRequested(env)) return null
  const profile = readMainDevLocalOllamaProfile(env)
  if (!profile) throw fail('MAIN_DEV_LOCAL_OLLAMA_DISABLED')

  const tenantId = job?.tenantId
  const businessId = job?.businessId
  const accountId = job?.accountId
  const account = job?.account
  if (typeof accountId !== 'string' || account?.id !== accountId
    || account?.tenantId !== tenantId || account?.businessId !== businessId
    || !profile.allowedTenantIds.includes(tenantId)
    || !profile.allowedBusinessIds.includes(businessId)
    || !profile.allowedLineOaAccountIds.includes(accountId)) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_SCOPE_DENIED')
  }
  if (job.executionMode !== 'SERVER' || job.runtimeOwner !== 'SERVER'
    || account.executionMode !== 'SERVER' || account.runtimeOwner !== 'SERVER'
    || account.serverEnabled !== true) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_EXECUTION_DENIED')
  }
  if (account.knowledgeGrounding !== 'BUSINESS_KNOWLEDGE'
    || account.knowledgeGroundingShadow === true
    || account.memoryPolicy !== 'OFF'
    || account.memoryProjectId != null
    || env.ZURI_MSP_THREAD_MEMORY_ENABLED === 'true'
    || env.ZURI_MSP_EPISODIC_MEMORY_ENABLED === 'true'
    || job.memorySyncOptIn === true
    || job.episodicMemoryOptIn === true) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_JOB_SETTINGS_DENIED')
  }
  return profile
}

/**
 * Prove the current database and all three server-owned identities before a
 * local model operation. `db` must be the same Prisma client used by the caller.
 */
export async function assertMainDevLocalOllamaScope({
  profile,
  db,
  tenantId,
  businessId,
  accountId,
} = {}) {
  if (!profile?.enabled || profile.runtimeSource !== MAIN_DEV_LOCAL_OLLAMA_SOURCE) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_DISABLED')
  }
  if (
    !profile.allowedTenantIds.includes(tenantId)
    || !profile.allowedBusinessIds.includes(businessId)
    || !profile.allowedLineOaAccountIds.includes(accountId)
  ) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_SCOPE_DENIED')
  }
  if (!db || typeof db.$queryRaw !== 'function') {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_DATABASE_IDENTITY_UNAVAILABLE')
  }

  let rows
  try {
    rows = await db.$queryRaw`SELECT current_database() AS "databaseName"`
  } catch {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_DATABASE_IDENTITY_UNAVAILABLE')
  }
  const databaseName = Array.isArray(rows) && rows.length === 1
    ? rows[0]?.databaseName
    : null
  if (databaseName !== profile.expectedDatabase) {
    throw fail('MAIN_DEV_LOCAL_OLLAMA_DATABASE_MISMATCH')
  }

  return Object.freeze({ tenantId, businessId, accountId, databaseName })
}

async function boundedJson(response) {
  const contentLength = response.headers?.get?.('content-length')
  if (/^\d+$/.test(contentLength ?? '') && Number(contentLength) > MAX_TAGS_RESPONSE_BYTES) {
    try { await response.body?.cancel?.() } catch {}
    throw fail('OLLAMA_TAGS_RESPONSE_TOO_LARGE')
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw fail('OLLAMA_TAGS_RESPONSE_INVALID')
  }

  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_TAGS_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {})
        throw fail('OLLAMA_TAGS_RESPONSE_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw fail('OLLAMA_TAGS_RESPONSE_INVALID')
  }
}

/** List only validated installed model IDs, after proving server/database scope. */
export async function listInstalledMainDevLocalOllamaModels({
  profile,
  db,
  tenantId,
  businessId,
  accountId,
  fetchFn = fetch,
} = {}) {
  await assertMainDevLocalOllamaScope({ profile, db, tenantId, businessId, accountId })
  if (typeof fetchFn !== 'function') throw fail('OLLAMA_TAGS_UNAVAILABLE')

  const controller = new AbortController()
  let timedOut = false
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(fail('OLLAMA_TAGS_TIMEOUT'))
    }, TAGS_TIMEOUT_MS)
  })
  let response
  try {
    response = await Promise.race([
      fetchFn(`${MAIN_DEV_LOCAL_OLLAMA_ORIGIN}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'error',
      }),
      timeout,
    ])
    if (!response?.ok) throw fail('OLLAMA_TAGS_UNAVAILABLE')

    const body = await Promise.race([boundedJson(response), timeout])
    if (!Array.isArray(body?.models) || body.models.length > MAX_INSTALLED_MODELS) {
      throw fail('OLLAMA_TAGS_RESPONSE_INVALID')
    }

    const names = new Set()
    for (const model of body.models) {
      const name = typeof model?.name === 'string' ? model.name.trim() : ''
      if (!MODEL_ID_PATTERN.test(name)) throw fail('OLLAMA_TAGS_RESPONSE_INVALID')
      names.add(name)
    }
    return [...names].sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (timedOut) {
      void response?.body?.cancel?.().catch?.(() => {})
      throw fail('OLLAMA_TAGS_TIMEOUT')
    }
    if (typeof error?.code === 'string' && error.code.startsWith('OLLAMA_TAGS_')) throw error
    throw fail('OLLAMA_TAGS_UNAVAILABLE')
  } finally {
    clearTimeout(timeoutId)
  }
}

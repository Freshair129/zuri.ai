import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import * as ollamaApi from '@/modules/agent/main-dev-local-ollama'

// @req FR-079, FR-080 — profile, database, scope, and tags discovery gates.
// @spec ADR-100 D9, SEC-001
// @tested tests/unit/main-dev-local-ollama.test.js
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const BUSINESS_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ACCOUNT_ID = '44444444-4444-4444-8444-444444444444'

const enabledEnv = () => ({
  NODE_ENV: 'production',
  ZURI_PHASE1_RUNTIME_SOURCE: 'MAIN_DEV_LOCAL_OLLAMA',
  ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'true',
  ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE: 'zuri_main_dev',
  ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS: JSON.stringify([TENANT_ID]),
  ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: JSON.stringify([BUSINESS_ID]),
  ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: JSON.stringify([ACCOUNT_ID]),
  ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
  ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH: path.join(os.tmpdir(), 'ollama-test-only-public.json'),
  ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256: 'a'.repeat(64),
})

async function loadApi() {
  return ollamaApi
}

describe('main-dev local Ollama profile', () => {
  it('selects real TEST ONLY RAG without requiring or reading a fixture', () => {
    const env = enabledEnv()
    delete env.ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH
    delete env.ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256
    Object.assign(env, {
      ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_TEST_ONLY',
      ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_MANIFEST_SHA256: 'b'.repeat(64),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_PRODUCTS: JSON.stringify([{ productId: OTHER_ACCOUNT_ID,
        sku: 'TEST-ONLY-RAG-001', sourceId: TENANT_ID, ingestionId: BUSINESS_ID, fileSha256: 'c'.repeat(64) }]),
    })
    expect(ollamaApi.readMainDevLocalOllamaProfile(env)).toMatchObject({
      knowledgeSource: 'GENESISRAG17_TEST_ONLY', testFixturePath: null, testFixtureSha256: null,
      rag: { manifestHash: 'b'.repeat(64), products: [{ sku: 'TEST-ONLY-RAG-001' }] },
    })
  })
  it.each(['', 'UNKNOWN', 'gks', 'GENESISRAG17_TEST_ONLY '])('rejects unknown knowledge source %s', source => {
    expect(() => ollamaApi.readMainDevLocalOllamaProfile({ ...enabledEnv(),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: source })).toThrow(/CONFIGURATION_INVALID/)
  })
  it('is disabled unless the server-side flag is explicitly true', async () => {
    const api = await loadApi()
    expect(api.readMainDevLocalOllamaProfile({ NODE_ENV: 'production' })).toBeNull()
    expect(api.readMainDevLocalOllamaProfile({
      ...enabledEnv(),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'false',
    })).toBeNull()
  })

  it('parses only the explicit profile and exact server-configured Ollama origin', async () => {
    const api = await loadApi()
    const profile = api.readMainDevLocalOllamaProfile(enabledEnv())

    expect(profile).toMatchObject({
      runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA',
      memoryEnabled: false,
      expectedDatabase: 'zuri_main_dev',
      baseUrl: 'http://host.docker.internal:11434',
      testFixturePath: path.join(os.tmpdir(), 'ollama-test-only-public.json'),
      testFixtureSha256: 'a'.repeat(64),
      allowedTenantIds: [TENANT_ID],
      allowedBusinessIds: [BUSINESS_ID],
      allowedLineOaAccountIds: [ACCOUNT_ID],
    })
    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.allowedTenantIds)).toBe(true)
  })

  it('uses a strict default-off server-side memory extension flag', async () => {
    const api = await loadApi()

    expect(api.readMainDevLocalOllamaProfile(enabledEnv()).memoryEnabled).toBe(false)
    expect(api.readMainDevLocalOllamaProfile({
      ...enabledEnv(), ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED: 'false',
    }).memoryEnabled).toBe(false)
    expect(api.readMainDevLocalOllamaProfile({
      ...enabledEnv(), ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED: 'true',
    }).memoryEnabled).toBe(true)

    for (const value of ['', 'TRUE', '1', 'yes']) {
      expect(() => api.readMainDevLocalOllamaProfile({
        ...enabledEnv(), ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED: value,
      })).toThrow(/MAIN_DEV_LOCAL_OLLAMA/)
    }
  })

  it.each([
    ['wrong runtime source', { ZURI_PHASE1_RUNTIME_SOURCE: 'PRODUCTION_LINE' }],
    ['alternate origin', { ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL: 'http://127.0.0.1:11434' }],
    ['malformed allowlist', { ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: 'not-json' }],
    ['empty allowlist', { ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: '[]' }],
  ])('rejects enabled configuration with %s', async (_name, override) => {
    const api = await loadApi()
    expect(() => api.readMainDevLocalOllamaProfile({ ...enabledEnv(), ...override })).toThrow(/MAIN_DEV_LOCAL_OLLAMA/)
  })

  it.each([
    ['network fixture path', { ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH: '\\\\server\\share\\fixture.json' }],
    ['missing fixture digest', { ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256: 'bad' }],
  ])('rejects enabled configuration with %s', async (_name, override) => {
    const api = await loadApi()
    expect(() => api.readMainDevLocalOllamaProfile({ ...enabledEnv(), ...override })).toThrow(/MAIN_DEV_LOCAL_OLLAMA/)
  })

  it('requires a trusted direct SERVER job with Business Knowledge and no memory features', async () => {
    const api = await loadApi()
    const acceptedJob = {
      tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
      executionMode: 'SERVER', runtimeOwner: 'SERVER', memorySyncOptIn: false, episodicMemoryOptIn: false,
      account: {
        id: ACCOUNT_ID, tenantId: TENANT_ID, businessId: BUSINESS_ID,
        executionMode: 'SERVER', runtimeOwner: 'SERVER', serverEnabled: true,
        knowledgeGrounding: 'BUSINESS_KNOWLEDGE', knowledgeGroundingShadow: false,
        memoryPolicy: 'OFF', memoryProjectId: null,
      },
    }
    expect(api.assertMainDevLocalOllamaJob({ env: enabledEnv(), job: acceptedJob })).toMatchObject({
      runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA',
    })

    for (const badJob of [
      { ...acceptedJob, accountId: OTHER_ACCOUNT_ID },
      { ...acceptedJob, executionMode: 'EDGE' },
      { ...acceptedJob, account: { ...acceptedJob.account, knowledgeGrounding: 'GKS_CORPUS' } },
      { ...acceptedJob, account: { ...acceptedJob.account, knowledgeGroundingShadow: true } },
      { ...acceptedJob, memorySyncOptIn: true },
      { ...acceptedJob, episodicMemoryOptIn: true },
      { ...acceptedJob, account: { ...acceptedJob.account, memoryPolicy: 'ON' } },
      { ...acceptedJob, account: { ...acceptedJob.account, memoryProjectId: 'project' } },
    ]) {
      expect(() => api.assertMainDevLocalOllamaJob({ env: enabledEnv(), job: badJob }))
        .toThrow(/MAIN_DEV_LOCAL_OLLAMA/)
    }
    expect(() => api.assertMainDevLocalOllamaJob({
      env: { ...enabledEnv(), ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' }, job: acceptedJob,
    })).toThrow(/MAIN_DEV_LOCAL_OLLAMA/)
    expect(() => api.assertMainDevLocalOllamaJob({
      env: { ...enabledEnv(), ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true' }, job: acceptedJob,
    })).toThrow(/MAIN_DEV_LOCAL_OLLAMA/)
  })

  it('allows standard enrolled memory only when the main-dev memory extension is opted in', async () => {
    const api = await loadApi()
    const memoryJob = {
      tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
      executionMode: 'SERVER', runtimeOwner: 'SERVER', memorySyncOptIn: true, episodicMemoryOptIn: true,
      episodicWorkspaceId: 'workspace-allowed-by-existing-mapping',
      episodicProjectId: 'project-allowed-by-existing-mapping',
      account: {
        id: ACCOUNT_ID, tenantId: TENANT_ID, businessId: BUSINESS_ID,
        executionMode: 'SERVER', runtimeOwner: 'SERVER', serverEnabled: true,
        knowledgeGrounding: 'BUSINESS_KNOWLEDGE', knowledgeGroundingShadow: false,
        memoryPolicy: 'ON', memoryProjectId: 'project-allowed-by-existing-mapping',
      },
    }
    const env = {
      ...enabledEnv(),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED: 'true',
      ZURI_MSP_THREAD_MEMORY_ENABLED: 'true',
      ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true',
    }

    expect(api.assertMainDevLocalOllamaJob({ env, job: memoryJob })).toMatchObject({ memoryEnabled: true })

    const ragEnv = {
      ...env,
      ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_TEST_ONLY',
      ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_MANIFEST_SHA256: 'b'.repeat(64),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_PRODUCTS: JSON.stringify([{
        productId: '33019679-ea52-4e6c-95ab-241e60260edd',
        sku: 'TEST-ONLY-RAG-001',
        sourceId: '43019679-ea52-4e6c-95ab-241e60260edd',
        ingestionId: '53019679-ea52-4e6c-95ab-241e60260edd',
        fileSha256: 'c'.repeat(64),
      }]),
    }
    delete ragEnv.ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH
    delete ragEnv.ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256
    const ragJob = { ...memoryJob, account: { ...memoryJob.account, knowledgeGrounding: 'GKS_CORPUS' } }
    expect(api.assertMainDevLocalOllamaJob({ env: ragEnv, job: ragJob })).toMatchObject({
      memoryEnabled: true, knowledgeSource: 'GENESISRAG17_TEST_ONLY',
    })
  })

  it('checks the actual Prisma database and all three independently allowlisted IDs', async () => {
    const api = await loadApi()
    const profile = api.readMainDevLocalOllamaProfile(enabledEnv())
    const db = { $queryRaw: vi.fn(async () => [{ databaseName: 'zuri_main_dev' }]) }

    await expect(api.assertMainDevLocalOllamaScope({
      profile, db, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
    })).resolves.toMatchObject({ tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID })
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)

    await expect(api.assertMainDevLocalOllamaScope({
      profile,
      db,
      tenantId: TENANT_ID,
      businessId: BUSINESS_ID,
      accountId: OTHER_ACCOUNT_ID,
    })).rejects.toThrow(/MAIN_DEV_LOCAL_OLLAMA_SCOPE_DENIED/)
  })

  it('fails closed when the queried Prisma database is not the configured database', async () => {
    const api = await loadApi()
    const profile = api.readMainDevLocalOllamaProfile(enabledEnv())
    const db = { $queryRaw: vi.fn(async () => [{ databaseName: 'zuri_uat' }]) }

    await expect(api.assertMainDevLocalOllamaScope({
      profile, db, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
    })).rejects.toThrow(/MAIN_DEV_LOCAL_OLLAMA_DATABASE_MISMATCH/)
  })

  it('lists validated installed model IDs from the fixed tags endpoint only after scope checks', async () => {
    const api = await loadApi()
    const profile = api.readMainDevLocalOllamaProfile(enabledEnv())
    const db = { $queryRaw: vi.fn(async () => [{ databaseName: 'zuri_main_dev' }]) }
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: 'mellum:latest', model: 'mellum:latest', size: 12345 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(api.listInstalledMainDevLocalOllamaModels({
      profile, db, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID, fetchFn,
    })).resolves.toEqual(['mellum:latest'])
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('http://host.docker.internal:11434/api/tags', expect.objectContaining({
      method: 'GET', redirect: 'error', signal: expect.any(AbortSignal),
    }))
  })

  it('does not contact Ollama when the server-side scope is not allowlisted', async () => {
    const api = await loadApi()
    const profile = api.readMainDevLocalOllamaProfile(enabledEnv())
    const db = { $queryRaw: vi.fn() }
    const fetchFn = vi.fn()

    await expect(api.listInstalledMainDevLocalOllamaModels({
      profile, db, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: OTHER_ACCOUNT_ID, fetchFn,
    })).rejects.toThrow(/MAIN_DEV_LOCAL_OLLAMA_SCOPE_DENIED/)
    expect(db.$queryRaw).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('rejects oversized tags responses before parsing them', async () => {
    const api = await loadApi()
    const profile = api.readMainDevLocalOllamaProfile(enabledEnv())
    const db = { $queryRaw: vi.fn(async () => [{ databaseName: 'zuri_main_dev' }]) }
    const fetchFn = vi.fn(async () => new Response('{"models":[]}', {
      status: 200,
      headers: { 'content-length': '65537' },
    }))

    await expect(api.listInstalledMainDevLocalOllamaModels({
      profile, db, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID, fetchFn,
    })).rejects.toThrow(/OLLAMA_TAGS_RESPONSE_TOO_LARGE/)
  })

  it('cancels an oversized declared tags body without reading or retrying it', async () => {
    const api = await loadApi()
    const profile = api.readMainDevLocalOllamaProfile(enabledEnv())
    const db = { $queryRaw: vi.fn(async () => [{ databaseName: 'zuri_main_dev' }]) }
    const body = { cancel: vi.fn(async () => {}), getReader: vi.fn() }
    const fetchFn = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-length': '65537' }),
      body,
    }))

    await expect(api.listInstalledMainDevLocalOllamaModels({
      profile, db, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID, fetchFn,
    })).rejects.toThrow(/OLLAMA_TAGS_RESPONSE_TOO_LARGE/)
    expect(body.cancel).toHaveBeenCalledTimes(1)
    expect(body.getReader).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed or unsuccessful tags responses without exposing their content', async () => {
    const api = await loadApi()
    const profile = api.readMainDevLocalOllamaProfile(enabledEnv())
    const db = { $queryRaw: vi.fn(async () => [{ databaseName: 'zuri_main_dev' }]) }
    const invalidModel = vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'not a model id' }] }), { status: 200 }))
    const redirect = vi.fn(async () => new Response('private redirect target', { status: 302 }))

    await expect(api.listInstalledMainDevLocalOllamaModels({
      profile, db, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID, fetchFn: invalidModel,
    })).rejects.toThrow(/OLLAMA_TAGS_RESPONSE_INVALID/)
    await expect(api.listInstalledMainDevLocalOllamaModels({
      profile, db, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID, fetchFn: redirect,
    })).rejects.not.toThrow('private redirect target')
  })
})

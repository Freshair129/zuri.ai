// @req FR-079, FR-080 — owner selection is restricted to the default-off main-dev
//   profile and persists only the installed model ID on the existing Phase 1 connection.
// @spec ADR-100 D9, SEC-001, SEC-030 — server-derived scope, fixed local origin, no key material.
// @tested tests/unit/local-ollama-selection-service.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({ defaultDb: {} }))
vi.mock('@/lib/db', () => ({ default: mocks.defaultDb }))

import { ownsElsewhere } from '../factories/viewer'
import { makeViewer } from '../factories/viewer'
import {
  listMainDevLocalOllamaModels,
  selectMainDevLocalOllamaModel,
} from '@/modules/integration/application/local-ollama-selection-service'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const BUSINESS_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_BUSINESS_ID = '44444444-4444-4444-8444-444444444444'
const INSTALLED_MODEL = 'qwen3:8b'

function enabledEnv(overrides = {}) {
  return {
    ZURI_PHASE1_RUNTIME_SOURCE: 'MAIN_DEV_LOCAL_OLLAMA',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'true',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE: 'zuri_main_dev',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH: path.join(os.tmpdir(), 'local-ollama-test-only-public.json'),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256: 'a'.repeat(64),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS: JSON.stringify([TENANT_ID]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: JSON.stringify([BUSINESS_ID]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: JSON.stringify([ACCOUNT_ID]),
    ...overrides,
  }
}

function owner(overrides = {}) {
  return makeViewer({
    visibleBusinessIds: [BUSINESS_ID],
    ownedBusinessIds: [BUSINESS_ID],
    visibleDomains: ['line-oa'],
    ...overrides,
  })
}

function account(overrides = {}) {
  return {
    id: ACCOUNT_ID,
    tenantId: TENANT_ID,
    businessId: BUSINESS_ID,
    displayName: 'Test LINE OA',
    status: 'CONNECTED',
    serverEnabled: true,
    executionMode: 'SERVER',
    runtimeOwner: 'SERVER',
    knowledgeGrounding: 'BUSINESS_KNOWLEDGE',
    knowledgeGroundingShadow: false,
    memoryPolicy: 'OFF',
    memoryProjectId: null,
    ...overrides,
  }
}

function createDb(overrides = {}) {
  const state = {
    databaseName: 'zuri_main_dev',
    businesses: [{ id: BUSINESS_ID, tenantId: TENANT_ID }],
    accounts: [account()],
    provider: null,
    connections: [],
    businessModelKey: null,
    auditEvents: [],
    failPromotionCas: false,
    ...overrides,
  }

  function withRelations(row, include) {
    if (!row) return null
    const result = { ...row }
    if (include?.provider) result.provider = state.provider?.id === row.providerId ? state.provider : null
    if (include?.credential) result.credential = row.credential ?? null
    return result
  }

  const db = {
    state,
    $queryRaw: vi.fn(async () => [{ databaseName: state.databaseName }]),
    $transaction: vi.fn(async (work) => work(db)),
    business: {
      findUnique: vi.fn(async ({ where }) => state.businesses.find((row) => row.id === where.id) ?? null),
      findMany: vi.fn(async () => state.businesses),
    },
    lineOaAccount: {
      findMany: vi.fn(async () => state.accounts),
    },
    integrationProvider: {
      findUnique: vi.fn(async ({ where }) => (
        state.provider && (state.provider.code === where.code || state.provider.id === where.id)
          ? state.provider
          : null
      )),
      create: vi.fn(async ({ data }) => {
        if (state.provider?.code === data.code) {
          const error = new Error('Unique constraint failed')
          error.code = 'P2002'
          throw error
        }
        state.provider = { id: 'provider-ollama', ...data }
        return state.provider
      }),
    },
    integrationConnection: {
      findMany: vi.fn(async ({ where, include }) => {
        if (where.purpose === 'MODEL_PROVIDER') return state.businessModelKey ? [state.businessModelKey] : []
        const rows = state.connections.filter((row) => (
          row.tenantId === where.tenantId
          && row.businessId === where.businessId
          && row.purpose === where.purpose
          && (!where.providerId || row.providerId === where.providerId)
        ))
        return include?.provider || include?.credential
          ? rows.map((row) => withRelations(row, include))
          : rows
      }),
      findUnique: vi.fn(async ({ where, include }) => {
        const row = state.connections.find((candidate) => candidate.id === where.id) ?? null
        return include?.provider || include?.credential ? withRelations(row, include) : row
      }),
      create: vi.fn(async ({ data }) => {
        const row = { id: `connection-${state.connections.length + 1}`, version: 1, ...data }
        state.connections.push(row)
        return row
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        if (state.failPromotionCas && where.id && where.version !== undefined) return { count: 0 }
        const rows = state.connections.filter((row) => (
          (where.id === undefined || (typeof where.id === 'string' ? row.id === where.id : row.id !== where.id.not))
          && (where.tenantId === undefined || row.tenantId === where.tenantId)
          && (where.businessId === undefined || row.businessId === where.businessId)
          && (where.purpose === undefined || row.purpose === where.purpose)
          && (where.status === undefined || row.status === where.status)
          && (where.role === undefined || (typeof where.role === 'object'
            ? row.role !== where.role.not
            : row.role === where.role))
          && (where.version === undefined || row.version === where.version)
        ))
        for (const row of rows) {
          for (const [key, value] of Object.entries(data)) {
            row[key] = value && typeof value === 'object' && 'increment' in value
              ? row[key] + value.increment
              : value
          }
        }
        return { count: rows.length }
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }) => {
        state.auditEvents.push(data)
        return data
      }),
    },
  }
  return db
}

function ollamaTags(models = [INSTALLED_MODEL, 'llama3.2:latest']) {
  return vi.fn(async (url, init) => {
    expect(url).toBe('http://host.docker.internal:11434/api/tags')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), {
      headers: { 'content-type': 'application/json' },
    })
  })
}

describe('main-dev local Ollama owner selection', () => {
  let db
  let fetchFn

  beforeEach(() => {
    db = createDb()
    fetchFn = ollamaTags()
  })

  it('retains owner model selection only for the matching private RAG profile and GKS account', async () => {
    db.state.accounts = [account({ knowledgeGrounding: 'GKS_CORPUS' })]
    const env = enabledEnv({ ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_TEST_ONLY',
      ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_MANIFEST_SHA256: 'b'.repeat(64),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_PRODUCTS: JSON.stringify([{ productId: OTHER_BUSINESS_ID,
        sku: 'TEST-ONLY-RAG-001', sourceId: TENANT_ID, ingestionId: BUSINESS_ID, fileSha256: 'c'.repeat(64) }]) })
    await expect(listMainDevLocalOllamaModels({ viewer: owner(), db, env, fetchFn }))
      .resolves.toMatchObject({ accountId: ACCOUNT_ID, knowledgeSource: 'GENESISRAG17_TEST_ONLY' })
    db.state.accounts = [account({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' })]
    await expect(listMainDevLocalOllamaModels({ viewer: owner(), db, env, fetchFn })).rejects.toMatchObject({ status: 404 })
  })

  it('lists installed models only for the unique owned Business and connected server OA in the actual main-dev database', async () => {
    await expect(listMainDevLocalOllamaModels({ viewer: owner(), db, env: enabledEnv(), fetchFn })).resolves.toEqual({
      businessId: BUSINESS_ID,
      accountId: ACCOUNT_ID,
      accountName: 'Test LINE OA',
      models: ['llama3.2:latest', INSTALLED_MODEL],
      selectedModelId: null,
    })
    expect(db.$queryRaw).toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('is hidden while the private profile is off and performs no inventory lookup', async () => {
    await expect(listMainDevLocalOllamaModels({ viewer: owner(), db, env: {}, fetchFn }))
      .rejects.toMatchObject({ status: 404 })
    expect(db.business.findMany).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses an actual database identity mismatch before contacting Ollama', async () => {
    db.state.databaseName = 'zuri_uat'
    await expect(listMainDevLocalOllamaModels({ viewer: owner(), db, env: enabledEnv(), fetchFn }))
      .rejects.toMatchObject({ status: 404 })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a visible-but-not-owned Business and does not contact Ollama', async () => {
    const member = ownsElsewhere({
      owns: OTHER_BUSINESS_ID,
      sees: BUSINESS_ID,
      seesDomains: ['line-oa'],
      visibleDomains: ['line-oa'],
    })
    await expect(listMainDevLocalOllamaModels({ viewer: member, db, env: enabledEnv(), fetchFn }))
      .rejects.toMatchObject({ status: 404 })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([
    ['not connected', { status: 'DRAFT' }],
    ['not server enabled', { serverEnabled: false }],
    ['not in server execution mode', { executionMode: 'EDGE' }],
    ['runtime owned elsewhere', { runtimeOwner: 'CONVERSATION_RUNTIME' }],
    ['memory policy enabled', { memoryPolicy: 'ON', memoryProjectId: 'project-1' }],
    ['shadow mode enabled', { knowledgeGroundingShadow: true }],
    ['non-business grounding', { knowledgeGrounding: 'GKS_CORPUS' }],
  ])('refuses an OA account that is %s', async (_reason, changes) => {
    db.state.accounts = [account(changes)]
    await expect(listMainDevLocalOllamaModels({ viewer: owner(), db, env: enabledEnv(), fetchFn }))
      .rejects.toMatchObject({ status: 404 })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([
    ['thread memory enabled', { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' }],
    ['episodic memory enabled', { ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true' }],
  ])('keeps the owner selector unavailable when %s', async (_reason, overrides) => {
    await expect(listMainDevLocalOllamaModels({ viewer: owner(), db, env: enabledEnv(overrides), fetchFn }))
      .rejects.toMatchObject({ status: 404 })
    expect(db.business.findMany).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('fails closed when the viewer has more than one eligible allowlisted Business', async () => {
    const env = enabledEnv({
      ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: JSON.stringify([BUSINESS_ID, OTHER_BUSINESS_ID]),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: JSON.stringify([ACCOUNT_ID, '55555555-5555-4555-8555-555555555555']),
    })
    db.state.businesses.push({ id: OTHER_BUSINESS_ID, tenantId: TENANT_ID })
    db.state.accounts.push(account({ id: '55555555-5555-4555-8555-555555555555', businessId: OTHER_BUSINESS_ID }))
    await expect(listMainDevLocalOllamaModels({
      viewer: makeViewer({
        visibleBusinessIds: [BUSINESS_ID, OTHER_BUSINESS_ID],
        ownedBusinessIds: [BUSINESS_ID, OTHER_BUSINESS_ID],
        visibleDomains: ['line-oa'],
      }), db, env, fetchFn,
    })).rejects.toMatchObject({ status: 404 })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('re-lists and accepts only an installed model ID, then persists only model metadata and audit metadata', async () => {
    const result = await selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL }, {
      viewer: owner(), db, env: enabledEnv(), fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ businessId: BUSINESS_ID, accountId: ACCOUNT_ID, modelId: INSTALLED_MODEL })
    expect(result).not.toHaveProperty('baseUrl')
    expect(db.state.provider).toMatchObject({ code: 'ollama', status: 'ACTIVE' })
    expect(db.state.connections).toHaveLength(1)
    expect(db.state.connections[0]).toMatchObject({
      tenantId: TENANT_ID,
      businessId: BUSINESS_ID,
      purpose: 'PHASE1_LINE_LLM',
      role: 'PRIMARY',
      status: 'ACTIVE',
      authorizationType: 'NONE',
      metadataJson: JSON.stringify({ model: INSTALLED_MODEL }),
    })
    expect(db.state.connections[0]).not.toHaveProperty('secretRef')
    expect(db.state.auditEvents).toHaveLength(1)
    expect(db.state.auditEvents[0].payloadJson).toContain(INSTALLED_MODEL)
    expect(db.state.auditEvents[0].payloadJson).not.toMatch(/secret|key|token|baseUrl/i)
    await expect(listMainDevLocalOllamaModels({ viewer: owner(), db, env: enabledEnv(), fetchFn }))
      .resolves.toMatchObject({ selectedModelId: INSTALLED_MODEL })
  })

  it('retries an already-selected model without creating another connection or duplicate audit event', async () => {
    const options = { viewer: owner(), db, env: enabledEnv(), fetchFn }
    await selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL }, options)
    await selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL }, options)

    expect(db.state.connections).toHaveLength(1)
    expect(db.state.auditEvents).toHaveLength(1)
    expect(db.integrationProvider.create).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('rejects unknown installed models and strict-body scope or endpoint fields before any write', async () => {
    await expect(selectMainDevLocalOllamaModel({ modelId: 'missing:latest' }, {
      viewer: owner(), db, env: enabledEnv(), fetchFn,
    })).rejects.toMatchObject({ status: 400 })
    await expect(selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL, businessId: BUSINESS_ID }, {
      viewer: owner(), db, env: enabledEnv(), fetchFn,
    })).rejects.toMatchObject({ name: 'ZodError' })
    expect(db.state.connections).toHaveLength(0)
    expect(db.state.auditEvents).toHaveLength(0)
  })

  it('refuses when a Business MODEL_PROVIDER_KEY exists without reading or decrypting the credential', async () => {
    db.state.businessModelKey = {
      purpose: 'MODEL_PROVIDER',
      credential: { id: 'credential-row', status: 'ACTIVE', secretRef: 'opaque-ref' },
    }
    await expect(selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL }, {
      viewer: owner(), db, env: enabledEnv(), fetchFn,
    })).rejects.toMatchObject({ status: 409 })
    expect(db.integrationConnection.create).not.toHaveBeenCalled()
    expect(db.integrationProvider.create).not.toHaveBeenCalled()
    expect(db.state.auditEvents).toHaveLength(0)
  })

  it('does not overwrite or reactivate an existing inactive ollama provider row', async () => {
    db.state.provider = { id: 'provider-ollama', code: 'ollama', name: 'Ollama', status: 'DISABLED', capabilitiesJson: '{}' }
    await expect(selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL }, {
      viewer: owner(), db, env: enabledEnv(), fetchFn,
    })).rejects.toMatchObject({ status: 409 })
    expect(db.integrationProvider.create).not.toHaveBeenCalled()
    expect(db.state.provider.status).toBe('DISABLED')
    expect(db.state.connections).toHaveLength(0)
  })

  it('does not overwrite an existing active but globally misconfigured ollama provider', async () => {
    db.state.provider = { id: 'provider-ollama', code: 'ollama', name: 'Ollama', status: 'ACTIVE', capabilitiesJson: '{}' }
    await expect(selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL }, {
      viewer: owner(), db, env: enabledEnv(), fetchFn,
    })).rejects.toMatchObject({ status: 409 })
    expect(db.integrationProvider.create).not.toHaveBeenCalled()
    expect(db.state.provider).toMatchObject({ name: 'Ollama', capabilitiesJson: '{}' })
    expect(db.state.connections).toHaveLength(0)
  })

  it('refuses an Ollama connection that already has credential metadata', async () => {
    db.state.provider = {
      id: 'provider-ollama',
      code: 'ollama',
      name: 'Main-dev local Ollama (TEST ONLY)',
      status: 'ACTIVE',
      capabilitiesJson: JSON.stringify({ phase1Line: true, localOnly: true, mainDevLocalOllama: true }),
    }
    db.state.connections.push({
      id: 'credentialed-local-connection',
      tenantId: TENANT_ID,
      businessId: BUSINESS_ID,
      providerId: 'provider-ollama',
      purpose: 'PHASE1_LINE_LLM',
      status: 'DRAFT',
      role: 'SECONDARY',
      version: 1,
      credential: { id: 'credential-row' },
    })
    await expect(selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL }, {
      viewer: owner(), db, env: enabledEnv(), fetchFn,
    })).rejects.toMatchObject({ status: 409 })
    expect(db.integrationConnection.create).not.toHaveBeenCalled()
    expect(db.state.auditEvents).toHaveLength(0)
  })

  it('refuses a credential-bearing same-model primary before the idempotent return', async () => {
    db.state.provider = {
      id: 'provider-ollama',
      code: 'ollama',
      name: 'Main-dev local Ollama (TEST ONLY)',
      status: 'ACTIVE',
      capabilitiesJson: JSON.stringify({ phase1Line: true, localOnly: true, mainDevLocalOllama: true }),
    }
    db.state.connections.push({
      id: 'credentialed-primary',
      tenantId: TENANT_ID,
      businessId: BUSINESS_ID,
      providerId: 'provider-ollama',
      purpose: 'PHASE1_LINE_LLM',
      status: 'ACTIVE',
      role: 'PRIMARY',
      metadataJson: JSON.stringify({ model: INSTALLED_MODEL }),
      authorizationType: 'NONE',
      version: 3,
      credential: { id: 'credential-row' },
    })

    await expect(selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL }, {
      viewer: owner(), db, env: enabledEnv(), fetchFn,
    })).rejects.toMatchObject({ status: 409 })

    expect(db.integrationConnection.updateMany).not.toHaveBeenCalled()
    expect(db.integrationConnection.create).not.toHaveBeenCalled()
    expect(db.state.connections[0]).toMatchObject({ role: 'PRIMARY', version: 3 })
    expect(db.state.auditEvents).toHaveLength(0)
  })

  it('returns a conflict when the existing primary compare-and-swap loses a race', async () => {
    db.state.failPromotionCas = true
    await expect(selectMainDevLocalOllamaModel({ modelId: INSTALLED_MODEL }, {
      viewer: owner(), db, env: enabledEnv(), fetchFn,
    })).rejects.toMatchObject({ status: 409 })
    expect(db.state.auditEvents).toHaveLength(0)
  })
})

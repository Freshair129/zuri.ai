import { afterEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPhase1BusinessAgentPortsFromEnv } from '@/modules/agent/phase1-runtime'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'

// @req FR-079, FR-080 — the main-dev profile uses only a pinned TEST ONLY Product fixture and owner-selected Ollama.
// @spec ADR-100 D9, SEC-001 — preserve production/keyed gates and server scope; refuse memory by default and permit only the approved opt-in path, while corpus/shadow stay denied.
// @tested tests/unit/main-dev-local-ollama-runtime.test.js

const TENANT_ID = '26d0a24b-a2ef-44dd-8e8c-c9a0d5b3ca94'
const BUSINESS_ID = 'ad4f8f05-cc9e-41a9-9a57-0b0a84bf2f8f'
const ACCOUNT_ID = '03019679-ea52-4e6c-95ab-241e60260edd'
const OTHER_ACCOUNT_ID = '13019679-ea52-4e6c-95ab-241e60260edd'
const PRODUCT_CODE = 'TEST-ONLY-PCAT-SKU-AD4F8F05CC9E41A99A570B0A84BF2F8F'
const fixtureDirectories = []

function fixtureRecord() {
  return {
    knowledge_id: 'commerce-sku:4a0ebfcf-ab47-4622-bdc8-e9e7b8240907',
    business_id: BUSINESS_ID,
    knowledge_type: 'PRODUCT',
    product_code: PRODUCT_CODE,
    name: 'TEST ONLY PCAT fixture SKU AD4F8F05CC9E41A99A570B0A84BF2F8F',
    category: null,
    description: null,
    unit: 'EA',
    sell_price: null,
    currency: null,
    moq: null,
    colors: [],
    specification: {},
    source_ref: 'main-dev-test-pcat:fixture#commerce-sku:4a0ebfcf-ab47-4622-bdc8-e9e7b8240907',
    source_sha256: 'c2b2782415ae3ffc49885307d1a168d04a8c20e8a35297ad3c9cd0a399628842',
    as_of: '2026-10-23T15:30:03.673Z',
    approved_at: '2026-10-23T15:30:03.673Z',
    is_active: true,
    sensitivity: 'PUBLIC',
    contract_version: '1.0.0',
  }
}

function makeFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-main-dev-runtime-fixture-'))
  fixtureDirectories.push(directory)
  const fixturePath = path.join(directory, 'ollama-test-only-public.json')
  const raw = JSON.stringify({
    schemaVersion: '1.0.0',
    purpose: 'TEST_ONLY_PUBLIC',
    scope: { tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID },
    records: [fixtureRecord()],
  })
  fs.writeFileSync(fixturePath, raw, { encoding: 'utf8', flag: 'wx' })
  return { fixturePath, fixtureSha256: crypto.createHash('sha256').update(raw).digest('hex') }
}

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function profileEnv(overrides = {}) {
  const fixture = makeFixture()
  return {
    NODE_ENV: 'production',
    ZURI_PHASE1_RUNTIME_SOURCE: 'MAIN_DEV_LOCAL_OLLAMA',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'true',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE: 'zuri_main_dev',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS: JSON.stringify([TENANT_ID]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: JSON.stringify([BUSINESS_ID]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: JSON.stringify([ACCOUNT_ID]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH: fixture.fixturePath,
    ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256: fixture.fixtureSha256,
    ...overrides,
  }
}

function makeConnection(overrides = {}) {
  return {
    id: 'connection-main-dev-ollama',
    tenantId: TENANT_ID,
    businessId: BUSINESS_ID,
    purpose: 'PHASE1_LINE_LLM',
    role: 'PRIMARY',
    status: 'ACTIVE',
    metadataJson: JSON.stringify({ model: 'mellum:latest' }),
    provider: { code: 'ollama', status: 'ACTIVE' },
    credential: null,
    ...overrides,
  }
}

function runtimeDependencies({ databaseName = 'zuri_main_dev', connection = makeConnection(), businessKeyPresent = false } = {}) {
  const integrationDb = {
    $queryRaw: vi.fn(async () => [{ databaseName }]),
    integrationConnection: {
      findMany: vi.fn(async ({ where } = {}) => {
        if (where?.purpose === 'MODEL_PROVIDER') {
          return businessKeyPresent
            ? [{ id: 'business-key-connection', status: 'REVOKED', credential: { id: 'credential-row' } }]
            : []
        }
        return [connection]
      }),
    },
  }
  const modelCredentialResolver = vi.fn(async () => {
    throw new Error('main-dev keyless profile must not resolve or decrypt Business credentials')
  })
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({
    response: `ข้อมูลทดสอบ ${PRODUCT_CODE}`,
    prompt_eval_count: 8,
    eval_count: 5,
  }), { headers: { 'content-type': 'application/json' } }))
  return { integrationDb, modelCredentialResolver, fetchFn }
}

describe('main-dev keyless Ollama Phase-1 ports', () => {
  it('builds only the pinned fixture reader and Ollama port without legacy SQL/model settings', async () => {
    const env = profileEnv({ ZURI_LINE_DB_URL: 'postgresql://ignored.example/main-dev-profile-must-not-read-this' })
    const dependencies = runtimeDependencies()
    const legacyQuery = vi.fn()
    const ports = createPhase1BusinessAgentPortsFromEnv(env, {
      bindingRequired: false,
      integrationDb: dependencies.integrationDb,
      modelCredentialResolver: dependencies.modelCredentialResolver,
      queryFn: legacyQuery,
      fetchFn: dependencies.fetchFn,
    })

    expect(ports.runtimeSource).toBe('MAIN_DEV_LOCAL_OLLAMA')
    expect(ports.bindingResolver).toBeNull()
    expect(ports.model).toBeNull()
    const model = await ports.resolveModel({ tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID })
    const generated = await model.generate({ question: `What is ${PRODUCT_CODE}?`, evidence: { records: [fixtureRecord()] } })
    expect(model.provider).toBe('ollama')
    expect(generated.text).toContain(PRODUCT_CODE)
    expect(await ports.businessKnowledge.query({
      tenantId: TENANT_ID, businessId: BUSINESS_ID, queryId: 'product_detail',
      params: { productCode: PRODUCT_CODE }, limit: 1,
    })).toMatchObject({ records: [{ product_code: PRODUCT_CODE, sell_price: null, currency: null, moq: null }] })
    expect(dependencies.integrationDb.$queryRaw).toHaveBeenCalled()
    expect(dependencies.integrationDb.integrationConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT_ID, businessId: BUSINESS_ID, purpose: 'MODEL_PROVIDER' },
      select: { id: true, credential: { select: { id: true } } },
    }))
    expect(dependencies.integrationDb.integrationConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: TENANT_ID, businessId: BUSINESS_ID, purpose: 'PHASE1_LINE_LLM' }),
    }))
    expect(dependencies.modelCredentialResolver).not.toHaveBeenCalled()
    expect(dependencies.fetchFn).toHaveBeenCalledOnce()
    expect(dependencies.fetchFn.mock.calls[0][0]).toBe('http://host.docker.internal:11434/api/generate')
    expect(dependencies.fetchFn.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
    expect(JSON.parse(dependencies.fetchFn.mock.calls[0][1].body)).toMatchObject({ model: 'mellum:latest', stream: false })
    expect(legacyQuery).not.toHaveBeenCalled()
  })

  it('checks database identity before connection or model selection', async () => {
    const dependencies = runtimeDependencies({ databaseName: 'zuri_uat' })
    const ports = createPhase1BusinessAgentPortsFromEnv(profileEnv(), {
      bindingRequired: false,
      integrationDb: dependencies.integrationDb,
      modelCredentialResolver: dependencies.modelCredentialResolver,
      fetchFn: dependencies.fetchFn,
    })

    await expect(ports.resolveModel({ tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID }))
      .rejects.toMatchObject({ code: 'MAIN_DEV_LOCAL_OLLAMA_DATABASE_MISMATCH' })
    expect(dependencies.integrationDb.integrationConnection.findMany).not.toHaveBeenCalled()
    expect(dependencies.modelCredentialResolver).not.toHaveBeenCalled()
    expect(dependencies.fetchFn).not.toHaveBeenCalled()
  })

  it('rejects any Business model-key credential row without resolving its secret or selecting local Ollama', async () => {
    const dependencies = runtimeDependencies({ businessKeyPresent: true })
    const ports = createPhase1BusinessAgentPortsFromEnv(profileEnv(), {
      bindingRequired: false,
      integrationDb: dependencies.integrationDb,
      modelCredentialResolver: dependencies.modelCredentialResolver,
      fetchFn: dependencies.fetchFn,
    })

    await expect(ports.resolveModel({ tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID }))
      .rejects.toMatchObject({ code: 'MAIN_DEV_LOCAL_OLLAMA_BUSINESS_KEY_PRESENT' })
    expect(dependencies.integrationDb.integrationConnection.findMany).toHaveBeenCalledOnce()
    expect(dependencies.integrationDb.integrationConnection.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, businessId: BUSINESS_ID, purpose: 'MODEL_PROVIDER' },
      select: { id: true, credential: { select: { id: true } } },
    })
    expect(dependencies.modelCredentialResolver).not.toHaveBeenCalled()
    expect(dependencies.fetchFn).not.toHaveBeenCalled()
  })

  it('keeps configured MSP memory flags refused until the separate main-dev extension flag is true', () => {
    const dependencies = runtimeDependencies()
    const env = profileEnv({
      ZURI_MSP_THREAD_MEMORY_ENABLED: 'true',
      ZURI_MSP_THREAD_SERVICE_KEY: 't'.repeat(32),
      ZURI_MSP_THREAD_WORKSPACE_ID: 'msp-memory-workspace',
    })

    expect(() => createPhase1BusinessAgentPortsFromEnv(env, {
      bindingRequired: false,
      integrationDb: dependencies.integrationDb,
      modelCredentialResolver: dependencies.modelCredentialResolver,
      fetchFn: dependencies.fetchFn,
      mspTransport: vi.fn(),
    })).toThrow('MAIN_DEV_LOCAL_OLLAMA_MEMORY_DISABLED')
  })

  it('composes the existing signed thread and principal-private MSP ports when memory is opted in', async () => {
    const env = profileEnv({
      ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED: 'true',
      ZURI_MSP_THREAD_MEMORY_ENABLED: 'true',
      ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true',
      ZURI_MSP_THREAD_SERVICE_KEY: 't'.repeat(32),
      ZURI_MSP_THREAD_WORKSPACE_ID: 'msp-memory-workspace',
      MSP_THREAD_SERVICE_KEYRING: JSON.stringify({ [TENANT_ID]: 'e'.repeat(32) }),
    })
    const calls = []
    const mspTransport = vi.fn(async (name, input) => {
      calls.push({ name, input })
      if (name === 'msp_thread_resolve') return { thread: { threadId: 'msp-main-dev-thread' } }
      if (name === 'msp_vault_resolve') return {
        workspacePrivateVaultId: 'opaque-workspace-vault',
        principalPrivateVaultId: 'opaque-principal-vault',
        globalPrivateVaultIds: [], sharedVaultIds: [],
        permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'v1' },
      }
      if (name === 'msp_memory_list') return { entities: [] }
      throw new Error(`unexpected MSP operation: ${name}`)
    })
    const dependencies = runtimeDependencies()
    const ports = createPhase1BusinessAgentPortsFromEnv(env, {
      bindingRequired: false,
      integrationDb: dependencies.integrationDb,
      modelCredentialResolver: dependencies.modelCredentialResolver,
      fetchFn: dependencies.fetchFn,
      mspTransport,
    })

    expect(ports.threadMemory).toBeTruthy()
    expect(ports.episodicMemory?.recallAuthorized).toBeTypeOf('function')
    await ports.threadMemory.resolveThread({ threadKind: 'DIRECT', audienceKind: 'DIRECT', channelType: 'LINE',
      channelAccountId: ACCOUNT_ID, externalRoomRef: 'line-thread', tenantId: TENANT_ID, businessId: BUSINESS_ID })
    const authorization = {
      authContext: {
        transport: { signatureVerified: true },
        actor: { principalId: 'person-main-dev', identityVerified: true },
        scope: { tenantId: TENANT_ID, businessId: BUSINESS_ID,
          workspaceId: 'workspace-main-dev', projectId: 'project-main-dev' },
        request: { agentId: 'agent-main-dev' },
        policy: { decision: 'ALLOW', episodicMemoryAllowed: true, version: 'v1' },
      },
      authorizedVaults: [{ scope: 'private', tenantId: TENANT_ID, principalId: 'person-main-dev',
        businessId: BUSINESS_ID, agentId: 'agent-main-dev', workspaceId: 'workspace-main-dev',
        projectId: 'project-main-dev' }],
    }
    await ports.episodicMemory.recallAuthorized(authorization)

    expect(calls.map(call => call.name)).toEqual(['msp_thread_resolve', 'msp_vault_resolve', 'msp_memory_list'])
    expect(calls[0].input.access).toMatchObject({
      grant: { operation: 'msp_thread_resolve', tenantId: TENANT_ID, businessId: BUSINESS_ID },
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(calls[1].input.access.grant).toMatchObject({ operation: 'msp_vault_resolve',
      tenantId: TENANT_ID, principalId: 'person-main-dev' })
    expect(calls[2].input).toMatchObject({ vault_id: 'opaque-principal-vault',
      access: { grant: { operation: 'msp_memory_list', tenantId: TENANT_ID, principalId: 'person-main-dev' } } })
  })

  it('fails closed on missing MSP transport or signer material for an opted-in memory profile', () => {
    const dependencies = runtimeDependencies()
    const noTransport = profileEnv({
      ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED: 'true',
      ZURI_MSP_THREAD_MEMORY_ENABLED: 'true',
      ZURI_MSP_THREAD_SERVICE_KEY: 't'.repeat(32),
      ZURI_MSP_THREAD_WORKSPACE_ID: 'msp-memory-workspace',
    })
    expect(() => createPhase1BusinessAgentPortsFromEnv(noTransport, {
      bindingRequired: false, integrationDb: dependencies.integrationDb,
      modelCredentialResolver: dependencies.modelCredentialResolver, fetchFn: dependencies.fetchFn,
    })).toThrow('MSP_THREAD_MEMORY_TRANSPORT_REQUIRED')

    const noThreadSigner = profileEnv({
      ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED: 'true',
      ZURI_MSP_THREAD_MEMORY_ENABLED: 'true',
      ZURI_MSP_THREAD_WORKSPACE_ID: 'msp-memory-workspace',
    })
    expect(() => createPhase1BusinessAgentPortsFromEnv(noThreadSigner, {
      bindingRequired: false, integrationDb: dependencies.integrationDb,
      modelCredentialResolver: dependencies.modelCredentialResolver, fetchFn: dependencies.fetchFn,
      mspTransport: vi.fn(),
    })).toThrow('MSP_THREAD_SERVICE_KEY_REQUIRED')

    const noEpisodicSigner = profileEnv({
      ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED: 'true',
      ZURI_MSP_EPISODIC_MEMORY_ENABLED: 'true',
    })
    expect(() => createPhase1BusinessAgentPortsFromEnv(noEpisodicSigner, {
      bindingRequired: false, integrationDb: dependencies.integrationDb,
      modelCredentialResolver: dependencies.modelCredentialResolver, fetchFn: dependencies.fetchFn,
      mspTransport: vi.fn(),
    })).toThrow('MSP_THREAD_SERVICE_KEY_REQUIRED')
  })

  it.each([
    ['credentialed Ollama connection', makeConnection({ credential: { secretRef: 'credential-secret-ref' } })],
    ['non-Ollama connection', makeConnection({ provider: { code: 'openai' } })],
    ['disabled Ollama provider', makeConnection({ provider: { code: 'ollama', status: 'DISABLED' } })],
    ['connection-selected address', makeConnection({ metadataJson: JSON.stringify({ model: 'mellum:latest', baseUrl: 'http://127.0.0.1:11434' }) })],
  ])('fails closed for a %s', async (_label, connection) => {
    const dependencies = runtimeDependencies({ connection })
    const ports = createPhase1BusinessAgentPortsFromEnv(profileEnv(), {
      bindingRequired: false,
      integrationDb: dependencies.integrationDb,
      modelCredentialResolver: dependencies.modelCredentialResolver,
      fetchFn: dependencies.fetchFn,
    })

    await expect(ports.resolveModel({ tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID }))
      .rejects.toThrow()
    expect(dependencies.fetchFn).not.toHaveBeenCalled()
  })
})

function mainDevJob(overrides = {}) {
  const account = {
    id: ACCOUNT_ID,
    tenantId: TENANT_ID,
    businessId: BUSINESS_ID,
    executionMode: 'SERVER',
    runtimeOwner: 'SERVER',
    serverEnabled: true,
    knowledgeGrounding: 'BUSINESS_KNOWLEDGE',
    knowledgeGroundingShadow: false,
    memoryPolicy: 'OFF',
    memoryProjectId: null,
    ...overrides.account,
  }
  return {
    tenantId: TENANT_ID,
    businessId: BUSINESS_ID,
    accountId: ACCOUNT_ID,
    executionMode: 'SERVER',
    runtimeOwner: 'SERVER',
    inbound: { body: `What is ${PRODUCT_CODE}?` },
    ...overrides,
    account,
  }
}

describe('main-dev LINE answer composition', () => {
  it('passes only the trusted OA account scope and uses the injected BusinessKnowledge reader', async () => {
    const query = vi.fn(async () => ({ records: [fixtureRecord()] }))
    const generate = vi.fn(async () => ({ provider: 'ollama', model: 'mellum:latest', status: 'ok', text: `The test product is ${PRODUCT_CODE}.` }))
    const resolveModel = vi.fn(async () => ({ provider: 'ollama', model: 'mellum:latest', generate }))
    const runtimeFactory = vi.fn(async () => ({ businessKnowledge: { query }, resolveModel }))
    const answer = createServerLineAnswer({ env: profileEnv(), runtimeFactory })

    await expect(answer(mainDevJob())).resolves.toContain(PRODUCT_CODE)
    expect(resolveModel).toHaveBeenCalledWith({ tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID })
    expect(query).toHaveBeenCalledWith({ tenantId: TENANT_ID, businessId: BUSINESS_ID, queryId: 'product_detail', params: { productCode: PRODUCT_CODE }, limit: 1 })
    expect(generate).toHaveBeenCalledOnce()
  })

  it('rejects invalid-model fallback output in this profile', async () => {
    const query = vi.fn(async () => ({ records: [fixtureRecord()] }))
    const generate = vi.fn(async () => ({ text: 'The price is 987654 THB.' }))
    const runtimeFactory = vi.fn(async () => ({
      businessKnowledge: { query },
      resolveModel: async () => ({ provider: 'ollama', model: 'mellum:latest', generate }),
    }))
    const answer = createServerLineAnswer({ env: profileEnv(), runtimeFactory })

    await expect(answer(mainDevJob())).rejects.toThrow('LINE_ANSWER_UNAVAILABLE')
    expect(generate).toHaveBeenCalledOnce()
  })

  it('rejects deterministic fallback after any provider failure in this profile', async () => {
    const query = vi.fn(async () => ({ records: [fixtureRecord()] }))
    const generate = vi.fn(async () => { throw new Error('offline provider') })
    const runtimeFactory = vi.fn(async () => ({
      businessKnowledge: { query },
      resolveModel: async () => ({ provider: 'test-double', model: 'unavailable', generate }),
    }))
    const answer = createServerLineAnswer({ env: profileEnv(), runtimeFactory })

    await expect(answer(mainDevJob())).rejects.toThrow('LINE_ANSWER_UNAVAILABLE')
    expect(generate).toHaveBeenCalledOnce()
  })

  it.each([
    ['a different OA account in the same Business', mainDevJob({ accountId: OTHER_ACCOUNT_ID,
      account: { id: OTHER_ACCOUNT_ID } })],
    ['GKS grounding', mainDevJob({ account: { knowledgeGrounding: 'GKS_CORPUS' } })],
    ['grounding shadow', mainDevJob({ account: { knowledgeGroundingShadow: true } })],
    ['thread memory opt-in', mainDevJob({ memorySyncOptIn: true })],
    ['episodic memory opt-in', mainDevJob({ episodicMemoryOptIn: true })],
  ])('does not compose a runtime for %s', async (_label, jobInput) => {
    const runtimeFactory = vi.fn()
    const answer = createServerLineAnswer({ env: profileEnv(), runtimeFactory })

    await expect(answer(jobInput)).rejects.toThrow('LINE_ANSWER_UNAVAILABLE')
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('rejects enabled memory transports before composing a runtime', async () => {
    const runtimeFactory = vi.fn()
    const env = profileEnv({ ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' })
    const answer = createServerLineAnswer({ env, runtimeFactory })

    await expect(answer(mainDevJob())).rejects.toThrow('LINE_ANSWER_UNAVAILABLE')
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('sends only composed thread context through the normal injection and projection receipt path', async () => {
    const env = profileEnv({
      ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED: 'true',
      ZURI_MSP_THREAD_MEMORY_ENABLED: 'true',
    })
    const job = mainDevJob({
      memorySyncOptIn: true,
      episodicMemoryOptIn: false,
      audienceKind: 'DIRECT',
      eventId: 'event-main-dev-memory',
      sourceUserId: 'line-user-main-dev',
      channelAccountId: ACCOUNT_ID,
      transportEpoch: 1,
      inbound: {
        id: 'crm-inbound-main-dev-memory',
        body: `What is ${PRODUCT_CODE}?`,
        conversation: { tenantId: TENANT_ID, businessId: BUSINESS_ID, channel: 'LINE',
          channelAccountId: ACCOUNT_ID, externalThreadId: 'line-thread-main-dev' },
      },
      account: { bindingCode: ACCOUNT_ID, memoryPolicy: 'ON', memoryProjectId: null },
    })
    const recentExchange = { exchangeId: 'previous-main-dev-exchange', messages: [
      { sequence: 1, speakerKind: 'HUMAN', text: 'remembered bounded thread context' },
    ] }
    const identity = { principalId: 'person-main-dev', verified: true }
    const thread = { threadId: 'msp-main-dev-thread', businessId: BUSINESS_ID, audienceKind: 'DIRECT' }
    const contextAssembler = vi.fn(async (input) => ({
      identity,
      thread,
      authContext: { scope: { tenantId: TENANT_ID, businessId: BUSINESS_ID } },
      policy: { version: 'memory-policy-v1', privateMemoryAllowed: true },
      ...(!input.deferThreadRecall ? { threadMemory: {
        policyDecision: 'ALLOW', thread, identity,
        memory: { participants: [], recentExchanges: [recentExchange], summaries: [], protectedMemory: [] },
        manifest: { omittedRanges: [], coverageGap: false,
          budget: { maxContextBytes: 24000, estimator: 'utf8-bytes-upper-bound', truncated: false } },
      } } : {}),
    }))
    const appendMessage = vi.fn(async (input) => input.direction === 'INBOUND'
      ? { message: { messageId: 'msp-inbound-main-dev', exchangeId: 'msp-exchange-main-dev' }, session: { sessionId: 'msp-session-main-dev' } }
      : { message: { messageId: 'msp-agent-main-dev', exchangeId: 'msp-exchange-main-dev' }, session: { sessionId: 'msp-session-main-dev' } })
    let modelInput
    const generate = vi.fn(async (input) => {
      modelInput = input
      return { provider: 'ollama', model: 'mellum:latest', status: 'ok', text: `The test item is ${PRODUCT_CODE}.` }
    })
    let injectionPacket
    const withInjectionReceipt = vi.fn(({ model, contextPacket }) => {
      injectionPacket = contextPacket
      return { ...model, generate }
    })
    const threadMemory = { appendMessage, withInjectionReceipt }
    const projectionReceiptWriter = vi.fn()
    const authorizationResolver = vi.fn(async () => ({
      authContext: {
        scope: { tenantId: TENANT_ID, businessId: BUSINESS_ID },
        actor: { principalId: identity.principalId, identityVerified: true },
        policy: { decision: 'ALLOW', privateMemoryAllowed: true, mspAuthorization: { read: true }, version: 'memory-policy-v1' },
      },
      policy: { privateMemoryAllowed: true, mspAuthorization: { read: true }, version: 'memory-policy-v1' },
    }))
    const runtimeFactory = vi.fn(async () => ({
      businessKnowledge: { query: vi.fn(async () => ({ records: [fixtureRecord()] })) },
      resolveModel: vi.fn(async () => ({ provider: 'ollama', model: 'mellum:latest', generate })),
      threadMemory,
    }))
    const answer = createServerLineAnswer({ env, runtimeFactory, contextAssembler, authorizationResolver,
      projectionReceiptWriter })

    await expect(answer(job)).resolves.toContain(PRODUCT_CODE)

    expect(runtimeFactory).toHaveBeenCalledOnce()
    expect(withInjectionReceipt).toHaveBeenCalledOnce()
    expect(injectionPacket.memory.recentExchanges).toEqual([recentExchange])
    expect(modelInput.contextPacket).toEqual(injectionPacket)
    expect(modelInput.contextPacket.memory.recentExchanges[0].exchangeId).toBe('previous-main-dev-exchange')
    expect(appendMessage).toHaveBeenCalledTimes(2)
    expect(appendMessage.mock.calls[0][0]).toMatchObject({ direction: 'INBOUND', messageId: 'crm-inbound-main-dev-memory' })
    expect(appendMessage.mock.calls[1][0]).toMatchObject({ direction: 'OUTBOUND', deliveryState: 'QUEUED', replyToMessageId: 'msp-inbound-main-dev' })
    expect(projectionReceiptWriter).toHaveBeenCalledTimes(2)
    expect(projectionReceiptWriter.mock.calls.map(([receipt]) => receipt.direction)).toEqual(['INBOUND', 'OUTBOUND'])
  })
})

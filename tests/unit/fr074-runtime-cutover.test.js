import { describe, expect, it, vi } from 'vitest'

import {
  RUNTIME_SOURCES,
  SecretManagerError,
  createSecretManagerPort,
} from '@/platform/integrations/core/secret-manager'
import {
  promotePhase1PrimaryConnection,
  resolvePhase1PrimaryConnectionByQuery,
  selectPhase1PrimaryConnection,
} from '@/platform/integrations/core/integration-registry'
import {
  LOCAL_EVAL_PROVIDERS,
  PUBLIC_LINE_PROVIDERS,
  createModelProviderPort,
} from '@/modules/agent/model-provider'
import { createPhase1BusinessAgentPortsFromEnv } from '@/modules/agent/phase1-runtime'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'
import { answerBusinessQuestion } from '@/modules/agent/grounded-business-answer'

// @req FR-074 — binding-scoped connection selection, production secret resolution and local Ollama boundary.
// @spec ADR-031, NFR-015, SEC-015, SDD-043
// @tested tests/unit/fr074-runtime-cutover.test.js

describe('FR-074 runtime source and SecretManagerPort', () => {
  it('keeps production on the external adapter and rejects a missing production manager', () => {
    expect(RUNTIME_SOURCES).toEqual(['PRODUCTION_LINE', 'LOCAL_DEV', 'TEST', 'EVAL'])
    expect(() => createSecretManagerPort({ runtimeSource: 'PRODUCTION_LINE' })).toThrow(/production.*secret manager/i)
  })

  it('rejects a local vault adapter and raw model configuration in production', () => {
    const localAdapter = { kind: 'file-vault', resolve: vi.fn() }
    expect(() => createSecretManagerPort({ runtimeSource: 'PRODUCTION_LINE', adapter: localAdapter }))
      .toThrow(/local.*vault/i)
  })

  it('resolves a scoped secret without exposing material in the returned metadata or errors', async () => {
    const adapter = {
      resolve: vi.fn(async () => ({ material: 'provider-secret', version: 'v7', expiresAt: new Date(Date.now() + 60_000) })),
    }
    const port = createSecretManagerPort({ runtimeSource: 'TEST', adapter, cacheTtlMs: 5_000 })

    await expect(port.resolve('secret://phase1/business-a', { tenantId: 'tenant-a', businessId: 'business-a' }))
      .resolves.toMatchObject({ version: 'v7' })
    expect(JSON.stringify(await port.resolve('secret://phase1/business-a', { tenantId: 'tenant-a', businessId: 'business-a' })))
      .not.toContain('provider-secret')
    expect(adapter.resolve).toHaveBeenCalledOnce()
  })

  it('normalizes secret-manager failures to the allowed fail-closed taxonomy', async () => {
    const adapter = { resolve: vi.fn(async () => { throw new SecretManagerError('Unavailable') }) }
    const port = createSecretManagerPort({ runtimeSource: 'TEST', adapter })

    await expect(port.resolve('secret://missing', { tenantId: 'tenant-a', businessId: 'business-a' }))
      .rejects.toMatchObject({ code: 'Unavailable' })
  })
})

describe('FR-074 Phase 1 primary connection selection', () => {
  const base = { tenantId: 'tenant-a', businessId: 'business-a', purpose: 'PHASE1_LINE_LLM' }

  it('selects only the exact active primary connection in the trusted scope', () => {
    expect(selectPhase1PrimaryConnection([
      { id: 'wrong-purpose', ...base, purpose: 'OTHER', status: 'ACTIVE', role: 'PRIMARY' },
      { id: 'primary', ...base, status: 'ACTIVE', role: 'PRIMARY', version: 3 },
      { id: 'draft', ...base, status: 'DRAFT', role: 'PRIMARY' },
    ], base)).toMatchObject({ id: 'primary', version: 3 })
  })

  it.each([
    ['missing', []],
    ['ambiguous', [
      { id: 'a', ...base, status: 'ACTIVE', role: 'PRIMARY' },
      { id: 'b', ...base, status: 'ACTIVE', role: 'PRIMARY' },
    ]],
  ])('fails closed for %s primary selection', (label, connections) => {
    expect(() => selectPhase1PrimaryConnection(connections, base)).toThrow(new RegExp(label === 'missing' ? 'NOT_FOUND' : 'AMBIGUOUS'))
  })

  it('promotes with a version CAS after demoting the current primary in one transaction', async () => {
    const tx = {
      integrationConnection: {
        findUnique: vi.fn(async () => ({ id: 'next', ...base, purpose: 'PHASE1_LINE_LLM', version: 4 })),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
    }
    const db = { $transaction: vi.fn(async (work) => work(tx)) }
    await expect(promotePhase1PrimaryConnection({
      db, tenantId: base.tenantId, businessId: base.businessId, connectionId: 'next', expectedVersion: 4,
    })).resolves.toEqual({ connectionId: 'next', demotedCount: 1, version: 5 })
    expect(tx.integrationConnection.updateMany.mock.calls[0][0].where.role).toBe('PRIMARY')
    expect(tx.integrationConnection.updateMany.mock.calls[1][0].where.version).toBe(4)
  })

  it('queries only the trusted Tenant/Business/purpose scope and maps opaque credential metadata', async () => {
    const queryFn = vi.fn(async () => ({ rows: [{
      id: 'primary', tenant_id: base.tenantId, business_id: base.businessId,
      purpose: base.purpose, status: 'ACTIVE', role: 'PRIMARY', metadata_json: '{"model":"gpt-test"}',
      version: 2, provider_code: 'OPENAI', secret_ref: 'secret://phase1/business-a', credential_status: 'ACTIVE',
      credential_expires_at: null,
    }] }))
    const connection = await resolvePhase1PrimaryConnectionByQuery({
      queryFn, tenantId: base.tenantId, businessId: base.businessId,
    })
    expect(connection).toMatchObject({
      id: 'primary', tenantId: base.tenantId, businessId: base.businessId,
      provider: { code: 'OPENAI' }, credential: { secretRef: 'secret://phase1/business-a' },
    })
    expect(queryFn).toHaveBeenCalledWith(expect.stringContaining('c.tenant_id = $1'), [
      base.tenantId, base.businessId, 'PHASE1_LINE_LLM',
    ])
  })
})

describe('FR-074 local Ollama provider', () => {
  it('does not add Ollama to the public provider list', () => {
    expect(PUBLIC_LINE_PROVIDERS).not.toContain('ollama')
    expect(LOCAL_EVAL_PROVIDERS).toEqual(['ollama'])
  })

  it('allows exact loopback Ollama only for local evaluation and rejects production', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ response: 'คำตอบจาก Ollama' }), { status: 200 }))
    const port = createModelProviderPort({
      runtimeSource: 'LOCAL_DEV',
      provider: 'ollama',
      model: 'llama3.2:latest',
      baseUrl: 'http://127.0.0.1:11434',
      fetchFn,
    })

    await expect(port.generate({ question: 'สวัสดี', evidence: { records: [] } })).resolves.toMatchObject({ text: 'คำตอบจาก Ollama' })
    expect(fetchFn.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/generate')
    expect(fetchFn.mock.calls[0][1].redirect).toBe('error')
    expect(() => createModelProviderPort({
      runtimeSource: 'PRODUCTION_LINE', provider: 'ollama', model: 'llama3.2:latest', baseUrl: 'http://127.0.0.1:11434',
    })).toThrow(/production|public line|not allowed/i)
  })

  it.each(['http://localhost:11434', 'http://127.0.0.2:11434', 'https://127.0.0.1:11434', 'http://127.0.0.1:11434/redirect'])
    ('rejects unsafe Ollama base URL %s', (baseUrl) => {
      expect(() => createModelProviderPort({ runtimeSource: 'LOCAL_DEV', provider: 'ollama', model: 'x', baseUrl }))
        .toThrow(/loopback|ollama|url/i)
    })

  it('fails closed when Ollama is unavailable instead of using provider fallback', async () => {
    await expect(answerBusinessQuestion(
      { tenantId: 'tenant-a', businessId: 'business-a', question: 'สินค้า A คืออะไร' },
      {
        knowledge: { query: vi.fn(async () => ({ records: [{ source_ref: 'source-a' }], asOf: '2026-08-18' })) },
        model: { provider: 'ollama', model: 'llama3.2', generate: vi.fn(async () => { throw new Error('network') }) },
      },
    )).rejects.toThrow('OLLAMA_PROVIDER_NOT_READY')
  })
})

describe('FR-074 real runtime selection path', () => {
  it('resolves the selected connection and secret before composing the model port', async () => {
    const queryFn = vi.fn()
    const connectionResolver = vi.fn(async () => ({
      tenantId: 'tenant-a',
      businessId: 'business-a',
      purpose: 'PHASE1_LINE_LLM',
      status: 'ACTIVE',
      role: 'PRIMARY',
      provider: { code: 'OPENAI' },
      metadataJson: JSON.stringify({ model: 'gpt-test' }),
      credential: { secretRef: 'secret://phase1/business-a' },
    }))
    const secretManager = {
      resolve: vi.fn(async () => ({ material: 'resolved-secret', version: 'v9', expiresAt: new Date(Date.now() + 60_000) })),
    }
    const ports = createPhase1BusinessAgentPortsFromEnv({
      ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true',
      ZURI_PHASE1_RUNTIME_SOURCE: 'TEST',
      ZURI_LINE_DB_URL: 'postgresql://zuri_line_smartgift_login:password@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres',
      ZURI_LINE_BINDING_HASH_PEPPER: 'p'.repeat(32),
      ZURI_MODEL_PROVIDER: 'groq',
      ZURI_MODEL_NAME: 'legacy-test-only',
      ZURI_MODEL_CREDENTIAL: 'legacy-secret',
    }, { queryFn, connectionResolver, secretManager, fetchFn: vi.fn() })

    const model = await ports.resolveModel({ tenantId: 'tenant-a', businessId: 'business-a' })
    expect(model).toMatchObject({ provider: 'openai', model: 'gpt-test' })
    expect(connectionResolver).toHaveBeenCalledWith({ tenantId: 'tenant-a', businessId: 'business-a' })
    expect(secretManager.resolve).toHaveBeenCalledWith('secret://phase1/business-a', {
      tenantId: 'tenant-a', businessId: 'business-a',
    })
  })

  it('keeps direct Ollama usable in local evaluation only when no registry row exists', async () => {
    const ports = createPhase1BusinessAgentPortsFromEnv({
      ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true',
      ZURI_PHASE1_RUNTIME_SOURCE: 'LOCAL_DEV',
      ZURI_LINE_DB_URL: 'postgresql://zuri_line_smartgift_login:password@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres',
      ZURI_LINE_BINDING_HASH_PEPPER: 'p'.repeat(32),
      ZURI_MODEL_PROVIDER: 'ollama',
      ZURI_MODEL_NAME: 'llama3.2:latest',
      ZURI_OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    }, {
      queryFn: vi.fn(),
      connectionResolver: vi.fn(async () => { throw new Error('PHASE1_CONNECTION_NOT_FOUND') }),
    })
    await expect(ports.resolveModel({ tenantId: 'tenant-a', businessId: 'business-a' }))
      .resolves.toMatchObject({ provider: 'ollama', model: 'llama3.2:latest' })
  })

  it('refuses production legacy model env even when a resolver is supplied', () => {
    expect(() => createPhase1BusinessAgentPortsFromEnv({
      NODE_ENV: 'production',
      ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true',
      ZURI_PHASE1_RUNTIME_SOURCE: 'PRODUCTION_LINE',
      ZURI_LINE_DB_URL: 'postgresql://zuri_line_smartgift_login:password@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres',
      ZURI_LINE_BINDING_HASH_PEPPER: 'p'.repeat(32),
      ZURI_MODEL_CREDENTIAL: 'raw-production-secret',
      secretManager: { runtimeSource: 'PRODUCTION_LINE', resolve: vi.fn() },
    })).toThrow(/legacy|raw|production/i)
  })

  it('resolves the model after binding scope and passes it into the turn', async () => {
    const order = []
    let dependencies
    const selectedModel = { provider: 'openai', model: 'gpt-test', generate: vi.fn() }
    const handler = createLineWebhookPost({
      runtimeFactory: async () => ({
        bindingResolver: {
          resolve: async () => {
            order.push('binding')
            return { id: 'binding-1', tenantId: 'tenant-a', businessId: 'business-a' }
          },
        },
        resolveModel: async (scope) => {
          order.push(`model:${scope.businessId}`)
          return selectedModel
        },
      }),
      turnHandler: async (_input, ports) => {
        dependencies = ports
        return { identity: { principalType: 'CUSTOMER' }, response: { skipReply: false } }
      },
    })
    const response = await handler(new Request('http://local/api/agent/line-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${'x'.repeat(32)}` },
      body: JSON.stringify({
        bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
        destination: 'U-test',
        events: [{ type: 'message', source: { userId: 'U-test' }, message: { type: 'text', id: 'M-test', text: 'hello' } }],
      }),
    }))
    expect(response.status).toBe(200)
    expect(order).toEqual(['binding', 'model:business-a'])
    expect(dependencies.model).toBe(selectedModel)
  })
})

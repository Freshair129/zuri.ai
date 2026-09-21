// @req FR-266, FR-265 — `resolveModel`'s order: the Business's own browser-provisioned
//   key first, the Phase-1 operator connection only when that Business has none,
//   and a fail-closed refusal when a key exists but is broken.
// @spec SDD-106; ADR-100 D5
// @tested tests/unit/business-model-credential-resolution.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPhase1BusinessAgentPortsFromEnv } from '@/modules/agent/phase1-runtime'

const scope = { tenantId: 'tenant-1', businessId: 'business-1' }

// A connection the Phase-1 resolver would find: the operator-provisioned path that
// production resolves its key through today.
const phase1Connection = {
  provider: { code: 'anthropic' },
  metadataJson: JSON.stringify({ model: 'phase1-model' }),
  credential: { secretRef: 'supabase-vault:11111111-1111-1111-1111-111111111111' },
}

function ports({ modelCredentialResolver, connectionResolver = async () => phase1Connection } = {}) {
  return createPhase1BusinessAgentPortsFromEnv({
    ZURI_LINE_DB_URL: 'postgresql://zuri_line_smartgift_login:password@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres',
    ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true',
    ZURI_LINE_BINDING_HASH_PEPPER: 'p'.repeat(32),
    ZURI_PHASE1_RUNTIME_SOURCE: 'TEST',
    ZURI_MODEL_PROVIDER: 'anthropic',
    ZURI_MODEL_NAME: 'legacy-model',
    ZURI_MODEL_CREDENTIAL: 'legacy-credential',
  }, {
    queryFn: async () => ({ rows: [] }),
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    connectionResolver,
    modelCredentialResolver,
    secretManager: { runtimeSource: 'TEST', resolve: async () => ({ material: 'phase1-secret' }) },
    bindingRequired: false,
  })
}

describe('model credential resolution order (SDD-106)', () => {
  let vaulted

  beforeEach(() => {
    vaulted = vi.fn(async () => {
      const answer = { provider: 'openai', model: 'business-model' }
      Object.defineProperty(answer, 'apiKey', { value: 'sk-business-key', enumerable: false })
      return answer
    })
  })

  it('uses the Business key when one exists, and never consults the Phase-1 connection', async () => {
    const connectionResolver = vi.fn(async () => phase1Connection)
    const model = await ports({ modelCredentialResolver: vaulted, connectionResolver }).resolveModel(scope)
    expect(vaulted).toHaveBeenCalledWith(scope)
    expect(connectionResolver).not.toHaveBeenCalled()
    expect(model.model).toBe('business-model')
    expect(model.provider).toBe('openai')
  })

  it('falls back to the Phase-1 connection only on absence', async () => {
    const absent = vi.fn(async () => null)
    const connectionResolver = vi.fn(async () => phase1Connection)
    const model = await ports({ modelCredentialResolver: absent, connectionResolver }).resolveModel(scope)
    expect(connectionResolver).toHaveBeenCalledTimes(1)
    expect(model.model).toBe('phase1-model')
  })

  it('fails closed when the Business has a key that cannot be resolved', async () => {
    // The whole point of D5: a Business that has entered a key and whose key is
    // broken must not be quietly answered through the operator's key. A silent
    // downgrade is invisible to the owner and to the trace.
    const broken = vi.fn(async () => { throw new Error('MODEL_CREDENTIAL_NOT_RESOLVABLE') })
    const connectionResolver = vi.fn(async () => phase1Connection)
    await expect(ports({ modelCredentialResolver: broken, connectionResolver }).resolveModel(scope))
      .rejects.toThrow('MODEL_CREDENTIAL_NOT_RESOLVABLE')
    expect(connectionResolver).not.toHaveBeenCalled()
  })

  it('leaves the legacy path exactly as it was when the vault read is disabled', async () => {
    const connectionResolver = vi.fn(async () => phase1Connection)
    const model = await ports({ modelCredentialResolver: null, connectionResolver }).resolveModel(scope)
    expect(connectionResolver).toHaveBeenCalledTimes(1)
    expect(model.model).toBe('phase1-model')
  })
})

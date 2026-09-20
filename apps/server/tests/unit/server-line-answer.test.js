import { describe, expect, it, vi } from 'vitest'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createDeterministicBusinessModel } from '@/modules/agent/grounded-business-answer'
import { createPhase1BusinessAgentPortsFromEnv } from '@/modules/agent/phase1-runtime'

// @req FR-149, FR-150 — server answering from scoped evidence, and the model the
//   Business's own credential resolves to.
// @req FR-265 — there is one answer path now (ADR-100 D3). These cases used to
//   reach the evidence reader through the `LOCAL_ONLY` branch and its canned
//   answerer; the branch is retired, so they reach the same reader through the
//   composed runtime — which is what a real turn does — and use the deterministic
//   model as the test double it always effectively was.
// @spec ADR-061, ADR-100 D3, SEC-001, SEC-016

vi.mock('@/lib/db', () => ({ default: {} }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const businessId = '22222222-2222-4222-8222-222222222222'
const job = () => ({ tenantId, businessId, modelAccess: 'LOCAL_ONLY', inbound: { body: 'AB-1 ราคาเท่าไร' }, account: { tenantId, businessId } })
const evidence = () => ({ records: [{ name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }] })

/** A composed runtime whose knowledge reader is `query` and whose model answers deterministically. */
const runtimeWith = (query, model = createDeterministicBusinessModel()) =>
  vi.fn().mockResolvedValue({ businessKnowledge: { query }, resolveModel: vi.fn().mockResolvedValue(model) })

describe('server LINE answers from admitted CRM jobs', () => {
  it('reads scoped public evidence and answers from it', async () => {
    const query = vi.fn().mockResolvedValue(evidence())
    const fetchFn = vi.fn()
    const text = await createServerLineAnswer({ runtimeFactory: runtimeWith(query), fetchFn })(job())
    expect(text).toContain('AB-1')
    expect(text).toContain('50')
    expect(query).toHaveBeenCalledWith({ tenantId, businessId, queryId: 'product_detail', params: { productCode: 'AB-1' }, limit: 1 })
    // The adapter never reaches a provider itself; the resolved model does.
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('returns a clarification when there is no evidence', async () => {
    const text = await createServerLineAnswer({ runtimeFactory: runtimeWith(async () => ({ records: [] })) })(job())
    expect(text).toContain('ยังไม่พบข้อมูลสินค้า')
  })

  it('composes the runtime for a job with no model policy at all', async () => {
    // @req FR-265 — a missing `modelAccess` used to mean "deterministic, never
    // compose". It now means nothing, and the one path runs either way.
    const input = job()
    delete input.modelAccess
    const runtimeFactory = runtimeWith(async () => evidence())
    await createServerLineAnswer({ runtimeFactory })(input)
    expect(runtimeFactory).toHaveBeenCalled()
  })

  it('does not read or generate across an account scope mismatch', async () => {
    const query = vi.fn()
    const runtimeFactory = runtimeWith(query)
    const input = job()
    input.account.businessId = 'other-business'
    await expect(createServerLineAnswer({ runtimeFactory })(input)).rejects.toThrow('LINE_ANSWER_SCOPE_MISMATCH')
    expect(query).not.toHaveBeenCalled()
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  // @req FR-265 — this proved an unrecognised `modelAccess` was refused rather than
  // routed externally. The policy is retired (ADR-100 D3): there is one path, and a
  // job's stale `modelAccess` value no longer decides anything. What replaces the
  // guarantee is that the value is *ignored*, not obeyed — a job still carrying
  // LOCAL_ONLY must not silently get the canned answerer back.
  it('ignores a retired model policy on the job instead of honouring it', async () => {
    const query = vi.fn().mockResolvedValue(evidence())
    const generate = vi.fn().mockResolvedValue({ text: 'AB-1 ราคา 50 บาท', provider: 'openai' })
    const runtimeFactory = vi.fn().mockResolvedValue({
      businessKnowledge: { query }, resolveModel: vi.fn().mockResolvedValue({ generate }),
    })
    const answer = await createServerLineAnswer({ runtimeFactory })({ ...job(), modelAccess: 'LOCAL_ONLY' })
    expect(runtimeFactory).toHaveBeenCalled()
    expect(generate).toHaveBeenCalled()
    expect(answer).toContain('AB-1')
  })

  it('external permission uses scoped model resolver and needs no Edge binding', async () => {
    const query = vi.fn().mockResolvedValue(evidence())
    const generate = vi.fn().mockResolvedValue({ text: 'AB-1 ราคา 50 บาท', provider: 'openai' })
    const resolveModel = vi.fn().mockResolvedValue({ provider: 'openai', model: 'fixture', generate })
    const runtimeFactory = vi.fn().mockResolvedValue({ businessKnowledge: { query }, resolveModel })
    const answer = createServerLineAnswer({ env: { NODE_ENV: 'production' }, runtimeFactory })
    expect(await answer({ ...job(), modelAccess: 'EXTERNAL_MODEL_ALLOWED' })).toBe('AB-1 ราคา 50 บาท')
    expect(runtimeFactory).toHaveBeenCalledWith({ NODE_ENV: 'production' }, expect.objectContaining({ bindingRequired: false }))
    expect(resolveModel).toHaveBeenCalledWith({ tenantId, businessId })
    expect(generate).toHaveBeenCalledOnce()
  })

  it('redacts query and model resolver errors before durable job storage', async () => {
    const answer = createServerLineAnswer({ runtimeFactory: runtimeWith(async () => { throw new Error('secret-token SELECT private data') }) })
    await expect(answer(job())).rejects.toThrow(/^LINE_ANSWER_UNAVAILABLE$/)
  })

  it('bounds text without splitting an emoji surrogate', async () => {
    const records = evidence()
    records.records[0].name = `${'ก'.repeat(4999)}😀`
    const text = await createServerLineAnswer({ runtimeFactory: runtimeWith(async () => records) })(job())
    expect(text.length).toBeLessThanOrEqual(5000)
    expect(text).toBe('ก'.repeat(4999))
  })
})

describe('direct server runtime composition', () => {
  const env = {
    NODE_ENV: 'production', ZURI_PHASE1_RUNTIME_SOURCE: 'PRODUCTION_LINE',
    ZURI_LINE_DB_URL: 'postgresql://zuri_line_smartgift_login:password@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres',
  }
  const dependencies = () => ({
    queryFn: vi.fn(), secretQueryFn: vi.fn(),
    secretManager: { runtimeSource: 'PRODUCTION_LINE', resolve: vi.fn() },
  })

  it('explicit bindingRequired:false works without legacy enable flag or pepper', () => {
    const ports = createPhase1BusinessAgentPortsFromEnv(env, { ...dependencies(), bindingRequired: false })
    expect(ports.bindingResolver).toBeNull()
    expect(ports.resolveModel).toBeTypeOf('function')
  })

  it('preserves default legacy opt-in and binding requirement', () => {
    expect(createPhase1BusinessAgentPortsFromEnv(env, dependencies())).toBeNull()
    expect(() => createPhase1BusinessAgentPortsFromEnv({ ...env, ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true' }, dependencies())).toThrow('ZURI_LINE_BINDING_HASH_PEPPER')
  })

  it('does not relax production raw provider credential prohibition', () => {
    expect(() => createPhase1BusinessAgentPortsFromEnv({ ...env, ZURI_MODEL_CREDENTIAL: 'forbidden' }, { ...dependencies(), bindingRequired: false })).toThrow('PHASE1_PRODUCTION_LEGACY_MODEL_CONFIG_FORBIDDEN')
  })
})

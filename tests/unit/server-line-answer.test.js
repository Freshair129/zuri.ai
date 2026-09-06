import { describe, expect, it, vi } from 'vitest'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createPhase1BusinessAgentPortsFromEnv } from '@/modules/agent/phase1-runtime'

// @req FR-149, FR-150 — deterministic local answering and explicit external model permission.
// @spec ADR-061, SEC-001, SEC-016

vi.mock('@/lib/db', () => ({ default: {} }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const businessId = '22222222-2222-4222-8222-222222222222'
const job = () => ({ tenantId, businessId, modelAccess: 'LOCAL_ONLY', inbound: { body: 'AB-1 ราคาเท่าไร' }, account: { tenantId, businessId } })
const evidence = () => ({ records: [{ name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }] })

describe('server LINE answers from admitted CRM jobs', () => {
  it('LOCAL_ONLY reads scoped public evidence without resolving or calling an external model', async () => {
    const knowledge = { query: vi.fn().mockResolvedValue(evidence()) }
    const runtimeFactory = vi.fn(() => { throw new Error('must never compose') })
    const fetchFn = vi.fn()
    const answer = createServerLineAnswer({ knowledge, runtimeFactory, fetchFn })
    const text = await answer(job())
    expect(text).toContain('AB-1')
    expect(text).toContain('50')
    expect(knowledge.query).toHaveBeenCalledWith({ tenantId, businessId, queryId: 'product_detail', params: { productCode: 'AB-1' }, limit: 1 })
    expect(runtimeFactory).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('LOCAL_ONLY returns a clarification when there is no evidence', async () => {
    const text = await createServerLineAnswer({ knowledge: { query: async () => ({ records: [] }) } })(job())
    expect(text).toContain('ยังไม่พบข้อมูลสินค้า')
  })

  it('defaults missing model permission to deterministic LOCAL_ONLY', async () => {
    const input = job()
    delete input.modelAccess
    const runtimeFactory = vi.fn()
    await createServerLineAnswer({ knowledge: { query: async () => evidence() }, runtimeFactory })(input)
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('does not read or generate across an account scope mismatch', async () => {
    const knowledge = { query: vi.fn() }
    const input = job()
    input.account.businessId = 'other-business'
    await expect(createServerLineAnswer({ knowledge })(input)).rejects.toThrow('LINE_ANSWER_SCOPE_MISMATCH')
    expect(knowledge.query).not.toHaveBeenCalled()
  })

  it('rejects unrecognized model policy instead of routing externally', async () => {
    const runtimeFactory = vi.fn()
    await expect(createServerLineAnswer({ runtimeFactory })({ ...job(), modelAccess: 'AUTO' })).rejects.toThrow('LINE_MODEL_ACCESS_INVALID')
    expect(runtimeFactory).not.toHaveBeenCalled()
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
    const answer = createServerLineAnswer({ knowledge: { query: async () => { throw new Error('secret-token SELECT private data') } } })
    await expect(answer(job())).rejects.toThrow(/^LINE_ANSWER_UNAVAILABLE$/)
  })

  it('bounds text without splitting an emoji surrogate', async () => {
    const records = evidence()
    records.records[0].name = `${'ก'.repeat(4999)}😀`
    const text = await createServerLineAnswer({ knowledge: { query: async () => records } })(job())
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

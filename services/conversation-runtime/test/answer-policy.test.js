import test from 'node:test'
import assert from 'node:assert/strict'
import { createConversationRuntime } from '../src/turn-runtime.js'
import { NO_EVIDENCE_REPLY, boundLineText, checkModelAnswer, deterministicFallback } from '../src/line-answer-policy.js'

// @req FR-049, FR-149 — the Runtime applies the Server answer path's post-model rules.
// @spec ADR-106 D1, SDD-110, SDD-025, SEC-009
// @tested services/conversation-runtime/test/answer-policy.test.js
const claim = { jobId: 'job-1', executionId: 'exec-1', claimantId: 'cr-1', tenantId: 'tenant-1', businessId: 'business-1',
  accountId: 'account-1', version: 2, leaseExpiresAt: '2026-09-24T00:05:00.000Z', deadlineAt: '2026-09-24T00:04:00.000Z' }
const product = { product_code: 'USB-001', name: 'แฟลชไดรฟ์ไม้', unit: 'ชิ้น', sell_price: 120, currency: 'THB', moq: 100,
  specification: {}, as_of: '2026-08-12T00:00:00.000Z' }
const productFallback = 'แฟลชไดรฟ์ไม้ (USB-001) — ราคา 120 THB/ชิ้น — ขั้นต่ำ 100 ชิ้น — ข้อมูล ณ 2026-08-12'

function harness({ records = [product], generate, prior = { status: 'NOT_FOUND' }, signal } = {}) {
  const seen = { completed: null, failed: null, modelCalls: 0, traces: [] }
  const ports = {
    job: { claim: async () => ({ ...claim }), renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async (_claim, result) => { seen.completed = result.text; return { status: 'READY', operationId: result.operationId } },
      status: async (_claim, operationId) => ({ status: 'CLAIMED', operationId }),
      fail: async (_claim, result) => { seen.failed = result } },
    authority: { resolve: async () => ({ authorized: true, version: 1, scope: { tenantId: claim.tenantId,
      businessId: claim.businessId, accountId: claim.accountId, identityId: 'identity-1', identityVersion: 1 } }) },
    context: { prepare: async () => ({ question: 'USB-001 ราคาเท่าไร', evidence: { records }, slices: [], authorized: true,
      audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 0, workCommand: null }) },
    workTool: { execute: async () => assert.fail('no Work command'), status: async () => ({ status: 'NOT_FOUND' }) },
    model: { credential: async () => ({ provider: 'openrouter', model: 'm', apiKey: 'synthetic' }),
      generate: async (...args) => { seen.modelCalls += 1; return generate(...args) } },
    delivery: { send: async () => ({ status: 'SENT' }), status: async () => ({ status: 'READY' }) },
    trace: { append: async (_claim, event) => { seen.traces.push(event) }, status: async () => prior },
  }
  const run = () => createConversationRuntime({ ports, now: () => new Date('2026-09-24T00:00:00.000Z') }).runOne({ signal })
  return { seen, run }
}
const modelCompleted = seen => seen.traces.find(event => event.kind === 'MODEL_COMPLETED')?.payload
const providerError = code => Object.assign(new Error(code), { code })

test('no evidence replies with the Server no-evidence text and never calls the model', async () => {
  const { seen, run } = harness({ records: [], generate: () => assert.fail('model must not run') })
  assert.equal((await run()).status, 'SENT')
  assert.equal(seen.completed, NO_EVIDENCE_REPLY)
  assert.equal(seen.modelCalls, 0)
})

test('a supported model answer is the reply as written', async () => {
  const { seen, run } = harness({ generate: async () => 'แฟลชไดรฟ์ไม้ ราคา 120 บาท ขั้นต่ำ 100 ชิ้นค่ะ' })
  await run()
  assert.equal(seen.completed, 'แฟลชไดรฟ์ไม้ ราคา 120 บาท ขั้นต่ำ 100 ชิ้นค่ะ')
  assert.equal(modelCompleted(seen).answerStatus, 'ok')
})

test('an unsupported number, code or delivery claim is replaced by the evidence fallback', async () => {
  for (const candidate of ['ราคา 99 บาทค่ะ', 'รุ่น USB-777 ดีกว่าค่ะ', 'มีสินค้าพร้อมส่งค่ะ']) {
    const { seen, run } = harness({ generate: async () => candidate })
    await run()
    assert.equal(seen.completed, productFallback, candidate)
    assert.deepEqual(modelCompleted(seen), { operationId: 'job-1:runtime-model', text: productFallback, answerStatus: 'rejected-output' })
  }
})

test('a provider failure answers from evidence and records the provider code', async () => {
  for (const code of ['MODEL_PROVIDER_HTTP_503', 'MODEL_PROVIDER_TIMEOUT', 'MODEL_PROVIDER_EMPTY_RESPONSE', 'MODEL_PROVIDER_NETWORK_ERROR']) {
    const { seen, run } = harness({ generate: async () => { throw providerError(code) } })
    assert.equal((await run()).status, 'SENT', code)
    assert.equal(seen.completed, productFallback)
    assert.deepEqual(modelCompleted(seen), { operationId: 'job-1:runtime-model', text: productFallback, answerStatus: 'fallback', code })
  }
})

test('a GKS corpus chunk falls back to its own trimmed text', async () => {
  const chunk = { kind: 'CORPUS_CHUNK', citationId: 'gks:1', text: '  รับสกรีนโลโก้ ขั้นต่ำ 100 ชิ้น  ' }
  const { seen, run } = harness({ records: [chunk], generate: async () => { throw providerError('MODEL_PROVIDER_HTTP_500') } })
  await run()
  assert.equal(seen.completed, 'รับสกรีนโลโก้ ขั้นต่ำ 100 ชิ้น')
})

test('configuration errors, UNKNOWN outcomes and a process abort still fail without a reply', async () => {
  const cases = [
    { error: providerError('MODEL_CONFIG_INVALID'), status: 'FAILED' },
    { error: providerError('MODEL_BASE_URL_NOT_ALLOWED'), status: 'FAILED' },
    { error: Object.assign(providerError('MODEL_PROVIDER_NETWORK_ERROR'), { outcome: 'UNKNOWN' }), status: 'UNKNOWN' },
    { error: providerError('MSP_INJECTION_RECEIPT_UNKNOWN') },
  ]
  for (const scenario of cases) {
    const { seen, run } = harness({ generate: async () => { throw scenario.error } })
    const result = await run()
    if (scenario.status) assert.equal(result.status, scenario.status, scenario.error.code)
    assert.equal(seen.completed, null)
    assert.equal(modelCompleted(seen), undefined)
  }
  const controller = new AbortController()
  const { seen, run } = harness({ signal: controller.signal,
    generate: async () => { controller.abort(); throw providerError('MODEL_PROVIDER_TIMEOUT') } })
  assert.equal((await run()).status, 'UNKNOWN')
  assert.equal(seen.completed, null)
})

test('an empty model answer still fails the turn, as the Server path does', async () => {
  const { seen, run } = harness({ generate: async () => '   ' })
  assert.equal((await run()).status, 'FAILED')
  assert.equal(seen.completed, null)
})

test('a replay reuses the recorded final reply without calling the provider or re-checking it', async () => {
  const { seen, run } = harness({ prior: { status: 'COMPLETED', text: productFallback },
    generate: () => assert.fail('provider must not run again') })
  await run()
  assert.equal(seen.completed, productFallback)
  assert.equal(seen.modelCalls, 0)
})

test('the policy module bounds to LINE limits and reports the check result', () => {
  assert.equal(boundLineText(`${'ก'.repeat(4999)}😀`), 'ก'.repeat(4999))
  assert.equal(boundLineText('x'.repeat(6000)).length, 5000)
  assert.equal(deterministicFallback({ records: [{ kind: 'CORPUS_CHUNK', text: '  ' }] }), NO_EVIDENCE_REPLY)
  const checked = checkModelAnswer('q', { records: [product] }, 'ราคา 5 บาท')
  assert.equal(checked.status, 'rejected-output')
  assert.deepEqual(checked.verification.unsupportedNumbers, ['5'])
})

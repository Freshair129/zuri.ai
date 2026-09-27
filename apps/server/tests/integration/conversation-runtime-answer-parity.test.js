import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createModelProviderPort } from '@/modules/agent/model-provider'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'
import { createModelPort } from '../../../../services/conversation-runtime/src/model-port.js'

// @req FR-049, FR-149, FR-235 — the Conversation Runtime answer path gives the same
// user-visible reply as the Server answer path for the same model output and the
// same evidence: the no-evidence reply, the candidate check, the evidence fallback
// after a rejected output or a provider failure, and the LINE text bound.
// @spec ADR-106 D1/D2, SDD-110, SDD-025, SEC-009
// @tested tests/integration/conversation-runtime-answer-parity.test.js
//
// Both paths call their real provider adapter over one fake provider HTTP reply,
// so "the same model output" is the same bytes on the wire, not the same mock
// return value. Each case compares the final reply text byte for byte across three
// evidence sets: none, product rows (Business knowledge) and GKS corpus chunks.
// `null` means the path settles no reply (the job fails).

const policyFiles = {
  server: new URL('../../src/modules/agent/line-answer-policy.js', import.meta.url),
  runtime: new URL('../../../../services/conversation-runtime/src/line-answer-policy.js', import.meta.url),
}

const tenantId = 'tenant-parity'
const businessId = 'business-parity'
const question = 'USB-001 ราคาเท่าไร'
const apiKey = 'synthetic-parity-provider-key'

const evidenceSets = {
  none: { records: [] },
  some: { records: [{
    knowledge_id: 'sg:sku:USB-001', business_id: businessId, knowledge_type: 'PRODUCT', product_code: 'USB-001',
    name: 'แฟลชไดรฟ์ไม้', category: 'USB', unit: 'ชิ้น', sell_price: 1250.5, currency: 'THB', moq: 100,
    specification: { capacity: '32GB' }, source_ref: 'catalog:usb:2026-08', as_of: '2026-08-12T00:00:00.000Z',
  }] },
  gks: { records: [{ kind: 'CORPUS_CHUNK', citationId: 'gks:doc-7#2', documentId: 'doc-7',
    text: '  รับสกรีนโลโก้บนแฟลชไดรฟ์ไม้ ขั้นต่ำ 100 ชิ้น  ' }] },
}

const reply = content => () => new Response(JSON.stringify({ choices: [{ message: { content } }] }),
  { status: 200, headers: { 'content-type': 'application/json' } })

const modelOutputs = {
  normal: reply('มีแฟลชไดรฟ์ไม้ให้เลือกค่ะ สนใจสกรีนโลโก้ไหมคะ'),
  empty: reply('   '),
  // Past LINE's limit, with an emoji straddling the adapter's 5000-unit cut.
  'over-long': reply(`${'ก'.repeat(4999)}😀${'ข'.repeat(200)}`),
  // A price, a code and a delivery promise none of the evidence sets carry.
  ungrounded: reply('ราคา 999 บาท รหัส USB-999 ส่งฟรีภายใน 3 วันค่ะ'),
  'model error': () => new Response('upstream private detail', { status: 503 }),
}

const clone = value => JSON.parse(JSON.stringify(value))

async function legacyReply(evidence, fetchFn) {
  const answer = createServerLineAnswer({
    runtimeFactory: async () => ({
      businessKnowledge: { query: async () => clone(evidence) },
      resolveModel: async () => createModelProviderPort({ provider: 'openrouter', model: 'parity-model',
        credential: apiKey, timeoutMs: 1000, fetchFn }),
    }),
  })
  const job = { tenantId, businessId, memorySyncOptIn: false, inbound: { body: question },
    account: { tenantId, businessId, knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } }
  try {
    // The Server worker settles the answer through zCompletion, whose text schema
    // trims (line-conversation-jobs.js); that trimmed text is what LINE receives.
    return (await answer(job)).trim()
  } catch {
    return null
  }
}

async function runtimeReply(evidence, fetchFn) {
  const claim = { jobId: 'job-parity', executionId: 'exec-parity', claimantId: 'cr-parity', tenantId, businessId,
    accountId: 'account-parity', version: 1, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    deadlineAt: new Date(Date.now() + 30_000).toISOString() }
  let completedText = null
  let modelStatus = { status: 'NOT_FOUND' }
  const ports = {
    job: { claim: async () => ({ ...claim }), renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async (_claim, { text, operationId }) => { completedText = text; return { status: 'READY', operationId } },
      status: async (_claim, operationId) => ({ status: 'CLAIMED', operationId }), fail: async () => ({ status: 'FAILED' }) },
    authority: { resolve: async () => ({ authorized: true, version: 1, scope: { tenantId, businessId,
      accountId: claim.accountId, identityId: 'identity-parity', identityVersion: 1 } }) },
    // Exactly the prepared turn Core's `prepare` returns for a Business-knowledge
    // question: the evidence crosses the wire as JSON.
    context: { prepare: async () => ({ question, evidence: clone(evidence), slices: [], authorized: true,
      audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 0, workCommand: null }) },
    workTool: { execute: async () => { throw new Error('WORK_TOOL_NOT_EXPECTED') }, status: async () => ({ status: 'NOT_FOUND' }) },
    model: { credential: async () => ({ provider: 'openrouter', model: 'parity-model', apiKey }),
      generate: createModelPort({ timeoutMs: 1000, fetchFn }).generate },
    delivery: { send: async () => ({ status: 'SENT' }), status: async () => ({ status: 'READY' }) },
    trace: { append: async (_claim, event) => {
      if (event.kind === 'MODEL_STARTED') modelStatus = { status: 'STARTED', executionId: claim.executionId }
    }, status: async () => modelStatus },
  }
  await createConversationRuntime({ ports }).runOne()
  return completedText
}

async function replies(runReply, output) {
  const cells = {}
  for (const [name, evidence] of Object.entries(evidenceSets)) cells[name] = await runReply(evidence, output)
  return cells
}

describe('Conversation Runtime answer parity with the Server answer path', () => {
  it('runs one answer-policy source: the Runtime mirror is byte-identical to the Server module', () => {
    const read = url => readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
    expect(read(policyFiles.runtime), 'copy apps/server/src/modules/agent/line-answer-policy.js over the Runtime mirror')
      .toBe(read(policyFiles.server))
  })

  it.each(Object.keys(modelOutputs))('gives the same final reply for a %s model output over every evidence set', async (name) => {
    const output = modelOutputs[name]
    const legacy = await replies(legacyReply, output)
    const runtime = await replies(runtimeReply, output)
    expect(runtime).toStrictEqual(legacy)
  })

  it('pins the Server replies the parity cases compare against', async () => {
    const noEvidence = 'ยังไม่พบข้อมูลสินค้าที่ตรงกับคำถามนี้ค่ะ ลองระบุรหัสสินค้า หรือชื่อสินค้าเพิ่มอีกหนึ่งอย่างได้ไหมคะ'
    const productFallback = 'แฟลชไดรฟ์ไม้ (USB-001) — ราคา 1,250.5 THB/ชิ้น — ขั้นต่ำ 100 ชิ้น — capacity: 32GB — ข้อมูล ณ 2026-08-12'
    const chunkFallback = 'รับสกรีนโลโก้บนแฟลชไดรฟ์ไม้ ขั้นต่ำ 100 ชิ้น'
    const normal = 'มีแฟลชไดรฟ์ไม้ให้เลือกค่ะ สนใจสกรีนโลโก้ไหมคะ'
    const overLong = 'ก'.repeat(4999)
    expect(await replies(legacyReply, modelOutputs.normal)).toStrictEqual({ none: noEvidence, some: normal, gks: normal })
    expect(await replies(legacyReply, modelOutputs.empty)).toStrictEqual({ none: noEvidence, some: productFallback, gks: chunkFallback })
    expect(await replies(legacyReply, modelOutputs['over-long'])).toStrictEqual({ none: noEvidence, some: overLong, gks: overLong })
    expect(await replies(legacyReply, modelOutputs.ungrounded)).toStrictEqual({ none: noEvidence, some: productFallback, gks: chunkFallback })
    expect(await replies(legacyReply, modelOutputs['model error'])).toStrictEqual({ none: noEvidence, some: productFallback, gks: chunkFallback })
  })
})

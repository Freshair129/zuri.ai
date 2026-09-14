import { describe, expect, it } from 'vitest'
import { composeContext, DEFAULT_CONTEXT_BUDGET_CHARS } from '@/modules/agent/context-composer'

// @req FR-234 — pure unit coverage of the Context Composer's own rules, isolated
// from any port (MSP, GKS, CRM/ERP) or model.
// @spec ADR-091 D7, SDD-100
// @tested tests/unit/context-composer.test.js

const RECORD = { id: 'record-1', subjectKey: 'customer:42', text: 'สินค้าคงเหลือ 10 ชิ้น' }
const EVIDENCE = { id: 'evidence-1', citationId: 'gks:doc-1', text: 'สเปกสินค้า AB-1' }
const MSP_SLICE = { id: 'msp-1', threadId: 'thread-1', text: 'ลูกค้าถามราคาเมื่อวาน' }

describe('context-composer: authorization', () => {
  it('yields an empty packet on denial, never a partial one', () => {
    const composed = composeContext({
      authorized: false,
      denialReason: 'AUTHORIZATION_DENIED',
      records: [RECORD],
      knowledgeEvidence: [EVIDENCE],
      mspSlices: [MSP_SLICE],
    })
    expect(composed.authorized).toBe(false)
    expect(composed.denialReason).toBe('AUTHORIZATION_DENIED')
    expect(composed.slices).toEqual([])
    expect(composed.dropped).toEqual([])
    expect(composed.shouldCallModel).toBe(false)
    expect(composed.receipt.refs).toEqual({ msp: [], citations: [], records: [] })
    expect(composed.receipt.budget).toEqual({ max: DEFAULT_CONTEXT_BUDGET_CHARS, used: 0, trimmed: 0 })
    expect(composed.receipt.dropped).toEqual([])
  })

  it('defaults to authorized so an ADR-091-unaware caller keeps composing', () => {
    const composed = composeContext({ records: [RECORD] })
    expect(composed.authorized).toBe(true)
  })
})

describe('context-composer: precedence', () => {
  it('orders CRM/ERP record over GKS evidence over MSP memory', () => {
    const composed = composeContext({
      scope: { threadId: 'thread-1' },
      audienceKind: 'DIRECT',
      records: [RECORD],
      knowledgeEvidence: [EVIDENCE],
      mspSlices: [MSP_SLICE],
    })
    expect(composed.slices.map((slice) => slice.source)).toEqual(['RECORD', 'KNOWLEDGE', 'MSP'])
    expect(composed.receipt.refs).toEqual({
      records: ['record-1'], citations: ['gks:doc-1'], msp: ['msp-1'],
    })
    expect(composed.dropped).toEqual([])
  })

  it('drops a memory slice that names the same subject as a record, reason SUPERSEDED_BY_RECORD', () => {
    const conflictingMemory = { id: 'msp-conflict', threadId: 'thread-1', subjectKey: 'customer:42', text: 'ลูกค้าบอกว่าคงเหลือ 3 ชิ้น' }
    const composed = composeContext({
      scope: { threadId: 'thread-1' },
      audienceKind: 'DIRECT',
      records: [RECORD],
      mspSlices: [conflictingMemory],
    })
    expect(composed.slices.map((slice) => slice.id)).toEqual(['record-1'])
    expect(composed.dropped).toEqual([{ id: 'msp-conflict', source: 'MSP', reason: 'SUPERSEDED_BY_RECORD' }])
    expect(composed.receipt.dropped).toEqual(composed.dropped)
  })

  it('does not drop a memory slice whose subject was never named by a record', () => {
    const unrelatedMemory = { id: 'msp-unrelated', threadId: 'thread-1', subjectKey: 'customer:99', text: 'คนละเรื่อง' }
    const composed = composeContext({
      scope: { threadId: 'thread-1' },
      records: [RECORD],
      mspSlices: [unrelatedMemory],
    })
    expect(composed.slices.map((slice) => slice.id)).toEqual(['record-1', 'msp-unrelated'])
    expect(composed.dropped).toEqual([])
  })
})

describe('context-composer: budget', () => {
  it('trims by priority (memory first) and reports every trim', () => {
    const bigRecord = { id: 'record-big', text: 'x'.repeat(30) }
    const bigEvidence = { id: 'evidence-big', citationId: 'gks:doc-big', text: 'y'.repeat(30) }
    const bigMemory = { id: 'msp-big', threadId: 'thread-1', text: 'z'.repeat(30) }
    const composed = composeContext({
      scope: { threadId: 'thread-1' },
      records: [bigRecord],
      knowledgeEvidence: [bigEvidence],
      mspSlices: [bigMemory],
      maxBudgetChars: 50, // fits record + evidence (60 chars) is too much; only one of them plus nothing else
    })
    // record (priority 0) is always kept; evidence (30) does not fit after record's
    // 30, so evidence and memory are both trimmed and reported.
    expect(composed.slices.map((slice) => slice.id)).toEqual(['record-big'])
    expect(composed.dropped).toEqual([
      { id: 'evidence-big', source: 'KNOWLEDGE', reason: 'BUDGET_TRIMMED' },
      { id: 'msp-big', source: 'MSP', reason: 'BUDGET_TRIMMED' },
    ])
    expect(composed.receipt.budget).toEqual({ max: 50, used: 30, trimmed: 2 })
  })

  it('keeps every slice and reports zero trims when the budget is not exceeded', () => {
    const composed = composeContext({
      scope: { threadId: 'thread-1' },
      records: [RECORD],
      knowledgeEvidence: [EVIDENCE],
      mspSlices: [MSP_SLICE],
    })
    expect(composed.dropped).toEqual([])
    expect(composed.receipt.budget.trimmed).toBe(0)
  })
})

describe('context-composer: thread and audience scope', () => {
  it('never lets a group thread\'s slice cross into another thread', () => {
    const otherThreadSlice = { id: 'msp-other-thread', threadId: 'thread-2', text: 'ข้อความจาก thread อื่น' }
    const composed = composeContext({
      scope: { threadId: 'thread-1' },
      mspSlices: [otherThreadSlice],
    })
    expect(composed.slices).toEqual([])
    expect(composed.dropped).toEqual([{ id: 'msp-other-thread', source: 'MSP', reason: 'THREAD_SCOPE_MISMATCH' }])
  })

  it('denies a passport/cross-thread slice to a non-DIRECT audience', () => {
    const passportSlice = { id: 'msp-passport', threadId: 'group-thread', scope: 'PASSPORT', text: 'ข้อมูลถาวรของลูกค้า' }
    const composed = composeContext({
      scope: { threadId: 'group-thread' },
      audienceKind: 'GROUP',
      mspSlices: [passportSlice],
    })
    expect(composed.slices).toEqual([])
    expect(composed.dropped).toEqual([{ id: 'msp-passport', source: 'MSP', reason: 'AUDIENCE_SCOPE_DENIED' }])
  })

  it('allows an in-thread slice for a non-DIRECT audience when it is not passport/cross-thread scoped', () => {
    const inThreadSlice = { id: 'msp-in-thread', threadId: 'group-thread', text: 'ข้อความในห้องนี้' }
    const composed = composeContext({
      scope: { threadId: 'group-thread' },
      audienceKind: 'GROUP',
      mspSlices: [inThreadSlice],
    })
    expect(composed.slices.map((slice) => slice.id)).toEqual(['msp-in-thread'])
    expect(composed.dropped).toEqual([])
  })
})

describe('context-composer: receipt shape and content', () => {
  it('records references, a hash and the budget, never content', () => {
    const composed = composeContext({
      scope: { threadId: 'thread-1' },
      records: [RECORD],
      knowledgeEvidence: [EVIDENCE],
      mspSlices: [MSP_SLICE],
    })
    const { receipt } = composed
    expect(Object.keys(receipt).sort()).toEqual(['budget', 'dropped', 'hash', 'receiptId', 'refs'])
    expect(receipt.receiptId).toMatch(/^ctxrcpt_/)
    expect(typeof receipt.hash).toBe('string')
    expect(receipt.hash).toHaveLength(64) // sha256 hex
    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toContain(RECORD.text)
    expect(serialized).not.toContain(EVIDENCE.text)
    expect(serialized).not.toContain(MSP_SLICE.text)
  })

  it('produces the same hash for the same references/budget/dropped and a fresh receiptId each call', () => {
    const build = () => composeContext({ scope: { threadId: 'thread-1' }, records: [RECORD] }).receipt
    const first = build()
    const second = build()
    expect(first.hash).toBe(second.hash)
    expect(first.receiptId).not.toBe(second.receiptId)
  })
})

describe('context-composer: model-call gate', () => {
  it('reports no evidence and no facts, so the caller places no model call', () => {
    const composed = composeContext({ scope: { threadId: 'thread-1' }, mspSlices: [MSP_SLICE] })
    expect(composed.hasEvidence).toBe(false)
    expect(composed.hasFacts).toBe(false)
    expect(composed.shouldCallModel).toBe(false)
  })

  it('calls the model when there is knowledge evidence even without a record', () => {
    const composed = composeContext({ scope: { threadId: 'thread-1' }, knowledgeEvidence: [EVIDENCE] })
    expect(composed.shouldCallModel).toBe(true)
  })

  it('calls the model when there is a CRM/ERP record even without knowledge evidence', () => {
    const composed = composeContext({ scope: { threadId: 'thread-1' }, records: [RECORD] })
    expect(composed.shouldCallModel).toBe(true)
  })
})

describe('context-composer: input validation', () => {
  it('rejects a negative or non-finite budget', () => {
    expect(() => composeContext({ maxBudgetChars: -1 })).toThrow('CONTEXT_BUDGET_INVALID')
    expect(() => composeContext({ maxBudgetChars: NaN })).toThrow('CONTEXT_BUDGET_INVALID')
  })

  it('tolerates string slices with no metadata, assigning a positional id', () => {
    const composed = composeContext({ scope: { threadId: 'thread-1' }, records: ['a plain string fact'] })
    expect(composed.slices).toHaveLength(1)
    expect(composed.slices[0].id).toBe('record:0')
  })
})

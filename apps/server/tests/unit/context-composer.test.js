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

  it('defaults the denial reason from the enums.js vocabulary, not a bare literal', () => {
    const composed = composeContext({ authorized: false, records: [RECORD] })
    expect(composed.denialReason).toBe('CONTEXT_DENIED')
  })

  // FIX 2 — fail closed: a caller MUST resolve and pass an explicit boolean.
  // Defaulting to `true` let a caller that forgot the flag receive a full packet.
  it('throws rather than defaulting to authorized when the flag is omitted', () => {
    expect(() => composeContext({ records: [RECORD] })).toThrow('CONTEXT_COMPOSER_AUTHORIZED_REQUIRED')
    expect(() => composeContext({})).toThrow('CONTEXT_COMPOSER_AUTHORIZED_REQUIRED')
  })

  it('throws for a non-boolean authorized value instead of coercing it', () => {
    for (const value of [undefined, null, 'true', 1, 0, {}]) {
      expect(() => composeContext({ authorized: value, records: [RECORD] })).toThrow('CONTEXT_COMPOSER_AUTHORIZED_REQUIRED')
    }
  })

  it('composes normally when authorized is explicitly true', () => {
    const composed = composeContext({ authorized: true, scope: { threadId: 'thread-1' }, records: [RECORD] })
    expect(composed.authorized).toBe(true)
    expect(composed.slices).toHaveLength(1)
  })
})

describe('context-composer: precedence', () => {
  it('orders CRM/ERP record over GKS evidence over MSP memory', () => {
    const composed = composeContext({
      authorized: true,
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
      authorized: true,
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
      authorized: true,
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
      authorized: true,
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
      authorized: true,
      scope: { threadId: 'thread-1' },
      records: [RECORD],
      knowledgeEvidence: [EVIDENCE],
      mspSlices: [MSP_SLICE],
    })
    expect(composed.dropped).toEqual([])
    expect(composed.receipt.budget.trimmed).toBe(0)
  })

  // Third review, defect — contiguity belongs to a named `sequence`, not to
  // the whole prompt or even a whole source. Within one sequence the cutoff
  // is strict, not first-fit: once one slice in that sequence does not fit,
  // every LATER slice sharing that same sequence name is dropped too, even
  // one that would fit in the budget that remains — this is the property a
  // caller ordering a sequence "most important first" (e.g. MSP exchanges
  // newest-first) relies on to avoid a hole in the middle of it.
  it('does not let a later, smaller slice in the SAME sequence fill the gap a bigger dropped one left', () => {
    const first = { id: 'msp-first', threadId: 'thread-1', sequence: 'conversation', text: 'x'.repeat(30) }
    const second = { id: 'msp-second', threadId: 'thread-1', sequence: 'conversation', text: 'x'.repeat(30) } // 60 > 50: closes the sequence
    const third = { id: 'msp-third', threadId: 'thread-1', sequence: 'conversation', text: 'x'.repeat(5) } // would fit in the 20 chars left, but the sequence is already closed
    const composed = composeContext({
      authorized: true, scope: { threadId: 'thread-1' },
      mspSlices: [first, second, third],
      maxBudgetChars: 50,
    })
    expect(composed.slices.map((slice) => slice.id)).toEqual(['msp-first'])
    expect(composed.dropped).toEqual([
      { id: 'msp-second', source: 'MSP', reason: 'BUDGET_TRIMMED' },
      { id: 'msp-third', source: 'MSP', reason: 'BUDGET_TRIMMED' },
    ])
    expect(composed.receipt.budget.used).toBe(30) // third's 5 chars were never added — it was never attempted
  })

  // Third review, defect — the REGRESSION this fixes: a global cutoff let one
  // oversized, un-sequenced slice (e.g. a protected-memory record or
  // participant) starve every slice after it, including an entire other
  // sequence that would otherwise fit. A slice with no `sequence` must be
  // judged only on its own fit and never close the budget for anything else.
  it('does not let an oversized non-sequenced slice starve a smaller sequenced slice after it', () => {
    const oversizedRecord = { id: 'msp-oversized', threadId: 'thread-1', text: 'x'.repeat(100) } // no sequence
    const exchange = { id: 'msp-exchange', threadId: 'thread-1', sequence: 'exchanges', text: 'newest turn' }
    const composed = composeContext({
      authorized: true, scope: { threadId: 'thread-1' },
      mspSlices: [oversizedRecord, exchange],
      maxBudgetChars: 50,
    })
    expect(composed.slices.map((slice) => slice.id)).toEqual(['msp-exchange'])
    expect(composed.dropped).toEqual([{ id: 'msp-oversized', source: 'MSP', reason: 'BUDGET_TRIMMED' }])
  })

  it('does not let an oversized record slice wipe a smaller knowledge or MSP slice after it', () => {
    const oversizedRecord = { id: 'record-oversized', text: 'x'.repeat(100) }
    const smallEvidence = { id: 'evidence-small', citationId: 'gks:doc-small', text: 'small' }
    const smallMemory = { id: 'msp-small', threadId: 'thread-1', text: 'small' }
    const composed = composeContext({
      authorized: true, scope: { threadId: 'thread-1' },
      records: [oversizedRecord], knowledgeEvidence: [smallEvidence], mspSlices: [smallMemory],
      maxBudgetChars: 50,
    })
    expect(composed.slices.map((slice) => slice.id)).toEqual(['evidence-small', 'msp-small'])
    expect(composed.dropped).toEqual([{ id: 'record-oversized', source: 'RECORD', reason: 'BUDGET_TRIMMED' }])
  })

  // BLOCKER fix — the receipt must describe what a caller would actually inject.
  // The composer itself cannot prove that (it never sees the caller's downstream
  // packet), but it must at minimum hand back the INCLUDED slice's content so a
  // caller has no reason to reach past it: this asserts that contract directly.
  it('returns the included content on each kept slice, for the caller to assemble its model input from', () => {
    const composed = composeContext({
      authorized: true, scope: { threadId: 'thread-1' }, records: [RECORD], mspSlices: [MSP_SLICE],
    })
    const record = composed.slices.find((slice) => slice.id === 'record-1')
    const msp = composed.slices.find((slice) => slice.id === 'msp-1')
    expect(record.content).toBe(RECORD.text)
    expect(msp.content).toBe(MSP_SLICE.text)
  })

  it('never returns the content of a dropped slice', () => {
    const bigMemory = { id: 'msp-big', threadId: 'thread-1', text: 'z'.repeat(999) }
    const composed = composeContext({
      authorized: true, scope: { threadId: 'thread-1' }, mspSlices: [bigMemory], maxBudgetChars: 10,
    })
    expect(composed.slices).toEqual([])
    expect(composed.dropped).toEqual([{ id: 'msp-big', source: 'MSP', reason: 'BUDGET_TRIMMED' }])
  })
})

describe('context-composer: thread and audience scope', () => {
  it('never lets a group thread\'s slice cross into another thread', () => {
    const otherThreadSlice = { id: 'msp-other-thread', threadId: 'thread-2', text: 'ข้อความจาก thread อื่น' }
    const composed = composeContext({
      authorized: true, scope: { threadId: 'thread-1' }, mspSlices: [otherThreadSlice],
    })
    expect(composed.slices).toEqual([])
    expect(composed.dropped).toEqual([{ id: 'msp-other-thread', source: 'MSP', reason: 'THREAD_SCOPE_MISMATCH' }])
  })

  // FIX 3 — fail closed: a slice with NO threadId must not pass just because it
  // never explicitly named a different one. This was the fail-open gap: only an
  // explicit mismatch used to be dropped.
  it('drops an MSP slice with no threadId at all once a thread is in scope (GROUP audience)', () => {
    const noThreadSlice = { id: 'msp-no-thread', text: 'ไม่มี threadId ติดมาด้วย' }
    const composed = composeContext({
      authorized: true, scope: { threadId: 'group-thread' }, audienceKind: 'GROUP', mspSlices: [noThreadSlice],
    })
    expect(composed.slices).toEqual([])
    expect(composed.dropped).toEqual([{ id: 'msp-no-thread', source: 'MSP', reason: 'THREAD_SCOPE_MISMATCH' }])
  })

  it('drops an MSP slice with no threadId at all for a DIRECT audience too — the gap was universal', () => {
    const noThreadSlice = { id: 'msp-no-thread-direct', text: 'ไม่มี threadId' }
    const composed = composeContext({
      authorized: true, scope: { threadId: 'direct-thread' }, audienceKind: 'DIRECT', mspSlices: [noThreadSlice],
    })
    expect(composed.slices).toEqual([])
    expect(composed.dropped).toEqual([{ id: 'msp-no-thread-direct', source: 'MSP', reason: 'THREAD_SCOPE_MISMATCH' }])
  })

  it('does not thread-scope a CRM/ERP record or GKS evidence slice (they are not tied to one thread)', () => {
    const composed = composeContext({
      authorized: true, scope: { threadId: 'thread-1' },
      records: [{ id: 'record-no-thread', text: 'no threadId here either' }],
      knowledgeEvidence: [{ id: 'evidence-no-thread', citationId: 'gks:doc-2', text: 'nor here' }],
    })
    expect(composed.slices.map((slice) => slice.id)).toEqual(['record-no-thread', 'evidence-no-thread'])
    expect(composed.dropped).toEqual([])
  })

  it('denies a passport/cross-thread slice to a non-DIRECT audience', () => {
    const passportSlice = { id: 'msp-passport', threadId: 'group-thread', scope: 'PASSPORT', text: 'ข้อมูลถาวรของลูกค้า' }
    const composed = composeContext({
      authorized: true, scope: { threadId: 'group-thread' }, audienceKind: 'GROUP', mspSlices: [passportSlice],
    })
    expect(composed.slices).toEqual([])
    expect(composed.dropped).toEqual([{ id: 'msp-passport', source: 'MSP', reason: 'AUDIENCE_SCOPE_DENIED' }])
  })

  it('allows an in-thread slice for a non-DIRECT audience when it is not passport/cross-thread scoped', () => {
    const inThreadSlice = { id: 'msp-in-thread', threadId: 'group-thread', text: 'ข้อความในห้องนี้' }
    const composed = composeContext({
      authorized: true, scope: { threadId: 'group-thread' }, audienceKind: 'GROUP', mspSlices: [inThreadSlice],
    })
    expect(composed.slices.map((slice) => slice.id)).toEqual(['msp-in-thread'])
    expect(composed.dropped).toEqual([])
  })
})

describe('context-composer: receipt shape and content', () => {
  it('records references, a hash and the budget, never content', () => {
    const composed = composeContext({
      authorized: true, scope: { threadId: 'thread-1' },
      records: [RECORD], knowledgeEvidence: [EVIDENCE], mspSlices: [MSP_SLICE],
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
    // The returned slices (a separate value from the receipt) are where content
    // legitimately lives, for the caller to build its model input from.
    expect(composed.slices.some((slice) => slice.content === RECORD.text)).toBe(true)
  })

  it('produces the same hash for the same references/budget/dropped and a fresh receiptId each call', () => {
    const build = () => composeContext({ authorized: true, scope: { threadId: 'thread-1' }, records: [RECORD] }).receipt
    const first = build()
    const second = build()
    expect(first.hash).toBe(second.hash)
    expect(first.receiptId).not.toBe(second.receiptId)
  })
})

describe('context-composer: model-call gate', () => {
  it('reports no evidence and no facts, so the caller places no model call', () => {
    const composed = composeContext({ authorized: true, scope: { threadId: 'thread-1' }, mspSlices: [MSP_SLICE] })
    expect(composed.hasEvidence).toBe(false)
    expect(composed.hasFacts).toBe(false)
    expect(composed.shouldCallModel).toBe(false)
  })

  it('calls the model when there is knowledge evidence even without a record', () => {
    const composed = composeContext({ authorized: true, scope: { threadId: 'thread-1' }, knowledgeEvidence: [EVIDENCE] })
    expect(composed.shouldCallModel).toBe(true)
  })

  it('calls the model when there is a CRM/ERP record even without knowledge evidence', () => {
    const composed = composeContext({ authorized: true, scope: { threadId: 'thread-1' }, records: [RECORD] })
    expect(composed.shouldCallModel).toBe(true)
  })
})

describe('context-composer: input validation', () => {
  it('rejects a negative or non-finite budget', () => {
    expect(() => composeContext({ authorized: true, maxBudgetChars: -1 })).toThrow('CONTEXT_BUDGET_INVALID')
    expect(() => composeContext({ authorized: true, maxBudgetChars: NaN })).toThrow('CONTEXT_BUDGET_INVALID')
  })

  it('tolerates string slices with no metadata, assigning a positional id', () => {
    const composed = composeContext({ authorized: true, scope: { threadId: 'thread-1' }, records: ['a plain string fact'] })
    expect(composed.slices).toHaveLength(1)
    expect(composed.slices[0].id).toBe('record:0')
    expect(composed.slices[0].content).toBe('a plain string fact')
  })
})

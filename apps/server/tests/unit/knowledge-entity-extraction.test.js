import { describe, it, expect } from 'vitest'
import { chunkDocument } from '@/modules/knowledge/chunking'
import { extractEntityCandidates } from '@/modules/knowledge/entity-extraction'

// @req FR-113 — entity candidate extraction from chunks and structured records
// @spec docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §13 (Stage 8)

const scope = { tenantId: 'ten_1', businessId: 'biz_1', sensitivity: 'INTERNAL' }
const provenance = { source_ref: 'doc://contract-2026', pipeline_version: 'ki-1' }

const chunksOf = (text) =>
  chunkDocument({
    documentId: 'doc_1',
    scope,
    provenance,
    blocks: [
      { type: 'heading', level: 1, text: 'Parties' },
      { type: 'text', text },
    ],
  }).chunks

describe('organization candidates from text', () => {
  it('recognizes a Thai company name and points the candidate at its chunk', () => {
    const chunks = chunksOf('คู่สัญญาคือ บริษัท เอบีซี จำกัด และผู้ซื้อ')
    const { candidates } = extractEntityCandidates({ chunks })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].type).toBe('Organization')
    expect(candidates[0].mention).toBe('บริษัท เอบีซี จำกัด')
    expect(candidates[0].source_chunk_id).toBe(chunks[0].chunk_id)
  })
})

describe('the six required fields (FR-109 catalog, DPS-KI-ENTITY-EXTRACT)', () => {
  const one = () => extractEntityCandidates({ chunks: chunksOf('คู่สัญญาคือ บริษัท เอบีซี จำกัด') }).candidates[0]

  it('assigns a deterministic candidate_id — the same input yields the same id twice', () => {
    expect(one().candidate_id).toBe(one().candidate_id)
    expect(one().candidate_id).toBeTruthy()
  })

  it('strips the legal wrapper to a lexical normalized_name', () => {
    expect(one().normalized_name).toBe('เอบีซี')
  })

  it('carries a confidence between 0 and 1', () => {
    expect(one().confidence).toBeGreaterThan(0)
    expect(one().confidence).toBeLessThanOrEqual(1)
  })

  it('carries the chunk scope, so a candidate can never be read out of its tenant', () => {
    expect(one().scope).toEqual(scope)
  })
})

describe('English company forms', () => {
  it.each([
    ['ABC Co., Ltd.', 'ABC'],
    ['ABC Limited', 'ABC'],
  ])('recognizes %s and normalizes to %s', (mention, normalized) => {
    const { candidates } = extractEntityCandidates({ chunks: chunksOf(`The seller is ${mention} and the buyer`) })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].mention).toBe(mention)
    expect(candidates[0].normalized_name).toBe(normalized)
  })
})

describe('candidates only — the Stage 9 boundary', () => {
  it('does not merge two mentions of the same name; that judgement is resolution', () => {
    const chunks = chunkDocument({
      documentId: 'doc_2',
      scope,
      provenance,
      blocks: [
        { type: 'heading', level: 1, text: 'Seller' },
        { type: 'text', text: 'บริษัท เอบีซี จำกัด' },
        { type: 'heading', level: 1, text: 'Guarantor' },
        { type: 'text', text: 'บริษัท เอบีซี จำกัด' },
      ],
    }).chunks

    const { candidates } = extractEntityCandidates({ chunks })
    expect(candidates).toHaveLength(2)
    expect(new Set(candidates.map((c) => c.candidate_id)).size).toBe(2)
    expect(new Set(candidates.map((c) => c.source_chunk_id)).size).toBe(2)
  })

  it('normalizes a mention identically alone and in company — no cross-candidate lookup', () => {
    const alone = extractEntityCandidates({ chunks: chunksOf('บริษัท เอบีซี จำกัด') }).candidates[0]
    const crowded = extractEntityCandidates({
      chunks: chunksOf('บริษัท เอบีซี จำกัด และ บริษัท เอบีซีดี จำกัด และ ABC Limited'),
    }).candidates[0]
    expect(crowded.normalized_name).toBe(alone.normalized_name)
    expect(crowded.type).toBe(alone.type)
  })

  it('emits no canonical identity field — resolution belongs to GKS', () => {
    const c = one_()
    for (const forbidden of ['entity_id', 'canonical_id', 'customer_id', 'resolved_to']) {
      expect(c[forbidden]).toBeUndefined()
    }
  })
})

function one_() {
  return extractEntityCandidates({ chunks: chunksOf('บริษัท เอบีซี จำกัด') }).candidates[0]
}

describe('structured records', () => {
  const record = {
    record_id: 'cus_1',
    type: 'Customer',
    mention: 'บริษัท เอบีซี จำกัด',
    scope,
    provenance: { source_ref: 'crm://customer/cus_1' },
  }

  it('produces a candidate carrying the record it came from, not a chunk', () => {
    const [c] = extractEntityCandidates({ records: [record] }).candidates
    expect(c.type).toBe('Customer')
    expect(c.source_record_id).toBe('cus_1')
    expect(c.source_chunk_id).toBeNull()
  })

  it('normalizes a record mention by the same lexical rule as a text mention', () => {
    const [fromRecord] = extractEntityCandidates({ records: [record] }).candidates
    const [fromText] = extractEntityCandidates({ chunks: chunksOf('บริษัท เอบีซี จำกัด') }).candidates
    expect(fromRecord.normalized_name).toBe(fromText.normalized_name)
  })

  it('is certain of a declared field — a record mention is read, not guessed', () => {
    const [c] = extractEntityCandidates({ records: [record] }).candidates
    expect(c.confidence).toBe(1)
  })

  it('reads chunks and records in one pass', () => {
    const { candidates } = extractEntityCandidates({
      chunks: chunksOf('บริษัท เอบีซี จำกัด'),
      records: [record],
    })
    expect(candidates).toHaveLength(2)
    expect(new Set(candidates.map((c) => c.candidate_id)).size).toBe(2)
  })
})

describe('the default recognizer claims only what it can prove', () => {
  it('finds nothing in a sentence whose only entity is a person', () => {
    const { candidates } = extractEntityCandidates({ chunks: chunksOf('สมชาย ใจดี เป็นผู้ลงนามในสัญญา') })
    expect(candidates).toEqual([])
  })

  it('finds nothing in a sentence whose only entity is a product', () => {
    const { candidates } = extractEntityCandidates({ chunks: chunksOf('ลูกค้าสั่งซื้อกระเช้าของขวัญพรีเมียม') })
    expect(candidates).toEqual([])
  })

  it('hands the whole job to a caller-supplied recognizer when one is given', () => {
    const recognizer = ({ text }) =>
      text.includes('สมชาย') ? [{ type: 'Person', mention: 'สมชาย ใจดี', confidence: 0.7, offset: 0 }] : []
    const { candidates } = extractEntityCandidates({
      chunks: chunksOf('สมชาย ใจดี เป็นผู้ลงนาม'),
      recognizer,
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].type).toBe('Person')
    expect(candidates[0].confidence).toBe(0.7)
  })
})

describe('the partnership form, which has a prefix but no closing suffix', () => {
  it('captures a multi-word partnership name whole, not just its first word', () => {
    const { candidates } = extractEntityCandidates({ chunks: chunksOf('ผู้ขายคือ ห้างหุ้นส่วนจำกัด สมชาย การค้า ไทย') })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].mention).toBe('ห้างหุ้นส่วนจำกัด สมชาย การค้า ไทย')
  })

  it('stops at a conjunction rather than swallowing the next clause', () => {
    const { candidates } = extractEntityCandidates({
      chunks: chunksOf('ห้างหุ้นส่วนจำกัด สมชายการค้า และ บริษัท เอบีซี จำกัด เป็นคู่สัญญา'),
    })
    expect(candidates.map((c) => c.mention)).toEqual([
      'ห้างหุ้นส่วนจำกัด สมชายการค้า',
      'บริษัท เอบีซี จำกัด',
    ])
  })

  it('warns when the name ran to the token bound instead of ending at a delimiter', () => {
    const { candidates, warnings } = extractEntityCandidates({
      chunks: chunksOf('ห้างหุ้นส่วนจำกัด หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด'),
    })
    expect(warnings.join(' ')).toMatch(/ห้างหุ้นส่วนจำกัด/)
    expect(candidates[0].confidence).toBeLessThan(0.85)
  })
})

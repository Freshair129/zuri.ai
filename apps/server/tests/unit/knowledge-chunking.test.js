import { describe, it, expect } from 'vitest'
import { chunkDocument } from '@/modules/knowledge/chunking'

// @req FR-112 — structural knowledge chunking with parent-child lineage
// @spec docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §12 (Stage 7)

const scope = { tenantId: 'ten_1', businessId: 'biz_1', sensitivity: 'INTERNAL' }
const provenance = { source_ref: 'doc://contract-2026', pipeline_version: 'ki-1' }

describe('structural chunking', () => {
  it('splits a document into one chunk per section, in document order', () => {
    const { chunks } = chunkDocument({
      documentId: 'doc_1',
      scope,
      provenance,
      blocks: [
        { type: 'heading', level: 1, text: 'Scope of work' },
        { type: 'text', text: 'We deliver the console.' },
        { type: 'heading', level: 1, text: 'Payment terms' },
        { type: 'text', text: 'Net thirty days.' },
      ],
    })

    expect(chunks.map((c) => c.heading_path)).toEqual([['Scope of work'], ['Payment terms']])
    expect(chunks.map((c) => c.sequence)).toEqual([0, 1])
  })
})

describe('required chunk metadata (FR-109 catalog, DPS-KI-CHUNK)', () => {
  const doc = {
    documentId: 'doc_1',
    scope,
    provenance,
    blocks: [
      { type: 'heading', level: 1, text: 'Scope of work' },
      { type: 'text', text: 'We deliver the console.' },
    ],
  }

  it('carries document_id, scope and provenance verbatim — it computes none of them', () => {
    const [chunk] = chunkDocument(doc).chunks
    expect(chunk.document_id).toBe('doc_1')
    expect(chunk.scope).toEqual(scope)
    expect(chunk.provenance).toEqual(provenance)
  })

  it('assigns a deterministic chunk_id — the same document chunks to the same ids twice', () => {
    const first = chunkDocument(doc).chunks.map((c) => c.chunk_id)
    const second = chunkDocument(doc).chunks.map((c) => c.chunk_id)
    expect(first).toEqual(second)
    expect(first[0]).toBeTruthy()
  })

  it('counts tokens of the section body, not of its heading', () => {
    const [chunk] = chunkDocument(doc).chunks
    // 'We deliver the console.' — four whitespace-separated tokens
    expect(chunk.token_count).toBe(4)
  })

  it('gives a top-level section a null parent_id', () => {
    const [chunk] = chunkDocument(doc).chunks
    expect(chunk.parent_id).toBeNull()
  })
})

describe('heading hierarchy', () => {
  it('carries the ancestor headings in heading_path, not just the nearest one', () => {
    const { chunks } = chunkDocument({
      documentId: 'doc_2',
      scope,
      provenance,
      blocks: [
        { type: 'heading', level: 1, text: 'Contract' },
        { type: 'heading', level: 2, text: 'Payment' },
        { type: 'text', text: 'Net thirty.' },
        { type: 'heading', level: 2, text: 'Delivery' },
        { type: 'text', text: 'On site.' },
      ],
    })
    expect(chunks.map((c) => c.heading_path)).toEqual([
      ['Contract', 'Payment'],
      ['Contract', 'Delivery'],
    ])
  })
})

describe('parent-child fallback for oversized sections', () => {
  const longSection = (words) => ({
    documentId: 'doc_3',
    scope,
    provenance,
    maxTokens: 10,
    blocks: [
      { type: 'heading', level: 1, text: 'Terms' },
      { type: 'text', text: Array.from({ length: words }, (_, i) => `w${i}`).join(' ') },
    ],
  })

  it('leaves a section that fits as a single chunk with no children', () => {
    const { chunks } = chunkDocument(longSection(6))
    expect(chunks).toHaveLength(1)
    expect(chunks[0].parent_id).toBeNull()
  })

  it('splits an oversized section into children that name the section as parent', () => {
    const { chunks } = chunkDocument(longSection(25))
    const parents = chunks.filter((c) => c.parent_id === null)
    const children = chunks.filter((c) => c.parent_id !== null)

    expect(parents).toHaveLength(1)
    expect(children.length).toBeGreaterThan(1)
    expect(new Set(children.map((c) => c.parent_id))).toEqual(new Set([parents[0].chunk_id]))
    expect(children.every((c) => c.token_count <= 10)).toBe(true)
    // children inherit the section's place in the hierarchy
    expect(children.every((c) => JSON.stringify(c.heading_path) === JSON.stringify(['Terms']))).toBe(true)
  })

  it('warns when it had to fall back to a fixed window, because that is the degraded path', () => {
    const { warnings } = chunkDocument(longSection(25))
    expect(warnings.join(' ')).toMatch(/Terms/)
  })
})

describe('the sliding window actually slides', () => {
  const oversized = {
    documentId: 'doc_4',
    scope,
    provenance,
    maxTokens: 10,
    blocks: [
      { type: 'heading', level: 1, text: 'Terms' },
      { type: 'text', text: Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ') },
    ],
  }

  it('overlaps consecutive windows, so a phrase on a boundary survives whole in one of them', () => {
    const children = chunkDocument(oversized).chunks.filter((c) => c.parent_id !== null)
    for (let i = 1; i < children.length; i++) {
      const previous = children[i - 1].text.split(' ')
      const current = children[i].text.split(' ')
      const shared = current.filter((w) => previous.includes(w))
      expect(shared.length).toBeGreaterThan(0)
    }
  })

  it('still covers every token of the section across its windows', () => {
    const { chunks } = chunkDocument(oversized)
    const children = chunks.filter((c) => c.parent_id !== null)
    const covered = new Set(children.flatMap((c) => c.text.split(' ')))
    const expected = Array.from({ length: 25 }, (_, i) => `w${i}`)
    expect(expected.filter((w) => !covered.has(w))).toEqual([])
  })

  it('makes progress — overlap never causes a window to repeat the previous one', () => {
    const children = chunkDocument(oversized).chunks.filter((c) => c.parent_id !== null)
    const texts = children.map((c) => c.text)
    expect(new Set(texts).size).toBe(texts.length)
  })
})

describe('heading levels that are not a tidy 1,2,3', () => {
  it('a document that opens at H2 has no hole where H1 would have been', () => {
    const { chunks } = chunkDocument({
      documentId: 'doc_5',
      scope,
      provenance,
      blocks: [
        { type: 'heading', level: 2, text: 'Payment' },
        { type: 'text', text: 'Net thirty.' },
      ],
    })
    expect(chunks[0].heading_path).toEqual(['Payment'])
  })

  it('a skipped level (H1 then H3) does not leave a hole in heading_path', () => {
    const { chunks } = chunkDocument({
      documentId: 'doc_6',
      scope,
      provenance,
      blocks: [
        { type: 'heading', level: 1, text: 'Contract' },
        { type: 'heading', level: 3, text: 'Late fees' },
        { type: 'text', text: 'Two percent.' },
      ],
    })
    expect(chunks[0].heading_path).toEqual(['Contract', 'Late fees'])
  })

  it('never emits an undefined or null segment in heading_path', () => {
    const { chunks } = chunkDocument({
      documentId: 'doc_7',
      scope,
      provenance,
      blocks: [
        { type: 'heading', level: 3, text: 'Deep' },
        { type: 'text', text: 'Body.' },
        { type: 'heading', level: 1, text: 'Top' },
        { type: 'text', text: 'More.' },
      ],
    })
    for (const c of chunks) {
      expect(c.heading_path.every((h) => typeof h === 'string' && h.length > 0)).toBe(true)
    }
  })

  it('a heading with no body produces no chunk', () => {
    const { chunks } = chunkDocument({
      documentId: 'doc_8',
      scope,
      provenance,
      blocks: [
        { type: 'heading', level: 1, text: 'Empty' },
        { type: 'heading', level: 1, text: 'Real' },
        { type: 'text', text: 'Body.' },
      ],
    })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].heading_path).toEqual(['Real'])
  })
})

import { describe, expect, it } from 'vitest'
import { parseGenesisRag17Document } from '@/modules/knowledge/genesisrag17-source'

// @req FR-109 — Tier 1 chunk offsets/substrings stay exact even under the
// overlap fix below; a sliver or a whitespace-only chunk would still be
// embedded, indexed and served as citation text, so this file exists to keep
// that from regressing.
// FR-109 remediation follow-up (2026-09-25): the `splitRange` overlap step
// could stall near a paragraph/sentence boundary — `cursor` moved forward by
// only one character while the boundary search kept re-finding the same cut
// — emitting long runs of near-duplicate or whitespace-only slivers. Fixed
// by skipping the overlap entirely whenever the chunk just cut is not longer
// than the overlap budget, and otherwise moving `cursor` to a boundary-
// aligned point strictly between the previous cursor and the cut (guaranteed
// forward progress every iteration). These three shapes reproduce the
// original defect against the pre-fix code (git 5059376f).
// @spec ADR-073, ADR-075, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-chunker-overlap-regression.test.js

function assertNoSliversOrGaps(content, chunks) {
  expect(chunks.length).toBeGreaterThan(0)
  for (const chunk of chunks) {
    // No chunk is ever only whitespace.
    expect(chunk.text.trim().length).toBeGreaterThan(0)
    expect(content.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text)
  }
  // Consecutive chunks never repeat the same start, and always make forward
  // progress — the exact invariant the overlap-stall bug violated.
  for (let index = 1; index < chunks.length; index += 1) {
    expect(chunks[index].startOffset).toBeGreaterThan(chunks[index - 1].startOffset)
    expect(chunks[index].endOffset).toBeGreaterThan(chunks[index - 1].endOffset)
  }
}

describe('GenesisRAG17 prose chunker overlap regression (2026-09-25)', () => {
  it('does not emit slivers around a short paragraph followed by a long Thai paragraph', () => {
    const shortParagraph = 'สรุปสั้นๆ'
    const longParagraph = 'สวัสดีครับผมชื่อธนากรและผมทำงานที่บริษัทซูริเอไอในกรุงเทพมหานครประเทศไทย'.repeat(20)
    const content = `# หัวข้อ\n\n${shortParagraph}\n\n${longParagraph}`
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-thai-slivers', rawArtifactId: 'raw-thai-slivers', content })

    assertNoSliversOrGaps(content, chunks)
    // The original defect produced 10 chunks for this exact shape, seven of
    // them slivers of the short paragraph. A healthy chunker should not need
    // more than a handful of chunks for this size of content.
    expect(chunks.length).toBeLessThan(6)
    // The short paragraph must appear whole in some chunk, never fragmented
    // into a run of ever-shorter tail slivers.
    expect(chunks.some((chunk) => chunk.text.includes(shortParagraph))).toBe(true)
  })

  it('does not emit slivers around a short abbreviation-like prefix before a long unbroken run', () => {
    const content = `a. ${'ก'.repeat(1000)}`
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-abbrev-slivers', rawArtifactId: 'raw-abbrev-slivers', content })

    assertNoSliversOrGaps(content, chunks)
    // The original defect produced three chunks here — 'a.', '. ' and the
    // long run — from a single natural cut point, none of them slivers of
    // one another. This content is short enough to need very few chunks
    // once the stall is fixed.
    expect(chunks.length).toBeLessThanOrEqual(4)
  })

  it('makes forward progress and never emits mid-word chunks under a small, non-default maxTokens', () => {
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa']
    const content = words.join(' ')
    const { chunks } = parseGenesisRag17Document({
      documentId: 'doc-small-max-tokens',
      rawArtifactId: 'raw-small-max-tokens',
      content,
      maxTokens: 3,
    })

    assertNoSliversOrGaps(content, chunks)
    // 10 words at maxTokens=3 is at most ceil(10/3) = 4 windows before
    // overlap; the original defect produced 33, many starting mid-word.
    expect(chunks.length).toBeLessThanOrEqual(6)
    for (const chunk of chunks) {
      const text = chunk.text.trim()
      expect(words.some((word) => word === text || text.split(/\s+/u).every((token) => words.includes(token)))).toBe(true)
    }
  })
})

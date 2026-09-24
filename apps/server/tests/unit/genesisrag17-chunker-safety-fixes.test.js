import { describe, expect, it } from 'vitest'
import { GENESIS_RAG17_DEFAULT_MAX_CHARS, parseGenesisRag17Document } from '@/modules/knowledge/genesisrag17-source'

// @req FR-109 — Tier 1's chunker must not silently exceed the pinned e5
// embedder's window even on adversarial input; the offset/substring contract
// must still hold.
// FR-109 remediation follow-up (2026-09-25), closing the three defects an
// Opus gate review found in the first Thai-safe-chunker pass (git 5059376f,
// e7d223a0, f1d1c1d8):
//   1. The character budget's "cannot exceed 512 e5 tokens" claim assumed at
//      most one tokenizer token per raw character. The pinned XLM-R
//      tokenizer applies NFKC before tokenizing, and NFKC expands some
//      Unicode compatibility characters (measured: 480 x U+FDFA normalizes
//      to 8,640 characters; 480 x U+3231 to 1,440) — so raw-length alone is
//      not a safe bound. `splitRange` now also bounds every window by
//      `text.normalize('NFKC').length`.
//   2. The overlap step searched for its boundary using the same hard end
//      that produced the cut, so it re-found the identical boundary and
//      collapsed the overlap to zero on the majority of ordinary prose cuts
//      (sentence-punctuation and plain-whitespace cuts alike) — only a hard
//      cut ever got the configured overlap. Fixed by requiring the overlap
//      boundary to be strictly earlier than the cut.
//   3. When no safe grapheme boundary existed anywhere between the cursor
//      and the section's end, the forward safety-nudge extended the chunk
//      all the way to `end` with no budget cap (measured: 1,001 and 1,500
//      character single chunks). Fixed by capping that forward search to
//      the character budget, accepting a hard cut there as the documented
//      last resort instead of growing without bound.
// @spec ADR-073, ADR-075, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-chunker-safety-fixes.test.js

const STARTS_WITH_COMBINING_MARK = /^\p{M}/u

function assertOffsetsExact(content, chunks) {
  for (const chunk of chunks) {
    expect(content.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text)
  }
}

describe('GenesisRAG17 prose chunker safety fixes (2026-09-25)', () => {
  it('bounds a chunk by NFKC-normalized length, not just raw length, for an NFKC-expanding character', () => {
    // U+FDFA (ARABIC LIGATURE SALLALLAHOU ALAYHE WASSALLAM) normalizes under
    // NFKC to an 18-character expansion — 480 of them alone would raw-budget
    // as a single chunk yet normalize to 8,640 characters, far past the
    // tokenizer's window.
    const content = 'ﷺ'.repeat(2000)
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-nfkc', rawArtifactId: 'raw-nfkc', content })

    expect(chunks.length).toBeGreaterThan(1)
    assertOffsetsExact(content, chunks)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(GENESIS_RAG17_DEFAULT_MAX_CHARS)
      expect(chunk.text.normalize('NFKC').length).toBeLessThanOrEqual(GENESIS_RAG17_DEFAULT_MAX_CHARS)
    }
  })

  it('hard-cuts at the character budget, rather than extending forward without bound, when no safe grapheme boundary exists', () => {
    // Every position after the first is "unsafe" here: a run of combining
    // tone marks with a single base consonant has no safe chunk-open point
    // until content genuinely ends. The pre-fix chunker extended forward to
    // the section's end (measured: a single 1,001-character chunk).
    const content = 'ก' + '่'.repeat(1200)
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-unsafe-run', rawArtifactId: 'raw-unsafe-run', content })

    expect(chunks.length).toBeGreaterThan(1)
    assertOffsetsExact(content, chunks)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(GENESIS_RAG17_DEFAULT_MAX_CHARS)
    }
  })

  it('hard-cuts at the character budget for a run of Thai leading vowels with no safe boundary', () => {
    // A Thai leading vowel (เ) makes the position right after it unsafe; a
    // long run of nothing but that vowel has no safe boundary anywhere
    // (measured pre-fix: a single 1,500-character chunk).
    const content = 'เ'.repeat(1500)
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-vowel-run', rawArtifactId: 'raw-vowel-run', content })

    expect(chunks.length).toBeGreaterThan(1)
    assertOffsetsExact(content, chunks)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(GENESIS_RAG17_DEFAULT_MAX_CHARS)
    }
  })

  it('keeps a real overlap between consecutive windows of spaced English prose', () => {
    const sentences = Array.from({ length: 40 }, (_unused, index) => `Sentence number ${index} covers a different topic every time.`)
    const content = sentences.join(' ')
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-english-overlap', rawArtifactId: 'raw-english-overlap', content })

    expect(chunks.length).toBeGreaterThan(1)
    assertOffsetsExact(content, chunks)
    for (let index = 1; index < chunks.length; index += 1) {
      const overlap = chunks[index - 1].endOffset - chunks[index].startOffset
      expect(overlap).toBeGreaterThan(0)
    }
  })

  it('keeps a real overlap between consecutive windows of space-separated Thai clauses', () => {
    const clause = 'สวัสดีครับผมชื่อธนากรและผมทำงานที่บริษัทซูริเอไอในกรุงเทพมหานครประเทศไทย'
    const content = Array.from({ length: 60 }, () => clause).join(' ')
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-thai-spaced-overlap', rawArtifactId: 'raw-thai-spaced-overlap', content })

    expect(chunks.length).toBeGreaterThan(1)
    assertOffsetsExact(content, chunks)
    for (let index = 1; index < chunks.length; index += 1) {
      const overlap = chunks[index - 1].endOffset - chunks[index].startOffset
      expect(overlap).toBeGreaterThan(0)
    }
  })

  it('keeps a real overlap between consecutive windows of plain space-separated words with no punctuation', () => {
    const content = 'word '.repeat(3000).trim()
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-plain-words-overlap', rawArtifactId: 'raw-plain-words-overlap', content })

    expect(chunks.length).toBeGreaterThan(1)
    assertOffsetsExact(content, chunks)
    for (let index = 1; index < chunks.length; index += 1) {
      const overlap = chunks[index - 1].endOffset - chunks[index].startOffset
      expect(overlap).toBeGreaterThan(0)
    }
  })

  it('never opens a chunk with a leading separator after a sentence/whitespace cut', () => {
    const sentences = Array.from({ length: 40 }, (_unused, index) => `Sentence number ${index} covers a different topic every time.`)
    const content = sentences.join(' ')
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-english-leading-ws', rawArtifactId: 'raw-english-leading-ws', content })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks.slice(1)) {
      expect(/^\s/u.test(chunk.text)).toBe(false)
    }
  })

  it('never starts a chunk on a combining mark, even under the NFKC and unsafe-run fixes above', () => {
    const content = `${'ก'.repeat(1200)}่`.repeat(3)
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-combined-safety', rawArtifactId: 'raw-combined-safety', content })
    assertOffsetsExact(content, chunks)
    for (const chunk of chunks) {
      expect(STARTS_WITH_COMBINING_MARK.test(chunk.text)).toBe(false)
    }
  })
})

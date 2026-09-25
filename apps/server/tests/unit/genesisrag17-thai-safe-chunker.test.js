import { describe, expect, it } from 'vitest'
import {
  GENESIS_RAG17_DEFAULT_MAX_CHARS,
  GENESIS_RAG17_DEFAULT_OVERLAP_CHARS,
  GENESIS_RAG17_PARSER_VERSION_3,
  parseGenesisRag17Document,
} from '@/modules/knowledge/genesisrag17-source'

// @req FR-109 — Tier 1 preserves exact chunk substrings and offsets; this
// file proves that guarantee still holds under the character-safe windower.
// A TEXT-profile (prose) source is windowed by a conservative CHARACTER
// budget as well as the whitespace-token budget, so a long Thai paragraph
// (which has no spaces, and so is one whitespace token) still yields several
// chunks, none of which can exceed the pinned e5 embedder's 512-token
// truncation window (docs/plans/GENESISRAG17-CONTRACT.md,
// docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md Stage 15 note). No new
// requirement id is declared for this remediation.
// @spec ADR-073, ADR-075, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-thai-safe-chunker.test.js

// A Thai combining vowel/tone mark must never open a chunk — it has to stay
// attached to the base consonant before it (U+0E31, U+0E34-U+0E3A,
// U+0E47-U+0E4E named in the task; `\p{M}` in the implementation is a
// superset that also covers every other combining mark in the clause below).
const STARTS_WITH_COMBINING_MARK = /^\p{M}/u

// A realistic Thai clause with combining vowels/tone marks (ั ี ่ ้ ์ …) and no
// internal spaces — Thai does not space between words, only loosely between
// clauses/sentences — repeated with NO separating space at all, to build the
// worst case named in the task: one 3,000+ character paragraph that is a
// single whitespace token.
const THAI_CLAUSE = 'สวัสดีครับผมชื่อธนากรและผมทำงานที่บริษัทซูริเอไอในกรุงเทพมหานครประเทศไทย'
function thaiParagraph(minLength) {
  let text = ''
  while (text.length < minLength) text += THAI_CLAUSE
  return text
}

function assertChunksAreSafeAndExact(content, chunks) {
  expect(chunks.length).toBeGreaterThan(0)
  for (const chunk of chunks) {
    expect(content.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text)
    expect(chunk.contentHash).toBeTruthy()
    expect(chunk.text.length).toBeLessThanOrEqual(GENESIS_RAG17_DEFAULT_MAX_CHARS)
    expect(STARTS_WITH_COMBINING_MARK.test(chunk.text)).toBe(false)
  }
}

describe('Thai-safe prose chunker (genesisrag17-parser-3)', () => {
  it('cuts a 3,000-character space-free Thai paragraph into several chunks, each within the e5 window', () => {
    const content = thaiParagraph(3000)
    expect(content.length).toBeGreaterThanOrEqual(3000)
    // A single heading-free section: everything is one whitespace token, so
    // only the character budget can be doing the work here.
    const { parsed, chunks } = parseGenesisRag17Document({ documentId: 'doc-thai', rawArtifactId: 'raw-thai', parsedArtifactId: 'parsed-thai', content })

    expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION_3)
    expect(chunks.length).toBeGreaterThan(1)
    assertChunksAreSafeAndExact(content, chunks)

    // Full coverage: the parsed content is one big text block, so chunks walk
    // it start to end (overlap notwithstanding) with no gap.
    expect(chunks[0].startOffset).toBe(0)
    expect(chunks.at(-1).endOffset).toBe(content.length)
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index].startOffset).toBeLessThan(chunks[index - 1].endOffset)
      expect(chunks[index].startOffset).toBeGreaterThan(chunks[index - 1].startOffset)
    }
  })

  it('keeps an overlap between consecutive windows of the same section, bounded by the configured budget', () => {
    const content = thaiParagraph(2000)
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-thai-overlap', rawArtifactId: 'raw-thai-overlap', content })
    expect(chunks.length).toBeGreaterThan(1)
    for (let index = 1; index < chunks.length; index += 1) {
      const overlap = chunks[index - 1].endOffset - chunks[index].startOffset
      expect(overlap).toBeGreaterThan(0)
      expect(overlap).toBeLessThanOrEqual(GENESIS_RAG17_DEFAULT_OVERLAP_CHARS)
    }
  })

  it('cuts a mixed Thai/English document without breaking any grapheme, still respecting the char budget', () => {
    const content = `# Customer note\n\n${thaiParagraph(900)} The customer also asked, in English, whether the SmartGift bundle ships to Chiang Mai by Friday, and whether a receipt in Thai is available on request. ${thaiParagraph(900)}`
    const { parsed, chunks } = parseGenesisRag17Document({ documentId: 'doc-mixed', rawArtifactId: 'raw-mixed', content })
    expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION_3)
    expect(chunks.length).toBeGreaterThan(1)
    assertChunksAreSafeAndExact(content, chunks)
  })

  it('leaves a short document unchanged in chunk count (no gratuitous splitting under budget)', () => {
    const content = '# Note\n\nAlice works for Acme Ltd.'
    const { parsed, chunks } = parseGenesisRag17Document({ documentId: 'doc-short', rawArtifactId: 'raw-short', content })
    expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION_3)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('Alice works for Acme Ltd.')
  })

  it('prefers a sentence-punctuation or Thai-run-space boundary over a hard cut when one is available', () => {
    // Two clauses separated by a plain space (Thai's usual sentence spacing),
    // long enough together to force exactly one cut inside the pair.
    const clause = THAI_CLAUSE.repeat(6) // ~432 chars, under the 480 budget alone
    const content = `${clause} ${clause}`
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-thai-sentence', rawArtifactId: 'raw-thai-sentence', content })
    expect(chunks.length).toBeGreaterThan(1)
    // The first cut should land at (or very near) the natural space between
    // the two clauses, not mid-clause.
    const firstCutText = chunks[0].text
    expect(firstCutText.endsWith(clause) || firstCutText.endsWith(`${clause} `)).toBe(true)
  })
})

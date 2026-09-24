import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GENESIS_RAG17_CHUNKER_VERSION,
  GENESIS_RAG17_CHUNKER_VERSION_2,
  GENESIS_RAG17_PARSER_VERSION,
  GENESIS_RAG17_PARSER_VERSION_3,
  isHistoricalParserIdentity,
  parseGenesisRag17Document,
} from '@/modules/knowledge/genesisrag17-source'

// @req FR-109 — a persisted GenesisRag17IngestionIntent's requestJson is
// replayed unchanged by `resumeGenesisRag17Worker` and the FR-071 replay path
// (genesisrag17-executor.js `loadReplayRun`); both pass it straight into
// `ingestGenesisRag17Raw` -> `inputValue`, which resolves `parserVersion` and
// dispatches `parseGenesisRag17Document` accordingly. This file proves the
// piece of that chain that lives in genesisrag17-source.js: a historical
// (`genesisrag17-parser-1` / `genesisrag17-chunker-1`) request is honoured
// verbatim rather than refused, and a request that only superficially
// resembles the historical identity (a different maxTokens) is still
// refused exactly as before.
//
// FR-109 remediation follow-up (2026-09-25): before this fix,
// `parseGenesisRag17Document({ parserVersion: GENESIS_RAG17_PARSER_VERSION })`
// (the default-maxTokens case, exactly what a pre-remediation intent's
// requestJson carries) always threw
// GENESISRAG17_PARSER_CONFIG_UNSUPPORTED, because the function's only
// comparison was against the current identity
// (`genesisrag17-parser-3`). The same comparison lives in
// genesisrag17-executor.js `inputValue`, which is what a RUNNING or
// replayable pre-remediation TEXT intent hits on its first resume/replay —
// see .brain/reports/2026-09-24-genesisrag17-production-probe.md (run
// 1db6810c, a TEXT source, nextStageNumber 9).
// @spec ADR-050, ADR-073, ADR-075, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-executor-legacy-resume.test.js

const fixture = JSON.parse(readFileSync(new URL('../fixtures/genesisrag17-corpus-v1.json', import.meta.url), 'utf8'))

describe('isHistoricalParserIdentity', () => {
  it('matches the bare parser-1 constant only at the default 80-token budget', () => {
    expect(isHistoricalParserIdentity(GENESIS_RAG17_PARSER_VERSION, 80)).toBe(true)
    expect(isHistoricalParserIdentity(GENESIS_RAG17_PARSER_VERSION)).toBe(true) // default param
    expect(isHistoricalParserIdentity(GENESIS_RAG17_PARSER_VERSION, 4)).toBe(false)
  })

  it('matches the historical composite form for a non-default token budget', () => {
    const composite = `${GENESIS_RAG17_PARSER_VERSION};chunker=${GENESIS_RAG17_CHUNKER_VERSION};maxTokens=4`
    expect(isHistoricalParserIdentity(composite, 4)).toBe(true)
    expect(isHistoricalParserIdentity(composite, 80)).toBe(false)
  })

  it('never matches the current parser-3 identity', () => {
    expect(isHistoricalParserIdentity(GENESIS_RAG17_PARSER_VERSION_3, 80)).toBe(false)
  })
})

describe('parseGenesisRag17Document resuming/replaying a historical (pre-2026-09-24) intent', () => {
  it('honours a bare genesisrag17-parser-1 request instead of refusing it', () => {
    const { parsed, chunks } = parseGenesisRag17Document({
      documentId: 'doc-corpus',
      rawArtifactId: 'raw-v1',
      parsedArtifactId: 'parsed-v1',
      content: fixture.text,
      parserVersion: GENESIS_RAG17_PARSER_VERSION,
    })
    expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION)
    expect(parsed.metadata.chunkerVersion).toBe(GENESIS_RAG17_CHUNKER_VERSION)
    // The historical splitter never overlaps and never windows by characters.
    expect(parsed.metadata.maxChars).toBeNull()
    expect(parsed.metadata.overlapChars).toBeNull()
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(fixture.text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text)
    }
    // No overlap: consecutive chunks of the same section never share a range.
    for (let index = 1; index < chunks.length; index += 1) {
      if (chunks[index].headingPath.join('>') === chunks[index - 1].headingPath.join('>')) {
        expect(chunks[index].startOffset).toBeGreaterThanOrEqual(chunks[index - 1].endOffset)
      }
    }
  })

  it('produces byte-identical output to the pre-remediation splitter for the same content', () => {
    // The historical splitter windows purely by whitespace tokens (default
    // 80) with no character budget, no boundary search and no overlap — so a
    // short fixture never triggers the difference at all, but a long,
    // space-free Thai paragraph (which the parser-3 windower must split on
    // the character budget) must be returned as a SINGLE legacy chunk,
    // proving the historical path truly bypasses the character budget.
    const content = 'สวัสดีครับผมชื่อธนากรและผมทำงานที่บริษัทซูริเอไอในกรุงเทพมหานครประเทศไทย'.repeat(60)
    expect(content.length).toBeGreaterThan(3000)
    const legacy = parseGenesisRag17Document({
      documentId: 'doc-legacy-thai',
      rawArtifactId: 'raw-legacy-thai',
      content,
      parserVersion: GENESIS_RAG17_PARSER_VERSION,
    })
    expect(legacy.chunks).toHaveLength(1)
    expect(legacy.chunks[0].text).toBe(content)

    const current = parseGenesisRag17Document({ documentId: 'doc-current-thai', rawArtifactId: 'raw-current-thai', content })
    expect(current.parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION_3)
    expect(current.chunks.length).toBeGreaterThan(1)
  })

  it('still refuses a bare parser-1 identity paired with a non-default maxTokens', () => {
    // Guards against over-widening the legacy acceptance: this exact case is
    // also asserted in genesisrag17-source.test.js and must keep failing.
    expect(() => parseGenesisRag17Document({
      documentId: 'doc-profile',
      rawArtifactId: 'raw-profile',
      content: fixture.text,
      maxTokens: 4,
      parserVersion: GENESIS_RAG17_PARSER_VERSION,
    })).toThrow(/configuration identity/)
  })

  it('honours the historical composite identity for a non-default maxTokens', () => {
    const composite = `${GENESIS_RAG17_PARSER_VERSION};chunker=${GENESIS_RAG17_CHUNKER_VERSION};maxTokens=4`
    const { parsed } = parseGenesisRag17Document({
      documentId: 'doc-profile-legacy',
      rawArtifactId: 'raw-profile-legacy',
      content: fixture.text,
      maxTokens: 4,
      parserVersion: composite,
    })
    expect(parsed.parserVersion).toBe(composite)
    expect(parsed.metadata.chunkerVersion).toBe(GENESIS_RAG17_CHUNKER_VERSION)
    expect(parsed.metadata.maxChars).toBeNull()
  })

  it('never selects a historical identity for a new (parserVersion-less) request', () => {
    const { parsed } = parseGenesisRag17Document({ documentId: 'doc-new', rawArtifactId: 'raw-new', content: fixture.text })
    expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION_3)
    expect(parsed.metadata.chunkerVersion).toBe(GENESIS_RAG17_CHUNKER_VERSION_2)
  })
})

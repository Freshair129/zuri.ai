import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GENESIS_RAG17_PARSER_VERSION,
  extractGenesisRag17Mentions,
  parseGenesisRag17Document,
} from '@/modules/knowledge/genesisrag17-source'
import { hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'

// @req FR-109 — raw source, parser version and exact UTF-16 chunk/mention
// offsets remain addressable in the GenesisRAG17 Tier 1 lineage.
// @spec ADR-050, SDD-059, SDD-063, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-source.test.js

const fixture = JSON.parse(readFileSync(new URL('../fixtures/genesisrag17-corpus-v1.json', import.meta.url), 'utf8'))

describe('GenesisRAG17 source parser', () => {
  it('keeps each markdown section as an exact source substring', () => {
    const { parsed, chunks } = parseGenesisRag17Document({
      documentId: 'doc-corpus',
      rawArtifactId: 'raw-v1',
      parsedArtifactId: 'parsed-v1',
      content: fixture.text,
    })

    expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION)
    expect(parsed.content).toBe(fixture.text)
    expect(parsed.contentHash).toBe(hashGenesisRag17Text(fixture.text))
    expect(chunks).toHaveLength(8)
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual([...Array(8).keys()])
    for (const chunk of chunks) {
      expect(fixture.text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text)
      expect(chunk.contentHash).toBe(hashGenesisRag17Text(chunk.text))
      expect(chunk.chunkId).toContain('parsed-v1')
    }
  })

  it('makes a corrected source version addressable with different parsed and chunk IDs', () => {
    const first = parseGenesisRag17Document({ documentId: 'doc-corpus', rawArtifactId: 'raw-v1', parsedArtifactId: 'parsed-v1', content: fixture.text })
    const secondText = fixture.text.replace('Alice works for Acme Ltd.', 'Alice works for Beacon Ltd.')
    const second = parseGenesisRag17Document({ documentId: 'doc-corpus', rawArtifactId: 'raw-v2', parsedArtifactId: 'parsed-v2', content: secondText })

    expect(second.parsed.content).toContain('Alice works for Beacon Ltd.')
    expect(second.chunks[0].chunkId).not.toBe(first.chunks[0].chunkId)
    expect(second.chunks[0].startOffset).toBeGreaterThanOrEqual(0)
  })
})

describe('GenesisRAG17 rule_v1 source mentions', () => {
  it('extracts Person, Organization and Product occurrences from real fixture text', () => {
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-corpus', rawArtifactId: 'raw-v1', parsedArtifactId: 'parsed-v1', content: fixture.text })
    const mentions = extractGenesisRag17Mentions(chunks)

    expect(mentions.filter((mention) => mention.semanticType === 'Person')).toHaveLength(8)
    expect(mentions.filter((mention) => mention.semanticType === 'Organization')).toHaveLength(4)
    expect(mentions.filter((mention) => mention.semanticType === 'Product')).toHaveLength(4)
    expect(new Set(mentions.map((mention) => mention.sourceMentionId)).size).toBe(mentions.length)
    for (const mention of mentions) {
      const chunk = chunks.find((candidate) => candidate.chunkId === mention.chunkId)
      expect(chunk).toBeTruthy()
      expect(chunk.text.slice(mention.startOffset, mention.endOffset)).toBe(mention.name)
    }
  })

  it('uses UTF-16 code-unit offsets while hashing UTF-8 text', () => {
    const content = '# Contacts\n\n😀 Alice works for Acme Ltd.'
    const { chunks } = parseGenesisRag17Document({ documentId: 'doc-unicode', rawArtifactId: 'raw-unicode', parsedArtifactId: 'parsed-unicode', content })
    const mentions = extractGenesisRag17Mentions(chunks)
    const alice = mentions.find((mention) => mention.semanticType === 'Person')
    expect(alice).toBeTruthy()
    expect(chunks[0].text.slice(alice.startOffset, alice.endOffset)).toBe('Alice')
    expect(hashGenesisRag17Text(content)).toHaveLength(64)
  })
})

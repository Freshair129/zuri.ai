// @req FR-288 — managed binary projection and immutable source locations.
// @spec SDD-114 — versioned binary source projection and bounded parsing.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_BINARY_ENCODING,
  KNOWLEDGE_BINARY_MAX_BYTES,
  KNOWLEDGE_BINARY_PARSER_VERSION,
  decodeKnowledgeBinary,
  detectKnowledgeBinaryMediaType,
  encodeKnowledgeBinary,
  hashKnowledgeBinaryBytes,
  isKnowledgeBinaryProfile,
  knowledgeBinaryDescriptorFromRawContentType,
  parseKnowledgeBinary,
  rawKnowledgeBinaryContentType,
} from '@/modules/knowledge/knowledge-binary-parser'
import { genesisRag17BinaryParserIdentity } from '@/modules/knowledge/genesisrag17-source'

const fixtures = [
  { file: '../fixtures/knowledge-binary/basic.pdf', mediaType: 'application/pdf', text: 'Alice works for Acme Ltd.', spanKind: 'pdf_page' },
  { file: '../fixtures/knowledge-binary/basic.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', text: 'Alice works for Acme Ltd.', spanKind: 'docx_paragraph' },
  { file: '../fixtures/knowledge-binary/basic.html', mediaType: 'text/html', text: 'Alice works for Acme Ltd.', spanKind: 'html_element' },
]

describe('bounded binary source profile', () => {
  it.each(fixtures)('parses a real $mediaType fixture with deterministic typed source spans', async ({ file, mediaType, text, spanKind }) => {
    const bytes = readFileSync(new URL(file, import.meta.url))
    expect(await detectKnowledgeBinaryMediaType(bytes)).toBe(mediaType)
    const parserVersion = genesisRag17BinaryParserIdentity({ mediaType })
    const parsed = await parseKnowledgeBinary({ bytes, mediaType, sourceId: 'fixture-source', sourceVersion: 'fixture-v1', rawArtifactId: 'fixture-raw', parserVersion })
    expect(parsed.normalizedText).toContain(text)
    expect(parsed.metadata).toMatchObject({
      rawSha256: hashKnowledgeBinaryBytes(bytes),
      rawByteLength: bytes.length,
      sourceFormat: mediaType,
      parserVersion,
      mappingVersion: 'source-locator-map-1',
    })
    expect(parsed.sourceSpans.some((span) => span.kind === spanKind)).toBe(true)
    for (const span of parsed.sourceSpans) {
      expect(parsed.normalizedText.slice(span.artifactStartUtf16, span.artifactEndUtf16)).toBe(span.text)
      expect(span.unitEndUtf16 - span.unitStartUtf16).toBe(span.text.length)
    }
    if (mediaType === 'text/html') {
      expect(parsed.metadata).toMatchObject({ profile: 'html-source-dom-v1', cssAndScriptsApplied: false })
      expect(parsed.tables).toHaveLength(1)
      expect(parsed.sourceSpans.some((span) => span.kind === 'html_table_cell')).toBe(true)
    }
    if (mediaType.includes('wordprocessingml')) {
      expect(parsed.metadata).toMatchObject({ documentPart: 'word/document.xml', unprocessedParts: [] })
      expect(parsed.tables).toHaveLength(1)
      expect(parsed.sourceSpans.some((span) => span.kind === 'docx_table_cell')).toBe(true)
    }
  })

  it('only decodes the explicitly tagged binary profile and hashes original bytes', () => {
    const bytes = Buffer.from('<!doctype html><p>data:</p>', 'utf8')
    const content = encodeKnowledgeBinary(bytes, 'text/html')
    const descriptor = { binaryProfile: KNOWLEDGE_BINARY_PARSER_VERSION, binaryEncoding: KNOWLEDGE_BINARY_ENCODING, contentType: 'text/html' }
    expect(isKnowledgeBinaryProfile(descriptor)).toBe(true)
    expect(decodeKnowledgeBinary(content, descriptor)).toEqual(bytes)
    expect(hashKnowledgeBinaryBytes(decodeKnowledgeBinary(content, descriptor))).toBe(hashKnowledgeBinaryBytes(bytes))
    const rawDescriptor = knowledgeBinaryDescriptorFromRawContentType(rawKnowledgeBinaryContentType('text/html'))
    expect(rawDescriptor).toMatchObject({ mediaType: 'text/html', contentType: 'text/html', binaryProfile: KNOWLEDGE_BINARY_PARSER_VERSION, binaryEncoding: KNOWLEDGE_BINARY_ENCODING })
    expect(decodeKnowledgeBinary(content, rawDescriptor)).toEqual(bytes)
    expect(isKnowledgeBinaryProfile({ content: 'data:text/html;base64,SGVsbG8=', contentType: 'text/html' })).toBe(false)
    expect(() => decodeKnowledgeBinary(content, { ...descriptor, binaryProfile: 'text' })).toThrow('BINARY_PROFILE_INVALID')
    expect(() => decodeKnowledgeBinary('data:text/html;base64,AB==', descriptor)).toThrow('BINARY_SERIALIZATION_INVALID')
    expect(() => decodeKnowledgeBinary('data:text/html;base64,AAAA', { ...descriptor, maxBytes: 2 })).toThrow('INPUT_BYTES_LIMIT')
    expect(() => encodeKnowledgeBinary(Buffer.alloc(KNOWLEDGE_BINARY_MAX_BYTES + 1), 'text/html')).toThrow('INPUT_BYTES_LIMIT')
  })

  it('preserves loose and inline static HTML text in document order', async () => {
    const bytes = Buffer.from('intro <span>one</span><span>two</span> <p>before <em>inline</em> after</p> outro <table><tr><td>A</td></tr></table>', 'utf8')
    const parsed = await parseKnowledgeBinary({ bytes, mediaType: 'text/html', sourceId: 'html-fragment', sourceVersion: 'v1', rawArtifactId: 'html-raw' })
    expect(parsed.normalizedText).toContain('intro')
    expect(parsed.normalizedText).toContain('one' + 'two')
    expect(parsed.normalizedText).toContain('before inline after')
    expect(parsed.normalizedText).toContain('outro')
    expect(parsed.sourceSpans.some((span) => span.kind === 'html_element' && span.tagName === 'span' && span.text === 'one')).toBe(true)
    expect(parsed.sourceSpans.some((span) => span.kind === 'html_element' && span.tagName === 'span' && span.text === 'two')).toBe(true)
    for (const span of parsed.sourceSpans) expect(parsed.normalizedText.slice(span.artifactStartUtf16, span.artifactEndUtf16)).toBe(span.text)
  })

  it('normalizes malformed parser errors without exposing library input text', async () => {
    await expect(parseKnowledgeBinary({ bytes: Buffer.from('%PDF-not-a-real-file'), mediaType: 'application/pdf' }))
      .rejects.toMatchObject({ code: 'MALFORMED_PDF', message: 'MALFORMED_PDF' })
  })
})

import { defaultRecognizer } from './entity-extraction'
import { normalizeOrganizationName } from './normalization'
import {
  GENESIS_RAG17_SCHEMA_VERSION,
  hashGenesisRag17Json,
  hashGenesisRag17Text,
} from './genesisrag17-contract'
import {
  GENESIS_RAG17_PARSER_VERSION_2,
  GENESIS_RAG17_STRUCTURED_CHUNK_BOUNDARY,
  GENESIS_RAG17_STRUCTURED_RECOGNIZER_PROVENANCE,
  GENESIS_RAG17_STRUCTURED_RECOGNIZER_VERSION,
  genesisRag17StructuredRecognizer,
  isStructuredCatalogProvider,
  renderStructuredCatalogDocument,
} from './genesisrag17-structured-record'

// @req FR-109 — Tier 1 preserves raw content, parsed structure, exact chunk
// substrings and every source-mention occurrence for the GenesisRAG17 batch.
// @req FR-188 — a SMARTGIFT_CATALOG source selects `genesisrag17-parser-2` and
// the pinned `genesisrag17-structured-recognizer-1`; every other source keeps
// `genesisrag17-parser-1` and `rule_v1` exactly as before.
// @spec ADR-050, ADR-075, SDD-059, SDD-063, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-source.test.js, tests/unit/genesisrag17-parser-2.test.js

export const GENESIS_RAG17_PARSER_VERSION = 'genesisrag17-parser-1'
export {
  GENESIS_RAG17_PARSER_VERSION_2,
  GENESIS_RAG17_STRUCTURED_RECOGNIZER_PROVENANCE,
  GENESIS_RAG17_STRUCTURED_RECOGNIZER_VERSION,
  genesisRag17StructuredRecognizer,
}
export const GENESIS_RAG17_CHUNKER_VERSION = 'genesisrag17-chunker-1'
export const GENESIS_RAG17_RECOGNIZER_VERSION = 'rule_v1'
export const GENESIS_RAG17_RECOGNIZER_PROVENANCE = 'genesisrag17-source:default'
export const GENESIS_RAG17_DEFAULT_MAX_TOKENS = 80

/** Stage 2 profiles. `text` is parser-1 (prose); `structured-record` is parser-2. */
export const GENESIS_RAG17_PARSER_PROFILES = Object.freeze({
  TEXT: 'text',
  STRUCTURED_RECORD: 'structured-record',
})

/** Parser-2 is selected for SmartGift catalog sources only (FR-188). */
export function genesisRag17ParserProfileForProvider(provider) {
  return isStructuredCatalogProvider(provider) ? GENESIS_RAG17_PARSER_PROFILES.STRUCTURED_RECORD : GENESIS_RAG17_PARSER_PROFILES.TEXT
}

/** The Stage 8 recognizer and its recorded identity for one Stage 2 profile. */
export function genesisRag17RecognizerIdentity(profile = GENESIS_RAG17_PARSER_PROFILES.TEXT) {
  if (profile === GENESIS_RAG17_PARSER_PROFILES.STRUCTURED_RECORD) {
    return {
      recognizer: genesisRag17StructuredRecognizer,
      recognizerVersion: GENESIS_RAG17_STRUCTURED_RECOGNIZER_VERSION,
      recognizerProvenance: GENESIS_RAG17_STRUCTURED_RECOGNIZER_PROVENANCE,
    }
  }
  if (profile !== GENESIS_RAG17_PARSER_PROFILES.TEXT) throw parserConfigError('GenesisRAG17 parser profile is unknown')
  return { recognizer: defaultRecognizer, recognizerVersion: GENESIS_RAG17_RECOGNIZER_VERSION, recognizerProvenance: GENESIS_RAG17_RECOGNIZER_PROVENANCE }
}

function parserConfigError(message) {
  const error = new Error(message)
  error.status = 400
  error.code = 'GENESISRAG17_PARSER_CONFIG_UNSUPPORTED'
  return error
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/
const RELATION = /\b(?:works\s+for|is\s+employed\s+by|purchased|bought)\b/gi
const PRODUCT_AFTER_RELATION = /\b(?:purchased|bought)\s+([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,5})/g
const EXPLICIT_PERSON = /\b(?:person|customer|contact|ผู้ติดต่อ|ลูกค้า)\s*[:：]\s*([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*){0,2})/giu
const EXPLICIT_PRODUCT = /\b(?:product|สินค้า)\s*[:：]\s*([\p{L}][\p{L}0-9_.'-]*(?:\s+[\p{L}][\p{L}0-9_.'-]*){0,5})/giu
const PROPER_NAME = String.raw`[\p{Lu}][\p{Ll}.'-]*`
const PROPER_NAME_RUN = new RegExp(`(${PROPER_NAME}(?:\\s+${PROPER_NAME}){0,2})`, 'u')

function sourceSections(content) {
  const sections = []
  const headingMatches = []
  const lines = content.matchAll(/^.*(?:\r?\n|$)/gm)
  for (const match of lines) {
    const line = match[0].replace(/\r?\n$/, '')
    const heading = line.match(HEADING)
    if (heading) headingMatches.push({ start: match.index, end: match.index + match[0].length, level: heading[1].length, text: heading[2] })
  }
  if (!headingMatches.length) return [{ start: 0, end: content.length, headingPath: [] }]

  const path = []
  for (let index = 0; index < headingMatches.length; index++) {
    const heading = headingMatches[index]
    while (path.length >= heading.level) path.pop()
    path.push(heading.text)
    const start = heading.end
    const end = headingMatches[index + 1]?.start ?? content.length
    sections.push({ start, end, headingPath: [...path] })
  }
  const prefixEnd = headingMatches[0].start
  if (content.slice(0, prefixEnd).trim()) sections.unshift({ start: 0, end: prefixEnd, headingPath: [] })
  return sections
}

function trimRange(content, start, end) {
  while (start < end && /\s/u.test(content[start])) start += 1
  while (end > start && /\s/u.test(content[end - 1])) end -= 1
  return { start, end }
}

function splitRange(content, range, maxTokens) {
  const { start, end } = trimRange(content, range.start, range.end)
  if (end <= start) return []
  const tokens = [...content.slice(start, end).matchAll(/\S+/gu)]
  if (tokens.length <= maxTokens) return [{ start, end }]
  const ranges = []
  for (let index = 0; index < tokens.length; index += maxTokens) {
    const first = tokens[index]
    const last = tokens[Math.min(index + maxTokens, tokens.length) - 1]
    ranges.push({ start: start + first.index, end: start + last.index + last[0].length })
  }
  return ranges
}

/**
 * `genesisrag17-parser-2`: the parsed content is the rendered record text, one
 * chunk per rendered section (C-4). No heading detection and no token window.
 */
function parseStructuredRecordDocument({ documentId, rawArtifactId, parsedArtifactId, content, parserVersion }) {
  const rendered = renderStructuredCatalogDocument(content)
  const text = rendered.text
  const chunks = rendered.sections.map((section, ordinal) => ({
    chunkId: `${parsedArtifactId}:chunk:${ordinal}`,
    parsedArtifactId,
    ordinal,
    text: section.text,
    contentHash: hashGenesisRag17Text(section.text),
    startOffset: section.startOffset,
    endOffset: section.endOffset,
    headingPath: [`${section.entityType} ${section.recordCode}`, section.kind === 'claim' ? `claim ${section.predicate}` : 'descriptive'],
    tokenCount: section.text.trim().split(/\s+/u).length,
  }))
  const claimCount = rendered.sections.filter((section) => section.kind === 'claim').length
  const parsed = {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    documentId,
    rawArtifactId,
    parserVersion,
    content: text,
    contentHash: hashGenesisRag17Text(text),
    structure: rendered.sections.map((section) => ({ type: section.kind, text: section.text, startOffset: section.startOffset, endOffset: section.endOffset })),
    textBlocks: rendered.sections.map((section) => ({ text: section.text, startOffset: section.startOffset, endOffset: section.endOffset })),
    tables: [],
    metadata: {
      extractorVersion: parserVersion,
      // No token chunker applies to parser-2; recorded as explicit nulls.
      chunkerVersion: null,
      maxTokens: null,
      sourceFormat: rendered.sourceFormat,
      chunkBoundary: GENESIS_RAG17_STRUCTURED_CHUNK_BOUNDARY,
      rawContentHash: hashGenesisRag17Text(String(content ?? '')),
      recordCount: rendered.recordCount,
      descriptiveCount: rendered.sections.length - claimCount,
      claimCount,
      chunkCount: chunks.length,
      catalogVersionDate: rendered.catalogVersionDate ?? null,
    },
  }
  return { parsed, chunks }
}

/** Parse while retaining exact source text and JavaScript String offsets. */
export function parseGenesisRag17Document({ documentId, rawArtifactId, parsedArtifactId = rawArtifactId, content, maxTokens = GENESIS_RAG17_DEFAULT_MAX_TOKENS, parserVersion, profile = GENESIS_RAG17_PARSER_PROFILES.TEXT }) {
  if (!documentId || !rawArtifactId) throw new Error('GenesisRAG17 parser requires documentId and rawArtifactId')
  const text = String(content ?? '')
  const boundedMaxTokens = Math.max(1, Math.floor(maxTokens))
  const expectedParserVersion = genesisRag17ParserIdentity({ maxTokens: boundedMaxTokens, profile })
  const resolvedParserVersion = parserVersion ?? expectedParserVersion
  if (resolvedParserVersion !== expectedParserVersion) {
    const error = new Error('GenesisRAG17 parser configuration identity does not match chunking configuration')
    error.code = 'GENESISRAG17_PARSER_CONFIG_UNSUPPORTED'
    throw error
  }
  if (profile === GENESIS_RAG17_PARSER_PROFILES.STRUCTURED_RECORD) {
    return parseStructuredRecordDocument({ documentId, rawArtifactId, parsedArtifactId, content: text, parserVersion: resolvedParserVersion })
  }
  const sections = sourceSections(text)
  const structure = []
  const textBlocks = []
  for (const section of sections) {
    const sectionText = text.slice(section.start, section.end)
    if (sectionText.trim()) {
      const range = trimRange(text, section.start, section.end)
      structure.push({ type: 'text', text: text.slice(range.start, range.end), startOffset: range.start, endOffset: range.end })
      textBlocks.push({ text: sectionText, startOffset: section.start, endOffset: section.end })
    }
  }
  const chunks = []
  let ordinal = 0
  for (const section of sections) {
    for (const range of splitRange(text, section, boundedMaxTokens)) {
      const chunkText = text.slice(range.start, range.end)
      chunks.push({
        chunkId: `${parsedArtifactId}:chunk:${ordinal}`,
        parsedArtifactId,
        ordinal,
        text: chunkText,
        contentHash: hashGenesisRag17Text(chunkText),
        startOffset: range.start,
        endOffset: range.end,
        headingPath: section.headingPath,
        tokenCount: chunkText.trim() ? chunkText.trim().split(/\s+/u).length : 0,
      })
      ordinal += 1
    }
  }
  const parsed = {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    documentId,
    rawArtifactId,
    parserVersion: resolvedParserVersion,
    content: text,
    contentHash: hashGenesisRag17Text(text),
    structure,
    textBlocks,
    tables: [],
    metadata: {
      extractorVersion: resolvedParserVersion,
      chunkerVersion: GENESIS_RAG17_CHUNKER_VERSION,
      maxTokens: boundedMaxTokens,
      headingCount: (text.match(/^#{1,6}\s+/gmu) || []).length,
      textBlockCount: textBlocks.length,
      chunkCount: chunks.length,
    },
  }
  return { parsed, chunks }
}

/**
 * The parser version remains stable for the default 80-token profile. Any
 * caller that changes chunking receives a distinct parsed-artifact identity so
 * a replay cannot silently reuse chunks made with another configuration.
 */
export function genesisRag17ParserIdentity({ maxTokens = GENESIS_RAG17_DEFAULT_MAX_TOKENS, profile = GENESIS_RAG17_PARSER_PROFILES.TEXT } = {}) {
  const boundedMaxTokens = Math.max(1, Math.floor(maxTokens))
  if (profile === GENESIS_RAG17_PARSER_PROFILES.STRUCTURED_RECORD) {
    // Parser-2 never windows (C-4), so a token budget cannot be honoured and
    // is refused rather than silently recorded.
    if (boundedMaxTokens !== GENESIS_RAG17_DEFAULT_MAX_TOKENS) throw parserConfigError('genesisrag17-parser-2 does not window by tokens')
    return GENESIS_RAG17_PARSER_VERSION_2
  }
  if (profile !== GENESIS_RAG17_PARSER_PROFILES.TEXT) throw parserConfigError('GenesisRAG17 parser profile is unknown')
  if (boundedMaxTokens === GENESIS_RAG17_DEFAULT_MAX_TOKENS) return GENESIS_RAG17_PARSER_VERSION
  return `${GENESIS_RAG17_PARSER_VERSION};chunker=${GENESIS_RAG17_CHUNKER_VERSION};maxTokens=${boundedMaxTokens}`
}

function subjectBeforeRelation(text, relationOffset) {
  const boundary = Math.max(
    text.lastIndexOf('.', relationOffset - 1),
    text.lastIndexOf('!', relationOffset - 1),
    text.lastIndexOf('?', relationOffset - 1),
    text.lastIndexOf(';', relationOffset - 1),
    text.lastIndexOf('\n', relationOffset - 1),
  ) + 1
  const before = text.slice(boundary, relationOffset)
  const coordinated = new RegExp(`\\b(?:and|or)\\s+${PROPER_NAME_RUN.source}\\s*$`, 'u').exec(before)
  if (coordinated) return { name: coordinated[1], offset: boundary + before.lastIndexOf(coordinated[1]) }
  const leading = new RegExp(`^\\s*${PROPER_NAME_RUN.source}(?:\\s|$)`, 'u').exec(before)
  if (leading) return { name: leading[1], offset: boundary + before.indexOf(leading[1]) }
  const fallback = new RegExp(PROPER_NAME_RUN.source, 'gu').exec(before)
  return fallback ? { name: fallback[1], offset: boundary + fallback.index } : null
}

function addHit(hits, { type, mention, offset, confidence = 0.85, verbatimKey = false }) {
  const value = String(mention ?? '').trim()
  if (!value || !Number.isInteger(offset) || offset < 0) return
  const startOffset = offset + String(mention).indexOf(value)
  const endOffset = startOffset + value.length
  if (hits.some((hit) => hit.startOffset === startOffset && hit.endOffset === endOffset && hit.semanticType === type)) return
  hits.push({
    semanticType: type,
    name: value,
    // FR-188 / C-6: a structured occurrence's key is the SmartGift code
    // verbatim. normalizeOrganizationName is a legal-affix stripper; its being
    // a no-op on today's codes is a coincidence, not a contract.
    resolutionKey: verbatimKey ? value : normalizeOrganizationName(value),
    startOffset,
    endOffset,
    confidence,
  })
}

/** Extract source occurrences from each exact chunk; no canonical identity is decided here. */
export function extractGenesisRag17Mentions(chunks, { recognizer = defaultRecognizer } = {}) {
  // The guard stays closed with exactly one pinned exception (C-6): the
  // versioned structured recognizer. Any other function is still refused.
  const structured = recognizer === genesisRag17StructuredRecognizer
  if (!structured && recognizer !== defaultRecognizer) {
    const error = new Error('GenesisRAG17 custom recognizers require a separately versioned durable extension')
    error.code = 'GENESISRAG17_CUSTOM_RECOGNIZER_UNSUPPORTED'
    throw error
  }
  const mentions = []
  for (const chunk of chunks || []) {
    const chunkId = chunk?.chunkId ?? chunk?.chunk_id
    const hits = []
    if (structured) {
      for (const hit of recognizer({ text: chunk.text || '' })) {
        addHit(hits, { type: hit.type, mention: hit.mention, offset: hit.offset, confidence: hit.confidence, verbatimKey: true })
      }
      hits.sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset)
      hits.forEach((hit, index) => {
        mentions.push({
          sourceMentionId: `${chunkId}:mention:${index}`,
          resolutionKey: hit.resolutionKey,
          semanticType: hit.semanticType,
          name: hit.name,
          chunkId,
          startOffset: hit.startOffset,
          endOffset: hit.endOffset,
        })
      })
      continue
    }
    for (const hit of recognizer({ text: chunk.text || '' }) || []) {
      addHit(hits, { type: hit.type, mention: hit.mention, offset: hit.offset, confidence: hit.confidence })
    }
    for (const match of chunk.text.matchAll(RELATION)) {
      const subject = subjectBeforeRelation(chunk.text, match.index)
      if (subject) {
        addHit(hits, { type: 'Person', mention: subject.name, offset: subject.offset, confidence: 0.9 })
      }
    }
    for (const match of chunk.text.matchAll(PRODUCT_AFTER_RELATION)) addHit(hits, { type: 'Product', mention: match[1].replace(/[.,;:!?]+$/u, ''), offset: match.index + match[0].indexOf(match[1]), confidence: 0.85 })
    for (const match of chunk.text.matchAll(EXPLICIT_PERSON)) addHit(hits, { type: 'Person', mention: match[1], offset: match.index + match[0].indexOf(match[1]), confidence: 0.95 })
    for (const match of chunk.text.matchAll(EXPLICIT_PRODUCT)) addHit(hits, { type: 'Product', mention: match[1], offset: match.index + match[0].indexOf(match[1]), confidence: 0.95 })
    hits.sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset)
    hits.forEach((hit, index) => {
      mentions.push({
        sourceMentionId: `${chunkId}:mention:${index}`,
        resolutionKey: hit.resolutionKey,
        semanticType: hit.semanticType,
        name: hit.name,
        chunkId,
        startOffset: hit.startOffset,
        endOffset: hit.endOffset,
      })
    })
  }
  return mentions
}

export function parsedArtifactContentHash(parsed) {
  return hashGenesisRag17Json({
    parserVersion: parsed.parserVersion,
    documentId: parsed.documentId,
    rawArtifactId: parsed.rawArtifactId,
    contentHash: parsed.contentHash,
    structure: parsed.structure,
    textBlocks: parsed.textBlocks,
    tables: parsed.tables,
    metadata: parsed.metadata,
  })
}

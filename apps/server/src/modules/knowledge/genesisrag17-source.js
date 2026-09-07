import { defaultRecognizer } from './entity-extraction'
import { normalizeOrganizationName } from './normalization'
import {
  GENESIS_RAG17_SCHEMA_VERSION,
  hashGenesisRag17Json,
  hashGenesisRag17Text,
} from './genesisrag17-contract'

// @req FR-109 — Tier 1 preserves raw content, parsed structure, exact chunk
// substrings and every source-mention occurrence for the GenesisRAG17 batch.
// @spec ADR-050, SDD-059, SDD-063, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-source.test.js

export const GENESIS_RAG17_PARSER_VERSION = 'genesisrag17-parser-1'

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/
const PERSON_BEFORE_RELATION = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?=(?:works\s+for|is\s+employed\s+by|purchased|bought)\b)/gi
const PRODUCT_AFTER_RELATION = /\b(?:purchased|bought)\s+([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,5})/g
const EXPLICIT_PERSON = /\b(?:person|customer|contact|ผู้ติดต่อ|ลูกค้า)\s*[:：]\s*([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*){0,2})/giu
const EXPLICIT_PRODUCT = /\b(?:product|สินค้า)\s*[:：]\s*([\p{L}][\p{L}0-9_.'-]*(?:\s+[\p{L}][\p{L}0-9_.'-]*){0,5})/giu

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

/** Parse while retaining exact source text and JavaScript String offsets. */
export function parseGenesisRag17Document({ documentId, rawArtifactId, parsedArtifactId = rawArtifactId, content, maxTokens = 80 }) {
  if (!documentId || !rawArtifactId) throw new Error('GenesisRAG17 parser requires documentId and rawArtifactId')
  const text = String(content ?? '')
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
    for (const range of splitRange(text, section, Math.max(1, Math.floor(maxTokens)))) {
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
    parserVersion: GENESIS_RAG17_PARSER_VERSION,
    content: text,
    contentHash: hashGenesisRag17Text(text),
    structure,
    textBlocks,
    tables: [],
    metadata: {
      extractorVersion: GENESIS_RAG17_PARSER_VERSION,
      headingCount: (text.match(/^#{1,6}\s+/gmu) || []).length,
      textBlockCount: textBlocks.length,
      chunkCount: chunks.length,
    },
  }
  return { parsed, chunks }
}

function addHit(hits, { type, mention, offset, confidence = 0.85 }) {
  const value = String(mention ?? '').trim()
  if (!value || !Number.isInteger(offset) || offset < 0) return
  const startOffset = offset + String(mention).indexOf(value)
  const endOffset = startOffset + value.length
  if (hits.some((hit) => hit.startOffset === startOffset && hit.endOffset === endOffset && hit.semanticType === type)) return
  hits.push({
    semanticType: type,
    name: value,
    resolutionKey: normalizeOrganizationName(value),
    startOffset,
    endOffset,
    confidence,
  })
}

/** Extract source occurrences from each exact chunk; no canonical identity is decided here. */
export function extractGenesisRag17Mentions(chunks, { recognizer = defaultRecognizer } = {}) {
  const mentions = []
  for (const chunk of chunks || []) {
    const chunkId = chunk?.chunkId ?? chunk?.chunk_id
    const hits = []
    for (const hit of recognizer({ text: chunk.text || '' }) || []) {
      addHit(hits, { type: hit.type, mention: hit.mention, offset: hit.offset, confidence: hit.confidence })
    }
    for (const match of chunk.text.matchAll(PERSON_BEFORE_RELATION)) addHit(hits, { type: 'Person', mention: match[1], offset: match.index, confidence: 0.9 })
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

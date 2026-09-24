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
// the pinned `genesisrag17-structured-recognizer-1`; parser-2's own chunks,
// rendered text and identity are unaffected by the FR-109 remediation below
// (tests/unit/genesisrag17-parser-2.test.js proves byte-identical output).
// FR-109 remediation (2026-09-24, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md
// Stage 15 note): a TEXT-profile (prose) source is now also windowed by a
// conservative CHARACTER budget alongside the whitespace-token budget, so a
// spaceless script such as Thai — where one paragraph can be one whitespace
// token — still yields several chunks, none of which can exceed the pinned e5
// embedder's 512-token truncation window (still one Stage 9 batch, exact
// substrings and offsets per FR-109). Selected as `genesisrag17-parser-3` for
// every new TEXT-profile ingestion — including the two live LINE OA
// providers on that profile, LINE_FAQ_CANDIDATE (FR-236) and
// LINE_STUDIO_DESCRIPTION (FR-238) (knowledge-admission-service.js:427,:786)
// — so their chunk ids and boundaries also change from this point on;
// `genesisrag17-parser-1`/`genesisrag17-chunker-1` are historical identities,
// never selected by a new ingestion but still honoured verbatim (old
// splitter, no character budget, no overlap) when a persisted intent from
// before this remediation is resumed or replayed
// (`isHistoricalParserIdentity`, genesisrag17-executor.js `inputValue`). No
// new requirement id is declared for this remediation.
// @spec ADR-050, ADR-073, ADR-075, SDD-059, SDD-063, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-source.test.js, tests/unit/genesisrag17-parser-2.test.js,
//         tests/unit/genesisrag17-thai-safe-chunker.test.js,
//         tests/unit/genesisrag17-chunker-overlap-regression.test.js,
//         tests/unit/genesisrag17-executor-legacy-resume.test.js

export const GENESIS_RAG17_PARSER_VERSION = 'genesisrag17-parser-1'
// Current TEXT-profile identity. Bumping the identity (not just the
// chunking behind it) is what stops a replay from reusing parser-1 chunks —
// `genesisIdentity()` in genesisrag17-executor.js hashes `sourceIdentity +
// parserVersion` into the parsed-artifact's deterministic id, so a changed
// parserVersion always resolves to a new parsed-artifact row rather than the
// old one, even for byte-identical raw content.
export const GENESIS_RAG17_PARSER_VERSION_3 = 'genesisrag17-parser-3'
export {
  GENESIS_RAG17_PARSER_VERSION_2,
  GENESIS_RAG17_STRUCTURED_RECOGNIZER_PROVENANCE,
  GENESIS_RAG17_STRUCTURED_RECOGNIZER_VERSION,
  genesisRag17StructuredRecognizer,
}
// Historical: the chunker behind genesisrag17-parser-1. Never produced by new
// ingestions; kept so an old row's recorded chunkerVersion still resolves.
export const GENESIS_RAG17_CHUNKER_VERSION = 'genesisrag17-chunker-1'
// Current: the character-safe, boundary-aware, overlapping windower behind
// genesisrag17-parser-3 (2026-09-24 remediation).
export const GENESIS_RAG17_CHUNKER_VERSION_2 = 'genesisrag17-chunker-2'
export const GENESIS_RAG17_RECOGNIZER_VERSION = 'rule_v1'
export const GENESIS_RAG17_RECOGNIZER_PROVENANCE = 'genesisrag17-source:default'
export const GENESIS_RAG17_DEFAULT_MAX_TOKENS = 80
// Arithmetic: the pinned intfloat/multilingual-e5-small embedder
// truncates at MAX_LENGTH = 512 tokenizer tokens (embedder.py), and every
// embedded string is prefixed with "passage: " before tokenization. Budgeting
// for the tokenizer's own special tokens (2, e.g. an XLM-R-style CLS/SEP pair)
// and reserving one tokenizer token per character of the 9-character
// "passage: " prefix (the worst case the pipeline must survive) leaves
// 512 - 2 - 9 = 501 tokens for the chunk body. A chunk of N characters can
// need at most N tokenizer tokens (the pathological one-token-per-character
// case named in the task), so bounding N at 480 keeps a 21-token safety
// margin below that already-conservative 501 for every script, spaced or not.
export const GENESIS_RAG17_DEFAULT_MAX_CHARS = 480
// A small overlap keeps a boundary's context available to both neighbouring
// chunks. Bounded well under the safety margin above so it can never itself
// push a chunk over the character budget.
export const GENESIS_RAG17_DEFAULT_OVERLAP_CHARS = 60

/**
 * Whether `parserVersion` is the historical (pre-2026-09-24) TEXT-profile
 * identity for the given (bounded) `maxTokens` — the bare constant for the
 * default 80-token profile, or the old composite form for a custom token
 * budget (see the historical `genesisRag17ParserIdentity`, git 8b0…cb35d3ea).
 * This is the ONLY thing that makes `parseGenesisRag17Document` dispatch to
 * `splitRangeLegacy` instead of the character-safe windower: a persisted
 * `KnowledgeIngestionIntent.requestJson` from before this remediation still
 * carries one of these two exact strings, and `resumeGenesisRag17Worker` /
 * the FR-071 replay path (genesisrag17-executor.js) replay that request
 * unchanged. A NEW ingestion never produces either string — the current
 * `genesisRag17ParserIdentity` returns `genesisrag17-parser-3` (or its own
 * composite) — so this path is unreachable except for a historical replay.
 */
export function isHistoricalParserIdentity(parserVersion, maxTokens = GENESIS_RAG17_DEFAULT_MAX_TOKENS) {
  const boundedMaxTokens = Math.max(1, Math.floor(maxTokens))
  if (boundedMaxTokens === GENESIS_RAG17_DEFAULT_MAX_TOKENS) return parserVersion === GENESIS_RAG17_PARSER_VERSION
  return parserVersion === `${GENESIS_RAG17_PARSER_VERSION};chunker=${GENESIS_RAG17_CHUNKER_VERSION};maxTokens=${boundedMaxTokens}`
}

/**
 * Stage 2 profiles. `text` selects `genesisrag17-parser-3` for a new
 * ingestion (parser-1 is the historical TEXT identity, replayed unchanged for
 * a pre-remediation intent — see `isHistoricalParserIdentity`);
 * `structured-record` is parser-2.
 */
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

// A code point that must never open a chunk, because it is not a
// grapheme boundary. `\p{M}` (Unicode "Mark" — combining, spacing-combining
// and enclosing marks) is a superset of the Thai combining vowels/tone marks
// named in the task (U+0E31, U+0E34-U+0E3A, U+0E47-U+0E4E all fall in it), so
// this also protects every other script's combining diacritics for free.
const THAI_LEADING_VOWEL = /[เแโใไ]/u

function isUnsafeChunkStart(content, pos) {
  const ch = content[pos]
  if (ch === undefined) return false
  if (/\p{M}/u.test(ch)) return true
  // U+200D ZERO WIDTH JOINER: category Cf, not Mark, but splitting before it
  // (or right after it, which is what leaving it as the LAST character of the
  // previous chunk amounts to) breaks an emoji/ligature sequence the same way
  // a combining mark would.
  if (ch === '\u200D') return true
  // A Thai leading vowel (เ แ โ ใ ไ) is written BEFORE the consonant it
  // modifies. A cut right after one — starting the new chunk on the bare
  // consonant — strands the vowel alone at the end of the previous chunk.
  if (THAI_LEADING_VOWEL.test(content[pos - 1] || '')) return true
  const code = content.charCodeAt(pos)
  const prevCode = content.charCodeAt(pos - 1)
  return code >= 0xdc00 && code <= 0xdfff && prevCode >= 0xd800 && prevCode <= 0xdbff
}

/**
 * Nudges `pos` off an unsafe grapheme boundary. Prefers moving earlier
 * (extending the chunk that ends here) so the budget is never exceeded;
 * only extends forward if that would collapse the range to empty.
 */
function safeChunkBoundary(content, pos, lowerBound, upperBound) {
  let candidate = pos
  while (candidate > lowerBound && isUnsafeChunkStart(content, candidate)) candidate -= 1
  if (candidate > lowerBound) return candidate
  candidate = pos
  while (candidate < upperBound && isUnsafeChunkStart(content, candidate)) candidate += 1
  return candidate
}

const THAI_CHAR = /[฀-๿]/u

/**
 * Searches backward from `hardEnd` (exclusive) toward `lowerBound` (exclusive)
 * for the best cut point, in preference order: a paragraph break, then
 * sentence-ending punctuation (`. ! ?`) or a plain space between two Thai
 * runs (Thai has no word spaces, so this is its usual sentence break), then
 * any whitespace. Returns null when the window holds no such boundary, so the
 * caller falls back to a hard character cut — the documented last resort.
 */
function findChunkBoundary(content, lowerBound, hardEnd) {
  const window = content.slice(lowerBound, hardEnd)
  let bestParagraph = null
  for (const match of window.matchAll(/\n[ \t]*\n[ \t]*/gu)) {
    const pos = lowerBound + match.index + match[0].length
    if (pos > lowerBound) bestParagraph = pos
  }
  if (bestParagraph !== null) return bestParagraph

  let bestSentence = null
  let bestWhitespace = null
  for (let index = hardEnd - 1; index > lowerBound; index -= 1) {
    const ch = content[index]
    const next = index + 1
    if (bestSentence === null && /[.!?]/u.test(ch)) { bestSentence = next; break }
    if (bestSentence === null && ch === ' ' && THAI_CHAR.test(content[index - 1] || '') && THAI_CHAR.test(content[next] || '')) { bestSentence = next; break }
  }
  if (bestSentence !== null) return bestSentence
  for (let index = hardEnd - 1; index > lowerBound; index -= 1) {
    if (/\s/u.test(content[index])) { bestWhitespace = index + 1; break }
  }
  return bestWhitespace
}

/**
 * Bounds one section's ranges by whichever of the whitespace-token
 * budget or the character budget is hit first (a Thai paragraph with no
 * spaces is one whitespace token, so the character budget is what actually
 * bounds it), cuts at the best available boundary, keeps a small overlap
 * between consecutive windows of the section, and never opens a chunk on an
 * unsafe grapheme boundary.
 *
 * The overlap step must guarantee forward progress on its own: `cursor` is
 * only ever moved to a point strictly between the current `cursor` and
 * `cutEnd` (never re-emitting the same `cutEnd`), and the overlap is skipped
 * entirely — jumping straight to `cutEnd` — whenever the chunk just cut is
 * not longer than `overlapChars`, so a run of short chunks can never regress
 * into a near-duplicate sliver (or a whitespace-only one; those are dropped
 * outright below).
 */
function splitRange(content, range, maxTokens, maxChars = GENESIS_RAG17_DEFAULT_MAX_CHARS, overlapChars = GENESIS_RAG17_DEFAULT_OVERLAP_CHARS) {
  const { start, end } = trimRange(content, range.start, range.end)
  if (end <= start) return []
  const ranges = []
  let cursor = start
  while (cursor < end) {
    const charBudgetEnd = Math.min(end, cursor + maxChars)
    const tokens = [...content.slice(cursor, charBudgetEnd).matchAll(/\S+/gu)]
    let windowEnd = charBudgetEnd
    if (tokens.length > maxTokens) {
      const last = tokens[maxTokens - 1]
      windowEnd = cursor + last.index + last[0].length
    }
    let cutEnd
    if (windowEnd >= end) {
      cutEnd = end
    } else {
      const boundary = findChunkBoundary(content, cursor, windowEnd)
      cutEnd = safeChunkBoundary(content, boundary ?? windowEnd, cursor, end)
      if (cutEnd <= cursor) cutEnd = safeChunkBoundary(content, windowEnd, cursor, end)
      if (cutEnd <= cursor) cutEnd = Math.min(end, cursor + 1)
    }
    if (content.slice(cursor, cutEnd).trim()) ranges.push({ start: cursor, end: cutEnd })
    if (cutEnd >= end) break
    const chunkLength = cutEnd - cursor
    if (chunkLength > overlapChars) {
      // Align the overlap start to the same boundary preference as the cut
      // itself (paragraph > sentence/Thai-run-space > whitespace), searched
      // in the narrow window the overlap budget actually allows — not a
      // grapheme-only nudge of the raw arithmetic offset. The grapheme-safety
      // nudge here is forward-ONLY (never `safeChunkBoundary`'s bidirectional
      // nudge): `findChunkBoundary` already guarantees its result is >=
      // `desiredOverlapStart`, and nudging it earlier to dodge a combining
      // mark would silently grow the overlap past `overlapChars` — nudging
      // later only ever shrinks it, which stays within budget.
      const desiredOverlapStart = cutEnd - overlapChars
      const boundary = findChunkBoundary(content, desiredOverlapStart, cutEnd)
      let overlapStart = boundary ?? desiredOverlapStart
      while (overlapStart < cutEnd && isUnsafeChunkStart(content, overlapStart)) overlapStart += 1
      cursor = overlapStart > cursor && overlapStart < cutEnd ? overlapStart : cutEnd
    } else {
      cursor = cutEnd
    }
  }
  return ranges
}

/**
 * `genesisrag17-parser-1` (historical): whitespace-token windowing only, no
 * character budget, no boundary preference, no overlap. Reproduced verbatim
 * (git cb35d3ea) so a resumed or replayed intent recorded under the
 * historical identity gets back the exact chunks it was recorded with,
 * rather than 400/409ing on a configuration mismatch (see
 * `isHistoricalParserIdentity`).
 */
function splitRangeLegacy(content, range, maxTokens) {
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
  // A historical (pre-2026-09-24) TEXT-profile request replays through the
  // old token-only splitter, unchanged, instead of being refused or silently
  // re-windowed under the current character-safe one (see
  // `isHistoricalParserIdentity`). A NEW ingestion never supplies this
  // identity, so this only ever fires for a resumed or replayed intent.
  const isLegacyRequest = profile === GENESIS_RAG17_PARSER_PROFILES.TEXT && parserVersion !== undefined && isHistoricalParserIdentity(parserVersion, boundedMaxTokens)
  let resolvedParserVersion
  if (isLegacyRequest) {
    resolvedParserVersion = parserVersion
  } else {
    const expectedParserVersion = genesisRag17ParserIdentity({ maxTokens: boundedMaxTokens, profile })
    resolvedParserVersion = parserVersion ?? expectedParserVersion
    if (resolvedParserVersion !== expectedParserVersion) {
      const error = new Error('GenesisRAG17 parser configuration identity does not match chunking configuration')
      error.code = 'GENESISRAG17_PARSER_CONFIG_UNSUPPORTED'
      throw error
    }
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
    const ranges = isLegacyRequest
      ? splitRangeLegacy(text, section, boundedMaxTokens)
      : splitRange(text, section, boundedMaxTokens, GENESIS_RAG17_DEFAULT_MAX_CHARS, GENESIS_RAG17_DEFAULT_OVERLAP_CHARS)
    for (const range of ranges) {
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
      chunkerVersion: isLegacyRequest ? GENESIS_RAG17_CHUNKER_VERSION : GENESIS_RAG17_CHUNKER_VERSION_2,
      maxTokens: boundedMaxTokens,
      // The character budget and overlap that bound every chunk alongside
      // maxTokens above (whichever limit a section hits first). Historical
      // (legacy) requests never had either, so both are recorded as null —
      // matching the pre-remediation metadata shape exactly.
      maxChars: isLegacyRequest ? null : GENESIS_RAG17_DEFAULT_MAX_CHARS,
      overlapChars: isLegacyRequest ? null : GENESIS_RAG17_DEFAULT_OVERLAP_CHARS,
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
 * The TEXT-profile default is `genesisrag17-parser-3` (character-safe
 * windowing); `genesisrag17-parser-1` is a historical identity this function
 * no longer produces.
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
  if (boundedMaxTokens === GENESIS_RAG17_DEFAULT_MAX_TOKENS) return GENESIS_RAG17_PARSER_VERSION_3
  return `${GENESIS_RAG17_PARSER_VERSION_3};chunker=${GENESIS_RAG17_CHUNKER_VERSION_2};maxTokens=${boundedMaxTokens}`
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

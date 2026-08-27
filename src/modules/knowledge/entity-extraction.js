// @req FR-113 — entity candidate extraction from chunks and structured records
// @spec SDD-060, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §13 — candidates only, never canonical identity
// @tested tests/unit/knowledge-entity-extraction.test.js

// Stage 4 owns normalization and Stage 8 consumes it. The order is fixed:
// normalization runs BEFORE extraction, so a mention is stripped once, by one
// rule, wherever it came from. Two copies of this would drift and then two
// spellings of one company would stop matching for a reason nobody could see.
import { normalizeOrganizationName } from './normalization'

/**
 * Legal-form patterns. These earn their place because the suffix IS the evidence:
 * a string ending in `จำกัด` or `Ltd.` announces itself as an organization without
 * anyone having to recognise the name inside it. That is why the default recognizer
 * can be deterministic and still honest — it claims only what the grammar gives it.
 */
const ORGANISATION_PATTERNS = [
  /บริษัท\s+\S.*?\s+จำกัด/g,
  // The trailing guard is a lookahead, not \b: after "Ltd." the boundary between
  // "." and a space is not a word boundary, so \b would backtrack and hand back
  // "Ltd" with the period shorn off the mention.
  /\b[A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*)*\s+(?:Co\.,?\s*Ltd\.?|Ltd\.?|Limited)(?![A-Za-z0-9])/g,
]

/**
 * The partnership form is prefix-only: `ห้างหุ้นส่วนจำกัด` announces the type but
 * nothing marks where the name ends. That breaks the rule the other two patterns
 * rely on — that the grammar brackets the mention — so the end is found by scanning
 * instead, and when the scan runs out of budget rather than reaching a boundary the
 * candidate says so with a lower confidence and a warning. Silent truncation was the
 * previous behaviour and it lost every name after the first word.
 */
const PARTNERSHIP_PREFIX = 'ห้างหุ้นส่วนจำกัด'
const NAME_STOP_WORDS = new Set(['และ', 'หรือ', 'กับ', 'เป็น', 'โดย', 'ซึ่ง', 'ที่'])
const MAX_NAME_TOKENS = 5

/**
 * Finds entity candidates in FR-112 chunks.
 *
 * A candidate is a mention with a guess attached, never an identity — the
 * specification says so outright: "EntityCandidate ยังไม่ใช่ canonical entity".
 * Two mentions of the same name stay two candidates; deciding they are one
 * entity is resolution, and resolution is Stage 9 (ADR-050 D2).
 *
 * Pure: no I/O, no clock, no randomness, no model. Same chunks in, same
 * candidate ids out.
 */
export function extractEntityCandidates({ chunks, records, recognizer = defaultRecognizer }) {
  const candidates = []
  const warnings = []

  // Structured records first. Their mention is READ from a field the caller
  // names, not guessed out of prose, so confidence is 1 by default — the
  // uncertainty in a structured record is about which entity it denotes, and
  // that is Stage 9's question, not this one's. The caller names the field
  // because only the caller knows its record's shape; teaching this module CRM
  // column names would put a domain's schema inside the knowledge lane.
  for (const record of records || []) {
    if (!record || !record.mention) continue
    candidates.push({
      candidate_id: `${record.record_id}~e0`,
      type: record.type,
      mention: record.mention,
      normalized_name: normalizeOrganizationName(record.mention),
      source_chunk_id: null,
      source_record_id: record.record_id,
      confidence: record.confidence ?? 1,
      scope: record.scope,
      provenance: record.provenance,
    })
  }

  for (const chunk of chunks || []) {
    const found = recognizer({ text: chunk.text || '' })
    found.forEach((hit, index) => {
      if (hit.warning) warnings.push(hit.warning)
      candidates.push({
        candidate_id: `${chunk.chunk_id}~e${index}`,
        type: hit.type,
        mention: hit.mention,
        normalized_name: normalizeOrganizationName(hit.mention),
        source_chunk_id: chunk.chunk_id,
        source_record_id: null,
        confidence: hit.confidence,
        scope: chunk.scope,
        provenance: chunk.provenance,
      })
    })
  }

  return { candidates, warnings }
}

/**
 * The default recognizer: legal-form patterns only.
 *
 * Deliberately narrow. It does not attempt person names, products, locations or
 * any of the other types §13 lists — those need a model, and SDD-060 keeps the
 * model out of this lane. A caller with a recognizer of its own passes one in;
 * what this default will not do is imply coverage it does not have.
 */
export function defaultRecognizer({ text }) {
  const hits = []
  for (const pattern of ORGANISATION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      hits.push({ type: 'Organization', mention: match[0].trim(), confidence: 0.85, offset: match.index })
    }
  }
  hits.push(...findPartnerships(text))
  return hits.sort((left, right) => left.offset - right.offset)
}

function findPartnerships(text) {
  const hits = []
  let from = 0
  for (;;) {
    const at = text.indexOf(PARTNERSHIP_PREFIX, from)
    if (at === -1) return hits
    from = at + PARTNERSHIP_PREFIX.length

    const rest = text.slice(from)
    const tokens = rest.split(/\s+/).filter(Boolean)
    const name = []
    let endedAtBoundary = false
    for (const token of tokens) {
      if (NAME_STOP_WORDS.has(token) || /[.,;:()]/.test(token)) { endedAtBoundary = true; break }
      if (name.length === MAX_NAME_TOKENS) break
      name.push(token)
    }
    if (!name.length) continue
    if (name.length < MAX_NAME_TOKENS) endedAtBoundary = true

    const mention = `${PARTNERSHIP_PREFIX} ${name.join(' ')}`
    hits.push({
      type: 'Organization',
      mention,
      offset: at,
      confidence: endedAtBoundary ? 0.85 : 0.6,
      warning: endedAtBoundary
        ? null
        : `"${mention}" reached the ${MAX_NAME_TOKENS}-token name bound without a delimiter; the name may continue.`,
    })
  }
}

import { queryKnowledgeCorpus as defaultQueryKnowledgeCorpus } from './knowledge-corpus-service'

// @req FR-235 — an in-process implementation of the existing `knowledge.query`
// port, backed by `queryKnowledgeCorpus` (FR-173), never an HTTP self-call
// (ADR-090 D1). Scoped to exactly one Business — the reader is constructed
// once per turn from the job's already-verified, server-derived tenant and
// Business, never from a session or a request-supplied actor.
// @spec ADR-072 D5 — the "unforgeable scoped runtime knowledge capability":
// this reader mints a read-only viewer naming only the one Business it was
// built for (`visibleBusinessIds: [businessId]`), the same minimal-capability
// shape `server-line-rich-menu-runtime.js` already uses for a server-owned,
// in-process file read. It carries no session, no API-access flag and no
// ownership grant — it can never authorize a write, and it can never widen to
// a second Business because nothing here accepts one from its caller.
// @spec ADR-090 D3 — the evidence packet this reader returns is capped at
// `maxPacketBytes` (default 8 KiB): once a hit no longer fits, every hit after
// it in rank order is dropped too (rank order already puts the best-scored
// first, so dropping the tail is dropping the least relevant, not an
// arbitrary cut).
//
// This module returns evidence only — records and retrieval references — and
// never composes or records anything. Composition through the Context
// Composer (ADR-091 D7), when it happens at all, is exactly one call per
// turn owned by `server-line-answer.js`, merging this evidence with MSP
// slices under one shared budget; a second, independent composition here
// (an earlier version of this file had one) produced a second ContextReceipt
// for the same model invocation, which FR-234/SDD-100 forbid.
// @tested tests/unit/corpus-knowledge-reader.test.js

const DEFAULT_TOP_K = 5
const DEFAULT_MAX_PACKET_BYTES = 8192

function byteLength(text) {
  return Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8')
}

/**
 * `answerBusinessQuestion` never hands this reader the caller's raw question
 * text — only the registered query `selectRegisteredQuery` already derived
 * from it (`{queryId, params}`), the same shape the postgres business-
 * knowledge reader consumes. Reducing it back to a free-text search string is
 * this reader's own concern; it changes nothing about what that derivation
 * already decided.
 */
function queryTextFromRegisteredQuery({ queryId, params } = {}) {
  if (queryId === 'product_detail') return typeof params?.productCode === 'string' ? params.productCode : ''
  if (queryId === 'product_compare') return Array.isArray(params?.productCodes) ? params.productCodes.join(' ') : ''
  return typeof params?.term === 'string' ? params.term : ''
}

function emptyResult() {
  return { records: [], retrievalRefs: [], meta: { corpusGeneration: null, manifestHash: null, ranking: null } }
}

/**
 * @param {object} input
 * @param {string} input.tenantId — the job's already-verified tenant. Not
 *   itself an authorization field on `queryKnowledgeCorpus` (Business scope is
 *   what authorizes a read there), but required here so a caller cannot build
 *   this reader from anything less than the same server-derived scope the
 *   rest of the turn already checked.
 * @param {string} input.businessId — the one Business this reader may ever read.
 * @param {number} [input.topK] — ADR-090 D3 budget, default 5.
 * @param {number} [input.maxPacketBytes] — ADR-090 D3 budget, default 8192.
 */
export function createCorpusKnowledgeReader({
  tenantId,
  businessId,
  topK = DEFAULT_TOP_K,
  maxPacketBytes = DEFAULT_MAX_PACKET_BYTES,
  queryKnowledgeCorpus: queryCorpus = defaultQueryKnowledgeCorpus,
} = {}) {
  if (typeof tenantId !== 'string' || !tenantId.trim() || typeof businessId !== 'string' || !businessId.trim()) {
    throw Object.assign(new Error('CORPUS_KNOWLEDGE_READER_SCOPE_REQUIRED'), { code: 'CORPUS_KNOWLEDGE_READER_SCOPE_REQUIRED' })
  }
  // A read-only capability naming exactly this Business. Frozen, never
  // widened, never accepted as a constructor argument from a caller.
  const viewer = Object.freeze({ visibleBusinessIds: Object.freeze([businessId]) })

  return {
    async query(input) {
      const queryText = queryTextFromRegisteredQuery(input).trim()
      if (!queryText) return emptyResult()
      // NOTE: queryKnowledgeCorpus takes no AbortSignal today (grep of its
      // options and the underlying msp_pipeline_query/worker loopback contract
      // confirms this), so the budget timeout in line-knowledge-grounding.js
      // stops WAITING at the deadline but cannot cancel this in-flight call;
      // it keeps running detached and its late result is discarded. Passing a
      // signal through once the corpus service accepts one is a follow-up.
      const result = await queryCorpus({ businessId, query: queryText, topK }, { viewer })
      const hits = Array.isArray(result?.results) ? result.results : []
      if (!hits.length) return emptyResult()

      const records = []
      const retrievalRefs = []
      let usedBytes = 0
      for (const hit of hits) {
        const size = byteLength(hit.text)
        // One oversized (or later) hit is dropped on its own; it never blocks
        // an earlier, smaller hit that already fit (ADR-090 D3).
        if (usedBytes + size > maxPacketBytes) continue
        usedBytes += size
        const ref = {
          citationId: hit.citationId,
          sourceId: hit.sourceId,
          snapshotId: hit.snapshotId,
          generation: hit.generation,
          corpusGeneration: result.corpusGeneration,
          manifestHash: result.manifestHash,
        }
        records.push({ kind: 'CORPUS_CHUNK', text: hit.text, ...ref })
        retrievalRefs.push(ref)
      }
      return {
        records,
        retrievalRefs,
        meta: { corpusGeneration: result.corpusGeneration, manifestHash: result.manifestHash, ranking: result.ranking },
      }
    },
  }
}

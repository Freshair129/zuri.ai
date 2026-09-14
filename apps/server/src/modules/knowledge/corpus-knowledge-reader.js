import { queryKnowledgeCorpus as defaultQueryKnowledgeCorpus } from './knowledge-corpus-service'
import { composeContext as defaultComposeContext } from '@/modules/agent/context-composer'

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
// arbitrary cut). Composition through the Context Composer (ADR-091 D7) is
// used only for its citation/receipt bookkeeping here — the byte budget above
// is the real trim, so the composer is given a budget far larger than any
// already-8-KiB-bounded packet can reach and therefore never trims a second,
// disagreeing time.
// @tested tests/unit/corpus-knowledge-reader.test.js

const DEFAULT_TOP_K = 5
const DEFAULT_MAX_PACKET_BYTES = 8192
const COMPOSER_PASSTHROUGH_BUDGET_CHARS = 10_000_000

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
 * @param {object} [input.trace] — optional; if given, receives the composed
 *   `ContextReceipt` for a non-empty read (ADR-091 D7 wiring for FR-235).
 */
export function createCorpusKnowledgeReader({
  tenantId,
  businessId,
  topK = DEFAULT_TOP_K,
  maxPacketBytes = DEFAULT_MAX_PACKET_BYTES,
  trace,
  queryKnowledgeCorpus: queryCorpus = defaultQueryKnowledgeCorpus,
  composeContext: compose = defaultComposeContext,
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
      const result = await queryCorpus({ businessId, query: queryText, topK }, { viewer })
      const hits = Array.isArray(result?.results) ? result.results : []
      if (!hits.length) return emptyResult()

      const refsById = new Map()
      const sliceInputs = []
      let usedBytes = 0
      for (const [index, hit] of hits.entries()) {
        const size = byteLength(hit.text)
        // One oversized (or later) hit is dropped on its own; it never blocks
        // an earlier, smaller hit that already fit (ADR-090 D3).
        if (usedBytes + size > maxPacketBytes) continue
        usedBytes += size
        const id = `corpus:${hit.citationId ?? index}`
        refsById.set(id, {
          citationId: hit.citationId,
          sourceId: hit.sourceId,
          snapshotId: hit.snapshotId,
          generation: hit.generation,
          corpusGeneration: result.corpusGeneration,
          manifestHash: result.manifestHash,
        })
        sliceInputs.push({ id, citationId: hit.citationId, sequence: 'knowledge', text: hit.text })
      }
      if (!sliceInputs.length) return emptyResult()

      const composed = compose({
        authorized: true,
        knowledgeEvidence: sliceInputs,
        maxBudgetChars: COMPOSER_PASSTHROUGH_BUDGET_CHARS,
      })
      const included = composed.slices.filter((slice) => slice.source === 'KNOWLEDGE')
      const records = included.map((slice) => ({ kind: 'CORPUS_CHUNK', text: slice.content, ...refsById.get(slice.id) }))
      const retrievalRefs = included.map((slice) => refsById.get(slice.id))
      if (trace && typeof trace.recordContextReceipt === 'function') await trace.recordContextReceipt(composed.receipt)
      return {
        records,
        retrievalRefs,
        receipt: composed.receipt,
        meta: { corpusGeneration: result.corpusGeneration, manifestHash: result.manifestHash, ranking: result.ranking },
      }
    },
  }
}

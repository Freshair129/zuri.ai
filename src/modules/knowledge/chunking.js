// @req FR-112 — structural knowledge chunking with parent-child lineage
// @spec SDD-059, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §12 — pure calculator, no persistence
// @tested tests/unit/knowledge-chunking.test.js

const DEFAULT_MAX_TOKENS = 400

/** Fraction of a window repeated in the next one, so a boundary phrase survives whole somewhere. */
const WINDOW_OVERLAP_RATIO = 0.1

/**
 * Approximate token count: whitespace-separated words.
 *
 * Deliberately not a model tokenizer. A real one is model-specific and would make
 * this function depend on which embedding model Stage 15 happens to use, which is
 * exactly the coupling SDD-059 keeps out of the knowledge lane. Callers that need
 * an exact count for a specific model recount at the embedding boundary; this
 * number exists to decide where to split, not to bill anyone.
 */
function approximateTokenCount(text) {
  const trimmed = (text || '').trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/**
 * Splits a parsed document into retrieval-sized chunks along its own structure.
 *
 * Pure: no I/O, no persistence, no clock, no randomness — the same document
 * chunks to the same ids every time, which is what lets BR-021 treat a
 * reprocessed document as the same knowledge rather than a duplicate.
 *
 * `scope` and `provenance` are carried verbatim from the caller. This function
 * never derives them: classification is FR-111's job and provenance is captured
 * at Stage 3, both upstream of here.
 */
export function chunkDocument({ documentId, blocks, scope, provenance, maxTokens = DEFAULT_MAX_TOKENS }) {
  const chunks = []
  const warnings = []
  const headingStack = []
  let body = []

  const emit = (headingPath, text, parentId) => {
    const chunk = {
      chunk_id: `${documentId}#${chunks.length}`,
      parent_id: parentId,
      document_id: documentId,
      sequence: chunks.length,
      // Compacted: the stack is indexed by heading level, so a document that opens
      // at H2 — or skips H1 -> H3 — leaves holes in it. A hole serializes to null and
      // would read as an ancestor the document does not have.
      heading_path: [...headingPath].filter(Boolean),
      token_count: approximateTokenCount(text),
      scope,
      provenance,
      text,
    }
    chunks.push(chunk)
    return chunk
  }

  const flush = () => {
    const text = body.join(' ')
    body = []
    if (!text.trim()) return
    const section = emit(headingStack, text, null)
    if (section.token_count <= maxTokens) return

    // The section is too large to retrieve as one unit, so it also gets fixed
    // windows beneath it. This is the degraded path the specification calls a
    // fallback (§12): the structure did not give a boundary small enough, so we
    // impose one. The section chunk stays, so nothing is retrievable only as a
    // fragment torn out of its context.
    const words = text.trim().split(/\s+/)
    // Windows overlap. Without it this is fixed chunking wearing a nicer name, and a
    // sentence lying across a boundary is left in neither window whole.
    const overlap = Math.max(1, Math.floor(maxTokens * WINDOW_OVERLAP_RATIO))
    const step = Math.max(1, maxTokens - overlap)
    for (let start = 0; start < words.length; start += step) {
      emit(section.heading_path, words.slice(start, start + maxTokens).join(' '), section.chunk_id)
    }
    warnings.push(
      `Section "${section.heading_path.join(' > ')}" is ${section.token_count} tokens, over the ${maxTokens}-token limit; fell back to fixed windows.`
    )
  }

  for (const block of blocks || []) {
    if (block.type === 'heading') {
      flush()
      const level = Number(block.level) || 1
      headingStack.length = Math.max(0, level - 1)
      headingStack[level - 1] = block.text
    } else {
      body.push(block.text)
    }
  }
  flush()

  return { chunks, warnings }
}

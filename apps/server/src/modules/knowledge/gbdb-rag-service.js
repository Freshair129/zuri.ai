// @req FR-024 — GenesisBlockDB RAG Service: hybrid vector + graph context retrieval for agent turns.
// @spec ADR-007 §P5, SDD-027 — Knowledge graph retrieval with live-fact guard and unified provider seam.
// @tested tests/unit/gbdb-rag-service.test.js

import { assertNoLiveFacts } from './live-facts.js'

/**
 * Creates a GraphRAG service backed by GenesisBlockDB.
 *
 * @param {Object} options
 * @param {Object} options.db - GenesisDatabase instance (N-API native binding)
 * @param {Function} [options.embeddingProvider] - Async function (text) => Promise<number[]>
 * @param {Function} [options.llmProvider] - Async function ({ prompt, systemPrompt }) => Promise<string>
 */
export function createGenesisBlockDbRagService({ db, embeddingProvider, llmProvider } = {}) {
  if (!db || typeof db.addNode !== 'function' || typeof db.hybridSearch !== 'function') {
    throw new Error('createGenesisBlockDbRagService requires a valid GenesisDatabase client instance with addNode() and hybridSearch()')
  }

  return {
    /**
     * Ingest a knowledge document/chunk into GenesisBlockDB.
     */
    async ingestKnowledgeItem({ id, labels = ['Document'], properties = {}, embeddingText, embeddingVector }) {
      // Guard against live facts in graph store
      assertNoLiveFacts({ id, type: labels[0], ...properties })

      let vector = embeddingVector
      if (!vector && embeddingText && typeof embeddingProvider === 'function') {
        vector = await embeddingProvider(embeddingText)
      }

      const nodeInput = {
        id,
        labels,
        props: properties,
      }

      if (vector && Array.isArray(vector)) {
        nodeInput.embedding = vector
      }

      const result = await db.addNode(nodeInput)
      await db.flushIndex()
      return result
    },

    /**
     * Connect two knowledge nodes with a directed relationship.
     */
    async ingestRelation({ from, to, rel, properties = {} }) {
      const edgeInput = {
        from,
        to,
        rel,
        props: properties,
      }
      return await db.addEdge(edgeInput)
    },

    /**
     * Perform Hybrid Search (Vector k-NN + Graph K-Impact) and return relevant contexts.
     */
    async queryHybridContext({ queryText, queryVector, topK = 5, alpha = 0.5 } = {}) {
      let vector = queryVector
      if (!vector && queryText && typeof embeddingProvider === 'function') {
        vector = await embeddingProvider(queryText)
      }

      if (!vector || !Array.isArray(vector)) {
        throw new Error('queryHybridContext requires a valid queryVector or queryText with an embeddingProvider')
      }

      const searchHits = await db.hybridSearch({
        queryVector: vector,
        k: topK,
        alpha,
      })

      const formattedHits = (searchHits || []).map((hit) => {
        const node = hit.node || {}
        const props = node.props || {}
        return {
          id: node.id,
          labels: node.labels || [],
          title: props.title || props.name || node.id,
          text: props.text || props.content || '',
          score: hit.score ?? null,
          impact: node.impact ?? null,
          props,
        }
      })

      const combinedContextText = formattedHits
        .map((h) => `- [${h.title}] (Score: ${h.score ? h.score.toFixed(4) : 'N/A'}): ${h.text}`)
        .filter(Boolean)
        .join('\n')

      return {
        hits: formattedHits,
        combinedContextText,
        hitCount: formattedHits.length,
      }
    },

    /**
     * End-to-End RAG Execution: Retrieve Context -> Build Prompt -> Call LLM.
     */
    async executeAgentTurnWithRag({ queryText, queryVector, systemPrompt, topK = 5, alpha = 0.5 }) {
      if (typeof llmProvider !== 'function') {
        throw new Error('executeAgentTurnWithRag requires an injected llmProvider function')
      }

      const retrievalResult = await this.queryHybridContext({
        queryText,
        queryVector,
        topK,
        alpha,
      })

      const defaultSystemPrompt = 'คุณเป็น AI ผู้ช่วยตอบคำถามธุรกิจ สุภาพ กระชับ อ้างอิงคำตอบจากบริบทที่กำหนดให้อย่างถูกต้อง'
      const contextSection = retrievalResult.combinedContextText
        ? `[Context from Knowledge Graph]:\n${retrievalResult.combinedContextText}`
        : '[Context from Knowledge Graph]: ไม่พบบริบทเพิ่มเติม'

      const fullPrompt = `${contextSection}\n\n[User Question]: ${queryText}`
      const llmResponse = await llmProvider({
        prompt: fullPrompt,
        systemPrompt: systemPrompt || defaultSystemPrompt,
      })

      return {
        responseText: llmResponse,
        contextUsed: retrievalResult.hits,
        hitCount: retrievalResult.hitCount,
        fullPrompt,
      }
    },
  }
}

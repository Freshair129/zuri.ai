// @req FR-173 — resume the durable admission queue when the Node server boots.
// @spec ADR-072
// @tested tests/acceptance/knowledge-admission-native.test.js
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.ZURI_KNOWLEDGE_ENABLED === '1') {
    const { startKnowledgeAdmissionRuntime } = await import('@/modules/knowledge/knowledge-runtime')
    startKnowledgeAdmissionRuntime()
  }
}

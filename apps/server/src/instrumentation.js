// @req FR-173 — resume the durable admission queue when the Node server boots.
// @req FR-109 — fixed-field operational retry diagnostics reach the Server log.
// @spec ADR-072
// @tested tests/acceptance/knowledge-admission-native.test.js, tests/unit/knowledge-runtime-instrumentation.test.js
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.ZURI_KNOWLEDGE_ENABLED === '1') {
    const { startKnowledgeAdmissionRuntime } = await import('@/modules/knowledge/knowledge-runtime')
    startKnowledgeAdmissionRuntime({
      onError({ code, ingestionId, executionRunId, consecutiveFailures, retryBudgetExhausted, retryInMs }) {
        // Project only known diagnostic fields: no raw exception, content or credential payload.
        console.warn('[knowledge-runtime]', { code, ingestionId, executionRunId, consecutiveFailures, retryBudgetExhausted, retryInMs })
      },
    })
  }
}

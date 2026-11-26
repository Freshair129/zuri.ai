// @req FR-109 — persisted Stage 9 replies retain only the validated contract fields.
// @spec ADR-121
// @tested tests/unit/genesisrag17-response-allowlist.test.js

export const GENESIS_RAG17_RESPONSE_CONTRACT_FIELDS = Object.freeze([
  'schemaVersion',
  'scope',
  'batchId',
  'status',
  'decisionId',
])

export function contractResponseJson(response, decisionId = response.decisionId) {
  const normalizedDecisionId = typeof decisionId === 'string' && decisionId.length > 0 ? decisionId : null
  return {
    schemaVersion: response.schemaVersion,
    scope: response.scope,
    batchId: response.batchId,
    status: response.status,
    decisionId: normalizedDecisionId,
  }
}

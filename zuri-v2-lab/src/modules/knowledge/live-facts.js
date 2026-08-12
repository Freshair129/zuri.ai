// @req FR-024 — the enforced relations/live-facts split of the knowledge projection.
// @spec ADR-007 §P5 — GKS holds RELATIONS; live/transactional facts (current price,
//   credits, invoice, payment, stock, schedule, amounts, balances) stay a Zuri query,
//   never a projected node. This module is the guard that keeps a live fact from ever
//   crossing into the graph.
// @tested tests/integration/knowledge-project.test.js

// The forbidden field families. A projected node's props are rejected if any key
// contains one of these as a case-insensitive substring (so `price`, `unitPrice`,
// `invoiceTotal`, `creditBalance` all trip). Kept deliberately small and blunt:
// the projection only ever emits relation-bearing fields, so this is a backstop,
// not a schema.
export const LIVE_FACT_FIELDS = ['price', 'credit', 'invoice', 'payment', 'stock', 'schedule', 'amount', 'balance']

/**
 * Throw if `props` carries any live-fact field. Every node the projection emits must
 * pass this — it is the runtime expression of the ADR-007 §P5 gate.
 * @param {Record<string, unknown>} props
 * @throws {Error} when a key matches a live-fact field (case-insensitive substring)
 */
export function assertNoLiveFacts(props) {
  if (!props || typeof props !== 'object') return
  for (const key of Object.keys(props)) {
    const lower = key.toLowerCase()
    const hit = LIVE_FACT_FIELDS.find((f) => lower.includes(f))
    if (hit) {
      throw new Error(`Live fact "${key}" (matches "${hit}") must not be projected to the knowledge graph — it stays a Zuri query (ADR-007 §P5).`)
    }
  }
}

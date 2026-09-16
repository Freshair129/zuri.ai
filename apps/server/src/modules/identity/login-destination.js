// @req FR-144 — resume only the fixed pairing surface after normal login.
// @spec SEC-008
// @tested tests/unit/edge-pairing.test.js
export function loginDestination(search, fallback = '/businesses') {
  return new URLSearchParams(search).get('next') === '/edge/pair' ? '/edge/pair' : fallback
}

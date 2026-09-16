// @req FR-236 — a Business's `knowledgeCandidatesEnabled` says whether its
//   viewers may draft LINE FAQ knowledge candidates at all (ADR-090 D6).
//   Distinct from `business-capabilities.js`'s `capabilitiesJson`: a
//   capability says whether a module APPLIES to a Business (defaults ON, an
//   old Business keeps what it had); this says whether reviewed chat content
//   may be ADMITTED into the knowledge corpus — a content-safety gate, so it
//   defaults OFF for every Business, including one that already has the
//   `knowledge` domain grant and OWNER/LINE_OA_PUBLISHER members. Reading
//   this never throws: a missing Business, a missing column value, or
//   anything other than the literal boolean `true` reads as OFF — the same
//   fail-closed default `businessHasCapability` uses for a bad
//   `capabilitiesJson`, applied to a plain column instead of a JSON one.
// @spec ADR-090 D6
// @tested tests/unit/business-knowledge-candidates.test.js

/**
 * Whether `business` may draft LINE FAQ knowledge candidates.
 *
 * Accepts the raw Business row (or a partial select carrying
 * `knowledgeCandidatesEnabled`), `null`/`undefined` (no Business, or one the
 * caller could not load), or anything else shaped unexpectedly — every one of
 * those reads as `false`. There is no "unset" state distinct from `false`:
 * the column is `NOT NULL DEFAULT false`, so a Business with no explicit
 * write here already stores `false`, not an absent row.
 */
export function businessHasKnowledgeCandidatesEnabled(business) {
  return business?.knowledgeCandidatesEnabled === true
}

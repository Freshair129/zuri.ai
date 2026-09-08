// @req FR-169 — a Business's `capabilitiesJson` says whether a module APPLIES
// to it at all, a different question from a Membership's `domainKeysJson`
// (which says who may open a module the Business already has). Reading a
// capability never throws: a missing or malformed column reads as every
// capability's own stated default, exactly as `parseDomainKeys` in
// `identity/viewer-domains.js` treats a bad grant as an empty one rather than
// a crash.
// @spec ADR-069 (the SCM grouping this capability is the first consumer of)
// @tested tests/unit/business-capabilities.test.js

/**
 * Every capability this Business could declare, and what an ABSENT key means.
 * `physicalStock` defaults to `true`: every Business that already has real
 * Inventory data (every Business seeded before FR-169 existed) keeps the
 * Warehouse slot exactly as visible as it was — the toggle is an opt-OUT for a
 * service-only Business, never a silent opt-out this migration would cause by
 * existing.
 */
export const BUSINESS_CAPABILITIES = {
  physicalStock: { default: true },
}

export const BUSINESS_CAPABILITY_KEYS = Object.keys(BUSINESS_CAPABILITIES)

/** A trusted object, or `{}` if the column cannot be trusted. */
export function parseCapabilities(json) {
  try {
    const parsed = JSON.parse(json || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Whether `business` has `capability` enabled. Accepts the raw Business row
 * (reads `.capabilitiesJson`) or an already-parsed capabilities object, so a
 * caller holding either shape never has to parse first.
 */
export function businessHasCapability(business, capability) {
  const known = BUSINESS_CAPABILITIES[capability]
  if (!known) throw new Error(`unknown capability: ${capability}`)
  if (!business) return known.default
  const capabilities = 'capabilitiesJson' in business ? parseCapabilities(business.capabilitiesJson) : business
  const value = capabilities[capability]
  return typeof value === 'boolean' ? value : known.default
}

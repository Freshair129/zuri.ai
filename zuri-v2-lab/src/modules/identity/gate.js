import { resolveLineIdentity, revokeLineIdentity } from './resolve-line-identity'
import { classifyPrincipal } from './classify-principal'
import { issueLinkToken, redeemLinkToken } from './link-line-identity'
import { erasePrincipal } from './erase-principal'

// @req FR-022 — the full P3 identity gate: the single seam every LINE surface routes
//   through so no site resolves a lineUserId on its own (IMPACT-SCAN-IDENTITY §3).
// @spec ADR-007 §P3 — resolve the subject to a principal, then type it staff/customer
//   in one call, so authorisation and memory are keyed by a classified principal, not
//   a raw channel handle.
// @tested tests/integration/identity-gate.test.js

/**
 * Resolve a LINE subject to a classified principal within a tenant: mint-or-return
 * the Person (FR-021), then type it STAFF/CUSTOMER (FR-022) in a single call.
 *
 * @returns {{ personId, externalIdentityId, created, principalType, isStaff,
 *   isCustomer, roles, customerId }}
 */
export async function resolveLinePrincipal(input) {
  const resolved = await resolveLineIdentity(input)
  const classification = await classifyPrincipal({ tenantId: input.tenantId, personId: resolved.personId })
  return { ...resolved, ...classification }
}

export {
  resolveLineIdentity,
  revokeLineIdentity,
  classifyPrincipal,
  issueLinkToken,
  redeemLinkToken,
  erasePrincipal,
}

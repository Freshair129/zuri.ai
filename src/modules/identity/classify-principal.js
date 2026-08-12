import prisma from '@/lib/db'
import { zClassifyPrincipalInput } from '@/lib/validation/entities'

// @req FR-022 — the staff/customer split of the P3 identity gate.
// @spec ADR-007 §P3, docs/replacement/IMPACT-SCAN-IDENTITY.md §hazard-6 — a LINE
//   subject that resolves to a Person must be typed STAFF vs CUSTOMER with an
//   airtight, deterministic rule, because V1 conflated them at one findFirst site.
// @spec BR-001, SEC-001 — classification is always tenant-scoped.
// @tested tests/integration/identity-classify.test.js
//
// V2 unified identity into Person (ADR-003 §D10), so there is no principalType
// column to trust: the type is structural. A Person is STAFF when it holds a
// Membership in the tenant (the RBAC side) and CUSTOMER when it holds a Customer
// record (the CRM side). A human who is both resolves to STAFF — authorisation
// takes precedence over CRM. Neither ⇒ UNKNOWN (a bare, freshly-minted principal).

/**
 * Classify a resolved principal within a tenant.
 * @returns {{ principalType: 'STAFF'|'CUSTOMER'|'UNKNOWN', isStaff: boolean,
 *   isCustomer: boolean, roles: string[], customerId: string|null }}
 */
export async function classifyPrincipal(input) {
  const { tenantId, personId } = zClassifyPrincipalInput.parse(input)

  const [memberships, customer] = await Promise.all([
    prisma.membership.findMany({ where: { tenantId, personId }, select: { role: true } }),
    prisma.customer.findFirst({
      where: { tenantId, personId, deletedAt: null },
      select: { id: true },
    }),
  ])

  const isStaff = memberships.length > 0
  const isCustomer = Boolean(customer)
  // Precedence: STAFF > CUSTOMER. A person who is both is treated as staff so an
  // employee messaging the OA is never mistaken for a customer of themselves.
  const principalType = isStaff ? 'STAFF' : isCustomer ? 'CUSTOMER' : 'UNKNOWN'

  return {
    principalType,
    isStaff,
    isCustomer,
    roles: memberships.map((m) => m.role),
    customerId: customer?.id ?? null,
  }
}

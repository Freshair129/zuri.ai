import prisma from '@/lib/db'

// @req FR-149 — legacy forwarding/receipts cannot write after server ownership.
// @spec ADR-061, SEC-001 — match authenticated Tenant/Business and account namespace.
// @tested tests/unit/legacy-line-transport-ownership.test.js

export function resolvedLineChannelAccountId(scope) {
  return scope.channelAccountId ?? scope.code ?? scope.bindingId ?? scope.id ?? 'LEGACY:LINE'
}

export async function assertLegacyLineTransportOwnership({ scope, destination, db = prisma }) {
  const namespace = resolvedLineChannelAccountId(scope)
  const matchingAccount = [{ id: namespace }, { bindingCode: namespace }]
  if (destination) matchingAccount.push({ connection: { externalAccountId: destination } })
  const enabled = await db.lineOaAccount.findFirst({
    where: {
      tenantId: scope.tenantId,
      ...(scope.businessId ? { businessId: scope.businessId } : {}),
      serverEnabled: true,
      OR: matchingAccount,
    },
    select: { id: true },
  })
  if (enabled) {
    const error = new Error('LINE_SERVER_OWNS_TRANSPORT')
    // Legacy Edge suppresses replies on authorization failure; returning 409/5xx
    // could make an old transport send its generic fallback to the customer.
    error.status = 401
    throw error
  }
}

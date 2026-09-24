// ReferenceAuthority — the PROPOSED port through which SCM checks references to
// masters it does NOT own (gate SCM-CORE for Branch/Customer, SCM-FILES for
// FileAsset). SCM never copies those tables and never joins them.
//
// The port returns FACTS (or null for "not found / not yours"); the SCM use
// case applies the legacy predicate itself, in the legacy order, inside its
// unit of work. So refusal codes and their precedence stay identical to the
// monolith, while the owner stays the only reader of its table.
//
//   branch(scope, {businessId, branchId})      → {id, code, name, tenantId, businessId, status} | null
//   customer(scope, {businessId, customerId})  → {id, code, tenantId, businessId|null, deletedAt|null} | null
//   fileAsset(scope, {businessId, fileAssetId})→ {id, businessId, deletedAt|null} | null
//
// Facts are fetched BEFORE the unit of work opens (a remote call must not hold
// the writer lock). Consistency window: a reference revoked between the fact
// read and the commit is not seen — bounded by the request deadline and
// reported with `verifiedAt` in the outcome. Unavailable owner → the operation is
// refused retryably with no effect (never a fallback to "assume valid").

const unavailable = (which) => Object.assign(new Error(`reference owner unavailable: ${which}`), { status: 503, code: 'SCM_REFERENCE_AUTHORITY_UNAVAILABLE', retryable: true, details: { reference: which } })

/** The production default until the core/Files façades exist: every lookup refuses. */
export function createUnavailableReferenceAuthority() {
  return {
    kind: 'unavailable',
    branch: async () => { throw unavailable('branch') },
    customer: async () => { throw unavailable('customer') },
    fileAsset: async () => { throw unavailable('fileAsset') },
  }
}

/**
 * Test/rehearsal provider over a static synthetic fixture
 * ({branches: [], customers: [], fileAssets: []}). Answers only within the
 * caller's Tenant, like the real owners would.
 */
export function createFixtureReferenceAuthority(fixture = {}) {
  const find = (list, id, tenantId) => (list ?? []).find((row) => row.id === id && (row.tenantId ?? tenantId) === tenantId) ?? null
  return {
    kind: 'fixture',
    branch: async (scope, { branchId }) => find(fixture.branches, branchId, scope.tenantId),
    customer: async (scope, { customerId }) => find(fixture.customers, customerId, scope.tenantId),
    fileAsset: async (scope, { fileAssetId }) => {
      const row = find(fixture.fileAssets, fileAssetId, scope.tenantId)
      return row ? { id: row.id, businessId: row.businessId, deletedAt: row.deletedAt ?? null } : null
    },
  }
}

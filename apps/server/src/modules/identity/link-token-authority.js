import prisma from '@/lib/db'
import { authorizeScope, resolveAuthorizationContext } from './authorization-context'
import { isInstallationOperator } from './viewer-authority'

// @req FR-022, FR-097 — link-token issuance and channel-identity reads use live,
//   scope-specific Identity authority; a Business OWNER cannot read another
//   Business's binding by virtue of the global OWNER label.
// @spec SEC-018, ADR-045 D1/D4/D5, SDD-052
// @tested tests/integration/fr097-line-channel-onboarding.test.js

const LIVE_CONTEXT_REASONS = new Set([
  'MEMBERSHIP_SCOPE_DENIED',
  'ACTIVE_MEMBERSHIP_ALLOWED',
])

function viewerPersonId(viewer) {
  return viewer?.personId ?? viewer?.principal?.id ?? null
}

function isLiveContext(context, personId, tenantId, businessId = null) {
  return context?.actor?.personId === personId &&
    context?.scope?.tenantId === tenantId &&
    context?.scope?.businessId === businessId &&
    (!businessId || context?.business?.id === businessId) &&
    LIVE_CONTEXT_REASONS.has(context?.decision?.reason)
}

async function liveContext({ personId, tenantId, businessId = null, action, db }) {
  const context = await resolveAuthorizationContext({ personId, tenantId, businessId, action, db })
  return isLiveContext(context, personId, tenantId, businessId) ? context : null
}

async function activeBusinessIds(db, personId, tenantId) {
  const memberships = await db.membership.findMany({
    where: { personId, tenantId, status: 'ACTIVE', businessId: { not: null } },
    select: { businessId: true },
  })
  return [...new Set(memberships.map(({ businessId }) => businessId).filter(Boolean))]
}

/**
 * A caller may issue a link token only for their own Person and with live
 * authority through an active Tenant or one of its active Businesses.
 */
export async function canIssueLinkToken({ viewer, tenantId, db = prisma } = {}) {
  const personId = viewerPersonId(viewer)
  if (!personId || !tenantId) return false

  const tenantContext = await liveContext({ personId, tenantId, action: 'WRITE', db })
  if (!tenantContext) return false
  if (authorizeScope(tenantContext, { action: 'WRITE' }).allowed) return true
  if (isInstallationOperator(viewer)) return true

  for (const businessId of await activeBusinessIds(db, personId, tenantId)) {
    const context = await liveContext({ personId, tenantId, businessId, action: 'WRITE', db })
    if (context && authorizeScope(context, { action: 'WRITE' }).allowed) return true
  }

  return false
}

/**
 * A channel binding is visible to its live Person, a live installation
 * operator, a tenant-wide OWNER, or an OWNER of a Business where the bound
 * Person has a direct active Membership.
 */
export async function canReadChannelIdentity({ viewer, tenantId, rowPersonId, db = prisma } = {}) {
  const personId = viewerPersonId(viewer)
  if (!personId || !tenantId || !rowPersonId) return false

  const tenantContext = await liveContext({ personId, tenantId, action: 'READ', db })
  if (!tenantContext) return false
  if (rowPersonId === personId) return true
  if (isInstallationOperator(viewer)) return true
  if (authorizeScope(tenantContext, { action: 'READ', requiredRoles: ['OWNER'] }).allowed) return true

  for (const businessId of await activeBusinessIds(db, personId, tenantId)) {
    const ownerContext = await liveContext({ personId, tenantId, businessId, action: 'READ', db })
    if (!ownerContext || !authorizeScope(ownerContext, { action: 'READ', requiredRoles: ['OWNER'] }).allowed) continue

    const rowContext = await liveContext({ personId: rowPersonId, tenantId, businessId, action: 'READ', db })
    if (rowContext?.memberships?.some((membership) =>
      membership.businessId === businessId && membership.status === 'ACTIVE',
    )) return true
  }

  return false
}

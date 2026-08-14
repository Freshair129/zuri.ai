import prisma from '@/lib/db'
import { resolveLinePrincipal } from '@/modules/identity/gate'

// @req FR-057 — build the server-derived authorization context before private MSP retrieval.
// @spec ADR-022, SDD-030, BR-015, SEC-013 — transport identity is not business authority;
//   model/client/thread values cannot widen the authorized vault set.
// @tested tests/integration/agent-multi-principal.test.js

const DEFAULT_AGENT_ID = 'zuri-line-agent'
const DEFAULT_WORKSPACE_ID = 'default'
const DEFAULT_POLICY_VERSION = 'FR-057.v1'

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function membershipAllowsBusiness(membership, businessId) {
  if (!businessId) return true
  return membership.businessId === null || membership.businessId === businessId
}

function vaultScope({ tenantId, principalId, agentId, workspaceId, projectId }) {
  return {
    scope: 'private',
    tenantId,
    principalId,
    agentId,
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    projectId: projectId ?? null,
    // This is a compatibility scope key. A configured MSP adapter may map the
    // structured scope to its canonical vault_id; Zuri never accepts a vault_id
    // from the request or model.
    scopeKey: [
      `tenant:${tenantId}`,
      `principal:${principalId}`,
      `agent:${agentId}`,
      `workspace:${workspaceId ?? DEFAULT_WORKSPACE_ID}`,
      ...(projectId ? [`project:${projectId}`] : []),
    ].join('/'),
  }
}

/**
 * Resolve identity, membership and private-vault authorization in one turn.
 * `serverScope` is supplied by the trusted runtime seam. It is never populated
 * from the model or from a LINE message body.
 */
export async function resolveAgentAuthorization({
  tenantId,
  businessId = null,
  lineUserId,
  displayName,
  threadId,
  sessionId = null,
  instanceId = null,
  eventId = null,
  capability = 'READ',
  sensitivity = 'PUBLIC',
  consent = 'UNKNOWN',
  serverScope = {},
} = {}) {
  const principal = await resolveLinePrincipal({ tenantId, lineUserId, displayName })
  const memberships = await prisma.membership.findMany({
    where: { tenantId, personId: principal.personId },
    select: { id: true, businessId: true, role: true },
  })

  const customer = principal.customerId
    ? await prisma.customer.findUnique({
        where: { id: principal.customerId },
        select: { id: true, tenantId: true, businessId: true, deletedAt: true },
      })
    : null

  const staffScope = memberships.some((membership) => membershipAllowsBusiness(membership, businessId))
  const customerScope = Boolean(
    customer &&
      customer.tenantId === tenantId &&
      !customer.deletedAt &&
      (!businessId || customer.businessId === null || customer.businessId === businessId),
  )
  const identityVerified = Boolean(principal.verifiedAt && principal.linkedAt)
  const knownPrincipal = principal.principalType !== 'UNKNOWN' && (staffScope || customerScope)
  const transportVerified = serverScope.transportVerified !== false
  const privateMemoryAllowed = transportVerified && identityVerified && knownPrincipal

  const agentId = clean(serverScope.agentId) ?? DEFAULT_AGENT_ID
  const workspaceId = clean(serverScope.workspaceId)
  const projectId = clean(serverScope.projectId)
  const resolvedBusinessId = clean(serverScope.businessId) ?? businessId
  const policyVersion = clean(serverScope.policyVersion) ?? DEFAULT_POLICY_VERSION
  const allowedVaults = privateMemoryAllowed
    ? [vaultScope({
        tenantId,
        principalId: principal.personId,
        agentId,
        workspaceId,
        projectId,
      })]
    : []

  const reason = privateMemoryAllowed
    ? 'ALLOW'
    : !transportVerified
      ? 'TRANSPORT_UNVERIFIED'
      : !identityVerified
      ? 'IDENTITY_PENDING'
      : !knownPrincipal
        ? 'MEMBERSHIP_SCOPE_DENIED'
        : 'PRIVATE_MEMORY_DENIED'

  const authContext = Object.freeze({
    transport: Object.freeze({
      provider: 'LINE',
      signatureVerified: transportVerified,
      bindingId: clean(serverScope.bindingId),
    }),
    actor: Object.freeze({
      principalId: principal.personId,
      externalIdentityId: principal.externalIdentityId,
      principalType: principal.principalType,
      identityVerified,
      roles: [...principal.roles],
    }),
    scope: Object.freeze({
      tenantId,
      businessId: resolvedBusinessId,
      workspaceId,
      projectId,
    }),
    conversation: Object.freeze({
      threadId: clean(threadId),
      sessionId: clean(sessionId),
      instanceId: clean(instanceId),
      eventId: clean(eventId),
    }),
    request: Object.freeze({
      agentId,
      capability: clean(capability) ?? 'READ',
      sensitivity: clean(sensitivity) ?? 'PUBLIC',
      consent: clean(consent) ?? 'UNKNOWN',
    }),
    policy: Object.freeze({
      version: policyVersion,
      decision: privateMemoryAllowed ? 'ALLOW' : 'DENY',
      reason,
      privateMemoryAllowed,
    }),
  })

  return {
    principal,
    authContext,
    authorizedVaults: allowedVaults,
    policy: authContext.policy,
  }
}

export { vaultScope, DEFAULT_AGENT_ID }

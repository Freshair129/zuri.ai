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
  if (!businessId) return membership.businessId === null
  return membership.businessId === null || membership.businessId === businessId
}

async function resolvePersistedScope({ tenantId, businessId, serverScope }) {
  const inputBusinessId = clean(businessId)
  const resolvedBusinessId = clean(serverScope.businessId)
  let workspaceId = clean(serverScope.workspaceId)
  const projectId = clean(serverScope.projectId)

  if (inputBusinessId && inputBusinessId !== resolvedBusinessId) {
    return { authorized: false, reason: 'BUSINESS_SCOPE_MISMATCH', businessId: resolvedBusinessId, workspaceId, projectId }
  }

  if (resolvedBusinessId) {
    const business = await prisma.business.findUnique({ where: { id: resolvedBusinessId } })
    if (!business || business.tenantId !== tenantId || business.status !== 'ACTIVE') {
      return { authorized: false, reason: 'BUSINESS_SCOPE_DENIED', businessId: resolvedBusinessId, workspaceId, projectId }
    }
  }

  let workspace = null
  let project = null
  if (projectId) {
    project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { workspace: true },
    })
    if (!project || project.deletedAt || project.status === 'ARCHIVED' || (workspaceId && project.workspaceId !== workspaceId)) {
      return { authorized: false, reason: 'PROJECT_SCOPE_DENIED', businessId: resolvedBusinessId, workspaceId, projectId }
    }
    workspace = project.workspace
    workspaceId = project.workspaceId
  } else if (workspaceId) {
    workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } })
  }

  if (workspace) {
    const workspaceMatches = workspace.status === 'ACTIVE' && workspace.tenantId === tenantId &&
      (resolvedBusinessId ? workspace.businessId === resolvedBusinessId : workspace.businessId === null)
    if (!workspaceMatches) {
      return { authorized: false, reason: 'WORKSPACE_SCOPE_DENIED', businessId: resolvedBusinessId, workspaceId, projectId }
    }
  } else if (workspaceId) {
    return { authorized: false, reason: 'WORKSPACE_SCOPE_DENIED', businessId: resolvedBusinessId, workspaceId, projectId }
  }

  if (project && project.businessId !== resolvedBusinessId) {
    return { authorized: false, reason: 'PROJECT_SCOPE_DENIED', businessId: resolvedBusinessId, workspaceId, projectId }
  }

  return { authorized: true, reason: null, businessId: resolvedBusinessId, workspaceId, projectId }
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
  const resolvedScope = await resolvePersistedScope({ tenantId, businessId, serverScope })
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

  const staffScope = memberships.some((membership) => membershipAllowsBusiness(membership, resolvedScope.businessId))
  const customerScope = Boolean(
    customer &&
      customer.tenantId === tenantId &&
      !customer.deletedAt &&
      (resolvedScope.businessId ? customer.businessId === null || customer.businessId === resolvedScope.businessId : customer.businessId === null),
  )
  const identityVerified = Boolean(principal.verifiedAt && principal.linkedAt)
  const knownPrincipal = principal.principalType !== 'UNKNOWN' && (staffScope || customerScope)
  const transportVerified = serverScope.transportVerified === true
  const privateMemoryAllowed = transportVerified && identityVerified && resolvedScope.authorized && knownPrincipal

  const agentId = clean(serverScope.agentId) ?? DEFAULT_AGENT_ID
  const workspaceId = resolvedScope.workspaceId
  const projectId = resolvedScope.projectId
  const resolvedBusinessId = resolvedScope.businessId
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
        : !resolvedScope.authorized
          ? resolvedScope.reason
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

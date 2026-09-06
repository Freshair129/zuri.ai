import prisma from '@/lib/db'
import { resolveLinePrincipal } from '@/modules/identity/gate'
import { resolveAuthorizationContext } from '@/modules/identity/authorization-context'
import { channelIdentityIsVerified } from '@/modules/identity/channel-identity'

// @req FR-057, FR-096, FR-098 — build the server-derived authorization context before private MSP retrieval.
// @req FR-097 — private authority requires an ACTIVE ChannelIdentity, not merely a
//   verified legacy ExternalIdentity row.
// @spec ADR-022, ADR-044, ADR-045, SDD-030, SDD-052, BR-015, BR-020, SEC-013, SEC-018 — transport identity is not business authority;
//   model/client/thread values cannot widen the authorized vault set.
// @tested tests/integration/agent-multi-principal.test.js, tests/integration/agent-request-envelope.test.js,
//   tests/unit/agent-requestable-sensitivity.test.js

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

// The levels an agent request may ASK for — a subset of FR-111's knowledge
// sensitivity lattice (KNOWLEDGE_SENSITIVITY_LEVELS, src/lib/validation/enums.js),
// never the lattice itself. One member today, because no entitlement model
// grants a principal a level yet: nothing behind this envelope checks a
// request against what a principal may actually reach. Validated is not
// authorized — this list says what a request may claim, never what it is
// granted; msp-vault-resolver.js and every knowledge reader still decide
// independently, and today they decide PUBLIC regardless of what is asked.
//
// Widening this list is not a vocabulary change; it is a promise that an
// entitlement check now exists behind it. Build that first, then widen this.
// This is an agent-domain policy decision, not a knowledge-domain one, so it
// lives beside the guard that reads it rather than in enums.js next to the
// lattice it restricts.
//
// tests/unit/agent-requestable-sensitivity.test.js pins that this stays a
// subset of the lattice (vocabulary drift — a value here the lattice does
// not have). tests/integration/agent-request-envelope.test.js pins that a
// request above this ceiling is rejected, not silently admitted (height —
// the thing a well-meaning future widening would get wrong).
const AGENT_REQUESTABLE_SENSITIVITY = ['PUBLIC']

// Absent, null or blank floors at the narrowest request, never at null or at
// whatever the caller typed. Present-but-not-requestable throws: a request
// for a level nothing can authorize is refused, not silently downgraded and
// not silently admitted. This is the ONE site handling `sensitivity`, on
// purpose — an earlier version of this function had a second site, a
// parameter default duplicating this same floor, which meant a caller
// passing null skipped the default and reached a bare `?? 'PUBLIC'` that
// validated nothing. Removing the second site removes that hazard
// structurally instead of relying on a test to keep catching it.
function resolveRequestedSensitivity(value) {
  const cleaned = clean(value)
  if (cleaned === null) return 'PUBLIC'
  if (!AGENT_REQUESTABLE_SENSITIVITY.includes(cleaned)) {
    throw new Error(
      `sensitivity "${cleaned}" is not requestable — the agent domain currently authorizes only ${AGENT_REQUESTABLE_SENSITIVITY.join(', ')}`,
    )
  }
  return cleaned
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
  // Request floors. Both defaults cover only the omitted-argument path; a
  // caller that passes null or a blank string lands on the matching fallback
  // in the `request` envelope below. `sensitivity` has no default here — it
  // is resolved (and, unlike these two, validated) by
  // resolveRequestedSensitivity, above.
  capability = 'READ',
  sensitivity,
  consent = 'UNKNOWN',
  serverScope = {},
} = {}) {
  const principal = await resolveLinePrincipal({
    tenantId,
    lineUserId,
    channelAccountId: clean(serverScope.channelAccountId) ?? undefined,
    displayName,
  })
  const resolvedScope = await resolvePersistedScope({ tenantId, businessId, serverScope })
  const authorizationContext = await resolveAuthorizationContext({
    personId: principal.personId,
    tenantId,
    businessId: resolvedScope.businessId,
    action: capability ?? 'READ',
  })
  const memberships = authorizationContext.memberships

  const customer = principal.customerId
    ? await prisma.customer.findUnique({
        where: { id: principal.customerId },
        select: { id: true, tenantId: true, businessId: true, deletedAt: true },
      })
    : null

  const staffScope = authorizationContext.decision.allowed && memberships.some((membership) => membershipAllowsBusiness(membership, resolvedScope.businessId))
  const customerScope = Boolean(
    customer &&
      customer.tenantId === tenantId &&
      !customer.deletedAt &&
      (resolvedScope.businessId ? customer.businessId === null || customer.businessId === resolvedScope.businessId : customer.businessId === null),
  )
  const identityVerified = principal.channelIdentity
    ? channelIdentityIsVerified(principal.channelIdentity)
    : Boolean(principal.verifiedAt && principal.linkedAt)
  const knownPrincipal = principal.principalType !== 'UNKNOWN' && (staffScope || customerScope)
  const transportVerified = serverScope.transportVerified === true
  const privateMemoryAllowed = transportVerified && identityVerified && resolvedScope.authorized && knownPrincipal
  const configuredMspAuthorization = serverScope.mspAuthorization && typeof serverScope.mspAuthorization === 'object'
    ? serverScope.mspAuthorization
    : {}
  const mspAuthorization = Object.freeze({
    membershipActive: privateMemoryAllowed,
    allowed: privateMemoryAllowed,
    allowGlobalPrivate: privateMemoryAllowed && configuredMspAuthorization.allowGlobalPrivate === true,
    allowTenantGlobalPrivate: privateMemoryAllowed && configuredMspAuthorization.allowTenantGlobalPrivate === true,
    allowShared: privateMemoryAllowed && configuredMspAuthorization.allowShared === true,
    read: privateMemoryAllowed && configuredMspAuthorization.read !== false,
    writePrivate: privateMemoryAllowed && configuredMspAuthorization.writePrivate === true,
    writeShared: privateMemoryAllowed && configuredMspAuthorization.writeShared === true,
  })

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
      // Floors, not conveniences. Each of these three is the narrowest thing a turn
      // can assert, so an absent, null or blank argument lands on "asked for the
      // least" instead of on null: READ is the least verb, UNKNOWN asserts no
      // consent, and PUBLIC is the least sensitive level a request may ask to reach
      // — ADR-022 D3/D7 grant for the *requested* capability and sensitivity.
      //
      // `sensitivity` is not a separate vocabulary from FR-111's knowledge lattice —
      // it IS that lattice, restricted to what resolveRequestedSensitivity (above)
      // currently authorizes requesting. `capability` and `consent` only float to
      // their floor on an absent/null/blank argument, taking whatever else is typed;
      // `sensitivity` additionally rejects a value outside AGENT_REQUESTABLE_SENSITIVITY,
      // because unlike those two it has a lattice above PUBLIC that a caller could
      // otherwise ask for with nothing behind the ask to authorize it.
      //
      // agent-request-envelope.test.js exercises both floors (absent/null/blank ->
      // PUBLIC, all three fields) and the sensitivity rejection (a value above the
      // ceiling throws); agent-requestable-sensitivity.test.js pins the ceiling
      // itself as a subset of the lattice.
      agentId,
      capability: clean(capability) ?? 'READ',
      sensitivity: resolveRequestedSensitivity(sensitivity),
      consent: clean(consent) ?? 'UNKNOWN',
    }),
    policy: Object.freeze({
      version: policyVersion,
      decision: privateMemoryAllowed ? 'ALLOW' : 'DENY',
      reason,
      privateMemoryAllowed,
      mspAuthorization,
    }),
    authorization: Object.freeze({
      decision: authorizationContext.decision,
      roles: authorizationContext.roles,
      permissions: authorizationContext.permissions,
    }),
  })

  return {
    principal,
    authContext,
    authorizationContext,
    authorizedVaults: allowedVaults,
    policy: authContext.policy,
  }
}

export { vaultScope, DEFAULT_AGENT_ID, AGENT_REQUESTABLE_SENSITIVITY }

// @req FR-057 — canonical GoVibe/MSP API-010 vault resolution before API-009 memory access.
// @spec ADR-022, SDD-030, SEC-013 — MSP owns opaque vault IDs; Zuri sends only
// server-derived AuthContext and current authorization facts.
// @tested tests/unit/msp-vault-resolver.test.js, tests/integration/msp-vault-memory-port.test.js

const DEFAULT_ACTOR = 'zuri-agent'

function resolveCaller(transport) {
  if (typeof transport === 'function') return (name, input) => transport(name, input)
  if (transport && typeof transport.call === 'function') return (name, input) => transport.call(name, input)
  if (transport && typeof transport.request === 'function') return (name, input) => transport.request(name, input)
  throw new Error('createMspVaultResolver: transport must be callable or expose .call/.request')
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`API-010 requires ${name}`)
  return value.trim()
}

function optional(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function currentScope(authorization) {
  const authContext = authorization?.authContext
  if (!authContext || authContext.policy?.decision !== 'ALLOW' || authContext.policy?.privateMemoryAllowed !== true) {
    throw new Error('API-010 vault resolution requires an ALLOW AuthContext')
  }

  const scope = authContext.scope ?? {}
  const actor = authContext.actor ?? {}
  const request = authContext.request ?? {}
  const conversation = authContext.conversation ?? {}
  const authorizedVaults = authorization.authorizedVaults
  if (!Array.isArray(authorizedVaults) || authorizedVaults.length !== 1) {
    throw new Error('API-010 vault resolution requires exactly one authorized private scope')
  }

  const authorizedScope = authorizedVaults[0]
  const tenantId = required(scope.tenantId, 'tenantId')
  const principalId = required(actor.principalId, 'principalId')
  const agentId = required(request.agentId, 'agentId')
  const workspaceId = required(scope.workspaceId, 'workspaceId')
  const projectId = required(scope.projectId, 'projectId')
  if (
    authorizedScope.scope !== 'private' ||
    authorizedScope.tenantId !== tenantId ||
    authorizedScope.principalId !== principalId ||
    authorizedScope.agentId !== agentId ||
    authorizedScope.workspaceId !== workspaceId ||
    authorizedScope.projectId !== projectId
  ) {
    throw new Error('API-010 authorized scope does not match AuthContext')
  }

  return {
    authContext,
    tenantId,
    businessId: optional(scope.businessId),
    principalId,
    agentId,
    instanceId: optional(conversation.instanceId),
    projectId,
    workspaceId,
    threadId: optional(conversation.threadId),
    sessionId: optional(conversation.sessionId),
    policyVersion: String(authContext.policy.version ?? '1'),
  }
}

function authorizationFacts(authContext, operation) {
  const policy = authContext.policy ?? {}
  const configured = policy.mspAuthorization && typeof policy.mspAuthorization === 'object'
    ? policy.mspAuthorization
    : {}
  const allowed = policy.decision === 'ALLOW' && policy.privateMemoryAllowed === true
  return {
    membership_active: allowed,
    allowed,
    allow_global_private: allowed && configured.allowGlobalPrivate === true,
    allow_tenant_global_private: allowed && configured.allowTenantGlobalPrivate === true,
    allow_shared: allowed && configured.allowShared === true,
    read: allowed && configured.read !== false,
    write_private: allowed && operation === 'write' && configured.writePrivate === true,
    write_shared: allowed && operation === 'write' && configured.writeShared === true,
  }
}

function validateVaultSet(result) {
  const value = result?.structuredContent ?? result
  if (!value || typeof value !== 'object') throw new Error('API-010 returned no vault set')
  if (typeof value.workspacePrivateVaultId !== 'string' || !value.workspacePrivateVaultId.trim()) {
    throw new Error('API-010 response requires workspacePrivateVaultId')
  }
  for (const field of ['globalPrivateVaultIds', 'sharedVaultIds']) {
    if (!Array.isArray(value[field]) || value[field].some((id) => typeof id !== 'string' || !id.trim())) {
      throw new Error(`API-010 response requires ${field} string array`)
    }
  }
  const permissions = value.permissions
  if (!permissions || typeof permissions !== 'object') throw new Error('API-010 response requires permissions')
  for (const field of ['read', 'writePrivate', 'writeShared']) {
    if (typeof permissions[field] !== 'boolean') throw new Error(`API-010 response requires permissions.${field}`)
  }
  if (typeof permissions.policyVersion !== 'string' || !permissions.policyVersion.trim()) {
    throw new Error('API-010 response requires permissions.policyVersion')
  }
  return {
    workspacePrivateVaultId: value.workspacePrivateVaultId,
    globalPrivateVaultIds: [...value.globalPrivateVaultIds],
    sharedVaultIds: [...value.sharedVaultIds],
    permissions: { ...permissions },
  }
}

/**
 * Create the canonical GoVibe/MSP API-010 resolver. The resolver accepts only
 * the immutable AuthContext produced by Zuri's policy seam; it never accepts a
 * vault ID, line user ID, model claim, or client scope value.
 */
export function createMspVaultResolver({ transport, actor = DEFAULT_ACTOR } = {}) {
  const callTool = resolveCaller(transport)
  const canonicalActor = required(actor, 'actor')

  return {
    async resolve(authorization, { operation = 'read' } = {}) {
      if (operation !== 'read' && operation !== 'write') {
        throw new Error('API-010 operation must be read or write')
      }
      const scope = currentScope(authorization)
      const result = await callTool('msp_vault_resolve', {
        actor: canonicalActor,
        access_context: {
          tenant_id: scope.tenantId,
          business_id: scope.businessId,
          principal_id: scope.principalId,
          agent_id: scope.agentId,
          instance_id: scope.instanceId,
          project_id: scope.projectId,
          workspace_id: scope.workspaceId,
          thread_id: scope.threadId,
          session_id: scope.sessionId,
          policy_version: scope.policyVersion,
        },
        authorization: authorizationFacts(scope.authContext, operation),
      })
      const vaultSet = validateVaultSet(result)
      if (operation === 'read' && vaultSet.permissions.read !== true) {
        throw new Error('API-010 denied read permission')
      }
      if (operation === 'write' && vaultSet.permissions.writePrivate !== true) {
        throw new Error('API-010 denied private write permission')
      }
      return vaultSet
    },
  }
}

export { validateVaultSet }

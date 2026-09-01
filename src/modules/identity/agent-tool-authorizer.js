import { resolveAuthorizationContext } from './authorization-context'

// @req FR-094, FR-096, FR-098
// @spec ADR-045, SDD-052, BR-020, SEC-018
// @tested tests/unit/identity/agent-tool-authorizer.test.js

// Tool to specific required permission mapping (null means general active membership is sufficient)
export const TOOL_PERMISSION_MAP = Object.freeze({
  read_project_data: null,
  write_project_data: 'product.work.write',
  query_knowledge: null,
  record_market_observation: null,
  query_market_prices: null,
  send_line_message: null,
  query_customer_profile: 'customer.import.review.read',
})

/**
 * Authorize an agent tool call before execution.
 * Enforces strict fail-closed boundary, prevents tool argument scope-widening,
 * and ensures caller has valid tenant/business membership.
 */
export async function authorizeAgentToolExecution({
  toolName,
  toolArgs = {},
  viewer,
  db,
} = {}) {
  if (!viewer || !viewer.personId || !viewer.tenantId) {
    return {
      allowed: false,
      reason: 'AUTHENTICATION_REQUIRED',
      authorizedArgs: null,
    }
  }

  // 1. Parameter Scope-Widening Prevention (SEC-018)
  if (toolArgs.tenantId && toolArgs.tenantId !== viewer.tenantId) {
    return {
      allowed: false,
      reason: 'CROSS_TENANT_ARGUMENT_FORBIDDEN',
      authorizedArgs: null,
    }
  }

  if (toolArgs.businessId && viewer.businessId && toolArgs.businessId !== viewer.businessId) {
    return {
      allowed: false,
      reason: 'CROSS_BUSINESS_ARGUMENT_FORBIDDEN',
      authorizedArgs: null,
    }
  }

  // 2. Resolve Authorization Context
  const requiredPermission = TOOL_PERMISSION_MAP[toolName] ?? null
  const authContext = await resolveAuthorizationContext({
    personId: viewer.personId,
    tenantId: viewer.tenantId,
    businessId: viewer.businessId || toolArgs.businessId || null,
    permission: requiredPermission,
    action: toolName.includes('write') || toolName.includes('record') || toolName.includes('send') ? 'WRITE' : 'READ',
    db,
  })

  if (!authContext.decision.allowed) {
    return {
      allowed: false,
      reason: authContext.decision.reason,
      authorizedArgs: null,
    }
  }

  // 3. Bind Trusted Scope to Output Arguments
  const authorizedArgs = {
    ...toolArgs,
    tenantId: viewer.tenantId,
    businessId: viewer.businessId || null,
    authorizedByPersonId: viewer.personId,
  }

  return {
    allowed: true,
    reason: 'AUTHORIZED',
    authorizedArgs,
    scope: authContext.scope,
  }
}

import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { resolveLinePrincipal } from '@/modules/identity/gate'
import { authorizeScope, resolveAuthorizationContext } from '@/modules/identity/authorization-context'
import { zExecuteAgentActionInput } from '@/lib/validation/entities'
import { consumeStepUp } from './step-up'
import { defaultWriteTools } from './write-tools'

// @req FR-026, FR-096, FR-098 — the Gate F write/action gate: the single place a resolved principal is
//   authorized to run a write, step-up is enforced for sensitive ones, and the write is
//   executed transactionally with an append-only audit.
// @spec ADR-007 §P7 / ADR-045 / Gate E→F — a read-only agent is safe early; a writing agent is not
//   until authorization + audit + step-up are proven. This gate proves all three.
// @spec BR-009, SDD-009 — every write goes through one disciplined path (authorize →
//   single transaction → audit), never a second ad-hoc write path.
// @tested tests/integration/agent-action-gate.test.js

/**
 * Decide whether a principal may run a write action. Pure (no I/O).
 * Rules: UNKNOWN ⇒ deny. Staff with a permitted Membership role ⇒ allow. Otherwise a
 * customer who owns the target resource (ownerCheck) ⇒ allow. HIGH sensitivity ⇒ the
 * caller must additionally present a step-up token.
 *
 * @returns {{ allowed: boolean, reason: string, requiresStepUp: boolean }}
 */
export function authorizeAgentAction({ principal, action, policyDecision = null }) {
  const requiresStepUp = action.sensitivity === 'HIGH'

  if (!principal || principal.principalType === 'UNKNOWN') {
    return { allowed: false, reason: 'unresolved or unknown principal', requiresStepUp }
  }
  if (policyDecision && policyDecision.allowed !== true) {
    return { allowed: false, reason: policyDecision.reason || 'authorization policy denied', requiresStepUp }
  }

  const roleAllowed =
    principal.isStaff &&
    Array.isArray(action.allowRoles) &&
    principal.roles.some((r) => action.allowRoles.includes(r))
  if (roleAllowed) {
    return { allowed: true, reason: 'staff role permitted', requiresStepUp }
  }

  if (typeof action.ownerCheck === 'function' && action.ownerCheck(principal, action.target ?? {})) {
    return { allowed: true, reason: 'principal owns the target resource', requiresStepUp }
  }

  return { allowed: false, reason: 'principal lacks a permitting role and does not own the target', requiresStepUp }
}

async function resolveActionBusinessId(tenantId, target = {}) {
  if (typeof target.businessId === 'string' && target.businessId.trim()) return target.businessId.trim()

  if (typeof target.conversationId === 'string' && target.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: target.conversationId, tenantId },
      select: { businessId: true },
    })
    return conversation?.businessId ?? null
  }

  if (typeof target.customerId === 'string' && target.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: target.customerId, tenantId, deletedAt: null },
      select: { businessId: true },
    })
    return customer?.businessId ?? null
  }

  return null
}

/**
 * Resolve a LINE subject to a principal, authorize a write action, enforce step-up for
 * HIGH-sensitivity actions, then run the write in ONE transaction with an audit event.
 *
 * @returns {{ executed: true, action: string, principalId: string, steppedUp: boolean, result: any }}
 */
export async function executeAgentAction(input, { registry } = {}) {
  const { tenantId, lineUserId, actionName, target, payload, stepUpToken } = zExecuteAgentActionInput.parse(input)

  const reg = registry ?? defaultWriteTools()
  const action = reg.get(actionName)
  if (!action) throw new Error(`unknown write action: ${actionName}`)

  const principal = await resolveLinePrincipal({ tenantId, lineUserId })
  const businessId = await resolveActionBusinessId(tenantId, target)
  const ownerPersonId = typeof action.ownerCheck === 'function' && action.ownerCheck(principal, target)
    ? principal.personId
    : null
  const authorizationContext = await resolveAuthorizationContext({
    personId: principal.personId,
    tenantId,
    businessId,
    action: 'WRITE',
    ownerPersonId,
  })
  const policyDecision = authorizeScope(authorizationContext, {
    action: 'WRITE',
    businessId,
    requiredRoles: action.allowRoles,
    ownerPersonId,
  })

  const decision = authorizeAgentAction({
    principal,
    action: { ...action, target },
    policyDecision,
  })
  if (!decision.allowed) {
    // Record the denial too — an attempted write is security-relevant (SEC-003).
    await recordAudit(prisma, {
      entityType: 'AGENT_ACTION',
      entityId: actionName,
      action: 'DENIED',
      actorType: 'AGENT',
      payload: { tenantId, principalId: principal.personId, businessId, reason: decision.reason },
    })
    throw new Error(`AGENT_ACTION_DENIED: ${decision.reason}`)
  }

  const result = await prisma.$transaction(async (tx) => {
    if (decision.requiresStepUp) {
      // Atomic with the write: a failed action rolls the step-up consumption back.
      await consumeStepUp(tx, { tenantId, personId: principal.personId, token: stepUpToken })
    }
    const out = await action.execute({ tx, tenantId, principal, target, payload })
    await recordAudit(tx, {
      entityType: 'AGENT_ACTION',
      entityId: actionName,
      action: 'EXECUTED',
      actorType: 'AGENT',
      payload: {
        tenantId,
        principalId: principal.personId,
        businessId,
        sensitivity: action.sensitivity,
        steppedUp: decision.requiresStepUp,
        target,
      },
    })
    return out
  })

  return {
    executed: true,
    action: actionName,
    principalId: principal.personId,
    steppedUp: decision.requiresStepUp,
    result,
  }
}

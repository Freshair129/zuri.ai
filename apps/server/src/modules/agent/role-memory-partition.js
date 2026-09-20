// @req TASK-ZAI-008 — Role-scoped memory partition and retrieval policy.
// @spec SPR-ZAI-03, GATE-ZAI-05, ADR-043 §D2 — Role-scoped memory partition and retrieval policy;
//   private role memory partitions are isolated; shared business partition accessible across roles;
//   cross-role private read returns empty and is audited.
// @tested tests/unit/role-memory-partition.test.js

import { CORE_AGENT_ROLES, ROLE_SPECIFICATIONS } from './role-registry'

export const ROLE_MEMORY_AUDIT_ENTITY = 'AGENT_ROLE_MEMORY'

export const ROLE_MEMORY_ACTIONS = Object.freeze({
  CROSS_PARTITION_DENIED: 'ROLE_MEMORY_CROSS_PARTITION_DENIED',
  RETRIEVAL_DENIED: 'ROLE_MEMORY_RETRIEVAL_DENIED',
  PRIVATE_REMEMBER: 'ROLE_MEMORY_PRIVATE_REMEMBER',
  SHARED_REMEMBER: 'ROLE_MEMORY_SHARED_REMEMBER',
})

/**
 * Build the canonical private role partition key.
 * Format: `tenant:${tenantId}/business:${businessId}/role:${roleId}/private:${principalId}`
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.businessId
 * @param {string} params.roleId
 * @param {string} [params.principalId]
 * @returns {string}
 */
export function buildRoleMemoryKey({ tenantId, businessId, roleId, principalId = 'default' }) {
  if (!tenantId) throw new Error('buildRoleMemoryKey: tenantId is required')
  if (!businessId) throw new Error('buildRoleMemoryKey: businessId is required')
  if (!roleId) throw new Error('buildRoleMemoryKey: roleId is required')
  return `tenant:${tenantId}/business:${businessId}/role:${roleId}/private:${principalId}`
}

/**
 * Build the canonical shared business partition key.
 * Format: `tenant:${tenantId}/business:${businessId}/shared:${topic}`
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.businessId
 * @param {string} [params.topic]
 * @returns {string}
 */
export function buildSharedBusinessMemoryKey({ tenantId, businessId, topic = 'general' }) {
  if (!tenantId) throw new Error('buildSharedBusinessMemoryKey: tenantId is required')
  if (!businessId) throw new Error('buildSharedBusinessMemoryKey: businessId is required')
  return `tenant:${tenantId}/business:${businessId}/shared:${topic}`
}

/**
 * Create a role-scoped memory port.
 *
 * Success / Acceptance criteria:
 * 1. Two roles in the same Business writing to private partitions have strictly isolated reads.
 * 2. Reading a shared Business partition returns identical governed content to both roles.
 * 3. Cross-role private partition read attempts return empty entries and record
 *    ROLE_MEMORY_CROSS_PARTITION_DENIED in the audit stream.
 *
 * @param {object} options
 * @param {object} options.baseMemoryPort - Memory port implementing recall/remember
 * @param {string} options.roleId - Current agent role (must be one of CORE_AGENT_ROLES)
 * @param {string} options.tenantId - Tenant isolation boundary
 * @param {string} options.businessId - Operating business isolation boundary
 * @param {string} [options.principalId] - Classified actor principal ID
 * @param {Function} [options.onAudit] - Optional audit callback (for telemetry or testing)
 * @param {object} [options.db] - Optional Prisma client or transaction client
 */
export function createRoleScopedMemoryPort({
  baseMemoryPort,
  roleId,
  tenantId,
  businessId,
  principalId = 'default',
  onAudit = null,
  db = null,
}) {
  if (!baseMemoryPort || typeof baseMemoryPort.recall !== 'function' || typeof baseMemoryPort.remember !== 'function') {
    throw new Error('createRoleScopedMemoryPort requires a valid baseMemoryPort with recall and remember')
  }
  const spec = ROLE_SPECIFICATIONS[roleId]
  if (!spec) {
    throw new Error(`UNKNOWN_AGENT_ROLE: Role "${roleId}" is not a registered core role`)
  }
  if (!tenantId || !businessId) {
    throw new Error('createRoleScopedMemoryPort requires tenantId and businessId')
  }

  const privateKey = buildRoleMemoryKey({ tenantId, businessId, roleId, principalId })

  async function emitAudit({ action, targetRoleId, reason, payload = {} }) {
    const auditRecord = {
      entityType: ROLE_MEMORY_AUDIT_ENTITY,
      entityId: privateKey,
      action,
      tenantId,
      businessId,
      actorType: 'AGENT_ROLE',
      actorId: roleId,
      reason,
      payload: {
        callingRole: roleId,
        targetRole: targetRoleId,
        principalId,
        ...payload,
      },
    }

    if (typeof onAudit === 'function') {
      try {
        await onAudit(auditRecord)
      } catch {
        // Safe audit callback absorption
      }
    }

    if (db && typeof db.auditEvent?.create === 'function') {
      try {
        await db.auditEvent.create({
          data: {
            entityType: auditRecord.entityType,
            entityId: auditRecord.entityId,
            action: auditRecord.action,
            tenantId: auditRecord.tenantId,
            businessId: auditRecord.businessId,
            actorType: auditRecord.actorType,
            actorId: auditRecord.actorId,
            reason: auditRecord.reason,
            payloadJson: JSON.stringify(auditRecord.payload),
          },
        })
      } catch {
        // Safe database audit persistence absorption
      }
    }

    return auditRecord
  }

  return {
    roleId,
    tenantId,
    businessId,
    principalId,
    privateKey,

    /**
     * Remember into this role's private partition.
     */
    async rememberPrivate(entry) {
      return baseMemoryPort.remember(privateKey, entry)
    },

    /**
     * Recall this role's private partition.
     */
    async recallPrivate() {
      return baseMemoryPort.recall(privateKey)
    },

    /**
     * Remember into the shared business partition.
     */
    async rememberShared(topic = 'general', entry) {
      const sharedKey = buildSharedBusinessMemoryKey({ tenantId, businessId, topic })
      return baseMemoryPort.remember(sharedKey, entry)
    },

    /**
     * Recall from the shared business partition.
     */
    async recallShared(topic = 'general') {
      const sharedKey = buildSharedBusinessMemoryKey({ tenantId, businessId, topic })
      return baseMemoryPort.recall(sharedKey)
    },

    /**
     * Attempt to recall another role's private partition.
     * Exit Criterion: Given npm test, when the partition suite runs,
     * then a cross-role read returns empty and is audited.
     */
    async recallOtherRolePrivate(targetRoleId, targetPrincipalId = principalId) {
      if (!targetRoleId || targetRoleId === roleId) {
        return this.recallPrivate()
      }

      const targetKey = buildRoleMemoryKey({
        tenantId,
        businessId,
        roleId: targetRoleId,
        principalId: targetPrincipalId,
      })

      // Emit audit of cross-partition denial
      await emitAudit({
        action: ROLE_MEMORY_ACTIONS.CROSS_PARTITION_DENIED,
        targetRoleId,
        reason: `Access to private memory partition of role "${targetRoleId}" denied for role "${roleId}"`,
        payload: { attemptedKey: targetKey },
      })

      // Strict return: empty entries, never leak cross-role private facts
      return {
        key: targetKey,
        entries: [],
        denied: true,
        reason: 'CROSS_ROLE_PRIVATE_PARTITION_REFUSED',
      }
    },
  }
}

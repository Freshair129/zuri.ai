// @req FR-026 — the WRITE-tool registry, kept deliberately separate from the Gate E
//   read-only registry: a write tool can never leak into the read-only surface, and a
//   write tool is reachable ONLY through the action gate (authorize + step-up + audit).
// @spec ADR-007 §P7 / Gate F — until Gate F the agent may NOT refund / cancel / update
//   customer / create payment / modify order. Each write descriptor declares its
//   sensitivity and who may run it; the gate enforces them.
// @tested tests/integration/agent-action-gate.test.js

/**
 * @typedef {Object} WriteActionDescriptor
 * @property {string} name
 * @property {'WRITE'} effect               always WRITE (register() enforces).
 * @property {'LOW'|'HIGH'} sensitivity     HIGH ⇒ the gate demands a step-up token.
 * @property {string[]} [allowRoles]        Membership roles permitted to run it (staff side).
 * @property {(principal: object, target: object) => boolean} [ownerCheck]  customer-side:
 *   true when the principal owns the target resource (e.g. their own customer record).
 * @property {string} [description]
 * @property {(ctx: { tx: any, tenantId: string, principal: object, target: object, payload: object }) => Promise<any>} execute
 */

const STAFF_WRITE_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF']

export function createWriteToolRegistry() {
  const tools = new Map()
  return {
    register(descriptor) {
      if (!descriptor || typeof descriptor.name !== 'string' || !descriptor.name) {
        throw new Error('write action requires a name')
      }
      if (descriptor.effect !== 'WRITE') {
        throw new Error(`"${descriptor.name}" is not a WRITE action — read tools belong in the Gate E registry`)
      }
      if (typeof descriptor.execute !== 'function') {
        throw new Error(`write action "${descriptor.name}" requires an execute() function`)
      }
      if (descriptor.sensitivity !== 'LOW' && descriptor.sensitivity !== 'HIGH') {
        throw new Error(`write action "${descriptor.name}" requires sensitivity LOW|HIGH`)
      }
      tools.set(descriptor.name, descriptor)
      return descriptor
    },
    get(name) {
      return tools.get(name)
    },
    list() {
      return [...tools.values()].map((t) => ({
        name: t.name,
        sensitivity: t.sensitivity,
        description: t.description ?? '',
      }))
    },
  }
}

/**
 * The default write actions Gate F ships. LOW ones are staff CRM edits over existing
 * models; the customer-owned one demonstrates ownership authorization; the HIGH ones
 * demand step-up. `refund_order` is declared but has no executor — the order/payment
 * domain is not in this slice — so it proves the gate (authz + step-up) without
 * fabricating a financial write.
 */
export function defaultWriteTools() {
  const reg = createWriteToolRegistry()

  reg.register({
    name: 'close_conversation',
    effect: 'WRITE',
    sensitivity: 'LOW',
    allowRoles: STAFF_WRITE_ROLES,
    description: 'Close a conversation thread (staff).',
    async execute({ tx, tenantId, target }) {
      const convo = await tx.conversation.findFirst({ where: { id: target.conversationId, tenantId } })
      if (!convo) throw new Error('close_conversation: conversation not found in tenant')
      return tx.conversation.update({ where: { id: convo.id }, data: { status: 'CLOSED' } })
    },
  })

  reg.register({
    name: 'set_customer_lifecycle',
    effect: 'WRITE',
    sensitivity: 'LOW',
    allowRoles: STAFF_WRITE_ROLES,
    description: 'Set a customer lifecycle stage (staff).',
    async execute({ tx, tenantId, target, payload }) {
      const cust = await tx.customer.findFirst({ where: { id: target.customerId, tenantId, deletedAt: null } })
      if (!cust) throw new Error('set_customer_lifecycle: customer not found in tenant')
      return tx.customer.update({ where: { id: cust.id }, data: { lifecycleStage: payload.lifecycleStage } })
    },
  })

  reg.register({
    name: 'update_own_display_name',
    effect: 'WRITE',
    sensitivity: 'LOW',
    allowRoles: STAFF_WRITE_ROLES,
    // Customer-side: a customer may edit their OWN record (ownership authorization).
    ownerCheck: (principal, target) => Boolean(principal.customerId) && principal.customerId === target.customerId,
    description: 'Update a customer display name (own record, or staff).',
    async execute({ tx, tenantId, target, payload }) {
      const cust = await tx.customer.findFirst({ where: { id: target.customerId, tenantId, deletedAt: null } })
      if (!cust) throw new Error('update_own_display_name: customer not found in tenant')
      return tx.customer.update({ where: { id: cust.id }, data: { displayName: payload.displayName } })
    },
  })

  reg.register({
    name: 'deactivate_customer',
    effect: 'WRITE',
    sensitivity: 'HIGH', // ⇒ requires step-up
    allowRoles: STAFF_WRITE_ROLES,
    description: 'Deactivate (soft-delete) a customer — sensitive, requires step-up.',
    async execute({ tx, tenantId, target }) {
      const cust = await tx.customer.findFirst({ where: { id: target.customerId, tenantId, deletedAt: null } })
      if (!cust) throw new Error('deactivate_customer: customer not found in tenant')
      return tx.customer.update({ where: { id: cust.id }, data: { deletedAt: new Date(), lifecycleStage: 'LOST' } })
    },
  })

  reg.register({
    name: 'refund_order',
    effect: 'WRITE',
    sensitivity: 'HIGH',
    allowRoles: STAFF_WRITE_ROLES,
    description: 'Refund an order — sensitive; order/payment domain not in this slice.',
    async execute() {
      throw new Error('NOT_IMPLEMENTED: order/payment domain is not in the Zuri backend slice yet (Gate F proven, executor absent)')
    },
  })

  return reg
}

export { STAFF_WRITE_ROLES }

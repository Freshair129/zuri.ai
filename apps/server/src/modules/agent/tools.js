import prisma from '@/lib/db'
import { queryKnowledge } from '@/modules/knowledge'
import { authorizeScope } from '@/modules/identity/authorization-context'

// @req FR-025, FR-096, FR-098 — the read-only tool registry the agent binds to at Gate E: search /
//   read / recommend / answer only. No write tool can be registered until Gate F.
// @spec ADR-007 §P6 / ADR-045 / Gate E — until Gate F the agent may NOT refund / cancel /
//   update customer / create payment / modify order. `register` enforces this at the
//   seam: a descriptor whose readOnly !== true is rejected outright.
// @tested tests/integration/agent-tools.test.js

/**
 * @typedef {Object} ToolDescriptor
 * @property {string} name
 * @property {boolean} readOnly   MUST be true at Gate E; register() throws otherwise.
 * @property {string} [description]
 * @property {(args: object) => Promise<any>} [handler]  optional; reads only, no writes.
 *
 * @typedef {Object} ToolRegistry
 * @property {(descriptor: ToolDescriptor) => ToolDescriptor} register
 * @property {(name: string) => ToolDescriptor | undefined} get
 * @property {() => Array<{ name: string, description: string }>} list  read-only view:
 *   name + description only (handlers are never exposed to the model).
 */

/**
 * Create an empty read-only tool registry. `register` is the Gate E enforcement point:
 * it refuses any descriptor that is not explicitly read-only.
 * @returns {ToolRegistry}
 */
export function createToolRegistry() {
  const tools = new Map()
  return {
    register(descriptor) {
      if (!descriptor || typeof descriptor.name !== 'string' || !descriptor.name) {
        throw new Error('tool descriptor requires a name')
      }
      if (descriptor.readOnly !== true) {
        throw new Error(
          `Gate E forbids write tools: "${descriptor.name}" must be readOnly:true (write tools land at Gate F)`,
        )
      }
      tools.set(descriptor.name, descriptor)
      return descriptor
    },
    get(name) {
      return tools.get(name)
    },
    list() {
      return [...tools.values()].map((t) => ({ name: t.name, description: t.description ?? '' }))
    },
  }
}

/**
 * A registry pre-loaded with the three Gate E read-only tools. Handlers read via prisma
 * / queryKnowledge and never write; they are intentionally thin stubs — runtime wiring
 * (ADR-007 P6) binds the agent to these, it does not add behaviour here.
 * @returns {ToolRegistry}
 */
function requireToolAuthorization(authorization, customerId = null) {
  const context = authorization?.authorizationContext
  if (!context) throw new Error('TOOL_AUTHORIZATION_REQUIRED')

  const principalCustomerId = authorization.principal?.customerId
  const ownerPersonId = customerId && principalCustomerId === customerId
    ? context.actor?.personId
    : null
  const decision = authorizeScope(context, {
    action: 'READ',
    businessId: context.scope?.businessId,
    ownerPersonId,
  })
  if (!decision.allowed) throw new Error(`TOOL_AUTHORIZATION_DENIED: ${decision.reason}`)

  return {
    tenantId: context.scope.tenantId,
    businessId: context.scope.businessId,
    principalId: context.actor.personId,
  }
}

function scopedBusinessFilter(businessId) {
  return businessId
    ? { OR: [{ businessId: null }, { businessId }] }
    : undefined
}

export function defaultReadOnlyTools({ authorization } = {}) {
  const registry = createToolRegistry()

  registry.register({
    name: 'answer_from_knowledge',
    readOnly: true,
    description: 'Answer using the GKS knowledge graph for a principal (read-only).',
    async handler() {
      const scope = requireToolAuthorization(authorization)
      return queryKnowledge({
        tenantId: scope.tenantId,
        businessId: scope.businessId,
        principalId: scope.principalId,
      })
    },
  })

  registry.register({
    name: 'read_customer_profile',
    readOnly: true,
    description: 'Read a customer profile within the tenant (read-only).',
    async handler({ customerId }) {
      if (!customerId) return null
      const scope = requireToolAuthorization(authorization, customerId)
      return prisma.customer.findFirst({
        where: {
          id: customerId,
          tenantId: scope.tenantId,
          ...scopedBusinessFilter(scope.businessId),
        },
      })
    },
  })

  registry.register({
    name: 'search_conversations',
    readOnly: true,
    description: 'Search the customer\'s conversations within the tenant (read-only).',
    async handler({ customerId }) {
      if (!customerId) return []
      const scope = requireToolAuthorization(authorization, customerId)
      return prisma.conversation.findMany({
        where: {
          tenantId: scope.tenantId,
          customerId,
          ...scopedBusinessFilter(scope.businessId),
        },
      })
    },
  })

  return registry
}

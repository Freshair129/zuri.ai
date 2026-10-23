import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { createConversationRuntimeRouteHandlers } from '../../v1/[operation]/route'

// @req FR-291 — v2 adds the fixed PRODUCT_FACTS prepare turn while preserving
//   v1's strict accepted turn set and every existing Core operation shape.
// @spec ADR-106, SDD-110 — the v2 route shares Core authority and changes only
//   the explicitly selected wire contract version.
// @tested tests/integration/conversation-runtime-product-facts.test.js
export const dynamic = 'force-dynamic'

const handlers = createConversationRuntimeRouteHandlers(createConversationRuntimeCore(), {
  contractVersion: 'conversation-runtime.v2',
})

export function createConversationRuntimeV2RouteHandlers(core = createConversationRuntimeCore()) {
  return createConversationRuntimeRouteHandlers(core, { contractVersion: 'conversation-runtime.v2' })
}

export const GET = handlers.GET
export const POST = handlers.POST

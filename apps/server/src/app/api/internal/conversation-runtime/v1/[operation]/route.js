import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'

// @req FR-149 — private, versioned Conversation Runtime adapter.
// @spec ADR-106 D2-D4, SDD-110 — no public identity/scope input.
// @tested tests/integration/conversation-runtime-vertical-slice.test.js
export const dynamic = 'force-dynamic'

export function createConversationRuntimeRouteHandlers(core = createConversationRuntimeCore(), { contractVersion = 'conversation-runtime.v1' } = {}) {
  return Object.freeze({
    async GET(request, { params }) {
      const { operation } = await params
      if (operation !== 'health') return new Response(null, { status: 404 })
      return core.handle(request, { health: true, contractVersion })
    },
    async POST(request, { params }) {
      const { operation } = await params
      return core.handle(request, { operation, contractVersion })
    },
  })
}

const handlers = createConversationRuntimeRouteHandlers()
export const GET = handlers.GET
export const POST = handlers.POST

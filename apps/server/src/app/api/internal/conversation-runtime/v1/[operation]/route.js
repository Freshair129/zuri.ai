import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'

// @req FR-149 — private, versioned Conversation Runtime adapter.
// @spec ADR-106 D2-D4, SDD-108 — no public identity/scope input.
// @tested tests/integration/conversation-runtime-vertical-slice.test.js
export const dynamic = 'force-dynamic'

export function createConversationRuntimeRouteHandlers(core = createConversationRuntimeCore()) {
  return Object.freeze({
    async GET(request, { params }) {
      const { operation } = await params
      if (operation !== 'health') return new Response(null, { status: 404 })
      return core.handle(request, { health: true })
    },
    async POST(request, { params }) {
      const { operation } = await params
      return core.handle(request, { operation })
    },
  })
}

const handlers = createConversationRuntimeRouteHandlers()
export const GET = handlers.GET
export const POST = handlers.POST

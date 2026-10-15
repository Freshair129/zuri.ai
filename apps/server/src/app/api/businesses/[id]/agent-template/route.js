// @req FR-285 — preview and explicitly apply the standard v1 template to one
// existing Business. Identity and authority always come from the server.
import { z } from 'zod'
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  applyBusinessAgentTemplate,
  previewBusinessAgentTemplate,
  refuseUnsupportedBusinessAgentOperation,
} from '@/modules/agent/business-agent-factory'

export const dynamic = 'force-dynamic'

const emptyBody = z.object({}).strict()

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return previewBusinessAgentTemplate(params.id, { viewer })
  })
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    emptyBody.parse(await request.json())
    return applyBusinessAgentTemplate(params.id, { viewer })
  })
}

export async function PATCH() {
  return handle(async () => refuseUnsupportedBusinessAgentOperation('CUSTOMIZE'))
}

export async function PUT() {
  return handle(async () => refuseUnsupportedBusinessAgentOperation('UPGRADE'))
}

export async function DELETE() {
  return handle(async () => refuseUnsupportedBusinessAgentOperation('ROLLBACK'))
}

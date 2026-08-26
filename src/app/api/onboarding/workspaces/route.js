import { z } from 'zod'
import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createOnboardingWorkspace } from '@/modules/identity/onboarding-service'

// @req FR-066 — the owner path: create a top-level Workspace (schema
// Portfolio, ADR-027 §D2) with the caller as its OWNER WorkspaceMembership.
// Requires a completed Profile first (AC-066.1) and creates zero
// Organization/Tenant/Business/Space/Project rows (AC-066.2).
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js

export const dynamic = 'force-dynamic'

const zWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(200),
}).strict()

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = zWorkspaceBody.parse(await request.json().catch(() => ({})))
    return createOnboardingWorkspace({ personId: viewer.principal.id, name: body.name })
  })
}

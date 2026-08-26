import { z } from 'zod'
import { handle } from '@/app/api/_helpers'
import { zWorkspaceInviteRole } from '@/lib/validation/enums'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { mintWorkspaceInvite } from '@/modules/identity/workspace-membership-service'

// @req FR-067 — an authorized Workspace/Tenant owner mints a scoped, expiring,
// single-use invite. The raw token appears exactly once, in this authenticated
// response, for out-of-band handover; only its SHA-256 digest is stored. The
// role enum excludes OWNER — a token can never mint ownership (AC-067.6).
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js

export const dynamic = 'force-dynamic'

const zInviteBody = z.object({
  portfolioId: z.string().min(1),
  role: zWorkspaceInviteRole.optional(),
  targetPersonId: z.string().min(1).optional(),
  invitedEmail: z.string().trim().email().max(320).optional(),
}).strict()

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = zInviteBody.parse(await request.json().catch(() => ({})))
    return mintWorkspaceInvite({
      viewer,
      portfolioId: body.portfolioId,
      role: body.role ?? 'MEMBER',
      targetPersonId: body.targetPersonId ?? null,
      invitedEmail: body.invitedEmail ?? null,
    })
  })
}

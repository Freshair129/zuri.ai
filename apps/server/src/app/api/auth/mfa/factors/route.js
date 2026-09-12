// @req FR-094, FR-095 — List and revoke registered MFA factors
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/integration/mfa-totp-lifecycle.test.js

import { handle, httpError } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listMfaFactors, revokeMfaFactor } from '@/modules/identity/mfa-service'

export const dynamic = 'force-dynamic'

export async function GET(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const personId = viewer?.personId ?? viewer?.principal?.id
    if (!personId) throw httpError(401, 'AUTHENTICATION_REQUIRED')

    const factors = await listMfaFactors({ personId })
    return { factors }
  })
}

export async function DELETE(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const personId = viewer?.personId ?? viewer?.principal?.id
    if (!personId) throw httpError(401, 'AUTHENTICATION_REQUIRED')

    const body = await request.json().catch(() => ({}))
    const factorId = body.factorId
    if (!factorId) throw httpError(400, 'factorId is required')

    return await revokeMfaFactor({ personId, factorId })
  })
}

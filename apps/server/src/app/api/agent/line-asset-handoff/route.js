// @req FR-140 — trusted zuri-cli LINE binding hands opaque FileAsset IDs to Asset intake.
// @spec SDD-084, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import { handle } from '@/app/api/_helpers'
import { createPhase1BusinessAgentPortsFromEnv, resolvePhase1RequestScope } from '@/modules/agent'
import { zLineAssetHandoff, lineAssetHandoffToEnvelope } from '@/modules/asset-management/import/line-asset-handoff'
import { upsertAssetIntake } from '@/modules/asset-management/application/asset-intake-service'

export const dynamic = 'force-dynamic'

export function createLineAssetHandoffPost({ runtimeFactory = createPhase1BusinessAgentPortsFromEnv } = {}) {
  return async function lineAssetHandoffPost(request) {
    return handle(async () => {
      const body = zLineAssetHandoff.parse(await request.json())
      const runtime = await runtimeFactory()
      const scope = await resolvePhase1RequestScope({ runtime, headers: request.headers, body })
      if (!scope.businessId) {
        const error = new Error('LINE binding has no Business scope')
        error.status = 404
        throw error
      }
      const viewer = {
        principal: null,
        visibleBusinessIds: [scope.businessId],
        ownedBusinessIds: [],
        permissionsByBusinessId: { [scope.businessId]: ['asset.intake.write'] },
      }
      const envelope = lineAssetHandoffToEnvelope(body, scope.businessId)
      const result = await upsertAssetIntake(envelope, { viewer })
      return { bindingId: scope.id || scope.bindingId || null, businessId: scope.businessId, ...result }
    })
  }
}

export const POST = createLineAssetHandoffPost()

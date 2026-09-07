import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createMspTransportFromEnvironment } from '@/modules/agent/msp-stdio-transport'
import { pullKnowledgeStageEvidence } from '@/platform/integrations/core/knowledge-evidence-importer'

// @req FR-110 — one operator-triggered tick of the evidence pull: zuri-ai →
//   MSP → gks_stage_evidence_export, applied through the reporter receiver,
//   cursor advanced per scope only after the page's writes committed.
// @spec ADR-068 D1-D4, ADR-050 D3
// @tested tests/integration/fr110-knowledge-evidence-importer.test.js, tests/integration/openapi-docs.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    // Identity before configuration: an unauthenticated caller learns that it
    // is unauthenticated, not whether this deployment has an MSP.
    const viewer = await resolveRequestViewer(request)
    const transport = createMspTransportFromEnvironment(process.env)
    if (!transport) throw httpError(503, 'MSP transport is not configured (ZURI_MSP_COMMAND)')
    return pullKnowledgeStageEvidence(await request.json(), { viewer, transport })
  })
}

// @req FR-260 — installation-operator-only Mission Control read projection.
// @req FR-261 — PORL is read-only and missing records remain UNKNOWN/NOT_RUN.
// @req FR-262 — DAG gate projection is computed without scheduler or mutation
// behavior.
// @req FR-263 — this protected route is separate from the member /roadmap
// projection and never feeds its payload.
// @spec ADR-048 D1-D3, ADR-086 D1/D7, ADR-092 D3, SDD-008
// @tested tests/unit/mission-control-route-contract.test.js, tests/e2e/fr260-mission-control.spec.js

import MissionControlBoard from '@/modules/platform-control/mission-control/components/MissionControlBoard'
import { createProgrammeOrchestrationRunLedgerAdapter } from '@/modules/platform-control/mission-control/application/programme-orchestration-run-ledger'
import { buildMissionControlReadModel } from '@/modules/platform-control/mission-control/application/mission-control-read-model'
import { ROADMAP_TASK_LEDGER } from '@/modules/platform-control/roadmap-sot'

export const metadata = { title: 'Mission Control — Zuri Control' }
export const dynamic = 'force-dynamic'

export default async function MissionControlPage() {
  // The parent (control) layout runs PlatformControlGuard before this page is
  // evaluated. No PORL read is started for a denied viewer.
  const adapter = createProgrammeOrchestrationRunLedgerAdapter()
  const porlResult = await adapter.listObservations(ROADMAP_TASK_LEDGER.map((task) => task.id))
  const model = buildMissionControlReadModel({ porlResult })
  return <MissionControlBoard model={model} />
}

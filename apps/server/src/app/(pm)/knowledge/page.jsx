// @req FR-214 — the Knowledge (GKS) slot's Dashboard, under the same server-side
//   admission as the map it opens.
// @spec ADR-085 D1, D4
// @tested tests/unit/knowledge-data-pipeline-map-ui.test.js
import KnowledgeDashboard from '@/modules/knowledge/pipeline-map/KnowledgeDashboard'
import { requirePipelineMapViewer } from '@/modules/knowledge/pipeline-map/pipeline-map-access'
import { getDataPipelineMap } from '@/modules/knowledge/pipeline-map/pipeline-map-read-model'

export const metadata = { title: 'Knowledge (GKS)' }

export default async function KnowledgeDashboardPage() {
  await requirePipelineMapViewer()
  return <KnowledgeDashboard map={getDataPipelineMap()} />
}

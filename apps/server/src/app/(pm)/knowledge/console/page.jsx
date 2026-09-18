// @req FR-254 — authorized source, run, corpus and citation console.
// @spec ADR-072, ADR-085, SEC-008
// @tested tests/e2e/fr254-knowledge-console.spec.js
import KnowledgeConsole from '@/modules/knowledge/console/KnowledgeConsole'
import { requirePipelineMapViewer } from '@/modules/knowledge/pipeline-map/pipeline-map-access'

export const metadata = { title: 'Knowledge console' }

export default async function KnowledgeConsolePage() {
  await requirePipelineMapViewer()
  return <KnowledgeConsole />
}

'use client'

// @req FR-012 — the UI intake surface for PlanEnvelope import: paste/upload
// → validate → seven-mode semantic check → dry run → single transactional
// commit → audit. Also carries FR-018's xlsx→envelope path via the embedded
// upload flow.
// @spec BR-009 — one intake pipeline for every surface (UI/Excel/agent/API)
// @tested tests/e2e/smoke.spec.js
import { useParams } from 'next/navigation'
import PlanImportPanel from '@/modules/project-manager/views/PlanImportPanel'

export default function ProjectImportPage() {
  const { projectId } = useParams()
  return <PlanImportPanel projectId={projectId} />
}

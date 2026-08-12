'use client'

import { useParams } from 'next/navigation'
import PlanImportPanel from '@/modules/project-manager/views/PlanImportPanel'

export default function ProjectImportPage() {
  const { projectId } = useParams()
  return <PlanImportPanel projectId={projectId} />
}

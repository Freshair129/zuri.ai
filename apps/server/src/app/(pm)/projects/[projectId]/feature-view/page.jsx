'use client'

import { useParams } from 'next/navigation'
import ProjectFeatureView from '@/modules/project-manager/components/ProjectFeatureView'

// @req FR-252 — an authorized Project reader reaches the read-only Feature
// authority through one Project-local Delivery Design route.
// @spec ADR-097, SDD-019
// @tested tests/e2e/project-feature-view.spec.js

export default function ProjectFeatureViewPage() {
  const { projectId } = useParams()
  return <ProjectFeatureView key={projectId} projectId={projectId} />
}

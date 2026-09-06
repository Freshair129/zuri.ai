'use client'

// @req FR-007 — the cross-project Dependencies register: create/list/delete
// over the 5 dependency types, distinct from the project-local Dependency Map
// (FR-040).
// @tested tests/e2e/smoke.spec.js
import { PageHeader } from '@/components/ui'
import DependenciesView from '@/modules/project-manager/views/universal/DependenciesView'

export default function GlobalDependenciesPage() {
  return (
    <div>
      <PageHeader eyebrow="Business scope" title="Dependencies" subtitle="Blocking and ordering relations across the selected Business." />
      <DependenciesView />
    </div>
  )
}

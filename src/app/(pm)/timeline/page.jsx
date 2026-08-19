'use client'

// @req FR-064 — the global Schedule view: a derived month-grid Gantt over all
// in-scope Projects' startAt→targetAt windows and Milestones' targetAt dates,
// read-only, mirroring the FR-009 global/project-scoped split.
// @spec SDD-036
// @tested tests/e2e/smoke.spec.js
import { PageHeader } from '@/components/ui'
import TimelineView from '@/modules/project-manager/views/universal/TimelineView'

export default function GlobalTimelinePage() {
  return (
    <div>
      {/* Titled Schedule, not Timeline: it is the same FR-064 view the project
          Work tab calls Schedule, and one view must carry one name at both
          scopes. The `/timeline` path is a route key and stays. */}
      <PageHeader eyebrow="All projects" title="Schedule" subtitle="Project windows and milestone targets across all projects." />
      <TimelineView />
    </div>
  )
}

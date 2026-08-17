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
      <PageHeader eyebrow="Universal view" title="Timeline" subtitle="Project windows and milestone targets across the portfolio." />
      <TimelineView />
    </div>
  )
}

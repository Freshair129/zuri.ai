'use client'

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

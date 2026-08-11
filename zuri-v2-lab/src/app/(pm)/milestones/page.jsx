'use client'

import { PageHeader } from '@/components/ui'
import MilestonesView from '@/modules/project-manager/views/universal/MilestonesView'

export default function GlobalMilestonesPage() {
  return (
    <div>
      <PageHeader eyebrow="Universal view" title="Milestones & Gates" subtitle="Checkpoints and gates across all projects." />
      <MilestonesView />
    </div>
  )
}

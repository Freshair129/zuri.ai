// @req FR-247 — the operator error list, projected server-side so the client
//   never re-fetches on first paint.
// @spec ADR-095 D1, ADR-048 D1-D2
// @tested tests/unit/error-events-view.test.js

import prisma from '@/lib/db'
import { PageHeader } from '@/components/ui'
import { listErrorEvents } from '@/modules/platform-control/application/error-events'
import ErrorEventsView from '@/modules/platform-control/components/ErrorEventsView'

export const metadata = { title: 'Error Events — Zuri Control' }
export const dynamic = 'force-dynamic'

export default async function PlatformErrorEventsPage() {
  const events = await listErrorEvents(prisma)
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PLATFORM PROGRAMME · OPERATOR ONLY"
        title="Error events"
        subtitle="Deduplicated by fingerprint. Never request/response content — names, messages and parsed stack frames only (ADR-095 D1)."
      />
      <ErrorEventsView initialEvents={events} />
    </div>
  )
}

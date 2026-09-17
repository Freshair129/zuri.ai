// @req FR-248, FR-249 — the operator usage breakdown, projected server-side.
// @spec ADR-095 D2, ADR-048 D1-D2
// @tested tests/unit/usage-events-view.test.js

import prisma from '@/lib/db'
import { PageHeader } from '@/components/ui'
import { listUsageBreakdown } from '@/modules/platform-control/application/usage-events'
import UsageBreakdownView from '@/modules/platform-control/components/UsageBreakdownView'

export const metadata = { title: 'Usage — Zuri Control' }
export const dynamic = 'force-dynamic'

export default async function PlatformUsagePage() {
  const [pageViews, actions] = await Promise.all([
    listUsageBreakdown(prisma, { kind: 'PAGE_VIEW' }),
    listUsageBreakdown(prisma, { kind: 'ACTION' }),
  ])
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PLATFORM PROGRAMME · OPERATOR ONLY"
        title="Feature usage"
        subtitle="Route and action counts, per person for the last 90 days, aggregate beyond that (ADR-095 D2, D3)."
      />
      <UsageBreakdownView initialBreakdown={{ pageViews, actions }} />
    </div>
  )
}

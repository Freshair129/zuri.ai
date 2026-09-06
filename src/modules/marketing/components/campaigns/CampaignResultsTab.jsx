'use client'

// @req FR-160 — Campaign Results never turns planning intent, PM completion or
// budget into an observed Marketing measurement.
// @spec SDD-087 — Wave 2 source readers are required before metrics are shown.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import { Card, SectionTitle } from '@/components/ui'
import { UnavailableState } from '../MarketingState'

export default function CampaignResultsTab({ campaign }) {
  const results = campaign?.results
  return (
    <div data-testid="marketing-campaign-results">
      <UnavailableState title="Campaign results are unavailable" hint="No approved provider or manual measurement source is connected in this slice. Budget and PM work completion are planning and execution facts, not observed Marketing results." />
      <Card className="mt-4">
        <SectionTitle caption="The source contract will preserve definition, coverage and quality before a value is shown">Measurement status</SectionTitle>
        <dl className="grid gap-3 text-xs sm:grid-cols-2"><div><dt className="text-[10px] text-muted">Source</dt><dd className="mt-1 font-semibold">{results?.sources?.length ? 'Scoped source evidence' : 'No approved source'}</dd></div><div><dt className="text-[10px] text-muted">Measurement window</dt><dd className="mt-1 font-semibold">{results?.measurementWindow || 'Unavailable'}</dd></div><div className="sm:col-span-2"><dt className="text-[10px] text-muted">Reason</dt><dd className="mt-1 text-muted">{results?.reasonCode || 'NO_APPROVED_SOURCE'}</dd></div></dl>
      </Card>
    </div>
  )
}

'use client'

// @req FR-160 — Campaign collection is rooted in the active Business shell.
// @spec SDD-087, SEC-001 — a URL never grants access to another Business.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import { useScope } from '@/context/ScopeContext'
import CampaignCollection from '@/modules/marketing/components/campaigns/CampaignCollection'

export default function MarketingCampaignsPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  return <CampaignCollection key={businessId || 'no-business'} businessId={businessId} />
}

'use client'

// @req FR-156 — Campaign creation and revision use the existing immutable
// Strategy form with the required calendar, offer and conditions extension.
// @spec SDD-087 — no mock defaults and no second campaign form schema.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import { PlanForm } from '../PlanForm'

export default function CampaignForm({ plan, onSubmit, onCancel, busy = false }) {
  return <PlanForm plan={plan} mode="campaign" titleLabel="Campaign name" submitLabel={plan ? 'Save campaign revision' : 'Save campaign'} onSubmit={onSubmit} onCancel={onCancel} busy={busy} />
}

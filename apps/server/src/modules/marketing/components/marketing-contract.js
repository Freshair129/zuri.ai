// @req FR-159 — Marketing Strategy uses one explicit, immutable revision
// contract for forms, review controls, and URL state.
// @req FR-158 — the handoff UI binds the selected revision to the PM preview.
// @spec SDD-086 — the browser treats planning intent as distinct from measured
// KPI evidence and leaves authorization decisions to the API.
// @tested tests/unit/marketing-strategy-ui.test.js

export const GROWTH_PLANS_PATH = '/api/growth/plans'

export const STRATEGY_TABS = [
  { key: 'situation', label: 'Situation' },
  { key: 'objectives', label: 'Objectives' },
  { key: 'plans', label: 'Plans' },
  { key: 'scenarios', label: 'Scenarios' },
]

export const CAMPAIGN_TABS = [
  { key: 'brief', label: 'Brief' },
  { key: 'plan', label: 'Plan' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'results', label: 'Results' },
  { key: 'decisions', label: 'Decisions' },
]

export const PLAN_CHANNELS = [
  { value: 'META_ADS', label: 'Meta Ads' },
  { value: 'TIKTOK_ADS', label: 'TikTok Ads' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'GA4', label: 'Google Analytics 4' },
  { value: 'SEO', label: 'SEO' },
]

export function growthPlansPath(businessId) {
  return `${GROWTH_PLANS_PATH}?businessId=${encodeURIComponent(businessId || '')}`
}

export function growthPlanPath(planId, businessId) {
  return `${GROWTH_PLANS_PATH}/${encodeURIComponent(planId)}?businessId=${encodeURIComponent(businessId || '')}`
}

export const GROWTH_CAMPAIGNS_PATH = '/api/growth/campaigns'

export function growthCampaignsPath(businessId) {
  return `${GROWTH_CAMPAIGNS_PATH}?businessId=${encodeURIComponent(businessId || '')}`
}

export function growthCampaignPath(initiativeId, businessId) {
  return `${GROWTH_CAMPAIGNS_PATH}/${encodeURIComponent(initiativeId)}?businessId=${encodeURIComponent(businessId || '')}`
}

export function growthCampaignPagePath(initiativeId, tab = 'brief') {
  return `/growth/campaigns/${encodeURIComponent(initiativeId)}?tab=${encodeURIComponent(tab)}`
}

export function campaignTabHref(pathname, tab, initiativeId) {
  const params = new URLSearchParams()
  params.set('tab', tab)
  if (initiativeId) params.set('initiative', initiativeId)
  return `${pathname}?${params.toString()}`
}

export function handoffPath(planId) {
  return `${GROWTH_PLANS_PATH}/${encodeURIComponent(planId)}/handoff`
}

export function strategyTabHref(pathname, tab, { planId, newPlan = false } = {}) {
  const params = new URLSearchParams()
  params.set('tab', tab)
  if (planId) params.set('plan', planId)
  if (newPlan) params.set('new', '1')
  return `${pathname}?${params.toString()}`
}

export function emptyPlanPayload() {
  return {
    objective: '',
    situation: '',
    audience: '',
    channels: [],
    budget: 0,
    currency: 'THB',
    successMetric: '',
    actions: [{ title: '' }],
  }
}

export function emptyCampaignBrief() {
  return { startDate: '', endDate: '', offer: '', conditions: '' }
}

export function normalizeCampaignBrief(value = {}) {
  return {
    startDate: String(value.startDate || ''),
    endDate: String(value.endDate || ''),
    offer: String(value.offer || ''),
    conditions: String(value.conditions || ''),
  }
}

export function normalizePlanPayload(payload = {}) {
  const fallback = emptyPlanPayload()
  const channels = Array.isArray(payload.channels) ? [...new Set(payload.channels.filter(Boolean))] : []
  const actions = Array.isArray(payload.actions)
    ? payload.actions.map((action) => ({ title: String(action?.title || '') }))
    : fallback.actions
  const normalized = {
    objective: String(payload.objective || ''),
    situation: String(payload.situation || ''),
    audience: String(payload.audience || ''),
    channels,
    budget: payload.budget === '' || payload.budget === null || payload.budget === undefined ? 0 : Number(payload.budget),
    currency: String(payload.currency || fallback.currency).toUpperCase(),
    successMetric: String(payload.successMetric || ''),
    actions: actions.length ? actions : fallback.actions,
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'campaignBrief')) {
    normalized.campaignBrief = normalizeCampaignBrief(payload.campaignBrief)
  }
  return normalized
}

export function validatePlanPayload(payload, title = '', options = {}) {
  const value = normalizePlanPayload(payload)
  const errors = []
  if (!String(title).trim()) errors.push('Give this plan a title.')
  if (!value.objective.trim()) errors.push('Describe the objective.')
  if (!value.situation.trim()) errors.push('Describe the situation.')
  if (!value.audience.trim()) errors.push('Describe the audience.')
  if (!value.channels.length) errors.push('Choose at least one channel.')
  if (!Number.isFinite(value.budget) || value.budget < 0) errors.push('Budget must be zero or more.')
  if (!/^[A-Z]{3}$/.test(value.currency)) errors.push('Currency must be a three-letter code.')
  if (!value.successMetric.trim()) errors.push('Describe the success metric intent.')
  if (!value.actions.length || value.actions.some((action) => !action.title.trim())) {
    errors.push('Every action needs a title.')
  }
  if (options.campaignBriefRequired || value.campaignBrief) {
    const brief = value.campaignBrief || emptyCampaignBrief()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(brief.startDate)) errors.push('Start date must use YYYY-MM-DD.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(brief.endDate)) errors.push('End date must use YYYY-MM-DD.')
    if (/^\d{4}-\d{2}-\d{2}$/.test(brief.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(brief.endDate) && brief.endDate < brief.startDate) {
      errors.push('End date must be on or after the start date.')
    }
    if (!brief.offer.trim()) errors.push('Describe the offer.')
    if (!brief.conditions.trim()) errors.push('Describe the campaign conditions.')
  }
  return errors
}

export function currentPlanVersion(plan) {
  if (plan?.currentVersion) return plan.currentVersion
  return [...(plan?.versions || [])].sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0))[0] || null
}

export function latestPassReview(plan, version = currentPlanVersion(plan)) {
  if (!version) return null
  const latest = (plan?.reviews || [])
    .filter((review) => review.planVersionId === version.id && review.payloadHash === version.payloadHash)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null
  return latest?.verdict === 'PASS' ? latest : null
}

export function isFutureExpiry(expiresAt, now = new Date()) {
  if (!expiresAt) return false
  const expiry = new Date(expiresAt).getTime()
  return Number.isFinite(expiry) && expiry > new Date(now).getTime()
}

export function canReviewPlan(plan, viewerId) {
  const version = currentPlanVersion(plan)
  return Boolean(version?.id && viewerId && version.createdBy && version.createdBy !== viewerId)
}

export function approvalState(plan, now = new Date()) {
  const version = currentPlanVersion(plan)
  const review = latestPassReview(plan, version)
  const decision = (plan?.decisions || [])
    .filter((item) => item.planVersionId === version?.id && item.payloadHash === version?.payloadHash)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null
  const approved = decision?.verdict === 'APPROVE' && isFutureExpiry(decision.expiresAt, now)
  return {
    approved,
    review,
    decision,
    canApprove: Boolean(version?.id && review && isFutureExpiry(decision?.expiresAt, now) === false),
  }
}

export function diffPlanPayload(before = {}, after = {}) {
  const left = normalizePlanPayload(before)
  const right = normalizePlanPayload(after)
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
}

export function formatMarketingDate(value) {
  if (!value) return 'Unknown date'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown date'
}

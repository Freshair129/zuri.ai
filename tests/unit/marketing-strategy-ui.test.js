// @req FR-159 — Strategy URL state, payload validation, immutable versions,
// and independent review controls are covered by executable unit assertions.
// @req FR-158 — PM handoff body, same-Business Workspace filtering, and KPI
// guardrails are covered by source and contract assertions.
// @spec SDD-086
// @tested tests/unit/marketing-strategy-ui.test.js

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  STRATEGY_TABS,
  approvalState,
  canReviewPlan,
  diffPlanPayload,
  emptyPlanPayload,
  normalizePlanPayload,
  strategyTabHref,
  validatePlanPayload,
} from '@/modules/marketing/components/marketing-contract'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const workspace = read('src/modules/marketing/components/StrategyWorkspace.jsx')
const strategyRoute = read('src/app/(pm)/growth/strategy/page.jsx')
const handoff = read('src/modules/marketing/components/PlanHandoff.jsx')
const reviewDecision = read('src/modules/marketing/components/PlanReviewDecision.jsx')
const dashboard = read('src/modules/marketing/components/MarketingDashboard.jsx')
const tabs = read('src/modules/marketing/components/MarketingTabs.jsx')

const validPayload = {
  ...emptyPlanPayload(),
  objective: 'Increase qualified enquiries',
  situation: 'The current audience is not reaching the offer page.',
  audience: 'Thai SME owners',
  channels: ['META_ADS', 'SEO'],
  budget: 12000,
  successMetric: 'Qualified enquiries observed in PM KPI records',
  actions: [{ title: 'Publish campaign landing page' }],
}

describe('FR-159 Marketing Strategy UI contracts', () => {
  it('keeps the approved four URL-addressable sections in order', () => {
    expect(STRATEGY_TABS.map((item) => item.key)).toEqual(['situation', 'objectives', 'plans', 'scenarios'])
    expect(strategyTabHref('/growth/strategy', 'plans', { planId: 'plan-1' })).toBe('/growth/strategy?tab=plans&plan=plan-1')
    expect(strategyTabHref('/growth/strategy', 'plans', { newPlan: true })).toBe('/growth/strategy?tab=plans&new=1')
  })

  it('validates the strict form payload without manufacturing KPI observations', () => {
    expect(validatePlanPayload(validPayload, 'Launch plan')).toEqual([])
    expect(validatePlanPayload({ ...validPayload, channels: [] }, 'Launch plan')).toContain('Choose at least one channel.')
    expect(validatePlanPayload({ ...validPayload, budget: -1 }, 'Launch plan')).toContain('Budget must be zero or more.')
    expect(validatePlanPayload({ ...validPayload, currency: 'baht' }, 'Launch plan')).toContain('Currency must be a three-letter code.')
    expect(validatePlanPayload({ ...validPayload, actions: [{ title: '' }] }, 'Launch plan')).toContain('Every action needs a title.')
    expect(normalizePlanPayload({ ...validPayload, channels: ['SEO', 'SEO'] }).channels).toEqual(['SEO'])
    expect(normalizePlanPayload(validPayload)).not.toHaveProperty('kpiTarget')
    expect(normalizePlanPayload(validPayload)).not.toHaveProperty('observations')
  })

  it('reports only fields that changed between immutable revisions', () => {
    expect(diffPlanPayload(validPayload, { ...validPayload, audience: 'Retail founders' })).toEqual(['audience'])
    expect(diffPlanPayload(validPayload, validPayload)).toEqual([])
  })

  it('requires another real user for review and an exact PASS review plus future expiry for approval', () => {
    const plan = {
      version: 3,
      currentVersion: { id: 'v2', createdBy: 'author', payloadHash: 'hash-2', payload: validPayload },
      versions: [{ id: 'v2', revision: 2, createdBy: 'author', payloadHash: 'hash-2', payload: validPayload }],
      reviews: [{ id: 'r1', planVersionId: 'v2', payloadHash: 'hash-2', verdict: 'PASS', createdAt: '2026-09-06T00:00:00.000Z' }],
      decisions: [],
    }
    expect(canReviewPlan(plan, 'author')).toBe(false)
    expect(canReviewPlan(plan, 'reviewer')).toBe(true)
    expect(approvalState(plan, new Date('2026-09-06T01:00:00.000Z')).approved).toBe(false)
    const approved = { ...plan, decisions: [{ planVersionId: 'v2', payloadHash: 'hash-2', verdict: 'APPROVE', expiresAt: '2026-09-07T00:00:00.000Z', createdAt: '2026-09-06T00:30:00.000Z' }] }
    expect(approvalState(approved, new Date('2026-09-06T01:00:00.000Z')).approved).toBe(true)
    const staleHash = { ...approved, decisions: [{ ...approved.decisions[0], payloadHash: 'other-hash' }] }
    expect(approvalState(staleHash, new Date('2026-09-06T01:00:00.000Z')).approved).toBe(false)
    const changesRequiredAfterPass = { ...approved, reviews: [...plan.reviews, { id: 'r2', planVersionId: 'v2', payloadHash: 'hash-2', verdict: 'CHANGES_REQUIRED', createdAt: '2026-09-06T01:30:00.000Z' }] }
    expect(approvalState(changesRequiredAfterPass, new Date('2026-09-06T01:00:00.000Z')).review).toBe(null)
  })
})

describe('FR-159/FR-158 Marketing UI integration seams', () => {
  it('keys Strategy reads by the shell Business and preserves plan state in the URL', () => {
    expect(strategyRoute).toContain('scope.shell.activeBusinessId')
    expect(workspace).toContain('useSearchParams()')
    expect(strategyRoute).toContain("key={businessId || 'no-business'}")
    expect(workspace).toContain('expectedVersion: plan.version')
    expect(workspace).toContain("action: 'revise'")
    expect(workspace).toContain("action: 'review'")
    expect(workspace).toContain("action: 'decide'")
    expect(workspace).toContain("action: 'archive'")
    expect(workspace).toContain('const loadedPlan = detail.data?.plan || detail.data || null')
    expect(workspace).toContain('loadedPlan?.id === planId')
    expect(workspace).toContain('key={`review-${plan.id}`}')
    expect(workspace).toContain('planCanWrite')
    expect(workspace).toContain('TruncationNotice')
    expect(workspace).toContain('Situation')
    expect(workspace).toContain('Objectives')
    expect(workspace).toContain('Scenarios')
  })

  it('keeps the PM handoff same-Business and binds preview to commit hash/version', () => {
    expect(handoff).toContain('workspace.businessId === businessId')
    expect(handoff).toContain("action: 'preview'")
    expect(handoff).toContain("action: 'commit'")
    expect(handoff).toContain('expectedVersion: plan.version')
    expect(handoff).toContain('previewHash: preview.previewHash')
    expect(handoff).toContain('preview.envelope')
    expect(handoff).toContain('ChangeGroup')
    expect(handoff).toContain('Open PM Project')
    expect(handoff).toContain('KPI progress needs PM metric targets and observations')
    expect(handoff).toContain('action completion alone does not indicate Marketing success')
    expect(handoff).toContain('const pmPreview = pmState?.preview')
    expect(handoff).toContain('marketing-handoff-history')
    expect(handoff).toContain('PM preview and commit require Business owner access')
    expect(handoff).not.toContain('successMetric')
    expect(reviewDecision).toContain('canWrite = false')
    expect(reviewDecision).toContain("plan.status !== 'ARCHIVED'")
  })

  it('keeps dashboard numbers grounded in plan records and calls provider metrics unavailable', () => {
    expect(dashboard).toContain('Array.isArray(data?.plans)')
    expect(dashboard).toContain('Provider metrics are unavailable')
    expect(dashboard).toContain('TruncationNotice')
    expect(dashboard).not.toContain('impressions')
    expect(dashboard).not.toContain('conversionRate')
  })

  it('keeps raw scope ids and hashes out of primary Marketing copy', () => {
    expect(workspace).not.toContain('Plan list is scoped to Business {businessId}')
    expect(handoff).toContain('Technical preview details')
    expect(handoff).toContain('Technical receipt details')
  })

  it('uses one accessible tab bar with keyboard navigation and no nested tabs', () => {
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toContain('aria-selected={active}')
    expect(tabs).toContain("['ArrowRight', 'ArrowLeft', 'Home', 'End']")
    expect(tabs).not.toContain('role="tabpanel"')
  })
})

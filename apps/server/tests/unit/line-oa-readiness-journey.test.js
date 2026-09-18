import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { lineOaReadinessJourney } from '@/modules/line-oa-studio/domain/line-oa-readiness-journey'
import LineOaReadinessJourney from '@/modules/line-oa-studio/ui/LineOaReadinessJourney'
// @req FR-225, FR-227, FR-228, FR-150, FR-235 — never promote saved choices or provider probe to end-to-end readiness.
// @spec ADR-089, ADR-090, ADR-061
const account = { id: 'oa-id', tenantId: 'tenant', businessId: 'business', integrationConnectionId: 'connection',
  status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD', executionMode: 'EDGE', modelAccess: 'LOCAL_ONLY', knowledgeGrounding: 'GKS_CORPUS',
  health: { connection: { status: 'ACTIVE', secretConfigured: true, lastValidatedAt: '2026-09-17T00:00:00Z' },
    webhook: { active: true, lastTestStatusCode: 200, lastTestAt: '2026-09-17T00:00:00Z', endpoint: 'https://example.test/api/line-oa/accounts/oa-id/webhook' } } }
describe('LINE OA readiness journey', () => {
  it('resumes from persisted evidence with eight distinct steps; probe/live transport never imply qualified inference', () => {
    const result = lineOaReadinessJourney({ account, credentials: [{ status: 'ACTIVE', businessId: 'business' }] })
    expect(result.steps).toHaveLength(8)
    expect(result.completed).toBe(4)
    expect(result.qualified).toBe(false)
    expect(result.steps.find(step => step.id === 'runtime').status).toBe('NOT_RUN')
    expect(result.steps.find(step => step.id === 'test').status).toBe('NOT_RUN')
    expect(result.steps.find(step => step.id === 'knowledge').status).toBe('CONFIGURED')
    expect(result.steps.find(step => step.id === 'activate').status).toBe('ACTIVE_UNQUALIFIED')
  })
  it('does not count foreign/revoked Edge credentials and refuses inactive or different webhook evidence', () => {
    const result = lineOaReadinessJourney({ account: { ...account, health: { ...account.health,
      webhook: { ...account.health.webhook, endpoint: 'https://example.test/api/line-oa/accounts/other/webhook' } } },
      credentials: [{ status: 'ACTIVE', businessId: 'other' }, { status: 'REVOKED', businessId: 'business' }] })
    expect(result.pairedCount).toBe(0)
    expect(result.steps.find(step => step.id === 'webhook').status).toBe('ACTION_REQUIRED')
  })
  it('renders the exact model, return navigation and untested qualification without secret material', () => {
    const html = renderToStaticMarkup(createElement(LineOaReadinessJourney, { account: { ...account, channelAccessToken: 'never-render-secret' } }))
    expect(html).toContain('qwen3.5:9b')
    expect(html).toContain('Q4_K_M')
    expect(html).toContain('NOT_RUN')
    expect(html).toContain('ย้อนกลับ')
    expect(html).toContain('ขั้นตอนถัดไป')
    expect(html).not.toContain('never-render-secret')
    expect(html).not.toContain('ครบทุกจุดแล้ว')
  })
})

import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { lineOaReadinessJourney } from '@/modules/line-oa-studio/domain/line-oa-readiness-journey'
import LineOaReadinessJourney from '@/modules/line-oa-studio/ui/LineOaReadinessJourney'
// @req FR-225, FR-227, FR-228, FR-235 — never promote saved choices or a provider probe to end-to-end readiness.
// @req FR-265, FR-266 — step 5 was "pick Edge / Local only, and count paired devices".
//   ADR-100 D1 retires that choice; the step is now the model provider API key, and
//   it reads the credential's own evidence rather than a saved selection.
// @spec ADR-089, ADR-090, ADR-061, ADR-100
const account = { id: 'oa-id', tenantId: 'tenant', businessId: 'business', integrationConnectionId: 'connection',
  status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD', knowledgeGrounding: 'GKS_CORPUS',
  health: { connection: { status: 'ACTIVE', secretConfigured: true, lastValidatedAt: '2026-09-17T00:00:00Z' },
    webhook: { active: true, lastTestStatusCode: 200, lastTestAt: '2026-09-17T00:00:00Z', endpoint: 'https://example.test/api/line-oa/accounts/oa-id/webhook' } } }
const validatedKey = { provider: 'anthropic', status: 'ACTIVE', lastValidatedAt: '2026-09-21T00:00:00Z' }

describe('LINE OA readiness journey', () => {
  it('resumes from persisted evidence with eight distinct steps; probe/live transport never imply qualified inference', () => {
    const result = lineOaReadinessJourney({ account, modelCredential: validatedKey })
    expect(result.steps).toHaveLength(8)
    // business, prepare, credentials, webhook and now model-key — the fifth step
    // is completable from evidence, where "pick Edge" never was.
    expect(result.completed).toBe(5)
    expect(result.qualified).toBe(false)
    expect(result.steps.find(step => step.id === 'model-key').status).toBe('COMPLETE')
    expect(result.steps.find(step => step.id === 'test').status).toBe('NOT_RUN')
    expect(result.steps.find(step => step.id === 'knowledge').status).toBe('CONFIGURED')
    expect(result.steps.find(step => step.id === 'activate').status).toBe('ACTIVE_UNQUALIFIED')
  })

  it('refuses a stored-but-unproven key and an inactive or different webhook as evidence', () => {
    const result = lineOaReadinessJourney({
      account: { ...account, health: { ...account.health,
        webhook: { ...account.health.webhook, endpoint: 'https://example.test/api/line-oa/accounts/other/webhook' } } },
      // Stored, never validated: it cannot answer a customer, so it is not readiness.
      modelCredential: { provider: 'anthropic', status: 'ACTIVE', lastValidatedAt: null },
    })
    expect(result.modelKeyReady).toBe(false)
    expect(result.steps.find(step => step.id === 'model-key').status).toBe('ACTION_REQUIRED')
    expect(result.steps.find(step => step.id === 'webhook').status).toBe('ACTION_REQUIRED')
  })

  it('refuses a revoked key, however recently it last validated', () => {
    const result = lineOaReadinessJourney({ account, modelCredential: { ...validatedKey, status: 'REVOKED' } })
    expect(result.modelKeyReady).toBe(false)
  })

  it('renders the return navigation and untested qualification without secret material', () => {
    const html = renderToStaticMarkup(createElement(LineOaReadinessJourney, {
      account: { ...account, channelAccessToken: 'never-render-secret' },
      modelCredential: validatedKey,
    }))
    expect(html).toContain('NOT_RUN')
    expect(html).toContain('ย้อนกลับ')
    expect(html).toContain('ขั้นตอนถัดไป')
    expect(html).not.toContain('never-render-secret')
    expect(html).not.toContain('ครบทุกจุดแล้ว')
    // FR-265 — the retired local-model promise is gone from the journey.
    expect(html).not.toContain('qwen3.5:9b')
    expect(html).not.toContain('Q4_K_M')
  })
})

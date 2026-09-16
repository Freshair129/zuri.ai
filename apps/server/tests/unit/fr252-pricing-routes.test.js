// @req FR-253 — pricing HTTP handlers preserve trusted viewer and structured refusals.
// @spec ADR-098; SEC-001
// @tested tests/unit/fr252-pricing-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/commerce/application/pricing-rules-service', () => ({ listPricingRules: vi.fn(), createPricingRuleSet: vi.fn(), updatePricingRuleSet: vi.fn(), applyPricingRuleAction: vi.fn(), previewPricingRules: vi.fn(), calculatePricing: vi.fn() }))
vi.mock('@/modules/commerce/application/pricing-catalog-service', () => ({ admitPricingCatalog: vi.fn() }))
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import * as service from '@/modules/commerce/application/pricing-rules-service'
import { GET, POST } from '@/app/api/commerce/pricing-rules/route'
import { PATCH } from '@/app/api/commerce/pricing-rules/[id]/route'
import { POST as action } from '@/app/api/commerce/pricing-rules/[id]/actions/route'
import { POST as preview } from '@/app/api/commerce/pricing-rules/preview/route'
import { POST as calculate } from '@/app/api/commerce/pricing-rules/calculate/route'
import { POST as catalog } from '@/app/api/commerce/pricing-rules/catalog/route'
import { admitPricingCatalog } from '@/modules/commerce/application/pricing-catalog-service'

const viewer = makeViewer({ visibleBusinessIds: ['b-pricing'], ownedBusinessIds: ['b-pricing'], visibleDomains: ['commerce'] })
const request = (body, method = 'POST') => new Request('http://localhost/api/commerce/pricing-rules?businessId=b-pricing', { method, ...(method === 'GET' ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })

describe('FR-253 pricing HTTP boundary', () => {
  beforeEach(() => { vi.resetAllMocks(); resolveRequestViewer.mockResolvedValue(viewer) })

  it('resolves the trusted viewer for private rule collection reads', async () => {
    service.listPricingRules.mockResolvedValue({ rules: [], canManage: true })
    const response = await GET(request(null, 'GET'))
    expect(response.status).toBe(200)
    expect(service.listPricingRules).toHaveBeenCalledWith({ businessId: 'b-pricing' }, { viewer })
  })

  it.each([
    ['create', POST, 'createPricingRuleSet', false],
    ['edit', PATCH, 'updatePricingRuleSet', true],
    ['activate', action, 'applyPricingRuleAction', true],
    ['preview', preview, 'previewPricingRules', false],
    ['calculate', calculate, 'calculatePricing', false],
  ])('%s forwards a body as data while resolving authorization separately', async (_name, handler, serviceName, hasId) => {
    const body = { businessId: 'b-pricing', name: 'A policy', viewer: { role: 'OWNER' } }
    service[serviceName].mockResolvedValue({ id: 'rule-one' })
    const response = await handler(request(body), { params: { id: 'rule-one' } })
    expect(response.status).toBe(200)
    expect(service[serviceName]).toHaveBeenCalledWith(...(hasId ? ['rule-one', body, { viewer }] : [body, { viewer }]))
    expect(resolveRequestViewer).toHaveBeenCalledTimes(1)
  })

  it('maps scope refusal to 404 and formula details to a usable 422', async () => {
    service.listPricingRules.mockRejectedValue(Object.assign(new Error('Business not found'), { status: 404 }))
    expect((await GET(request(null, 'GET'))).status).toBe(404)
    const details = [{ field: 'formulas.price', code: 'INVALID_PRICING_FORMULA', message: 'Unknown variable' }]
    service.previewPricingRules.mockRejectedValue(Object.assign(new Error('Invalid pricing formula'), { status: 422, details }))
    const response = await preview(request({}))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Invalid pricing formula', details })
  })

  it('does not call the pricing service when viewer resolution fails', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('Authentication required'), { status: 401 }))
    expect((await calculate(request({}))).status).toBe(401)
    expect(service.calculatePricing).not.toHaveBeenCalled()
  })

  it('catalog admission preserves owner-selected policy and maps an owner refusal without leaking details', async () => {
    const body = { businessId: 'b-pricing', productId: 'sku', quantities: [100], expectedRuleSetId: 'rules-one', expectedRuleVersion: 2, reason: 'Reviewed', idempotencyKey: 'catalog-one', previewHash: 'a'.repeat(64) }
    admitPricingCatalog.mockResolvedValue({ status: 'ADMITTED', publicationStatus: 'NOT_VERIFIED' })
    const response = await catalog(request(body))
    expect(await response.json()).toEqual({ status: 'ADMITTED', publicationStatus: 'NOT_VERIFIED' })
    expect(admitPricingCatalog).toHaveBeenCalledWith(body, { viewer })
    admitPricingCatalog.mockRejectedValue(Object.assign(new Error('Business not found'), { status: 404 }))
    const denied = await catalog(request(body))
    expect(denied.status).toBe(404)
    expect(await denied.json()).toEqual({ error: 'Business not found' })
  })
})

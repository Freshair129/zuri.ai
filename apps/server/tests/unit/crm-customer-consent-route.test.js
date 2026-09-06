// @req FR-103 — the consent route wires params.customerId and the request body
// into the service, and its status/shape round-trip through the response.
// @spec SDD-053, SEC-005
// @tested tests/unit/crm-customer-consent-route.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const { recordCustomerConsent, resolveRequestViewer } = vi.hoisted(() => ({
  recordCustomerConsent: vi.fn(),
  resolveRequestViewer: vi.fn(),
}))

vi.mock('@/modules/crm/customer-consent-service', () => ({ recordCustomerConsent }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { POST } = await import('@/app/api/crm/customers/[customerId]/consent/route')

const viewer = makeViewer({ ownedBusinessIds: ['b-1'], visibleBusinessIds: ['b-1'] })

function postConsent(customerId, body) {
  return POST(
    new Request(`http://local/api/crm/customers/${customerId}/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { customerId } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
})

describe('POST /api/crm/customers/:customerId/consent', () => {
  it('passes the route param and body straight through to the service, with the resolved viewer', async () => {
    recordCustomerConsent.mockResolvedValue({ id: 'cust-1', consentStatus: 'GRANTED' })

    const res = await postConsent('cust-1', { businessId: 'b-1', status: 'GRANTED' })

    expect(recordCustomerConsent).toHaveBeenCalledWith('cust-1', { businessId: 'b-1', status: 'GRANTED' }, { viewer })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 'cust-1', consentStatus: 'GRANTED' })
  })

  it('maps a service authorization refusal to the same status the service chose', async () => {
    const denial = new Error('Recording consent requires owner authority over this Business')
    denial.status = 403
    recordCustomerConsent.mockRejectedValue(denial)

    const res = await postConsent('cust-1', { businessId: 'b-1', status: 'GRANTED' })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/owner authority/)
  })

  it('never calls the service before the viewer resolves — an unauthenticated caller gets no side effect', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))

    const res = await postConsent('cust-1', { businessId: 'b-1', status: 'GRANTED' })

    expect(res.status).toBe(401)
    expect(recordCustomerConsent).not.toHaveBeenCalled()
  })
})

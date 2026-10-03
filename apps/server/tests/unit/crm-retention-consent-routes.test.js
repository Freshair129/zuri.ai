// @req FR-022 — the retention-consent routes pass params.customerId and the body
//   straight to the service with the resolved viewer, and a SALES_REP binding
//   resolves to the permission the service checks (ADR-093 1.2.0).
// @spec ADR-093 1.2.0
// @tested tests/unit/crm-retention-consent-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'
import { permissionsForRoles, RETENTION_CONSENT_WRITE_PERMISSION, ROLE_SALES_REP } from '@/modules/identity/rbac'

const { recordCustomerRetentionConsent, revokeCustomerRetentionConsent, resolveRequestViewer } = vi.hoisted(() => ({
  recordCustomerRetentionConsent: vi.fn(),
  revokeCustomerRetentionConsent: vi.fn(),
  resolveRequestViewer: vi.fn(),
}))

vi.mock('@/modules/crm/customer-retention-consent-service', () => ({ recordCustomerRetentionConsent, revokeCustomerRetentionConsent }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const record = await import('@/app/api/crm/customers/[customerId]/retention-consent/route')
const revoke = await import('@/app/api/crm/customers/[customerId]/retention-consent/revoke/route')

const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: [], visibleDomains: ['customer'], rolesByBusinessId: { 'b-1': [ROLE_SALES_REP] } })

function post(handler, customerId, suffix, body) {
  return handler.POST(new Request(`http://local/api/crm/customers/${customerId}/retention-consent${suffix}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: { customerId } })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
})

describe('retention consent routes', () => {
  it('SALES_REP carries crm.retention-consent.write; the permission is not granted to unrelated roles', () => {
    expect(RETENTION_CONSENT_WRITE_PERMISSION).toBe('crm.retention-consent.write')
    expect(permissionsForRoles([ROLE_SALES_REP])).toContain(RETENTION_CONSENT_WRITE_PERMISSION)
    expect(permissionsForRoles(['PAYMENT_VERIFIER', 'INVENTORY_MANAGER'])).not.toContain(RETENTION_CONSENT_WRITE_PERMISSION)
  })

  it('POST records through the service with the resolved viewer', async () => {
    recordCustomerRetentionConsent.mockResolvedValue({ id: 'rc-1', customerId: 'cust-1' })
    const res = await post(record, 'cust-1', '', { businessId: 'b-1', note: 'ok' })
    expect(recordCustomerRetentionConsent).toHaveBeenCalledWith('cust-1', { businessId: 'b-1', note: 'ok' }, { viewer })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 'rc-1', customerId: 'cust-1' })
  })

  it('POST /revoke revokes through the service and keeps a refusal\'s status', async () => {
    const denial = Object.assign(new Error('Recording retention consent requires owner or SALES_REP authority over this Business'), { status: 403 })
    revokeCustomerRetentionConsent.mockRejectedValue(denial)
    const res = await post(revoke, 'cust-1', '/revoke', { businessId: 'b-1' })
    expect(revokeCustomerRetentionConsent).toHaveBeenCalledWith('cust-1', { businessId: 'b-1' }, { viewer })
    expect(res.status).toBe(403)
  })
})

// @req FR-235 — the disclosure API derives account scope from the route and
//   resolves the current signed-in viewer for each operation.
// @tested tests/unit/line-product-disclosure-route.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'

const mocks = vi.hoisted(() => ({
  viewer: { principal: { id: 'person-owner' } },
  resolveViewer: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  approve: vi.fn(),
  withdraw: vi.fn(),
}))

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: mocks.resolveViewer }))
vi.mock('@/modules/knowledge/line-product-disclosure-service', () => ({
  listLineProductDisclosure: mocks.list,
  previewLineProductDisclosure: mocks.preview,
  setLineProductDisclosure: mocks.approve,
  withdrawLineProductDisclosure: mocks.withdraw,
}))

import { GET, POST } from '@/app/api/line-oa/accounts/[id]/product-disclosure/route'

const params = { params: { id: 'route-account' } }
const responseBody = async (response) => response.json()

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveViewer.mockResolvedValue(mocks.viewer)
  mocks.list.mockResolvedValue({ products: [], sources: [], policies: [], fields: [] })
  mocks.preview.mockResolvedValue({ previewHash: 'a'.repeat(64), expectedVersion: 0, values: [], exampleText: '' })
  mocks.approve.mockResolvedValue({ enabled: true, version: 1 })
  mocks.withdraw.mockResolvedValue({ enabled: false, version: 2 })
})

describe('LINE Product disclosure API route', () => {
  it('uses the route account id and current viewer for GET', async () => {
    const request = new Request('http://localhost/api/line-oa/accounts/route-account/product-disclosure?businessId=business-1&accountId=attacker&sourceQuery=Catalog&sourceCursor=source-99')
    const response = await GET(request, params)
    expect(response.status).toBe(200)
    expect(await responseBody(response)).toMatchObject({ products: [], sources: [] })
    expect(mocks.list).toHaveBeenCalledWith({ businessId: 'business-1', accountId: 'route-account', q: undefined,
      sourceQuery: 'Catalog', sourceCursor: 'source-99' },
      { viewer: mocks.viewer })
  })

  it('registers the implemented GET/POST route in the API inventory', () => {
    const paths = Object.fromEntries(CURRENT_API_ROUTE_INVENTORY)
    expect(paths['/api/line-oa/accounts/{id}/product-disclosure']).toEqual(['GET', 'POST'])
  })

  it.each([
    ['PREVIEW', 'preview'],
    ['APPROVE', 'approve'],
    ['WITHDRAW', 'withdraw'],
  ])('dispatches %s using the route account id', async (action, expected) => {
    const body = {
      action,
      businessId: 'business-1',
      accountId: 'attacker-account',
      productId: 'product-1',
      sourceId: 'source-1',
      fields: ['sku'],
      expectedVersion: 0,
      previewHash: 'a'.repeat(64),
      reason: 'owner approved',
    }
    const response = await POST(new Request('http://localhost/api/line-oa/accounts/route-account/product-disclosure', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), params)
    expect(response.status).toBe(200)
    expect(await responseBody(response)).toBeTruthy()
    const mock = { preview: mocks.preview, approve: mocks.approve, withdraw: mocks.withdraw }[expected]
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock.mock.calls[0][0]).toMatchObject({ businessId: 'business-1', accountId: 'route-account', productId: 'product-1' })
    expect(mock.mock.calls[0][1]).toEqual({ viewer: mocks.viewer })
  })

  it('rejects an unknown action with a client error', async () => {
    const response = await POST(new Request('http://localhost/api/line-oa/accounts/route-account/product-disclosure', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'GRANT_ALL' }),
    }), params)
    expect(response.status).toBe(400)
    expect(mocks.preview).not.toHaveBeenCalled()
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(mocks.withdraw).not.toHaveBeenCalled()
  })
})

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import prisma from '@/lib/db'
import { createPortfolio, createTenant } from '../factories/scope'
import { mintSotDataPlaneKey } from '@/modules/identity/sot-data-plane-auth'
import { POST } from '@/app/api/platform/sot/decisions/route'
import { GET as GET_EXPORT } from '@/app/api/platform/sot/decisions/export/route'

// @req FR-102 — the two data-plane route verbs (submit, export) authenticate a
// bearer `sdpk_` key end-to-end through the actual route handler, not just the
// service function it delegates to; a no-auth call still 401s exactly as it
// did before this key type existed.
// @tested tests/integration/sot-decisions-route.test.js

let tenant

beforeAll(async () => {
  const pf = await createPortfolio({ name: 'SoT Route Group', code: 'PF-SRT' })
  tenant = await createTenant({ portfolioId: pf.id, name: 'SoT Route Tenant', code: 'TNT-SRT' })
})

function postDecisions(body, headers = {}) {
  return POST(new Request('http://local/api/platform/sot/decisions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
}

function getExport(query, headers = {}) {
  return GET_EXPORT(new Request(`http://local/api/platform/sot/decisions/export?${query}`, { headers }))
}

describe('POST /api/platform/sot/decisions (FR-100, FR-102)', () => {
  it('a valid data-plane bearer key submits successfully', async () => {
    const minted = await mintSotDataPlaneKey({ label: 'route-test-submit', tenantId: tenant.id })
    const res = await postDecisions(
      { tenantId: tenant.id, submittedBy: 'sot-data-plane', items: [{ decisionType: 'PRICE_ROW', subjectRef: `RT-${randomUUID()}`, payload: { a: 1 } }] },
      { authorization: `Bearer ${minted.key}` },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0].outcome).toBe('CREATED')
  })

  it('no credential at all is refused (unchanged 401 behaviour)', async () => {
    const res = await postDecisions({ tenantId: tenant.id, submittedBy: 'x', items: [{ decisionType: 'PRICE_ROW', subjectRef: `RT-${randomUUID()}`, payload: {} }] })
    expect(res.status).toBe(401)
  })

  it('a revoked key is refused just as if no key were presented', async () => {
    const minted = await mintSotDataPlaneKey({ label: 'route-test-revoked', tenantId: tenant.id })
    await prisma.sotDataPlaneKey.update({ where: { id: minted.id }, data: { status: 'REVOKED' } })
    const res = await postDecisions(
      { tenantId: tenant.id, submittedBy: 'x', items: [{ decisionType: 'PRICE_ROW', subjectRef: `RT-${randomUUID()}`, payload: {} }] },
      { authorization: `Bearer ${minted.key}` },
    )
    expect(res.status).toBe(401)
  })
})

describe('GET /api/platform/sot/decisions/export (FR-100, FR-102)', () => {
  it('a valid data-plane bearer key exports its own tenant', async () => {
    const minted = await mintSotDataPlaneKey({ label: 'route-test-export', tenantId: tenant.id })
    const res = await getExport(`tenantId=${tenant.id}`, { authorization: `Bearer ${minted.key}` })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.decisions)).toBe(true)
  })

  it('no credential at all is refused', async () => {
    const res = await getExport(`tenantId=${tenant.id}`)
    expect(res.status).toBe(401)
  })
})

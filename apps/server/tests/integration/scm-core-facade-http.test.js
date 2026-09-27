import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import prisma from '@/lib/db'
import { createBranch, createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { POST } from '@/app/api/internal/scm/v1/[operation]/route'
// The consumer under test is the SCM service's own code, imported from its package
// (test-only; nothing under src/ imports services/), exactly as
// market-core-facade-http.test.js imports the Market service's client.
import { createScmCoreClient } from '../../../../services/scm/src/infrastructure/core-client.js'
import { createCoreReferenceAuthority, createCoreScopeResolver } from '../../../../services/scm/src/infrastructure/core-reference-authority.js'
import { commerceAuthority, inventoryAuthority, procurementAuthority } from '../../../../services/scm/src/infrastructure/delegation.js'

// @req FR-154, FR-164, FR-166, FR-183 — the SCM service's real scm-core.v1 client
//   (strict zod response schemas, refusal mapping) against core's real route handler
//   and the real test database. Only the session port is swapped, as in
//   market-core-facade-http.test.js: the façade still re-resolves the subject
//   through resolveRequestViewer, so every decision and every read is production
//   code. The injected fetch calls the Next route handler with the exact Request
//   the client built (method, headers, body, URL).
// @spec ADR-111, ADR-108, BR-001, SEC-001, SEC-017

const subjects = new Map()
vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: async (request) => {
    const token = (request.headers.get('cookie') || '').replace(/^zuri_session=/, '')
    const viewer = subjects.get(token)
    if (!viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
    return viewer
  },
}))

const CORE_TOKEN = 'c'.repeat(48)
const OWNER = 'subject-owner'
const CLERK = 'subject-clerk'
const CROSS = 'subject-cross-tenant'
const PROJECTS_ONLY = 'subject-projects-only'
const NOBODY = 'subject-no-business'
const STALE = 'subject-deleted-business'
const BASE = 'http://core.internal'
const suffix = () => randomUUID().slice(0, 8).toUpperCase()
const savedToken = process.env.SCM_CORE_TOKEN

let tenant, business, hidden, otherTenant, foreign, foreignSibling
let branch, closedBranch, hiddenBranch, foreignBranch
let customer, sharedCustomer, hiddenCustomer, foreignCustomer, conversation, foreignConversation

// fetch → the Next route handler, in process. `operation` is the last path segment,
// as Next's router would pass it.
async function routeFetch(url, init) {
  const request = new Request(url, init)
  const match = new URL(request.url).pathname.match(/^\/api\/internal\/scm\/v1\/([^/]+)$/)
  if (!match) return new Response(null, { status: 404 })
  return POST(request, { params: Promise.resolve({ operation: decodeURIComponent(match[1]) }) })
}

const client = (token = CORE_TOKEN) => createScmCoreClient({ baseUrl: BASE, token, fetchFn: routeFetch, retries: 0, timeoutMs: 10000 })

async function person(label) {
  return prisma.person.create({ data: { id: randomUUID(), code: `PER-SCMF-${label}-${suffix()}`, displayName: `SCM façade ${label}` } })
}

async function makeCustomer(tenantId, businessId, label, extra = {}) {
  const p = await person(label)
  return prisma.customer.create({
    data: { code: `CUS-SCMF-${label}-${suffix()}`, tenantId, businessId, personId: p.id, displayName: `SCM façade ${label}`, ...extra },
  })
}

describe('scm-core.v1: SCM consumer client against the real façade', () => {
  beforeAll(async () => {
    process.env.SCM_CORE_TOKEN = CORE_TOKEN
    const token = suffix()
    const portfolio = await createPortfolio({ name: `SCM Facade PF ${token}`, code: `PF-SCMF-${token}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `SCM Facade TNT ${token}`, code: `TNT-SCMF-${token}` })
    otherTenant = await createTenant({ portfolioId: portfolio.id, name: `SCM Facade TNT2 ${token}`, code: `TNT-SCMF2-${token}` })
    business = await createBusiness({ tenantId: tenant.id, name: 'SCM façade shop', code: `BUS-SCMF-${token}` })
    hidden = await createBusiness({ tenantId: tenant.id, name: 'SCM façade hidden', code: `BUS-SCMFH-${token}` })
    foreign = await createBusiness({ tenantId: otherTenant.id, name: 'SCM façade foreign', code: `BUS-SCMFX-${token}` })
    foreignSibling = await createBusiness({ tenantId: otherTenant.id, name: 'SCM façade foreign 2', code: `BUS-SCMFY-${token}` })

    branch = await createBranch({ tenantId: tenant.id, businessId: business.id, name: 'Front', code: `BR-SCMF-A-${token}` })
    closedBranch = await createBranch({ tenantId: tenant.id, businessId: business.id, name: 'Closed', code: `BR-SCMF-B-${token}` })
    closedBranch = await prisma.branch.update({ where: { id: closedBranch.id }, data: { status: 'INACTIVE', address: '1 Synthetic Road' } })
    hiddenBranch = await createBranch({ tenantId: tenant.id, businessId: hidden.id, name: 'Hidden', code: `BR-SCMF-H-${token}` })
    foreignBranch = await createBranch({ tenantId: otherTenant.id, businessId: foreign.id, name: 'Foreign', code: `BR-SCMF-X-${token}` })

    customer = await makeCustomer(tenant.id, business.id, 'OWN')
    sharedCustomer = await makeCustomer(tenant.id, null, 'SHARED', { deletedAt: new Date('2026-09-01T00:00:00.000Z') })
    hiddenCustomer = await makeCustomer(tenant.id, hidden.id, 'HIDDEN')
    foreignCustomer = await makeCustomer(otherTenant.id, foreign.id, 'FOREIGN')
    conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, businessId: business.id, customerId: customer.id, channel: 'LINE', externalThreadId: `TH-SCMF-${token}` },
    })
    foreignConversation = await prisma.conversation.create({
      data: { tenantId: otherTenant.id, businessId: foreign.id, customerId: foreignCustomer.id, channel: 'LINE', externalThreadId: `TH-SCMFX-${token}` },
    })

    subjects.set(OWNER, makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] }))
    subjects.set(CLERK, makeViewer({
      visibleDomains: ['inventory', 'commerce'],
      visibleBusinessIds: [business.id],
      rolesByBusinessId: { [business.id]: ['INVENTORY_MANAGER', 'SALES_REP'] },
    }))
    subjects.set(CROSS, makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [business.id, foreign.id, foreignSibling.id] }))
    subjects.set(PROJECTS_ONLY, makeViewer({ visibleDomains: ['projects'], visibleBusinessIds: [business.id] }))
    subjects.set(NOBODY, makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [] }))
    // A Business id the session still lists whose row no longer exists (deleted).
    subjects.set(STALE, makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [business.id, randomUUID()] }))
  })

  afterAll(() => {
    if (savedToken === undefined) delete process.env.SCM_CORE_TOKEN
    else process.env.SCM_CORE_TOKEN = savedToken
  })

  it('resolve-scope passes the consumer schema and drives the unchanged SCM ladder', async () => {
    const core = client()
    const owner = await core.resolveScope(OWNER, business.id)
    expect(owner).toEqual({
      actorId: 'per-1',
      tenantId: tenant.id,
      grants: { [business.id]: { owner: true, domains: ['inventory', 'procurement', 'commerce'], permissions: [] } },
    })

    const scope = await createCoreScopeResolver(core)(CLERK, business.id)
    expect(scope.tenantId).toBe(tenant.id)
    expect(inventoryAuthority.require(scope, business.id, { write: true })).toEqual({ id: business.id, tenantId: tenant.id })
    expect(commerceAuthority.require(scope, business.id, 'order')).toEqual({ id: business.id, tenantId: tenant.id })
    expect(() => commerceAuthority.require(scope, business.id, 'verify')).toThrow(expect.objectContaining({ status: 404 }))
    expect(() => procurementAuthority.require(scope, business.id)).toThrow(expect.objectContaining({ status: 404 }))
    expect(() => inventoryAuthority.require(scope, hidden.id)).toThrow(expect.objectContaining({ status: 404 }))
  })

  it('branch / branches facts pass the consumer schema; any status is returned', async () => {
    const core = client()
    expect(await core.branch(OWNER, { businessId: business.id, branchId: branch.id })).toEqual({
      id: branch.id, code: branch.code, name: 'Front', tenantId: tenant.id, businessId: business.id, status: 'ACTIVE',
    })
    const rows = await core.branches(OWNER, { businessId: business.id })
    expect(rows.map((row) => row.id).sort()).toEqual([branch.id, closedBranch.id].sort())
    expect(rows.find((row) => row.id === closedBranch.id)).toEqual({
      id: closedBranch.id, code: closedBranch.code, name: 'Closed', address: '1 Synthetic Road', kind: 'SITE', status: 'INACTIVE', tenantId: tenant.id, businessId: business.id,
    })
  })

  it('customer / conversation facts pass the consumer schema through the reference authority', async () => {
    const core = client()
    const scope = await createCoreScopeResolver(core)(OWNER, business.id)
    const references = createCoreReferenceAuthority(core)
    expect(await references.customer(scope, { businessId: business.id, customerId: customer.id })).toEqual({
      id: customer.id, code: customer.code, tenantId: tenant.id, businessId: business.id, deletedAt: null,
    })
    expect(await references.customer(scope, { businessId: business.id, customerId: sharedCustomer.id })).toEqual({
      id: sharedCustomer.id, code: sharedCustomer.code, tenantId: tenant.id, businessId: null, deletedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(await references.conversation(scope, { businessId: business.id, conversationId: conversation.id })).toEqual({
      id: conversation.id, tenantId: tenant.id, businessId: business.id, customerId: customer.id,
    })
  })

  it('resolve-scope: the selected Business picks the Tenant; grants stay inside it', async () => {
    const core = client()
    const home = await core.resolveScope(CROSS, business.id)
    expect(home.tenantId).toBe(tenant.id)
    expect(Object.keys(home.grants)).toEqual([business.id])
    const away = await core.resolveScope(CROSS, foreign.id)
    expect(away.tenantId).toBe(otherTenant.id)
    expect(Object.keys(away.grants).sort()).toEqual([foreign.id, foreignSibling.id].sort())
    // The deleted Business never earns a grant.
    expect(Object.keys((await core.resolveScope(STALE, business.id)).grants)).toEqual([business.id])
  })

  it('resolve-scope: an invisible, unknown or deleted selection and a Business-less subject are the legacy 404', async () => {
    const notFound = { status: 404, code: 'SCM_SCOPE_NOT_FOUND' }
    await expect(client().resolveScope(OWNER, hidden.id)).rejects.toMatchObject(notFound)
    await expect(client().resolveScope(OWNER, foreign.id)).rejects.toMatchObject(notFound)
    await expect(client().resolveScope(OWNER, randomUUID())).rejects.toMatchObject(notFound)
    await expect(client().resolveScope(STALE, subjects.get(STALE).visibleBusinessIds[1])).rejects.toMatchObject(notFound)
    await expect(client().resolveScope(NOBODY, business.id)).rejects.toMatchObject(notFound)
  })

  it('facts need the commerce view of the named Business', async () => {
    const core = client()
    expect(await core.branch(PROJECTS_ONLY, { businessId: business.id, branchId: branch.id })).toBeNull()
    expect(await core.branches(PROJECTS_ONLY, { businessId: business.id })).toEqual([])
    expect(await core.customer(PROJECTS_ONLY, { businessId: business.id, customerId: customer.id })).toBeNull()
    expect(await core.conversation(PROJECTS_ONLY, { businessId: business.id, conversationId: conversation.id })).toBeNull()
  })

  it('disclosure: nothing outside the subject\'s visible Businesses and Tenant', async () => {
    const core = client()
    // A Business the subject cannot see — in the same Tenant, and in another.
    expect(await core.branch(OWNER, { businessId: hidden.id, branchId: hiddenBranch.id })).toBeNull()
    expect(await core.branches(OWNER, { businessId: hidden.id })).toEqual([])
    expect(await core.branches(OWNER, { businessId: foreign.id })).toEqual([])
    expect(await core.customer(OWNER, { businessId: foreign.id, customerId: foreignCustomer.id })).toBeNull()
    // The named Business is visible; the row is another Tenant's or homed out of sight.
    expect(await core.branch(OWNER, { businessId: business.id, branchId: foreignBranch.id })).toBeNull()
    expect(await core.branch(OWNER, { businessId: business.id, branchId: hiddenBranch.id })).toBeNull()
    expect(await core.customer(OWNER, { businessId: business.id, customerId: foreignCustomer.id })).toBeNull()
    expect(await core.customer(OWNER, { businessId: business.id, customerId: hiddenCustomer.id })).toBeNull()
    expect(await core.conversation(OWNER, { businessId: business.id, conversationId: foreignConversation.id })).toBeNull()
    // Unknown ids.
    expect(await core.branch(OWNER, { businessId: business.id, branchId: randomUUID() })).toBeNull()
    expect(await core.customer(OWNER, { businessId: business.id, customerId: randomUUID() })).toBeNull()
    expect(await core.conversation(OWNER, { businessId: randomUUID(), conversationId: conversation.id })).toBeNull()
  })

  it('refusals map to the consumer\'s codes', async () => {
    await expect(client().resolveScope('not-a-session', business.id)).rejects.toMatchObject({ status: 401, code: 'SCM_SUBJECT_UNAUTHENTICATED' })
    await expect(client().branch('not-a-session', { businessId: business.id, branchId: branch.id }))
      .rejects.toMatchObject({ status: 401, code: 'SCM_SUBJECT_UNAUTHENTICATED' })
    await expect(client('w'.repeat(48)).resolveScope(OWNER, business.id)).rejects.toMatchObject({ status: 502, code: 'SCM_CORE_REJECTED' })
  })

  it('the route refuses before reading, bounds the body and never caches', async () => {
    const post = (operation, { auth = `Bearer ${CORE_TOKEN}`, body = '{}', headers = {} } = {}) => POST(
      new Request(`${BASE}/api/internal/scm/v1/${operation}`, { method: 'POST', body, headers: { authorization: auth, 'x-zuri-subject': OWNER, ...headers } }),
      { params: Promise.resolve({ operation }) },
    )
    const unauthorized = await post('resolve-scope', { auth: 'Bearer nope', body: '{not json' })
    expect(unauthorized.status).toBe(401)
    expect(await unauthorized.json()).toEqual({ error: { code: 'SERVICE_TOKEN_INVALID' } })
    expect(unauthorized.headers.get('cache-control')).toBe('no-store')

    const unknown = await post('drop-table')
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: { code: 'OPERATION_NOT_FOUND' } })

    const large = await post('branches', { body: JSON.stringify({ businessId: 'x'.repeat(17 * 1024) }) })
    expect(large.status).toBe(413)
    expect(await large.json()).toEqual({ error: { code: 'REQUEST_TOO_LARGE' } })

    // resolve-scope must name its Business.
    const unnamed = await post('resolve-scope')
    expect(unnamed.status).toBe(400)
    expect(await unnamed.json()).toEqual({ error: { code: 'VALIDATION_FAILED' } })

    const ok = await post('resolve-scope', { body: JSON.stringify({ businessId: business.id }) })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
  })
})

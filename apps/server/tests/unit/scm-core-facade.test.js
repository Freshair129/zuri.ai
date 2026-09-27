import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { makeDevViewer, makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  MAX_GRANTS,
  MAX_REQUEST_BODY_BYTES,
  SCM_PERMISSIONS,
  handleScmCoreRequest,
  readBoundedBody,
  tokenMatches,
} from '@/modules/inventory/application/scm-core-facade'
import * as legacyInventory from '@/modules/inventory/application/inventory-authority'
import * as legacyProcurement from '@/modules/procurement/application/procurement-authority'
import * as legacyCommerce from '@/modules/commerce/application/commerce-authority'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
// The consumer's own ladder, imported from its package (test-only; nothing under
// src/ imports services/), exactly as market-core-facade-http.test.js does.
import {
  commerceAuthority,
  inventoryAuthority,
  procurementAuthority,
  scopeFromGrants,
} from '../../../../services/scm/src/infrastructure/delegation.js'

// @req FR-154, FR-164, FR-165, FR-166, FR-163, FR-183, FR-061 — core's scm-core.v1
//   façade for the SCM service (ADR-111 D5). The grants it resolves must make SCM's
//   ladder answer exactly what the legacy in-process authorities answer, and its
//   identity must come only from the user's own session token.
// @spec ADR-111, ADR-108, BR-001, SEC-001, SEC-017, BR-020, FR-072

const TOKEN = 'k'.repeat(40)
const SCM = ['inventory', 'procurement', 'commerce']
const ALL = [...SCM, 'projects', 'people', 'platform', 'market']

const BUSINESSES = {
  'b-1': { id: 'b-1', tenantId: 't-1' },
  'b-2': { id: 'b-2', tenantId: 't-1' },
  'b-3': { id: 'b-3', tenantId: 't-1' },
  'b-x': { id: 'b-x', tenantId: 't-2' },
  'b-y': { id: 'b-y', tenantId: 't-2' },
}
// 'b-gone' is in some viewers' visibleBusinessIds but has no row: a deleted Business.
const BRANCHES = [
  { id: 'br-1', code: 'BR-1', name: 'Main', address: null, kind: 'SITE', status: 'ACTIVE', tenantId: 't-1', businessId: 'b-1' },
  { id: 'br-2', code: 'BR-2', name: 'Closed', address: 'Road 2', kind: 'SITE', status: 'INACTIVE', tenantId: 't-1', businessId: 'b-1' },
  { id: 'br-3', code: 'BR-3', name: 'Elsewhere', address: null, kind: 'SITE', status: 'ACTIVE', tenantId: 't-1', businessId: 'b-3' },
  { id: 'br-x', code: 'BR-X', name: 'Foreign', address: null, kind: 'SITE', status: 'ACTIVE', tenantId: 't-2', businessId: 'b-x' },
]
const CUSTOMERS = [
  { id: 'c-1', code: 'CUS-1', tenantId: 't-1', businessId: 'b-1', deletedAt: null },
  { id: 'c-shared', code: 'CUS-S', tenantId: 't-1', businessId: null, deletedAt: new Date('2026-09-01T00:00:00Z') },
  { id: 'c-3', code: 'CUS-3', tenantId: 't-1', businessId: 'b-3', deletedAt: null },
  { id: 'c-x', code: 'CUS-X', tenantId: 't-2', businessId: 'b-x', deletedAt: null },
]
const CONVERSATIONS = [
  { id: 'cv-1', tenantId: 't-1', businessId: 'b-1', customerId: 'c-1' },
  { id: 'cv-3', tenantId: 't-1', businessId: 'b-3', customerId: 'c-3' },
  { id: 'cv-x', tenantId: 't-2', businessId: 'b-x', customerId: 'c-x' },
]

const pick = (row, select) => (row ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : null)
const byId = (rows) => vi.fn(async ({ where, select }) => pick(rows.find((row) => row.id === where.id), select))

function fakeDb() {
  return {
    business: {
      findUnique: vi.fn(async ({ where }) => BUSINESSES[where.id] ?? null),
      findMany: vi.fn(async ({ where, take }) => where.id.in
        .map((key) => BUSINESSES[key])
        .filter((row) => row && (where.tenantId === undefined || row.tenantId === where.tenantId))
        .slice(0, take)
        .map((row) => ({ id: row.id }))),
    },
    branch: {
      findUnique: byId(BRANCHES),
      findMany: vi.fn(async ({ where, select, take }) => BRANCHES
        .filter((row) => row.tenantId === where.tenantId && row.businessId === where.businessId)
        .slice(0, take)
        .map((row) => pick(row, select))),
    },
    customer: { findUnique: byId(CUSTOMERS) },
    conversation: { findUnique: byId(CONVERSATIONS) },
  }
}

const viewers = {
  owner: makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'], visibleDomains: ALL }),
  member: makeViewer({ visibleBusinessIds: ['b-1', 'b-2'], visibleDomains: SCM }),
  clerk: makeViewer({
    visibleBusinessIds: ['b-1'],
    visibleDomains: ['inventory', 'people'],
    rolesByBusinessId: { 'b-1': ['INVENTORY_MANAGER', 'LINE_OA_PUBLISHER'] },
  }),
  buyer: ownsElsewhere({
    owns: 'b-1', sees: 'b-2', visibleDomains: ALL, seesDomains: ['procurement'],
    rolesByBusinessId: { 'b-2': ['PROCUREMENT_BUYER', 'GOODS_RECEIVER'] },
  }),
  cashier: makeViewer({
    visibleBusinessIds: ['b-2'],
    visibleDomains: ['commerce'],
    rolesByBusinessId: { 'b-2': ['SALES_REP', 'PAYMENT_VERIFIER'] },
  }),
  // Holds the permission but not the domain: the ladder must still refuse the view.
  roleNoDomain: makeViewer({
    visibleBusinessIds: ['b-2'],
    visibleDomains: ['people'],
    rolesByBusinessId: { 'b-2': ['INVENTORY_MANAGER', 'PROCUREMENT_BUYER', 'SALES_REP'] },
  }),
  outsider: makeViewer({ visibleBusinessIds: ['b-3'], visibleDomains: ['projects'] }),
  dev: makeDevViewer({ visibleBusinessIds: ['b-1', 'b-2', 'b-3'], visibleDomains: ALL }),
  crossTenant: ownsElsewhere({
    owns: 'b-x', sees: 'b-1', visibleDomains: ALL, seesDomains: ['inventory', 'commerce'],
    rolesByBusinessId: { 'b-1': ['SALES_REP'] },
  }),
  // Sees a Business whose row has since been deleted, next to a live one.
  stale: makeViewer({ visibleBusinessIds: ['b-1', 'b-gone'], ownedBusinessIds: ['b-gone'], visibleDomains: SCM }),
  nobody: makeViewer({ visibleBusinessIds: [], visibleDomains: SCM }),
}

function deps(overrides = {}) {
  return {
    db: fakeDb(),
    env: { SCM_CORE_TOKEN: TOKEN },
    resolveRequestViewer: vi.fn(async (request) => {
      const token = (request.headers.get('cookie') || '').replace(/^zuri_session=/, '')
      const viewer = viewers[token]
      if (!viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
      return viewer
    }),
    ...overrides,
  }
}

// resolve-scope names its Business (owner ruling (a)); b-1 unless a test says otherwise.
const call = (d, { method = 'POST', operation, subject = 'owner', body = operation === 'resolve-scope' ? { businessId: 'b-1' } : {}, auth = `Bearer ${TOKEN}` }) =>
  handleScmCoreRequest({ method, operation, authorization: auth, subject, body }, d)
const scopeOf = (subject, businessId) => call(deps(), { operation: 'resolve-scope', subject, body: { businessId } })

describe('scm-core.v1 façade: refusals', () => {
  it('requires the service token, refusing every caller when it is unset or short', async () => {
    const refusal = { status: 401, body: { error: { code: 'SERVICE_TOKEN_INVALID' } } }
    expect(await call(deps(), { operation: 'resolve-scope', auth: null })).toEqual(refusal)
    expect(await call(deps(), { operation: 'resolve-scope', auth: 'Bearer wrong' })).toEqual(refusal)
    expect(await call(deps(), { operation: 'resolve-scope', auth: TOKEN })).toEqual(refusal)
    expect(await call(deps({ env: {} }), { operation: 'resolve-scope', auth: 'Bearer undefined' })).toEqual(refusal)
    const short = 's'.repeat(31)
    expect(await call(deps({ env: { SCM_CORE_TOKEN: short } }), { operation: 'resolve-scope', auth: `Bearer ${short}` })).toEqual(refusal)
    // The token is checked before anything else: no operation name is disclosed.
    expect(await call(deps(), { operation: 'drop-table', auth: null })).toEqual(refusal)
  })

  it('compares digests, so a supplied header of any length is answered without throwing', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    for (const header of [undefined, null, '', 'Bearer', `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, 'x'.repeat(10000), `bearer ${TOKEN}`]) {
      expect(tokenMatches(header, TOKEN)).toBe(false)
    }
  })

  it('unknown operation 404, wrong method 405, bad body 400 — all before the subject is resolved', async () => {
    const d = deps()
    expect(await call(d, { operation: 'drop-table' })).toEqual({ status: 404, body: { error: { code: 'OPERATION_NOT_FOUND' } } })
    expect(await call(d, { operation: 'branch', method: 'GET' })).toEqual({ status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED' } } })
    const invalid = { status: 400, body: { error: { code: 'VALIDATION_FAILED' } } }
    expect(await call(d, { operation: 'branch', body: { businessId: 'b-1' } })).toEqual(invalid)
    expect(await call(d, { operation: 'branch', body: { businessId: 'b-1', branchId: '' } })).toEqual(invalid)
    expect(await call(d, { operation: 'branch', body: { businessId: 'b-1', branchId: 'x'.repeat(201) } })).toEqual(invalid)
    // resolve-scope must name its Business, and only that.
    expect(await call(d, { operation: 'resolve-scope', body: {} })).toEqual(invalid)
    expect(await call(d, { operation: 'resolve-scope', body: { businessId: '' } })).toEqual(invalid)
    expect(await call(d, { operation: 'resolve-scope', body: { businessId: 'x'.repeat(201) } })).toEqual(invalid)
    expect(await call(d, { operation: 'resolve-scope', body: { businessId: 7 } })).toEqual(invalid)
    // Smuggled identity is not ignored — it is refused.
    expect(await call(d, { operation: 'resolve-scope', body: { viewer: { role: 'OWNER' } } })).toEqual(invalid)
    expect(await call(d, { operation: 'resolve-scope', body: { businessId: 'b-1', tenantId: 't-1' } })).toEqual(invalid)
    expect(await call(d, { operation: 'customer', body: { businessId: 'b-1', customerId: 'c-1', tenantId: 't-1' } })).toEqual(invalid)
    expect(d.resolveRequestViewer).not.toHaveBeenCalled()
  })

  it('a missing, malformed, unknown or expired subject is SUBJECT_UNAUTHENTICATED', async () => {
    const d = deps()
    const refusal = { status: 401, body: { error: { code: 'SUBJECT_UNAUTHENTICATED' } } }
    expect(await call(d, { operation: 'resolve-scope', subject: null })).toEqual(refusal)
    expect(await call(d, { operation: 'resolve-scope', subject: '' })).toEqual(refusal)
    expect(await call(d, { operation: 'resolve-scope', subject: 'owner; zuri_session=dev' })).toEqual(refusal)
    expect(await call(d, { operation: 'resolve-scope', subject: 'x'.repeat(4097) })).toEqual(refusal)
    expect(d.resolveRequestViewer).not.toHaveBeenCalled()
    expect(await call(d, { operation: 'resolve-scope', subject: 'expired' })).toEqual(refusal)
    expect(d.resolveRequestViewer.mock.calls[0][0].headers.get('cookie')).toBe('zuri_session=expired')
  })

  it('a session-store fault is a fault (the route answers 503), not a refusal', async () => {
    const broken = deps({ resolveRequestViewer: vi.fn(async () => { throw Object.assign(new Error('SESSION_UNAVAILABLE'), { status: 503 }) }) })
    await expect(call(broken, { operation: 'resolve-scope' })).rejects.toThrow('SESSION_UNAVAILABLE')
  })
})

describe('scm-core.v1 façade: bounded body', () => {
  const request = (body, headers = {}) => new Request('http://core/', { method: 'POST', body, headers })

  it('parses a body under the cap and treats an empty body as {}', async () => {
    expect(await readBoundedBody(request('{"businessId":"b-1"}'))).toEqual({ ok: true, body: { businessId: 'b-1' } })
    expect(await readBoundedBody(request(''))).toEqual({ ok: true, body: {} })
    expect(await readBoundedBody(request('{nope'))).toEqual({ ok: false, status: 400, code: 'VALIDATION_FAILED' })
  })

  it('refuses a declared or streamed body over the cap without buffering it', async () => {
    const tooLarge = { ok: false, status: 413, code: 'REQUEST_TOO_LARGE' }
    expect(await readBoundedBody(request('{}', { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) }))).toEqual(tooLarge)
    let pulled = 0
    const stream = new ReadableStream({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(4096))
        if (pulled > 100) controller.close()
      },
    })
    expect(await readBoundedBody(new Request('http://core/', { method: 'POST', body: stream, duplex: 'half' }))).toEqual(tooLarge)
    expect(pulled).toBeLessThan(10)
  })
})

describe('scm-core.v1 façade: resolve-scope', () => {
  it('answers actor, Tenant and one grant per visible Business, from the legacy predicates', async () => {
    const response = await scopeOf('buyer', 'b-2')
    expect(response).toEqual({
      status: 200,
      body: {
        contractVersion: 'scm-core.v1',
        ok: true,
        data: {
          actorId: 'per-1',
          tenantId: 't-1',
          grants: {
            'b-1': { owner: true, domains: SCM, permissions: [] },
            'b-2': { owner: false, domains: ['procurement'], permissions: ['procurement.po.write', 'procurement.receipt.post'] },
          },
        },
      },
    })
  })

  it('emits only the three SCM domains and five SCM permissions', async () => {
    const { data } = (await call(deps(), { operation: 'resolve-scope', subject: 'clerk' })).body
    expect(data.grants['b-1']).toEqual({ owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] })
    const owner = (await call(deps(), { operation: 'resolve-scope', subject: 'owner' })).body.data
    expect(owner.grants['b-1'].domains).toEqual(SCM)
    for (const grant of Object.values(owner.grants)) for (const key of grant.permissions) expect(SCM_PERMISSIONS).toContain(key)
  })

  it('a visible Business with no SCM domain still has a grant (SCM visible = seesBusiness)', async () => {
    const { data } = (await scopeOf('outsider', 'b-3')).body
    expect(data.grants).toEqual({ 'b-3': { owner: false, domains: [], permissions: [] } })
  })

  it('the selected Business picks the Tenant; grants cover only that Tenant', async () => {
    const one = await scopeOf('crossTenant', 'b-1')
    expect(one.status).toBe(200)
    expect(one.body.data).toEqual({
      actorId: 'per-1',
      tenantId: 't-1',
      grants: { 'b-1': { owner: false, domains: ['inventory', 'commerce'], permissions: ['commerce.order.write'] } },
    })
    const two = await scopeOf('crossTenant', 'b-x')
    expect(two.status).toBe(200)
    expect(two.body.data).toEqual({ actorId: 'per-1', tenantId: 't-2', grants: { 'b-x': { owner: true, domains: SCM, permissions: [] } } })
    // Every visible Business of the selected Tenant, not only the selected one.
    expect(Object.keys((await scopeOf('member', 'b-2')).body.data.grants).sort()).toEqual(['b-1', 'b-2'])
  })

  it('an invisible, missing or deleted selected Business is one 404, BUSINESS_NOT_FOUND', async () => {
    const notFound = { status: 404, body: { error: { code: 'BUSINESS_NOT_FOUND' } } }
    expect(await scopeOf('owner', 'b-3')).toEqual(notFound) // exists, same Tenant, not visible
    expect(await scopeOf('owner', 'b-x')).toEqual(notFound) // exists, other Tenant, not visible
    expect(await scopeOf('owner', 'missing')).toEqual(notFound)
    expect(await scopeOf('stale', 'b-gone')).toEqual(notFound) // visible, but deleted
    // The deleted Business never earns a grant when a live one is selected.
    expect((await scopeOf('stale', 'b-1')).body.data.grants).toEqual({ 'b-1': { owner: false, domains: SCM, permissions: [] } })
  })

  it('a viewer with no visible Business is NO_VISIBLE_BUSINESS, whatever it selects', async () => {
    const d = deps()
    const none = { status: 404, body: { error: { code: 'NO_VISIBLE_BUSINESS' } } }
    expect(await call(d, { operation: 'resolve-scope', subject: 'nobody', body: { businessId: 'b-1' } })).toEqual(none)
    expect(await call(d, { operation: 'resolve-scope', subject: 'nobody', body: { businessId: 'missing' } })).toEqual(none)
    expect(d.db.business.findUnique).not.toHaveBeenCalled()
  })

  it('refuses a scope over the contract bound within the selected Tenant', async () => {
    const many = Array.from({ length: MAX_GRANTS + 1 }, (_, i) => `big-${i}`)
    const big = makeViewer({ visibleBusinessIds: [...many, 'b-x'], visibleDomains: SCM })
    const rows = Object.fromEntries([...many.map((key) => [key, { id: key, tenantId: 't-big' }]), ['b-x', BUSINESSES['b-x']]])
    const db = {
      business: {
        findUnique: vi.fn(async ({ where }) => rows[where.id] ?? null),
        findMany: vi.fn(async ({ where, take }) => where.id.in
          .map((key) => rows[key])
          .filter((row) => row && row.tenantId === where.tenantId)
          .slice(0, take)
          .map((row) => ({ id: row.id }))),
      },
    }
    const d = deps({ db, resolveRequestViewer: vi.fn(async () => big) })
    expect(await call(d, { operation: 'resolve-scope', subject: 'big', body: { businessId: 'big-0' } }))
      .toEqual({ status: 409, body: { error: { code: 'SCOPE_TOO_LARGE' } } })
    // The bound is read with a limit, never in full.
    expect(db.business.findMany.mock.calls[0][0].take).toBe(MAX_GRANTS + 1)
    // The same viewer selecting its small Tenant is within the bound.
    const small = await call(d, { operation: 'resolve-scope', subject: 'big', body: { businessId: 'b-x' } })
    expect(small.body.data).toMatchObject({ tenantId: 't-2', grants: { 'b-x': expect.any(Object) } })
    expect(Object.keys(small.body.data.grants)).toEqual(['b-x'])
  })
})

describe('scm-core.v1 façade: facts', () => {
  const fact = async (operation, subject, body) => (await call(deps(), { operation, subject, body })).body.data

  it('branch and branches: raw facts inside the named Business, any status', async () => {
    expect(await fact('branch', 'owner', { businessId: 'b-1', branchId: 'br-2' }))
      .toEqual({ fact: { id: 'br-2', code: 'BR-2', name: 'Closed', tenantId: 't-1', businessId: 'b-1', status: 'INACTIVE' } })
    const { branches } = await fact('branches', 'owner', { businessId: 'b-1' })
    expect(branches.map((row) => row.id)).toEqual(['br-1', 'br-2'])
    expect(branches[0]).toEqual({ id: 'br-1', code: 'BR-1', name: 'Main', address: null, kind: 'SITE', status: 'ACTIVE', tenantId: 't-1', businessId: 'b-1' })
  })

  it('customer and conversation: raw facts, deletedAt as ISO, tenant-shared allowed', async () => {
    expect(await fact('customer', 'owner', { businessId: 'b-1', customerId: 'c-1' }))
      .toEqual({ fact: { id: 'c-1', code: 'CUS-1', tenantId: 't-1', businessId: 'b-1', deletedAt: null } })
    expect(await fact('customer', 'owner', { businessId: 'b-1', customerId: 'c-shared' }))
      .toEqual({ fact: { id: 'c-shared', code: 'CUS-S', tenantId: 't-1', businessId: null, deletedAt: '2026-09-01T00:00:00.000Z' } })
    expect(await fact('conversation', 'owner', { businessId: 'b-1', conversationId: 'cv-1' }))
      .toEqual({ fact: { id: 'cv-1', tenantId: 't-1', businessId: 'b-1', customerId: 'c-1' } })
  })

  it('disclosure: invisible Business, other Tenant, invisible home or missing row → null / []', async () => {
    const none = { fact: null }
    // The subject cannot see the named Business (b-3 exists; b-x is another Tenant).
    expect(await fact('branch', 'owner', { businessId: 'b-3', branchId: 'br-3' })).toEqual(none)
    expect(await fact('branches', 'owner', { businessId: 'b-3' })).toEqual({ branches: [] })
    expect(await fact('branches', 'owner', { businessId: 'missing' })).toEqual({ branches: [] })
    expect(await fact('customer', 'owner', { businessId: 'b-x', customerId: 'c-x' })).toEqual(none)
    // A visible Business, but the row is another Tenant's.
    expect(await fact('branch', 'owner', { businessId: 'b-1', branchId: 'br-x' })).toEqual(none)
    expect(await fact('customer', 'owner', { businessId: 'b-1', customerId: 'c-x' })).toEqual(none)
    expect(await fact('conversation', 'owner', { businessId: 'b-1', conversationId: 'cv-x' })).toEqual(none)
    // Same Tenant, homed in a Business the subject cannot see.
    expect(await fact('branch', 'owner', { businessId: 'b-1', branchId: 'br-3' })).toEqual(none)
    expect(await fact('customer', 'owner', { businessId: 'b-1', customerId: 'c-3' })).toEqual(none)
    // Missing rows.
    expect(await fact('branch', 'owner', { businessId: 'b-1', branchId: 'nope' })).toEqual(none)
    expect(await fact('customer', 'owner', { businessId: 'b-1', customerId: 'nope' })).toEqual(none)
    expect(await fact('conversation', 'owner', { businessId: 'b-1', conversationId: 'nope' })).toEqual(none)
  })

  it('a row of another visible Business in the same Tenant is returned raw: SCM applies its own predicate', async () => {
    expect((await fact('branch', 'member', { businessId: 'b-2', branchId: 'br-1' })).fact).toMatchObject({ id: 'br-1', businessId: 'b-1' })
  })

  it('facts need the COMMERCE view of the named Business, not bare visibility', async () => {
    // outsider sees b-3 with the projects domain only: every fact is withheld.
    expect(await fact('branch', 'outsider', { businessId: 'b-3', branchId: 'br-3' })).toEqual({ fact: null })
    expect(await fact('branches', 'outsider', { businessId: 'b-3' })).toEqual({ branches: [] })
    expect(await fact('customer', 'outsider', { businessId: 'b-3', customerId: 'c-3' })).toEqual({ fact: null })
    expect(await fact('conversation', 'outsider', { businessId: 'b-3', conversationId: 'cv-3' })).toEqual({ fact: null })
    // Holding the commerce roles without the domain is not enough either (FR-061).
    expect(await fact('branches', 'roleNoDomain', { businessId: 'b-2' })).toEqual({ branches: [] })
    // crossTenant holds commerce on b-1 only through its per-Business grant.
    expect((await fact('customer', 'crossTenant', { businessId: 'b-1', customerId: 'c-1' })).fact).toMatchObject({ id: 'c-1' })
    // buyer sees b-2 with procurement only.
    expect(await fact('branches', 'buyer', { businessId: 'b-2' })).toEqual({ branches: [] })
    // The commerce-only cashier is answered.
    expect(await fact('branches', 'cashier', { businessId: 'b-2' })).toEqual({ branches: [] })
    expect((await fact('customer', 'cashier', { businessId: 'b-2', customerId: 'c-shared' })).fact).toMatchObject({ id: 'c-shared', businessId: null })
    // ...but not a Customer homed in b-1, which it cannot see (legacy requireCustomer).
    expect(await fact('customer', 'cashier', { businessId: 'b-2', customerId: 'c-1' })).toEqual({ fact: null })
  })

  it('Customer and Conversation are read through CRM\'s port, never from crm\'s models directly', async () => {
    const source = readFileSync(new URL('../../src/modules/inventory/application/scm-core-facade.js', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\.customer\.|\.conversation\./)
    expect(source).toMatch(/from '@\/modules\/crm\/scm-reference-reader'/)
  })

  it('Branch is read through project-manager\'s port, never from the Branch model directly', async () => {
    const source = readFileSync(new URL('../../src/modules/inventory/application/scm-core-facade.js', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\.branch\./)
    expect(source).toMatch(/from '@\/modules\/project-manager\/application\/branch-reference-reader'/)
  })
})

// PARITY: for every synthetic viewer and every capability, SCM's ladder applied to the
// façade's grants must allow exactly when the legacy authority allows.
describe('scm-core.v1 façade: legacy parity of the SCM ladder', () => {
  const legacyDb = { business: { findUnique: async ({ where }) => BUSINESSES[where.id] ?? null } }
  const allows = async (fn) => { try { await fn(); return true } catch (error) { if (error?.status === 404) return false; throw error } }
  const scmAllows = (fn) => { try { fn(); return true } catch (error) { if (error?.status === 404) return false; throw error } }

  const CAPABILITIES = {
    'inventory.view': [(v, b) => legacyInventory.loadBusiness(legacyDb, v, b), (s, b) => inventoryAuthority.require(s, b)],
    'inventory.manage': [(v, b) => legacyInventory.loadBusiness(legacyDb, v, b, { write: true }), (s, b) => inventoryAuthority.require(s, b, { write: true })],
    'procurement.view': [(v, b) => legacyProcurement.loadBusiness(legacyDb, v, b), (s, b) => procurementAuthority.require(s, b)],
    'procurement.po': [(v, b) => legacyProcurement.loadBusiness(legacyDb, v, b, { capability: 'po' }), (s, b) => procurementAuthority.require(s, b, 'po')],
    'procurement.costSheet': [(v, b) => legacyProcurement.loadBusiness(legacyDb, v, b, { capability: 'costSheet' }), (s, b) => procurementAuthority.require(s, b, 'costSheet')],
    'procurement.receipt': [(v, b) => legacyProcurement.loadBusiness(legacyDb, v, b, { capability: 'receipt' }), (s, b) => procurementAuthority.require(s, b, 'receipt')],
    'commerce.view': [(v, b) => legacyCommerce.loadBusiness(legacyDb, v, b), (s, b) => commerceAuthority.require(s, b)],
    'commerce.order': [(v, b) => legacyCommerce.loadBusiness(legacyDb, v, b, { capability: 'order' }), (s, b) => commerceAuthority.require(s, b, 'order')],
    'commerce.verify': [(v, b) => legacyCommerce.loadBusiness(legacyDb, v, b, { capability: 'verify' }), (s, b) => commerceAuthority.require(s, b, 'verify')],
    // pricing-rules-service ownerBusiness: commerce loadBusiness, then ownsBusiness.
    'commerce.pricing': [
      async (v, b) => { await legacyCommerce.loadBusiness(legacyDb, v, b); if (!ownsBusiness(v, b)) throw legacyCommerce.notFound() },
      (s, b) => commerceAuthority.require(s, b, 'pricing'),
    ],
  }
  // 'b-gone' is visible to `stale` but deleted: legacy loadBusiness 404s it after
  // the gate, and SCM has no grant for it.
  const TARGETS = ['b-1', 'b-2', 'b-3', 'b-x', 'b-y', 'b-gone', 'missing']
  const PARITY_VIEWERS = ['owner', 'member', 'clerk', 'buyer', 'cashier', 'roleNoDomain', 'outsider', 'dev', 'crossTenant', 'stale']
  // Every (viewer, selected Business) pair the viewer can resolve a scope for.
  const SELECTIONS = PARITY_VIEWERS.flatMap((name) => viewers[name].visibleBusinessIds
    .filter((businessId) => BUSINESSES[businessId])
    .map((businessId) => [name, businessId]))
  // A scope answers for one Tenant: a request about another Tenant's Business is
  // resolved with THAT Business selected, so it is compared under that selection.
  const tenantOf = (businessId) => BUSINESSES[businessId]?.tenantId ?? null
  const comparable = (selected, target) => tenantOf(target) === null || tenantOf(target) === tenantOf(selected)

  it.each(SELECTIONS)('%s selecting %s: every capability on every Business of its Tenant matches legacy', async (name, selected) => {
    const response = await scopeOf(name, selected)
    expect(response.status).toBe(200)
    expect(response.body.data.tenantId).toBe(tenantOf(selected))
    const scope = scopeFromGrants({ ...response.body.data, delegationId: 'parity' })
    const matrix = []
    for (const businessId of TARGETS.filter((target) => comparable(selected, target))) {
      for (const [capability, [legacy, scm]] of Object.entries(CAPABILITIES)) {
        matrix.push({ businessId, capability, legacy: await allows(() => legacy(viewers[name], businessId)), scm: scmAllows(() => scm(scope, businessId)) })
      }
    }
    expect(matrix.filter((row) => row.legacy !== row.scm)).toEqual([])
    // The matrix is not vacuous across the viewers: each one exercises at least one refusal.
    expect(matrix.some((row) => !row.legacy)).toBe(true)
    // Another Tenant's Business never has a grant in this scope.
    for (const businessId of Object.keys(response.body.data.grants)) expect(tenantOf(businessId)).toBe(tenantOf(selected))
  })

  it('the deleted Business is exercised: legacy passes its gate, then 404s it like SCM', async () => {
    expect(legacyCommerce.mayView(viewers.stale, 'b-gone')).toBe(true)
    await expect(legacyCommerce.loadBusiness(legacyDb, viewers.stale, 'b-gone')).rejects.toMatchObject({ status: 404 })
    expect(SELECTIONS).toContainEqual(['stale', 'b-1'])
  })

  it('the viewer set exercises every capability in both directions', async () => {
    const seen = new Map()
    for (const [name, selected] of SELECTIONS) {
      const scope = scopeFromGrants({ ...(await scopeOf(name, selected)).body.data, delegationId: 'parity' })
      for (const businessId of TARGETS) {
        for (const [capability, [, scm]] of Object.entries(CAPABILITIES)) {
          const entry = seen.get(capability) ?? new Set()
          entry.add(scmAllows(() => scm(scope, businessId)))
          seen.set(capability, entry)
        }
      }
    }
    for (const [capability, outcomes] of seen) expect([capability, [...outcomes].sort()]).toEqual([capability, [false, true]])
  })
})

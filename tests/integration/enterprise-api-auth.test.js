import { describe, it, expect, beforeAll } from 'vitest'

import prisma from '@/lib/db'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import { mintApiAccessKey } from '@/modules/identity/api-access-auth'
import { makeOperatorViewer } from '../factories/viewer'
import { POST as DRY_RUN } from '@/app/api/import/dry-run/route'
import { POST as COMMIT } from '@/app/api/import/commit/route'
import { GET as RESOLVE } from '@/app/api/resolve/route'
import { GET as DOCS } from '@/app/api/docs/route'

// @req FR-106 — the FR-019 Enterprise API surface (dry-run, commit, resolve,
// docs) authenticates a Tenant-bound `Authorization: Bearer apik_...` key
// end-to-end through the actual route handlers. The contract this suite pins
// (SDD-008 — these endpoints have existing consumers):
//   * a request with no credential still 401s exactly as before FR-106;
//   * an invalid or revoked key answers identically to no credential at all —
//     no enumeration oracle over keys;
//   * a valid key acts only inside its own Tenant: another Tenant's workspace,
//     project or external id answers exactly as one that does not exist
//     (SEC-001, BR-002).
// @spec SEC-006, SEC-001, BR-002, ADR-047
// @tested tests/integration/enterprise-api-auth.test.js

let home   // { tenant, business, workspace } — the key's own Tenant
let other  // a second Tenant the key must never reach
let homeKey, otherKey

const operator = () => makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })

const planFor = (workspaceCode, projectCode, { externalRefs } = {}) => ({
  schemaVersion: externalRefs ? '1.1' : '1.0',
  generatedBy: 'enterprise-integration-test',
  scope: { workspaceCode },
  project: { code: projectCode, name: 'Enterprise Program', status: 'ACTIVE', ...(externalRefs ? { externalRefs } : {}) },
  workstreams: [
    {
      code: `${projectCode}-WST`,
      name: 'Delivery',
      executionMode: 'SOFTWARE_SPRINT',
      progressStrategy: 'TASK_WEIGHT',
      items: [{ code: `${projectCode}-T1`, subtype: 'TASK', title: 'Task 1', status: 'PLANNED', weight: 1 }],
    },
  ],
})

async function scope(suffix) {
  const portfolio = await createPortfolio({ name: `Ent Auth Group ${suffix}`, code: `PF-ENTAUTH-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Ent Auth Tenant ${suffix}`, code: `TNT-ENTAUTH-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `Ent Auth Business ${suffix}`, code: `BUS-ENTAUTH-${suffix}` })
  const workspace = await createWorkspace({
    name: `Ent Auth WS ${suffix}`,
    scopeType: 'BUSINESS',
    businessId: business.id,
    code: `WS-ENTAUTH-${suffix}`,
  })
  return { portfolio, tenant, business, workspace }
}

function postJson(handler, url, body, headers = {}) {
  return handler(new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
}

const dryRun = (body, headers) => postJson(DRY_RUN, 'http://production.example/api/import/dry-run', body, headers)
const commit = (body, headers) => postJson(COMMIT, 'http://production.example/api/import/commit', body, headers)
const resolve = (query, headers = {}) => RESOLVE(new Request(`http://production.example/api/resolve?${query}`, { headers }))
const bearer = (key) => ({ authorization: `Bearer ${key}` })

beforeAll(async () => {
  home = await scope('HOME')
  other = await scope('OTHER')
  homeKey = (await mintApiAccessKey({ label: 'home-integrator', tenantId: home.tenant.id, viewer: operator() })).key
  otherKey = (await mintApiAccessKey({ label: 'other-integrator', tenantId: other.tenant.id, viewer: operator() })).key
})

describe('FR-106 refusal contract — before anything else', () => {
  it('no credential at all is refused with the unchanged 401', async () => {
    for (const res of [
      await dryRun({ plan: planFor('WS-ENTAUTH-HOME', 'PRJ-ENT-NOAUTH') }),
      await commit({ plan: planFor('WS-ENTAUTH-HOME', 'PRJ-ENT-NOAUTH') }),
      await resolve('type=PROJECT&code=PRJ-ENT-NOAUTH'),
    ]) {
      expect(res.status).toBe(401)
    }
    expect(await prisma.project.findUnique({ where: { code: 'PRJ-ENT-NOAUTH' } })).toBeNull()
  })

  it('an invalid key and a revoked key answer identically to no key at all', async () => {
    const minted = await mintApiAccessKey({ label: 'to-revoke', tenantId: home.tenant.id, viewer: operator() })
    await prisma.apiAccessKey.update({ where: { id: minted.id }, data: { status: 'REVOKED' } })

    const none = await dryRun({ plan: planFor('WS-ENTAUTH-HOME', 'PRJ-ENT-ORACLE') })
    const invalid = await dryRun({ plan: planFor('WS-ENTAUTH-HOME', 'PRJ-ENT-ORACLE') }, bearer('apik_definitely_not_a_key'))
    const revoked = await dryRun({ plan: planFor('WS-ENTAUTH-HOME', 'PRJ-ENT-ORACLE') }, bearer(minted.key))

    expect(none.status).toBe(401)
    expect(invalid.status).toBe(401)
    expect(revoked.status).toBe(401)
    const noneBody = await none.json()
    expect(await invalid.json()).toEqual(noneBody)
    expect(await revoked.json()).toEqual(noneBody)
  })
})

describe('FR-106 a valid key works inside its own Tenant', () => {
  it('dry-runs and commits an envelope with external ids, then resolves them back', async () => {
    const plan = planFor('WS-ENTAUTH-HOME', 'PRJ-ENT-OK', {
      externalRefs: [{ system: 'SAP', id: 'PS-2026-9001' }],
    })
    const dry = await dryRun({ plan }, bearer(homeKey))
    expect(dry.status).toBe(200)
    expect((await dry.json()).valid).toBe(true)

    const committed = await commit({ plan }, bearer(homeKey))
    expect(committed.status).toBe(200)
    expect((await committed.json()).committed).toBe(true)

    const byCode = await resolve('type=PROJECT&code=PRJ-ENT-OK', bearer(homeKey))
    expect(byCode.status).toBe(200)
    expect((await byCode.json()).code).toBe('PRJ-ENT-OK')

    const byExternalId = await resolve('system=SAP&value=PS-2026-9001', bearer(homeKey))
    expect(byExternalId.status).toBe(200)
    const hit = await byExternalId.json()
    expect(hit.code).toBe('PRJ-ENT-OK')
    expect(hit.externalRef.system).toBe('SAP')
  })
})

describe('FR-106 a key can never widen the surface beyond its own Tenant', () => {
  it('a write into another Tenant\'s workspace answers exactly as a workspace that does not exist', async () => {
    const real = await dryRun(
      { plan: planFor('WS-ENTAUTH-HOME', 'PRJ-ENT-HIJACK') },
      bearer(otherKey),
    )
    const fabricated = await dryRun(
      { plan: planFor('WS-ENTAUTH-DOES-NOT-EXIST', 'PRJ-ENT-HIJACK') },
      bearer(otherKey),
    )
    expect(real.status).toBe(200)
    expect(fabricated.status).toBe(200)
    const realBody = await real.json()
    const fabricatedBody = await fabricated.json()
    expect(realBody.valid).toBe(false)
    expect(realBody.preview).toBeNull()
    // Same refusal shape for a real foreign workspace and a fabricated one —
    // the code in the message is the caller's own input, not a disclosure.
    expect(realBody.errors[0].replace('WS-ENTAUTH-HOME', 'X')).toBe(
      fabricatedBody.errors[0].replace('WS-ENTAUTH-DOES-NOT-EXIST', 'X'),
    )
  })

  it('writes nothing on the refused commit', async () => {
    const res = await commit({ plan: planFor('WS-ENTAUTH-HOME', 'PRJ-ENT-HIJACK2') }, bearer(otherKey))
    expect(res.status).toBe(200)
    expect((await res.json()).committed).toBe(false)
    expect(await prisma.project.findUnique({ where: { code: 'PRJ-ENT-HIJACK2' } })).toBeNull()
  })

  it('an explicit workspaceId naming another Tenant is refused the same generic way', async () => {
    const res = await dryRun(
      { plan: planFor('WS-ENTAUTH-HOME', 'PRJ-ENT-HIJACK3'), workspaceId: home.workspace.id },
      bearer(otherKey),
    )
    const body = await res.json()
    expect(body.valid).toBe(false)
    expect(body.preview).toBeNull()
  })

  it('resolving another Tenant\'s project answers exactly as one that does not exist', async () => {
    const foreign = await resolve('type=PROJECT&code=PRJ-ENT-OK', bearer(otherKey))
    const missing = await resolve('type=PROJECT&code=PRJ-ENT-NEVER-EXISTED', bearer(otherKey))
    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    expect((await foreign.json()).error.replace('PRJ-ENT-OK', 'X')).toBe(
      (await missing.json()).error.replace('PRJ-ENT-NEVER-EXISTED', 'X'),
    )
  })

  it('resolving another Tenant\'s external id answers exactly as an unmapped one', async () => {
    const foreign = await resolve('system=SAP&value=PS-2026-9001', bearer(otherKey))
    const unmapped = await resolve('system=SAP&value=PS-0000-0000', bearer(otherKey))
    expect(foreign.status).toBe(404)
    expect(unmapped.status).toBe(404)
    expect((await foreign.json()).error.replace('PS-2026-9001', 'X')).toBe(
      (await unmapped.json()).error.replace('PS-0000-0000', 'X'),
    )
  })

  it('CONTROL: the identical foreign reads succeed for the Tenant\'s own key', async () => {
    // Without this, every refusal above could pass for an unrelated reason.
    const own = await resolve('type=PROJECT&code=PRJ-ENT-OK', bearer(homeKey))
    expect(own.status).toBe(200)
  })
})

describe('FR-106 GET /api/docs', () => {
  it('loopback still serves the contract with no credential (unchanged)', async () => {
    const res = await DOCS(new Request('http://localhost:3100/api/docs'))
    expect(res.status).toBe(200)
  })

  it('non-loopback serves the contract to a valid key and refuses without one', async () => {
    const withKey = await DOCS(new Request('http://production.example/api/docs', { headers: bearer(homeKey) }))
    expect(withKey.status).toBe(200)

    const without = await DOCS(new Request('http://production.example/api/docs'))
    expect(without.status).toBe(401)

    const revoked = await mintApiAccessKey({ label: 'docs-revoked', tenantId: home.tenant.id, viewer: operator() })
    await prisma.apiAccessKey.update({ where: { id: revoked.id }, data: { status: 'REVOKED' } })
    const withRevoked = await DOCS(new Request('http://production.example/api/docs', { headers: bearer(revoked.key) }))
    expect(withRevoked.status).toBe(401)
  })
})

import { describe, it, expect } from 'vitest'
import { resolvePhase1RequestScope } from '@/modules/agent/phase1-runtime'

// @req FR-052 — server-owned LINE scope: a caller may present binding identity only.
// @spec BR-012 — Tenant and Business scope are server authority; inbound
//   tenantId/businessId never authorize access, and a missing binding fails closed
//   BEFORE model or persistence work.
// @spec SEC-010 — production LINE ingress is deny-by-default.
//
// The regression under test: when no Phase 1 runtime is composed (the default —
// ZURI_LINE_BUSINESS_AGENT_ENABLED is "false" in .env.example), the resolver used to
// fall back to client-supplied tenantId/businessId with no credential check at all.
// In production that made POST /api/agent/line-webhook an unauthenticated,
// caller-selected-tenant write path.

const headers = new Headers()

function call({ runtime = null, body = {}, env = {} }) {
  return resolvePhase1RequestScope({ runtime, headers, body, env })
}

describe('resolvePhase1RequestScope — unbound scope fails closed in production (BR-012)', () => {
  it('refuses client-selected scope in production when no runtime is composed', async () => {
    await expect(call({
      env: { NODE_ENV: 'production' },
      body: { tenantId: 'tenant-attacker-chose', businessId: 'business-attacker-chose' },
    })).rejects.toMatchObject({
      message: 'PHASE1_BINDING_REQUIRED',
      status: 401,
    })
  })

  it('refuses an empty body in production rather than reporting a missing tenant', async () => {
    // A 400 "TENANT_ID_REQUIRED" would tell an unauthenticated caller that supplying
    // a tenant is all that stands between them and the turn. Production says 401.
    await expect(call({ env: { NODE_ENV: 'production' }, body: {} }))
      .rejects.toMatchObject({ status: 401 })
  })

  it('refuses production callers that present a binding when no resolver exists', async () => {
    await expect(call({
      env: { NODE_ENV: 'production' },
      body: { bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9', destination: 'U-smartgift' },
    })).rejects.toMatchObject({ status: 401 })
  })

  it('keeps the lab client-scope seam outside production', async () => {
    await expect(call({
      env: { NODE_ENV: 'test' },
      body: { tenantId: 'tenant-lab', businessId: 'business-lab' },
    })).resolves.toEqual({ tenantId: 'tenant-lab', businessId: 'business-lab' })
  })

  it('still refuses a lab request with no tenant at all', async () => {
    await expect(call({ env: { NODE_ENV: 'test' }, body: {} }))
      .rejects.toMatchObject({ message: 'TENANT_ID_REQUIRED', status: 400 })
  })

  it('still refuses client scope when a runtime IS composed', async () => {
    const runtime = { bindingResolver: { resolve: async () => { throw new Error('must not be called') } } }
    await expect(call({
      runtime,
      env: { NODE_ENV: 'production' },
      body: { tenantId: 'tenant-x', bindingId: 'b', destination: 'd' },
    })).rejects.toMatchObject({ message: 'PHASE1_CLIENT_SCOPE_FORBIDDEN', status: 400 })
  })

  it('resolves through the binding resolver when a runtime IS composed', async () => {
    const runtime = {
      bindingResolver: {
        resolve: async () => ({ id: 'bind-1', code: 'LINE-OA', tenantId: 't1', businessId: 'b1' }),
      },
    }
    await expect(call({
      runtime,
      env: { NODE_ENV: 'production' },
      body: { bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9', destination: 'U-smartgift' },
    })).resolves.toMatchObject({ tenantId: 't1', businessId: 'b1' })
  })
})

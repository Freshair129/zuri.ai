// @req FR-077 — Project Inventory survives a stalled event loop instead of answering HTTP 400.
// @spec SDD-045, ADR-034
// @tested tests/integration/project-inventory-stall.test.js
//
// Regression for the e2e flake in fr077-project-inventory.spec.js ("limit=1 ... returned
// HTTP 400", passed on retry; see .brain/rca/2026-09-11-fr077-inventory-expired-transaction.md).
// The read model used to run inside a Prisma interactive transaction. Prisma expires an
// interactive transaction 5 s after it starts, measured in wall time, so any stall of the
// Node event loop while it is open — a Next dev-server compile in e2e, GC or CPU pressure in
// production — made the next query fail with "Transaction already closed: A batch query
// cannot be executed on an expired transaction", which the API error mapper turns into a
// 400 because the message contains "cannot". This test stalls the event loop for 6 s right
// after the Project lookup and requires a normal 200 response.
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { handle } from '@/app/api/_helpers'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { getProjectInventory } from '@/modules/project-manager/application/project-inventory-read-model'

const STALL_MS = 6000 // longer than Prisma's 5 s interactive-transaction timeout

function stallAfterProjectLookup(client) {
  return new Proxy(client, {
    get(target, prop) {
      const value = target[prop]
      if (prop === '$transaction') {
        // If the read model opens an interactive transaction, stall inside it too.
        return (fn, options) => target.$transaction((tx) => fn(stallAfterProjectLookup(tx)), options)
      }
      if (prop !== 'project') return typeof value === 'function' ? value.bind(target) : value
      return new Proxy(value, {
        get(model, method) {
          const original = model[method]
          if (method !== 'findUnique') return typeof original === 'function' ? original.bind(model) : original
          return async (...args) => {
            const row = await original.apply(model, args)
            const until = Date.now() + STALL_MS
            while (Date.now() < until) { /* synchronous stall, as a dev-server compile does */ }
            return row
          }
        },
      })
    },
  })
}

describe('FR-077 Project Inventory under an event-loop stall', () => {
  it('answers 200 with partial metadata when the event loop stalls for longer than 5 s mid-read', async () => {
    const suffix = String(Date.now())
    const portfolio = await createPortfolio({ name: `Stall Group ${suffix}`, code: `PF-STALL-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Stall Tenant ${suffix}`, code: `TNT-STALL-${suffix}` })
    const business = await createBusiness({ tenantId: tenant.id, name: `Stall Business ${suffix}`, code: `BUS-STALL-${suffix}` })
    const workspace = await createWorkspace({ name: `Stall Space ${suffix}`, scopeType: 'BUSINESS', businessId: business.id, code: `WS-STALL-${suffix}` })
    const viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    const project = await createProject({ workspaceId: workspace.id, name: `Stall Project ${suffix}`, code: `PRJ-STALL-${suffix}` }, { viewer })
    await createWorkstream({ projectId: project.id, name: 'Stall WS 1', code: `WST-STALL-1-${suffix}`, executionMode: 'SOFTWARE_SPRINT' }, { viewer })
    await createWorkstream({ projectId: project.id, name: 'Stall WS 2', code: `WST-STALL-2-${suffix}`, executionMode: 'SOFTWARE_SPRINT' }, { viewer })

    const started = Date.now()
    const response = await handle(() => getProjectInventory(project.id, { db: stallAfterProjectLookup(prisma), viewer, limit: 1 }))
    const body = await response.json()

    expect(Date.now() - started).toBeGreaterThanOrEqual(STALL_MS)
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.sections.work.workstreams.status).toBe('PARTIAL')
    expect(body.sections.work.workstreams.truncated).toBe(true)
  }, 30000)
})

// @req FR-068, FR-070 — the Project Roadmap survives a stalled event loop instead of answering HTTP 400.
// @spec SDD-039, ADR-028, ADR-029
// @tested tests/integration/project-roadmap-stall.test.js
//
// The same failure mode FR-077 hit in `project-inventory-stall.test.js`, in the read model the
// FR-077 RCA named as an unfixed follow-up (.brain/rca/2026-09-11-fr077-inventory-expired-transaction.md).
// The read model used to run inside a Prisma interactive transaction. Prisma expires an
// interactive transaction 5 s after it starts, measured in wall time, so any stall of the Node
// event loop while it is open — a Next dev-server compile in e2e, GC or CPU pressure in
// production — made the next query fail with "Transaction already closed: A batch query cannot
// be executed on an expired transaction", which the API error mapper turns into a 400 because
// the message contains "cannot". This test stalls the event loop for 6 s right after the Project
// lookup and requires a normal 200 response.
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { handle } from '@/app/api/_helpers'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { getProjectRoadmap } from '@/modules/project-manager/application/project-roadmap-read-model'

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

let project
let viewer

describe('FR-068 Project Roadmap under an event-loop stall', () => {
  beforeAll(async () => {
    const suffix = String(Date.now())
    const portfolio = await createPortfolio({ name: `Roadmap Stall Group ${suffix}`, code: `PF-RMSTALL-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Roadmap Stall Tenant ${suffix}`, code: `TNT-RMSTALL-${suffix}` })
    const business = await createBusiness({ tenantId: tenant.id, name: `Roadmap Stall Business ${suffix}`, code: `BUS-RMSTALL-${suffix}` })
    const workspace = await createWorkspace({ name: `Roadmap Stall Space ${suffix}`, scopeType: 'BUSINESS', businessId: business.id, code: `WS-RMSTALL-${suffix}` })
    viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    project = await createProject({ workspaceId: workspace.id, name: `Roadmap Stall Project ${suffix}`, code: `PRJ-RMSTALL-${suffix}` }, { viewer })
    await createWorkstream({ projectId: project.id, name: 'Stall WS 1', code: `WST-RMSTALL-1-${suffix}`, executionMode: 'SOFTWARE_SPRINT' }, { viewer })
    await createWorkstream({ projectId: project.id, name: 'Stall WS 2', code: `WST-RMSTALL-2-${suffix}`, executionMode: 'B2B_SALES' }, { viewer })
  }, 30000)

  it('answers 200 with the composed roadmap when the event loop stalls for longer than 5 s mid-read', async () => {
    const started = Date.now()
    const response = await handle(() => getProjectRoadmap(project.id, { db: stallAfterProjectLookup(prisma), viewer }))
    const body = await response.json()

    expect(Date.now() - started).toBeGreaterThanOrEqual(STALL_MS)
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.project.id).toBe(project.id)
    expect(body.plans).toHaveLength(2)
  }, 30000)
})

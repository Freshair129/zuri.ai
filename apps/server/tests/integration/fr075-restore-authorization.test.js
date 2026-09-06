import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer, makeOperatorViewer, makeDevViewer } from '../factories/viewer'
import { exportSnapshot, previewImport, importSnapshot } from '@/modules/project-manager/application/backup-service'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'

// @req FR-075 — a whole-database restore requires installation-operator authority.
// @spec BR-008, SEC-008, ADR-016 D10
//
// This was the last route on the route-viewer baseline, and it stayed there for a
// reason no guard could fix: `importSnapshot` deletes and replaces every
// Portfolio, Tenant, Business, identity and audit row, so owning every Business
// that exists today still says nothing about the rows the snapshot introduces.
// No composition of `ownsBusiness` expresses that. The answer was to name a
// capability at the scope the operation actually acts on.

let snapshot, ownsEverything, operator

async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-075 restore authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Restore Group', code: 'PF-RST' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Restore Tenant', code: 'TNT-RST' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Restore Business', code: 'BUS-RST' })
    await createWorkspace({ name: 'Restore WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-RST' })

    // The viewer that matters: owns every Business in the installation and owns
    // the Tenant too. If ownership could ever add up to a restore, this is the
    // shape that would do it.
    ownsEverything = makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      ownedTenantIds: [tenant.id],
    })
    operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    snapshot = await exportSnapshot()
  })

  it('refuses the most privileged ordinary principal, and permits the operator', async () => {
    const error = await refusalFrom(() => importSnapshot(snapshot, { confirm: true, viewer: ownsEverything }))
    expect(error.status).toBe(403)
    expect(error.message).toMatch(/operator authority/)

    // The control: the same snapshot, the same confirm, an operator — it works.
    const restored = await importSnapshot(snapshot, { confirm: true, viewer: operator })
    expect(restored.restored).toBe(true)
  })

  it('writes nothing when refused', async () => {
    const before = {
      portfolio: await prisma.portfolio.count(),
      tenant: await prisma.tenant.count(),
      business: await prisma.business.count(),
      project: await prisma.project.count(),
    }
    await refusalFrom(() => importSnapshot(snapshot, { confirm: true, viewer: ownsEverything }))
    expect({
      portfolio: await prisma.portfolio.count(),
      tenant: await prisma.tenant.count(),
      business: await prisma.business.count(),
      project: await prisma.project.count(),
    }).toEqual(before)
  })

  it('guards the preview too, because it counts every table in every tenant', async () => {
    // Guarding only the confirmed restore would leave the preview handing out
    // exactly the cross-tenant census the restore guard exists to protect.
    // FR-065 made the identical call for the import dry run.
    const error = await refusalFrom(() => previewImport(snapshot, { viewer: ownsEverything }))
    expect(error.status).toBe(403)

    const preview = await previewImport(snapshot, { viewer: operator })
    expect(preview.current).toBeDefined()
  })

  it('a platform DEV is an operator; ownership is not', async () => {
    // The one place `isPlatform` legitimately implies authority — because the
    // question is installation-wide, not per-Business. It owns nothing and may
    // still restore, which is exactly the asymmetry FR-075 names.
    const dev = makeDevViewer({ visibleBusinessIds: [] })
    const preview = await previewImport(snapshot, { viewer: dev })
    expect(preview.current).toBeDefined()
    expect(dev.ownedBusinessIds).toEqual([])
  })

  it('a missing viewer is a loud crash, not a quiet restore', async () => {
    const error = await refusalFrom(() => importSnapshot(snapshot, { confirm: true }))
    expect(error.message).toMatch(/viewer is required/)
    expect(error.status).toBeUndefined()
  })
})

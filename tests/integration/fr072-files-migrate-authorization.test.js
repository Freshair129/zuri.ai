// @req FR-072, FR-075 — `migrateProjectFiles` (the one-time legacy
// ProjectFile→FileAsset backfill) is a global, cross-tenant operation: every
// Business's ProjectFile rows, not one the caller owns. It previously gated on
// `['OWNER', 'DEV'].includes(viewer.role)` at the route layer — a
// per-principal label, not per-Business authority, and one that admitted
// every platform DEV (who `resolveViewer` never lets own a Business) and any
// OWNER anywhere, not only one who administers the installation. The correct
// authority is `isInstallationOperator` (FR-075), the same capability
// `exportSnapshot`/`importSnapshot` require for the installation-wide
// backup/restore surface (see tests/integration/fr075-restore-authorization.test.js,
// whose shape this file follows).
// @spec ADR-016 D10, SEC-001, SEC-008, BR-001
// @tested tests/integration/fr072-files-migrate-authorization.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer, makeOperatorViewer, makeDevViewer, ownsElsewhere } from '../factories/viewer'
import { migrateProjectFiles } from '@/modules/project-manager/application/file-asset-service'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { createProject } from '@/modules/project-manager/application/project-service'

let business, ownsEverything, attacker, operator

async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-072 migrateProjectFiles authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Migrate Group', code: 'PF-MIG' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Migrate Tenant', code: 'TNT-MIG' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Migrate Business', code: 'BUS-MIG' })
    const workspace = await createWorkspace({ name: 'Migrate WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-MIG' })
    const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    await createProject({ workspaceId: workspace.id, name: 'Migrate Project', code: 'PRJ-MIG' }, { viewer: owner })

    // The viewer that matters most: owns every Business in the installation and
    // carries the global OWNER role label the route used to trust. If ownership
    // (or the role string) could ever add up to permission for a global,
    // cross-tenant migration, this is the shape that would prove it.
    ownsEverything = makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      ownedTenantIds: [tenant.id],
      role: 'OWNER',
    })
    attacker = ownsElsewhere({ owns: 'business-owned-elsewhere', sees: business.id })
    operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
  })

  it('refuses the most privileged ordinary OWNER, and permits the installation operator', async () => {
    const error = await refusalFrom(() => migrateProjectFiles({ confirm: false }, { viewer: ownsEverything }))
    expect(error.status).toBe(404)

    const preview = await migrateProjectFiles({ confirm: false }, { viewer: operator })
    expect(preview).toMatchObject({ confirmed: false })
  })

  it('refuses a plain platform DEV without operator authority just as it refuses an OWNER', async () => {
    const dev = makeDevViewer({ visibleBusinessIds: [], isOperator: false })
    const error = await refusalFrom(() => migrateProjectFiles({ confirm: false }, { viewer: dev }))
    expect(error.status).toBe(404)
  })

  it('a platform DEV who also carries operator authority is admitted — isOperator is the capability, not the role label', async () => {
    const devOperator = makeDevViewer({ visibleBusinessIds: [], isOperator: true })
    const preview = await migrateProjectFiles({ confirm: false }, { viewer: devOperator })
    expect(preview).toMatchObject({ confirmed: false })
  })

  it('refuses a viewer who merely sees the target Business (not an owner, not an operator)', async () => {
    const error = await refusalFrom(() => migrateProjectFiles({ confirm: false }, { viewer: attacker }))
    expect(error.status).toBe(404)
  })

  it('writes nothing when refused', async () => {
    const before = await prisma.fileAsset.count()
    await refusalFrom(() => migrateProjectFiles({ confirm: true }, { viewer: ownsEverything }))
    expect(await prisma.fileAsset.count()).toBe(before)
  })

  it('a missing viewer is a loud crash, not a quiet migration', async () => {
    const error = await refusalFrom(() => migrateProjectFiles({ confirm: false }, {}))
    expect(error.message).toMatch(/viewer is required/)
    expect(error.status).toBeUndefined()
  })
})

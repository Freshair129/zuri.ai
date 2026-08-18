import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
// @req FR-075 — restore is an installation-wide operation; these cases arrange
// as the operator, and fr075-restore-authorization.test.js is where the refusal
// side is proven.
import { makeOperatorViewer } from '../factories/viewer'
import {
  exportSnapshot,
  previewImport,
  importSnapshot,
} from '@/modules/project-manager/application/backup-service'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import { createProject } from '@/modules/project-manager/application/project-service'
import { makeViewer } from '../factories/viewer'

let owner

describe('snapshot backup round trip', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Backup Group', code: 'PF-BAK' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Backup Tenant', code: 'TNT-BAK' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Backup Business', code: 'BUS-BAK' })
    const workspace = await createWorkspace({ name: 'Backup WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-BAK' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    await createProject({ workspaceId: workspace.id, name: 'Backup Project', code: 'PRJ-BAK' }, { viewer: owner })
  })

  it('export includes schema version, timestamp and table counts', async () => {
    const snapshot = await exportSnapshot()
    expect(snapshot.schemaVersion).toBe('1.0')
    expect(snapshot.exportedAt).toBeTruthy()
    expect(snapshot.tables.project.length).toBeGreaterThan(0)
    expect(snapshot.tables.portfolio.length).toBeGreaterThan(0)
  })

  it('rejects invalid snapshot on preview', async () => {
    const preview = await previewImport({ schemaVersion: '9.9', tables: {} }, { viewer: makeOperatorViewer() })
    expect(preview.valid).toBe(false)
  })

  it('import without confirm only previews (no writes)', async () => {
    const snapshot = await exportSnapshot()
    const before = await prisma.project.count()
    const result = await importSnapshot(snapshot, { confirm: false, viewer: makeOperatorViewer() })
    expect(result.restored).toBe(false)
    expect(result.needsConfirmation).toBe(true)
    expect(result.wouldReplace).toBe(true)
    expect(await prisma.project.count()).toBe(before)
  })

  it('round trip: export → mutate → confirm import → data restored', async () => {
    const snapshot = await exportSnapshot()
    const projectCountAtExport = snapshot.tables.project.length

    // Mutate: add an extra project after the snapshot.
    const ws = await prisma.workspace.findUnique({ where: { code: 'WS-BAK' } })
    await createProject({ workspaceId: ws.id, name: 'Post-snapshot project', code: 'PRJ-BAK-EXTRA' }, { viewer: owner })
    expect(await prisma.project.count()).toBe(projectCountAtExport + 1)

    // Restore with confirmation.
    const result = await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })
    expect(result.restored).toBe(true)
    expect(await prisma.project.count()).toBe(projectCountAtExport)
    expect(await prisma.project.findUnique({ where: { code: 'PRJ-BAK-EXTRA' } })).toBeNull()
    expect(await prisma.project.findUnique({ where: { code: 'PRJ-BAK' } })).toBeTruthy()

    // Audit trail survives restore (snapshot contains audit events + RESTORED is recorded post-restore).
    const restoredAudit = await prisma.auditEvent.findFirst({ where: { action: 'RESTORED' } })
    expect(restoredAudit).toBeTruthy()
  })
})

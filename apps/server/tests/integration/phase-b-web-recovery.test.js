// @req FR-252, FR-013 — web replacement must preserve protected Phase B evidence.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/phase-b-web-recovery.test.js
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { exportSnapshot, importSnapshot } from '@/modules/project-manager/application/backup-service'
import { PHASE_B_FAMILY_DELEGATES } from '@/modules/project-manager/application/phase-b-backup'
import { createProject } from '@/modules/project-manager/application/project-service'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeDevViewer, makeViewer } from '../factories/viewer'

const createdFeatures = []
const operator = makeDevViewer()
async function fixture() {
  const code = randomUUID().slice(0, 8).toUpperCase()
  const portfolio = await createPortfolio({ name: 'Recovery group', code: `PF-PBR-${code}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Recovery tenant', code: `TN-PBR-${code}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'Recovery business', code: `BU-PBR-${code}` })
  const workspace = await createWorkspace({ businessId: business.id, scopeType: 'BUSINESS', name: 'Recovery workspace', code: `WS-PBR-${code}` })
  const viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  const project = await createProject({ workspaceId: workspace.id, name: 'Recovery project', code: `PR-PBR-${code}` }, { viewer })
  const data = { id: randomUUID(), tenantId: tenant.id, businessId: business.id, projectId: project.id, code: `FE-${code}`, title: 'Protected title', problem: 'Protected problem', outcome: 'Protected outcome', primaryDomainId: 'DOM-PROJECT-MANAGER', lifecycle: 'DRAFT' }
  createdFeatures.push(data.id)
  return { project, data }
}
afterEach(async () => {
  await prisma.projectFeature.deleteMany({ where: { id: { in: createdFeatures.splice(0) } } })
})
const restoredAudits = () => prisma.auditEvent.count({ where: { entityType: 'SNAPSHOT', action: 'RESTORED' } })

describe('Phase B web recovery boundary', () => {
  it('exports complete arrays and refuses replacement while current protected data exists', async () => {
    const f = await fixture()
    await prisma.projectFeature.create({ data: f.data })
    const snapshot = await exportSnapshot()
    expect(snapshot.phaseBRecovery.requiredTables).toEqual(PHASE_B_FAMILY_DELEGATES)
    for (const family of PHASE_B_FAMILY_DELEGATES) expect(Array.isArray(snapshot.tables[family])).toBe(true)
    expect(snapshot.tables.projectFeature.some(row => row.id === f.data.id)).toBe(true)
    const count = await restoredAudits()
    const result = await importSnapshot(snapshot, { confirm: true, viewer: operator })
    expect(result).toMatchObject({ restored: false, valid: false, errorCode: 'PHASE_B_RECOVERY_MAINTENANCE_REQUIRED' })
    expect(await prisma.projectFeature.findUnique({ where: { id: f.data.id } })).toMatchObject({ title: 'Protected title', version: 1 })
    expect(await prisma.project.findUnique({ where: { id: f.project.id } })).not.toBeNull()
    expect(await restoredAudits()).toBe(count)
  })

  it('refuses incoming protected rows even after their source rows were removed', async () => {
    const f = await fixture()
    await prisma.projectFeature.create({ data: f.data })
    const snapshot = await exportSnapshot()
    await prisma.projectFeature.delete({ where: { id: f.data.id } })
    const count = await restoredAudits()
    expect(await importSnapshot(snapshot, { confirm: true, viewer: operator })).toMatchObject({ restored: false, errorCode: 'PHASE_B_RECOVERY_MAINTENANCE_REQUIRED' })
    expect(await prisma.projectFeature.count({ where: { id: f.data.id } })).toBe(0)
    expect(await restoredAudits()).toBe(count)
  })

  it.each(['missing', 'null', 'wrong-type'])('rejects a %s member of the six-family set before deletion', async kind => {
    const f = await fixture()
    const snapshot = await exportSnapshot()
    if (kind === 'missing') delete snapshot.tables.requirementBinding
    else snapshot.tables.requirementBinding = kind === 'null' ? null : {}
    const count = await restoredAudits()
    expect(await importSnapshot(snapshot, { confirm: true, viewer: operator })).toMatchObject({ restored: false, valid: false })
    expect(await prisma.project.findUnique({ where: { id: f.project.id } })).not.toBeNull()
    expect(await restoredAudits()).toBe(count)
  })

  it('rechecks inside the replacement transaction after an earlier empty preview', async () => {
    const f = await fixture()
    const snapshot = await exportSnapshot()
    let transactions = 0
    const db = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return (work, options) => target.$transaction(async tx => {
        transactions += 1
        if (transactions === 2) await tx.projectFeature.create({ data: f.data })
        return work(tx)
      }, options)
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const count = await restoredAudits()
    expect(await importSnapshot(snapshot, { confirm: true, viewer: operator, db })).toMatchObject({ restored: false, errorCode: 'PHASE_B_RECOVERY_MAINTENANCE_REQUIRED' })
    expect(transactions).toBe(2)
    expect(await prisma.project.findUnique({ where: { id: f.project.id } })).not.toBeNull()
    expect(await prisma.projectFeature.count({ where: { id: f.data.id } })).toBe(0)
    expect(await restoredAudits()).toBe(count)
  })
})

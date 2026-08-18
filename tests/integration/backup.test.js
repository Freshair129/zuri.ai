import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
// @req FR-075 — restore is an installation-wide operation; these cases arrange
// as the operator, and fr075-restore-authorization.test.js is where the refusal
// side is proven.
// @req FR-078 — customer import ledger, review case and decision tables must be
// included in snapshots.
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

let owner, business, project

describe('snapshot backup round trip', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Backup Group', code: 'PF-BAK' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Backup Tenant', code: 'TNT-BAK' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Backup Business', code: 'BUS-BAK' })
    const workspace = await createWorkspace({ name: 'Backup WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-BAK' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    project = await createProject({ workspaceId: workspace.id, name: 'Backup Project', code: 'PRJ-BAK' }, { viewer: owner })

    // Five models sat outside SNAPSHOT_MODELS across two shipped requirements and
    // a green suite, because no test ever created a row in one. Coverage of a
    // model's code is not coverage of its presence in the database, and only the
    // second exercises the restore path. These fixtures close that gap, and they
    // prove restore ORDER too — which the preflight check cannot.
    // @spec .brain/rca/2026-08-18-snapshot-model-list-drifted-from-the-schema.md
    const person = await prisma.person.create({ data: { code: 'PER-BAK', displayName: 'Backup Person' } })
    const roadmap = await prisma.businessRoadmap.create({
      data: { businessId: business.id, code: 'ROAD-BAK', title: 'Backup roadmap' },
    })
    const horizon = await prisma.businessRoadmapHorizon.create({
      data: { roadmapId: roadmap.id, key: 'NOW', label: 'Now', position: 1 },
    })
    const goal = await prisma.businessGoal.create({
      data: { businessId: business.id, roadmapId: roadmap.id, horizonId: horizon.id, code: 'GOAL-BAK', title: 'Backup goal' },
    })
    await prisma.projectGoal.create({ data: { projectId: project.id, goalId: goal.id } })
    await prisma.roleBinding.create({
      data: { personId: person.id, tenantId: tenant.id, businessId: business.id, roleKey: 'PRODUCT_OWNER' },
    })
    const customer = await prisma.customer.create({
      data: {
        code: 'CUS-BAK-IMPORT',
        tenantId: tenant.id,
        businessId: business.id,
        personId: person.id,
        displayName: 'Backup imported customer',
      },
    })
    const batch = await prisma.customerImportBatch.create({
      data: {
        contractId: 'CDC-BAK',
        missionId: 'MIS-BAK',
        versionId: 'VER-BAK',
        tenantId: tenant.id,
        businessId: business.id,
        sourceRef: 'BACKUP_TEST',
        snapshotSha256: 'a'.repeat(64),
        sourceRowCount: 1,
        publishRowCount: 1,
        heldRowCount: 0,
        status: 'APPLIED',
        approvedByPersonId: person.id,
      },
    })
    const provenance = await prisma.customerImportProvenance.create({
      data: {
        batchId: batch.id,
        sourceSystem: 'BACKUP_TEST',
        sourceTable: 'customer',
        sourceRecordKey: 'C-BAK-001',
        sourceRow: 1,
        sourceSha256: 'b'.repeat(64),
        snapshotSha256: 'a'.repeat(64),
        idempotencyKey: 'BACKUP_TEST|customer|C-BAK-001|' + 'a'.repeat(64),
        resolutionStatus: 'NEW_CANDIDATE',
        matchMethod: 'NONE',
        disposition: 'PUBLISH',
        personId: person.id,
        customerId: customer.id,
      },
    })
    const reviewCase = await prisma.customerImportReviewCase.create({
      data: {
        batchId: batch.id,
        tenantId: tenant.id,
        businessId: business.id,
        reasonCode: 'DUPLICATE_NORMALIZED_NAME',
        groupFingerprint: 'c'.repeat(64),
        itemCount: 1,
        evidenceSummaryJson: JSON.stringify({ normalizedNameMatch: true }),
        items: { connect: { id: provenance.id } },
      },
    })
    await prisma.customerImportReviewDecision.create({
      data: {
        reviewCaseId: reviewCase.id,
        provenanceId: provenance.id,
        action: 'DEFER',
        decidedByPersonId: person.id,
      },
    })
  })

  it('export includes schema version, timestamp and table counts', async () => {
    const snapshot = await exportSnapshot()
    expect(snapshot.schemaVersion).toBe('1.0')
    expect(snapshot.exportedAt).toBeTruthy()
    expect(snapshot.tables.project.length).toBeGreaterThan(0)
    expect(snapshot.tables.portfolio.length).toBeGreaterThan(0)
    // @req FR-081 — a snapshot that omits a table restores an installation missing it.
    expect(snapshot.tables.integrationProvider).toBeInstanceOf(Array)
    expect(snapshot.tables.integrationConnection).toBeInstanceOf(Array)
    expect(snapshot.tables.rawExternalRecord).toBeInstanceOf(Array)
    // Populated, not merely present: an empty array is what a table looks like
    // when nothing ever wrote to it, which is how the gap hid for two releases.
    expect(snapshot.tables.businessRoadmap.length).toBeGreaterThan(0)
    expect(snapshot.tables.businessRoadmapHorizon.length).toBeGreaterThan(0)
    expect(snapshot.tables.businessGoal.length).toBeGreaterThan(0)
    expect(snapshot.tables.projectGoal.length).toBeGreaterThan(0)
    expect(snapshot.tables.roleBinding.length).toBeGreaterThan(0)
    expect(snapshot.tables.customerImportBatch.length).toBeGreaterThan(0)
    expect(snapshot.tables.customerImportProvenance.length).toBeGreaterThan(0)
    expect(snapshot.tables.customerImportReviewCase.length).toBeGreaterThan(0)
    expect(snapshot.tables.customerImportReviewDecision.length).toBeGreaterThan(0)
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

  it('round trip carries the roadmap, goal and role-binding graph, in restorable order', async () => {
    const snapshot = await exportSnapshot()

    // Mutate all five, in ways a restore must undo: two additions and one removal.
    const goal = await prisma.businessGoal.findUnique({ where: { code: 'GOAL-BAK' } })
    await prisma.projectGoal.deleteMany({ where: { goalId: goal.id } })
    await prisma.businessGoal.create({
      data: { businessId: business.id, code: 'GOAL-BAK-EXTRA', title: 'Post-snapshot goal' },
    })
    await prisma.roleBinding.updateMany({ where: { roleKey: 'PRODUCT_OWNER' }, data: { status: 'REVOKED' } })

    const result = await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })
    expect(result.restored).toBe(true)

    // The child edge comes back, which is only possible if its parents were
    // restored first — the ordering assertion the preflight check cannot make.
    const restoredGoal = await prisma.businessGoal.findUnique({ where: { code: 'GOAL-BAK' } })
    expect(restoredGoal).toBeTruthy()
    expect(restoredGoal.roadmapId).toBeTruthy()
    expect(restoredGoal.horizonId).toBeTruthy()
    expect(await prisma.projectGoal.count({ where: { goalId: restoredGoal.id } })).toBe(1)
    expect(await prisma.businessGoal.findUnique({ where: { code: 'GOAL-BAK-EXTRA' } })).toBeNull()

    const binding = await prisma.roleBinding.findFirst({ where: { roleKey: 'PRODUCT_OWNER' } })
    expect(binding.status).toBe('ACTIVE')
  })

  it('round trip carries the customer import batch and provenance edge, in restorable order', async () => {
    const snapshot = await exportSnapshot()
    const batch = snapshot.tables.customerImportBatch.find((row) => row.contractId === 'CDC-BAK')
    const provenance = snapshot.tables.customerImportProvenance.find((row) => row.sourceRecordKey === 'C-BAK-001')
    const reviewCase = snapshot.tables.customerImportReviewCase.find((row) => row.batchId === batch.id)
    const reviewDecision = snapshot.tables.customerImportReviewDecision.find((row) => row.provenanceId === provenance.id)
    const customer = snapshot.tables.customer.find((row) => row.code === 'CUS-BAK-IMPORT')
    expect(batch).toBeTruthy()
    expect(provenance).toBeTruthy()
    expect(reviewCase).toBeTruthy()
    expect(reviewDecision).toBeTruthy()
    expect(customer).toBeTruthy()

    // Mutate both ledger tables before restoring the snapshot.
    await prisma.customerImportReviewDecision.delete({ where: { id: reviewDecision.id } })
    await prisma.customerImportProvenance.delete({ where: { id: provenance.id } })
    await prisma.customerImportBatch.update({ where: { id: batch.id }, data: { status: 'ROLLED_BACK' } })
    expect(await prisma.customerImportProvenance.findUnique({ where: { id: provenance.id } })).toBeNull()
    expect((await prisma.customerImportBatch.findUnique({ where: { id: batch.id } })).status).toBe('ROLLED_BACK')

    const result = await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })
    expect(result.restored).toBe(true)

    const restoredBatch = await prisma.customerImportBatch.findUnique({ where: { id: batch.id } })
    const restoredProvenance = await prisma.customerImportProvenance.findUnique({ where: { id: provenance.id } })
    const restoredReviewCase = await prisma.customerImportReviewCase.findUnique({ where: { id: reviewCase.id } })
    const restoredReviewDecision = await prisma.customerImportReviewDecision.findUnique({ where: { id: reviewDecision.id } })
    expect(restoredBatch.status).toBe('APPLIED')
    expect(restoredProvenance.batchId).toBe(restoredBatch.id)
    expect(restoredProvenance.customerId).toBe(customer.id)
    expect(restoredProvenance.personId).toBe(customer.personId)
    expect(restoredReviewCase.batchId).toBe(restoredBatch.id)
    expect(restoredReviewCase.itemCount).toBe(1)
    expect(restoredReviewDecision.reviewCaseId).toBe(restoredReviewCase.id)
    expect(restoredReviewDecision.provenanceId).toBe(restoredProvenance.id)
  })
})

// @req FR-252 — protected Phase B family validation and same-transaction guard.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/unit/phase-b-backup.test.js

import { describe, expect, it } from 'vitest'
import {
  PHASE_B_FAMILY_DELEGATES,
  PHASE_B_RECOVERY_MANIFEST_VERSION,
  assertPhaseBWebRestoreSafe,
  computeTargetSchemaSha256,
  readPhaseBCounts,
  validatePhaseBSnapshot,
} from '@/modules/project-manager/application/phase-b-backup'

const ids = {
  tenant: '10000000-0000-4000-8000-000000000001',
  business: '10000000-0000-4000-8000-000000000002',
  workspace: '10000000-0000-4000-8000-000000000003',
  project: '10000000-0000-4000-8000-000000000004',
  repository: '10000000-0000-4000-8000-000000000005',
  projectRepository: '10000000-0000-4000-8000-000000000006',
  workstream: '10000000-0000-4000-8000-000000000007',
  workItem: '10000000-0000-4000-8000-000000000008',
  snapshot: '10000000-0000-4000-8000-000000000009',
  proof: '10000000-0000-4000-8000-000000000010',
  feature: '10000000-0000-4000-8000-000000000011',
  audit: '10000000-0000-4000-8000-000000000012',
  principal: '10000000-0000-4000-8000-000000000013',
}
const now = '2026-09-17T00:00:00.000Z'
const hash = 'a'.repeat(64)

function inventory() {
  const applicationTables = [
    ['AuditEvent', 'public', 'AuditEvent'],
    ['Business', 'public', 'Business'],
    ['FeatureContribution', 'public', 'FeatureContribution'],
    ['FeatureWorkLink', 'public', 'FeatureWorkLink'],
    ['GovernanceSnapshot', 'public', 'GovernanceSnapshot'],
    ['Project', 'public', 'Project'],
    ['ProjectFeature', 'public', 'ProjectFeature'],
    ['ProjectFeatureMutationReceipt', 'public', 'ProjectFeatureMutationReceipt'],
    ['ProjectRepository', 'public', 'ProjectRepository'],
    ['Repository', 'public', 'Repository'],
    ['RequirementBinding', 'public', 'RequirementBinding'],
    ['Tenant', 'public', 'Tenant'],
    ['WorkItem', 'public', 'WorkItem'],
    ['Workstream', 'public', 'Workstream'],
    ['Workspace', 'public', 'Workspace'],
  ].map(([modelName, schemaName, tableName]) => ({ modelName, schemaName, tableName }))
  return { schemaSha256: hash, applicationTables, targetSchemaSha256: computeTargetSchemaSha256({ schemaSha256: hash, applicationTables }) }
}

function baseSnapshot() {
  const project = { id: ids.project, businessId: ids.business, workspaceId: ids.workspace }
  return {
    schemaVersion: '1.0',
    phaseBRecovery: { version: PHASE_B_RECOVERY_MANIFEST_VERSION, requiredTables: [...PHASE_B_FAMILY_DELEGATES] },
    tables: {
      tenant: [{ id: ids.tenant }],
      business: [{ id: ids.business, tenantId: ids.tenant }],
      workspace: [{ id: ids.workspace, tenantId: ids.tenant, businessId: ids.business }],
      project: [project],
      repository: [{ id: ids.repository, tenantId: ids.tenant, businessId: ids.business, status: 'ACTIVE' }],
      projectRepository: [{ id: ids.projectRepository, projectId: ids.project, repoId: ids.repository }],
      workstream: [{ id: ids.workstream, projectId: ids.project }],
      workItem: [{ id: ids.workItem, workstreamId: ids.workstream, status: 'PLANNED', deletedAt: null }],
      auditEvent: [{ id: ids.audit }],
      governanceSnapshot: [{
        id: ids.snapshot,
        tenantId: ids.tenant,
        businessId: ids.business,
        createdAt: now,
        repositoryId: ids.repository,
        projectRepositoryId: ids.projectRepository,
        checkoutBindingId: 'checkout-1',
        commitSha: 'b'.repeat(40),
        manifestHash: hash,
        capturedAt: now,
        verifiedAt: now,
        verifierId: 'local-git-verifier',
        verifierVersion: '1.0.0',
        proofId: ids.proof,
        verificationProof: {
          proofId: ids.proof,
          verifierId: 'local-git-verifier',
          verifierVersion: '1.0.0',
          verifiedAt: now,
          projectId: ids.project,
          projectRepositoryId: ids.projectRepository,
          checkoutBindingId: 'checkout-1',
          repositoryId: ids.repository,
          commitSha: 'b'.repeat(40),
          manifestHash: hash,
          outcome: 'VALID',
        },
        validationStatus: 'VALID',
        sourceManifest: { schemaVersion: '1.0.0', entries: [] },
      }],
      projectFeature: [{
        id: ids.feature,
        tenantId: ids.tenant,
        businessId: ids.business,
        projectId: ids.project,
        code: 'FE-1',
        title: 'Feature title',
        problem: 'Feature problem',
        outcome: 'Feature outcome',
        primaryDomainId: 'PM',
        canonicalFeatureKey: null,
        governanceSnapshotId: null,
        lifecycle: 'DRAFT',
        createdAt: now,
        updatedAt: now,
        version: 1,
        deletedAt: null,
        deleteBatchId: null,
      }],
      featureContribution: [],
      featureWorkLink: [],
      requirementBinding: [],
      projectFeatureMutationReceipt: [],
    },
  }
}

function bytes(snapshot, whitespace = '') {
  return Buffer.from(`${whitespace}${JSON.stringify(snapshot)}${whitespace}`, 'utf8')
}

function sqliteTx(counts = {}) {
  return {
    _activeProvider: 'sqlite',
    ...Object.fromEntries(PHASE_B_FAMILY_DELEGATES.map((delegate) => [delegate, { count: async () => counts[delegate] || 0 }])),
  }
}

describe('Phase B protected backup contract', () => {
  it('validates a complete six-family snapshot and its exact target binding', () => {
    const snapshot = baseSnapshot()
    const input = bytes(snapshot)
    const result = validatePhaseBSnapshot(snapshot, {
      source: 'recovery',
      schemaInventory: inventory(),
      expectedSnapshotSha256: 'x'.repeat(64),
      snapshotBytes: input,
      targetCounts: Object.fromEntries(inventory().applicationTables.map((entry) => [entry.modelName, 0])),
      schemaVisibility: 'FULL',
    })
    expect(result.status).toBe('INVALID')
    expect(result.errorCode).toBe('SNAPSHOT_DIGEST_MISMATCH')

    const valid = validatePhaseBSnapshot(snapshot, {
      source: 'recovery',
      schemaInventory: inventory(),
      snapshotBytes: input,
      targetCounts: Object.fromEntries(inventory().applicationTables.map((entry) => [entry.modelName, 0])),
      schemaVisibility: 'FULL',
    })
    expect(valid.valid).toBe(true)
    expect(valid.targetSchemaSha256).toBe(inventory().targetSchemaSha256)
  })

  it('distinguishes missing, empty and unreadable family arrays', () => {
    const missing = baseSnapshot()
    delete missing.tables.requirementBinding
    expect(validatePhaseBSnapshot(missing).families.requirementBinding.state).toBe('MISSING')

    const empty = baseSnapshot()
    expect(validatePhaseBSnapshot(empty).families.requirementBinding.state).toBe('PRESENT_EMPTY')

    const unreadable = baseSnapshot()
    unreadable.tables.requirementBinding = {}
    const result = validatePhaseBSnapshot(unreadable)
    expect(result.families.requirementBinding.state).toBe('UNAVAILABLE')
    expect(result.errorCode).toBe('PHASE_B_SNAPSHOT_INCOMPLETE')
  })

  it('rejects an out-of-scope parent chain before any recovery write', () => {
    const snapshot = baseSnapshot()
    snapshot.tables.project[0].workspaceId = ids.business
    const result = validatePhaseBSnapshot(snapshot)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('PHASE_B_SCOPE_INVALID')
  })

  it('validates referenced generic ancestors while preserving unrelated legacy rows', () => {
    const snapshot = baseSnapshot()
    snapshot.tables.tenant.push({ id: 'legacy-tenant-key' })
    expect(validatePhaseBSnapshot(snapshot).valid).toBe(true)
  })

  it('allows unrelated legacy parent rows when all Phase B families are empty', () => {
    const snapshot = baseSnapshot()
    for (const delegate of PHASE_B_FAMILY_DELEGATES) snapshot.tables[delegate] = []
    snapshot.tables.tenant.push({ id: 'legacy-tenant-key' })
    expect(validatePhaseBSnapshot(snapshot).valid).toBe(true)
  })

  it('binds governance proof to the recorded checkout and project', () => {
    const checkoutMismatch = baseSnapshot()
    checkoutMismatch.tables.governanceSnapshot[0].verificationProof.checkoutBindingId = 'checkout-2'
    const checkoutResult = validatePhaseBSnapshot(checkoutMismatch)
    expect(checkoutResult.valid).toBe(false)
    expect(checkoutResult.errorCode).toBe('PHASE_B_SNAPSHOT_INVALID')

    const projectMismatch = baseSnapshot()
    projectMismatch.tables.governanceSnapshot[0].verificationProof.projectId = ids.business
    const projectResult = validatePhaseBSnapshot(projectMismatch)
    expect(projectResult.valid).toBe(false)
    expect(projectResult.errorCode).toBe('PHASE_B_SCOPE_INVALID')
  })

  it('preserves valid historical links and refuses missing work parents without throwing', () => {
    const historical = baseSnapshot()
    historical.tables.workItem[0].status = 'CANCELLED'
    historical.tables.workItem[0].deletedAt = now
    historical.tables.workItem[0].deleteBatchId = '10000000-0000-4000-8000-000000000014'
    historical.tables.featureWorkLink = [{
      id: '10000000-0000-4000-8000-000000000015',
      tenantId: ids.tenant,
      businessId: ids.business,
      featureId: ids.feature,
      workItemId: ids.workItem,
      allocationBps: 10000,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: now,
      deleteBatchId: '10000000-0000-4000-8000-000000000016',
    }]
    expect(validatePhaseBSnapshot(historical).valid).toBe(true)

    const missingParent = baseSnapshot()
    missingParent.tables.featureWorkLink = [{ ...historical.tables.featureWorkLink[0], deletedAt: null, deleteBatchId: null }]
    delete missingParent.tables.workItem
    const result = validatePhaseBSnapshot(missingParent)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('PHASE_B_SCOPE_INVALID')
  })

  it('requires a fresh same-transaction provider proof and refuses protected rows', async () => {
    await expect(assertPhaseBWebRestoreSafe(sqliteTx({ projectFeature: 1 }), baseSnapshot())).rejects.toMatchObject({ code: 'PHASE_B_RECOVERY_MAINTENANCE_REQUIRED' })
    await expect(assertPhaseBWebRestoreSafe({ ...sqliteTx(), _activeProvider: 'unknown' }, baseSnapshot())).rejects.toMatchObject({ code: 'PHASE_B_RECOVERY_MAINTENANCE_REQUIRED' })
    await expect(assertPhaseBWebRestoreSafe(sqliteTx(), { tables: {} })).resolves.toBeUndefined()
  })

  it('does not treat a caller supplied visibility flag as proof', async () => {
    const tx = { ...sqliteTx(), _activeProvider: 'unknown', provider: 'sqlite' }
    const proof = await readPhaseBCounts(tx, { schemaVisibility: 'FULL' })
    expect(proof.status).toBe('UNVERIFIED')
    expect(proof.errorCode).toBe('TARGET_EMPTY_UNVERIFIED')
  })
})

// @req FR-252 — actual non-bypass runtime role, service races and process recovery.
// @spec ADR-097, ADR-057, SEC-001
// @tested tests/postgres/phase-b-runtime-role.test.js
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startPmRoleTarget, createPmRoleFixture, PM_TABLES } from '../helpers/pm-role-target'
import { deferred, withinDeadline, waitForApprovalLock } from '../helpers/pm-approval-fixture'
import { createProjectFeatureRepository } from '@/modules/project-manager/application/project-feature-repository'
import { createProjectFeature, updateProjectFeature, replaceProjectFeatureWorkLinks } from '@/modules/project-manager/application/project-feature-service'
import { computeSnapshotSha256, PHASE_B_ERROR_CODES } from '@/modules/project-manager/application/phase-b-backup'
import { applyReviewedProjectFeatureErasure, digestReviewedProjectFeatureManifest } from '@/modules/project-manager/application/project-feature-erasure'

let target, a, b, directory, recoveryFamily
const input = () => ({ code: randomUUID(), title: 'Runtime Feature', problem: 'Synthetic qualification', outcome: 'Atomic persisted proof', primaryDomainId: 'DOM-COMMERCE' })
const repo = db => createProjectFeatureRepository({ db, dialect: 'postgres' })
const options = (fixture = a, db = target.runtime, extra = {}) => ({ db, repository: repo(db), viewer: fixture.viewer, session: fixture.session, idempotencyKey: randomUUID(), ...extra })
const create = (fixture = a, db = target.runtime) => createProjectFeature(fixture.project.id, input(), options(fixture, db))
const scope = (fixture, callback, db = target.runtime) => repo(db).withProjectTransaction({ projectId: fixture.project.id, viewer: fixture.viewer }, callback)

// Instruments scheduling only: the real SQL, transaction isolation and service
// authorizer execute unchanged. Record PIDs before the repository Project lock.
function instrument(db, hooks = {}) {
  return new Proxy(db, { get(object, key) {
    if (key === '$transaction') return (callback, settings) => object.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid')
      hooks.backend?.(pid)
      return callback(new Proxy(tx, { get(transaction, field) {
        if (field === 'auditEvent') return new Proxy(transaction[field], { get(delegate, method) {
          const value = delegate[method]
          if (method === 'create') return async args => { await hooks.beforeAudit?.(); return value.call(delegate, args) }
          return typeof value === 'function' ? value.bind(delegate) : value
        } })
        const value = transaction[field]
        return typeof value === 'function' ? value.bind(transaction) : value
      } }))
    }, settings)
    const value = object[key]
    return typeof value === 'function' ? value.bind(object) : value
  } })
}

async function competing(first, second, afterBlocked = async () => {}) {
  const held = deferred(), release = deferred(), pids = []
  let paused = false
  const leader = instrument(target.runtime, { backend: pid => { pids[0] = pid }, beforeAudit: async () => {
    if (!paused) { paused = true; held.resolve(); await release.promise }
  } })
  const follower = instrument(target.otherRuntime, { backend: pid => { pids[1] = pid } })
  const one = first(leader)
  let two
  try {
    await withinDeadline(held.promise, 'B2 leader before audit')
    two = second(follower)
    // Attach rejection handlers immediately, including while waiting for lock.
    const settled = Promise.allSettled([one, two])
    await waitForApprovalLock(target.admin, () => pids)
    await afterBlocked()
    release.resolve()
    return await settled
  } finally { release.resolve(); await Promise.allSettled([one, two].filter(Boolean)) }
}

beforeAll(async () => {
  target = await startPmRoleTarget()
  directory = await mkdtemp(path.join(tmpdir(), 'pm-b2-artifacts-'))
  a = await createPmRoleFixture(target.admin)
  b = await createPmRoleFixture(target.admin)
  recoveryFamily = await arrangeRecoveryFamily()
}, 120000)
afterAll(async () => {
  try { await target?.stop() }
  finally { if (directory) await rm(directory, { recursive: true, force: true }) }
})

describe('Phase B actual PostgreSQL runtime role', () => {
  it('catalog_verifies_login_inheritance_policy_and_bounded_grants', async () => {
    const [session] = await target.runtime.$queryRawUnsafe('SELECT current_user, session_user')
    expect(session).toEqual({ current_user: 'zuri_web_login', session_user: 'zuri_web_login' })
    const roles = await target.admin.$queryRawUnsafe("SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('zuri_app_runtime','zuri_web_login') ORDER BY rolname")
    expect(roles).toEqual([
      { rolname: 'zuri_app_runtime', rolcanlogin: false, rolsuper: false, rolbypassrls: false },
      { rolname: 'zuri_web_login', rolcanlogin: true, rolsuper: false, rolbypassrls: false },
    ])
    const [membership] = await target.runtime.$queryRawUnsafe("SELECT pg_has_role(current_user,'zuri_app_runtime','USAGE') AS inherited")
    expect(membership.inherited).toBe(true)
    for (const table of PM_TABLES) {
      const [catalog] = await target.admin.$queryRawUnsafe('SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = $1::regclass', `public."${table}"`)
      expect(catalog).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true })
      expect(['zuri_web_login', 'zuri_app_runtime']).not.toContain(catalog.owner)
      const policies = await target.admin.$queryRawUnsafe('SELECT policyname, roles, qual, with_check FROM pg_policies WHERE tablename=$1', table)
      expect(policies).toHaveLength(['GovernanceSnapshot', 'ProjectFeatureMutationReceipt'].includes(table) ? 2 : 1)
      for (const policy of policies) {
        expect(policy.roles.sort()).toEqual(['zuri_app_runtime', 'zuri_web_login'])
        for (const predicate of [policy.qual, policy.with_check].filter(Boolean)) {
          expect(predicate).toContain('zuri.pm_business_id')
          expect(predicate).toContain('zuri.pm_tenant_id')
        }
      }
      // table_privileges includes PUBLIC, unlike role_table_grants.
      const grants = await target.admin.$queryRawUnsafe('SELECT grantee, privilege_type, is_grantable FROM information_schema.table_privileges WHERE table_schema=\'public\' AND table_name=$1 AND grantee IN (\'PUBLIC\',\'zuri_app_runtime\',\'zuri_web_login\',\'anon\',\'authenticated\',\'service_role\')', table)
      expect([...new Set(grants.map(row => row.grantee))]).toEqual(['zuri_app_runtime'])
      expect(grants.every(row => row.is_grantable === 'NO')).toBe(true)
      expect(grants.map(row => row.privilege_type).sort()).toEqual(['GovernanceSnapshot', 'ProjectFeatureMutationReceipt'].includes(table) ? ['INSERT', 'SELECT'] : ['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
    }
  })

  it('missing_scope_cannot_read_or_write', async () => {
    const made = await create()
    for (const delegate of ['projectFeature', 'featureContribution', 'featureWorkLink', 'requirementBinding', 'governanceSnapshot', 'projectFeatureMutationReceipt']) {
      expect(await target.admin[delegate].count()).toBeGreaterThan(0)
      expect(await target.runtime[delegate].findMany()).toEqual([])
      const row = await target.admin[delegate].findFirst()
      await expect(target.runtime[delegate].create({ data: { ...row, id: randomUUID() } })).rejects.toThrow(/row.level security/i)
    }
    await expect(target.runtime.projectFeature.create({ data: { ...input(), tenantId: a.tenant.id, businessId: a.business.id, projectId: a.project.id, lifecycle: 'DRAFT' } })).rejects.toThrow(/row.level security/i)
    expect(await target.runtime.projectFeature.updateMany({ where: { id: made.receipt.resourceId }, data: { title: 'forbidden' } })).toEqual({ count: 0 })
  })

  it('foreign_business_is_invisible', async () => {
    const made = await create(b)
    // Same Tenant, different Business: tenant-only policy must fail this proof.
    expect(recoveryFamily.fixture.tenant.id).toBe(a.tenant.id)
    expect(recoveryFamily.fixture.business.id).not.toBe(a.business.id)
    await scope(a, async tx => {
      for (const delegate of ['projectFeature', 'featureContribution', 'featureWorkLink', 'requirementBinding', 'governanceSnapshot', 'projectFeatureMutationReceipt']) {
        expect(await target.admin[delegate].count({ where: { businessId: recoveryFamily.fixture.business.id } })).toBeGreaterThan(0)
        expect(await tx[delegate].findMany({ where: { businessId: recoveryFamily.fixture.business.id } })).toEqual([])
      }
    })
    await expect(scope(a, tx => tx.projectFeature.create({ data: { ...input(), tenantId: a.tenant.id, businessId: recoveryFamily.fixture.business.id, projectId: recoveryFamily.fixture.project.id, lifecycle: 'DRAFT' } }))).rejects.toThrow(/row.level security/i)
    await scope(b, async tx => {
      for (const delegate of ['featureContribution', 'featureWorkLink', 'requirementBinding', 'governanceSnapshot']) expect(await tx[delegate].findMany()).toEqual([])
    })
    expect(await scope(a, tx => tx.projectFeature.findUnique({ where: { id: made.receipt.resourceId } }))).toBeNull()
    await expect(scope(a, tx => tx.projectFeature.create({ data: { ...input(), tenantId: b.tenant.id, businessId: b.business.id, projectId: b.project.id, lifecycle: 'DRAFT' } }))).rejects.toThrow(/row.level security/i)
    await expect(repo(target.runtime).withProjectTransaction({ projectId: b.project.id, viewer: a.viewer }, () => null)).rejects.toMatchObject({ code: 'PHASE_B_PROJECT_NOT_FOUND' })
  })

  it('scope_settings_do_not_leak_across_reused_connections', async () => {
    const settings = "SELECT pg_backend_pid() AS pid, NULLIF(current_setting('zuri.pm_business_id',true),'') AS business, NULLIF(current_setting('zuri.pm_tenant_id',true),'') AS tenant"
    const inside = await scope(a, tx => tx.$queryRawUnsafe(settings))
    const outside = await target.runtime.$queryRawUnsafe(settings)
    expect(inside[0].pid).toBe(outside[0].pid)
    expect(inside[0]).toMatchObject({ business: a.business.id, tenant: a.tenant.id })
    expect(outside[0]).toMatchObject({ business: null, tenant: null })
    let rollbackPid
    await expect(scope(b, async tx => {
      const [bound] = await tx.$queryRawUnsafe(settings)
      rollbackPid = bound.pid
      expect(bound).toMatchObject({ business: b.business.id, tenant: b.tenant.id })
      throw new Error('rollback scope')
    })).rejects.toThrow('rollback scope')
    expect((await target.runtime.$queryRawUnsafe(settings))[0]).toEqual({ pid: rollbackPid, business: null, tenant: null })
  })

  it('both_scope_keys_are_required_by_real_policy', async () => {
    const row = await target.admin.projectFeature.findUnique({ where: { id: recoveryFamily.featureId } })
    for (const [tenant, business] of [['', row.businessId], [row.tenantId, ''], [randomUUID(), row.businessId]]) {
      await expect(target.runtime.$transaction(async tx => {
        await tx.$executeRawUnsafe("SELECT set_config('zuri.pm_tenant_id',$1,true), set_config('zuri.pm_business_id',$2,true)", tenant, business)
        for (const delegate of ['projectFeature', 'featureContribution', 'featureWorkLink', 'requirementBinding', 'governanceSnapshot', 'projectFeatureMutationReceipt']) expect(await tx[delegate].findMany()).toEqual([])
        await tx.projectFeature.create({ data: { ...row, id: randomUUID(), code: randomUUID() } })
      })).rejects.toThrow(/row.level security/i)
    }
  })

  it('authorized_service_binds_scope_locally_and_receipt_links_exact_audit', async () => {
    const made = await create()
    const receipt = await target.admin.projectFeatureMutationReceipt.findUnique({ where: { id: made.receipt.receiptId } })
    const audit = await target.admin.auditEvent.findUnique({ where: { id: receipt.auditEventId } })
    expect(receipt).toMatchObject({ principalId: a.person.id, projectId: a.project.id, resourceId: made.receipt.resourceId, status: 'COMMITTED' })
    expect(audit).toMatchObject({ entityId: receipt.resourceId, action: receipt.operation, actorId: a.person.id })
    expect(await target.runtime.projectFeature.findUnique({ where: { id: receipt.resourceId } })).toBeNull()
    await expect(scope(a, tx => tx.projectFeatureMutationReceipt.updateMany({ data: { status: 'FORGED' } }))).rejects.toThrow(/permission denied/i)
  })

  it('membership_expiry_after_project_lock_refuses_write', async () => {
    const fixture = await createPmRoleFixture(target.admin)
    const expiresAt = new Date(Date.now() + 3000)
    await target.admin.membership.update({ where: { id: fixture.membership.id }, data: { expiresAt } })
    const held = deferred(), release = deferred(), pids = []
    const holder = target.admin.$transaction(async tx => {
      pids[0] = (await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'))[0].pid
      await tx.$queryRawUnsafe('SELECT id FROM "Project" WHERE id=$1 FOR UPDATE', fixture.project.id)
      held.resolve(); await release.promise
    }, { timeout: 30000 })
    let contender
    try {
      await withinDeadline(held.promise, 'B2 project held')
      const db = instrument(target.runtime, { backend: pid => { pids[1] = pid } })
      expect(Date.now()).toBeLessThan(expiresAt.getTime())
      contender = create(fixture, db).then(value => ({ value }), error => ({ error }))
      await waitForApprovalLock(target.admin, () => pids)
      expect(Date.now()).toBeLessThan(expiresAt.getTime())
      // Real elapsed time while the Project lock is held; no injected clock or
      // authority rewrite after the contender's snapshot was established.
      while (Date.now() <= expiresAt.getTime()) await new Promise(done => setTimeout(done, 20))
      release.resolve(); await holder
      expect((await contender).error).toMatchObject({ code: 'PHASE_B_PROJECT_NOT_FOUND' })
      expect(await target.admin.projectFeature.count({ where: { projectId: fixture.project.id } })).toBe(0)
      expect(await target.admin.projectFeatureMutationReceipt.count({ where: { projectId: fixture.project.id } })).toBe(0)
    } finally { release.resolve(); await Promise.allSettled([holder, contender].filter(Boolean)) }
  })

  it('competing_versions_have_one_winner', async () => {
    const made = await create()
    const results = await competing(
      db => updateProjectFeature(a.project.id, made.receipt.resourceId, { title: 'winner A' }, options(a, db, { ifMatch: made.receipt.etag })),
      db => updateProjectFeature(a.project.id, made.receipt.resourceId, { title: 'winner B' }, options(a, db, { ifMatch: made.receipt.etag })),
    )
    expect(results.map(row => row.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(results.find(row => row.status === 'rejected').reason.code).toBe('VERSION_MISMATCH')
    expect((await target.admin.projectFeature.findUnique({ where: { id: made.receipt.resourceId } })).version).toBe(2)
  })

  it('allocation_overflow_race_rolls_back', async () => {
    const first = await create(), second = await create()
    const receiptsBefore = await target.admin.projectFeatureMutationReceipt.count()
    const auditsBefore = await target.admin.auditEvent.count()
    const results = await competing(
      db => replaceProjectFeatureWorkLinks(a.project.id, first.receipt.resourceId, { allocationMode: 'COMPLETE_SPLIT', links: [{ workItemId: a.item.id, allocationBps: 10000 }] }, options(a, db, { ifMatch: first.receipt.etag })),
      db => replaceProjectFeatureWorkLinks(a.project.id, second.receipt.resourceId, { allocationMode: 'COMPLETE_SPLIT', links: [{ workItemId: a.item.id, allocationBps: 10000 }] }, options(a, db, { ifMatch: second.receipt.etag })),
    )
    expect(results.map(row => row.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(results.find(row => row.status === 'rejected').reason).toMatchObject({ code: 'INVALID_ALLOCATION', status: 422 })
    const links = await target.admin.featureWorkLink.findMany({ where: { workItemId: a.item.id, deletedAt: null } })
    expect(links.reduce((total, row) => total + row.allocationBps, 0)).toBe(10000)
    expect(links).toHaveLength(1)
    expect((await target.admin.projectFeature.findUnique({ where: { id: second.receipt.resourceId } })).version).toBe(1)
    expect(await target.admin.projectFeatureMutationReceipt.count()).toBe(receiptsBefore + 1)
    expect(await target.admin.auditEvent.count()).toBe(auditsBefore + 1)
  })

  it('audit_failure_preserves_feature_and_receipt', async () => {
    const made = await create()
    const before = await target.admin.projectFeature.findUnique({ where: { id: made.receipt.resourceId } })
    const count = await target.admin.projectFeatureMutationReceipt.count()
    const db = instrument(target.runtime, { beforeAudit: () => { throw new Error('B2 injected audit failure') } })
    await expect(updateProjectFeature(a.project.id, before.id, { title: 'must roll back' }, options(a, db, { ifMatch: made.receipt.etag }))).rejects.toThrow('B2 injected audit failure')
    expect(await target.admin.projectFeature.findUnique({ where: { id: before.id } })).toEqual(before)
    expect(await target.admin.projectFeatureMutationReceipt.count()).toBe(count)
  })
})

const execute = promisify(execFile)
async function cli(script, url, args) {
  const env = { ...process.env, ZURI_PHASE_B_RECOVERY_DATABASE_URL: url }
  // Do not inherit a singleton application DB target into a child process.
  delete env.DATABASE_URL
  try {
    const { stdout } = await execute(process.execPath, [`scripts/${script}.mjs`, ...args], { cwd: process.cwd(), env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 })
    return JSON.parse(stdout.trim())
  } catch (error) {
    if (error.stdout?.trim().startsWith('{')) return JSON.parse(error.stdout.trim())
    throw new Error(`PM_RECOVERY_CLI_FAILED: ${error.code}`)
  }
}

// Synthetic governance evidence is arrangement, not a claim that the Git
// verifier/capture UI was qualified. Every six-family insert still uses RLS.
async function arrangeRecoveryFamily() {
  const fixture = await createPmRoleFixture(target.admin, { tenant: a.tenant })
  const made = await create(fixture)
  const repository = await target.admin.repository.create({ data: { code: randomUUID(), businessId: fixture.business.id, provider: 'LOCAL' } })
  const projectRepo = await target.admin.projectRepository.create({ data: { projectId: fixture.project.id, repoId: repository.id, role: 'PRIMARY' } })
  const now = new Date(), hash = 'a'.repeat(64), proofId = randomUUID()
  const evidence = {
    tenantId: fixture.tenant.id, businessId: fixture.business.id, repositoryId: repository.id, projectRepositoryId: projectRepo.id,
    checkoutBindingId: 'synthetic-b2', commitSha: 'b'.repeat(40), manifestHash: hash, capturedAt: now, verifiedAt: now,
    verifierId: 'synthetic-b2', verifierVersion: '1.0.0', proofId, validationStatus: 'VALID',
    verificationProof: JSON.stringify({ proofId, verifierId: 'synthetic-b2', verifierVersion: '1.0.0', verifiedAt: now,
      projectId: fixture.project.id, projectRepositoryId: projectRepo.id, repositoryId: repository.id,
      checkoutBindingId: 'synthetic-b2', commitSha: 'b'.repeat(40), manifestHash: hash, outcome: 'VALID' }),
    sourceManifest: JSON.stringify({ schemaVersion: '1.0.0', entries: [] }),
  }
  await repo(target.runtime).withProjectTransaction({ projectId: fixture.project.id, viewer: fixture.viewer, mode: 'write' }, async tx => {
    const snapshot = await tx.governanceSnapshot.create({ data: evidence })
    const bound = { tenantId: fixture.tenant.id, businessId: fixture.business.id, featureId: made.receipt.resourceId }
    await tx.featureContribution.create({ data: { ...bound, domainId: 'DOM-OPERATIONS', responsibility: 'Retained responsibility' } })
    await tx.featureWorkLink.create({ data: { ...bound, workItemId: fixture.item.id, allocationBps: 10000 } })
    await tx.requirementBinding.create({ data: { ...bound, governanceSnapshotId: snapshot.id, sourceNamespace: 'synthetic-b2', requirementKey: 'TEST-ONLY', revisionHash: hash, acceptanceRef: 'synthetic/recovery' } })
  })
  const subject = await target.admin.person.create({ data: { code: randomUUID(), displayName: '[erased]', accessDisabledAt: now } })
  const revoked = await target.admin.session.create({ data: { personId: subject.id, tokenHash: randomUUID(), status: 'REVOKED', revokedAt: now, expiresAt: new Date(Date.now() + 3600000) } })
  const manifest = { version: 'pm-erasure.v1', tenantId: fixture.tenant.id, businessId: fixture.business.id,
    subjectPersonId: subject.id, reviewerPersonId: fixture.person.id, requestId: randomUUID(), reasonRef: 'synthetic/b2-erasure',
    targets: [{ projectId: fixture.project.id, recordType: 'ProjectFeature', recordId: made.receipt.resourceId, field: 'title', expectedVersion: 1 }] }
  manifest.manifestSha256 = digestReviewedProjectFeatureManifest(manifest)
  const result = await target.runtime.$transaction(tx => applyReviewedProjectFeatureErasure(tx, manifest, { authority: {
    viewer: fixture.viewer, tenantId: fixture.tenant.id, businessId: fixture.business.id, subjectPersonId: subject.id,
    wholeFieldsApproved: true, reviewedManifestSha256: manifest.manifestSha256,
  } }))
  expect(result.status).toBe('APPLIED')
  return { featureId: made.receipt.resourceId, subject, revoked, fixture }
}

describe('Phase B owned PostgreSQL recovery CLI', () => {
  it('runtime_role_cannot_claim_complete_protected_export', async () => {
    const result = await cli('phase-b-protected-export', target.runtimeRecoveryUrl, ['--output', path.join(directory, 'forbidden-export.json')])
    expect(result).toMatchObject({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE })
    await expect(readFile(path.join(directory, 'forbidden-export.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 60000)
  it('exports_current_inventory_and_restores_exact_family_only_after_confirmation', async () => {
    const erased = recoveryFamily
    const output = path.join(directory, 'snapshot.json')
    const exported = await cli('phase-b-protected-export', target.recoveryUrl, ['--output', output])
    expect(exported.status).toBe('EXPORTED')
    const bytes = await readFile(output)
    const snapshot = JSON.parse(bytes)
    expect(exported.snapshotSha256).toBe(computeSnapshotSha256(bytes))
    expect(exported.targetSchemaSha256).toBe(target.inventory.targetSchemaSha256)
    const clean = await startPmRoleTarget()
    try {
      const args = ['--snapshot', output, '--snapshot-sha256', exported.snapshotSha256]
      const preview = await cli('phase-b-clean-target-restore', clean.recoveryUrl, args)
      expect(preview.status).toBe('READY')
      expect(preview.applicationTableCount).toBe(target.inventory.applicationTables.length)
      for (const { modelName } of clean.inventory.applicationTables) {
        expect(await clean.admin[modelName[0].toLowerCase() + modelName.slice(1)].count()).toBe(0)
      }
      const restored = await cli('phase-b-clean-target-restore', clean.recoveryUrl, [...args, '--confirm-empty-target', 'PHASE_B_EMPTY_TARGET'])
      expect(restored.status).toBe('RESTORED')
      const roundtripPath = path.join(directory, 'roundtrip.json')
      expect((await cli('phase-b-protected-export', clean.recoveryUrl, ['--output', roundtripPath])).status).toBe('EXPORTED')
      const roundtrip = JSON.parse(await readFile(roundtripPath))
      for (const delegate of ['projectFeature', 'featureContribution', 'featureWorkLink', 'requirementBinding', 'governanceSnapshot', 'projectFeatureMutationReceipt']) {
        expect(snapshot.tables[delegate].length).toBeGreaterThan(0)
        expect(roundtrip.tables[delegate].sort((x, y) => x.id.localeCompare(y.id))).toEqual(snapshot.tables[delegate].sort((x, y) => x.id.localeCompare(y.id)))
      }
      for (const receipt of await clean.admin.projectFeatureMutationReceipt.findMany()) {
        const audit = await clean.admin.auditEvent.findUnique({ where: { id: receipt.auditEventId } })
        expect(audit).toMatchObject({ entityId: receipt.resourceId, actorId: receipt.principalId, action: receipt.operation })
      }
      expect((await clean.admin.person.findUnique({ where: { id: a.person.id } })).displayName).toBe('Synthetic retained name')
      expect(await clean.admin.session.count()).toBe(snapshot.tables.session.length)
      expect(await clean.admin.session.findUnique({ where: { id: erased.revoked.id } })).toMatchObject({ status: 'REVOKED', personId: erased.subject.id, tokenHash: erased.revoked.tokenHash, revokedAt: erased.revoked.revokedAt })
      expect(await clean.admin.person.findUnique({ where: { id: erased.subject.id } })).toMatchObject({ displayName: '[erased]', accessDisabledAt: erased.subject.accessDisabledAt })
      expect(await clean.admin.projectFeature.findUnique({ where: { id: erased.featureId } })).toMatchObject({ title: '[erased]', problem: 'Synthetic qualification', outcome: 'Atomic persisted proof' })
      expect(await cli('phase-b-clean-target-restore', clean.recoveryUrl, [...args, '--confirm-empty-target', 'PHASE_B_EMPTY_TARGET'])).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_NOT_EMPTY' })
    } finally { await clean.stop() }
  }, 120000)

  it('refuses_checksum_missing_family_and_inventory_drift_without_inserts', async () => {
    const output = path.join(directory, 'refusal-snapshot.json')
    expect((await cli('phase-b-protected-export', target.recoveryUrl, ['--output', output])).status).toBe('EXPORTED')
    const bytes = await readFile(output)
    const clean = await startPmRoleTarget()
    try {
      const args = ['--snapshot', output, '--snapshot-sha256', '0'.repeat(64), '--confirm-empty-target', 'PHASE_B_EMPTY_TARGET']
      expect(await cli('phase-b-clean-target-restore', clean.recoveryUrl, args)).toMatchObject({ status: 'REFUSED', errorCode: 'SNAPSHOT_DIGEST_MISMATCH' })
      const missing = JSON.parse(bytes); delete missing.tables.projectFeatureMutationReceipt
      const missingPath = path.join(directory, 'missing.json')
      const missingBytes = Buffer.from(JSON.stringify(missing)); await writeFile(missingPath, missingBytes)
      expect(await cli('phase-b-clean-target-restore', clean.recoveryUrl, ['--snapshot', missingPath, '--snapshot-sha256', computeSnapshotSha256(missingBytes), '--confirm-empty-target', 'PHASE_B_EMPTY_TARGET'])).toMatchObject({ status: 'REFUSED', errorCode: 'PHASE_B_SNAPSHOT_INCOMPLETE' })
      await clean.admin.$executeRawUnsafe('CREATE TABLE "B2UnexpectedApplicationTable" (id TEXT)')
      expect(await cli('phase-b-clean-target-restore', clean.recoveryUrl, ['--snapshot', output, '--snapshot-sha256', computeSnapshotSha256(bytes), '--confirm-empty-target', 'PHASE_B_EMPTY_TARGET'])).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED' })
      expect(await clean.admin.projectFeature.count()).toBe(0)
      expect(await clean.admin.person.count()).toBe(0)
    } finally { await clean.stop() }
  }, 120000)
})

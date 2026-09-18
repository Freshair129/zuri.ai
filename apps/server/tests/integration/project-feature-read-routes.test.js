import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: mocks.resolveRequestViewer }))

import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createItem } from '@/modules/project-manager/application/work-service'
import {
  zFeatureReadError,
  zFeatureRecord,
  zFeatureRecordPage,
  zFeatureView,
  zGovernanceSnapshotPage,
} from '@/modules/project-manager/application/project-feature-read-model'
import { GET as getFeatureView } from '@/app/api/projects/[id]/feature-view/route'
import { GET as listFeatures } from '@/app/api/projects/[id]/features/route'
import { GET as getFeature } from '@/app/api/projects/[id]/features/[featureId]/route'
import { GET as listSnapshots } from '@/app/api/projects/[id]/governance-snapshots/route'
import { computeProjectFeatureGraphEtag } from '@/modules/project-manager/application/project-feature-service'
import {
  computeSourceManifestHash,
  statementDigest,
  verifyGovernanceSnapshotIntent,
} from '@/modules/project-manager/application/governance-source-verifier'

// @req FR-252 — Project Feature GET routes prove hierarchy before protected
// reads, preserve exact DTOs, redact unauthorized tombstones, and remain pure.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
// @tested tests/integration/project-feature-read-routes.test.js

const fixture = {
  portfolios: [],
  tenants: [],
  businesses: [],
  workspaces: [],
  projects: [],
  workstreams: [],
  items: [],
  features: [],
  contributions: [],
  links: [],
  bindings: [],
  snapshots: [],
  projectRepositories: [],
  repositories: [],
}

let projectA
let projectB
let businessA
let businessB
let viewerA
let viewerB
let sharedReader
let featureA
let featureB
let deletedFeature
let snapshot
const previousSessionSecret = process.env.ZURI_SESSION_SECRET

const id = () => randomUUID()
const code = (prefix) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`

async function call(handler, projectId, viewer, search = '', params = {}) {
  mocks.resolveRequestViewer.mockResolvedValue(viewer)
  const response = await handler(
    new Request(`http://local/api/projects/${projectId}${search}`),
    { params: { id: projectId, ...params } },
  )
  return { response, body: await response.json() }
}

async function callWithoutViewer(handler, projectId, error) {
  mocks.resolveRequestViewer.mockRejectedValue(error)
  const response = await handler(
    new Request(`http://local/api/projects/${projectId}`),
    { params: { id: projectId } },
  )
  return { response, body: await response.json() }
}

beforeAll(async () => {
  process.env.ZURI_SESSION_SECRET = previousSessionSecret || 'phase-b-feature-read-session-secret-0123456789'
  const suffix = randomUUID().slice(0, 8).toUpperCase()
  const portfolio = await createPortfolio({ name: `Feature read group ${suffix}`, code: `PF-FR-${suffix}` })
  fixture.portfolios.push(portfolio.id)
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Feature read tenant ${suffix}`, code: `TN-FR-${suffix}` })
  fixture.tenants.push(tenant.id)
  businessA = await createBusiness({ tenantId: tenant.id, name: `Feature read business A ${suffix}`, code: `BU-FRA-${suffix}` })
  businessB = await createBusiness({ tenantId: tenant.id, name: `Feature read business B ${suffix}`, code: `BU-FRB-${suffix}` })
  fixture.businesses.push(businessA.id, businessB.id)
  const workspaceA = await createWorkspace({
    businessId: businessA.id, scopeType: 'BUSINESS', name: `Feature read workspace A ${suffix}`, code: `WS-FRA-${suffix}`,
  })
  const workspaceB = await createWorkspace({
    businessId: businessB.id, scopeType: 'BUSINESS', name: `Feature read workspace B ${suffix}`, code: `WS-FRB-${suffix}`,
  })
  fixture.workspaces.push(workspaceA.id, workspaceB.id)

  viewerA = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id] })
  viewerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id] })
  sharedReader = ownsElsewhere({ owns: businessB.id, sees: businessA.id })

  projectA = await createProject({
    workspaceId: workspaceA.id, businessId: businessA.id, name: 'Feature read project A', code: `PR-FRA-${suffix}`,
  }, { viewer: viewerA })
  projectB = await createProject({
    workspaceId: workspaceB.id, businessId: businessB.id, name: 'Feature read project B', code: `PR-FRB-${suffix}`,
  }, { viewer: viewerB })
  fixture.projects.push(projectA.id, projectB.id)

  const stream = await createWorkstream({
    projectId: projectA.id, name: 'Feature read stream', code: `WST-FR-${suffix}`, executionMode: 'SOFTWARE_SPRINT',
  }, { viewer: viewerA })
  fixture.workstreams.push(stream.id)
  const sharedItem = await createItem({
    workstreamId: stream.id, code: `WI-FR-SHARED-${suffix}`, subtype: 'TASK', title: 'Shared work item', status: 'DONE',
  }, { viewer: viewerA })
  const unallocatedItem = await createItem({
    workstreamId: stream.id, code: `WI-FR-UNALLOCATED-${suffix}`, subtype: 'TASK', title: 'Unallocated work item', status: 'PLANNED',
  }, { viewer: viewerA })
  fixture.items.push(sharedItem.id, unallocatedItem.id)

  const unlinkedItem = await createItem({
    workstreamId: stream.id, code: `WI-FR-UNLINKED-${suffix}`, subtype: 'TASK', title: 'Work with no Feature link', status: 'PLANNED',
  }, { viewer: viewerA })
  const deletedItem = await createItem({
    workstreamId: stream.id, code: `WI-FR-DELETED-${suffix}`, subtype: 'TASK', title: 'Deleted unlinked work', status: 'PLANNED',
  }, { viewer: viewerA })
  fixture.items.push(unlinkedItem.id, deletedItem.id)
  await prisma.workItem.update({ where: { id: deletedItem.id }, data: { deletedAt: new Date() } })

  const inactiveStream = await createWorkstream({
    projectId: projectA.id, name: 'Archived work source', code: `WST-FR-ARCHIVED-${suffix}`, executionMode: 'OPERATIONS',
  }, { viewer: viewerA })
  fixture.workstreams.push(inactiveStream.id)
  const inactiveItem = await createItem({
    workstreamId: inactiveStream.id, code: `WI-FR-INACTIVE-${suffix}`, subtype: 'TASK', title: 'Archived stream work', status: 'PLANNED',
  }, { viewer: viewerA })
  fixture.items.push(inactiveItem.id)
  await prisma.workstream.update({ where: { id: inactiveStream.id }, data: { status: 'ARCHIVED' } })

  const unboundStream = await createWorkstream({
    projectId: projectB.id, name: 'Work before Features', code: `WST-FR-UNBOUND-${suffix}`, executionMode: 'OPERATIONS',
  }, { viewer: viewerB })
  fixture.workstreams.push(unboundStream.id)
  const featurelessItem = await createItem({
    workstreamId: unboundStream.id, code: `WI-FR-NOFEATURES-${suffix}`, subtype: 'TASK', title: 'Project without Features', status: 'PLANNED',
  }, { viewer: viewerB })
  fixture.items.push(featurelessItem.id)

  const repository = await prisma.repository.create({ data: {
    code: code('REPO-FR'), businessId: businessA.id, provider: 'GITHUB', fullName: 'fixture/feature-read', status: 'ACTIVE',
  } })
  fixture.repositories.push(repository.id)
  const projectRepository = await prisma.projectRepository.create({ data: {
    projectId: projectA.id, repoId: repository.id, role: 'PRIMARY', branch: 'main',
  } })
  fixture.projectRepositories.push(projectRepository.id)
  snapshot = await prisma.governanceSnapshot.create({ data: {
    tenantId: tenant.id,
    businessId: businessA.id,
    repositoryId: repository.id,
    projectRepositoryId: projectRepository.id,
    checkoutBindingId: id(),
    commitSha: 'a'.repeat(40),
    manifestHash: 'b'.repeat(64),
    capturedAt: new Date('2026-09-16T00:00:00.000Z'),
    verifiedAt: new Date('2026-09-16T00:01:00.000Z'),
    verifierId: 'server-local-git-verifier',
    verifierVersion: 'test-1',
    proofId: id(),
    verificationProof: '{}',
    validationStatus: 'VALID',
    sourceManifest: '{}',
  } })
  fixture.snapshots.push(snapshot.id)

  featureA = await prisma.projectFeature.create({ data: {
    tenantId: tenant.id, businessId: businessA.id, projectId: projectA.id, code: `FE-FRA-A-${suffix}`,
    title: 'Explicit feature A', problem: 'Known problem A', outcome: 'Known outcome A', primaryDomainId: 'DOM-COMMERCE',
    canonicalFeatureKey: null, governanceSnapshotId: null, lifecycle: 'ACTIVE',
  } })
  featureB = await prisma.projectFeature.create({ data: {
    tenantId: tenant.id, businessId: businessA.id, projectId: projectA.id, code: `FE-FRA-B-${suffix}`,
    title: 'Explicit feature B', problem: 'Known problem B', outcome: 'Known outcome B', primaryDomainId: 'DOM-IMPORTED-UNKNOWN', lifecycle: 'DRAFT',
  } })
  deletedFeature = await prisma.projectFeature.create({ data: {
    tenantId: tenant.id, businessId: businessA.id, projectId: projectA.id, code: `FE-FRA-D-${suffix}`,
    title: 'Deleted feature', problem: 'Deleted problem', outcome: 'Deleted outcome', primaryDomainId: 'DOM-CRM', lifecycle: 'RETIRED',
    deletedAt: new Date('2026-09-16T00:02:00.000Z'), deleteBatchId: id(),
  } })
  fixture.features.push(featureA.id, featureB.id, deletedFeature.id)

  const contribution = await prisma.featureContribution.create({ data: {
    tenantId: tenant.id, businessId: businessA.id, featureId: featureA.id, domainId: 'DOM-IMPORTED-UNKNOWN', responsibility: 'Supporting responsibility',
  } })
  fixture.contributions.push(contribution.id)
  const linkA = await prisma.featureWorkLink.create({ data: {
    tenantId: tenant.id, businessId: businessA.id, featureId: featureA.id, workItemId: sharedItem.id, allocationBps: 5000,
  } })
  const linkB = await prisma.featureWorkLink.create({ data: {
    tenantId: tenant.id, businessId: businessA.id, featureId: featureB.id, workItemId: sharedItem.id, allocationBps: 5000,
  } })
  const linkUnallocated = await prisma.featureWorkLink.create({ data: {
    tenantId: tenant.id, businessId: businessA.id, featureId: featureA.id, workItemId: unallocatedItem.id, allocationBps: null,
  } })
  fixture.links.push(linkA.id, linkB.id, linkUnallocated.id)
  const binding = await prisma.requirementBinding.create({ data: {
    tenantId: tenant.id, businessId: businessA.id, featureId: featureA.id, governanceSnapshotId: snapshot.id,
    sourceNamespace: 'zuri', requirementKey: 'FR-252', revisionHash: 'c'.repeat(64), acceptanceRef: 'docs/plan#feature-read',
  } })
  fixture.bindings.push(binding.id)
})

afterAll(async () => {
  // Remove only this suite's rows. Children and evidence precede Features and
  // Projects so intentionally tombstoned/read-only fixtures cannot pollute
  // later backup or invariant suites.
  if (fixture.bindings.length) await prisma.requirementBinding.deleteMany({ where: { id: { in: fixture.bindings } } })
  if (fixture.links.length) await prisma.featureWorkLink.deleteMany({ where: { id: { in: fixture.links } } })
  if (fixture.contributions.length) await prisma.featureContribution.deleteMany({ where: { id: { in: fixture.contributions } } })
  if (fixture.features.length) await prisma.projectFeature.deleteMany({ where: { id: { in: fixture.features } } })
  if (fixture.snapshots.length) await prisma.governanceSnapshot.deleteMany({ where: { id: { in: fixture.snapshots } } })
  if (fixture.projectRepositories.length) await prisma.projectRepository.deleteMany({ where: { id: { in: fixture.projectRepositories } } })
  if (fixture.repositories.length) await prisma.repository.deleteMany({ where: { id: { in: fixture.repositories } } })
  if (fixture.items.length) await prisma.workItem.deleteMany({ where: { id: { in: fixture.items } } })
  if (fixture.workstreams.length) await prisma.workstream.deleteMany({ where: { id: { in: fixture.workstreams } } })
  if (fixture.projects.length) await prisma.project.deleteMany({ where: { id: { in: fixture.projects } } })
  if (fixture.workspaces.length) await prisma.workspace.deleteMany({ where: { id: { in: fixture.workspaces } } })
  if (fixture.businesses.length) await prisma.business.deleteMany({ where: { id: { in: fixture.businesses } } })
  if (fixture.tenants.length) await prisma.tenant.deleteMany({ where: { id: { in: fixture.tenants } } })
  if (fixture.portfolios.length) await prisma.portfolio.deleteMany({ where: { id: { in: fixture.portfolios } } })
  if (previousSessionSecret === undefined) delete process.env.ZURI_SESSION_SECRET
  else process.env.ZURI_SESSION_SECRET = previousSessionSecret
})

describe('FR-252 Project Feature read routes', () => {
  it('returns the exact FeatureView DTO, joins explicit children, and writes no state', async () => {
    const beforeProgress = await prisma.workstream.findMany({
      where: { projectId: projectA.id }, select: { id: true, progressCache: true }, orderBy: { id: 'asc' },
    })
    const beforeAudit = await prisma.auditEvent.count()
    const { response, body } = await call(getFeatureView, projectA.id, viewerA)

    expect(response.status).toBe(200)
    expect(zFeatureView.parse(body)).toEqual(body)
    expect(body.snapshotId).toBeNull()
    expect(body.snapshotState).toBe('UNAVAILABLE')
    expect(body.uniqueWorkCount).toBe(3)
    expect(body.features).toHaveLength(2)
    expect(body.features.map((row) => row.uniqueWorkCount)).toEqual([2, 1])
    expect(body.features[0].evidenceState).toBe('UNAVAILABLE')
    expect(body.features[0].evidence).toEqual([])
    expect(body.features[0].requirementBindings[0]).toMatchObject({ bindingState: 'UNAVAILABLE', canonicalSubject: null })
    expect(body.features[0].contributions[0]).toMatchObject({ mappingState: 'UNMAPPED', label: 'Unknown domain' })
    expect(body.features[0].workLinks.map(({ allocationState }) => allocationState)).toContain('COMPLETE_SPLIT')
    expect(body.features[0].workLinks.map(({ allocationState }) => allocationState)).toContain('UNALLOCATED')
    expect(await prisma.auditEvent.count()).toBe(beforeAudit)
    expect(await prisma.workstream.findMany({
      where: { projectId: projectA.id }, select: { id: true, progressCache: true }, orderBy: { id: 'asc' },
    })).toEqual(beforeProgress)
  })

  it('supports bounded list/detail reads and signed cursors without leaking deleted relationships', async () => {
    const first = await call(listFeatures, projectA.id, viewerA, '?limit=1')
    expect(first.response.status).toBe(200)
    expect(zFeatureRecordPage.parse(first.body)).toEqual(first.body)
    expect(first.body.items).toHaveLength(1)
    expect(first.body.nextCursor).toEqual(expect.any(String))

    const second = await call(listFeatures, projectA.id, viewerA, `?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)
    expect(second.response.status).toBe(200)
    expect(second.body.items).toHaveLength(1)
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id)

    const detail = await call(getFeature, projectA.id, viewerA, '', { featureId: featureA.id })
    expect(detail.response.status).toBe(200)
    expect(zFeatureRecord.parse(detail.body)).toEqual(detail.body)
    expect(detail.body.id).toBe(featureA.id)

    const deleted = await call(listFeatures, projectA.id, viewerA, '?visibility=DELETED')
    expect(deleted.response.status).toBe(200)
    expect(deleted.body.items).toEqual([expect.objectContaining({ id: deletedFeature.id, deleteBatchId: deletedFeature.deleteBatchId })])
    expect(deleted.body.items[0]).not.toHaveProperty('workLinks')
  })

  it('counts active unbound Project work even before any Feature exists', async () => {
    const { response, body } = await call(getFeatureView, projectB.id, viewerB)
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ projectId: projectB.id, uniqueWorkCount: 1, features: [] })
  })

  it('supplies owner CAS headers from the complete graph including tombstones without disclosing the token to a shared reader', async () => {
    const rows = await prisma.projectFeature.findMany({
      where: { projectId: projectA.id }, select: { id: true, version: true, deletedAt: true },
    })
    const owner = await call(getFeatureView, projectA.id, viewerA)
    expect(owner.response.status).toBe(200)
    expect(owner.response.headers.get('ETag')).toBe(computeProjectFeatureGraphEtag(projectA.id, rows))
    expect(owner.response.headers.get('ETag')).not.toBe(computeProjectFeatureGraphEtag(projectA.id, rows.filter((row) => !row.deletedAt)))
    expect(owner.body.features.map((row) => row.id)).not.toContain(deletedFeature.id)
    const shared = await call(getFeatureView, projectA.id, sharedReader)
    expect(shared.response.status).toBe(200)
    expect(shared.response.headers.get('ETag')).toBeNull()
    const detail = await call(getFeature, projectA.id, viewerA, '', { featureId: featureA.id })
    expect(detail.response.headers.get('ETag')).toBe(`"PROJECT_FEATURE/${featureA.id}/v${detail.body.version}"`)
  })

  it('returns exact typed refusals for missing session, foreign Project, and tombstone redaction', async () => {
    const missing = await callWithoutViewer(getFeatureView, projectA.id, Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    expect(missing.response.status).toBe(401)
    expect(zFeatureReadError.parse(missing.body)).toEqual(missing.body)
    expect(missing.body).toMatchObject({ code: 'AUTH_REQUIRED', retryable: false })
    expect(missing.body.requestId).toEqual(expect.any(String))
    expect(missing.response.headers.get('X-Request-ID')).toBe(missing.body.requestId)
    expect(missing.body).not.toHaveProperty('error')

    const foreign = await call(getFeatureView, projectA.id, viewerB)
    expect(foreign.response.status).toBe(404)
    expect(zFeatureReadError.parse(foreign.body)).toEqual(foreign.body)
    expect(foreign.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND', retryable: false })
    expect(foreign.body).not.toHaveProperty('businessId')

    const redacted = await call(listFeatures, projectA.id, sharedReader, '?visibility=DELETED')
    expect(redacted.response.status).toBe(404)
    expect(zFeatureReadError.parse(redacted.body)).toEqual(redacted.body)
    expect(redacted.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND', retryable: false })
  })

  it('enforces malformed query refusal and owner-only snapshot metadata', async () => {
    const malformed = await call(listSnapshots, projectA.id, viewerA, '?limit=0')
    expect(malformed.response.status).toBe(400)
    expect(zFeatureReadError.parse(malformed.body)).toEqual(malformed.body)
    expect(malformed.body).toMatchObject({ code: 'MALFORMED_REQUEST', retryable: false })

    const denied = await call(listSnapshots, projectA.id, sharedReader)
    expect(denied.response.status).toBe(403)
    expect(zFeatureReadError.parse(denied.body)).toEqual(denied.body)
    expect(denied.body).toMatchObject({ code: 'CAPABILITY_DENIED', retryable: false })

    const owner = await call(listSnapshots, projectA.id, viewerA)
    expect(owner.response.status).toBe(200)
    expect(zGovernanceSnapshotPage.parse(owner.body)).toEqual(owner.body)
    expect(owner.body.items).toEqual([expect.objectContaining({
      id: snapshot.id, repositoryId: snapshot.repositoryId, commitSha: snapshot.commitSha,
      manifestHash: snapshot.manifestHash, validationStatus: 'VALID',
    })])
    expect(owner.body).not.toHaveProperty('sourceManifest')
    expect(owner.body).not.toHaveProperty('verificationProof')
  })

  it('refuses a cursor bound to another Project and a deleted Feature detail', async () => {
    const first = await call(listFeatures, projectA.id, viewerA, '?limit=1')
    const foreignCursor = await call(listFeatures, projectB.id, viewerB, `?cursor=${encodeURIComponent(first.body.nextCursor)}`)
    expect(foreignCursor.response.status).toBe(400)
    expect(zFeatureReadError.parse(foreignCursor.body)).toEqual(foreignCursor.body)
    expect(foreignCursor.body.code).toBe('INVALID_CURSOR')

    const deletedDetail = await call(getFeature, projectA.id, viewerA, '', { featureId: deletedFeature.id })
    expect(deletedDetail.response.status).toBe(404)
    expect(zFeatureReadError.parse(deletedDetail.body)).toEqual(deletedDetail.body)
    expect(deletedDetail.body.code).toBe('RESOURCE_NOT_FOUND')
  })

  it('reverifies committed registry evidence on actual GETs and preserves historical refs when proof becomes unavailable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zuri-feature-read-proof-'))
    const priorRegistry = process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH
    const originalBinding = await prisma.requirementBinding.findUnique({ where: { id: fixture.bindings[0] } })
    const runGit = async (args) => (await promisify(execFile)('git', args, {
      cwd: root, shell: false, windowsHide: true,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    })).stdout.trim()
    try {
      const statement = '**Bind** the [approved requirement](https://example.test/requirement).'
      const sources = {
        'docs/PRD-SDD-v1.0.md': `| ID | Statement |\n| --- | --- |\n| FR-252 | ${statement} |\n`,
        'docs/FEATURES.md': '| Feature | Title | Requirements | Status |\n| --- | --- | --- | --- |\n| FEAT-001 | Canonical feature | FR-252 | live |\n',
      }
      await mkdir(path.join(root, 'docs'))
      await runGit(['init', '--quiet'])
      await runGit(['config', 'core.autocrlf', 'false'])
      for (const [name, contents] of Object.entries(sources)) await writeFile(path.join(root, name), contents)
      await runGit(['add', '--', ...Object.keys(sources)])
      await runGit(['-c', 'user.name=Feature evidence fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'committed registry fixture'])
      const commitSha = await runGit(['rev-parse', 'HEAD'])
      const sourceManifest = {
        schemaVersion: '1.0.0',
        entries: Object.entries(sources).map(([name, contents]) => ({ path: name, sha256: createHash('sha256').update(contents).digest('hex') })),
      }
      const manifestHash = computeSourceManifestHash(sourceManifest)
      const registryPath = path.join(root, 'checkout-registry.json')
      const checkoutBindingId = `read-fixture-${id()}`
      await writeFile(registryPath, JSON.stringify({ schemaVersion: '1.0.0', bindings: [{
        repositoryId: snapshot.repositoryId, checkoutBindingId, absoluteCheckoutRoot: root,
      }] }))
      process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH = registryPath
      const repo = await prisma.repository.findUnique({ where: { id: snapshot.repositoryId } })
      const projectRepository = await prisma.projectRepository.findUnique({ where: { id: snapshot.projectRepositoryId }, include: { repo: true } })
      const now = new Date()
      const verified = await verifyGovernanceSnapshotIntent({
        projectId: projectA.id, scope: { project: projectA, tenantId: snapshot.tenantId, businessId: businessA.id },
        repository: repo, projectRepository,
        input: { repositoryId: repo.id, commitSha, manifestHash, sourceManifest }, now,
      })
      const proven = await prisma.governanceSnapshot.create({ data: {
        tenantId: snapshot.tenantId, businessId: businessA.id, repositoryId: repo.id,
        projectRepositoryId: projectRepository.id, checkoutBindingId, commitSha, manifestHash,
        capturedAt: now, verifiedAt: new Date(verified.proof.verifiedAt),
        verifierId: verified.proof.verifierId, verifierVersion: verified.proof.verifierVersion,
        proofId: verified.proof.proofId, verificationProof: JSON.stringify(verified.proof),
        validationStatus: 'VALID', sourceManifest: JSON.stringify(verified.manifest),
      } })
      fixture.snapshots.push(proven.id)
      await prisma.projectFeature.update({ where: { id: featureA.id }, data: { canonicalFeatureKey: 'FEAT-001', governanceSnapshotId: proven.id } })
      await prisma.requirementBinding.update({ where: { id: originalBinding.id }, data: {
        governanceSnapshotId: proven.id, sourceNamespace: 'ZAI', revisionHash: statementDigest(statement),
      } })
      // Current working-tree wording is deliberately different from the bound commit.
      await writeFile(path.join(root, 'docs/PRD-SDD-v1.0.md'), 'Uncommitted misleading requirement text')
      const beforeAudit = await prisma.auditEvent.count()
      const beforeProgress = await prisma.workstream.findMany({ where: { projectId: projectA.id }, select: { id: true, progressCache: true }, orderBy: { id: 'asc' } })
      for (const handler of [getFeatureView, listFeatures, getFeature]) {
        const result = await call(handler, projectA.id, viewerA, '', { featureId: featureA.id })
        expect(result.response.status).toBe(200)
        const record = result.body.features?.find((row) => row.id === featureA.id)
          || result.body.items?.find((row) => row.id === featureA.id) || result.body
        expect(record).toMatchObject({ evidenceState: 'AVAILABLE', canonicalFeatureKey: 'FEAT-001', governanceSnapshotId: proven.id })
        expect(record.evidence[0].ref).toContain(commitSha)
        expect(record.requirementBindings[0]).toMatchObject({ bindingState: 'PINNED', canonicalSubject: 'Bind the approved requirement.' })
        expect(JSON.stringify(result.body)).not.toContain(root)
        expect(JSON.stringify(result.body)).not.toContain('Uncommitted misleading')
      }
      delete process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH
      const unavailable = await call(getFeature, projectA.id, viewerA, '', { featureId: featureA.id })
      expect(unavailable.response.status).toBe(200)
      expect(unavailable.body).toMatchObject({ evidenceState: 'UNAVAILABLE', canonicalFeatureKey: 'FEAT-001', governanceSnapshotId: proven.id })
      expect(unavailable.body.requirementBindings[0]).toMatchObject({ governanceSnapshotId: proven.id, bindingState: 'UNAVAILABLE', canonicalSubject: null })
      process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH = registryPath
      await prisma.requirementBinding.update({ where: { id: originalBinding.id }, data: { revisionHash: 'f'.repeat(64) } })
      const wrongRevision = await call(getFeature, projectA.id, viewerA, '', { featureId: featureA.id })
      expect(wrongRevision.body.evidenceState).toBe('AVAILABLE')
      expect(wrongRevision.body.requirementBindings[0]).toMatchObject({ bindingState: 'UNAVAILABLE', canonicalSubject: null })
      await prisma.repository.update({ where: { id: snapshot.repositoryId }, data: { status: 'DELETED' } })
      const inactiveSource = await call(getFeature, projectA.id, viewerA, '', { featureId: featureA.id })
      expect(inactiveSource.response.status).toBe(200)
      expect(inactiveSource.body).toMatchObject({ evidenceState: 'UNAVAILABLE', governanceSnapshotId: proven.id })
      expect(inactiveSource.body.requirementBindings[0]).toMatchObject({ bindingState: 'UNAVAILABLE', canonicalSubject: null })
      expect(await prisma.auditEvent.count()).toBe(beforeAudit)
      expect(await prisma.workstream.findMany({ where: { projectId: projectA.id }, select: { id: true, progressCache: true }, orderBy: { id: 'asc' } })).toEqual(beforeProgress)
    } finally {
      await prisma.repository.update({ where: { id: snapshot.repositoryId }, data: { status: 'ACTIVE' } })
      await prisma.projectFeature.update({ where: { id: featureA.id }, data: { canonicalFeatureKey: null, governanceSnapshotId: null } })
      await prisma.requirementBinding.update({ where: { id: originalBinding.id }, data: {
        governanceSnapshotId: originalBinding.governanceSnapshotId,
        sourceNamespace: originalBinding.sourceNamespace, revisionHash: originalBinding.revisionHash,
      } })
      if (priorRegistry === undefined) delete process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH
      else process.env.ZURI_PM_CHECKOUT_REGISTRY_PATH = priorRegistry
      const tempRoot = path.resolve(os.tmpdir())
      if (path.dirname(path.resolve(root)) !== tempRoot || !path.basename(root).startsWith('zuri-feature-read-proof-')) throw new Error('Unexpected test cleanup path')
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})

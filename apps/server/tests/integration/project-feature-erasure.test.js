import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import {
  applyReviewedProjectFeatureErasure,
  digestReviewedProjectFeatureManifest,
} from '@/modules/project-manager/application/project-feature-erasure'
import { createProject } from '@/modules/project-manager/application/project-service'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'

// @req FR-252 — reviewed Project Feature erasure is a transaction-scoped, exact
// target operation with version/CAS, hierarchy and replay protection.
// @spec ADR-097; docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/project-feature-erasure.test.js

const REDACTED = '[erased]'
const created = {
  features: [],
  contributions: [],
  audits: [],
  projects: [],
  persons: [],
  workspaces: [],
  businesses: [],
  tenants: [],
  portfolios: [],
}
let tenant
let business
let workspace
let project
let secondProject
let otherProject
let subject
let reviewer
let viewer
let feature
let secondFeature
let contribution
let tombstone

const id = () => randomUUID()
const code = (prefix) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`

function reviewedManifest(targets, overrides = {}) {
  const unsigned = {
    version: 'pm-erasure.v1',
    tenantId: tenant.id,
    businessId: business.id,
    subjectPersonId: subject.id,
    reviewerPersonId: reviewer.id,
    requestId: overrides.requestId || id(),
    reasonRef: overrides.reasonRef || 'case/phase-b-test',
    targets,
    ...(overrides.status ? { status: overrides.status } : {}),
  }
  return {
    ...unsigned,
    manifestSha256: digestReviewedProjectFeatureManifest(unsigned),
  }
}

function authority(wholeFieldsApproved = true, overrides = {}) {
  return {
    viewer,
    tenantId: tenant.id,
    businessId: business.id,
    subjectPersonId: subject.id,
    wholeFieldsApproved,
    ...overrides,
  }
}

async function apply(manifest, options = {}) {
  return prisma.$transaction((tx) => applyReviewedProjectFeatureErasure(tx, manifest, {
    authority: authority(options.wholeFieldsApproved ?? true, options.authority),
    now: new Date('2026-09-17T04:30:00.000Z'),
  }))
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'PM erasure integration', code: code('PF-PME') })
  created.portfolios.push(portfolio.id)
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'PM erasure tenant', code: code('TN-PME') })
  created.tenants.push(tenant.id)
  business = await createBusiness({ tenantId: tenant.id, name: 'PM erasure business', code: code('BU-PME') })
  created.businesses.push(business.id)
  workspace = await createWorkspace({
    businessId: business.id, scopeType: 'BUSINESS', name: 'PM erasure workspace', code: code('WS-PME'),
  })
  created.workspaces.push(workspace.id)
  const otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'PM other business', code: code('BU-PMO') })
  created.businesses.push(otherBusiness.id)
  const otherWorkspace = await createWorkspace({
    businessId: otherBusiness.id, scopeType: 'BUSINESS', name: 'PM other workspace', code: code('WS-PMO'),
  })
  created.workspaces.push(otherWorkspace.id)

  reviewer = await prisma.person.create({ data: { code: code('PER-PMR'), displayName: 'PM reviewer' } })
  subject = await prisma.person.create({ data: { code: code('PER-PMS'), displayName: 'PM subject' } })
  created.persons.push(reviewer.id, subject.id)
  viewer = makeViewer({
    principal: { id: reviewer.id, code: reviewer.code, displayName: reviewer.displayName },
    visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: [...VIEWER_DOMAINS],
  })
  project = await createProject({ workspaceId: workspace.id, businessId: business.id, name: 'PM erasure project', code: code('PR-PME') }, { viewer })
  secondProject = await createProject({ workspaceId: workspace.id, businessId: business.id, name: 'PM second erasure project', code: code('PR-PM2') }, { viewer })
  otherProject = await createProject({ workspaceId: otherWorkspace.id, businessId: otherBusiness.id, name: 'PM other project', code: code('PR-PMO') }, { viewer: makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id] }) })
  created.projects.push(project.id, secondProject.id, otherProject.id)

  feature = await prisma.projectFeature.create({ data: {
    tenantId: tenant.id, businessId: business.id, projectId: project.id, code: code('FE-PME'),
    title: 'Shared title', problem: 'Shared problem', outcome: 'Shared outcome',
    primaryDomainId: 'DOM-PROJECT-MANAGER', lifecycle: 'ACTIVE',
  } })
  created.features.push(feature.id)
  secondFeature = await prisma.projectFeature.create({ data: {
    tenantId: tenant.id, businessId: business.id, projectId: secondProject.id, code: code('FE-PM2'),
    title: 'Second title', problem: 'Second problem', outcome: 'Second outcome',
    primaryDomainId: 'DOM-CRM', lifecycle: 'DRAFT',
  } })
  created.features.push(secondFeature.id)
  contribution = await prisma.featureContribution.create({ data: {
    tenantId: tenant.id, businessId: business.id, featureId: feature.id,
    domainId: 'DOM-CRM', responsibility: 'Shared responsibility',
  } })
  created.contributions.push(contribution.id)
  tombstone = await prisma.projectFeature.create({ data: {
    tenantId: tenant.id, businessId: business.id, projectId: project.id, code: code('FE-PMT'),
    title: 'Tombstone title', problem: 'Tombstone problem', outcome: 'Tombstone outcome',
    primaryDomainId: 'DOM-SCM', lifecycle: 'RETIRED', deletedAt: new Date('2026-09-16T00:00:00.000Z'), deleteBatchId: id(),
  } })
  created.features.push(tombstone.id)
})

afterAll(async () => {
  // Delete only this suite's rows, in FK order, so later invariant/backup suites
  // cannot observe a deliberately tombstoned or replay-marked fixture.
  if (created.contributions.length) await prisma.featureContribution.deleteMany({ where: { id: { in: created.contributions } } })
  if (created.features.length) await prisma.projectFeature.deleteMany({ where: { id: { in: created.features } } })
  if (created.audits.length) await prisma.auditEvent.deleteMany({ where: { id: { in: created.audits } } })
  if (created.projects.length) await prisma.project.deleteMany({ where: { id: { in: created.projects } } })
  if (created.persons.length) await prisma.person.deleteMany({ where: { id: { in: created.persons } } })
  if (created.workspaces.length) await prisma.workspace.deleteMany({ where: { id: { in: created.workspaces } } })
  if (created.businesses.length) await prisma.business.deleteMany({ where: { id: { in: created.businesses } } })
  if (created.tenants.length) await prisma.tenant.deleteMany({ where: { id: { in: created.tenants } } })
  if (created.portfolios.length) await prisma.portfolio.deleteMany({ where: { id: { in: created.portfolios } } })
})

describe('reviewed Project Feature erasure', () => {
  it('redacts only reviewed fields, bumps each changed row once and preserves the parent/lifecycle', async () => {
    const auditBefore = await prisma.auditEvent.count({ where: { entityType: 'PRINCIPAL', entityId: subject.id } })
    const manifest = reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: feature.id, field: 'title', expectedVersion: 1 },
      { projectId: project.id, recordType: 'FeatureContribution', recordId: contribution.id, field: 'responsibility', expectedVersion: 1 },
    ], { status: 'REVIEWED' })

    const result = await apply(manifest)
    expect(result).toMatchObject({ status: 'APPLIED', manifestSha256: manifest.manifestSha256, changedRowCount: 2, changedFieldCount: 2 })
    const storedFeature = await prisma.projectFeature.findUnique({ where: { id: feature.id } })
    const storedContribution = await prisma.featureContribution.findUnique({ where: { id: contribution.id } })
    expect(storedFeature).toMatchObject({ title: REDACTED, problem: 'Shared problem', outcome: 'Shared outcome', lifecycle: 'ACTIVE', version: 2 })
    expect(storedContribution).toMatchObject({ responsibility: REDACTED, version: 2 })
    expect(await prisma.auditEvent.count({ where: { entityType: 'PRINCIPAL', entityId: subject.id } })).toBe(auditBefore)
  })

  it('returns PENDING/UNMAPPED without touching a family and rejects malformed manifests', async () => {
    const pending = reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: feature.id, field: 'problem', expectedVersion: 2 },
    ])
    await expect(apply(pending, { wholeFieldsApproved: false })).resolves.toMatchObject({ status: 'PENDING', changedRowCount: 0 })
    await expect(prisma.$transaction((tx) => applyReviewedProjectFeatureErasure(tx, null, { authority: authority() })))
      .resolves.toMatchObject({ status: 'UNMAPPED', manifestSha256: null })
    const withoutDigest = { ...pending }
    delete withoutDigest.manifestSha256
    await expect(apply(withoutDigest)).rejects.toMatchObject({ code: 'PM_ERASURE_MANIFEST_DIGEST_REQUIRED' })
    await expect(apply({ ...pending, unexpected: true })).rejects.toMatchObject({ code: 'PM_ERASURE_MANIFEST_INVALID' })
  })

  it('refuses stale and foreign targets before any PM update', async () => {
    const stale = await prisma.projectFeature.create({ data: {
      tenantId: tenant.id, businessId: business.id, projectId: project.id, code: code('FE-PMS'),
      title: 'Stale title', problem: 'Stale problem', outcome: 'Stale outcome', primaryDomainId: 'DOM-CRM', lifecycle: 'DRAFT',
    } })
    created.features.push(stale.id)
    await prisma.projectFeature.update({ where: { id: stale.id }, data: { version: { increment: 1 } } })
    await expect(apply(reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: stale.id, field: 'title', expectedVersion: 1 },
    ]))).rejects.toMatchObject({ code: 'PM_ERASURE_VERSION_CONFLICT', status: 409 })
    expect(await prisma.projectFeature.findUnique({ where: { id: stale.id } })).toMatchObject({ title: 'Stale title', version: 2 })

    const foreign = reviewedManifest([
      { projectId: otherProject.id, recordType: 'ProjectFeature', recordId: stale.id, field: 'title', expectedVersion: 2 },
    ])
    await expect(apply(foreign)).rejects.toMatchObject({ code: 'PHASE_B_SCOPE_MISMATCH', status: 404 })
    expect(await prisma.projectFeature.findUnique({ where: { id: stale.id } })).toMatchObject({ title: 'Stale title', version: 2 })
  })

  it('validates every locked Project before the first update in a multi-Project request', async () => {
    const before = await prisma.projectFeature.findUnique({ where: { id: feature.id } })
    await expect(apply(reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: feature.id, field: 'problem', expectedVersion: before.version },
      { projectId: secondProject.id, recordType: 'ProjectFeature', recordId: id(), field: 'title', expectedVersion: 1 },
    ]))).rejects.toMatchObject({ code: 'PM_ERASURE_TARGET_NOT_FOUND', status: 409 })
    expect(await prisma.projectFeature.findUnique({ where: { id: feature.id } })).toMatchObject({
      problem: before.problem,
      version: before.version,
    })
  })

  it('supports replay by immutable digest and preserves a tombstone deletion cohort', async () => {
    const replayManifest = reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: tombstone.id, field: 'outcome', expectedVersion: 1 },
    ], { requestId: `replay-${id()}` })
    const first = await apply(replayManifest)
    const beforeReplay = await prisma.projectFeature.findUnique({ where: { id: tombstone.id } })
    expect(first.status).toBe('APPLIED')
    expect(beforeReplay).toMatchObject({ outcome: REDACTED, version: 2, lifecycle: 'RETIRED' })
    const audit = await prisma.auditEvent.create({ data: {
      entityType: 'PRINCIPAL', entityId: subject.id, action: 'ERASED',
      payloadJson: JSON.stringify({ pmErasure: first.audit }),
    } })
    created.audits.push(audit.id)
    await expect(apply(replayManifest)).resolves.toMatchObject({ status: 'REPLAYED', changedRowCount: 0 })
    expect(await prisma.projectFeature.findUnique({ where: { id: tombstone.id } })).toMatchObject({ outcome: REDACTED, version: 2 })

    const changedDigest = reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: tombstone.id, field: 'problem', expectedVersion: 2 },
    ], { requestId: replayManifest.requestId })
    await expect(apply(changedDigest)).rejects.toMatchObject({ code: 'PM_ERASURE_REPLAY_CONFLICT', status: 409 })
  })

  it('rebinds and restores the transaction-local Postgres scope for each bounded Project callback', async () => {
    const fakeFeature = {
      id: id(), tenantId: tenant.id, businessId: business.id, projectId: project.id,
      title: 'Bounded title', problem: 'Bounded problem', outcome: 'Bounded outcome', version: 1,
    }
    let boundScope = { tenantId: null, businessId: null }
    const setCalls = []
    const tx = {
      dialect: 'postgres',
      project: { findUnique: vi.fn(async () => ({ id: project.id, businessId: business.id, workspaceId: workspace.id, deletedAt: null })) },
      workspace: { findUnique: vi.fn(async () => ({ id: workspace.id, scopeType: 'BUSINESS', tenantId: tenant.id, businessId: business.id, portfolioId: null, status: 'ACTIVE' })) },
      business: { findUnique: vi.fn(async () => ({ id: business.id, tenantId: tenant.id, status: 'ACTIVE' })) },
      tenant: { findUnique: vi.fn(async () => ({ id: tenant.id, portfolioId: null, status: 'ACTIVE' })) },
      projectFeature: {
        findMany: vi.fn(async () => [fakeFeature]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      featureContribution: { findMany: vi.fn(async () => []) },
      auditEvent: { findMany: vi.fn(async () => []) },
      $queryRawUnsafe: vi.fn(async (sql) => {
        if (sql.includes('current_setting')) return [boundScope]
        if (sql.includes('FOR UPDATE')) return [{ id: sql.includes('Person') ? subject.id : project.id }]
        return []
      }),
      $executeRawUnsafe: vi.fn(async (sql, ...params) => {
        if (sql.includes('set_config')) {
          boundScope = { tenantId: params[0] || null, businessId: params[1] || null }
          setCalls.push(params)
        }
        return 1
      }),
    }
    const manifest = reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: fakeFeature.id, field: 'title', expectedVersion: 1 },
    ])

    await expect(applyReviewedProjectFeatureErasure(tx, manifest, {
      authority: authority(), now: new Date('2026-09-17T04:30:00.000Z'),
    })).resolves.toMatchObject({ status: 'APPLIED', changedRowCount: 1 })
    expect(boundScope).toEqual({ tenantId: null, businessId: null })
    expect(setCalls).toEqual([
      [tenant.id, business.id], ['', ''],
      [tenant.id, business.id], ['', ''],
    ])
  })

  it('refuses a foreign initial Postgres scope before subject locking or replay lookup', async () => {
    const foreignScope = { tenantId: id(), businessId: id() }
    const tx = {
      dialect: 'postgres',
      $queryRawUnsafe: vi.fn(async (sql) => sql.includes('current_setting') ? [foreignScope] : []),
    }
    const manifest = reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: tombstone.id, field: 'outcome', expectedVersion: 2 },
    ])

    await expect(applyReviewedProjectFeatureErasure(tx, manifest, {
      authority: authority(), now: new Date('2026-09-17T04:30:00.000Z'),
    })).rejects.toMatchObject({ code: 'PM_ERASURE_INITIAL_SCOPE_UNRECOGNIZED', status: 503 })
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1)
  })

  it('refuses a PostgreSQL subject lock that returns no row', async () => {
    const tx = {
      dialect: 'postgres',
      $queryRawUnsafe: vi.fn(async (sql) => {
        if (sql.includes('current_setting')) return [{ tenantId: null, businessId: null }]
        if (sql.includes('FOR UPDATE')) return []
        return []
      }),
    }
    const manifest = reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: tombstone.id, field: 'outcome', expectedVersion: 1 },
    ])

    await expect(applyReviewedProjectFeatureErasure(tx, manifest, {
      authority: authority(), now: new Date('2026-09-17T04:30:00.000Z'),
    })).rejects.toMatchObject({ code: 'PM_ERASURE_SUBJECT_NOT_FOUND', status: 404 })
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(2)
  })

  it('restores the prior Postgres scope when bind readback fails', async () => {
    const setCalls = []
    let currentSettingRead = 0
    const tx = {
      dialect: 'postgres',
      project: { findUnique: vi.fn(async () => ({ id: project.id, businessId: business.id, workspaceId: workspace.id, deletedAt: null })) },
      workspace: { findUnique: vi.fn(async () => ({ id: workspace.id, scopeType: 'BUSINESS', tenantId: tenant.id, businessId: business.id, portfolioId: null, status: 'ACTIVE' })) },
      business: { findUnique: vi.fn(async () => ({ id: business.id, tenantId: tenant.id, status: 'ACTIVE' })) },
      tenant: { findUnique: vi.fn(async () => ({ id: tenant.id, portfolioId: null, status: 'ACTIVE' })) },
      auditEvent: { findMany: vi.fn(async () => []) },
      $executeRawUnsafe: vi.fn(async (sql, ...params) => {
        if (sql.includes('set_config')) setCalls.push(params)
        return 1
      }),
      $queryRawUnsafe: vi.fn(async (sql) => {
        if (sql.includes('current_setting')) {
          currentSettingRead += 1
          if (currentSettingRead === 1) return [{ tenantId: null, businessId: null }]
          if (currentSettingRead === 2) return [{ tenantId: id(), businessId: id() }]
          return [{ tenantId: null, businessId: null }]
        }
        if (sql.includes('FOR UPDATE')) return [{ id: sql.includes('Person') ? subject.id : project.id }]
        return []
      }),
    }
    const manifest = reviewedManifest([
      { projectId: project.id, recordType: 'ProjectFeature', recordId: tombstone.id, field: 'outcome', expectedVersion: 2 },
    ])

    await expect(applyReviewedProjectFeatureErasure(tx, manifest, {
      authority: authority(), now: new Date('2026-09-17T04:30:00.000Z'),
    })).rejects.toMatchObject({ code: 'PM_ERASURE_SCOPE_BINDING_MISMATCH', status: 503 })
    expect(setCalls).toEqual([[tenant.id, business.id], ['', '']])
    expect(currentSettingRead).toBe(3)
  })
})

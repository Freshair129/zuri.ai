import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock('@/modules/project-manager/application/project-feature-service', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, resolveRequestViewerForFeatureMutation: mocks.authorize }
})

import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createItem } from '@/modules/project-manager/application/work-service'
import {
  createProjectFeature,
  deleteProjectFeature,
  replaceProjectFeatureContributions,
  replaceProjectFeatureRequirementBindings,
  replaceProjectFeatureWorkLinks,
  restoreProjectFeature,
  updateProjectFeature,
  zMutationError,
  zMutationReceipt,
} from '@/modules/project-manager/application/project-feature-service'
import { POST as createFeatureRoute } from '@/app/api/projects/[id]/features/route'

// @req FR-252 — Feature mutations use owner authority, strong CAS, complete
// relationship replacement, exact allocation and deletion-cohort restoration.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/project-feature-mutations.test.js

const fixture = {
  portfolios: [], tenants: [], businesses: [], workspaces: [], projects: [],
  workstreams: [], items: [], features: [],
}

let projectA
let projectB
let itemA
let itemB
let viewerA
let viewerB
let featureId
let featureVersion = 1

const uid = () => randomUUID()
const suffix = () => uid().slice(0, 8).toUpperCase()

const featureInput = (over = {}) => ({
  code: `FE-W4-${suffix()}`,
  title: 'W4 mutation feature',
  problem: 'A bounded mutation problem',
  outcome: 'A persisted and auditable result',
  primaryDomainId: 'DOM-COMMERCE',
  ...over,
})

function mutationHeaders({ idempotencyKey, ifMatch } = {}) {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey || `idem-${uid()}`,
    'X-CSRF-Token': 'test-token',
    ...(ifMatch ? { 'If-Match': ifMatch } : {}),
  }
}

async function callCreateRoute(input, idempotencyKey) {
  const request = new Request(`http://local/api/projects/${projectA.id}/features`, {
    method: 'POST',
    headers: mutationHeaders({ idempotencyKey }),
    body: JSON.stringify(input),
  })
  const response = await createFeatureRoute(request, { params: { id: projectA.id } })
  return { response, body: await response.json() }
}

beforeAll(async () => {
  const group = await createPortfolio({ name: `W4 mutations ${suffix()}`, code: `PF-W4-${suffix()}` })
  fixture.portfolios.push(group.id)
  const tenant = await createTenant({ portfolioId: group.id, name: `W4 tenant ${suffix()}`, code: `TN-W4-${suffix()}` })
  fixture.tenants.push(tenant.id)
  const businessA = await createBusiness({ tenantId: tenant.id, name: `W4 business A ${suffix()}`, code: `BU-W4A-${suffix()}` })
  const businessB = await createBusiness({ tenantId: tenant.id, name: `W4 business B ${suffix()}`, code: `BU-W4B-${suffix()}` })
  fixture.businesses.push(businessA.id, businessB.id)
  const workspaceA = await createWorkspace({
    businessId: businessA.id, scopeType: 'BUSINESS', name: `W4 workspace A ${suffix()}`, code: `WS-W4A-${suffix()}`,
  })
  const workspaceB = await createWorkspace({
    businessId: businessB.id, scopeType: 'BUSINESS', name: `W4 workspace B ${suffix()}`, code: `WS-W4B-${suffix()}`,
  })
  fixture.workspaces.push(workspaceA.id, workspaceB.id)

  viewerA = makeViewer({
    principal: { id: uid(), code: 'W4-OWNER-A', displayName: 'W4 Owner A' },
    visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id],
  })
  viewerB = makeViewer({
    principal: { id: uid(), code: 'W4-OWNER-B', displayName: 'W4 Owner B' },
    visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id],
  })

  projectA = await createProject({
    workspaceId: workspaceA.id, businessId: businessA.id, name: `W4 project A ${suffix()}`, code: `PR-W4A-${suffix()}`,
  }, { viewer: viewerA })
  projectB = await createProject({
    workspaceId: workspaceB.id, businessId: businessB.id, name: `W4 project B ${suffix()}`, code: `PR-W4B-${suffix()}`,
  }, { viewer: viewerB })
  fixture.projects.push(projectA.id, projectB.id)

  const streamA = await createWorkstream({
    projectId: projectA.id, name: `W4 stream A ${suffix()}`, code: `WST-W4A-${suffix()}`, executionMode: 'SOFTWARE_SPRINT',
  }, { viewer: viewerA })
  const streamB = await createWorkstream({
    projectId: projectB.id, name: `W4 stream B ${suffix()}`, code: `WST-W4B-${suffix()}`, executionMode: 'SOFTWARE_SPRINT',
  }, { viewer: viewerB })
  fixture.workstreams.push(streamA.id, streamB.id)
  itemA = await createItem({
    workstreamId: streamA.id, code: `WI-W4A-${suffix()}`, subtype: 'TASK', title: 'W4 local item', status: 'PLANNED',
  }, { viewer: viewerA })
  itemB = await createItem({
    workstreamId: streamB.id, code: `WI-W4B-${suffix()}`, subtype: 'TASK', title: 'W4 foreign item', status: 'PLANNED',
  }, { viewer: viewerB })
  fixture.items.push(itemA.id, itemB.id)
})

afterAll(async () => {
  const projectIds = fixture.projects
  const featureRows = fixture.features.length
    ? await prisma.projectFeature.findMany({ where: { id: { in: fixture.features } }, select: { id: true } })
    : []
  const featureIds = featureRows.map((row) => row.id)
  const receipts = projectIds.length
    ? await prisma.projectFeatureMutationReceipt.findMany({ where: { projectId: { in: projectIds } }, select: { id: true, auditEventId: true } })
    : []
  if (receipts.length) await prisma.projectFeatureMutationReceipt.deleteMany({ where: { id: { in: receipts.map((row) => row.id) } } })
  if (featureIds.length) {
    await prisma.requirementBinding.deleteMany({ where: { featureId: { in: featureIds } } })
    await prisma.featureWorkLink.deleteMany({ where: { featureId: { in: featureIds } } })
    await prisma.featureContribution.deleteMany({ where: { featureId: { in: featureIds } } })
    await prisma.projectFeature.deleteMany({ where: { id: { in: featureIds } } })
  }
  if (receipts.length) await prisma.auditEvent.deleteMany({ where: { id: { in: receipts.map((row) => row.auditEventId) } } })
  if (fixture.items.length) await prisma.workItem.deleteMany({ where: { id: { in: fixture.items } } })
  if (fixture.workstreams.length) await prisma.workstream.deleteMany({ where: { id: { in: fixture.workstreams } } })
  if (fixture.projects.length) await prisma.project.deleteMany({ where: { id: { in: fixture.projects } } })
  if (fixture.workspaces.length) await prisma.workspace.deleteMany({ where: { id: { in: fixture.workspaces } } })
  if (fixture.businesses.length) await prisma.business.deleteMany({ where: { id: { in: fixture.businesses } } })
  if (fixture.tenants.length) await prisma.tenant.deleteMany({ where: { id: { in: fixture.tenants } } })
  if (fixture.portfolios.length) await prisma.portfolio.deleteMany({ where: { id: { in: fixture.portfolios } } })
})

describe('FR-252 Project Feature mutation routes and service', () => {
  beforeEach(() => {
    // This route fixture intentionally bypasses the outer Identity adapter;
    // service calls without a session still use the persisted Project scope.
    // Live Session reproof is covered by the real Identity integration suite.
    mocks.authorize.mockResolvedValue({ viewer: viewerA, session: null })
  })

  it('creates a DRAFT through the route and replays the same committed receipt', async () => {
    const input = featureInput({ code: `FE-W4-CREATE-${suffix()}` })
    const key = `create-${uid()}`
    const first = await callCreateRoute(input, key)
    expect(first.response.status).toBe(201)
    expect(zMutationReceipt.parse(first.body)).toEqual(first.body)
    expect(first.body).toMatchObject({
      targetId: projectA.id, targetType: 'PROJECT', operation: 'CREATE_FEATURE',
      resourceType: 'PROJECT_FEATURE', status: 'COMMITTED', version: 1,
    })
    featureId = first.body.resourceId
    fixture.features.push(featureId)
    const auditCount = await prisma.auditEvent.count({ where: { entityType: 'PROJECT_FEATURE', entityId: featureId } })

    const replay = await callCreateRoute(input, key)
    expect(replay.response.status).toBe(200)
    expect(replay.body.receiptId).toBe(first.body.receiptId)
    expect(replay.body.requestId).not.toBe(first.body.requestId)
    expect(replay.body.status).toBe('COMMITTED')
    expect(await prisma.auditEvent.count({ where: { entityType: 'PROJECT_FEATURE', entityId: featureId } })).toBe(auditCount)

    const changed = await callCreateRoute({ ...input, title: 'changed payload' }, key)
    expect(changed.response.status).toBe(409)
    expect(zMutationError.parse(changed.body)).toEqual(changed.body)
    expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('returns the strict refusal envelope with a correlated request id', async () => {
    const request = new Request(`http://local/api/projects/${projectA.id}/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
      body: JSON.stringify(featureInput({ code: `FE-W4-MISSING-IDEMPOTENCY-${suffix()}` })),
    })
    const response = await createFeatureRoute(request, { params: { id: projectA.id } })
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(zMutationError.parse(body)).toEqual(body)
    expect(body).toMatchObject({ code: 'MALFORMED_REQUEST', retryable: false })
    expect(response.headers.get('X-Request-ID')).toBe(body.requestId)
    expect(body).not.toHaveProperty('status')
    expect(body).not.toHaveProperty('error')
  })

  it('checks Project scope before parsing a body at the HTTP boundary', async () => {
    const foreignRequest = new Request(`http://local/api/projects/${projectB.id}/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `foreign-invalid-${uid()}`, 'X-CSRF-Token': 'test-token' },
      body: '{',
    })
    const foreignResponse = await createFeatureRoute(foreignRequest, { params: { id: projectB.id } })
    const foreignBody = await foreignResponse.json()
    expect(foreignResponse.status).toBe(404)
    expect(foreignBody).toMatchObject({ code: 'RESOURCE_NOT_FOUND', retryable: false })
    expect(zMutationError.parse(foreignBody)).toEqual(foreignBody)

    const ownedRequest = new Request(`http://local/api/projects/${projectA.id}/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `owned-invalid-${uid()}`, 'X-CSRF-Token': 'test-token' },
      body: '{',
    })
    const ownedResponse = await createFeatureRoute(ownedRequest, { params: { id: projectA.id } })
    const ownedBody = await ownedResponse.json()
    expect(ownedResponse.status).toBe(400)
    expect(ownedBody).toMatchObject({ code: 'MALFORMED_REQUEST', retryable: false })
    expect(zMutationError.parse(ownedBody)).toEqual(ownedBody)
  })

  it('enforces ETag CAS, supports complete child replacement, and rejects unproven bindings', async () => {
    const initial = await prisma.projectFeature.findUnique({ where: { id: featureId } })
    const patch = await updateProjectFeature(projectA.id, featureId, { title: 'Updated W4 title' }, {
      viewer: viewerA, ifMatch: `"PROJECT_FEATURE/${featureId}/v${initial.version}"`, idempotencyKey: `patch-${uid()}`, requestId: uid(),
    })
    expect(patch.receipt.version).toBe(initial.version + 1)
    featureVersion = patch.receipt.version
    await expect(updateProjectFeature(projectA.id, featureId, { outcome: 'stale' }, {
      viewer: viewerA, ifMatch: `"PROJECT_FEATURE/${featureId}/v${initial.version}"`, idempotencyKey: `stale-${uid()}`, requestId: uid(),
    })).rejects.toMatchObject({ code: 'VERSION_MISMATCH', status: 412, currentVersion: featureVersion })

    const contribution = await replaceProjectFeatureContributions(projectA.id, featureId, {
      contributions: [{ domainId: 'DOM-CRM', responsibility: 'Supports customer execution' }],
    }, {
      viewer: viewerA, ifMatch: patch.receipt.etag, idempotencyKey: `contrib-${uid()}`, requestId: uid(),
    })
    expect(contribution.receipt.operation).toBe('REPLACE_CONTRIBUTIONS')
    const contributionRows = await prisma.featureContribution.findMany({ where: { featureId, deletedAt: null } })
    expect(contributionRows).toHaveLength(1)
    expect(contributionRows[0].domainId).toBe('DOM-CRM')
    featureVersion = contribution.receipt.version

    const beforeInvalidPrimary = await prisma.projectFeature.findUnique({ where: { id: featureId }, select: { version: true, primaryDomainId: true } })
    const receiptsBeforeInvalidPrimary = await prisma.projectFeatureMutationReceipt.count({ where: { featureId } })
    const auditsBeforeInvalidPrimary = await prisma.auditEvent.count({ where: { entityType: 'PROJECT_FEATURE', entityId: featureId } })
    await expect(updateProjectFeature(projectA.id, featureId, { primaryDomainId: 'DOM-CRM' }, {
      viewer: viewerA,
      ifMatch: contribution.receipt.etag,
      idempotencyKey: `primary-conflict-${uid()}`,
      requestId: uid(),
    })).rejects.toMatchObject({ code: 'PRIMARY_DOMAIN_DUPLICATE', status: 422 })
    expect(await prisma.projectFeature.findUnique({ where: { id: featureId }, select: { version: true, primaryDomainId: true } })).toEqual(beforeInvalidPrimary)
    expect(await prisma.projectFeatureMutationReceipt.count({ where: { featureId } })).toBe(receiptsBeforeInvalidPrimary)
    expect(await prisma.auditEvent.count({ where: { entityType: 'PROJECT_FEATURE', entityId: featureId } })).toBe(auditsBeforeInvalidPrimary)

    const links = await replaceProjectFeatureWorkLinks(projectA.id, featureId, {
      allocationMode: 'COMPLETE_SPLIT', links: [{ workItemId: itemA.id, allocationBps: 10000 }],
    }, {
      viewer: viewerA, ifMatch: contribution.receipt.etag, idempotencyKey: `links-${uid()}`, requestId: uid(),
    })
    expect(links.receipt.operation).toBe('REPLACE_WORK_LINKS')
    featureVersion = links.receipt.version
    await expect(replaceProjectFeatureWorkLinks(projectA.id, featureId, {
      allocationMode: 'COMPLETE_SPLIT', links: [{ workItemId: itemB.id, allocationBps: 10000 }],
    }, {
      viewer: viewerA, ifMatch: links.receipt.etag, idempotencyKey: `foreign-${uid()}`, requestId: uid(),
    })).rejects.toMatchObject({ code: 'CROSS_PROJECT_WORK_LINK', status: 422 })

    await expect(replaceProjectFeatureRequirementBindings(projectA.id, featureId, {
      bindings: [{
        governanceSnapshotId: uid(), sourceNamespace: 'zuri', requirementKey: 'FR-252',
        revisionHash: 'a'.repeat(64), acceptanceRef: 'docs/plan#proof',
      }],
    }, {
      viewer: viewerA, ifMatch: links.receipt.etag, idempotencyKey: `binding-${uid()}`, requestId: uid(),
    })).rejects.toMatchObject({ code: 'SNAPSHOT_REQUIRED', status: 422 })
  })

  it('soft-deletes and restores one exact child cohort, while an unowned viewer cannot mutate', async () => {
    const before = await prisma.projectFeature.findUnique({ where: { id: featureId } })
    const childrenBefore = await Promise.all([
      prisma.featureContribution.findMany({ where: { featureId, deletedAt: null }, select: { id: true } }),
      prisma.featureWorkLink.findMany({ where: { featureId, deletedAt: null }, select: { id: true } }),
    ])
    const deleted = await deleteProjectFeature(projectA.id, featureId, {
      viewer: viewerA, ifMatch: `"PROJECT_FEATURE/${featureId}/v${before.version}"`, idempotencyKey: `delete-${uid()}`, requestId: uid(),
    })
    expect(deleted.receipt.operation).toBe('DELETE_FEATURE')
    expect((await prisma.projectFeature.findUnique({ where: { id: featureId } })).deletedAt).not.toBeNull()
    expect(await prisma.featureContribution.count({ where: { featureId, deletedAt: null } })).toBe(0)
    expect(await prisma.featureWorkLink.count({ where: { featureId, deletedAt: null } })).toBe(0)

    const restored = await restoreProjectFeature(projectA.id, featureId, {
      viewer: viewerA, ifMatch: deleted.receipt.etag, idempotencyKey: `restore-${uid()}`, requestId: uid(),
    })
    expect(restored.receipt.operation).toBe('RESTORE_FEATURE')
    expect((await prisma.projectFeature.findUnique({ where: { id: featureId } })).deletedAt).toBeNull()
    expect(await prisma.featureContribution.findMany({ where: { featureId, deletedAt: null }, select: { id: true } })).toEqual(childrenBefore[0])
    expect(await prisma.featureWorkLink.findMany({ where: { featureId, deletedAt: null }, select: { id: true } })).toEqual(childrenBefore[1])

    const countsBefore = await prisma.projectFeature.count({ where: { projectId: projectA.id } })
    const foreignViewer = ownsElsewhere({ owns: uid(), sees: viewerA.visibleBusinessIds[0] })
    await expect(createProjectFeature(projectA.id, featureInput(), {
      viewer: foreignViewer, idempotencyKey: `foreign-owner-${uid()}`, requestId: uid(),
    })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.projectFeature.count({ where: { projectId: projectA.id } })).toBe(countsBefore)
  })
})

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createItem } from '@/modules/project-manager/application/work-service'
import {
  computeProjectFeatureGraphEtag,
  createProjectFeature,
  redistributeProjectFeatureWorkLinks,
} from '@/modules/project-manager/application/project-feature-service'

// @req FR-252 — Project Feature graph allocation is an exact, lock-scoped
// replacement across named Features and affected WorkItems.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
// @tested tests/integration/project-feature-graph.test.js

const fixture = {
  portfolios: [], tenants: [], businesses: [], workspaces: [], projects: [],
  workstreams: [], items: [], features: [],
}

let project
let viewer
let itemA
let itemB
let featureA
let featureB

const uid = () => randomUUID()
const suffix = () => uid().slice(0, 8).toUpperCase()

function input(code) {
  return {
    code,
    title: `Graph ${code}`,
    problem: 'A graph allocation problem',
    outcome: 'A complete per WorkItem split',
    primaryDomainId: 'DOM-OPERATIONS',
  }
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: `Graph group ${suffix()}`, code: `PF-GR-${suffix()}` })
  fixture.portfolios.push(portfolio.id)
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Graph tenant ${suffix()}`, code: `TN-GR-${suffix()}` })
  fixture.tenants.push(tenant.id)
  const business = await createBusiness({ tenantId: tenant.id, name: `Graph business ${suffix()}`, code: `BU-GR-${suffix()}` })
  fixture.businesses.push(business.id)
  const workspace = await createWorkspace({
    businessId: business.id, scopeType: 'BUSINESS', name: `Graph workspace ${suffix()}`, code: `WS-GR-${suffix()}`,
  })
  fixture.workspaces.push(workspace.id)
  viewer = makeViewer({
    principal: { id: uid(), code: 'GRAPH-OWNER', displayName: 'Graph Owner' },
    visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
  })
  project = await createProject({
    workspaceId: workspace.id, businessId: business.id, name: `Graph project ${suffix()}`, code: `PR-GR-${suffix()}`,
  }, { viewer })
  fixture.projects.push(project.id)
  const workstream = await createWorkstream({
    projectId: project.id, name: `Graph stream ${suffix()}`, code: `WST-GR-${suffix()}`, executionMode: 'SOFTWARE_SPRINT',
  }, { viewer })
  fixture.workstreams.push(workstream.id)
  itemA = await createItem({ workstreamId: workstream.id, code: `WI-GR-A-${suffix()}`, subtype: 'TASK', title: 'Graph item A' }, { viewer })
  itemB = await createItem({ workstreamId: workstream.id, code: `WI-GR-B-${suffix()}`, subtype: 'TASK', title: 'Graph item B' }, { viewer })
  fixture.items.push(itemA.id, itemB.id)
  featureA = await createProjectFeature(project.id, input(`FE-GR-A-${suffix()}`), {
    viewer, requestId: uid(), idempotencyKey: `create-a-${uid()}`,
  })
  featureB = await createProjectFeature(project.id, input(`FE-GR-B-${suffix()}`), {
    viewer, requestId: uid(), idempotencyKey: `create-b-${uid()}`,
  })
  fixture.features.push(featureA.receipt.resourceId, featureB.receipt.resourceId)
})

afterAll(async () => {
  const receipts = fixture.projects.length
    ? await prisma.projectFeatureMutationReceipt.findMany({ where: { projectId: { in: fixture.projects } }, select: { id: true, auditEventId: true } })
    : []
  if (receipts.length) await prisma.projectFeatureMutationReceipt.deleteMany({ where: { id: { in: receipts.map((row) => row.id) } } })
  if (fixture.features.length) {
    await prisma.featureWorkLink.deleteMany({ where: { featureId: { in: fixture.features } } })
    await prisma.featureContribution.deleteMany({ where: { featureId: { in: fixture.features } } })
    await prisma.requirementBinding.deleteMany({ where: { featureId: { in: fixture.features } } })
    await prisma.projectFeature.deleteMany({ where: { id: { in: fixture.features } } })
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

describe('FR-252 Project Feature graph mutations', () => {
  it('replaces named Feature link sets with exact affected membership and per-item COMPLETE_SPLIT totals', async () => {
    const beforeFeatures = await prisma.projectFeature.findMany({
      where: { projectId: project.id }, orderBy: { id: 'asc' }, select: { id: true, version: true, deletedAt: true },
    })
    const graphEtag = computeProjectFeatureGraphEtag(project.id, beforeFeatures)
    const result = await redistributeProjectFeatureWorkLinks(project.id, {
      allocationMode: 'COMPLETE_SPLIT',
      affectedWorkItemIds: [itemA.id, itemB.id],
      featureSets: [
        { featureId: featureA.receipt.resourceId, links: [
          { workItemId: itemA.id, allocationBps: 4000 },
          { workItemId: itemB.id, allocationBps: 10000 },
        ] },
        { featureId: featureB.receipt.resourceId, links: [
          { workItemId: itemA.id, allocationBps: 6000 },
        ] },
      ],
    }, {
      viewer, ifMatch: graphEtag, requestId: uid(), idempotencyKey: `graph-${uid()}`,
    })

    expect(result.receipt).toMatchObject({
      targetId: project.id, targetType: 'PROJECT', operation: 'REPLACE_FEATURE_WORK_GRAPH',
      resourceId: project.id, resourceType: 'PROJECT_FEATURE_GRAPH', status: 'COMMITTED', version: null,
    })
    const links = await prisma.featureWorkLink.findMany({
      where: { featureId: { in: [featureA.receipt.resourceId, featureB.receipt.resourceId] }, deletedAt: null },
      select: { featureId: true, workItemId: true, allocationBps: true }, orderBy: [{ workItemId: 'asc' }, { featureId: 'asc' }],
    })
    expect(links).toHaveLength(3)
    const totals = new Map()
    for (const link of links) totals.set(link.workItemId, (totals.get(link.workItemId) || 0) + link.allocationBps)
    expect(totals.get(itemA.id)).toBe(10000)
    expect(totals.get(itemB.id)).toBe(10000)

    const current = await prisma.projectFeature.findMany({
      where: { projectId: project.id }, orderBy: { id: 'asc' }, select: { id: true, version: true, deletedAt: true },
    })
    const currentEtag = computeProjectFeatureGraphEtag(project.id, current)
    expect(result.receipt.etag).toBe(currentEtag)
    await expect(redistributeProjectFeatureWorkLinks(project.id, {
      allocationMode: 'COMPLETE_SPLIT', affectedWorkItemIds: [itemA.id], featureSets: [{
        featureId: featureA.receipt.resourceId, links: [{ workItemId: itemA.id, allocationBps: 10000 }],
      }],
    }, {
      viewer, ifMatch: graphEtag, requestId: uid(), idempotencyKey: `graph-stale-${uid()}`,
    })).rejects.toMatchObject({ code: 'VERSION_MISMATCH', status: 412, currentEtag })
  })

  it('rejects graph membership gaps and invalid per-WorkItem totals before changing links', async () => {
    const current = await prisma.projectFeature.findMany({
      where: { projectId: project.id }, orderBy: { id: 'asc' }, select: { id: true, version: true, deletedAt: true },
    })
    const etag = computeProjectFeatureGraphEtag(project.id, current)
    const before = await prisma.featureWorkLink.findMany({ where: { featureId: featureA.receipt.resourceId, deletedAt: null } })
    await expect(redistributeProjectFeatureWorkLinks(project.id, {
      allocationMode: 'COMPLETE_SPLIT', affectedWorkItemIds: [itemA.id], featureSets: [{
        featureId: featureA.receipt.resourceId, links: [{ workItemId: itemA.id, allocationBps: 9000 }],
      }],
    }, {
      viewer, ifMatch: etag, requestId: uid(), idempotencyKey: `graph-gap-${uid()}`,
    })).rejects.toMatchObject({ code: 'GRAPH_MEMBERSHIP_MISMATCH', status: 422 })
    await expect(redistributeProjectFeatureWorkLinks(project.id, {
      allocationMode: 'COMPLETE_SPLIT', affectedWorkItemIds: [itemA.id, itemB.id], featureSets: [{
        featureId: featureA.receipt.resourceId, links: [
          { workItemId: itemA.id, allocationBps: 9000 },
          { workItemId: itemB.id, allocationBps: 10000 },
        ],
      }],
    }, {
      viewer, ifMatch: etag, requestId: uid(), idempotencyKey: `graph-invalid-${uid()}`,
    })).rejects.toMatchObject({ code: 'INVALID_ALLOCATION', status: 422 })
    expect(await prisma.featureWorkLink.findMany({ where: { featureId: featureA.receipt.resourceId, deletedAt: null } })).toEqual(before)
  })
})

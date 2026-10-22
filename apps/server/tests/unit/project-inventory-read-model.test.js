// @req FR-077, FR-135 — Project Inventory has a versioned, read-only DTO including Asset allocations.
// @spec SDD-045, ADR-034 — section envelopes are bounded, deterministic, and never raw Prisma graphs.
// @tested tests/unit/project-inventory-read-model.test.js
import { describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'
import {
  INVENTORY_DEFAULT_LIMIT,
  INVENTORY_MAX_LIMIT,
  buildProjectInventoryReadModel,
  getProjectInventory,
  paginateCollection,
  parseProjectInventoryQuery,
  zProjectInventoryResponse,
} from '@/modules/project-manager/application/project-inventory-read-model'

const DATE = '2026-08-18T00:00:00.000Z'

function source() {
  return {
    project: {
      id: 'project-a',
      code: 'PRJ-A',
      name: 'Project A',
      description: 'Inventory fixture',
      type: 'GENERAL',
      status: 'ACTIVE',
      businessId: 'business-a',
      workspaceId: 'workspace-a',
      startAt: null,
      targetAt: DATE,
      business: { id: 'business-a', code: 'BUS-A', name: 'Business A' },
      workspace: { id: 'workspace-a', code: 'WS-A', name: 'Workspace A', scopeType: 'BUSINESS' },
    },
    workstreams: [{
      id: 'workstream-a',
      code: 'WST-A',
      projectId: 'project-a',
      name: 'Delivery',
      executionMode: 'SOFTWARE_SPRINT',
      progressStrategy: 'TASK_WEIGHT',
      progressWeight: 2,
      status: 'ACTIVE',
      progressCache: 17,
      viewConfigJson: '{}',
      createdAt: DATE,
      updatedAt: DATE,
      containers: [{
        id: 'container-a',
        code: 'WC-A',
        workstreamId: 'workstream-a',
        parentId: null,
        subtype: 'SPRINT',
        title: 'Sprint',
        status: 'ACTIVE',
        startAt: null,
        targetAt: DATE,
        createdAt: DATE,
        updatedAt: DATE,
        metadataJson: '{"internal":"do not expose"}',
      }],
      items: [{
        id: 'item-a',
        code: 'WI-A',
        workstreamId: 'workstream-a',
        containerId: 'container-a',
        subtype: 'TASK',
        title: 'Build',
        status: 'DONE',
        assigneeRef: 'person-a',
        weight: 1,
        numericValue: null,
        probability: null,
        metricDataJson: '{"secretMetric":123}',
        metadataJson: '{"internal":"do not expose"}',
        startAt: null,
        targetAt: DATE,
        createdAt: DATE,
        updatedAt: DATE,
        deletedAt: null,
      }],
      milestones: [],
      gates: [],
    }],
    milestones: [],
    gates: [],
    dependencyGraph: {
      version: '1.0',
      nodes: [
        { id: 'WORK_ITEM:item-a', type: 'WORK_ITEM', code: 'WI-A', title: 'Build', status: 'DONE' },
      ],
      edges: [],
    },
    files: [{
      source: 'FILE_ASSET',
      id: 'file-a',
      code: 'FIL-A',
      projectId: 'project-a',
      workItemId: 'item-a',
      name: 'plan.pdf',
      mime: 'application/pdf',
      size: 12,
      storageKind: 'LOCAL_FILE',
      relativePath: 'Project/plan.pdf',
      externalUrl: null,
      blobRef: null,
      sha256: 'abc',
      state: 'ACTIVE',
      createdAt: DATE,
      updatedAt: DATE,
    }],
    repositories: [{
      id: 'link-a',
      projectId: 'project-a',
      role: 'PRIMARY',
      pathScope: 'src',
      branch: 'main',
      repo: {
        id: 'repo-a',
        code: 'REP-A',
        provider: 'github',
        fullName: 'org/project-a',
        url: 'https://example.test/org/project-a',
        defaultBranch: 'main',
        status: 'ACTIVE',
      },
    }],
    assetAllocations: [{
      id: 'allocation-a',
      projectId: 'project-a',
      registeredAssetId: 'asset-a',
      workstreamId: 'workstream-a',
      quantity: 1,
      exclusive: true,
      status: 'ACTIVE',
      effectiveFrom: DATE,
      effectiveTo: null,
      tenantId: 'tenant-a',
      businessId: 'business-a',
      deletedAt: null,
      registeredAsset: {
        id: 'asset-a',
        assetCode: 'AST-2026-00001',
        name: 'Project laptop',
        categoryCode: 'IT_EQUIPMENT',
        businessId: 'business-a',
        tenantId: 'tenant-a',
        deletedAt: null,
        description: 'private detail omitted',
      },
      workstream: { id: 'workstream-a', projectId: 'project-a', deletedAt: null },
    }],
    team: [{
      id: 'membership-a',
      tenantId: 'tenant-a',
      businessId: 'business-a',
      role: 'MEMBER',
      person: { id: 'person-a', code: 'PER-A', displayName: 'Person A', email: 'hidden@example.test' },
      activeWorkItems: 1,
    }],
    progress: null,
    activity: [{
      id: 'audit-a',
      entityType: 'PROJECT',
      entityId: 'project-a',
      action: 'UPDATED',
      actorType: 'LOCAL_USER',
      occurredAt: DATE,
      payloadJson: '{"secret":"do not expose"}',
    }],
    activityTotal: 1,
    readScope: 'BUSINESS',
    page: 1,
    limit: 10,
  }
}

describe('Project Inventory read model', () => {
  it('parses query defaults, clamps the hard limit, and rejects invalid pages', () => {
    expect(parseProjectInventoryQuery({})).toEqual({ page: 1, limit: INVENTORY_DEFAULT_LIMIT })
    expect(parseProjectInventoryQuery({ page: '2', limit: '9999' })).toEqual({ page: 2, limit: INVENTORY_MAX_LIMIT })
    expect(() => parseProjectInventoryQuery({ page: '0' })).toThrow()
  })

  it('returns deterministic collection windows and marks truncation', () => {
    expect(paginateCollection([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { page: 2, limit: 1 })).toEqual({
      status: 'PARTIAL',
      items: [{ id: 'b' }],
      page: 2,
      limit: 1,
      truncated: true,
      nextPage: 3,
      reasonCode: null,
    })
    expect(paginateCollection([], { page: 1, limit: 1 }).status).toBe('EMPTY')
  })

  it('serializes a stable DTO without raw metadata, metrics, payload, or Prisma relations', () => {
    const result = buildProjectInventoryReadModel(source())
    expect(zProjectInventoryResponse.parse(result)).toEqual(result)
    expect(result.readModel).toBe('PROJECT_INVENTORY')
    expect(result.schemaVersion).toBe('1.1')
    expect(result.project.business).toEqual({ id: 'business-a', code: 'BUS-A', name: 'Business A' })
    expect(result.project.workspace.scopeType).toBe('BUSINESS')
    expect(result.sections.work.items.items[0]).not.toHaveProperty('metricDataJson')
    expect(result.sections.work.containers.items[0]).not.toHaveProperty('metadataJson')
    expect(result.sections.team.items[0]).not.toHaveProperty('email')
    expect(result.sections.activity.items[0]).not.toHaveProperty('payload')
    expect(result.sections.files.items[0]).not.toHaveProperty('content')
    expect(result.sections.assets.items[0]).toEqual({
      allocationId: 'allocation-a',
      registeredAssetId: 'asset-a',
      assetCode: 'AST-2026-00001',
      name: 'Project laptop',
      categoryCode: 'IT_EQUIPMENT',
      workstreamId: 'workstream-a',
      quantity: 1,
      exclusive: true,
      status: 'ACTIVE',
      effectiveFrom: DATE,
      effectiveTo: null,
    })
    expect(result.sections.assets.items[0]).not.toHaveProperty('registeredAsset')
    expect(result.sections.progress.rollup.percent).toBe(100)
    expect(result.summary.counts).toEqual(expect.objectContaining({ workstreams: 1, workItems: 1, files: 1, assets: 1, activity: 1 }))
  })

  it('reads the authorized Project asset projection through its Business-scoped Asset allocation query', async () => {
    const project = {
      id: 'project-a',
      code: 'PRJ-A',
      name: 'Project A',
      description: null,
      type: 'GENERAL',
      status: 'ACTIVE',
      businessId: 'business-a',
      workspaceId: 'workspace-a',
      startAt: null,
      targetAt: null,
      business: { id: 'business-a', code: 'BUS-A', name: 'Business A', tenantId: 'tenant-a' },
      workspace: { id: 'workspace-a', code: 'WS-A', name: 'Space A', scopeType: 'BUSINESS', businessId: 'business-a', tenantId: 'tenant-a' },
    }
    const allocation = {
      id: 'allocation-a',
      tenantId: 'tenant-a',
      businessId: 'business-a',
      projectId: 'project-a',
      registeredAssetId: 'asset-a',
      workstreamId: 'workstream-a',
      quantity: 1,
      exclusive: true,
      status: 'ACTIVE',
      effectiveFrom: new Date(DATE),
      effectiveTo: null,
      deletedAt: null,
      registeredAsset: {
        id: 'asset-a',
        assetCode: 'AST-2026-00001',
        name: 'Project laptop',
        categoryCode: 'IT_EQUIPMENT',
        businessId: 'business-a',
        tenantId: 'tenant-a',
        deletedAt: null,
      },
      workstream: { id: 'workstream-a', projectId: 'project-a', deletedAt: null },
    }
    const db = {
      project: { findUnique: vi.fn().mockResolvedValue(project) },
      workstream: { findMany: vi.fn().mockResolvedValue([]) },
      milestone: { findMany: vi.fn().mockResolvedValue([]) },
      gate: { findMany: vi.fn().mockResolvedValue([]) },
      projectFile: { findMany: vi.fn().mockResolvedValue([]) },
      fileAsset: { findMany: vi.fn().mockResolvedValue([]) },
      projectRepository: { findMany: vi.fn().mockResolvedValue([]) },
      membership: { findMany: vi.fn().mockResolvedValue([]) },
      assetProjectAllocation: { findMany: vi.fn().mockResolvedValue([allocation]) },
      dependency: { findMany: vi.fn().mockResolvedValue([]) },
      auditEvent: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    }

    const result = await getProjectInventory('project-a', {
      db,
      viewer: makeViewer({ visibleBusinessIds: ['business-a'] }),
    })

    expect(db.assetProjectAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: 'project-a',
        tenantId: 'tenant-a',
        businessId: 'business-a',
        deletedAt: null,
        OR: [
          { workstreamId: null },
          { workstream: { is: { projectId: 'project-a' } } },
        ],
      }),
    }))
    expect(db.assetProjectAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        workstream: { select: { id: true, projectId: true } },
      }),
    }))
    expect(result.sections.assets.items).toEqual([expect.objectContaining({
      allocationId: 'allocation-a',
      assetCode: 'AST-2026-00001',
      name: 'Project laptop',
    })])
  })

  it('omits a Workstream ID when a corrupt allocation points outside the authorized Project', () => {
    const input = source()
    input.assetAllocations = [{
      ...input.assetAllocations[0],
      workstreamId: 'workstream-business-b',
      workstream: { id: 'workstream-business-b', projectId: 'project-business-b', deletedAt: null },
    }]

    const result = buildProjectInventoryReadModel(input)
    expect(result.sections.assets.items[0].workstreamId).toBeNull()
    expect(result.sections.assets.items[0].workstreamId).not.toBe('workstream-business-b')
  })
})

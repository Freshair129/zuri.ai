import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: mocks.resolveRequestViewer }))

import prisma from '@/lib/db'
import { buildOpenApiDocument } from '@/modules/project-manager/api-docs/openapi'
import { GET } from '@/app/api/projects/[id]/domain-view/route'
import { zProjectDomainView } from '@/modules/project-manager/application/project-domain-read-model'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createContainer, createItem } from '@/modules/project-manager/application/work-service'
import { AUTH_SESSION_COOKIE } from '@/modules/identity/auth-service'

// @req FR-251 — the authorized Project Execution Domains route returns the
// exact DTO and redacted typed refusal contract without mutating Project state.
// @spec FR-070, SDD-039, ADR-025
// @tested tests/integration/project-domain-view.test.js

let projectA
let projectB
let deletedProject
let invalidHierarchyProject
let sharedTenantProject
let sharedPortfolioProject
let viewerA
let viewerB
const fixtureProjectIds = []
const fixtureWorkstreamIds = []
const fixtureContainerIds = []
const fixtureItemIds = []

const suffix = () => String(Date.now())

async function invoke(projectId, viewer = viewerA) {
  mocks.resolveRequestViewer.mockResolvedValue(viewer)
  const response = await GET(
    new Request(`http://local/api/projects/${projectId}/domain-view`),
    { params: { id: projectId } },
  )
  return { response, body: await response.json() }
}

describe('FR-251 Project Execution Domains', () => {
  beforeAll(async () => {
    const id = suffix()
    const portfolio = await createPortfolio({ name: `Domain View Group ${id}`, code: `PF-DOMVIEW-${id}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `Domain View Tenant A ${id}`, code: `TNT-DOMVIEW-A-${id}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `Domain View Tenant B ${id}`, code: `TNT-DOMVIEW-B-${id}` })
    const businessA = await createBusiness({ tenantId: tenantA.id, name: `Domain View Business A ${id}`, code: `BUS-DOMVIEW-A-${id}` })
    const businessB = await createBusiness({ tenantId: tenantB.id, name: `Domain View Business B ${id}`, code: `BUS-DOMVIEW-B-${id}` })
    const workspaceA = await createWorkspace({
      name: `Domain View Space A ${id}`,
      scopeType: 'BUSINESS',
      businessId: businessA.id,
      code: `WS-DOMVIEW-A-${id}`,
    })
    const workspaceB = await createWorkspace({
      name: `Domain View Space B ${id}`,
      scopeType: 'BUSINESS',
      businessId: businessB.id,
      code: `WS-DOMVIEW-B-${id}`,
    })
    const tenantWorkspace = await createWorkspace({
      name: `Domain View Tenant Space ${id}`,
      scopeType: 'TENANT',
      tenantId: tenantA.id,
      code: `WS-DOMVIEW-TENANT-${id}`,
    })
    // The existing roadmap policy requires a denormalized tenant id even for
    // a portfolio-scoped shared Workspace; this models the persisted shape
    // accepted by that policy without introducing a second authorizer.
    const portfolioWorkspace = await createWorkspace({
      name: `Domain View Portfolio Space ${id}`,
      scopeType: 'PORTFOLIO',
      portfolioId: portfolio.id,
      tenantId: tenantA.id,
      code: `WS-DOMVIEW-PORTFOLIO-${id}`,
    })

    viewerA = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id] })
    viewerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id] })

    projectA = await createProject({
      workspaceId: workspaceA.id,
      name: 'Domain View Project A',
      code: `PRJ-DOMVIEW-A-${id}`,
    }, { viewer: viewerA })
    fixtureProjectIds.push(projectA.id)
    projectB = await createProject({
      workspaceId: workspaceB.id,
      name: 'Domain View Project B',
      code: `PRJ-DOMVIEW-B-${id}`,
    }, { viewer: viewerB })
    fixtureProjectIds.push(projectB.id)

    const streamA = await createWorkstream({
      projectId: projectA.id,
      name: 'Commerce stream',
      code: `WST-DOMVIEW-A-${id}`,
      executionMode: 'B2B_SALES',
    }, { viewer: viewerA })
    fixtureWorkstreamIds.push(streamA.id)
    const streamB = await createWorkstream({
      projectId: projectA.id,
      name: 'Unbound stream',
      code: `WST-DOMVIEW-B-${id}`,
      executionMode: 'SOFTWARE_SPRINT',
    }, { viewer: viewerA })
    fixtureWorkstreamIds.push(streamB.id)
    const containerA = await createContainer({
      workstreamId: streamA.id,
      title: 'Commerce container',
      code: `WC-DOMVIEW-A-${id}`,
      subtype: 'SALES_PIPELINE',
      status: 'ACTIVE',
    }, { viewer: viewerA })
    fixtureContainerIds.push(containerA.id)
    const containerB = await createContainer({
      workstreamId: streamB.id,
      title: 'Unbound container',
      code: `WC-DOMVIEW-B-${id}`,
      subtype: 'SPRINT',
      status: 'ACTIVE',
    }, { viewer: viewerA })
    fixtureContainerIds.push(containerB.id)
    const validItem = await createItem({
      workstreamId: streamA.id,
      containerId: containerA.id,
      title: 'Valid commerce work',
      code: `WI-DOMVIEW-A-${id}`,
      subtype: 'DEAL',
      status: 'DONE',
    }, { viewer: viewerA })
    fixtureItemIds.push(validItem.id)
    const unboundItem = await createItem({
      workstreamId: streamB.id,
      title: 'Valid unbound work',
      code: `WI-DOMVIEW-B-${id}`,
      subtype: 'TASK',
      status: 'PLANNED',
    }, { viewer: viewerA })
    fixtureItemIds.push(unboundItem.id)
    const invalidContainerItem = await createItem({
      workstreamId: streamA.id,
      title: 'Mismatched container work',
      code: `WI-DOMVIEW-MISMATCH-${id}`,
      subtype: 'TASK',
      status: 'PLANNED',
    }, { viewer: viewerA })
    fixtureItemIds.push(invalidContainerItem.id)
    await prisma.workItem.update({ where: { id: invalidContainerItem.id }, data: { containerId: containerB.id } })
    const deletedItem = await createItem({
      workstreamId: streamA.id,
      title: 'Deleted work',
      code: `WI-DOMVIEW-DELETED-${id}`,
      subtype: 'TASK',
      status: 'PLANNED',
    }, { viewer: viewerA })
    fixtureItemIds.push(deletedItem.id)
    await prisma.workItem.update({ where: { id: deletedItem.id }, data: { deletedAt: new Date(), status: 'CANCELLED' } })

    await prisma.workstream.update({
      where: { id: streamA.id },
      data: {
        primaryDomainId: 'DOM-COMMERCE',
        supportingDomainIdsJson: JSON.stringify(['DOM-CRM', 'DOM-COMMERCE', 'DOM-CRM']),
        technicalOwnerDomainId: 'TD-PROJECT-MANAGER',
        progressCache: 17,
      },
    })
    await prisma.workstream.update({ where: { id: streamB.id }, data: { progressCache: 29 } })
    // Keep the valid item id referenced in this fixture so the source remains
    // intentional if the database provider changes ordering.
    expect(validItem.id).toBeTruthy()

    deletedProject = await createProject({
      workspaceId: workspaceA.id,
      name: 'Deleted Domain View Project',
      code: `PRJ-DOMVIEW-DELETED-${id}`,
    }, { viewer: viewerA })
    fixtureProjectIds.push(deletedProject.id)
    await prisma.project.update({ where: { id: deletedProject.id }, data: { status: 'ARCHIVED', deletedAt: new Date() } })

    invalidHierarchyProject = await prisma.project.create({
      data: {
        workspaceId: workspaceB.id,
        businessId: businessA.id,
        name: 'Invalid hierarchy Domain View Project',
        code: `PRJ-DOMVIEW-HIERARCHY-${id}`,
      },
    })
    fixtureProjectIds.push(invalidHierarchyProject.id)
    sharedTenantProject = await prisma.project.create({
      data: {
        workspaceId: tenantWorkspace.id,
        name: 'Shared tenant Domain View Project',
        code: `PRJ-DOMVIEW-SHARED-TENANT-${id}`,
      },
    })
    fixtureProjectIds.push(sharedTenantProject.id)
    sharedPortfolioProject = await prisma.project.create({
      data: {
        workspaceId: portfolioWorkspace.id,
        name: 'Shared portfolio Domain View Project',
        code: `PRJ-DOMVIEW-SHARED-PORTFOLIO-${id}`,
      },
    })
    fixtureProjectIds.push(sharedPortfolioProject.id)
  }, 30000)

  afterAll(async () => {
    // This suite intentionally creates malformed hierarchy and container rows
    // to prove redacted refusal and count exclusion. Remove the whole PM
    // fixture by recorded IDs so later suites cannot observe those rows in
    // broad integrity/backup scans. Scope fixtures are left intact because
    // they are ordinary shared ancestors and have no malformed state.
    if (fixtureItemIds.length > 0) {
      await prisma.workItem.deleteMany({ where: { id: { in: fixtureItemIds } } })
    }
    if (fixtureContainerIds.length > 0) {
      await prisma.workContainer.deleteMany({ where: { id: { in: fixtureContainerIds } } })
    }
    if (fixtureWorkstreamIds.length > 0) {
      await prisma.workstream.deleteMany({ where: { id: { in: fixtureWorkstreamIds } } })
    }
    if (fixtureProjectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } })
      await prisma.auditEvent.deleteMany({
        where: {
          OR: [
            { entityType: 'PROJECT', entityId: { in: fixtureProjectIds } },
            { entityType: 'WORKSTREAM', entityId: { in: fixtureWorkstreamIds } },
            { entityType: 'WORK_CONTAINER', entityId: { in: fixtureContainerIds } },
            { entityType: 'WORK_ITEM', entityId: { in: fixtureItemIds } },
          ],
        },
      })
    }
  })

  it('returns the exact DTO, counts active work once, and leaves audit/progress state unchanged', async () => {
    const beforeStreams = await prisma.workstream.findMany({
      where: { projectId: projectA.id },
      select: { id: true, progressCache: true },
      orderBy: { id: 'asc' },
    })
    const beforeAuditCount = await prisma.auditEvent.count()
    const { response, body } = await invoke(projectA.id)

    expect(response.status).toBe(200)
    expect(zProjectDomainView.parse(body)).toEqual(body)
    expect(body.projectId).toBe(projectA.id)
    expect(body.snapshotId).toBeNull()
    expect(body.snapshotState).toBe('UNAVAILABLE')
    expect(body.totalUniqueWorkCount).toBe(2)
    expect(body.unboundWorkstreamCount).toBe(1)
    expect(body.domains).toHaveLength(2)
    expect(body.domains.map(({ domainId }) => domainId)).toEqual(['DOM-COMMERCE', 'DOM-CRM'])
    expect(body.domains[0]).toMatchObject({
      domainId: 'DOM-COMMERCE',
      label: 'Order Management',
      mappingState: 'MAPPED',
      ownership: { primaryWorkstreamCount: 1, supportingWorkstreamCount: 0, technicalOwnerIds: ['TD-PROJECT-MANAGER'] },
      work: { uniqueWorkCount: 1, workstreamCount: 1 },
      featureIds: [],
      featureState: 'NOT_BOUND',
      blockerState: 'UNAVAILABLE',
      blockerCount: null,
      contractState: 'UNAVAILABLE',
      gapState: 'UNAVAILABLE',
      evidence: [],
    })
    expect(body.domains[1]).toMatchObject({
      domainId: 'DOM-CRM',
      label: 'Customer',
      ownership: { primaryWorkstreamCount: 0, supportingWorkstreamCount: 1, technicalOwnerIds: ['TD-PROJECT-MANAGER'] },
      work: { uniqueWorkCount: 1, workstreamCount: 1 },
    })

    const afterStreams = await prisma.workstream.findMany({
      where: { projectId: projectA.id },
      select: { id: true, progressCache: true },
      orderBy: { id: 'asc' },
    })
    const afterAuditCount = await prisma.auditEvent.count()
    expect(afterStreams).toEqual(beforeStreams)
    expect(afterAuditCount).toBe(beforeAuditCount)
  })

  it('allows authorized TENANT and PORTFOLIO shared Projects while returning no-binding rows as empty', async () => {
    for (const project of [sharedTenantProject, sharedPortfolioProject]) {
      const { response, body } = await invoke(project.id)
      expect(response.status).toBe(200)
      expect(body.projectId).toBe(project.id)
      expect(body.domains).toEqual([])
      expect(body.totalUniqueWorkCount).toBe(0)
      expect(body.unboundWorkstreamCount).toBe(0)
    }
  })

  it('returns 401 with a fresh correlated typed error for an unauthenticated request', async () => {
    mocks.resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const response = await GET(
      new Request('http://local/api/projects/11111111-1111-4111-8111-111111111111/domain-view'),
      { params: { id: '11111111-1111-4111-8111-111111111111' } },
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({
      code: 'AUTH_REQUIRED',
      message: 'Authentication is required.',
      requestId: expect.any(String),
      retryable: false,
    })
    expect(body.requestId).toBe(response.headers.get('X-Request-ID'))
    expect(body).not.toHaveProperty('projectId')
  })

  it('redacts session failures without exposing the underlying message', async () => {
    mocks.resolveRequestViewer.mockRejectedValue(Object.assign(new Error('session database secret'), { status: 503 }))
    const response = await GET(
      new Request(`http://local/api/projects/${projectA.id}/domain-view`),
      { params: { id: projectA.id } },
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.', retryable: true })
    expect(body.message).not.toContain('session database secret')
    expect(body.requestId).toBe(response.headers.get('X-Request-ID'))
  })

  it('uses one redacted 404 body for missing, foreign, deleted and invalid-hierarchy targets', async () => {
    const targets = [
      '00000000-0000-4000-8000-000000000000',
      projectB.id,
      deletedProject.id,
      invalidHierarchyProject.id,
      'not-a-uuid',
    ]
    const refusals = []
    for (const target of targets) refusals.push(await invoke(target))

    for (const { response, body } of refusals) {
      expect(response.status).toBe(404)
      expect(body).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: 'Resource not found.', retryable: false })
      expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId', 'retryable'])
      expect(body.requestId).toBe(response.headers.get('X-Request-ID'))
      expect(body).not.toHaveProperty('projectId')
    }
    const stableFields = refusals.map(({ body }) => ({ code: body.code, message: body.message, retryable: body.retryable }))
    expect(stableFields.every((value) => JSON.stringify(value) === JSON.stringify(stableFields[0]))).toBe(true)
    expect(new Set(refusals.map(({ body }) => body.requestId)).size).toBe(refusals.length)
  })

  it('publishes the DomainView DTO, null-only unavailable fields and typed refusal path in runtime OpenAPI', () => {
    const document = buildOpenApiDocument({ serverUrl: 'http://localhost:3100' })
    const operation = document.paths['/api/projects/{id}/domain-view']?.get
    expect(operation).toBeTruthy()
    expect(operation.operationId).toBe('getProjectDomainView')
    expect(operation.security).toEqual([{ SessionAuth: [] }])
    expect(document.components.securitySchemes.SessionAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: AUTH_SESSION_COOKIE,
    })
    expect(operation.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/DomainView' })
    expect(operation.responses['401'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/DomainViewError' })
    expect(operation.responses['404'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/DomainViewError' })
    for (const status of ['401', '404']) {
      expect(operation.responses[status].headers['X-Request-ID'].schema).toMatchObject({ type: 'string', format: 'uuid' })
    }

    const view = document.components.schemas.DomainView
    expect(view.required).toEqual(expect.arrayContaining([
      'schemaVersion', 'projectId', 'snapshotId', 'snapshotState', 'observedAt',
      'totalUniqueWorkCount', 'unboundWorkstreamCount', 'domains',
    ]))
    expect(view.properties.schemaVersion.enum).toEqual(['1.0'])
    expect(view.properties.snapshotId).toMatchObject({ nullable: true })
    expect(view.properties.snapshotId.enum).toEqual([null])
    expect(view.properties.snapshotState.enum).toEqual(['UNAVAILABLE'])

    const row = document.components.schemas.DomainRow
    expect(row.required).toEqual(expect.arrayContaining([
      'domainId', 'label', 'mappingState', 'ownership', 'work', 'featureIds',
      'featureState', 'blockerState', 'blockerCount', 'contractState', 'gapState', 'evidence',
    ]))
    expect(row.properties.mappingState.enum).toEqual(['MAPPED', 'UNMAPPED'])
    expect(row.properties.featureIds.maxItems).toBe(0)
    expect(row.properties.evidence.maxItems).toBe(0)
    expect(row.properties.featureState.enum).toEqual(['NOT_BOUND'])
    expect(row.properties.blockerState.enum).toEqual(['UNAVAILABLE'])
    expect(row.properties.blockerCount).toMatchObject({ nullable: true })
    expect(row.properties.blockerCount.enum).toEqual([null])
    expect(row.properties.contractState.enum).toEqual(['UNAVAILABLE'])
    expect(row.properties.gapState.enum).toEqual(['UNAVAILABLE'])

    const error = document.components.schemas.DomainViewError
    expect(error.required).toEqual(['code', 'message', 'requestId', 'retryable'])
    expect(error.additionalProperties).toBe(false)
  })
})

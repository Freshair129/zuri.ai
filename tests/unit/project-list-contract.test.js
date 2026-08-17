// @req FR-003, FR-043 — the Project list has a stable DTO and preserves the
// direct Business owner plus secondary Space context.
// @spec ADR-014, BR-001, BR-004, SDD-021, SEC-001, SEC-008
// @tested tests/unit/project-list-contract.test.js

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const { listProjects, listProjectsForOverview, listProjectsForTimeline, listProjectsForWorkspace } = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectsForOverview: vi.fn(),
  listProjectsForTimeline: vi.fn(),
  listProjectsForWorkspace: vi.fn(),
}))

vi.mock('@/modules/project-manager/application/project-service', () => ({
  listProjects,
  listProjectsForOverview,
  listProjectsForTimeline,
  listProjectsForWorkspace,
}))

const {
  PROJECT_LIST_LIMIT,
  parseProjectListQuery,
  serializeProjectListItem,
  zProjectListItem,
  zProjectListResponse,
} = await import('@/modules/project-manager/application/project-list-read-model')
const { GET } = await import('@/app/api/projects/route')
const projectsPage = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/page.jsx'), 'utf8')
const overviewPage = readFileSync(resolve(process.cwd(), 'src/app/(pm)/overview/page.jsx'), 'utf8')
const timelineView = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/views/universal/TimelineView.jsx'), 'utf8')
const workspacePage = readFileSync(resolve(process.cwd(), 'src/app/(pm)/workspaces/[workspaceId]/page.jsx'), 'utf8')

describe('Project list read contract', () => {
  it('serializes only stable list fields and normalizes dates/counts', () => {
    const item = serializeProjectListItem({
      id: 'project-a',
      code: 'PRJ-A',
      name: 'Alpha',
      description: null,
      type: 'GENERAL',
      status: 'PLANNED',
      businessId: 'business-a',
      workspaceId: 'space-a',
      startAt: new Date('2026-08-01T00:00:00.000Z'),
      targetAt: null,
      workspace: { code: 'SPACE-A', name: 'Space A', scopeType: 'BUSINESS' },
      workstreams: [{ id: 'workstream-a' }],
      milestones: [{ id: 'milestone-secret' }],
      gates: [{ id: 'gate-secret' }],
      deletedAt: null,
      version: 4,
    })

    expect(item).toEqual({
      id: 'project-a',
      code: 'PRJ-A',
      name: 'Alpha',
      description: null,
      type: 'GENERAL',
      status: 'PLANNED',
      businessId: 'business-a',
      workspaceId: 'space-a',
      workspace: { code: 'SPACE-A', name: 'Space A', scopeType: 'BUSINESS' },
      startAt: '2026-08-01T00:00:00.000Z',
      targetAt: null,
      workstreamCount: 1,
    })
    expect(zProjectListItem.parse(item)).toEqual(item)
    expect(Object.keys(item)).not.toContain('milestones')
    expect(Object.keys(item)).not.toContain('gates')
    expect(Object.keys(item)).not.toContain('deletedAt')
    expect(Object.keys(item)).not.toContain('version')
  })

  it('normalizes filters and clamps the requested window to the hard cap', () => {
    expect(parseProjectListQuery({
      workspaceId: ' space-a ',
      businessId: 'business-a',
      tenantId: 'tenant-a',
      status: 'ACTIVE',
      q: '  alpha  ',
      limit: '9999',
    })).toEqual({
      workspaceId: 'space-a',
      businessId: 'business-a',
      tenantId: 'tenant-a',
      status: 'ACTIVE',
      q: 'alpha',
      limit: PROJECT_LIST_LIMIT,
      view: 'list',
    })
  })

  it('rejects an invalid project status before querying the service', async () => {
    const response = await GET(new Request('http://localhost/api/projects?status=NOT_A_STATUS'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Validation failed' })
    expect(listProjects).not.toHaveBeenCalled()
  })

  it('passes the normalized query and returns the stable response envelope', async () => {
    const result = { items: [], limit: PROJECT_LIST_LIMIT, truncated: false }
    listProjects.mockResolvedValueOnce(result)

    const response = await GET(new Request(
      'http://localhost/api/projects?workspaceId=space-a&businessId=business-a&tenantId=tenant-a&status=ACTIVE&q=%20alpha%20&limit=9999'
    ))

    expect(listProjects).toHaveBeenCalledWith({
      workspaceId: 'space-a',
      businessId: 'business-a',
      tenantId: 'tenant-a',
      status: 'ACTIVE',
      q: 'alpha',
      limit: PROJECT_LIST_LIMIT,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(result)
    expect(zProjectListResponse.parse(result)).toEqual(result)
  })

  it('keeps the relation-rich Business Overview consumer behind an explicit compatibility view', async () => {
    const legacy = [{ id: 'project-a', workstreams: [], milestones: [], gates: [] }]
    listProjectsForOverview.mockResolvedValueOnce(legacy)

    const response = await GET(new Request('http://localhost/api/projects?businessId=business-a&view=overview'))

    expect(listProjectsForOverview).toHaveBeenCalledWith({
      businessId: 'business-a',
      limit: PROJECT_LIST_LIMIT,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(legacy)
  })

  it('keeps other relation-rich Project consumers behind named compatibility views', async () => {
    const legacy = [{ id: 'project-a', workstreams: [], milestones: [], gates: [] }]
    listProjectsForTimeline.mockResolvedValueOnce(legacy)
    listProjectsForWorkspace.mockResolvedValueOnce(legacy)

    const timelineResponse = await GET(new Request('http://localhost/api/projects?view=timeline'))
    const workspaceResponse = await GET(new Request('http://localhost/api/projects?workspaceId=space-a&view=workspace'))

    expect(listProjectsForTimeline).toHaveBeenCalledWith({ limit: PROJECT_LIST_LIMIT })
    expect(listProjectsForWorkspace).toHaveBeenCalledWith({ workspaceId: 'space-a', limit: PROJECT_LIST_LIMIT })
    await expect(timelineResponse.json()).resolves.toEqual(legacy)
    await expect(workspaceResponse.json()).resolves.toEqual(legacy)
  })

  it('renders the envelope states instead of treating the response as a bare array', () => {
    expect(projectsPage).toContain('const rows = data?.items || []')
    expect(projectsPage).toContain('<TruncationNotice')
    expect(projectsPage).toContain('data?.truncated')
    expect(projectsPage).not.toContain('rows={data || []}')
    expect(overviewPage).toContain("params.set('view', 'overview')")
    expect(timelineView).toContain("'/api/projects?view=timeline'")
    expect(workspacePage).toContain('view=workspace')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildProjectDomainView,
  getProjectDomainView,
  zProjectDomainView,
} from '@/modules/project-manager/application/project-domain-read-model'
import {
  PROJECT_DOMAIN_CATALOG,
  resolveProjectDomain,
} from '@/modules/project-manager/project-domain-catalog'
import { makeViewer } from '../factories/viewer'

// @req FR-251 — the Domain view preserves FR-070 bindings, deduplicates the
// neutral work graph and refuses before aggregate reads.
// @spec FR-070, SDD-039, ADR-025
// @tested tests/unit/project-domain-read-model.test.js

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const DATE = '2026-09-16T00:00:00.000Z'

function workItem(id, workstreamId, over = {}) {
  return {
    id,
    workstreamId,
    containerId: null,
    deletedAt: null,
    ...over,
  }
}

function workstream(id, over = {}) {
  return {
    id,
    projectId: PROJECT_ID,
    status: 'ACTIVE',
    deletedAt: null,
    primaryDomainId: null,
    supportingDomainIdsJson: '[]',
    technicalOwnerDomainId: null,
    items: [],
    ...over,
  }
}

describe('Project Execution Domains read model', () => {
  it('keeps the seven immutable catalog bindings and current runtime labels', () => {
    expect(PROJECT_DOMAIN_CATALOG).toEqual([
      { domainId: 'DOM-DEVELOPMENT', routeKey: 'projects' },
      { domainId: 'DOM-COMMERCE', routeKey: 'commerce' },
      { domainId: 'DOM-CRM', routeKey: 'customer' },
      { domainId: 'DOM-MARKETING', routeKey: 'growth' },
      { domainId: 'DOM-OPERATIONS', routeKey: 'operations' },
      { domainId: 'DOM-PEOPLE', routeKey: 'people' },
      { domainId: 'DOM-PLATFORM', routeKey: 'platform' },
    ])
    expect(PROJECT_DOMAIN_CATALOG.map(({ domainId }) => resolveProjectDomain(domainId))).toEqual([
      { domainId: 'DOM-DEVELOPMENT', label: 'Projects & Work', mappingState: 'MAPPED', routeKey: 'projects' },
      { domainId: 'DOM-COMMERCE', label: 'Order Management', mappingState: 'MAPPED', routeKey: 'commerce' },
      { domainId: 'DOM-CRM', label: 'Customer', mappingState: 'MAPPED', routeKey: 'customer' },
      { domainId: 'DOM-MARKETING', label: 'Marketing', mappingState: 'MAPPED', routeKey: 'growth' },
      { domainId: 'DOM-OPERATIONS', label: 'Operations', mappingState: 'MAPPED', routeKey: 'operations' },
      { domainId: 'DOM-PEOPLE', label: 'HR / People', mappingState: 'MAPPED', routeKey: 'people' },
      { domainId: 'DOM-PLATFORM', label: 'Platform', mappingState: 'MAPPED', routeKey: 'platform' },
    ])
    expect(resolveProjectDomain('DOM-IMPORTED-UNKNOWN')).toEqual({
      domainId: 'DOM-IMPORTED-UNKNOWN',
      label: 'Unknown domain',
      mappingState: 'UNMAPPED',
      routeKey: null,
    })
  })

  it('deduplicates primary/supporting memberships and work ids while retaining unbound and unmapped states', () => {
    const streamA = workstream('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      primaryDomainId: 'DOM-COMMERCE',
      supportingDomainIdsJson: JSON.stringify(['DOM-CRM', 'DOM-COMMERCE', 'DOM-CRM']),
      technicalOwnerDomainId: 'TD-PROJECT-MANAGER',
    })
    const streamB = workstream('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      items: [workItem('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')],
    })
    const streamC = workstream('cccccccc-cccc-4ccc-8ccc-cccccccccccc', {
      primaryDomainId: 'DOM-IMPORTED-UNKNOWN',
      supportingDomainIdsJson: JSON.stringify(['DOM-PLATFORM']),
      items: [workItem('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')],
    })
    streamA.items = [
      workItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', streamA.id, {
        containerId: 'container-a',
        container: { workstreamId: streamA.id },
      }),
      // A repeated row in the source cannot inflate a domain or Project total.
      workItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', streamA.id),
      // The relation is present but belongs to another Workstream: exclude it.
      workItem('dddddddd-dddd-4ddd-8ddd-dddddddddddd', streamA.id, {
        containerId: 'container-b',
        container: { workstreamId: streamB.id },
      }),
      workItem('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', streamA.id, { deletedAt: DATE }),
    ]

    const result = buildProjectDomainView({
      project: { id: PROJECT_ID },
      workstreams: [
        streamC,
        streamB,
        streamA,
        workstream('ffffffff-ffff-4fff-8fff-ffffffffffff', { status: 'ARCHIVED', items: [workItem('ffffffff-ffff-4fff-8fff-ffffffffffff', 'ffffffff-ffff-4fff-8fff-ffffffffffff')] }),
        workstream('99999999-9999-4999-8999-999999999999', { deletedAt: DATE, items: [workItem('99999999-9999-4999-8999-999999999999', '99999999-9999-4999-8999-999999999999')] }),
      ],
      now: DATE,
    })

    expect(zProjectDomainView.parse(result)).toEqual(result)
    expect(result.observedAt).toBe(DATE)
    expect(result.totalUniqueWorkCount).toBe(3)
    expect(result.unboundWorkstreamCount).toBe(1)
    expect(result.domains.map(({ domainId }) => domainId)).toEqual([
      'DOM-COMMERCE',
      'DOM-CRM',
      'DOM-IMPORTED-UNKNOWN',
      'DOM-PLATFORM',
    ])

    expect(result.domains.find(({ domainId }) => domainId === 'DOM-COMMERCE')).toMatchObject({
      mappingState: 'MAPPED',
      ownership: { primaryWorkstreamCount: 1, supportingWorkstreamCount: 0, technicalOwnerIds: ['TD-PROJECT-MANAGER'] },
      work: { uniqueWorkCount: 1, workstreamCount: 1 },
    })
    expect(result.domains.find(({ domainId }) => domainId === 'DOM-CRM')).toMatchObject({
      ownership: { primaryWorkstreamCount: 0, supportingWorkstreamCount: 1, technicalOwnerIds: ['TD-PROJECT-MANAGER'] },
      work: { uniqueWorkCount: 1, workstreamCount: 1 },
    })
    expect(result.domains.find(({ domainId }) => domainId === 'DOM-IMPORTED-UNKNOWN')).toMatchObject({
      label: 'Unknown domain',
      mappingState: 'UNMAPPED',
      work: { uniqueWorkCount: 1, workstreamCount: 1 },
    })
    for (const row of result.domains) {
      expect(row.featureIds).toEqual([])
      expect(row.featureState).toBe('NOT_BOUND')
      expect(row.blockerCount).toBeNull()
      expect(row.blockerState).toBe('UNAVAILABLE')
      expect(row.contractState).toBe('UNAVAILABLE')
      expect(row.gapState).toBe('UNAVAILABLE')
      expect(row.evidence).toEqual([])
    }
  })

  it('returns an empty domain array for a valid no-binding Project and handles malformed supporting JSON safely', () => {
    const result = buildProjectDomainView({
      project: { id: PROJECT_ID },
      workstreams: [workstream('11111111-1111-4111-8111-111111111112', { supportingDomainIdsJson: '{malformed' })],
      now: DATE,
    })

    expect(result.domains).toEqual([])
    expect(result.totalUniqueWorkCount).toBe(0)
    expect(result.unboundWorkstreamCount).toBe(1)
  })

  it('authorizes before the Workstream aggregate is read', async () => {
    const calls = []
    const db = {
      project: {
        findUnique: async () => {
          calls.push('project')
          return {
            id: PROJECT_ID,
            deletedAt: null,
            businessId: 'business-target',
            business: { id: 'business-target', tenantId: 'tenant-target' },
            workspace: { id: 'workspace-target', scopeType: 'BUSINESS', businessId: 'business-target', tenantId: 'tenant-target', portfolioId: null },
          }
        },
      },
      workstream: {
        findMany: async () => {
          calls.push('workstream')
          return []
        },
      },
    }
    const viewer = makeViewer({ visibleBusinessIds: ['business-other'], ownedBusinessIds: ['business-other'] })

    await expect(getProjectDomainView(PROJECT_ID, { db, viewer, now: DATE })).rejects.toMatchObject({ status: 404, message: 'Project not found' })
    expect(calls).toEqual(['project'])
  })
})

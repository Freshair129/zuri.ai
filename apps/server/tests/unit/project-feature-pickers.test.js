import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DomainPicker,
  WorkItemPicker,
  isActiveProjectWorkItem,
  isProjectWorkItemId,
  normalizeProjectDomainOptions,
  normalizeProjectWorkItems,
  projectWorkItemsPath,
  visibleProjectWorkItems,
} from '@/modules/project-manager/components/ProjectFeaturePickers'

// @req FR-252 — relationship pickers retain canonical Domain identities and
// reject WorkItems that do not belong to the selected Project.
// @spec ADR-097, SDD-097 — Plan 24 §7.3 relationship editor contract.
// @tested apps/server/src/modules/project-manager/components/ProjectFeaturePickers.jsx

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const WORK_ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECOND_WORK_ITEM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const V7_WORK_ITEM_ID = '77777777-7777-7777-8777-777777777777'

function workItem(id, overrides = {}) {
  return {
    id,
    code: 'WI-001',
    title: 'Prepare launch brief',
    deletedAt: null,
    workstream: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      projectId: PROJECT_ID,
      status: 'ACTIVE',
      deletedAt: null,
      project: { id: PROJECT_ID },
    },
    ...overrides,
  }
}

describe('Project Feature relationship pickers', () => {
  it('offers only mapped canonical Domain IDs and keeps excluded values out of new choices', () => {
    const result = normalizeProjectDomainOptions({
      value: 'DOM-CRM',
      excludeDomainIds: ['DOM-CRM', 'DOM-PLATFORM'],
    })

    expect(result.options.map((row) => row.domainId)).not.toContain('DOM-CRM')
    expect(result.options.map((row) => row.domainId)).not.toContain('DOM-PLATFORM')
    expect(result.options.every((row) => row.mappingState === 'MAPPED')).toBe(true)
    expect(result.current).toEqual(expect.objectContaining({
      domainId: 'DOM-CRM',
      mappingState: 'MAPPED',
      disabled: true,
    }))
  })

  it('retains an imported unknown Domain as read-only UNMAPPED state', () => {
    const result = normalizeProjectDomainOptions({ value: 'DOM-IMPORTED-UNKNOWN' })

    expect(result.current).toEqual(expect.objectContaining({
      domainId: 'DOM-IMPORTED-UNKNOWN',
      label: 'Unknown domain',
      mappingState: 'UNMAPPED',
      disabled: true,
    }))
    expect(result.options.map((row) => row.domainId)).not.toContain('DOM-IMPORTED-UNKNOWN')
  })

  it('normalizes only active, valid, same-Project WorkItems and deduplicates IDs', () => {
    const valid = workItem(WORK_ITEM_ID)
    const rows = normalizeProjectWorkItems([
      valid,
      workItem(V7_WORK_ITEM_ID, { code: 'WI-007' }),
      workItem(WORK_ITEM_ID, { title: 'Duplicate must not replace the first row' }),
      workItem(SECOND_WORK_ITEM_ID, {
        workstream: { ...valid.workstream, projectId: OTHER_PROJECT_ID, project: { id: OTHER_PROJECT_ID } },
      }),
      workItem('not-a-uuid'),
      workItem('dddddddd-dddd-4ddd-8ddd-dddddddddddd', { deletedAt: '2026-09-17T00:00:00.000Z' }),
      workItem('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', {
        workstream: { ...valid.workstream, deletedAt: '2026-09-17T00:00:00.000Z' },
      }),
      workItem('ffffffff-ffff-4fff-8fff-ffffffffffff', {
        workstream: { ...valid.workstream, status: 'ARCHIVED' },
      }),
      workItem('99999999-9999-4999-8999-999999999999', {
        workstream: { ...valid.workstream, project: { id: OTHER_PROJECT_ID } },
      }),
    ], PROJECT_ID)

    expect(rows.map((row) => row.id)).toEqual([WORK_ITEM_ID, V7_WORK_ITEM_ID])
    expect(isActiveProjectWorkItem(valid, PROJECT_ID)).toBe(true)
    expect(isActiveProjectWorkItem(valid, OTHER_PROJECT_ID)).toBe(false)
    expect(isProjectWorkItemId(V7_WORK_ITEM_ID)).toBe(true)
  })

  it('constructs only the existing scoped Work GET path', () => {
    expect(projectWorkItemsPath(PROJECT_ID, 'launch brief')).toBe(
      `/api/work?projectId=${PROJECT_ID}&q=launch%20brief`
    )
    expect(projectWorkItemsPath(PROJECT_ID)).toBe(`/api/work?projectId=${PROJECT_ID}`)
    expect(projectWorkItemsPath('', 'launch')).toBe('/api/work?q=launch')
  })

  it('masks rows from the previous Project until the new context is applied', () => {
    const valid = workItem(WORK_ITEM_ID)
    const validOther = workItem(SECOND_WORK_ITEM_ID, {
      workstream: { ...valid.workstream, projectId: OTHER_PROJECT_ID, project: { id: OTHER_PROJECT_ID } },
    })

    expect(visibleProjectWorkItems([valid], PROJECT_ID, OTHER_PROJECT_ID)).toEqual([])
    expect(visibleProjectWorkItems([validOther], OTHER_PROJECT_ID, OTHER_PROJECT_ID)).toEqual([validOther])
  })

  it('renders canonical Domain and explicit WorkItem search controls with safe helper text', () => {
    const domainHtml = renderToStaticMarkup(createElement(DomainPicker, {
      value: 'DOM-IMPORTED-UNKNOWN',
      onChange: () => {},
      label: 'Primary domain',
      id: 'primary-domain',
      name: 'primaryDomainId',
      dataFieldPath: 'primaryDomainId',
      required: true,
      'aria-invalid': 'true',
      'aria-describedby': 'feature-field-error-primaryDomainId',
    }))
    expect(domainHtml).toContain('Primary domain')
    expect(domainHtml).toContain('Unknown domain')
    expect(domainHtml).toContain('UNMAPPED existing Domain')
    expect(domainHtml).toContain('DOM-IMPORTED-UNKNOWN')
    expect(domainHtml).toContain('name="primaryDomainId"')
    expect(domainHtml).toContain('data-field-path="primaryDomainId"')
    expect(domainHtml).toContain('required')
    expect(domainHtml).toContain('aria-invalid="true"')
    expect(domainHtml).toContain('aria-describedby="primary-domain-hint feature-field-error-primaryDomainId"')

    const workHtml = renderToStaticMarkup(createElement(WorkItemPicker, {
      projectId: PROJECT_ID,
      value: WORK_ITEM_ID,
      onChange: () => {},
      label: 'Work item',
      id: 'work-item',
      name: 'workItemId',
      dataFieldPath: 'workItemId',
      required: true,
      'aria-invalid': 'true',
      'aria-describedby': 'feature-field-error-workItemId',
    }))
    expect(workHtml).toContain('Search WorkItems')
    expect(workHtml).toContain('role="search"')
    expect(workHtml).not.toContain('<form')
    expect(workHtml).toContain('Search by code or title')
    expect(workHtml).toContain('Allocation is entered separately in basis points.')
    expect(workHtml).not.toContain('Selected WorkItem unavailable')
    expect(workHtml).toContain('Search active WorkItems in this Project.')
    expect(workHtml).toContain('name="workItemId"')
    expect(workHtml).toContain('data-field-path="workItemId"')
    expect(workHtml).toContain('required')
    expect(workHtml).toContain('aria-invalid="true"')
    expect(workHtml).toContain('aria-describedby="work-item-hint feature-field-error-workItemId"')
  })
})

import { describe, expect, it } from 'vitest'
import { projectItemsFromResponse } from '@/modules/project-manager/components/StandaloneTaskModal'

// @req FR-017 — direct task creation consumes the current project-list/scope
// response envelope instead of assuming the pre-FR-003 raw array shape.
// @tested tests/unit/standalone-task-modal-contract.test.js

describe('StandaloneTaskModal project response contract', () => {
  it('reads the current project-list envelope and keeps array compatibility', () => {
    const items = [{ id: 'project-a', businessId: 'business-a' }]
    expect(projectItemsFromResponse({ items, limit: 500, truncated: false })).toEqual(items)
    expect(projectItemsFromResponse(items)).toEqual(items)
    expect(projectItemsFromResponse(null)).toEqual([])
  })
})

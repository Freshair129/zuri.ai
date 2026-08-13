// @req FR-039 — Workspace, Organization, and Business are the shell context.
// @spec SDD-018, ADR-011
// @tested tests/unit/scope-view-context.test.js
import { describe, expect, it } from 'vitest'
import { BASE_CONTEXT_LEVELS } from '@/config/scope-views'

describe('Base Context Bar', () => {
  it('maps only the three approved schema entities in the approved order', () => {
    expect(BASE_CONTEXT_LEVELS.map((level) => level.schema)).toEqual(['portfolio', 'tenant', 'business'])
    expect(BASE_CONTEXT_LEVELS.map((level) => level.label)).toEqual(['Workspace', 'Organization', 'Business'])
  })
})

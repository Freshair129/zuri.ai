// @req FR-061 — the command palette indexes the same granted, non-reserved
// domain routes as the Business shell, plus resource entry points.
// @spec SDD-034, SDD-018
// @tested tests/unit/command-palette-index.test.js
import { describe, expect, it } from 'vitest'
import { buildRouteEntries } from '@/components/layouts/CommandPalette'

const paths = (granted) => buildRouteEntries(granted).map((entry) => entry.path)

describe('command palette route index', () => {
  it('derives searchable routes from live domains and omits reserved soon domains', () => {
    const entries = buildRouteEntries()
    const routePaths = entries.map((entry) => entry.path)

    expect(routePaths).toContain('/overview')
    expect(routePaths).toContain('/people')
    expect(routePaths).toContain('/platform/users')
    expect(routePaths).toContain('/workspaces')
    expect(routePaths).toContain('/profile')
    // @req FR-091 — `customer` stopped being a reserved slot on 2026-08-20 and has
    // real pages, so the palette must now find it.
    expect(routePaths).toContain('/customer')
    expect(routePaths).toContain('/customer/conversations')
    expect(routePaths).not.toContain('/commerce')
    // FR-159 activates Growth Dashboard and Strategy; other slots stay reserved.
    expect(routePaths).toContain('/growth')
    expect(routePaths).toContain('/growth/strategy')
    expect(routePaths).not.toContain('/operations')
    expect(routePaths.filter((path) => path === '/settings')).toHaveLength(1)
  })

  it('filters domain routes and resources by the active Business grant', () => {
    expect(paths(['people'])).toEqual(['/overview', '/people', '/people/directory'])
    expect(paths(['projects'])).toContain('/projects')
    expect(paths(['projects'])).toContain('/workspaces')
    expect(paths(['projects'])).not.toContain('/people')
    expect(paths(['projects'])).not.toContain('/profile')
    expect(paths(['projects'])).not.toContain('/growth/strategy')
    expect(paths(['growth'])).toContain('/growth/strategy')
  })
})

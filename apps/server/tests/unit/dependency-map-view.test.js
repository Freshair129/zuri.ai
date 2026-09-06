// @req FR-040 — Dependency Map provides graph and accessible edge-list views.
// @spec SDD-019, ADR-012
// @tested tests/unit/dependency-map-view.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const view = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/views/DependencyMap.jsx'), 'utf8')
const styles = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/views/dependency-map.module.css'), 'utf8')
const page = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/dependencies/page.jsx'), 'utf8')

describe('Dependency Map view', () => {
  it('renders the graph and a semantic edge-list fallback', () => {
    expect(view).toContain('aria-label="Dependency Map graph"')
    expect(view).toContain('aria-label="Dependency edge list"')
    expect(view).toContain('markerEnd="url(#dependency-arrow)"')
    expect(view).toContain('edge.label')
  })

  it('handles empty project graphs without rendering a blank canvas', () => {
    expect(view).toContain('No project dependencies')
    expect(view).toContain('The project has nodes but no dependency edges yet.')
  })

  it('keeps the visualization scrollable and motion-safe', () => {
    expect(styles).toContain('overflow: auto')
    expect(styles).toContain('@media (max-width: 640px)')
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('.node:focus-visible')
  })

  it('mounts the map only after the project-contained API succeeds', () => {
    expect(page).toContain('<DependencyMap graph={dependencyMap.data} />')
    expect(page).toContain('/api/projects/${projectId}/dependencies')
    expect(page).toContain('<ErrorState')
  })
})

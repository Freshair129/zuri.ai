// @req FR-040 — Structure Plan exposes the project-contained WBS with accessible states.
// @spec SDD-019, ADR-012
// @tested tests/unit/wbs-structure.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const view = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/views/WbsCanvas.jsx'), 'utf8')
const styles = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/views/wbs.module.css'), 'utf8')

describe('Structure Plan WBS view', () => {
  it('reads the canonical project tree without changing the API boundary', () => {
    expect(view).toContain("useFetch(`/api/projects/${projectId}/tree`)")
    expect(view).toContain('Workstream')
    expect(view).toContain('WorkContainer')
    expect(view).toContain('WorkItem')
    expect(view).toContain('container.children || []')
    expect(view).toContain('ws.items || []')
  })

  it('provides labelled tree nodes and keyboard-reachable work items', () => {
    expect(view).toContain('role="tree"')
    expect(view).toContain('role="treeitem"')
    expect(view).toContain('tabIndex={0}')
    expect(view).toContain('aria-label={`WorkItem: ${item.title}`}')
    expect(view).toContain('aria-expanded={')
  })

  it('keeps loading, error, unavailable, and no-workstream states explicit', () => {
    expect(view).toContain('Structure Plan loading')
    expect(view).toContain('Structure Plan error')
    expect(view).toContain('Project unavailable')
    expect(view).toContain('No workstreams yet')
    expect(view).toContain('<ErrorState detail={error} retry={reload} />')
    expect(view).toContain('<EmptyState title="No workstreams yet"')
  })

  it('keeps the canvas usable on narrow screens and with reduced motion', () => {
    expect(styles).toContain('max-width: 100%')
    expect(styles).toContain('overflow-x: auto')
    expect(styles).toContain('@media (max-width: 640px)')
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('.card:focus-visible')
  })
})

// @req FR-005, FR-006 — both requirements declare the same view at two scopes,
// global and project-scoped. Navigation between them was one-way: each
// project-scoped page has an "All projects" button upward, but a global row
// naming a project offered no way into it. These tests pin the downward edge.
// @spec NFR-008 — the link's visible text is a bare project code, which
// describes nothing to a screen reader, so it must name its destination.
// @tested tests/unit/global-view-drilldown.test.js
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { buildWorkColumns, projectDrilldownCell } from '@/modules/project-manager/views/universal/AllWorkView'
import { projectCodeCell } from '@/modules/project-manager/views/universal/MilestonesView'
import prisma from '@/lib/db'
import { listWork } from '@/modules/project-manager/application/work-service'
import { listMilestonesAndGates } from '@/modules/project-manager/application/milestone-gate-service'

// The drill-down href is built from a project id that only exists in the
// response because two Prisma `select`s ask for it. Those selects are the part
// no fixture can vouch for, so this suite drives the real service functions
// against a spy client and reads the arguments they actually send.
vi.mock('@/lib/db', () => {
  const client = {
    workItem: { findMany: vi.fn().mockResolvedValue([]) },
    milestone: { findMany: vi.fn().mockResolvedValue([]) },
    gate: { findMany: vi.fn().mockResolvedValue([]) },
  }
  return { default: client, prisma: client }
})

// Vitest transforms JSX with esbuild's *classic* runtime, which emits a bare
// `React.createElement`; Next.js builds the same files with the automatic
// runtime, which is why no component under `src/` imports React and none should
// start doing so to satisfy a test. Publishing React globally here — before any
// test body runs — lets this suite call the cell renderers directly and read the
// element they return, rather than string-matching the JSX. If the transform is
// ever switched to automatic, this line simply stops being consulted.
globalThis.React = React

const workRow = (project) => ({
  id: 'wi-1',
  code: 'WI-1',
  title: 'Draft the migration plan',
  subtype: 'TASK',
  status: 'PLANNED',
  weight: 1,
  workstream: project === undefined ? undefined : { code: 'WS-1', executionMode: 'DELIVERY', project },
})

const isElement = (v) => Boolean(v) && typeof v === 'object' && 'props' in v
const columnKeys = (cols) => cols.map((c) => c.key)
const projectColumn = (cols) => cols.find((c) => c.key === 'project')

describe('All Work — the Project column drills into the project-scoped view', () => {
  it('renders the Project column only in global scope', () => {
    expect(columnKeys(buildWorkColumns({}))).toContain('project')
    // In project scope the column is dropped, not de-linked: every row would
    // repeat one constant the page header and tab bar already establish.
    expect(columnKeys(buildWorkColumns({ projectId: 'p-1' }))).not.toContain('project')
  })

  it('drops nothing but the Project column when scoped to a project', () => {
    const globalKeys = columnKeys(buildWorkColumns({}))
    const scopedKeys = columnKeys(buildWorkColumns({ projectId: 'p-1' }))
    expect(globalKeys.filter((k) => k !== 'project')).toEqual(scopedKeys)
    expect(scopedKeys).toEqual(['code', 'title', 'subtype', 'stream', 'mode', 'actor', 'weight', 'status'])
  })

  it('links a global row to the same view scoped to its project', () => {
    const wrapper = projectColumn(buildWorkColumns({})).render(workRow({ id: 'p-1', code: 'PRJ-A' }))
    expect(isElement(wrapper)).toBe(true)
    const link = Array.isArray(wrapper.props.children) ? wrapper.props.children[0] : wrapper.props.children
    // The same view, scoped — not the project home, not a different tab.
    expect(link.props.href).toBe('/projects/p-1/all-work')
    expect(link.props.children).toBe('PRJ-A')
  })

  it('names the destination for a screen reader, not just the code', () => {
    const wrapper = projectDrilldownCell(workRow({ id: 'p-1', code: 'PRJ-A' }))
    const link = Array.isArray(wrapper.props.children) ? wrapper.props.children[0] : wrapper.props.children
    expect(link.props['aria-label']).toBe('Filter all work to project PRJ-A')
  })

  it('degrades to plain text when the project id is absent', () => {
    // A code with no id: the label is still worth showing, the link is not.
    const cell = projectDrilldownCell(workRow({ code: 'PRJ-A' }))
    expect(isElement(cell)).toBe(false)
    expect(cell).toBe('PRJ-A')
  })

  it('renders nothing rather than an empty link when the relation is missing', () => {
    expect(projectDrilldownCell(workRow(null))).toBe('')
    expect(projectDrilldownCell(workRow(undefined))).toBe('')
    expect(projectDrilldownCell({})).toBe('')
  })

  it('never emits an href containing undefined', () => {
    // An absence check: a presence-only assertion still passes if a broken
    // `/projects/undefined/all-work` is rendered alongside a good one.
    for (const project of [undefined, null, {}, { code: 'PRJ-A' }, { id: 'p-1' }]) {
      const cell = projectDrilldownCell(workRow(project))
      if (isElement(cell)) expect(cell.props.href).not.toContain('undefined')
    }
  })
})

describe('Milestones & Gates — the project code drills into the project-scoped view', () => {
  const milestone = { id: 'ms-1', code: 'MS-1', project: { id: 'p-1', code: 'PRJ-A' } }

  it('links the project code in global scope', () => {
    const cell = projectCodeCell(milestone)
    expect(isElement(cell)).toBe(true)
    expect(cell.props.href).toBe('/projects/p-1/milestones')
    expect(cell.props.children).toBe('PRJ-A')
    expect(cell.props['aria-label']).toBe('View milestones and gates in project PRJ-A')
  })

  it('leaves the project code as plain text in project scope', () => {
    // Here the code is kept but unlinked — it shares a meta line with the
    // milestone code and weight, so removing it would leave a ragged line.
    const cell = projectCodeCell(milestone, { projectId: 'p-1' })
    expect(isElement(cell)).toBe(false)
    expect(cell).toBe('PRJ-A')
  })

  it('applies the same rule to gate rows', () => {
    const gate = { id: 'g-1', code: 'GATE-1', project: { id: 'p-2', code: 'PRJ-B' } }
    expect(projectCodeCell(gate).props.href).toBe('/projects/p-2/milestones')
    expect(projectCodeCell(gate, { projectId: 'p-2' })).toBe('PRJ-B')
  })

  it('degrades to plain text when the project id is absent', () => {
    expect(projectCodeCell({ code: 'MS-1', project: { code: 'PRJ-A' } })).toBe('PRJ-A')
  })

  it('renders nothing rather than an empty link when the relation is missing', () => {
    expect(projectCodeCell({ code: 'MS-1' })).toBe('')
    expect(projectCodeCell({ code: 'MS-1', project: null })).toBe('')
    expect(projectCodeCell(undefined)).toBe('')
  })

  it('never emits an href containing undefined', () => {
    for (const project of [undefined, null, {}, { code: 'PRJ-A' }, { id: 'p-1' }]) {
      const cell = projectCodeCell({ code: 'MS-1', project })
      if (isElement(cell)) expect(cell.props.href).not.toContain('undefined')
    }
  })
})

describe('the read contract the drill-down depends on', () => {
  // A test whose fixture is richer than the production query cannot catch a
  // narrow select, and a narrow select does not fail loudly when it falls behind
  // the projection it feeds —
  // `.brain/rca/2026-08-16-narrow-select-dropped-fields-silently.md`. So these
  // assert the query argument, not a result assembled from a fixture.
  it('listWork asks for the project id the All Work link needs', async () => {
    await listWork({})
    const { include } = prisma.workItem.findMany.mock.calls.at(-1)[0]
    expect(include.workstream.select.project.select).toMatchObject({ id: true, code: true })
  })

  it('listMilestonesAndGates asks for it in both of its queries', async () => {
    await listMilestonesAndGates({})
    // Two queries feed one projection. Fixing only the one you happened to find
    // is the exact shape of the recorded incident, so both are asserted.
    expect(prisma.milestone.findMany.mock.calls.at(-1)[0].include.project.select).toMatchObject({ id: true, code: true })
    expect(prisma.gate.findMany.mock.calls.at(-1)[0].include.project.select).toMatchObject({ id: true, code: true })
  })
})

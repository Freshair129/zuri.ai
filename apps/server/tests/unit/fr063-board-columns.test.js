import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WORK_STATUSES } from '@/lib/validation/enums'

// @req FR-063 — one column per WORK_STATUSES value, derived from enums.js, so a
// status can never render in no column.
// @spec SDD-036, .brain/rca/2026-08-17-a-prose-rule-is-not-a-gate.md
// @tested tests/unit/fr063-board-columns.test.js
//
// The defect this pins: KanbanBoard and the sprint board in mode-bodies each
// hand-wrote their status list, each covered six of seven, and both dropped the
// same one — CANCELLED. A work item in that status appeared on neither surface,
// with no error and no empty state. It was simply absent.
//
// These are source assertions because the lists are module-private inside client
// components. That is weaker than calling the render, and it is deliberate: what
// must not regress is the *derivation*, and derivation is visible in the source.
// A behavioural test that mounted the component would pass just as happily
// against a re-hardcoded list that happened to be complete today.

const read = (p) => readFileSync(p, 'utf8')
const board = read('src/modules/project-manager/views/KanbanBoard.jsx')
const modes = read('src/modules/project-manager/views/execution/mode-bodies.jsx')

/** Keys of an object literal `const NAME = { KEY: ..., }` in source. */
function objectKeys(source, name) {
  const body = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] || ''
  return [...body.matchAll(/^\s*([A-Z][A-Z_0-9]*)\s*:/gm)].map((m) => m[1])
}

describe('the board derives its columns rather than listing them', () => {
  it('builds columns from WORK_STATUSES, not from a literal array', () => {
    expect(board).toContain('WORK_STATUSES.map(')
    expect(board).toContain("from '@/lib/validation/enums'")
  })

  it('has presentation metadata for every status, so none falls back to a raw key', () => {
    // The fallback exists so a new status still gets a column; needing it means
    // someone added a status and did not give it a label.
    const meta = objectKeys(board, 'COLUMN_META')
    expect(meta.length).toBeGreaterThan(0)
    expect([...WORK_STATUSES].sort()).toEqual([...meta].sort())
  })

  it('keeps a fallback anyway, so an unlabelled status still renders somewhere', () => {
    expect(board).toMatch(/COLUMN_META\[key\]\s*\|\|/)
  })

  it('carries no metadata for a status that no longer exists', () => {
    for (const key of objectKeys(board, 'COLUMN_META')) {
      expect(WORK_STATUSES, `COLUMN_META has ${key}, which is not a WORK_STATUSES value`).toContain(key)
    }
  })
})

describe('the sprint board groups every status, even when it merges columns', () => {
  // FR-009's sprint view legitimately collapses seven statuses into five
  // columns. Collapsing is fine; dropping is not.
  it('iterates WORK_STATUSES to build its groups', () => {
    expect(modes).toContain('for (const status of WORK_STATUSES)')
  })

  it('maps every status to a column label', () => {
    const labels = objectKeys(modes, 'SPRINT_COLUMN_LABELS')
    expect([...WORK_STATUSES].sort()).toEqual([...labels].sort())
  })

  it('lists every label it maps to in the column order, so no group is built and then hidden', () => {
    const order = /const SPRINT_COLUMN_ORDER = \[([^\]]*)\]/.exec(modes)?.[1] || ''
    const ordered = new Set([...order.matchAll(/'([^']+)'/g)].map((m) => m[1]))
    const body = /const SPRINT_COLUMN_LABELS = \{([\s\S]*?)\n\}/.exec(modes)?.[1] || ''
    const mapped = new Set([...body.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]))
    for (const label of mapped) {
      expect(ordered, `${label} is mapped to but never rendered`).toContain(label)
    }
  })
})

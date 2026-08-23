import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// @spec AGENTS.md §18 — a generated view may not assert something the repository
// cannot support.
// @tested tests/unit/doc-graph-delivery-attribution.test.js
//
// FEATURE-MAP's Task column says which roadmap task *delivered* a feature. Any
// roadmap row that merely mentions a requirement id claims it, and the winner
// used to be whichever file was read first — so filename order decided
// attribution, and a newly added roadmap that sorted earlier took delivered
// features away from the task that actually delivered them.
//
// The rule that replaced it: a task that has not started cannot be the delivery
// task of a requirement that already has code. These cases are its teeth.

const ROADMAP_DIR = 'docs/roadmap'
const NOT_STARTED = new Set(['planned', 'ready', 'blocked', 'cancelled', 'retired'])
const STARTED = new Set(['done', 'review', 'assigned', 'in-progress'])
const STATUS_CELL = /^([a-z][a-z-]*)(?:\s*\(.*\))?$/
const HAS_CODE = new Set(['✅ live', '🟠 built, not declared'])

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith('.md') ? [full] : []
  })
}

function cellsOf(line) {
  return line.split('|').map((c) => c.trim())
}

// The status token of a roadmap row, or null when the row carries none.
function statusOf(cells) {
  for (const c of cells) {
    const token = STATUS_CELL.exec(c.toLowerCase())?.[1]
    if (token && (NOT_STARTED.has(token) || STARTED.has(token))) return token
  }
  return null
}

// Every roadmap row keyed by its task id. A task id appearing in more than one
// roadmap keeps the first row, matching the generator's own precedence.
function roadmapRows() {
  const rows = new Map()
  for (const file of walk(ROADMAP_DIR)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.startsWith('|')) continue
      const cells = cellsOf(line)
      const taskId = cells[1]
      if (!/^TASK-/.test(taskId) || rows.has(taskId)) continue
      rows.set(taskId, { file, status: statusOf(cells) })
    }
  }
  return rows
}

// Every FEATURE-MAP row as { id, status, task }.
function featureRows() {
  return readFileSync('docs/FEATURE-MAP.md', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\| FR-\d{3} \|/.test(l))
    .map((l) => {
      const cells = cellsOf(l)
      return { id: cells[1], status: cells[6], task: cells[10] }
    })
}

describe('FEATURE-MAP delivery attribution', () => {
  it('never credits delivery of a built feature to a task that has not started', () => {
    const rows = roadmapRows()
    const offenders = featureRows()
      .filter((f) => HAS_CODE.has(f.status) && f.task !== '—')
      .map((f) => ({ ...f, row: rows.get(f.task) }))
      .filter((f) => f.row && NOT_STARTED.has(f.row.status))
      .map((f) => `${f.id} (${f.status}) credited to ${f.task}, whose row is "${f.row.status}"`)

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('still attributes a requirement that has no code yet, where any task may own it', () => {
    // The rule withholds a claim only when the requirement already has code.
    // Without this case the previous one could be satisfied by emptying the
    // column entirely, which would lose the plan-to-requirement link.
    const planned = featureRows().filter((f) => !HAS_CODE.has(f.status))
    expect(planned.length, 'no planned requirement left to check').toBeGreaterThan(0)
    expect(planned.some((f) => f.task !== '—')).toBe(true)
  })

  it('reads a status cell that carries a qualifier', () => {
    // Real rows say "done (beta)" and "in-progress (local slice; gates pending)".
    // If the qualifier defeated the match those rows would read as statusless,
    // be treated as started, and the first case would go quiet.
    expect(statusOf(['', 'TASK-X', 'done (beta)'])).toBe('done')
    expect(statusOf(['', 'TASK-X', 'in-progress (local slice; gates pending)'])).toBe('in-progress')
    expect(statusOf(['', 'TASK-X', 'planned'])).toBe('planned')
  })

  it('does not mistake a prose cell for a status', () => {
    // Titles are free text. "Ready the pipeline" must not read as `ready`, or a
    // started task would be wrongly withheld from a feature it delivered.
    expect(statusOf(['', 'TASK-X', 'Ready the pipeline for cutover', 'P0'])).toBeNull()
    expect(statusOf(['', 'TASK-X', 'Done with the migration work', 'P1'])).toBeNull()
  })
})

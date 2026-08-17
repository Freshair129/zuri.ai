import { describe, expect, it } from 'vitest'
import { zPlanEnvelope } from '@/modules/project-manager/import/plan-schema'
import { SHEETS, buildTemplateWorkbook } from '@/modules/project-manager/import/xlsx-template'
import {
  PROJECT_STATUSES,
  WORK_STATUSES,
  CONTAINER_STATUSES,
  MILESTONE_STATUSES,
  GATE_STATUSES,
} from '@/lib/validation/enums'

// @req FR-012, FR-018, FR-019 — the intake surface speaks the same status
// vocabulary the rest of the system does.
// @spec SDD-002, BR-004, BR-009
// @tested tests/unit/plan-status-vocabulary.test.js
//
// `status` was `z.string()` on every entity in the envelope, sitting beside
// `executionMode` and `progressStrategy` which were properly enum-typed. An
// import committed `status: 'BANANA'` — verified against a real database before
// this change, and it persisted.
//
// The harm is not cosmetic. FR-063's board derives its columns from
// `WORK_STATUSES` precisely so that no status can exist with nowhere to render;
// a WorkItem carrying a status outside that list has no column and disappears
// from the board. The intake surface was manufacturing exactly the value FR-063
// was written to make impossible.
//
// Every list below is DERIVED from `enums.js`, never written out here. A test
// that hard-codes the vocabulary is a second copy of it, and a second copy is
// the defect this file exists to close.

const envelope = (overrides = {}) => ({
  schemaVersion: '1.0',
  scope: { workspaceCode: 'WS-X' },
  project: { code: 'PRJ-X', name: 'P' },
  workstreams: [
    {
      code: 'WST-X',
      name: 'W',
      executionMode: 'OPERATIONS',
      progressStrategy: 'SLA_SCORE',
      containers: [{ code: 'WC-X', subtype: 'OPS_PERIOD', title: 'C' }],
      items: [{ code: 'WI-X', subtype: 'CHECKLIST_ITEM', title: 'I' }],
      milestones: [{ code: 'MS-X', title: 'M' }],
      gates: [{ code: 'GT-X', title: 'G' }],
    },
  ],
  ...overrides,
})

/** Set `status` on one entity of the envelope and return the whole plan. */
const withStatus = (where, status) => {
  const plan = envelope()
  const ws = plan.workstreams[0]
  const target = {
    project: plan.project,
    container: ws.containers[0],
    item: ws.items[0],
    milestone: ws.milestones[0],
    gate: ws.gates[0],
  }[where]
  target.status = status
  return plan
}

// Which enum governs which entity. This mapping IS the requirement.
const GOVERNED = [
  ['project', PROJECT_STATUSES],
  ['container', CONTAINER_STATUSES],
  ['item', WORK_STATUSES],
  ['milestone', MILESTONE_STATUSES],
  ['gate', GATE_STATUSES],
]

describe('every status in the envelope is enum-typed', () => {
  for (const [where, vocabulary] of GOVERNED) {
    it(`accepts every declared ${where} status`, () => {
      for (const status of vocabulary) {
        const parsed = zPlanEnvelope.safeParse(withStatus(where, status))
        expect(parsed.success, `${where} status ${status} must be accepted`).toBe(true)
      }
    })

    it(`rejects a ${where} status outside the vocabulary`, () => {
      for (const invented of ['BANANA', 'planned', 'IN PROGRESS', '']) {
        const parsed = zPlanEnvelope.safeParse(withStatus(where, invented))
        expect(parsed.success, `${where} status ${JSON.stringify(invented)} must be rejected`).toBe(false)
      }
    })
  }

  it('still allows an absent status — it is optional, not required', () => {
    expect(zPlanEnvelope.safeParse(envelope()).success).toBe(true)
  })

  it('names the offending field so an integrator can find it', () => {
    const parsed = zPlanEnvelope.safeParse(withStatus('item', 'BANANA'))
    const path = parsed.error.issues.map((i) => i.path.join('.')).join(' ')
    expect(path).toContain('items.0.status')
  })
})

describe('the vocabularies stay the ones enums.js declares', () => {
  it('rejects a value from the WRONG entity vocabulary', () => {
    // The check that a shared `z.string()` could never make: CANCELLED is a real
    // WorkItem status and is not a milestone status; PASSED is a gate status and
    // is not a project status. Both were accepted before.
    expect(zPlanEnvelope.safeParse(withStatus('milestone', 'CANCELLED')).success).toBe(false)
    expect(zPlanEnvelope.safeParse(withStatus('project', 'PASSED')).success).toBe(false)
    expect(zPlanEnvelope.safeParse(withStatus('gate', 'DONE')).success).toBe(false)
  })

  it('an item status is always a column the FR-063 board can render', () => {
    // The board builds one column per WORK_STATUSES value. Stated as an
    // assertion so that widening the item vocabulary without widening the board
    // fails here rather than by a card silently vanishing.
    for (const status of WORK_STATUSES) {
      expect(zPlanEnvelope.safeParse(withStatus('item', status)).success).toBe(true)
    }
    expect(WORK_STATUSES).toContain('CANCELLED')
  })
})

describe('the Excel template offers the same vocabulary it will be validated against', () => {
  const SHEET_VOCABULARY = [
    ['project', PROJECT_STATUSES],
    ['containers', CONTAINER_STATUSES],
    ['items', WORK_STATUSES],
    ['milestones', MILESTONE_STATUSES],
    ['gates', GATE_STATUSES],
  ]

  for (const [sheetKey, vocabulary] of SHEET_VOCABULARY) {
    it(`${SHEETS[sheetKey].title} offers exactly the ${sheetKey} status vocabulary`, () => {
      const column = SHEETS[sheetKey].columns.find((c) => c.key === 'status')
      expect(column, `${sheetKey} has a status column`).toBeTruthy()
      // Identity, not membership: a dropdown that offers a subset trains people
      // to type the rest by hand, which is how the free-text columns got there.
      expect(column.list).toEqual(vocabulary)
    })
  }

  it('offers no status on the Workstreams sheet, because the envelope has none', () => {
    // Not an oversight — `zWorkstream` carries no status field. A column here
    // would collect a value the pipeline then silently discards.
    expect(SHEETS.workstreams.columns.find((c) => c.key === 'status')).toBeUndefined()
  })

  it('renders those lists as real workbook dropdowns', () => {
    // The spec above is only a promise; this reads the generated workbook.
    const wb = buildTemplateWorkbook()
    for (const [sheetKey, vocabulary] of SHEET_VOCABULARY) {
      const sheet = wb.getWorksheet(SHEETS[sheetKey].title)
      const validations = Object.values(sheet.dataValidations.model)
      const found = validations.some(
        (v) => v.type === 'list' && vocabulary.every((value) => String(v.formulae[0]).includes(value))
      )
      expect(found, `${SHEETS[sheetKey].title} status dropdown`).toBe(true)
    }
  })
})

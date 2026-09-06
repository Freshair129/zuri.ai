// @req FR-161 — the pure rules of a sales task: the schedule contract, the
//   status machine, the human code, the calendar-day due state and the
//   summary a dashboard shows.
// @spec ADR-064
// @tested tests/unit/sales-task-domain.test.js
import { describe, expect, it } from 'vitest'
import {
  SALES_TASK_CODE_PATTERN,
  dayKey,
  dueState,
  isTerminalStatus,
  nextSalesTaskStatus,
  salesTaskCode,
  salesTaskSummary,
  zCreateSalesTask,
  zSalesTaskAction,
} from '@/modules/crm/sales-task-domain'

const base = { businessId: 'b-1', title: 'โทรติดตาม', dueDate: '2026-09-10' }

describe('FR-161 sales task contracts', () => {
  it('a SINGLE task is one day with an optional time window; a RANGE task spans start to due', () => {
    expect(zCreateSalesTask.parse(base)).toMatchObject({ title: 'โทรติดตาม' })
    expect(zCreateSalesTask.parse({ ...base, timeStart: '09:00', timeEnd: '10:30' }).timeEnd).toBe('10:30')
    expect(() => zCreateSalesTask.parse({ ...base, timeStart: '10:00', timeEnd: '09:00' })).toThrow(/after timeStart/)
    expect(() => zCreateSalesTask.parse({ ...base, timeEnd: '09:00' })).toThrow(/needs timeStart/)
    expect(() => zCreateSalesTask.parse({ ...base, timeStart: '9am' })).toThrow(/HH:MM/)
    expect(() => zCreateSalesTask.parse({ ...base, startDate: '2026-09-08' })).toThrow(/SINGLE task has no startDate/)
    expect(() => zCreateSalesTask.parse({ ...base, scheduleKind: 'RANGE' })).toThrow(/needs startDate/)
    expect(() => zCreateSalesTask.parse({ ...base, scheduleKind: 'RANGE', startDate: '2026-09-12' })).toThrow(/precede/)
    expect(() => zCreateSalesTask.parse({ ...base, scheduleKind: 'RANGE', startDate: '2026-09-08', timeStart: '09:00' })).toThrow(/no time window/)
    expect(zCreateSalesTask.parse({ ...base, scheduleKind: 'RANGE', startDate: '2026-09-08' }).scheduleKind).toBe('RANGE')
    expect(() => zCreateSalesTask.parse({ ...base, type: 'PROJECT' })).toThrow()
    expect(() => zCreateSalesTask.parse({ ...base, milestones: [] })).toThrow()
  })

  it('an action carries what it needs', () => {
    expect(() => zSalesTaskAction.parse({ action: 'UPDATE', version: 1 })).toThrow(/fields/)
    expect(() => zSalesTaskAction.parse({ action: 'ASSIGN', version: 1 })).toThrow(/assigneePersonId/)
    expect(zSalesTaskAction.parse({ action: 'ASSIGN', version: 1, assigneePersonId: null }).assigneePersonId).toBeNull()
    expect(zSalesTaskAction.parse({ action: 'COMPLETE', version: 2, outcome: 'ลูกค้าตกลง' }).outcome).toBe('ลูกค้าตกลง')
    expect(() => zSalesTaskAction.parse({ action: 'DELETE', version: 1 })).toThrow()
  })
})

describe('FR-161 sales task status machine', () => {
  it('moves OPEN → IN_PROGRESS → DONE, cancels from either open state, reopens only from a closed one', () => {
    expect(nextSalesTaskStatus('OPEN', 'START')).toBe('IN_PROGRESS')
    expect(nextSalesTaskStatus('IN_PROGRESS', 'START')).toBeNull()
    expect(nextSalesTaskStatus('OPEN', 'COMPLETE')).toBe('DONE')
    expect(nextSalesTaskStatus('IN_PROGRESS', 'COMPLETE')).toBe('DONE')
    expect(nextSalesTaskStatus('DONE', 'COMPLETE')).toBeNull()
    expect(nextSalesTaskStatus('OPEN', 'CANCEL')).toBe('CANCELLED')
    expect(nextSalesTaskStatus('CANCELLED', 'CANCEL')).toBeNull()
    expect(nextSalesTaskStatus('DONE', 'REOPEN')).toBe('OPEN')
    expect(nextSalesTaskStatus('CANCELLED', 'REOPEN')).toBe('OPEN')
    expect(nextSalesTaskStatus('OPEN', 'REOPEN')).toBeNull()
    expect(nextSalesTaskStatus('IN_PROGRESS', 'UPDATE')).toBe('IN_PROGRESS')
    expect(nextSalesTaskStatus('DONE', 'UPDATE')).toBeNull()
    expect(nextSalesTaskStatus('DONE', 'ASSIGN')).toBeNull()
    expect(isTerminalStatus('DONE')).toBe(true)
    expect(isTerminalStatus('OPEN')).toBe(false)
  })
})

describe('FR-161 calendar day, code and summary', () => {
  it('day keys follow the Business calendar (Asia/Bangkok), so 23:30 UTC is already tomorrow', () => {
    expect(dayKey(new Date('2026-09-06T23:30:00Z'))).toBe('2026-09-07')
    expect(dayKey(new Date('2026-09-06T16:59:00Z'))).toBe('2026-09-06')
    expect(dayKey(new Date('2026-09-06T23:30:00Z'), 'UTC')).toBe('2026-09-06')
  })

  it('the human code is TSK-YYYYMMDD-NNN', () => {
    expect(salesTaskCode(new Date('2026-09-06T10:00:00Z'), 1)).toBe('TSK-20260906-001')
    expect(salesTaskCode(new Date('2026-09-06T10:00:00Z'), 1234)).toBe('TSK-20260906-1234')
    expect(SALES_TASK_CODE_PATTERN.test('TSK-20260906-007')).toBe(true)
    expect(SALES_TASK_CODE_PATTERN.test('TSK-2026-1')).toBe(false)
  })

  it('due state is OVERDUE / TODAY / UPCOMING for an open task and NONE for a closed one', () => {
    const now = new Date('2026-09-06T05:00:00Z')
    expect(dueState({ status: 'OPEN', dueDate: '2026-09-05T00:00:00Z' }, now)).toBe('OVERDUE')
    expect(dueState({ status: 'IN_PROGRESS', dueDate: '2026-09-06T00:00:00Z' }, now)).toBe('TODAY')
    expect(dueState({ status: 'OPEN', dueDate: '2026-09-07T00:00:00Z' }, now)).toBe('UPCOMING')
    expect(dueState({ status: 'DONE', dueDate: '2026-09-01T00:00:00Z' }, now)).toBe('NONE')
    expect(dueState(null, now)).toBe('NONE')
  })

  it('the summary counts open work only, and "mine" against the viewer', () => {
    const now = new Date('2026-09-06T05:00:00Z')
    const tasks = [
      { status: 'OPEN', dueDate: '2026-09-05T00:00:00Z', assigneePersonId: 'me' },
      { status: 'IN_PROGRESS', dueDate: '2026-09-06T00:00:00Z', assigneePersonId: null },
      { status: 'OPEN', dueDate: '2026-09-09T00:00:00Z', assigneePersonId: 'other' },
      { status: 'DONE', dueDate: '2026-09-01T00:00:00Z', assigneePersonId: 'me' },
      { status: 'CANCELLED', dueDate: '2026-09-01T00:00:00Z', assigneePersonId: 'me' },
    ]
    expect(salesTaskSummary(tasks, { now, viewerPersonId: 'me' })).toEqual({ open: 2, inProgress: 1, overdue: 1, dueToday: 1, mine: 1, unassigned: 1 })
    expect(salesTaskSummary([], { now })).toEqual({ open: 0, inProgress: 0, overdue: 0, dueToday: 0, mine: 0, unassigned: 0 })
  })
})

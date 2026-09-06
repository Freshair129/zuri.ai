import { z } from 'zod'
import {
  SALES_TASK_ACTIONS,
  SALES_TASK_PRIORITIES,
  SALES_TASK_SCHEDULE_KINDS,
  SALES_TASK_STATUSES,
  SALES_TASK_TYPES,
} from '@/lib/validation/enums'

// @req FR-161 — the pure vocabulary and rules of a sales task: the input
//   contracts, the schedule rules (a SINGLE task is one day with an optional
//   time window; a RANGE task spans start → due), the status machine
//   (OPEN → IN_PROGRESS → DONE, OPEN | IN_PROGRESS → CANCELLED, DONE |
//   CANCELLED → OPEN on REOPEN), the human code shape `TSK-YYYYMMDD-NNN`, and
//   the due state a list shows (OVERDUE / TODAY / UPCOMING) computed against
//   the Business's calendar day — never stored, because "overdue" is a fact
//   about now, not about the row. No I/O here on purpose.
// @spec ADR-064; ADR-054 D3/D4
// @tested tests/unit/sales-task-domain.test.js

export const SALES_TASK_ENTITY = 'SALES_TASK'
export const SALES_TASK_TIME_ZONE = 'Asia/Bangkok'
export const SALES_TASK_TERMINAL_STATUSES = Object.freeze(['DONE', 'CANCELLED'])
export const SALES_TASK_CODE_PATTERN = /^TSK-\d{8}-\d{3,}$/

const zId = z.string().trim().min(1).max(200)
const zText = (max) => z.string().trim().min(1).max(max)
const zOptionalText = (max) => z.string().trim().max(max).nullable().optional()
const zClock = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM')
const zDate = z.coerce.date()

function scheduleRules(value, ctx) {
  const kind = value.scheduleKind ?? 'SINGLE'
  if (kind === 'RANGE') {
    if (!value.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'a RANGE task needs startDate' })
    else if (value.dueDate && value.startDate > value.dueDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'dueDate must not precede startDate' })
    if (value.timeStart || value.timeEnd) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['timeStart'], message: 'a RANGE task has no time window' })
  } else {
    if (value.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'a SINGLE task has no startDate' })
    if (value.timeEnd && !value.timeStart) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['timeEnd'], message: 'timeEnd needs timeStart' })
    if (value.timeStart && value.timeEnd && value.timeEnd <= value.timeStart) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['timeEnd'], message: 'timeEnd must be after timeStart' })
  }
}

export const zSalesTaskFields = z.object({
  title: zText(200),
  description: zOptionalText(2000),
  type: z.enum(SALES_TASK_TYPES),
  priority: z.enum(SALES_TASK_PRIORITIES),
  scheduleKind: z.enum(SALES_TASK_SCHEDULE_KINDS),
  dueDate: zDate,
  startDate: zDate.nullable(),
  timeStart: zClock.nullable(),
  timeEnd: zClock.nullable(),
}).strict()

export const zCreateSalesTask = z.object({
  businessId: zId,
  customerId: zId.nullable().optional(),
  conversationId: zId.nullable().optional(),
  assigneePersonId: zId.nullable().optional(),
  title: zText(200),
  description: zOptionalText(2000),
  type: z.enum(SALES_TASK_TYPES).optional(),
  priority: z.enum(SALES_TASK_PRIORITIES).optional(),
  scheduleKind: z.enum(SALES_TASK_SCHEDULE_KINDS).optional(),
  dueDate: zDate,
  startDate: zDate.nullable().optional(),
  timeStart: zClock.nullable().optional(),
  timeEnd: zClock.nullable().optional(),
}).strict().superRefine(scheduleRules)

export const zSalesTaskAction = z.object({
  action: z.enum(SALES_TASK_ACTIONS),
  version: z.number().int().positive(),
  fields: zSalesTaskFields.partial().strict().optional(),
  assigneePersonId: zId.nullable().optional(),
  outcome: zOptionalText(2000),
  reason: zOptionalText(500),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'UPDATE' && (!value.fields || Object.keys(value.fields).length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields is required for UPDATE' })
  }
  if (value.action === 'ASSIGN' && value.assigneePersonId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assigneePersonId'], message: 'assigneePersonId (or null to unassign) is required for ASSIGN' })
  }
})

export const zSalesTaskListQuery = z.object({
  businessId: zId,
  status: z.enum(SALES_TASK_STATUSES).optional(),
  assigneePersonId: z.string().trim().min(1).max(200).optional(),
  customerId: zId.optional(),
  conversationId: zId.optional(),
  due: z.enum(['OVERDUE', 'TODAY', 'UPCOMING']).optional(),
  includeClosed: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
}).strict()

/** Whether this status accepts no further work. */
export function isTerminalStatus(status) {
  return SALES_TASK_TERMINAL_STATUSES.includes(status)
}

/**
 * The status an action leads to from `current`, or null when the action is
 * not allowed there. UPDATE and ASSIGN keep the status but are refused on a
 * closed task; REOPEN is the only way out of a closed one.
 */
export function nextSalesTaskStatus(current, action) {
  switch (action) {
    case 'UPDATE':
    case 'ASSIGN':
      return isTerminalStatus(current) ? null : current
    case 'START':
      return current === 'OPEN' ? 'IN_PROGRESS' : null
    case 'COMPLETE':
      return current === 'OPEN' || current === 'IN_PROGRESS' ? 'DONE' : null
    case 'CANCEL':
      return current === 'OPEN' || current === 'IN_PROGRESS' ? 'CANCELLED' : null
    case 'REOPEN':
      return isTerminalStatus(current) ? 'OPEN' : null
    default:
      return null
  }
}

/** `YYYY-MM-DD` of an instant in the Business's calendar (Asia/Bangkok by default). */
export function dayKey(date, timeZone = SALES_TASK_TIME_ZONE) {
  const d = date instanceof Date ? date : new Date(date)
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** The human code for the `seq`-th task created on a day: `TSK-YYYYMMDD-NNN`. */
export function salesTaskCode(date, seq, timeZone = SALES_TASK_TIME_ZONE) {
  return `TSK-${dayKey(date, timeZone).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`
}

/** OVERDUE / TODAY / UPCOMING for an open task, NONE for a closed one. */
export function dueState(task, now = new Date(), timeZone = SALES_TASK_TIME_ZONE) {
  if (!task || isTerminalStatus(task.status)) return 'NONE'
  const due = dayKey(task.dueDate, timeZone)
  const today = dayKey(now, timeZone)
  if (due < today) return 'OVERDUE'
  if (due === today) return 'TODAY'
  return 'UPCOMING'
}

/** The counts a sales dashboard shows, from open tasks only. */
export function salesTaskSummary(tasks = [], { now = new Date(), viewerPersonId = null, timeZone = SALES_TASK_TIME_ZONE } = {}) {
  const summary = { open: 0, inProgress: 0, overdue: 0, dueToday: 0, mine: 0, unassigned: 0 }
  for (const task of tasks) {
    if (isTerminalStatus(task.status)) continue
    if (task.status === 'OPEN') summary.open += 1
    if (task.status === 'IN_PROGRESS') summary.inProgress += 1
    const state = dueState(task, now, timeZone)
    if (state === 'OVERDUE') summary.overdue += 1
    if (state === 'TODAY') summary.dueToday += 1
    if (viewerPersonId && task.assigneePersonId === viewerPersonId) summary.mine += 1
    if (!task.assigneePersonId) summary.unassigned += 1
  }
  return summary
}

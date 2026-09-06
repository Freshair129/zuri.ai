import { z } from 'zod'

// @req FR-162 — the Operations surface accepts a bounded intake payload and
// versioned mutations; source projections never accept arbitrary client data.
// @spec SDD-089, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-operations-contract.test.js

export const MARKETING_OPERATIONS_TABS = Object.freeze([
  { key: 'intake', label: 'Intake' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'handoffs', label: 'Handoffs' },
])

export const MARKETING_OPERATIONS_STATES = Object.freeze([
  'READY',
  'EMPTY',
  'PARTIAL',
  'STALE',
  'UNAVAILABLE',
  'FORBIDDEN',
])

const MARKETING_INTAKE_STATUS_VALUES = Object.freeze({
  NEW: 'NEW',
  TRIAGED: 'TRIAGED',
  IN_PROGRESS: 'IN_PROGRESS',
  BLOCKED: 'BLOCKED',
  DONE: 'DONE',
  ARCHIVED: 'ARCHIVED',
})
export const MARKETING_INTAKE_STATUSES = Object.freeze(Object.values(MARKETING_INTAKE_STATUS_VALUES))

const text = (name, max) => z.string().trim().min(1, `${name} is required`).max(max, `${name} is too long`)
const optionalText = (name, max) => z.string().trim().max(max, `${name} is too long`).nullable().optional()
const date = z.string().datetime({ offset: true }).nullable().optional()

export const zMarketingOperationsCreateInput = z.object({
  businessId: text('businessId', 100),
  title: text('title', 200),
  capability: text('capability', 100),
  objective: text('objective', 4000),
  requiredAt: date,
  evidenceReference: optionalText('evidenceReference', 4000),
  responsibleOwnerId: optionalText('responsibleOwnerId', 100),
}).strict()

const zExpectedVersion = z.number().int().min(1)
const zUpdateFields = z.object({
  title: text('title', 200).optional(),
  capability: text('capability', 100).optional(),
  objective: text('objective', 4000).optional(),
  requiredAt: date,
  evidenceReference: optionalText('evidenceReference', 4000),
  responsibleOwnerId: optionalText('responsibleOwnerId', 100),
  status: z.enum(MARKETING_INTAKE_STATUSES).optional(),
}).strict().refine((fields) => Object.keys(fields).length > 0, 'at least one field is required')

export const zMarketingOperationsActionInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    businessId: text('businessId', 100),
    expectedVersion: zExpectedVersion,
    fields: zUpdateFields,
  }).strict(),
  z.object({
    action: z.literal('archive'),
    businessId: text('businessId', 100),
    expectedVersion: zExpectedVersion,
  }).strict(),
])

export const zMarketingOperationsId = z.string().trim().min(1).max(100)

export function operationsTabPath(tab = 'intake', query = {}) {
  const selected = MARKETING_OPERATIONS_TABS.some((item) => item.key === tab) ? tab : 'intake'
  const params = new URLSearchParams({ tab: selected, ...query })
  return `/growth/operations?${params.toString()}`
}

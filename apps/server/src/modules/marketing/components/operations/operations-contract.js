'use client'

// @req FR-161 — Operations URLs preserve one scoped tab row and point to the
// aggregate/detail routes without inventing a second navigation layer.
// @spec SDD-089
// @tested tests/unit/marketing/marketing-operations-ui.test.js

export const OPERATIONS_TABS = Object.freeze([
  { key: 'intake', label: 'Intake' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'handoffs', label: 'Handoffs' },
])

export const OPERATIONS_STATES = Object.freeze(['READY', 'EMPTY', 'PARTIAL', 'STALE', 'UNAVAILABLE', 'FORBIDDEN'])

export function operationsCollectionPath(businessId, tab = 'intake') {
  const params = new URLSearchParams({ businessId, tab })
  return `/api/growth/operations?${params.toString()}`
}

export function operationsPagePath(tab = 'intake', query = {}) {
  const params = new URLSearchParams({ tab, ...query })
  return `/growth/operations?${params.toString()}`
}

export function operationsIntakePath(id, businessId) {
  return `/api/growth/operations/intake/${encodeURIComponent(id)}?businessId=${encodeURIComponent(businessId)}`
}

export function operationsHandoffPath(id, businessId) {
  return `/api/growth/operations/handoffs/${encodeURIComponent(id)}?businessId=${encodeURIComponent(businessId)}`
}

export function intakePagePath(id) {
  return `/growth/operations/intake/${encodeURIComponent(id)}`
}

export function handoffPagePath(id) {
  return `/growth/operations/handoffs/${encodeURIComponent(id)}`
}

export function sectionFor(data, key) {
  return data?.sections?.[key] || { state: 'UNAVAILABLE', source: 'MARKETING_OPERATIONS', rows: [], warnings: ['Operations section is unavailable.'], truncated: false }
}

export function formatOperationsDate(value) {
  if (!value) return 'No date'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Invalid date'
}

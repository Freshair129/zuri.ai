// @req FR-068, FR-070 — the Execution Roadmap UI must present the read model's
// machine vocabulary (UNAVAILABLE reason codes, the deadlineState enum, raw
// entity ids) as human-readable text, without changing what the read model
// returns.
// @spec SDD-039, ADR-028, ADR-029, FR-070
// @tested tests/unit/project-roadmap-ui.test.js
//
// Deliberately does NOT import project-roadmap-read-model.js: that module
// pulls in @/lib/db (Prisma), and this file is imported from the 'use client'
// roadmap page — importing a Prisma-backed module into the client bundle
// would break the build. Instead, tests/unit/project-roadmap-ui.test.js reads
// the read model's source text directly and asserts every reason code and
// enum value declared there has an entry here, so drift fails a test instead
// of reaching a user as a raw key.

// Every `unavailable('...')` reason code the read model can emit, each paired
// with a short, page-appropriate sentence. Two families exist and must read
// differently: a "*_NOT_MODELED" (or similarly structural) code means this
// product has no contract for that data yet; a "*_NOT_RESOLVED" / "NO_*" code
// means the data is modeled but this particular row has no value.
export const REASON_CODE_LABELS = Object.freeze({
  // Structural — the capability is not modeled yet.
  TAGS_NOT_MODELED: 'Tags are not modeled yet.',
  CRITERIA_NOT_MODELED: 'Completion criteria are not modeled yet.',
  ITEM_EVIDENCE_NOT_MODELED: 'Completion evidence is not modeled yet.',
  CONTAINER_PROGRESS_NOT_MODELED: 'Progress evidence is not modeled yet.',
  CLOSURE_DECISION_NOT_MODELED: 'The closure decision is not modeled yet.',
  PROJECT_ACCOUNTABILITY_NOT_MODELED: 'Project accountability is not modeled yet.',
  SUPPORTING_IDENTITIES_NOT_MODELED: 'Supporting identity references are not modeled yet.',
  RISK_MODEL_NOT_AVAILABLE: 'The risk model is not available yet.',
  NO_APPROVED_SOURCE: 'No approved data source is configured yet.',
  // Per-row — the field is modeled, but this row has no resolved value.
  BLOCKER_OWNER_NOT_RESOLVED: 'The blocker owner could not be resolved.',
  ASSIGNEE_NOT_RESOLVED: 'The assignee could not be resolved.',
  NO_ASSIGNEE: 'No assignee is set.',
})

const FALLBACK_REASON_LABEL = 'Not available yet.'

// Renders a value's UNAVAILABLE reason code as a short human sentence. Falls
// back to a generic (still human) message for a code this map does not know
// about yet, so a new code never reaches the screen as a raw key even before
// this map is updated — but the drift test still fails so the map does get
// updated.
export function reasonLabel(reasonCode) {
  return REASON_CODE_LABELS[reasonCode] || FALLBACK_REASON_LABEL
}

// Generic SCREAMING_SNAKE_CASE -> "Title case" transform. Used for read-model
// enums (e.g. summary.deadlineState) that are not string-keyed lookups — this
// derives a label algorithmically instead of hand-copying the enum's value
// list into the UI, so a new enum value is labeled automatically rather than
// falling back to the raw key.
export function humanizeEnumValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Resolves a WorkContainer id to its human code, searching the full
// containers list the Roadmap response already carries. Returns null when the
// id is absent, and a distinct 'unresolved' marker when the id is present but
// not found among the known containers (should not happen for a consistent
// response, but must never render a bare uuid if it does).
export function resolveContainerLabel(containers, containerId) {
  if (!containerId) return null
  const match = (containers || []).find((container) => container.containerId === containerId)
  return match ? match.code : 'Unresolved container'
}

// Resolves a WorkItem id to its human code, searching the full items list.
export function resolveItemLabel(items, workItemId) {
  if (!workItemId) return null
  const match = (items || []).find((item) => item.workItemId === workItemId)
  return match ? match.code : 'Unresolved item'
}

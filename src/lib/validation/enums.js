import { z } from 'zod'

// @spec SDD-002, BR-004 — one Zod source of truth for every persisted enum;
// only seven canonical execution modes exist.
// @tested tests/unit/plan-schema.test.js, tests/integration/xlsx-intake.test.js
// Persisted enums are plain strings in SQLite; these Zod enums are the single
// source of truth so the data model can move to Postgres without connector
// enum coupling.

export const EXECUTION_MODES = [
  'SOFTWARE_SPRINT',
  'DATA_MIGRATION',
  'B2B_SALES',
  'B2C_CAMPAIGN',
  'PRODUCT_LAUNCH',
  'OPERATIONS',
  'BUSINESS_EXPANSION',
]

export const PROGRESS_STRATEGIES = [
  'TASK_WEIGHT',
  'RECORD_VALIDATION',
  'WEIGHTED_PIPELINE',
  'KPI_ATTAINMENT',
  'MILESTONE_READINESS',
  'SLA_SCORE',
  'EXPANSION_READINESS',
]

// Default strategy per mode (used when a workstream is created without one).
export const MODE_DEFAULT_STRATEGY = {
  SOFTWARE_SPRINT: 'TASK_WEIGHT',
  DATA_MIGRATION: 'RECORD_VALIDATION',
  B2B_SALES: 'WEIGHTED_PIPELINE',
  B2C_CAMPAIGN: 'KPI_ATTAINMENT',
  PRODUCT_LAUNCH: 'MILESTONE_READINESS',
  OPERATIONS: 'SLA_SCORE',
  BUSINESS_EXPANSION: 'EXPANSION_READINESS',
}

export const DEPENDENCY_TYPES = [
  'BLOCKS',
  'REQUIRES',
  'RELATES_TO',
  'START_AFTER',
  'FINISH_BEFORE',
  // Lineage (ADR-009 §D3): "what replaced what" and "where it came from". Used by the
  // self-governance import (doc-graph supersedes/relates → Dependency rows).
  'SUPERSEDES',
  'DERIVES_FROM',
]

export const DEPENDENCY_ENDPOINT_TYPES = [
  'PROJECT',
  'WORKSTREAM',
  'MILESTONE',
  'GATE',
  'WORK_CONTAINER',
  'WORK_ITEM',
]

export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'DONE', 'ARCHIVED']
// @req FR-086 / ADR-036 Consequences — the subset of PROJECT_STATUSES the
// Projects Dashboard's KPI band highlights; ON_HOLD and ARCHIVED are the
// remainder its "Other" disclosure accounts for (tests/unit/projects-dashboard-ui.test.js).
// Named here, next to the enum it is a subset of, and imported by the page —
// never hand-copied at the call site (CLAUDE.md) — so a sixth PROJECT_STATUSES
// value added tomorrow lands in the remainder automatically, with no edit to
// the page required.
export const PROJECT_STATUS_HIGHLIGHTS = ['PLANNED', 'ACTIVE', 'DONE']
// @req FR-087 — ordered most-urgent first, and the order is the contract: the
// Projects Dashboard's "Top 5 Priority" sorts by this array's index, so a value
// inserted in the middle re-ranks the list. Four levels rather than five because
// a scale with a middle has one, and everything lands on it.
export const PROJECT_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
export const WORKSTREAM_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'DONE', 'ARCHIVED']
export const WORK_STATUSES = ['PLANNED', 'READY', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE', 'CANCELLED']
// A WorkContainer (sprint / stage / pipeline / wave / phase / period / site) is a
// grouping, not a unit of work, so it does not share WORK_STATUSES — it has no
// READY, REVIEW, BLOCKED or CANCELLED. Frozen from observed usage only, the same
// discipline as ROADMAP_STATUSES below: `PLANNED` is the default in both
// `prisma/schema.prisma` and `zWorkContainerInput`, and `ACTIVE` is what
// `prisma/seed.js` gives every container it creates. Nothing else has ever been
// written — no UI path mutates a container's status at all (`StatusSelect`
// wires `entity="container"` but nobody renders it). Do NOT add DONE or
// ARCHIVED here on the argument that they feel right; add them when something
// actually sets them.
export const CONTAINER_STATUSES = ['PLANNED', 'ACTIVE']
export const MILESTONE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'DONE', 'MISSED']
export const GATE_STATUSES = ['OPEN', 'PASSED', 'BLOCKED', 'WAIVED']
// @req FR-111 — the knowledge sensitivity lattice, listed most open first.
//
// The order is descriptive, not a contract. Nothing compares by position: every
// site in the codebase tests equality against 'PUBLIC', and SDD-062 is the
// decision that the serve filter STAYS that way. Do not read this ordering as an
// invitation to make a filter lattice-aware — that is the exact change SDD-062
// exists to stop.
//
// Named KNOWLEDGE_ rather than SENSITIVITY_ on purpose. `sensitivity` already
// means something else in the agent domain — FR-026 action sensitivity, LOW/HIGH,
// about step-up re-auth. Three usages, two vocabularies: action-gate.js and
// write-tools.js speak the action one; agent/auth-context.js speaks THIS one —
// its only value is the string 'PUBLIC', a lattice member, not LOW or HIGH.
// `write-tools.js` rejects an action sensitivity outside LOW/HIGH, so a knowledge
// value cannot reach that path; `agent/auth-context.js` validates a request against
// AGENT_REQUESTABLE_SENSITIVITY (a policy-restricted subset of this lattice, not
// a copy of it), so the separation rests on a guard there, not only on naming.
export const KNOWLEDGE_SENSITIVITY_LEVELS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']

export const WORKSPACE_SCOPE_TYPES = ['PORTFOLIO', 'TENANT', 'BUSINESS']
export const MEMBERSHIP_ROLES = ['OWNER', 'MEMBER']

// Derived subsets — a genuine filter over an enum is named here, next to its
// source, and imported, rather than hand-copied at each call site (CLAUDE.md;
// .brain/rca/2026-08-17-a-prose-rule-is-not-a-gate.md). Computed from the
// parent above so it cannot drift from it.
// A gate no longer blocks progress once PASSED or WAIVED (progress/strategies.js).
export const SATISFIED_GATE_STATUSES = GATE_STATUSES.filter((s) => s === 'PASSED' || s === 'WAIVED')

// FR-059 — Business Strategy mutation. Frozen from observed usage only: schema
// defaults (BusinessRoadmap.status, BusinessGoal.status/priority in
// prisma/schema.prisma), prisma/seed.js values, and the `status: { not: 'ARCHIVED' }`
// filters already applied to both models in
// src/modules/business/application/business-strategy-service.js. Do not add
// values (e.g. ON_HOLD, LOW) that are not observed anywhere yet.
// @spec SDD-002, SDD-032
export const ROADMAP_STATUSES = ['ACTIVE', 'ARCHIVED']
export const GOAL_STATUSES = ['PLANNED', 'ACTIVE', 'DONE', 'ARCHIVED']
export const GOAL_PRIORITIES = ['MEDIUM', 'HIGH']

// FR-023 — CRM slice (ADR-007 P2)
export const CHANNELS = ['LINE', 'FACEBOOK', 'WEB']
export const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND']
export const CUSTOMER_LIFECYCLE = ['LEAD', 'ACTIVE', 'DORMANT', 'LOST']

// FR-103 — SEC-005 PDPA consent, recorded on the Customer row that FR-023's own
// docstring already calls the CRM-sharing unit (businesses in one tenant share
// the Customer). PENDING is the default for every new Customer from here on;
// GRANDFATHERED marks a row that predates this column and was already being
// served, so shipping this migration does not retroactively cut off a live
// conversation — see the migration comment for the backfill this pairs with.
export const CUSTOMER_CONSENT_STATUSES = ['PENDING', 'GRANTED', 'DECLINED', 'GRANDFATHERED']

// FR-066/FR-067 — Workspace collaboration boundary (ADR-027 D5). "Workspace"
// here is the top-level container, schema Portfolio — never schema Workspace,
// which is a Space (see WORKSPACE_SCOPE_TYPES above, a different axis).
// Statuses are frozen from what the code actually writes: ADR-027 D5 also names
// a PENDING membership, but nothing writes one — the waiting state is a PENDING
// *invite*, not a pending membership row — so it is deliberately absent here
// (the CONTAINER_STATUSES discipline: add it when something sets it).
export const WORKSPACE_MEMBERSHIP_ROLES = ['OWNER', 'ADMIN', 'MEMBER']
export const WORKSPACE_MEMBERSHIP_STATUSES = ['ACTIVE', 'REMOVED']
// An invite can never mint OWNER: ownership is taken by creating the Workspace
// or by a later owner-authorized change, not by a token (AC-067.6). Derived
// from the parent so it cannot drift from it.
export const WORKSPACE_INVITE_ROLES = WORKSPACE_MEMBERSHIP_ROLES.filter((r) => r !== 'OWNER')
// EXPIRED is not persisted: expiry is a fail-closed comparison against
// `expiresAt` at acceptance time, never a status column somebody must update.
export const WORKSPACE_INVITE_STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED']

// FR-022 — the P3 gate's staff/customer split. In V2's unified identity a Person
// is STAFF when it holds a Membership in the tenant (RBAC side) and CUSTOMER when
// it holds a Customer record (CRM side); a Person that is both resolves to STAFF
// (precedence), and one that is neither is UNKNOWN. Structural, not a stored column.
export const PRINCIPAL_TYPES = ['STAFF', 'CUSTOMER', 'UNKNOWN']
export const IDENTITY_PROVIDERS = ['LINE']

export const zExecutionMode = z.enum(EXECUTION_MODES)
export const zProgressStrategy = z.enum(PROGRESS_STRATEGIES)
export const zDependencyType = z.enum(DEPENDENCY_TYPES)
export const zDependencyEndpointType = z.enum(DEPENDENCY_ENDPOINT_TYPES)
export const zProjectStatus = z.enum(PROJECT_STATUSES)
export const zProjectPriority = z.enum(PROJECT_PRIORITIES)
export const zWorkstreamStatus = z.enum(WORKSTREAM_STATUSES)
export const zWorkStatus = z.enum(WORK_STATUSES)
export const zContainerStatus = z.enum(CONTAINER_STATUSES)
export const zMilestoneStatus = z.enum(MILESTONE_STATUSES)
export const zGateStatus = z.enum(GATE_STATUSES)
export const zWorkspaceScopeType = z.enum(WORKSPACE_SCOPE_TYPES)
export const zMembershipRole = z.enum(MEMBERSHIP_ROLES)
export const zChannel = z.enum(CHANNELS)
export const zMessageDirection = z.enum(MESSAGE_DIRECTIONS)
export const zCustomerLifecycle = z.enum(CUSTOMER_LIFECYCLE)
export const zCustomerConsentStatus = z.enum(CUSTOMER_CONSENT_STATUSES)
export const zWorkspaceMembershipRole = z.enum(WORKSPACE_MEMBERSHIP_ROLES)
export const zWorkspaceMembershipStatus = z.enum(WORKSPACE_MEMBERSHIP_STATUSES)
export const zWorkspaceInviteRole = z.enum(WORKSPACE_INVITE_ROLES)
export const zWorkspaceInviteStatus = z.enum(WORKSPACE_INVITE_STATUSES)
export const zPrincipalType = z.enum(PRINCIPAL_TYPES)
export const zIdentityProvider = z.enum(IDENTITY_PROVIDERS)
export const zRoadmapStatus = z.enum(ROADMAP_STATUSES)
export const zGoalStatus = z.enum(GOAL_STATUSES)
export const zGoalPriority = z.enum(GOAL_PRIORITIES)

// Container subtype vocabulary per mode (open set; these are the documented ones).
export const CONTAINER_SUBTYPES = [
  'SPRINT', 'EPIC', 'RELEASE',
  'MIGRATION_STAGE', 'MIGRATION_BATCH',
  'SALES_PIPELINE', 'SALES_STAGE',
  'CAMPAIGN', 'CAMPAIGN_WAVE', 'CHANNEL',
  'LAUNCH_PHASE',
  'OPS_PERIOD', 'OPS_PROCESS',
  'EXPANSION_INITIATIVE', 'EXPANSION_SITE',
]

export const ITEM_SUBTYPES = [
  'TASK', 'BUG',
  'DATASET', 'VALIDATION', 'RECONCILIATION',
  'ACCOUNT', 'DEAL', 'ACTIVITY',
  'CREATIVE', 'AUDIENCE', 'EXPERIMENT',
  'DELIVERABLE',
  'CHECKLIST_ITEM', 'ISSUE', 'SLA',
  'SETUP_ACTION', 'APPROVAL',
]

// @req FR-012 — PlanEnvelope accepts only the vocabulary belonging to the
// selected execution mode; the neutral database remains unchanged.
// @spec BR-004, BR-009 — seven canonical modes share one intake pipeline.
// @tested tests/unit/plan-schema.test.js
export const EXECUTION_MODE_CONTRACTS = Object.freeze({
  SOFTWARE_SPRINT: Object.freeze({
    progressStrategy: 'TASK_WEIGHT',
    containerSubtypes: Object.freeze(['SPRINT', 'EPIC', 'RELEASE']),
    itemSubtypes: Object.freeze(['TASK', 'BUG']),
    metricKeys: Object.freeze(['completedWeight', 'plannedWeight', 'defects']),
  }),
  DATA_MIGRATION: Object.freeze({
    progressStrategy: 'RECORD_VALIDATION',
    containerSubtypes: Object.freeze(['MIGRATION_STAGE', 'MIGRATION_BATCH']),
    itemSubtypes: Object.freeze(['DATASET', 'VALIDATION', 'RECONCILIATION']),
    metricKeys: Object.freeze(['recordsTotal', 'processed', 'success', 'failed', 'validated', 'reconciled']),
  }),
  B2B_SALES: Object.freeze({
    progressStrategy: 'WEIGHTED_PIPELINE',
    containerSubtypes: Object.freeze(['SALES_PIPELINE', 'SALES_STAGE']),
    itemSubtypes: Object.freeze(['ACCOUNT', 'DEAL', 'ACTIVITY']),
    metricKeys: Object.freeze(['target', 'wonRevenue', 'weightedValue']),
  }),
  B2C_CAMPAIGN: Object.freeze({
    progressStrategy: 'KPI_ATTAINMENT',
    containerSubtypes: Object.freeze(['CAMPAIGN', 'CAMPAIGN_WAVE', 'CHANNEL']),
    itemSubtypes: Object.freeze(['CREATIVE', 'AUDIENCE', 'EXPERIMENT']),
    metricKeys: Object.freeze(['spend', 'leads', 'cpa', 'cac', 'conversion', 'conversions', 'revenue', 'roas']),
  }),
  PRODUCT_LAUNCH: Object.freeze({
    progressStrategy: 'MILESTONE_READINESS',
    containerSubtypes: Object.freeze(['LAUNCH_PHASE']),
    itemSubtypes: Object.freeze(['DELIVERABLE']),
    metricKeys: Object.freeze(['readiness', 'blockedGates']),
  }),
  OPERATIONS: Object.freeze({
    progressStrategy: 'SLA_SCORE',
    containerSubtypes: Object.freeze(['OPS_PERIOD', 'OPS_PROCESS']),
    itemSubtypes: Object.freeze(['CHECKLIST_ITEM', 'ISSUE', 'SLA']),
    metricKeys: Object.freeze(['slaMet', 'slaTotal', 'throughput', 'backlog', 'incidents', 'completed']),
  }),
  BUSINESS_EXPANSION: Object.freeze({
    progressStrategy: 'EXPANSION_READINESS',
    containerSubtypes: Object.freeze(['EXPANSION_INITIATIVE', 'EXPANSION_SITE']),
    itemSubtypes: Object.freeze(['SETUP_ACTION', 'APPROVAL']),
    metricKeys: Object.freeze(['legal', 'location', 'budget', 'hiring', 'vendors', 'operationalReadiness', 'goLive']),
  }),
})

export const MODE_LABELS = {
  SOFTWARE_SPRINT: 'Software Sprint',
  DATA_MIGRATION: 'Data Migration',
  B2B_SALES: 'B2B Sales',
  B2C_CAMPAIGN: 'B2C Campaign',
  PRODUCT_LAUNCH: 'Product Launch',
  OPERATIONS: 'Operations',
  BUSINESS_EXPANSION: 'Business Expansion',
}

// Route slug <-> mode mapping for /execution/[mode] and project execution views.
export const MODE_SLUGS = {
  sprint: 'SOFTWARE_SPRINT',
  migration: 'DATA_MIGRATION',
  'b2b-sales': 'B2B_SALES',
  'b2c-campaign': 'B2C_CAMPAIGN',
  'product-launch': 'PRODUCT_LAUNCH',
  operations: 'OPERATIONS',
  expansion: 'BUSINESS_EXPANSION',
}

export const SLUG_BY_MODE = Object.fromEntries(
  Object.entries(MODE_SLUGS).map(([slug, mode]) => [mode, slug])
)

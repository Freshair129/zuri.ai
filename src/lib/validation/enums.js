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
export const WORKSTREAM_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'DONE', 'ARCHIVED']
export const WORK_STATUSES = ['PLANNED', 'READY', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE', 'CANCELLED']
export const MILESTONE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'DONE', 'MISSED']
export const GATE_STATUSES = ['OPEN', 'PASSED', 'BLOCKED', 'WAIVED']
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
export const zWorkstreamStatus = z.enum(WORKSTREAM_STATUSES)
export const zWorkStatus = z.enum(WORK_STATUSES)
export const zMilestoneStatus = z.enum(MILESTONE_STATUSES)
export const zGateStatus = z.enum(GATE_STATUSES)
export const zWorkspaceScopeType = z.enum(WORKSPACE_SCOPE_TYPES)
export const zMembershipRole = z.enum(MEMBERSHIP_ROLES)
export const zChannel = z.enum(CHANNELS)
export const zMessageDirection = z.enum(MESSAGE_DIRECTIONS)
export const zCustomerLifecycle = z.enum(CUSTOMER_LIFECYCLE)
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

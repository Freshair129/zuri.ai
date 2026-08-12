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

// FR-023 — CRM slice (ADR-007 P2)
export const CHANNELS = ['LINE', 'FACEBOOK', 'WEB']
export const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND']
export const CUSTOMER_LIFECYCLE = ['LEAD', 'ACTIVE', 'DORMANT', 'LOST']

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
export const zChannel = z.enum(CHANNELS)
export const zMessageDirection = z.enum(MESSAGE_DIRECTIONS)
export const zCustomerLifecycle = z.enum(CUSTOMER_LIFECYCLE)

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

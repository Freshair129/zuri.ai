// @req FR-285 — the only v1 Business template is a snapshot of the existing
// five-role registry. Registry metadata is not an authorization grant.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { CORE_AGENT_ROLES, ROLE_SPECIFICATIONS } from './role-registry'

export const BUSINESS_AGENT_SCHEMA_VERSION = 'business-agent-config/v1'
export const BUSINESS_AGENT_TEMPLATE_ID = 'standard-business-agent'
export const BUSINESS_AGENT_TEMPLATE_VERSION = 1
export const BUSINESS_AGENT_CONFIG_VERSION = 1
export const BUSINESS_AGENT_DELEGATION_POLICY = 'DENY'

export const BUSINESS_AGENT_ROLE_IDS = Object.freeze([
  CORE_AGENT_ROLES.EXECUTIVE,
  CORE_AGENT_ROLES.OPERATIONS,
  CORE_AGENT_ROLES.FINANCE_ANALYST,
  CORE_AGENT_ROLES.RESEARCH,
  CORE_AGENT_ROLES.MARKETING,
])

const policySchema = z.object({
  approvalTier: z.enum(['L1', 'L2', 'L3', 'L4']),
  scopeAccess: z.string().min(1),
  memoryNamespace: z.string().min(1),
  canIssueDirectives: z.boolean(),
  maxAutonomousActionSensitivity: z.enum(['HIGH', 'LOW', 'READ_ONLY']),
}).strict()

function snapshotError(status, code) {
  const error = new Error(code)
  error.status = status
  error.code = code
  return error
}

const roleSchema = z.object({
  roleId: z.enum(BUSINESS_AGENT_ROLE_IDS),
  allowedTools: z.array(z.string().min(1)).min(1),
  policy: policySchema,
}).strict()

export const businessAgentSnapshotSchema = z.object({
  schemaVersion: z.string().min(1),
  templateId: z.string().min(1),
  templateVersion: z.number().int().positive(),
  configVersion: z.number().int().positive(),
  delegationPolicy: z.literal(BUSINESS_AGENT_DELEGATION_POLICY),
  scope: z.object({ tenantId: z.string().min(1), businessId: z.string().min(1) }).strict(),
  roles: z.array(roleSchema).length(BUSINESS_AGENT_ROLE_IDS.length),
}).strict()

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function businessAgentSnapshotDigest(snapshot) {
  return createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex')
}

export function buildBusinessAgentTemplate({ tenantId, businessId }) {
  if (typeof tenantId !== 'string' || !tenantId.trim() || typeof businessId !== 'string' || !businessId.trim()) {
    throw new TypeError('BUSINESS_AGENT_SCOPE_REQUIRED')
  }
  const snapshot = {
    schemaVersion: BUSINESS_AGENT_SCHEMA_VERSION,
    templateId: BUSINESS_AGENT_TEMPLATE_ID,
    templateVersion: BUSINESS_AGENT_TEMPLATE_VERSION,
    configVersion: BUSINESS_AGENT_CONFIG_VERSION,
    delegationPolicy: BUSINESS_AGENT_DELEGATION_POLICY,
    scope: { tenantId, businessId },
    roles: BUSINESS_AGENT_ROLE_IDS.map((roleId) => {
      const role = ROLE_SPECIFICATIONS[roleId]
      return { roleId, allowedTools: [...role.allowedTools], policy: { ...role.policy } }
    }),
  }
  return businessAgentSnapshotSchema.parse(snapshot)
}

/** Parse and verify a persisted row without ever resolving registry defaults. */
export function validateStoredBusinessAgentConfig(row, { tenantId, businessId }) {
  if (typeof row?.appliedByPersonId !== 'string' || !row.appliedByPersonId ||
      !Number.isInteger(row.version) || row.version < 1 ||
      !(row.appliedAt instanceof Date) || Number.isNaN(row.appliedAt.getTime()) ||
      !(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime()) ||
      !(row.updatedAt instanceof Date) || Number.isNaN(row.updatedAt.getTime())) {
    throw snapshotError(500, 'BUSINESS_AGENT_CONFIG_CORRUPT')
  }
  let snapshot
  try {
    snapshot = businessAgentSnapshotSchema.parse(JSON.parse(row.snapshotJson))
  } catch {
    throw snapshotError(500, 'BUSINESS_AGENT_CONFIG_CORRUPT')
  }

  const headerMatches = row.tenantId === tenantId && row.businessId === businessId &&
    snapshot.scope.tenantId === tenantId && snapshot.scope.businessId === businessId &&
    row.schemaVersion === snapshot.schemaVersion && row.templateId === snapshot.templateId &&
    row.templateVersion === snapshot.templateVersion && row.version === snapshot.configVersion &&
    row.delegationPolicy === snapshot.delegationPolicy
  if (!headerMatches || businessAgentSnapshotDigest(snapshot) !== row.snapshotDigest) {
    throw snapshotError(500, 'BUSINESS_AGENT_CONFIG_CORRUPT')
  }

  if (snapshot.schemaVersion !== BUSINESS_AGENT_SCHEMA_VERSION ||
      snapshot.templateId !== BUSINESS_AGENT_TEMPLATE_ID ||
      snapshot.templateVersion !== BUSINESS_AGENT_TEMPLATE_VERSION ||
      snapshot.configVersion !== BUSINESS_AGENT_CONFIG_VERSION) {
    throw snapshotError(409, 'BUSINESS_AGENT_CONFIG_VERSION_CONFLICT')
  }

  const expected = buildBusinessAgentTemplate({ tenantId, businessId })
  if (canonicalJson(snapshot) !== canonicalJson(expected)) {
    // A checksum proves consistency, not approval. v1 accepts the exact five
    // registry snapshots, so edited tools or policy fail closed.
    throw snapshotError(500, 'BUSINESS_AGENT_CONFIG_CORRUPT')
  }
  return snapshot
}

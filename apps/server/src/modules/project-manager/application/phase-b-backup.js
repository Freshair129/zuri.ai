// @req FR-252 — protected Phase B snapshot validation and clean-target guard.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/unit/phase-b-backup.test.js, tests/integration/phase-b-recovery.test.js

import { createHash } from 'node:crypto'
import { WORK_STATUSES } from '../../../lib/validation/enums.js'

export const PHASE_B_RECOVERY_MANIFEST_VERSION = 'phase-b-recovery.v1'

export const PHASE_B_FAMILY_DELEGATES = Object.freeze([
  'governanceSnapshot',
  'projectFeature',
  'featureContribution',
  'featureWorkLink',
  'requirementBinding',
  'projectFeatureMutationReceipt',
])

export const PHASE_B_FAMILY_MODEL_NAMES = Object.freeze([
  'GovernanceSnapshot',
  'ProjectFeature',
  'FeatureContribution',
  'FeatureWorkLink',
  'RequirementBinding',
  'ProjectFeatureMutationReceipt',
])

export const PHASE_B_ERROR_CODES = Object.freeze({
  TARGET_CONNECTION_UNAVAILABLE: 'TARGET_CONNECTION_UNAVAILABLE',
  SNAPSHOT_DIGEST_MISMATCH: 'SNAPSHOT_DIGEST_MISMATCH',
  SNAPSHOT_INCOMPLETE: 'PHASE_B_SNAPSHOT_INCOMPLETE',
  SNAPSHOT_INVALID: 'PHASE_B_SNAPSHOT_INVALID',
  SCOPE_INVALID: 'PHASE_B_SCOPE_INVALID',
  RECEIPT_INVALID: 'PHASE_B_RECEIPT_INVALID',
  TARGET_SCHEMA_UNVERIFIED: 'TARGET_SCHEMA_UNVERIFIED',
  TARGET_EMPTY_UNVERIFIED: 'TARGET_EMPTY_UNVERIFIED',
  TARGET_NOT_EMPTY: 'TARGET_NOT_EMPTY',
  TARGET_PRIVILEGE_UNAVAILABLE: 'TARGET_PRIVILEGE_UNAVAILABLE',
  TARGET_LOCK_UNAVAILABLE: 'TARGET_LOCK_UNAVAILABLE',
  EXPORT_COMPLETENESS_UNAVAILABLE: 'PHASE_B_EXPORT_COMPLETENESS_UNAVAILABLE',
  RECOVERY_MAINTENANCE_REQUIRED: 'PHASE_B_RECOVERY_MAINTENANCE_REQUIRED',
  WRITE_ROLLED_BACK: 'PHASE_B_WRITE_ROLLED_BACK',
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/
const SOURCE_PATH = /^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))(?!.*\\).{1,512}$/

const FAMILY_FIELDS = Object.freeze({
  governanceSnapshot: {
    required: [
      'id', 'tenantId', 'businessId', 'createdAt', 'repositoryId', 'projectRepositoryId',
      'checkoutBindingId', 'commitSha', 'manifestHash', 'capturedAt', 'verifiedAt',
      'verifierId', 'verifierVersion', 'proofId', 'verificationProof', 'validationStatus',
      'sourceManifest',
    ],
    optional: [],
  },
  projectFeature: {
    required: [
      'id', 'tenantId', 'businessId', 'projectId', 'code', 'title', 'problem', 'outcome',
      'primaryDomainId', 'canonicalFeatureKey', 'governanceSnapshotId', 'lifecycle',
      'createdAt', 'updatedAt', 'version', 'deletedAt', 'deleteBatchId',
    ],
    optional: [],
  },
  featureContribution: {
    required: [
      'id', 'tenantId', 'businessId', 'featureId', 'domainId', 'responsibility',
      'createdAt', 'updatedAt', 'version', 'deletedAt', 'deleteBatchId',
    ],
    optional: [],
  },
  featureWorkLink: {
    required: [
      'id', 'tenantId', 'businessId', 'featureId', 'workItemId', 'allocationBps',
      'createdAt', 'updatedAt', 'version', 'deletedAt', 'deleteBatchId',
    ],
    optional: [],
  },
  requirementBinding: {
    required: [
      'id', 'tenantId', 'businessId', 'featureId', 'governanceSnapshotId', 'sourceNamespace',
      'requirementKey', 'revisionHash', 'acceptanceRef', 'createdAt', 'updatedAt', 'version',
      'deletedAt', 'deleteBatchId',
    ],
    optional: [],
  },
  projectFeatureMutationReceipt: {
    required: [
      'id', 'tenantId', 'businessId', 'projectId', 'featureId', 'targetId', 'targetType',
      'httpMethod', 'principalId', 'operation', 'idempotencyKey', 'payloadHash', 'resourceId',
      'resourceType', 'version', 'etag', 'auditEventId', 'status', 'createdAt',
    ],
    optional: [],
  },
})

const RECORD_TYPES = Object.freeze({
  governanceSnapshot: 'GovernanceSnapshot',
  projectFeature: 'ProjectFeature',
  featureContribution: 'FeatureContribution',
  featureWorkLink: 'FeatureWorkLink',
  requirementBinding: 'RequirementBinding',
  projectFeatureMutationReceipt: 'ProjectFeatureMutationReceipt',
})

const RECEIPT_OPERATIONS = Object.freeze({
  CREATE_FEATURE: { targetType: 'PROJECT', httpMethod: 'POST', resourceType: 'PROJECT_FEATURE', version: 'required' },
  UPDATE_FEATURE: { targetType: 'FEATURE', httpMethod: 'PATCH', resourceType: 'PROJECT_FEATURE', version: 'required' },
  REPLACE_CONTRIBUTIONS: { targetType: 'FEATURE', httpMethod: 'PUT', resourceType: 'PROJECT_FEATURE', version: 'required' },
  REPLACE_WORK_LINKS: { targetType: 'FEATURE', httpMethod: 'PUT', resourceType: 'PROJECT_FEATURE', version: 'required' },
  REPLACE_FEATURE_WORK_GRAPH: { targetType: 'PROJECT', httpMethod: 'PUT', resourceType: 'PROJECT_FEATURE_GRAPH', version: 'null' },
  REPLACE_REQUIREMENT_BINDINGS: { targetType: 'FEATURE', httpMethod: 'PUT', resourceType: 'PROJECT_FEATURE', version: 'required' },
  DELETE_FEATURE: { targetType: 'FEATURE', httpMethod: 'DELETE', resourceType: 'PROJECT_FEATURE', version: 'required' },
  RESTORE_FEATURE: { targetType: 'FEATURE', httpMethod: 'POST', resourceType: 'PROJECT_FEATURE', version: 'required' },
  CAPTURE_GOVERNANCE_SNAPSHOT: { targetType: 'PROJECT', httpMethod: 'POST', resourceType: 'GOVERNANCE_SNAPSHOT', version: 'null' },
})

const RECOVERABLE_WORK_STATUSES = new Set(WORK_STATUSES.filter((status) => status !== 'CANCELLED'))
const GENERIC_PARENT_MODELS = Object.freeze([
  'Tenant', 'Business', 'Workspace', 'Project', 'Repository', 'ProjectRepository', 'Workstream', 'WorkItem', 'AuditEvent',
])
const UUID_FIELDS = new Set([
  'id', 'tenantId', 'businessId', 'projectId', 'repositoryId', 'projectRepositoryId', 'proofId',
  'featureId', 'workItemId', 'governanceSnapshotId', 'deleteBatchId', 'principalId', 'targetId',
  'resourceId', 'auditEventId',
])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function ordinalCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value)
}

function isSha256(value) {
  return typeof value === 'string' && SHA256.test(value)
}

function isCommitSha(value) {
  return typeof value === 'string' && COMMIT_SHA.test(value)
}

function validDate(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(new Date(value).getTime())
}

function sameInstant(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  if (validDate(left) && validDate(right)) return new Date(left).getTime() === new Date(right).getTime()
  return left === right
}

function stringInRange(value, min, max) {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function positiveInt(value) {
  return Number.isInteger(value) && value >= 1
}

function jsonObject(value) {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function jsonByteLength(value) {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  return Buffer.byteLength(canonicalJson(value), 'utf8')
}

function issue(issues, code, message, family = null, index = null) {
  issues.push({ code, message, family, index })
}

function messageList(issues) {
  return issues.map(({ message }) => message)
}

function tableContainer(snapshot) {
  return isRecord(snapshot) && isRecord(snapshot.tables) ? snapshot.tables : null
}

function familyRows(snapshot, delegate) {
  const tables = tableContainer(snapshot)
  if (!tables) return { state: 'UNAVAILABLE', rows: null }
  const modelName = RECORD_TYPES[delegate]
  const hasDelegate = own(tables, delegate)
  const hasModel = own(tables, modelName)
  if (hasDelegate && hasModel) return { state: 'UNAVAILABLE', rows: null, reason: 'duplicate family key' }
  if (!hasDelegate && !hasModel) return { state: 'MISSING', rows: null }
  const rows = tables[hasDelegate ? delegate : modelName]
  if (!Array.isArray(rows)) return { state: 'UNAVAILABLE', rows: null, reason: 'family is not an array' }
  return { state: rows.length === 0 ? 'PRESENT_EMPTY' : 'PRESENT_NONEMPTY', rows }
}

function familyStateResult(snapshot) {
  return Object.fromEntries(PHASE_B_FAMILY_DELEGATES.map((delegate) => {
    const family = familyRows(snapshot, delegate)
    return [delegate, { state: family.state, count: family.rows?.length ?? 0 }]
  }))
}

function rowTables(snapshot) {
  const tables = tableContainer(snapshot) || {}
  const read = (name) => Array.isArray(tables[name]) ? tables[name] : []
  const model = (name, delegate) => {
    if (Array.isArray(tables[name])) return tables[name]
    return Array.isArray(tables[delegate]) ? tables[delegate] : []
  }
  return {
    Tenant: read('tenant'),
    Business: read('business'),
    Workspace: read('workspace'),
    Project: read('project'),
    Repository: read('repository'),
    ProjectRepository: read('projectRepository'),
    Workstream: read('workstream'),
    WorkItem: read('workItem'),
    AuditEvent: read('auditEvent'),
    GovernanceSnapshot: model('GovernanceSnapshot', 'governanceSnapshot'),
    ProjectFeature: model('ProjectFeature', 'projectFeature'),
    FeatureContribution: model('FeatureContribution', 'featureContribution'),
    FeatureWorkLink: model('FeatureWorkLink', 'featureWorkLink'),
    RequirementBinding: model('RequirementBinding', 'requirementBinding'),
    ProjectFeatureMutationReceipt: model('ProjectFeatureMutationReceipt', 'projectFeatureMutationReceipt'),
  }
}

function indexById(rows) {
  const map = new Map()
  for (const row of rows) if (isRecord(row) && typeof row.id === 'string') map.set(row.id, row)
  return map
}

function checkExactFields(row, fields, issues, family, index) {
  if (!isRecord(row)) {
    issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `${family}[${index}] must be an object`, family, index)
    return false
  }
  const allowed = new Set([...(fields.required || []), ...(fields.optional || [])])
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `${family}[${index}] has unexpected field ${key}`, family, index)
  }
  for (const key of fields.required || []) {
    if (!own(row, key)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `${family}[${index}] is missing ${key}`, family, index)
  }
  return true
}

function checkUuidFields(row, issues, family, index) {
  for (const key of UUID_FIELDS) {
    if (!own(row, key) || row[key] === null) continue
    if (key === 'deleteBatchId' && row[key] === null) continue
    if (!isUuid(row[key])) issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `${family}[${index}].${key} is not a UUID`, family, index)
  }
}

function checkTombstone(row, issues, family, index) {
  const deleted = row.deletedAt
  const batch = row.deleteBatchId
  if (deleted !== null && !validDate(deleted)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `${family}[${index}].deletedAt is invalid`, family, index)
  if (deleted === null && batch !== null) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `${family}[${index}] has a delete batch without a tombstone`, family, index)
  if (deleted !== null && !isUuid(batch)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `${family}[${index}] tombstone has no valid delete batch`, family, index)
}

function scopeForProject(projectId, maps) {
  const project = maps.Project.get(projectId)
  if (!project) return null
  const workspace = maps.Workspace.get(project.workspaceId)
  if (!workspace) return null
  const businessId = project.businessId || workspace.businessId
  const business = maps.Business.get(businessId)
  const tenant = business ? maps.Tenant.get(business.tenantId) : null
  if (!business || !tenant) return null
  return { project, workspace, business, tenant, tenantId: business.tenantId, businessId }
}

function scopeForFeature(featureId, maps) {
  const feature = maps.ProjectFeature.get(featureId)
  if (!feature) return null
  const scope = scopeForProject(feature.projectId, maps)
  if (!scope) return null
  return { ...scope, feature }
}

function checkScope(row, scope, issues, family, index) {
  if (!scope || row.tenantId !== scope.tenantId || row.businessId !== scope.businessId) {
    issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `${family}[${index}] is outside its trusted parent scope`, family, index)
    return false
  }
  return true
}

function parseManifest(value) {
  const parsed = jsonObject(value)
  if (!parsed || !stringInRange(parsed.schemaVersion, 1, 32) || !Array.isArray(parsed.entries) || parsed.entries.length > 1000) return null
  for (const entry of parsed.entries) {
    if (!isRecord(entry) || !stringInRange(entry.path, 1, 512) || !SOURCE_PATH.test(entry.path) || !isSha256(entry.sha256)) return null
    if (Object.keys(entry).some((key) => !['path', 'sha256'].includes(key))) return null
  }
  if (Object.keys(parsed).some((key) => !['schemaVersion', 'entries'].includes(key))) return null
  return parsed
}

function parseProof(value) {
  const parsed = jsonObject(value)
  if (!parsed) return null
  const required = [
    'proofId', 'verifierId', 'verifierVersion', 'verifiedAt', 'projectId', 'projectRepositoryId',
    'checkoutBindingId', 'repositoryId', 'commitSha', 'manifestHash', 'outcome',
  ]
  if (required.some((key) => !own(parsed, key)) || Object.keys(parsed).some((key) => !required.includes(key))) return null
  if (!isUuid(parsed.proofId) || !stringInRange(parsed.verifierId, 1, 128)
    || !stringInRange(parsed.verifierVersion, 1, 64) || !validDate(parsed.verifiedAt)
    || !isUuid(parsed.projectId) || !isUuid(parsed.projectRepositoryId)
    || !stringInRange(parsed.checkoutBindingId, 1, 256) || !isUuid(parsed.repositoryId)
    || !isCommitSha(parsed.commitSha) || !isSha256(parsed.manifestHash) || parsed.outcome !== 'VALID') return null
  return parsed
}

function validateInventory(inventory, issues) {
  if (!isRecord(inventory) || !isSha256(inventory.schemaSha256) || !Array.isArray(inventory.applicationTables)) {
    issue(issues, PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen application table inventory is unavailable')
    return null
  }
  const tables = []
  const seen = new Set()
  const migrationTables = Array.isArray(inventory.migrationTables) ? [...new Set(inventory.migrationTables)] : []
  if (migrationTables.some((name) => name !== '_prisma_migrations' && name !== 'schema_migrations')) {
    issue(issues, PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen inventory contains an unapproved migration table')
  }
  if (inventory.excludedTables !== undefined) issue(issues, PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen inventory cannot add an excluded application table')
  for (const entry of inventory.applicationTables) {
    if (!isRecord(entry) || !stringInRange(entry.modelName, 1, 128)
      || !stringInRange(entry.schemaName, 1, 128) || !stringInRange(entry.tableName, 1, 128)
      || !SAFE_IDENTIFIER.test(entry.schemaName) || !SAFE_IDENTIFIER.test(entry.tableName)
      || !SAFE_IDENTIFIER.test(entry.modelName)) {
      issue(issues, PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen application table inventory contains an invalid entry')
      continue
    }
    const key = `${entry.modelName}\u0000${entry.schemaName}\u0000${entry.tableName}`
    if (seen.has(key)) issue(issues, PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen application table inventory contains a duplicate entry')
    seen.add(key)
    tables.push({ modelName: entry.modelName, schemaName: entry.schemaName, tableName: entry.tableName })
  }
  tables.sort((a, b) => ordinalCompare(a.modelName, b.modelName) || ordinalCompare(a.schemaName, b.schemaName) || ordinalCompare(a.tableName, b.tableName))
  const normalized = { schemaSha256: inventory.schemaSha256, applicationTables: tables }
  const targetSchemaSha256 = computeTargetSchemaSha256(normalized)
  if (inventory.targetSchemaSha256 !== undefined && inventory.targetSchemaSha256 !== targetSchemaSha256) {
    issue(issues, PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen application table inventory hash does not match its entries')
  }
  return {
    ...normalized,
    targetSchemaSha256,
    migrationTables: migrationTables.filter((name) => name === '_prisma_migrations' || name === 'schema_migrations'),
  }
}

function validateGenericParentTables(tables, issues) {
  const maps = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, indexById(rows)]))
  const referenced = Object.fromEntries(GENERIC_PARENT_MODELS.map((name) => [name, new Set()]))
  const queue = []
  const addReference = (name, id) => {
    if (!referenced[name] || typeof id !== 'string' || referenced[name].has(id)) return
    referenced[name].add(id)
    queue.push([name, id])
  }
  const seedRows = (name, rows, fields) => {
    for (const row of rows) {
      if (!isRecord(row)) continue
      for (const field of fields) addReference(name, row[field])
    }
  }

  for (const row of tables.GovernanceSnapshot) {
    if (!isRecord(row)) continue
    seedRows('Tenant', [row], ['tenantId'])
    seedRows('Business', [row], ['businessId'])
    seedRows('Repository', [row], ['repositoryId'])
    seedRows('ProjectRepository', [row], ['projectRepositoryId'])
    if (isRecord(row.verificationProof)) seedRows('Project', [row.verificationProof], ['projectId'])
  }
  seedRows('Tenant', tables.ProjectFeature, ['tenantId'])
  seedRows('Business', tables.ProjectFeature, ['businessId'])
  seedRows('Project', tables.ProjectFeature, ['projectId'])
  seedRows('Tenant', tables.FeatureContribution, ['tenantId'])
  seedRows('Business', tables.FeatureContribution, ['businessId'])
  seedRows('Tenant', tables.FeatureWorkLink, ['tenantId'])
  seedRows('Business', tables.FeatureWorkLink, ['businessId'])
  seedRows('WorkItem', tables.FeatureWorkLink, ['workItemId'])
  seedRows('Tenant', tables.RequirementBinding, ['tenantId'])
  seedRows('Business', tables.RequirementBinding, ['businessId'])
  seedRows('Tenant', tables.ProjectFeatureMutationReceipt, ['tenantId'])
  seedRows('Business', tables.ProjectFeatureMutationReceipt, ['businessId'])
  seedRows('Project', tables.ProjectFeatureMutationReceipt, ['projectId'])
  seedRows('AuditEvent', tables.ProjectFeatureMutationReceipt, ['auditEventId'])

  while (queue.length > 0) {
    const [name, id] = queue.shift()
    const row = maps[name].get(id)
    if (!row) continue
    if (name === 'Business') addReference('Tenant', row.tenantId)
    if (name === 'Workspace') {
      addReference('Tenant', row.tenantId)
      addReference('Business', row.businessId)
    }
    if (name === 'Project') {
      addReference('Workspace', row.workspaceId)
      addReference('Business', row.businessId)
    }
    if (name === 'Repository') addReference('Business', row.businessId)
    if (name === 'ProjectRepository') {
      addReference('Project', row.projectId)
      addReference('Repository', row.repoId ?? row.repositoryId)
    }
    if (name === 'Workstream') addReference('Project', row.projectId)
    if (name === 'WorkItem') addReference('Workstream', row.workstreamId)
    if (name === 'AuditEvent') {
      addReference('Tenant', row.tenantId)
      addReference('Business', row.businessId)
    }
  }

  for (const [name, rows] of Object.entries(tables)) {
    if (!referenced[name]) continue
    for (const [index, row] of rows.entries()) {
      if (!isRecord(row) || !referenced[name].has(row.id)) continue
      if (!isUuid(row.id)) issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `${name}[${index}] has no valid id`, name, index)
    }
  }
  return maps
}

function validateGovernance(rows, maps, issues) {
  const seen = new Set()
  for (const [index, row] of rows.entries()) {
    if (!checkExactFields(row, FAMILY_FIELDS.governanceSnapshot, issues, 'governanceSnapshot', index)) continue
    checkUuidFields(row, issues, 'governanceSnapshot', index)
    if (!validDate(row.createdAt) || !validDate(row.capturedAt) || !validDate(row.verifiedAt)
      || !stringInRange(row.checkoutBindingId, 1, 256) || !isCommitSha(row.commitSha)
      || !isSha256(row.manifestHash) || !stringInRange(row.verifierId, 1, 128)
      || !stringInRange(row.verifierVersion, 1, 64) || row.validationStatus !== 'VALID'
      || !parseManifest(row.sourceManifest)) {
      issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `governanceSnapshot[${index}] has invalid verified evidence`, 'governanceSnapshot', index)
    }
    if (jsonByteLength(row.sourceManifest) > 1048576) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `governanceSnapshot[${index}] sourceManifest exceeds 1 MiB`, 'governanceSnapshot', index)
    const proof = parseProof(row.verificationProof)
    if (!proof || proof.proofId !== row.proofId || proof.verifierId !== row.verifierId
      || proof.verifierVersion !== row.verifierVersion || !sameInstant(proof.verifiedAt, row.verifiedAt)
      || proof.projectRepositoryId !== row.projectRepositoryId || proof.repositoryId !== row.repositoryId
      || proof.checkoutBindingId !== row.checkoutBindingId || proof.commitSha !== row.commitSha
      || proof.manifestHash !== row.manifestHash) {
      issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `governanceSnapshot[${index}] proof does not bind the row`, 'governanceSnapshot', index)
    }
    const business = maps.Business.get(row.businessId)
    const tenant = maps.Tenant.get(row.tenantId)
    const repo = maps.Repository.get(row.repositoryId)
    const projectRepo = maps.ProjectRepository.get(row.projectRepositoryId)
    const project = projectRepo ? maps.Project.get(projectRepo.projectId) : null
    if (!business || !tenant || business.tenantId !== row.tenantId || !repo || repo.businessId !== row.businessId
      || (repo.status !== undefined && repo.status !== 'ACTIVE') || !projectRepo || !project
      || (projectRepo.repoId ?? projectRepo.repositoryId) !== row.repositoryId
      || proof?.projectId !== project.id || proof?.checkoutBindingId !== row.checkoutBindingId
      || scopeForProject(project.id, maps)?.businessId !== row.businessId) {
      issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `governanceSnapshot[${index}] has an invalid ProjectRepository scope`, 'governanceSnapshot', index)
    }
    const key = `${row.businessId}\u0000${row.repositoryId}\u0000${row.commitSha}\u0000${row.manifestHash}`
    if (seen.has(key)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `governanceSnapshot[${index}] duplicates its immutable evidence key`, 'governanceSnapshot', index)
    seen.add(key)
  }
}

function validateFeature(rows, maps, issues) {
  const seen = new Set()
  const activeCounts = new Map()
  for (const [index, row] of rows.entries()) {
    if (!checkExactFields(row, FAMILY_FIELDS.projectFeature, issues, 'projectFeature', index)) continue
    checkUuidFields(row, issues, 'projectFeature', index)
    if (!stringInRange(row.code, 1, 128) || !stringInRange(row.title, 1, 500)
      || !stringInRange(row.problem, 1, 5000) || !stringInRange(row.outcome, 1, 5000)
      || !stringInRange(row.primaryDomainId, 1, 128) || !['DRAFT', 'ACTIVE', 'RETIRED'].includes(row.lifecycle)
      || !validDate(row.createdAt) || !validDate(row.updatedAt) || !positiveInt(row.version)) {
      issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `projectFeature[${index}] has invalid fields`, 'projectFeature', index)
    }
    checkTombstone(row, issues, 'projectFeature', index)
    const scope = scopeForProject(row.projectId, maps)
    if (!checkScope(row, scope, issues, 'projectFeature', index)) continue
    const pairPresent = row.canonicalFeatureKey !== null || row.governanceSnapshotId !== null
    if (pairPresent && (!stringInRange(row.canonicalFeatureKey, 1, 200) || !isUuid(row.governanceSnapshotId))) {
      issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `projectFeature[${index}] has an incomplete canonical evidence pair`, 'projectFeature', index)
    }
    if (!pairPresent && (row.canonicalFeatureKey !== null || row.governanceSnapshotId !== null)) {
      issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `projectFeature[${index}] has an invalid unavailable evidence pair`, 'projectFeature', index)
    }
    if (row.governanceSnapshotId !== null) {
      const snapshot = maps.GovernanceSnapshot.get(row.governanceSnapshotId)
      const proof = snapshot && parseProof(snapshot.verificationProof)
      if (!snapshot || snapshot.validationStatus !== 'VALID' || snapshot.businessId !== row.businessId
        || snapshot.tenantId !== row.tenantId || !proof || proof.projectId !== row.projectId) {
        issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `projectFeature[${index}] references an out-of-scope snapshot`, 'projectFeature', index)
      }
    }
    const key = `${row.projectId}\u0000${row.code}`
    if (seen.has(key)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `projectFeature[${index}] duplicates project/code`, 'projectFeature', index)
    seen.add(key)
    if (row.deletedAt === null) activeCounts.set(row.projectId, (activeCounts.get(row.projectId) || 0) + 1)
  }
  for (const [projectId, count] of activeCounts.entries()) if (count > 200) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `project ${projectId} exceeds the 200 active feature bound`, 'projectFeature')
}

function validateContribution(rows, maps, issues) {
  const seen = new Set()
  const counts = new Map()
  for (const [index, row] of rows.entries()) {
    if (!checkExactFields(row, FAMILY_FIELDS.featureContribution, issues, 'featureContribution', index)) continue
    checkUuidFields(row, issues, 'featureContribution', index)
    if (!stringInRange(row.domainId, 1, 128) || !stringInRange(row.responsibility, 1, 2000)
      || !validDate(row.createdAt) || !validDate(row.updatedAt) || !positiveInt(row.version)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `featureContribution[${index}] has invalid fields`, 'featureContribution', index)
    checkTombstone(row, issues, 'featureContribution', index)
    const scope = scopeForFeature(row.featureId, maps)
    if (!checkScope(row, scope, issues, 'featureContribution', index)) continue
    if (row.domainId === scope.feature.primaryDomainId) issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `featureContribution[${index}] duplicates its primary domain`, 'featureContribution', index)
    const key = `${row.featureId}\u0000${row.domainId}`
    if (seen.has(key)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `featureContribution[${index}] duplicates feature/domain`, 'featureContribution', index)
    seen.add(key)
    if (row.deletedAt === null && scope.feature.deletedAt === null) counts.set(row.featureId, (counts.get(row.featureId) || 0) + 1)
  }
  for (const [featureId, count] of counts.entries()) if (count > 200) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `feature ${featureId} exceeds the 200 contribution bound`, 'featureContribution')
}

function workItemScope(workItemId, maps) {
  const workItem = maps.WorkItem.get(workItemId)
  if (!workItem) return null
  const workstream = maps.Workstream.get(workItem.workstreamId)
  if (!workstream) return null
  const scope = scopeForProject(workstream.projectId, maps)
  return scope ? { ...scope, workItem, workstream, active: workItem.deletedAt === null && (workItem.status === undefined || RECOVERABLE_WORK_STATUSES.has(workItem.status)) } : null
}

function validateWorkLink(rows, maps, issues) {
  const seen = new Set()
  const counts = new Map()
  const allocation = new Map()
  for (const [index, row] of rows.entries()) {
    if (!checkExactFields(row, FAMILY_FIELDS.featureWorkLink, issues, 'featureWorkLink', index)) continue
    checkUuidFields(row, issues, 'featureWorkLink', index)
    if ((row.allocationBps !== null && (!Number.isInteger(row.allocationBps) || row.allocationBps < 0 || row.allocationBps > 10000))
      || !validDate(row.createdAt) || !validDate(row.updatedAt) || !positiveInt(row.version)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `featureWorkLink[${index}] has invalid fields`, 'featureWorkLink', index)
    checkTombstone(row, issues, 'featureWorkLink', index)
    const featureScope = scopeForFeature(row.featureId, maps)
    const workScope = workItemScope(row.workItemId, maps)
    if (!checkScope(row, featureScope, issues, 'featureWorkLink', index) || !workScope
      || workScope.project.id !== featureScope?.project.id || workScope.businessId !== featureScope?.businessId
      || workScope.tenantId !== featureScope?.tenantId) issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `featureWorkLink[${index}] crosses Project scope or has an unavailable parent`, 'featureWorkLink', index)
    const key = `${row.featureId}\u0000${row.workItemId}`
    if (seen.has(key)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `featureWorkLink[${index}] duplicates feature/work item`, 'featureWorkLink', index)
    seen.add(key)
    if (row.deletedAt === null && featureScope?.feature?.deletedAt === null && workScope?.active) {
      counts.set(row.featureId, (counts.get(row.featureId) || 0) + 1)
      const current = allocation.get(row.workItemId) || { total: 0, missing: false }
      current.missing ||= row.allocationBps === null
      current.total += row.allocationBps ?? 0
      allocation.set(row.workItemId, current)
    }
  }
  for (const [featureId, count] of counts.entries()) if (count > 200) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `feature ${featureId} exceeds the 200 work-link bound`, 'featureWorkLink')
  for (const [workItemId, value] of allocation.entries()) if (value.total > 10000) issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `work item ${workItemId} allocation exceeds 10000 bps`, 'featureWorkLink')
}

function validateBinding(rows, maps, issues) {
  const seen = new Set()
  const counts = new Map()
  for (const [index, row] of rows.entries()) {
    if (!checkExactFields(row, FAMILY_FIELDS.requirementBinding, issues, 'requirementBinding', index)) continue
    checkUuidFields(row, issues, 'requirementBinding', index)
    if (!stringInRange(row.sourceNamespace, 1, 128) || !stringInRange(row.requirementKey, 1, 128)
      || !isSha256(row.revisionHash) || !stringInRange(row.acceptanceRef, 1, 1000)
      || !validDate(row.createdAt) || !validDate(row.updatedAt) || !positiveInt(row.version)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `requirementBinding[${index}] has invalid fields`, 'requirementBinding', index)
    checkTombstone(row, issues, 'requirementBinding', index)
    const featureScope = scopeForFeature(row.featureId, maps)
    const snapshot = maps.GovernanceSnapshot.get(row.governanceSnapshotId)
    if (!checkScope(row, featureScope, issues, 'requirementBinding', index) || !snapshot
      || snapshot.validationStatus !== 'VALID' || snapshot.tenantId !== row.tenantId || snapshot.businessId !== row.businessId) issue(issues, PHASE_B_ERROR_CODES.SCOPE_INVALID, `requirementBinding[${index}] references an invalid snapshot scope`, 'requirementBinding', index)
    const key = `${row.featureId}\u0000${row.governanceSnapshotId}\u0000${row.sourceNamespace}\u0000${row.requirementKey}`
    if (seen.has(key)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `requirementBinding[${index}] duplicates its binding key`, 'requirementBinding', index)
    seen.add(key)
    if (row.deletedAt === null && featureScope?.feature?.deletedAt === null) counts.set(row.featureId, (counts.get(row.featureId) || 0) + 1)
  }
  for (const [featureId, count] of counts.entries()) if (count > 200) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `feature ${featureId} exceeds the 200 binding bound`, 'requirementBinding')
}

function validateReceipt(rows, maps, issues) {
  const seen = new Set()
  const snapshots = maps.GovernanceSnapshot
  for (const [index, row] of rows.entries()) {
    if (!checkExactFields(row, FAMILY_FIELDS.projectFeatureMutationReceipt, issues, 'projectFeatureMutationReceipt', index)) continue
    checkUuidFields(row, issues, 'projectFeatureMutationReceipt', index)
    if (!stringInRange(row.idempotencyKey, 8, 128) || !isSha256(row.payloadHash) || !stringInRange(row.etag, 1, 4096)
      || !validDate(row.createdAt) || row.status !== 'COMMITTED' || !isUuid(row.principalId)) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] has invalid receipt fields`, 'projectFeatureMutationReceipt', index)
    const scope = scopeForProject(row.projectId, maps)
    if (!checkScope(row, scope, issues, 'projectFeatureMutationReceipt', index)) continue
    const operation = RECEIPT_OPERATIONS[row.operation]
    if (!operation || row.targetType !== operation.targetType || row.httpMethod !== operation.httpMethod
      || row.resourceType !== operation.resourceType || (operation.version === 'null' ? row.version !== null : !positiveInt(row.version))) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] has an invalid operation tuple`, 'projectFeatureMutationReceipt', index)
    const feature = row.featureId === null ? null : maps.ProjectFeature.get(row.featureId)
    if (row.featureId !== null && (!feature || feature.projectId !== row.projectId || feature.tenantId !== row.tenantId || feature.businessId !== row.businessId)) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] has an invalid feature scope`, 'projectFeatureMutationReceipt', index)
    if (operation?.targetType === 'PROJECT' && row.targetId !== row.projectId) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] target does not match Project`, 'projectFeatureMutationReceipt', index)
    if (operation?.targetType === 'FEATURE' && (row.targetId !== row.featureId || !row.featureId)) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] target does not match Feature`, 'projectFeatureMutationReceipt', index)
    if (row.resourceType === 'PROJECT_FEATURE' && (!feature || row.resourceId !== row.featureId)) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] resource is not the Feature`, 'projectFeatureMutationReceipt', index)
    if (row.resourceType === 'PROJECT_FEATURE_GRAPH' && (row.resourceId !== row.projectId || row.operation !== 'REPLACE_FEATURE_WORK_GRAPH')) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] graph resource is invalid`, 'projectFeatureMutationReceipt', index)
    if (row.resourceType === 'GOVERNANCE_SNAPSHOT') {
      const snapshot = snapshots.get(row.resourceId)
      const proof = snapshot && parseProof(snapshot.verificationProof)
      if (!snapshot || row.operation !== 'CAPTURE_GOVERNANCE_SNAPSHOT' || !proof || proof.projectId !== row.projectId) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] snapshot resource is invalid`, 'projectFeatureMutationReceipt', index)
    }
    const key = `${row.tenantId}\u0000${row.businessId}\u0000${row.principalId}\u0000${row.operation}\u0000${row.targetId}\u0000${row.idempotencyKey}`
    if (seen.has(key)) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] duplicates its scoped idempotency key`, 'projectFeatureMutationReceipt', index)
    seen.add(key)
    if (!maps.AuditEvent.has(row.auditEventId)) issue(issues, PHASE_B_ERROR_CODES.RECEIPT_INVALID, `projectFeatureMutationReceipt[${index}] references a missing AuditEvent`, 'projectFeatureMutationReceipt', index)
  }
}

function incomingFamilyCompleteness(states, { allowLegacyMissing = false, targetCounts, schemaVisibility, source }) {
  const values = Object.values(states)
  const allMissing = values.every(({ state }) => state === 'MISSING')
  const anyMissing = values.some(({ state }) => state === 'MISSING')
  const anyUnavailable = values.some(({ state }) => state === 'UNAVAILABLE')
  const allPresent = values.every(({ state }) => state === 'PRESENT_EMPTY' || state === 'PRESENT_NONEMPTY')
  const current = targetCounts && typeof targetCounts === 'object' ? Object.values(targetCounts) : null
  const currentZero = current && current.every((value) => Number.isInteger(value) && value === 0)
  const fullVisibility = schemaVisibility === 'FULL' || schemaVisibility?.status === 'FULL'
  if (anyUnavailable) return { status: 'UNAVAILABLE', code: source === 'export' ? PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE : PHASE_B_ERROR_CODES.SNAPSHOT_INCOMPLETE, reason: 'Phase B family is unreadable' }
  if (allMissing && allowLegacyMissing && currentZero && fullVisibility) return { status: 'LEGACY_ABSENT', code: null, reason: 'explicit legacy snapshot with proven empty Phase B target' }
  if (anyMissing || !allPresent) return { status: 'INCOMPLETE', code: PHASE_B_ERROR_CODES.SNAPSHOT_INCOMPLETE, reason: 'all six Phase B arrays are required' }
  return { status: 'COMPLETE', code: null, reason: null }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function computeSnapshotSha256(snapshotBytes) {
  return sha256Hex(snapshotBytes)
}

export function canonicalTargetSchemaJson(inventory) {
  const normalized = {
    schemaSha256: inventory.schemaSha256,
    applicationTables: [...inventory.applicationTables]
      .map(({ modelName, schemaName, tableName }) => ({ modelName, schemaName, tableName }))
      .sort((a, b) => ordinalCompare(a.modelName, b.modelName) || ordinalCompare(a.schemaName, b.schemaName) || ordinalCompare(a.tableName, b.tableName)),
  }
  return canonicalJson(normalized)
}

export function computeTargetSchemaSha256(inventory) {
  return sha256Hex(Buffer.from(canonicalTargetSchemaJson(inventory), 'utf8'))
}

export function normalizePhaseBSchemaInventory(inventory) {
  const issues = []
  const normalized = validateInventory(inventory, issues)
  return { valid: issues.length === 0 && Boolean(normalized), issues, inventory: normalized }
}

export function classifyPhaseBFamilyState(snapshot, delegate) {
  if (!PHASE_B_FAMILY_DELEGATES.includes(delegate)) throw new TypeError(`Unknown Phase B family: ${delegate}`)
  return familyRows(snapshot, delegate).state
}

export function validatePhaseBSnapshot(snapshot, {
  source = 'web',
  schemaInventory,
  expectedSnapshotSha256,
  snapshotBytes,
  targetCounts,
  schemaVisibility = 'UNVERIFIED',
  allowLegacyMissing = false,
  requireTargetSchema = source === 'recovery' || source === 'export',
} = {}) {
  const issues = []
  const warnings = []
  const families = familyStateResult(snapshot)
  const counts = Object.fromEntries(PHASE_B_FAMILY_DELEGATES.map((delegate) => [delegate, families[delegate].count]))
  const tables = rowTables(snapshot)
  const maps = validateGenericParentTables(tables, issues)

  let snapshotSha256 = null
  if (snapshotBytes !== undefined) {
    snapshotSha256 = computeSnapshotSha256(snapshotBytes)
    if (expectedSnapshotSha256 !== undefined && expectedSnapshotSha256 !== snapshotSha256) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_DIGEST_MISMATCH, 'Snapshot digest does not match the exact input bytes')
  } else if (expectedSnapshotSha256 !== undefined) {
    issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_DIGEST_MISMATCH, 'Snapshot digest cannot be verified without the retained input bytes')
  }
  if (expectedSnapshotSha256 !== undefined && !isSha256(expectedSnapshotSha256)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_DIGEST_MISMATCH, 'Expected snapshot digest is not lower-case SHA-256')

  const normalizedInventory = schemaInventory ? validateInventory(schemaInventory, issues) : null
  let targetSchemaSha256 = normalizedInventory?.targetSchemaSha256 || null
  for (const declaredTargetSchemaSha256 of [snapshot?.targetSchemaSha256, snapshot?.phaseBRecovery?.targetSchemaSha256]) {
    if (declaredTargetSchemaSha256 !== undefined && (!isSha256(declaredTargetSchemaSha256) || declaredTargetSchemaSha256 !== targetSchemaSha256)) issue(issues, PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Snapshot target schema binding does not match the frozen inventory')
  }
  if (requireTargetSchema && !normalizedInventory) issue(issues, PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Recovery requires a frozen application table inventory')
  const visibilityFull = schemaVisibility === 'FULL' || schemaVisibility?.status === 'FULL'
  if ((source === 'recovery' || source === 'export') && !visibilityFull) issue(issues, source === 'export' ? PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE : PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED, 'Complete same-connection visibility was not proven')

  const completeness = incomingFamilyCompleteness(families, { allowLegacyMissing, targetCounts, schemaVisibility, source })
  if (completeness.code) issue(issues, completeness.code, completeness.reason)
  if (snapshot?.phaseBRecovery !== undefined) {
    const manifest = snapshot.phaseBRecovery
    if (!isRecord(manifest) || manifest.version !== PHASE_B_RECOVERY_MANIFEST_VERSION
      || !Array.isArray(manifest.requiredTables)
      || canonicalJson(manifest.requiredTables) !== canonicalJson(PHASE_B_FAMILY_DELEGATES)) issue(issues, PHASE_B_ERROR_CODES.SNAPSHOT_INCOMPLETE, 'Phase B recovery manifest does not enumerate the six families exactly')
  }

  if (completeness.status === 'COMPLETE') {
    validateGovernance(tables.GovernanceSnapshot, maps, issues)
    maps.GovernanceSnapshot = indexById(tables.GovernanceSnapshot)
    validateFeature(tables.ProjectFeature, maps, issues)
    maps.ProjectFeature = indexById(tables.ProjectFeature)
    validateContribution(tables.FeatureContribution, maps, issues)
    validateWorkLink(tables.FeatureWorkLink, maps, issues)
    validateBinding(tables.RequirementBinding, maps, issues)
    validateReceipt(tables.ProjectFeatureMutationReceipt, maps, issues)
  }

  const invalid = issues.length > 0
  let status = invalid ? 'INVALID' : completeness.status
  let errorCode = issues[0]?.code || null
  if (!invalid && source === 'recovery' && targetCounts && Object.values(targetCounts).some((value) => Number.isInteger(value) && value > 0)) {
    status = 'TARGET_NOT_EMPTY'
    errorCode = PHASE_B_ERROR_CODES.TARGET_NOT_EMPTY
  }
  if (!invalid && source === 'web' && targetCounts && Object.values(targetCounts).some((value) => Number.isInteger(value) && value > 0)) {
    status = 'TARGET_NOT_EMPTY'
    errorCode = PHASE_B_ERROR_CODES.RECOVERY_MAINTENANCE_REQUIRED
  }
  if (!invalid && completeness.status === 'LEGACY_ABSENT') warnings.push('Explicit legacy snapshot has no Phase B families; no Phase B rows will be written')
  return {
    status,
    valid: !invalid && status !== 'TARGET_NOT_EMPTY' && status !== 'UNAVAILABLE' && status !== 'INCOMPLETE',
    errorCode,
    errors: messageList(issues),
    warnings,
    issues,
    families,
    counts,
    incomingCounts: counts,
    targetCounts: targetCounts || null,
    snapshotSha256,
    targetSchemaSha256,
    schemaVisibility: visibilityFull ? 'FULL' : 'UNVERIFIED',
    applicationTableCount: normalizedInventory?.applicationTables.length ?? null,
  }
}

export class PhaseBRecoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'PhaseBRecoveryError'
    this.code = code
    this.details = details
  }
}

function transactionProvider(tx) {
  return tx?._engineConfig?.activeProvider
    || tx?._client?._engineConfig?.activeProvider
    || tx?._activeProvider
    || null
}

function phaseBTableNames(schemaInventory) {
  return Object.fromEntries(PHASE_B_FAMILY_DELEGATES.map((delegate, index) => {
    const modelName = PHASE_B_FAMILY_MODEL_NAMES[index]
    const entry = schemaInventory?.applicationTables?.find((item) => item.modelName === modelName)
    return [delegate, entry ? `"${entry.schemaName.replaceAll('"', '""')}"."${entry.tableName.replaceAll('"', '""')}"` : `"public"."${modelName}"`]
  }))
}

/**
 * Produce a fresh visibility proof from the transaction itself. A preview flag
 * is deliberately not accepted: ordinary PostgreSQL RLS clients can return
 * zero for a hidden table. SQLite is inherently unfiltered; PostgreSQL must
 * execute SET LOCAL row_security=off and raw counts on this same connection.
 */
export async function readPhaseBCounts(tx, { schemaInventory } = {}) {
  const provider = transactionProvider(tx)
  const counts = {}
  if (provider === 'sqlite') {
    for (const delegate of PHASE_B_FAMILY_DELEGATES) {
      const model = tx?.[delegate]
      if (!model || typeof model.count !== 'function') return {
        status: 'UNVERIFIED', counts: null, applicationTableCount: null,
        errorCode: PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE,
      }
      try {
        const count = await model.count()
        if (!Number.isInteger(count) || count < 0) throw new Error('invalid count')
        counts[delegate] = count
      } catch {
        return {
          status: 'UNVERIFIED', counts: null, applicationTableCount: null,
          errorCode: PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED,
        }
      }
    }
    return { status: 'FULL', counts, applicationTableCount: PHASE_B_FAMILY_DELEGATES.length, provider, errorCode: null }
  }
  if (provider !== 'postgresql' && provider !== 'postgres') return {
    status: 'UNVERIFIED', counts: null, applicationTableCount: null,
    errorCode: PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED,
  }
  if (typeof tx?.$executeRawUnsafe !== 'function' || typeof tx?.$queryRawUnsafe !== 'function') return {
    status: 'UNVERIFIED', counts: null, applicationTableCount: null,
    errorCode: PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED,
  }
  const tables = phaseBTableNames(schemaInventory)
  let rowSecurityOff = false
  let priorRowSecurity = 'on'
  try {
    const setting = await tx.$queryRawUnsafe("SELECT current_setting('row_security') AS \"rowSecurity\"")
    if (setting?.[0]?.rowSecurity !== 'on' && setting?.[0]?.rowSecurity !== 'off') throw new Error('unknown row_security setting')
    priorRowSecurity = setting[0].rowSecurity
    await tx.$executeRawUnsafe('SET LOCAL row_security = off')
    rowSecurityOff = true
    for (const delegate of PHASE_B_FAMILY_DELEGATES) {
      const result = await tx.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS "count" FROM ${tables[delegate]}`)
      const raw = result?.[0]?.count
      const count = Number(raw)
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid count')
      counts[delegate] = count
    }
    await tx.$executeRawUnsafe(`SET LOCAL row_security = ${priorRowSecurity}`)
    rowSecurityOff = false
    return { status: 'FULL', counts, applicationTableCount: PHASE_B_FAMILY_DELEGATES.length, provider, errorCode: null }
  } catch {
    // If the count is filtered or the role cannot set row_security=off, this
    // transaction is not a proof of global zero. Do not fall back to model.count.
    if (rowSecurityOff) {
      try { await tx.$executeRawUnsafe(`SET LOCAL row_security = ${priorRowSecurity}`) } catch { /* transaction may already be aborted */ }
    }
    return {
      status: 'UNVERIFIED', counts: null, applicationTableCount: null,
      errorCode: PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED,
    }
  }
}

export async function assertPhaseBWebRestoreSafe(tx, snapshot, preview = {}) {
  const validation = validatePhaseBSnapshot(snapshot, {
    source: 'web',
    schemaInventory: preview.schemaInventory,
    allowLegacyMissing: true,
    requireTargetSchema: false,
  })
  const allMissing = Object.values(validation.families).every(({ state }) => state === 'MISSING')
  const explicitLegacy = allMissing && !snapshot?.phaseBRecovery
  const legacyIssuesOnly = validation.issues.every(({ code }) => code === PHASE_B_ERROR_CODES.SNAPSHOT_INCOMPLETE)
  if (validation.issues.length && !(explicitLegacy && legacyIssuesOnly)) {
    const code = validation.issues.some(({ code }) => code === PHASE_B_ERROR_CODES.RECEIPT_INVALID)
      ? PHASE_B_ERROR_CODES.RECEIPT_INVALID
      : validation.errorCode || PHASE_B_ERROR_CODES.SNAPSHOT_INVALID
    throw new PhaseBRecoveryError(code, validation.errors[0] || 'Phase B snapshot is invalid')
  }
  const proof = await readPhaseBCounts(tx, { schemaInventory: preview.schemaInventory })
  if (proof.status !== 'FULL' || !proof.counts) throw new PhaseBRecoveryError(
    PHASE_B_ERROR_CODES.RECOVERY_MAINTENANCE_REQUIRED,
    'Phase B complete visibility is unavailable; protected recovery must use the offline command',
  )
  const incoming = validation.incomingCounts || {}
  const incomingNonempty = PHASE_B_FAMILY_DELEGATES.some((delegate) => incoming[delegate] > 0)
  const currentNonempty = PHASE_B_FAMILY_DELEGATES.some((delegate) => proof.counts[delegate] > 0)
  if (incomingNonempty || currentNonempty) throw new PhaseBRecoveryError(
    PHASE_B_ERROR_CODES.RECOVERY_MAINTENANCE_REQUIRED,
    'Phase B protected evidence requires the clean-target offline recovery command',
    { targetCounts: proof.counts, incomingCounts: incoming },
  )
}

export function phaseBRowsInDependencyOrder(snapshot) {
  return PHASE_B_FAMILY_DELEGATES.flatMap((delegate) => {
    const family = familyRows(snapshot, delegate)
    return family.state === 'PRESENT_NONEMPTY' ? family.rows.map((row) => ({ model: delegate, row })) : []
  })
}

export function phaseBFamilyCounts(snapshot) {
  return Object.fromEntries(PHASE_B_FAMILY_DELEGATES.map((delegate) => {
    const family = familyRows(snapshot, delegate)
    return [delegate, family.rows?.length ?? 0]
  }))
}

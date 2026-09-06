// @req FR-137, FR-138, FR-140 — retain proof of production activation without
// retaining credentials, provider payloads, extracted values or document bytes.
// @spec CR-016, ADR-057 D7, SEC-023
// @tested tests/unit/asset-production-activation-contract.test.js

const REQUIRED_MIGRATIONS = Object.freeze([
  '20260902001000',
  '20260902103000',
])

const FORBIDDEN_KEY = /(?:api[_-]?key|authorization|credential|secret|service[_-]?role|token|password|cookie|private[_-]?key|document(?:bytes|content|text)|file(?:bytes|content)|raw(?:document|provider|response)|extracted(?:fields?|values?)|provider(?:payload|response)|payload(?:json|body|content))/i
const SECRET_VALUE = /(?:\bBearer\s+|\bsk-[A-Za-z0-9_-]{8,}|\bsb_secret_[A-Za-z0-9_-]+|\b(?:ghp|github_pat|xoxb|xoxp)-?[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@|data:(?:image|application\/pdf)[^,]*;base64,)/i

function fail(message) {
  throw new Error(`ASSET_PRODUCTION_RECEIPT_INVALID: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireObject(value, path) {
  if (!isObject(value)) fail(`${path} must be an object`)
  return value
}

function requireString(value, path, pattern = null) {
  if (typeof value !== 'string' || !value.trim()) fail(`${path} must be a non-empty string`)
  if (pattern && !pattern.test(value)) fail(`${path} has an invalid format`)
}

function requireExact(value, expected, path) {
  if (value !== expected) fail(`${path} must equal ${JSON.stringify(expected)}`)
}

function scanRedaction(value, path = 'receipt') {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof ArrayBuffer) {
    fail(`${path} contains binary document content`)
  }
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail(`${path} contains a secret or encoded document value`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanRedaction(entry, `${path}[${index}]`))
    return
  }
  if (!isObject(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) fail(`${path}.${key} is forbidden`)
    scanRedaction(entry, `${path}.${key}`)
  }
}

export function validateAssetProductionReceipt(receipt) {
  requireObject(receipt, 'receipt')
  scanRedaction(receipt)

  requireExact(receipt.schemaVersion, 'asset-production-activation.v1', 'schemaVersion')
  requireString(receipt.generatedAt, 'generatedAt')
  if (Number.isNaN(Date.parse(receipt.generatedAt))) fail('generatedAt must be an ISO-8601 timestamp')

  const target = requireObject(receipt.target, 'target')
  requireExact(target.repository, 'Freshair129/zuri.ai', 'target.repository')
  for (const field of ['vercelTeamId', 'vercelProjectId', 'supabaseProjectRef']) {
    requireString(target[field], `target.${field}`)
  }

  const deployment = requireObject(receipt.deployment, 'deployment')
  requireString(deployment.commitSha, 'deployment.commitSha', /^[a-f0-9]{40}$/i)
  requireString(deployment.deploymentId, 'deployment.deploymentId')
  requireString(deployment.rollbackDeploymentId, 'deployment.rollbackDeploymentId')

  if (!Array.isArray(receipt.migrations)) fail('migrations must be an array')
  const migrationVersions = new Set()
  for (const [index, migration] of receipt.migrations.entries()) {
    requireObject(migration, `migrations[${index}]`)
    requireString(migration.version, `migrations[${index}].version`)
    requireExact(migration.status, 'APPLIED', `migrations[${index}].status`)
    migrationVersions.add(migration.version)
  }
  for (const version of REQUIRED_MIGRATIONS) {
    if (!migrationVersions.has(version)) fail(`migration ${version} is missing`)
  }

  const storage = requireObject(receipt.storage, 'storage')
  requireString(storage.bucket, 'storage.bucket')
  requireExact(storage.public, false, 'storage.public')
  requireString(storage.objectRef, 'storage.objectRef', /^supabase:\/\/[A-Za-z0-9._/-]+$/)
  requireString(storage.objectSha256, 'storage.objectSha256', /^[a-f0-9]{64}$/i)

  const canary = requireObject(receipt.canary, 'canary')
  for (const field of ['intakeId', 'evidenceId', 'pipelineRunId']) {
    requireString(canary[field], `canary.${field}`)
  }
  requireString(canary.inputSha256, 'canary.inputSha256', /^[a-f0-9]{64}$/i)
  requireExact(canary.extractionState, 'CANDIDATE', 'canary.extractionState')
  requireExact(canary.reviewState, 'REVIEWED', 'canary.reviewState')
  requireExact(canary.validationState, 'READY_FOR_REGISTRATION', 'canary.validationState')
  requireExact(canary.registeredAssetCreated, false, 'canary.registeredAssetCreated')
  requireExact(canary.procurementMutationCount, 0, 'canary.procurementMutationCount')
  requireExact(canary.financePostingCount, 0, 'canary.financePostingCount')
  if (!Number.isFinite(canary.elapsedMs) || canary.elapsedMs < 0) fail('canary.elapsedMs must be non-negative')

  const runtime = requireObject(receipt.runtime, 'runtime')
  requireString(runtime.windowStart, 'runtime.windowStart')
  requireString(runtime.windowEnd, 'runtime.windowEnd')
  const windowStart = Date.parse(runtime.windowStart)
  const windowEnd = Date.parse(runtime.windowEnd)
  if (Number.isNaN(windowStart) || Number.isNaN(windowEnd) || windowEnd < windowStart) {
    fail('runtime window must contain ordered ISO-8601 timestamps')
  }
  requireExact(runtime.errorCount, 0, 'runtime.errorCount')

  return receipt
}

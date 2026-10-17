import { lstatSync, readFileSync } from 'node:fs'
import { unknownWorkerObservabilitySnapshot } from '../worker-observability-contract.js'

export const DEFAULT_WORKER_OBSERVABILITY_FILE = '/run/zuri/worker-observability/worker-observability.json'
export const MAX_WORKER_OBSERVABILITY_AGE_MS = 15_000

const PROJECTION_KEYS = new Set(['schemaVersion', 'state', 'freshness', 'observedAt', 'reason', 'source', 'summary', 'tasks', 'assignments', 'events', 'campaignIntake', 'localTags', 'localTagCount', 'localTagsTruncated', 'localTagSetFingerprint', 'localStatus'])
const SOURCE_KEYS = new Set(['kind', 'proofScope', 'controllerLiveness', 'eventChain', 'supervisorReceipts', 'roadmapIntake', 'ciReceipts'])
const SUMMARY_KEYS = new Set(['activeWorkers', 'queuedWorkers', 'activeTasks', 'mode'])
const TASK_KEYS = new Set(['taskId', 'cycleNo', 'state', 'baseCommit', 'candidateHeadCommit', 'updatedAt', 'stages', 'ci'])
const STAGE_KEYS = new Set(['taskId', 'cycleNo', 'role', 'stage', 'state', 'attempt', 'checkedHeadCommit', 'lease', 'active', 'queued', 'localCheck', 'contextMemory'])
const ASSIGNMENT_KEYS = new Set([...STAGE_KEYS, 'assignmentRef'])
const LEASE_KEYS = new Set(['state', 'heartbeatAt', 'ageMs', 'active'])
const LOCAL_CHECK_KEYS = new Set(['state', 'scope', 'receiptDigest'])
const CONTEXT_MEMORY_KEYS = new Set(['state', 'sourceKindCounts', 'digest'])
const CI_KEYS = new Set(['state', 'scope', 'observedAt', 'exactHeadCommit', 'baseCommit', 'checks'])
const CI_CHECK_KEYS = new Set(['passed', 'failed', 'pending', 'unknown'])
const EVENT_KEYS = new Set(['taskId', 'cycleNo', 'role', 'kind', 'observedAt', 'status', 'sequence'])
const CAMPAIGN_INTAKE_KEYS = new Set(['state', 'freshness', 'status', 'code', 'observedAt', 'ageMs', 'source', 'proofScope', 'authorityGrant', 'dispatchAllowed', 'selectedTaskId', 'candidates'])
const CANDIDATE_KEYS = new Set(['taskId', 'status', 'code'])
const TAG_KEYS = new Set(['name', 'objectId', 'createdAt'])
const LOCAL_STATUS_KEYS = new Set(['changedFiles', 'fingerprint', 'headCommit', 'observedAt', 'taskWorktrees'])
const TASK_WORKTREE_KEYS = new Set(['workspaceRef', 'taskId', 'cycleNo', 'branch', 'headCommit', 'dirtyFileCount', 'candidateHeadMatch', 'verificationState', 'reason', 'observedAt'])
const TASK_WORKTREE_REASONS = new Set(['WORKTREE_PATH_INVALID', 'WORKTREE_REGISTRY_UNAVAILABLE', 'WORKTREE_NOT_REGISTERED', 'WORKTREE_UNAVAILABLE', 'WORKTREE_INVALID', 'WORKTREE_REPOSITORY_MISMATCH'])
const SAFE_CODE = /^[A-Z][A-Z0-9_-]{0,95}$/
const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/
const SAFE_BRANCH = /^(?:UNKNOWN|DETACHED|main|master|develop|(?:codex|feature|feat|fix|docs|chore|test|refactor|release)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,119})$/
const CREDENTIAL_SHAPED_BRANCH_PATTERNS = [
  /github_pat_[A-Za-z0-9_]{20,}/i,
  /gh[pousr]_[A-Za-z0-9_]{20,}/i,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/i,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/i,
]
const SAFE_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value, keys) {
  return isRecord(value) && Object.keys(value).every((key) => keys.has(key))
}

function timestampMillis(value) {
  if (typeof value !== 'string') return null
  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) return null
  return new Date(millis).toISOString() === value ? millis : null
}

function isSafeCode(value) {
  return typeof value === 'string' && SAFE_CODE.test(value)
}

function isNullableSafeCode(value) {
  return value === null || isSafeCode(value)
}

function isNullableHash(value) {
  return value === null || (typeof value === 'string' && SAFE_HASH.test(value))
}

function isSafeBranch(value) {
  return typeof value === 'string' && SAFE_BRANCH.test(value)
    && !value.includes('//') && !/(?:^|\/)\.\.?(?:\/|$)/.test(value)
    && !CREDENTIAL_SHAPED_BRANCH_PATTERNS.some((pattern) => pattern.test(value))
}

function isNullableTimestamp(value) {
  return value === null || timestampMillis(value) !== null
}

function isContextMemory(value) {
  return hasOnlyKeys(value, CONTEXT_MEMORY_KEYS)
    && value.state === 'NOT_CAPTURED'
    && Array.isArray(value.sourceKindCounts)
    && value.sourceKindCounts.length === 0
    && value.digest === null
}

function isTaskWorktree(value) {
  if (!hasOnlyKeys(value, TASK_WORKTREE_KEYS) || !/^workspace-[a-f0-9]{16}$/.test(value.workspaceRef)
      || !isSafeCode(value.taskId) || !Number.isSafeInteger(value.cycleNo) || value.cycleNo < 1
      || !isSafeBranch(value.branch)
      || !isNullableHash(value.headCommit)
      || !(value.dirtyFileCount === null || (Number.isSafeInteger(value.dirtyFileCount) && value.dirtyFileCount >= 0))
      || !['MATCH', 'MISMATCH', 'UNKNOWN'].includes(value.candidateHeadMatch)
      || !['VERIFIED', 'UNKNOWN'].includes(value.verificationState)
      || !(value.reason === null || TASK_WORKTREE_REASONS.has(value.reason))
      || timestampMillis(value.observedAt) === null) return false
  if (value.verificationState === 'VERIFIED') return value.headCommit !== null && value.dirtyFileCount !== null && value.reason === null
  return value.headCommit === null && value.dirtyFileCount === null
    && value.candidateHeadMatch === 'UNKNOWN' && value.reason !== null
}

function isStage(value, assignment = false) {
  return hasOnlyKeys(value, assignment ? ASSIGNMENT_KEYS : STAGE_KEYS)
    && (!assignment || /^worker-\d{3,}$/.test(value.assignmentRef))
    && isSafeCode(value.taskId)
    && Number.isSafeInteger(value.cycleNo) && value.cycleNo > 0
    && ['worker', 'verifier', 'reviewer', 'unknown'].includes(value.role)
    && isSafeCode(value.stage) && isSafeCode(value.state)
    && Number.isSafeInteger(value.attempt) && value.attempt >= 0
    && isNullableHash(value.checkedHeadCommit)
    && hasOnlyKeys(value.lease, LEASE_KEYS)
    && isSafeCode(value.lease.state)
    && isNullableTimestamp(value.lease.heartbeatAt)
    && (value.lease.ageMs === null || (Number.isFinite(value.lease.ageMs) && value.lease.ageMs >= 0))
    && typeof value.lease.active === 'boolean'
    && typeof value.active === 'boolean' && typeof value.queued === 'boolean'
    && hasOnlyKeys(value.localCheck, LOCAL_CHECK_KEYS)
    && isSafeCode(value.localCheck.state) && isSafeCode(value.localCheck.scope)
    && isNullableHash(value.localCheck.receiptDigest)
    && isContextMemory(value.contextMemory)
}

function isCi(value) {
  return hasOnlyKeys(value, CI_KEYS)
    && isSafeCode(value.state) && isSafeCode(value.scope)
    && isNullableTimestamp(value.observedAt)
    && isNullableHash(value.exactHeadCommit) && isNullableHash(value.baseCommit)
    && hasOnlyKeys(value.checks, CI_CHECK_KEYS)
    && ['passed', 'failed', 'pending', 'unknown'].every((key) => Number.isSafeInteger(value.checks[key]) && value.checks[key] >= 0)
}

function isTask(value) {
  return hasOnlyKeys(value, TASK_KEYS)
    && isSafeCode(value.taskId)
    && Number.isSafeInteger(value.cycleNo) && value.cycleNo > 0
    && isSafeCode(value.state)
    && isNullableHash(value.baseCommit) && isNullableHash(value.candidateHeadCommit)
    && isNullableTimestamp(value.updatedAt)
    && Array.isArray(value.stages) && value.stages.every((stage) => isStage(stage))
    && isCi(value.ci)
}

function isEvent(value) {
  return hasOnlyKeys(value, EVENT_KEYS)
    && (value.taskId === null || isSafeCode(value.taskId))
    && (value.cycleNo === null || (Number.isSafeInteger(value.cycleNo) && value.cycleNo > 0))
    && (value.role === null || ['worker', 'verifier', 'reviewer', 'delivery'].includes(value.role))
    && isSafeCode(value.kind) && timestampMillis(value.observedAt) !== null
    && isSafeCode(value.status)
    && (value.sequence === null || (Number.isSafeInteger(value.sequence) && value.sequence > 0))
}

function isCampaignIntake(value) {
  return hasOnlyKeys(value, CAMPAIGN_INTAKE_KEYS)
    && ['SNAPSHOT', 'NOT_CAPTURED', 'UNKNOWN'].includes(value.state)
    && ['FRESH', 'STALE', 'UNKNOWN'].includes(value.freshness)
    && isSafeCode(value.status)
    && isNullableSafeCode(value.code) && isNullableTimestamp(value.observedAt)
    && (value.ageMs === null || (Number.isFinite(value.ageMs) && value.ageMs >= 0))
    && value.source === 'LOCAL_ROADMAP_INTAKE' && value.proofScope === 'LOCAL_ONLY'
    && typeof value.authorityGrant === 'boolean' && typeof value.dispatchAllowed === 'boolean'
    && isNullableSafeCode(value.selectedTaskId)
    && Array.isArray(value.candidates)
    && value.candidates.every((candidate) => hasOnlyKeys(candidate, CANDIDATE_KEYS)
      && isSafeCode(candidate.taskId) && isSafeCode(candidate.status)
      && isSafeCode(candidate.code))
}

function isProjection(value) {
  if (!hasOnlyKeys(value, PROJECTION_KEYS) || value.schemaVersion !== 'worker-observability/v1'
      || !['LIVE', 'UNKNOWN'].includes(value.state)
      || value.freshness !== (value.state === 'LIVE' ? 'SNAPSHOT' : 'UNKNOWN')
      || timestampMillis(value.observedAt) === null
      || (value.reason !== undefined && !isSafeCode(value.reason))
      || !hasOnlyKeys(value.source, SOURCE_KEYS)
      || value.source.kind !== 'LOCAL_DELIVERY_CONTROLLER'
      || value.source.proofScope !== 'LOCAL_ONLY'
      || !Object.values(value.source).every(isSafeCode)
      || !hasOnlyKeys(value.summary, SUMMARY_KEYS)
      || !Number.isSafeInteger(value.summary.activeWorkers) || value.summary.activeWorkers < 0
      || !Number.isSafeInteger(value.summary.queuedWorkers) || value.summary.queuedWorkers < 0
      || !Number.isSafeInteger(value.summary.activeTasks) || value.summary.activeTasks < 0
      || !['UNKNOWN', 'IDLE', 'SOLO', 'SWARM'].includes(value.summary.mode)
      || !Array.isArray(value.tasks) || !value.tasks.every(isTask)
      || !Array.isArray(value.assignments) || !value.assignments.every((assignment) => isStage(assignment, true))
      || !Array.isArray(value.events) || !value.events.every(isEvent)
      || !isCampaignIntake(value.campaignIntake)
      || !Array.isArray(value.localTags)
      || !value.localTags.every((tag) => hasOnlyKeys(tag, TAG_KEYS) && typeof tag.name === 'string'
        && SAFE_TAG.test(tag.name) && typeof tag.objectId === 'string' && SAFE_HASH.test(tag.objectId)
        && isNullableTimestamp(tag.createdAt))
      || !Number.isSafeInteger(value.localTagCount) || value.localTagCount < 0
      || typeof value.localTagsTruncated !== 'boolean'
      || !(value.localTagSetFingerprint === null || (typeof value.localTagSetFingerprint === 'string'
        && /^[A-F0-9]{64}$/i.test(value.localTagSetFingerprint)))
      || !hasOnlyKeys(value.localStatus, LOCAL_STATUS_KEYS)
      || !(value.localStatus.changedFiles === null || (Number.isSafeInteger(value.localStatus.changedFiles) && value.localStatus.changedFiles >= 0))
      || !isNullableHash(value.localStatus.fingerprint)
      || !isNullableHash(value.localStatus.headCommit)
      || timestampMillis(value.localStatus.observedAt) === null
      || (value.localStatus.taskWorktrees !== undefined && (!Array.isArray(value.localStatus.taskWorktrees)
        || !value.localStatus.taskWorktrees.every(isTaskWorktree)))) return false
  return true
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  const millis = Date.parse(value)
  return Number.isFinite(millis) ? new Date(millis) : null
}

function failClosed(reason, now) {
  return unknownWorkerObservabilitySnapshot(reason, now)
}

export function readWorkerObservabilitySource({
  filePath = process.env.ZURI_WORKER_OBSERVABILITY_FILE ?? DEFAULT_WORKER_OBSERVABILITY_FILE,
  since = null,
  now = () => new Date(),
} = {}) {
  const nowValue = asDate(now())
  if (!nowValue) return failClosed('SOURCE_TIME_INVALID', new Date())

  let snapshot
  try {
    const fileStat = lstatSync(filePath)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return failClosed('SOURCE_INVALID', nowValue)
    snapshot = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    return failClosed(error?.code === 'ENOENT' ? 'SOURCE_UNAVAILABLE' : 'SOURCE_INVALID', nowValue)
  }
  if (!isProjection(snapshot)) return failClosed('SOURCE_INVALID', nowValue)

  const observedAt = timestampMillis(snapshot.observedAt)
  const nowMs = nowValue.getTime()
  if (observedAt > nowMs) return failClosed('SOURCE_FUTURE_DATED', nowValue)
  if (nowMs - observedAt > MAX_WORKER_OBSERVABILITY_AGE_MS) return failClosed('SOURCE_STALE', nowValue)

  const sinceMs = since === null || since === undefined ? null : Date.parse(since)
  const events = sinceMs === null || !Number.isFinite(sinceMs)
    ? snapshot.events
    : snapshot.events.filter((event) => timestampMillis(event.observedAt) >= sinceMs)
  return { ...snapshot, events }
}

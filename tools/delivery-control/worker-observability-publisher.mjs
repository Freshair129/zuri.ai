import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readWorkerObservability } from './worker-observability-reader.mjs';

export const WORKER_OBSERVABILITY_EXPORT_FILENAME = 'worker-observability.json';
export const DEFAULT_WORKER_OBSERVABILITY_PUBLISH_INTERVAL_MS = 2_000;
export const MAX_WORKER_OBSERVABILITY_PUBLISH_INTERVAL_MS = 5_000;

const PROJECTION_KEYS = new Set(['schemaVersion', 'state', 'freshness', 'observedAt', 'reason', 'source', 'summary', 'tasks', 'assignments', 'events', 'campaignIntake', 'localTags', 'localTagCount', 'localTagsTruncated', 'localTagSetFingerprint', 'localStatus']);
const SOURCE_KEYS = new Set(['kind', 'proofScope', 'controllerLiveness', 'eventChain', 'supervisorReceipts', 'roadmapIntake', 'ciReceipts']);
const SUMMARY_KEYS = new Set(['activeWorkers', 'queuedWorkers', 'activeTasks', 'mode']);
const TASK_KEYS = new Set(['taskId', 'cycleNo', 'state', 'baseCommit', 'candidateHeadCommit', 'updatedAt', 'stages', 'ci']);
const STAGE_KEYS = new Set(['taskId', 'cycleNo', 'role', 'stage', 'state', 'attempt', 'checkedHeadCommit', 'lease', 'active', 'queued', 'localCheck', 'contextMemory']);
const ASSIGNMENT_KEYS = new Set([...STAGE_KEYS, 'assignmentRef']);
const LEASE_KEYS = new Set(['state', 'heartbeatAt', 'ageMs', 'active']);
const LOCAL_CHECK_KEYS = new Set(['state', 'scope', 'receiptDigest']);
const CONTEXT_MEMORY_KEYS = new Set(['state', 'sourceKindCounts', 'digest']);
const CONTEXT_COUNT_KEYS = new Set(['kind', 'count']);
const CI_KEYS = new Set(['state', 'scope', 'observedAt', 'exactHeadCommit', 'baseCommit', 'checks']);
const CI_CHECK_KEYS = new Set(['passed', 'failed', 'pending', 'unknown']);
const EVENT_KEYS = new Set(['taskId', 'cycleNo', 'role', 'kind', 'observedAt', 'status', 'sequence']);
const CAMPAIGN_INTAKE_KEYS = new Set(['state', 'freshness', 'status', 'code', 'observedAt', 'ageMs', 'source', 'proofScope', 'authorityGrant', 'dispatchAllowed', 'selectedTaskId', 'candidates']);
const CANDIDATE_KEYS = new Set(['taskId', 'status', 'code']);
const TAG_KEYS = new Set(['name', 'objectId', 'createdAt']);
const LOCAL_STATUS_KEYS = new Set(['changedFiles', 'fingerprint', 'headCommit', 'observedAt']);
const SAFE_CODE = /^[A-Z][A-Z0-9_-]{0,95}$/;
const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const SAFE_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, keys) {
  return isRecord(value) && Object.keys(value).every((key) => keys.has(key));
}

function timestampMillis(value) {
  if (typeof value !== 'string') return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toISOString() === value ? millis : null;
}

function isSafeCode(value) {
  return typeof value === 'string' && SAFE_CODE.test(value);
}

function isNullableSafeCode(value) {
  return value === null || isSafeCode(value);
}

function isNullableHash(value) {
  return value === null || (typeof value === 'string' && SAFE_HASH.test(value));
}

function isNullableTimestamp(value) {
  return value === null || timestampMillis(value) !== null;
}

function isContextMemory(value) {
  return hasOnlyKeys(value, CONTEXT_MEMORY_KEYS)
    && isSafeCode(value.state)
    && Array.isArray(value.sourceKindCounts)
    && value.sourceKindCounts.every((item) => isSafeCode(item)
      || (hasOnlyKeys(item, CONTEXT_COUNT_KEYS) && isSafeCode(item.kind)
        && Number.isSafeInteger(item.count) && item.count >= 0))
    && isNullableHash(value.digest);
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
    && isContextMemory(value.contextMemory);
}

function isCi(value) {
  return hasOnlyKeys(value, CI_KEYS)
    && isSafeCode(value.state) && isSafeCode(value.scope)
    && isNullableTimestamp(value.observedAt)
    && isNullableHash(value.exactHeadCommit) && isNullableHash(value.baseCommit)
    && hasOnlyKeys(value.checks, CI_CHECK_KEYS)
    && ['passed', 'failed', 'pending', 'unknown'].every((key) => Number.isSafeInteger(value.checks[key]) && value.checks[key] >= 0);
}

function isTask(value) {
  return hasOnlyKeys(value, TASK_KEYS)
    && isSafeCode(value.taskId)
    && Number.isSafeInteger(value.cycleNo) && value.cycleNo > 0
    && isSafeCode(value.state)
    && isNullableHash(value.baseCommit) && isNullableHash(value.candidateHeadCommit)
    && isNullableTimestamp(value.updatedAt)
    && Array.isArray(value.stages) && value.stages.every((stage) => isStage(stage))
    && isCi(value.ci);
}

function isEvent(value) {
  return hasOnlyKeys(value, EVENT_KEYS)
    && (value.taskId === null || isSafeCode(value.taskId))
    && (value.cycleNo === null || (Number.isSafeInteger(value.cycleNo) && value.cycleNo > 0))
    && (value.role === null || ['worker', 'verifier', 'reviewer', 'delivery'].includes(value.role))
    && isSafeCode(value.kind) && timestampMillis(value.observedAt) !== null
    && isSafeCode(value.status)
    && (value.sequence === null || (Number.isSafeInteger(value.sequence) && value.sequence > 0));
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
      && isSafeCode(candidate.taskId) && isSafeCode(candidate.status) && isSafeCode(candidate.code));
}

function isProjection(value) {
  return hasOnlyKeys(value, PROJECTION_KEYS)
    && value.schemaVersion === 'worker-observability/v1'
    && ['LIVE', 'UNKNOWN'].includes(value.state)
    && value.freshness === (value.state === 'LIVE' ? 'SNAPSHOT' : 'UNKNOWN')
    && timestampMillis(value.observedAt) !== null
    && (value.reason === undefined || isSafeCode(value.reason))
    && hasOnlyKeys(value.source, SOURCE_KEYS)
    && value.source.kind === 'LOCAL_DELIVERY_CONTROLLER'
    && value.source.proofScope === 'LOCAL_ONLY'
    && Object.values(value.source).every(isSafeCode)
    && hasOnlyKeys(value.summary, SUMMARY_KEYS)
    && Number.isSafeInteger(value.summary.activeWorkers) && value.summary.activeWorkers >= 0
    && Number.isSafeInteger(value.summary.queuedWorkers) && value.summary.queuedWorkers >= 0
    && Number.isSafeInteger(value.summary.activeTasks) && value.summary.activeTasks >= 0
    && ['UNKNOWN', 'IDLE', 'SOLO', 'SWARM'].includes(value.summary.mode)
    && Array.isArray(value.tasks) && value.tasks.every(isTask)
    && Array.isArray(value.assignments) && value.assignments.every((assignment) => isStage(assignment, true))
    && Array.isArray(value.events) && value.events.every(isEvent)
    && isCampaignIntake(value.campaignIntake)
    && Array.isArray(value.localTags)
    && value.localTags.every((tag) => hasOnlyKeys(tag, TAG_KEYS)
      && typeof tag.name === 'string' && SAFE_TAG.test(tag.name)
      && typeof tag.objectId === 'string' && SAFE_HASH.test(tag.objectId)
      && isNullableTimestamp(tag.createdAt))
    && Number.isSafeInteger(value.localTagCount) && value.localTagCount >= 0
    && typeof value.localTagsTruncated === 'boolean'
    && (value.localTagSetFingerprint === null || (typeof value.localTagSetFingerprint === 'string' && /^[A-F0-9]{64}$/i.test(value.localTagSetFingerprint)))
    && hasOnlyKeys(value.localStatus, LOCAL_STATUS_KEYS)
    && (value.localStatus.changedFiles === null || (Number.isSafeInteger(value.localStatus.changedFiles) && value.localStatus.changedFiles >= 0))
    && isNullableHash(value.localStatus.fingerprint)
    && isNullableHash(value.localStatus.headCommit)
    && timestampMillis(value.localStatus.observedAt) !== null;
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis) : null;
}

function unknownProjection(reason, now) {
  const observedAt = (asDate(now) ?? new Date()).toISOString();
  return {
    schemaVersion: 'worker-observability/v1',
    state: 'UNKNOWN',
    freshness: 'UNKNOWN',
    observedAt,
    reason,
    source: {
      kind: 'LOCAL_DELIVERY_CONTROLLER',
      proofScope: 'LOCAL_ONLY',
      controllerLiveness: 'UNKNOWN',
      eventChain: 'UNKNOWN',
      supervisorReceipts: 'UNKNOWN',
      roadmapIntake: 'NOT_CAPTURED',
      ciReceipts: 'UNKNOWN',
    },
    summary: { activeWorkers: 0, queuedWorkers: 0, activeTasks: 0, mode: 'UNKNOWN' },
    tasks: [],
    assignments: [],
    events: [],
    campaignIntake: {
      state: 'NOT_CAPTURED', freshness: 'UNKNOWN', status: 'NOT_CAPTURED', code: null,
      observedAt: null, ageMs: null, source: 'LOCAL_ROADMAP_INTAKE', proofScope: 'LOCAL_ONLY',
      authorityGrant: false, dispatchAllowed: false, selectedTaskId: null, candidates: [],
    },
    localTags: [],
    localTagCount: 0,
    localTagsTruncated: false,
    localTagSetFingerprint: null,
    localStatus: { changedFiles: null, fingerprint: null, headCommit: null, observedAt },
  };
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('WORKER_OBSERVABILITY_EXPORT_DIRECTORY_INVALID');
  if (process.platform !== 'win32') chmodSync(directory, 0o700);
}

function assertRegularDestination(destination) {
  try {
    const stat = lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('WORKER_OBSERVABILITY_EXPORT_TARGET_INVALID');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function writeAtomically(directory, destination, content) {
  ensurePrivateDirectory(directory);
  assertRegularDestination(destination);
  const temporary = path.join(directory, `.worker-observability-${process.pid}-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, destination);
    if (process.platform !== 'win32') chmodSync(destination, 0o600);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function publishWorkerObservabilitySnapshot({
  repoRoot,
  exportDirectory,
  readSnapshot = readWorkerObservability,
  now = () => new Date(),
} = {}) {
  if (typeof exportDirectory !== 'string' || exportDirectory.length === 0) {
    throw new TypeError('A dedicated worker observability export directory is required.');
  }
  if (typeof readSnapshot !== 'function') throw new TypeError('A worker observability reader is required.');

  const capturedAt = asDate(now()) ?? new Date();
  let snapshot;
  try {
    snapshot = readSnapshot({ repoRoot, since: null, now: () => capturedAt });
  } catch {
    snapshot = null;
  }
  if (!isProjection(snapshot)) snapshot = unknownProjection('SOURCE_UNAVAILABLE', capturedAt);

  const directory = path.resolve(exportDirectory);
  const destination = path.join(directory, WORKER_OBSERVABILITY_EXPORT_FILENAME);
  writeAtomically(directory, destination, `${JSON.stringify(snapshot)}\n`);
  return { snapshot, destination };
}

export function startWorkerObservabilityPublisher({
  repoRoot,
  exportDirectory,
  intervalMs = DEFAULT_WORKER_OBSERVABILITY_PUBLISH_INTERVAL_MS,
  readSnapshot = readWorkerObservability,
  onError = () => {},
} = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > MAX_WORKER_OBSERVABILITY_PUBLISH_INTERVAL_MS) {
    throw new RangeError(`Worker observability publication interval must be 1-${MAX_WORKER_OBSERVABILITY_PUBLISH_INTERVAL_MS} ms.`);
  }
  let stopped = false;
  const publish = () => {
    if (stopped) return;
    try { publishWorkerObservabilitySnapshot({ repoRoot, exportDirectory, readSnapshot }); }
    catch { onError(new Error('WORKER_OBSERVABILITY_EXPORT_FAILED')); }
  };
  publish();
  const timer = setInterval(publish, intervalMs);
  timer.unref?.();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

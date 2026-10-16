import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Vite 2 cannot resolve node:sqlite as a static import; use the same Node-only
// builtin loading pattern as the server's SQLite tests.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

export const WORKER_OBSERVABILITY_SCHEMA_VERSION = 'worker-observability/v1';
export const MAX_HEARTBEAT_AGE_MS = 15_000;
export const MAX_INTAKE_SNAPSHOT_AGE_MS = 60_000;
const ACTIVE_RUN_STATES = new Set(['RUNNING', 'LEASED', 'WORKER_RUNNING', 'VERIFY_RUNNING', 'REVIEW_RUNNING']);
const ACTIVE_NODE_STATES = new Set(['RUNNING', 'LEASED']);

const EVENT_KINDS = Object.freeze({
  TASK_REGISTERED: 'TASK_REGISTERED',
  ROOT_ADMITTED_EXECUTION_CYCLE: 'CYCLE_ADMITTED',
  NODE_CLAIMED: 'LEASE_ACQUIRED',
  NODE_LEASE_HEARTBEAT: 'HEARTBEAT',
  UNUSED_LEASE_EXPIRED: 'LEASE_EXPIRED',
  UNUSED_NODE_LEASE_RELEASED: 'LEASE_RELEASED',
  BACKEND_DISPATCH_INTENT: 'DISPATCH_STARTED',
  WORKER_CANDIDATE_SUBMITTED: 'CANDIDATE_SUBMITTED',
  INDEPENDENT_VERIFICATION_PASSED: 'VERIFY_PASSED',
  INDEPENDENT_REVIEW_PASSED: 'REVIEW_PASSED',
  YIELD_REASSESS: 'YIELD_REASSESS',
  EXTERNAL_BLOCKER: 'EXTERNAL_BLOCKER',
  UNKNOWN_EFFECT_QUARANTINED: 'UNKNOWN_EFFECT',
  UNKNOWN_RESOLVED_NO_EFFECT: 'UNKNOWN_RESOLVED',
  ROOT_INTEGRATION_RECORDED: 'ROOT_INTEGRATED',
  CYCLE_DEADLINE_EXHAUSTED: 'DEADLINE_EXHAUSTED',
  NODE_DEADLINE_EXHAUSTED: 'DEADLINE_EXHAUSTED',
  IMPLEMENTATION_SCOPE_BLOCKED: 'SCOPE_BLOCKED',
  CLAIM_BLOCKED_SCOPE: 'SCOPE_BLOCKED',
  CLAIM_BLOCKED_STALE_BASELINE: 'STALE_BASELINE',
  CLAIM_BLOCKED_STALE_CANDIDATE: 'STALE_CANDIDATE',
});

const CI_CODES = Object.freeze({
  CI_ACCEPTED: 'PASS',
  CI_CHECK_NOT_ACCEPTED: 'FAIL',
  CI_CHECK_STATE_UNKNOWN: 'UNKNOWN',
  CI_PENDING: 'PENDING',
  NO_CHECK_RESULTS: 'PENDING',
  EXPECTED_CHECKS_NOT_REPORTED: 'PENDING',
  REQUIRED_CHECKS_NOT_GREEN: 'PENDING',
});

const SAFE_CODE = /^[A-Z][A-Z0-9_-]{0,95}$/;
const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const SAFE_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SAFE_EVENT_NAME = /^[A-Z][A-Z0-9_-]{0,79}$/;
const SUPERVISOR_STATUSES = new Set(['INTAKE_BOUND', 'INTAKE_WAITING', 'INTAKE_REASSESSMENT_REQUIRED',
  'HOLD_TRUSTED_BINDING', 'HOLD_REVIEW_REQUIRED', 'HOLD_AMBIGUOUS_ROADMAP', 'HOLD_DEPENDENCY',
  'HOLD_TASK_STATUS', 'HOLD_SCOPE_CONFLICT', 'HOLD_PREFLIGHT', 'HOLD_RECONCILE',
  'HOLD_REASSESSMENT_REQUIRED', 'HOLD_INTAKE_IN_PROGRESS', 'HOLD_COLLISION', 'HOLD_NO_READY_TASK',
  'HOLD_NOT_ALLOWED', 'HOLD_ENVIRONMENT', 'HOLD_REPOSITORY', 'HOLD_CAMPAIGN', 'HOLD_BASE',
  'HOLD_ROADMAP', 'HOLD_CONTROLLER_STATE', 'HOLD_SCOPE', 'HOLD_USAGE',
  'READY_CANDIDATE', 'ALREADY_COMPLETE',
  'BASE_ADVANCED_RESUME_PREPARED', 'BASE_ADVANCED_RESUME_REASSESSMENT_REQUIRED', 'BASE_ADVANCED_RESUME_REASSESSMENT_QUEUED',
  'PREPARED_BASE_RESUME_ACCEPTED', 'PREPARED_BASE_RESUME_REASSESSMENT_REQUIRED', 'PREPARED_RESUME_REASSESSMENT_QUEUED',
  'ROOT_PREPARATION_REASSESSMENT_REQUIRED', 'PAUSED_DEADLINE', 'DISPATCH_BLOCKED', 'RUNNING', 'YIELD_REASSESS',
  'DELIVERY_REASSESSMENT_REQUIRED', 'PUSHED', 'PR_CREATED', 'MERGED', 'WAITING_CI', 'WAITING_PR_HEAD_UPDATE',
  'WAITING_DRAFT', 'WAITING_REVIEW', 'WAITING_MERGEABILITY', 'WAITING_MERGE_QUEUE', 'WAITING_BASE_UPDATE',
  'WAITING_RETRY_BACKOFF', 'REPLAN_REQUIRED', 'ROOT_REPLAN_PAUSED', 'PULL_REQUEST_CLOSED_UNMERGED',
  'REMOTE_BRANCH_DIVERGED', 'UNKNOWN_EFFECT', 'BLOCKED', 'BUSY', 'RECONCILED_APPLIED', 'UNKNOWN']);
const SUPERVISOR_RECEIPT_FIELDS = new Set(['schemaVersion', 'taskId', 'cycleNo', 'kind', 'status', 'baseCommit',
  'candidateHeadCommit', 'observedAt', 'previousDigest', 'receiptDigest']);
const INTAKE_STATUSES = new Set(['READY_CANDIDATE', 'ALREADY_COMPLETE', 'INTAKE_WAITING', 'INTAKE_REASSESSMENT_REQUIRED',
  'HOLD_TRUSTED_BINDING', 'HOLD_REVIEW_REQUIRED', 'HOLD_AMBIGUOUS_ROADMAP', 'HOLD_DEPENDENCY',
  'HOLD_TASK_STATUS', 'HOLD_SCOPE_CONFLICT', 'HOLD_PREFLIGHT', 'HOLD_RECONCILE',
  'HOLD_REASSESSMENT_REQUIRED', 'HOLD_INTAKE_IN_PROGRESS', 'HOLD_COLLISION', 'HOLD_NO_READY_TASK',
  'HOLD_NOT_ALLOWED', 'HOLD_ENVIRONMENT', 'HOLD_REPOSITORY', 'HOLD_CAMPAIGN', 'HOLD_BASE',
  'HOLD_ROADMAP', 'HOLD_CONTROLLER_STATE', 'HOLD_SCOPE', 'HOLD_USAGE']);
const INTAKE_CODES = new Set(['TASK_PLAN_SHAPE_INVALID', 'ROOT_DOMAIN_OR_FEATURE_KEY_MISSING',
  'ROOT_DOMAIN_OR_FEATURE_KEY_INVALID', 'ROOT_DOMAIN_OR_FEATURE_KEY_NOT_NORMALIZED', 'TASK_PLAN_FIELDS_MISSING',
  'TASK_PLAN_SCOPE_INVALID', 'TASK_PLAN_CHECK_INVALID', 'TASK_NOT_IN_CANONICAL_SOURCES',
  'TASK_SOURCE_AMBIGUOUS', 'CANONICAL_ACCEPTANCE_NOT_BOUND', 'ROADMAP_DONE', 'TASK_NOT_PLANNED',
  'DEPENDENCIES_UNACCEPTED', 'TASK_NOT_IN_ROOT_ALLOWLIST', 'NO_ALLOWED_READY_TASK',
  'NO_UNEXCLUDED_READY_TASK', 'ACTIVE_WRITE_SCOPE_CONFLICT', 'TASK_ALREADY_HAS_INTAKE_RECEIPT',
  'ROOT_RECONCILIATION_REQUIRED', 'DURABLE_RECEIPT_RECONCILIATION_REQUIRED',
  'INTAKE_INTERRUPTED_RECONCILIATION_REQUIRED', 'DURABLE_RECEIPT_STATE_MISMATCH_RECONCILIATION_REQUIRED',
  'AUTOMATIC_PREFLIGHT_BLOCKED', 'TASK_INTAKE_READY', 'INTAKE_CLAIMED', 'INTAKE_LOCK_EXISTS',
  'INTAKE_LOCK_FAILED', 'SCOPE_HOLD_CHANGED_DURING_REASSESSMENT', 'CONTROLLER_STATE_UNREADABLE',
  'TASK_ALREADY_REGISTERED', 'WORKTREE_PARENT_ESCAPE', 'WORKTREE_OR_BRANCH_EXISTS',
  'WORKTREE_BASELINE_MISMATCH', 'INTAKE_EFFECT_REASSESSMENT', 'NO_READY_TASK', 'ROADMAP_TABLE_AMBIGUOUS',
  'CANONICAL_ROADMAP_UNAVAILABLE', 'GIT_COMMAND_FAILED', 'INTAKE_ERROR', 'EXCLUDE_TASK_IDS_INVALID',
  'EXCLUDE_TASK_ID_NOT_ALLOWED', 'CAMPAIGN_SCHEMA_INVALID', 'CAMPAIGN_BINDING_INVALID',
  'CAMPAIGN_TASK_ALLOWLIST_INVALID', 'UNEXPECTED_TASK_PLAN', 'CAMPAIGN_BASE_UNAVAILABLE',
  'CAMPAIGN_FILE_MISSING', 'CAMPAIGN_OUTSIDE_PRIVATE_ROOT', 'CAMPAIGN_FIELD_INVALID',
  'CAMPAIGN_READ_FAILED', 'CAMPAIGN_JSON_INVALID', 'CAMPAIGN_CHANGED_DURING_READ',
  'TASK_ID_INVALID', 'INTAKE_SOURCE_INVALID', 'INTAKE_SOURCE_UNAVAILABLE', 'INTAKE_RESULT_INVALID']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

function asMillis(value) {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function iso(value) {
  const time = asMillis(value);
  return time === null ? null : new Date(time).toISOString();
}

function safeCode(value) {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : 'UNKNOWN';
}

function safeTaskId(value) {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : 'UNKNOWN';
}

function rowJson(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function safeCommit(value) {
  return typeof value === 'string' && SAFE_HASH.test(value) ? value.toLowerCase() : null;
}

function safeStatus(value) {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : 'UNKNOWN';
}

function emptyCampaignIntake(state = 'NOT_CAPTURED', reason = null) {
  return {
    state,
    freshness: 'UNKNOWN',
    status: state === 'NOT_CAPTURED' ? 'NOT_CAPTURED' : 'UNKNOWN',
    code: INTAKE_CODES.has(reason) ? reason : null,
    observedAt: null,
    ageMs: null,
    source: 'LOCAL_ROADMAP_INTAKE',
    proofScope: 'LOCAL_ONLY',
    authorityGrant: false,
    dispatchAllowed: false,
    selectedTaskId: null,
    candidates: [],
  };
}

function projectCampaignIntake(value, nowMs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !['SNAPSHOT', 'NOT_CAPTURED', 'UNKNOWN'].includes(value.state)) return emptyCampaignIntake('UNKNOWN', 'INTAKE_RESULT_INVALID');
  if (value.state !== 'SNAPSHOT') return emptyCampaignIntake(value.state, value.code);
  const observedAt = typeof value.observedAt === 'string' ? iso(value.observedAt) : null;
  const capturedMs = observedAt === null ? null : asMillis(observedAt);
  if (capturedMs === null || capturedMs > nowMs) return emptyCampaignIntake('UNKNOWN', 'INTAKE_RESULT_INVALID');
  const ageMs = nowMs - capturedMs;
  const candidates = Array.isArray(value.candidates) ? value.candidates.slice(0, 25).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const taskId = safeTaskId(item.taskId);
    if (taskId === 'UNKNOWN') return [];
    return [{ taskId,
      status: INTAKE_STATUSES.has(item.status) ? item.status : 'UNKNOWN',
      code: INTAKE_CODES.has(item.code) ? item.code : 'UNKNOWN' }];
  }) : [];
  return {
    state: 'SNAPSHOT',
    freshness: ageMs <= MAX_INTAKE_SNAPSHOT_AGE_MS ? 'FRESH' : 'STALE',
    status: INTAKE_STATUSES.has(value.status) ? value.status : 'UNKNOWN',
    code: INTAKE_CODES.has(value.code) ? value.code : 'UNKNOWN',
    observedAt,
    ageMs,
    source: 'LOCAL_ROADMAP_INTAKE',
    proofScope: 'LOCAL_ONLY',
    authorityGrant: false,
    dispatchAllowed: false,
    selectedTaskId: value.selectedTaskId === null || value.selectedTaskId === undefined
      ? null : (safeTaskId(value.selectedTaskId) === 'UNKNOWN' ? null : safeTaskId(value.selectedTaskId)),
    candidates,
  };
}

function eventPayload(event) {
  const payload = rowJson(event.payload_json);
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

export function verifyControllerEventChain(events, storedHead) {
  if (!Array.isArray(events) || typeof storedHead !== 'string') throw new Error('CONTROLLER_EVENT_CHAIN_INVALID');
  let previous = 'GENESIS';
  let expectedSequence = 1;
  for (const event of events) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence !== expectedSequence++ || typeof event.event_type !== 'string'
        || typeof event.occurred_at !== 'string' || typeof event.payload_json !== 'string'
        || typeof event.previous_hash !== 'string' || typeof event.event_hash !== 'string') {
      throw new Error('CONTROLLER_EVENT_CHAIN_INVALID');
    }
    const expected = sha256([
      previous,
      event.sequence,
      event.task_id ?? '',
      event.cycle_no ?? '',
      event.event_type,
      event.occurred_at,
      event.payload_json,
    ].join('\n')).toLowerCase();
    if (event.previous_hash !== previous || event.event_hash !== expected) throw new Error('CONTROLLER_EVENT_CHAIN_INVALID');
    previous = event.event_hash;
  }
  if (storedHead !== previous) throw new Error('CONTROLLER_EVENT_CHAIN_INVALID');
  return { state: 'VERIFIED', count: events.length, headDigest: sha256(previous) };
}

function heartbeatProof(events, node, nowMs) {
  const proof = events.filter((event) => event.task_id === node.task_id
    && event.cycle_no === node.cycle_no && event.event_type === 'NODE_LEASE_HEARTBEAT')
    .slice().reverse().map((event) => ({ event, payload: eventPayload(event) }))
    .find(({ payload }) => payload
      && payload.nodeId === node.node_id
      && payload.ownerId === node.lease_owner
      && payload.fencingEpoch === node.lease_epoch
      && payload.expiresAt === node.lease_expires_at);
  if (!proof) return { state: 'UNKNOWN', heartbeatAt: null, ageMs: null, active: false };
  const heartbeatAt = proof.event.occurred_at;
  const heartbeatMs = asMillis(heartbeatAt);
  const expiryMs = asMillis(node.lease_expires_at);
  if (heartbeatMs === null || expiryMs === null || heartbeatMs > nowMs || expiryMs <= nowMs) {
    return { state: 'EXPIRED', heartbeatAt: iso(heartbeatAt), ageMs: heartbeatMs === null ? null : Math.max(0, nowMs - heartbeatMs), active: false };
  }
  const ageMs = nowMs - heartbeatMs;
  if (ageMs > MAX_HEARTBEAT_AGE_MS) return { state: 'STALE', heartbeatAt: iso(heartbeatAt), ageMs, active: false };
  return { state: 'FRESH', heartbeatAt: iso(heartbeatAt), ageMs, active: true };
}

function hashSupervisorReceipt(receipt) {
  const { receiptDigest, ...payload } = receipt;
  return sha256(JSON.stringify(payload));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) { return JSON.stringify(stableValue(value)); }

function readGithubCiReceipts(common, runs) {
  const privateRoot = path.join(common, 'zuri-delivery-control');
  const privateStat = lstatSync(privateRoot);
  if (!privateStat.isDirectory() || privateStat.isSymbolicLink()) throw new Error('CONTROLLER_PRIVATE_ROOT_INVALID');
  const privateReal = realpathSync.native(privateRoot);
  if (!inside(common, privateReal)) throw new Error('CONTROLLER_PRIVATE_ROOT_INVALID');
  const privateEntries = readdirSync(privateReal, { withFileTypes: true });
  if (!privateEntries.some((entry) => entry.name === 'github-delivery-v1')) {
    return { state: 'NOT_CAPTURED', receipts: [], events: [] };
  }
  const deliveryRoot = path.join(privateReal, 'github-delivery-v1');
  const deliveryStat = lstatSync(deliveryRoot);
  if (!deliveryStat.isDirectory() || deliveryStat.isSymbolicLink()) throw new Error('GITHUB_RECEIPT_ROOT_INVALID');
  const deliveryReal = realpathSync.native(deliveryRoot);
  if (!inside(privateReal, deliveryReal)) throw new Error('GITHUB_RECEIPT_PATH_INVALID');
  const deliveryEntries = readdirSync(deliveryReal, { withFileTypes: true });
  if (!deliveryEntries.some((entry) => entry.name === 'receipts')) {
    return { state: 'VERIFIED_EMPTY', receipts: [], events: [] };
  }
  const receiptRoot = path.join(deliveryReal, 'receipts');
  const rootEntries = readdirSync(receiptRoot, { withFileTypes: true });
  const rootNames = new Set(rootEntries.map((entry) => entry.name));
  const rootStat = lstatSync(receiptRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('GITHUB_RECEIPT_ROOT_INVALID');
  const rootReal = realpathSync.native(receiptRoot);
  if (!inside(privateReal, rootReal)) throw new Error('GITHUB_RECEIPT_PATH_INVALID');
  const receipts = [];
  const events = [];
  const readFile = (file, taskId, cycleNo, legacy = false) => {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('GITHUB_RECEIPT_PATH_INVALID');
    const realFile = realpathSync.native(file);
    if (!inside(rootReal, realFile)) throw new Error('GITHUB_RECEIPT_PATH_INVALID');
    const text = readFileSync(realFile, 'utf8');
    if (!text.endsWith('\n')) throw new Error('GITHUB_RECEIPT_TAIL_INCOMPLETE');
    const lines = text.split(/\r?\n/).filter(Boolean);
    let previousHash = 'GENESIS';
    let campaignDigest = null;
    let sequence = 0;
    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { throw new Error('GITHUB_RECEIPT_INVALID_JSON'); }
      const { hash, ...body } = record;
      if (record.schemaVersion !== 'github-delivery-receipt/v1'
          || record.taskId !== taskId
          || !/^[a-f0-9]{64}$/.test(record.campaignDigest ?? '')
          || (campaignDigest !== null && record.campaignDigest !== campaignDigest)
          || record.sequence !== ++sequence
          || record.previousHash !== previousHash
          || typeof hash !== 'string'
          || hash !== createHash('sha256').update(stableJson(body)).digest('hex')) {
        throw new Error('GITHUB_RECEIPT_CHAIN_INVALID');
      }
      campaignDigest ??= record.campaignDigest;
      previousHash = hash;
      if (record.eventType !== 'CI_OBSERVED') continue;
      const evidence = record.evidence;
      const exactHeadCommit = safeCommit(evidence?.headRefOid);
      const baseCommit = safeCommit(evidence?.baseRefOid);
      if (!exactHeadCommit || !baseCommit) throw new Error('GITHUB_CI_RECEIPT_BINDING_INVALID');
      if (!legacy) {
        const expectedRevision = createHash('sha256').update(`${taskId}\n${baseCommit}\n${exactHeadCommit}`).digest('hex');
        if (path.basename(file, '.jsonl') !== expectedRevision) throw new Error('GITHUB_CI_RECEIPT_REVISION_INVALID');
      }
      const result = evidence?.result ?? {};
      const code = typeof result.code === 'string' ? result.code : '';
      const state = CI_CODES[code] ?? 'UNKNOWN';
      const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0;
      const counts = {
        passed: safeCount(Array.isArray(result.checked) ? result.checked.filter((item) => item?.bucket === 'pass').length : 0),
        failed: safeCount(result.failures?.length),
        pending: safeCount(result.pending?.length ?? result.missing?.length),
        unknown: safeCount(result.unknown?.length),
      };
      const observedAt = iso(record.occurredAt);
      receipts.push({ taskId, cycleNo, exactHeadCommit, baseCommit, state, observedAt,
        receiptDigest: hash.toUpperCase(), checks: counts });
      if (observedAt) events.push({ taskId, cycleNo, role: 'delivery', kind: 'CI_OBSERVED',
        observedAt, status: state, sequence: record.sequence, exactHeadCommit, baseCommit });
    }
  };

  for (const run of runs) {
    const taskId = safeTaskId(run.task_id);
    if (taskId === 'UNKNOWN') continue;
    const taskHash = createHash('sha256').update(taskId).digest('hex');
    const legacyName = `${taskHash}.jsonl`;
    if (rootNames.has(legacyName)) readFile(path.join(rootReal, legacyName), taskId, run.current_cycle, true);
    if (!rootNames.has(taskHash)) continue;
    const taskDirectory = path.join(rootReal, taskHash);
    const directoryStat = lstatSync(taskDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('GITHUB_RECEIPT_DIRECTORY_INVALID');
    const directoryReal = realpathSync.native(taskDirectory);
    if (!inside(rootReal, directoryReal)) throw new Error('GITHUB_RECEIPT_PATH_INVALID');
    for (const entry of readdirSync(directoryReal, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.jsonl$/.test(entry.name)) throw new Error('GITHUB_RECEIPT_ENTRY_INVALID');
      readFile(path.join(directoryReal, entry.name), taskId, run.current_cycle);
    }
  }
  return { state: receipts.length ? 'VERIFIED' : 'VERIFIED_EMPTY', receipts, events };
}

export function verifySupervisorObservations(records) {
  if (!Array.isArray(records)) return { state: 'INVALID', events: [], ciReceipts: [] };
  const accepted = [];
  let previousDigest = 'LEGACY';
  let started = false;
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return { state: 'INVALID', events: [], ciReceipts: [] };
    }
    if (!Object.prototype.hasOwnProperty.call(record, 'schemaVersion')) continue;
    if (record.schemaVersion !== 'supervisor-observation/v1') {
      return { state: 'INVALID', events: [], ciReceipts: [] };
    }
    if (!started) started = true;
    const keys = Object.keys(record);
    const taskId = record.taskId === null ? null : safeTaskId(record.taskId);
    const cycleNo = record.cycleNo === null ? null : record.cycleNo;
    const observedAt = typeof record.observedAt === 'string' ? iso(record.observedAt) : null;
    const validFields = keys.length === SUPERVISOR_RECEIPT_FIELDS.size
      && keys.every((key) => SUPERVISOR_RECEIPT_FIELDS.has(key))
      && (record.taskId === null || taskId !== 'UNKNOWN')
      && (cycleNo === null || (Number.isSafeInteger(cycleNo) && cycleNo > 0 && taskId !== null))
      && (taskId !== null || (cycleNo === null && record.baseCommit === null && record.candidateHeadCommit === null))
      && (cycleNo !== null || (record.baseCommit === null && record.candidateHeadCommit === null))
      && record.kind === 'SUPERVISOR_STATUS'
      && SUPERVISOR_STATUSES.has(record.status)
      && (record.baseCommit === null || safeCommit(record.baseCommit) !== null)
      && (record.candidateHeadCommit === null || safeCommit(record.candidateHeadCommit) !== null)
      && observedAt !== null
      && observedAt === record.observedAt
      && typeof record.previousDigest === 'string'
      && typeof record.receiptDigest === 'string'
      && /^[A-F0-9]{64}$/.test(record.receiptDigest);
    if (!validFields || record.previousDigest !== previousDigest || record.receiptDigest !== hashSupervisorReceipt(record)) {
      return { state: 'INVALID', events: [], ciReceipts: [] };
    }
    previousDigest = record.receiptDigest;
    accepted.push({
      taskId,
      cycleNo,
      observedAt,
      kind: record.kind,
      role: 'delivery',
      status: record.status,
    });
  }
  return {
    state: started ? 'VERIFIED' : 'NOT_CAPTURED',
    events: accepted,
    ciReceipts: [],
  };
}

export function projectWorkerObservability({ runs = [], events = [], supervisor = {}, ciReceiptSource = 'NOT_CAPTURED',
  campaignIntake = emptyCampaignIntake(), tags = [], localStatus = {}, now = new Date(), since = null } = {}) {
  const nowMs = asMillis(now);
  if (nowMs === null) throw new TypeError('A valid snapshot time is required.');
  const heartbeatEvents = events;
  const assignmentRows = [];
  const taskRows = new Map();
  const latestCiByTask = new Map();

  for (const receipt of supervisor.ciReceipts ?? []) {
    const current = latestCiByTask.get(`${receipt.taskId}:${receipt.cycleNo}`);
    if (!current || (asMillis(receipt.observedAt) ?? 0) >= (asMillis(current.observedAt) ?? 0)) {
      latestCiByTask.set(`${receipt.taskId}:${receipt.cycleNo}`, receipt);
    }
  }

  for (const run of runs) {
    if (!Number.isSafeInteger(run.current_cycle) || run.current_cycle < 1) continue;
    const taskId = safeTaskId(run.task_id);
    if (taskId === 'UNKNOWN') continue;
    const task = {
      taskId,
      cycleNo: run.current_cycle,
      state: safeStatus(run.state),
      baseCommit: safeCommit(run.base_commit),
      candidateHeadCommit: safeCommit(run.candidate_head_commit),
      updatedAt: iso(run.updated_at),
      stages: [],
    };
    const rowKey = `${taskId}:${run.current_cycle}`;
    const rawStages = Array.isArray(run.stages) ? run.stages : [];
    for (const node of rawStages) {
      const role = ['worker', 'verifier', 'reviewer'].includes(node.role) ? node.role : 'unknown';
      const status = safeStatus(node.state);
      const activeState = ['RUNNING', 'LEASED'].includes(status);
      const proof = activeState ? heartbeatProof(heartbeatEvents, { ...node, task_id: run.task_id,
        cycle_no: run.current_cycle }, nowMs) : { state: 'NOT_ACTIVE', heartbeatAt: null, ageMs: null, active: false };
      const queued = status === 'READY';
      const checkedHeadCommit = role === 'worker'
        ? safeCommit(node.candidate_head_commit ?? run.candidate_head_commit)
        : safeCommit(node.required_head_commit ?? node.candidate_head_commit ?? run.candidate_head_commit);
      const stage = {
        taskId,
        cycleNo: run.current_cycle,
        role,
        stage: safeStatus(node.stage),
        state: status,
        attempt: Number.isSafeInteger(node.attempt) && node.attempt >= 0 ? node.attempt : 0,
        checkedHeadCommit,
        lease: proof,
        active: proof.active,
        queued,
        localCheck: { state: 'NOT_CAPTURED', scope: 'LOCAL_ONLY', receiptDigest: null },
        contextMemory: { state: 'NOT_CAPTURED', sourceKindCounts: [], digest: null },
      };
      task.stages.push(stage);
      assignmentRows.push(stage);
    }

    const ciReceipt = latestCiByTask.get(rowKey);
    if (ciReceipt) {
      const exact = ciReceipt.exactHeadCommit === task.candidateHeadCommit && ciReceipt.baseCommit === task.baseCommit;
      task.ci = {
        state: exact && ['PASS', 'FAIL', 'PENDING', 'UNKNOWN'].includes(ciReceipt.state) ? ciReceipt.state : 'STALE',
        scope: 'LOCAL_RECEIPT',
        observedAt: iso(ciReceipt.observedAt),
        exactHeadCommit: safeCommit(ciReceipt.exactHeadCommit),
        baseCommit: safeCommit(ciReceipt.baseCommit),
        checks: ciReceipt.checks && typeof ciReceipt.checks === 'object'
          ? { passed: Number.isSafeInteger(ciReceipt.checks.passed) ? ciReceipt.checks.passed : 0,
            failed: Number.isSafeInteger(ciReceipt.checks.failed) ? ciReceipt.checks.failed : 0,
            pending: Number.isSafeInteger(ciReceipt.checks.pending) ? ciReceipt.checks.pending : 0,
            unknown: Number.isSafeInteger(ciReceipt.checks.unknown) ? ciReceipt.checks.unknown : 0 }
          : { passed: 0, failed: 0, pending: 0, unknown: 0 },
      };
    } else {
      task.ci = { state: 'NOT_CAPTURED', scope: 'LOCAL_RECEIPT', observedAt: null,
        exactHeadCommit: null, baseCommit: null, checks: { passed: 0, failed: 0, pending: 0, unknown: 0 } };
    }
    taskRows.set(rowKey, task);
  }

  assignmentRows.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.cycleNo - b.cycleNo || a.stage.localeCompare(b.stage));
  const assignments = assignmentRows.map((row, index) => ({ assignmentRef: `worker-${String(index + 1).padStart(3, '0')}`, ...row }));
  const activeAssignments = assignments.filter((item) => item.active);
  const activeTaskCount = new Set(activeAssignments.map((item) => `${item.taskId}:${item.cycleNo}`)).size;
  const queuedCount = assignments.filter((item) => item.queued).length;
  const unresolvedRunState = runs.some((run) => {
    const runState = safeStatus(run.state);
    const activeNodes = Array.isArray(run.stages)
      ? run.stages.filter((node) => ACTIVE_NODE_STATES.has(safeStatus(node.state)))
      : [];
    const taskId = safeTaskId(run.task_id);
    const cycleNo = run.current_cycle;
    const validIdentity = taskId !== 'UNKNOWN' && Number.isSafeInteger(cycleNo) && cycleNo > 0;
    if (!validIdentity) return ACTIVE_RUN_STATES.has(runState) || activeNodes.length > 0;

    const matchingActiveNodes = activeNodes.filter((node) =>
      safeTaskId(node.task_id) === taskId && node.cycle_no === cycleNo);
    const mismatchedActiveNodes = activeNodes.some((node) =>
      safeTaskId(node.task_id) !== taskId || node.cycle_no !== cycleNo);
    return mismatchedActiveNodes
      || (ACTIVE_RUN_STATES.has(runState) && matchingActiveNodes.length === 0);
  });
  const unresolvedActiveState = unresolvedRunState
    || assignments.some((item) => ACTIVE_NODE_STATES.has(item.state) && !item.active);
  const mode = unresolvedActiveState ? 'UNKNOWN'
    : activeAssignments.length === 0 ? 'IDLE' : activeTaskCount >= 2 ? 'SWARM' : 'SOLO';

  const safeEvents = [];
  for (const event of events) {
    const kind = EVENT_KINDS[event.event_type];
    const occurredAt = iso(event.occurred_at);
    const taskId = event.task_id === null ? null : safeTaskId(event.task_id);
    if (!kind || !occurredAt || (event.task_id !== null && taskId === 'UNKNOWN')) continue;
    const payload = eventPayload(event) ?? {};
    const role = payload.role === 'worker' || payload.role === 'verifier' || payload.role === 'reviewer' ? payload.role : null;
    const nodeId = payload.nodeId;
    const stage = ['worker', 'verifier', 'reviewer'].includes(nodeId) ? nodeId : null;
    safeEvents.push({
      taskId,
      cycleNo: Number.isSafeInteger(event.cycle_no) && event.cycle_no > 0 ? event.cycle_no : null,
      kind,
      role: role ?? stage,
      observedAt: occurredAt,
      status: kind === 'UNKNOWN_EFFECT' || kind === 'EXTERNAL_BLOCKER' || kind === 'SCOPE_BLOCKED'
        ? 'BLOCKED'
        : kind === 'VERIFY_PASSED' || kind === 'REVIEW_PASSED' ? 'PASSED' : 'OBSERVED',
      sequence: Number.isSafeInteger(event.sequence) ? event.sequence : null,
    });
  }
  for (const event of supervisor.events ?? []) {
    const task = event.kind === 'CI_OBSERVED' ? taskRows.get(`${event.taskId}:${event.cycleNo}`) : null;
    const bindingMatches = task && event.exactHeadCommit === task.candidateHeadCommit && event.baseCommit === task.baseCommit;
    safeEvents.push({
      taskId: event.taskId === null ? null : safeTaskId(event.taskId),
      cycleNo: Number.isSafeInteger(event.cycleNo) && event.cycleNo > 0 ? event.cycleNo : null,
      role: event.role === 'delivery' ? 'delivery' : null,
      kind: SAFE_EVENT_NAME.test(event.kind ?? '') ? event.kind : 'UNKNOWN',
      observedAt: iso(event.observedAt),
      status: event.kind === 'CI_OBSERVED' && !bindingMatches ? 'STALE'
        : ['PASS', 'FAIL', 'PENDING', 'UNKNOWN'].includes(event.status) ? event.status : 'OBSERVED',
      sequence: Number.isSafeInteger(event.sequence) ? event.sequence : null,
    });
  }
  safeEvents.sort((a, b) => (asMillis(b.observedAt) ?? 0) - (asMillis(a.observedAt) ?? 0));
  const sinceMs = asMillis(since);
  const eventsSinceOpen = safeEvents.filter((event) => sinceMs === null || (asMillis(event.observedAt) ?? 0) >= sinceMs).slice(0, 200);

  const tagRows = Array.isArray(tags) ? tags : Array.isArray(tags.items) ? tags.items : [];
  const safeTags = tagRows.filter((tag) => typeof tag.name === 'string' && SAFE_TAG.test(tag.name)
    && safeCommit(tag.objectId)).map((tag) => ({
      name: tag.name,
      objectId: safeCommit(tag.objectId),
      createdAt: iso(tag.createdAt),
    })).sort((a, b) => a.name.localeCompare(b.name));

  const tagSetFingerprint = typeof tags.fingerprint === 'string' && /^[A-F0-9]{64}$/i.test(tags.fingerprint)
    ? tags.fingerprint.toUpperCase()
    : tags.truncated === true ? null
      : sha256(JSON.stringify(safeTags.map(({ name, objectId }) => [name, objectId])));

  return {
    schemaVersion: WORKER_OBSERVABILITY_SCHEMA_VERSION,
    state: 'LIVE',
    freshness: 'SNAPSHOT',
    observedAt: new Date(nowMs).toISOString(),
    source: { kind: 'LOCAL_DELIVERY_CONTROLLER', proofScope: 'LOCAL_ONLY', controllerLiveness: 'NOT_CAPTURED', eventChain: 'VERIFIED',
      supervisorReceipts: supervisor.state ?? 'NOT_CAPTURED', roadmapIntake: campaignIntake.state ?? 'NOT_CAPTURED', ciReceipts: ciReceiptSource },
    summary: { activeWorkers: activeAssignments.length, queuedWorkers: queuedCount, activeTasks: activeTaskCount, mode },
    tasks: [...taskRows.values()].sort((a, b) => a.taskId.localeCompare(b.taskId) || a.cycleNo - b.cycleNo),
    assignments,
    events: eventsSinceOpen,
    campaignIntake: projectCampaignIntake(campaignIntake, nowMs),
    localTags: safeTags,
    localTagCount: Number.isSafeInteger(tags.totalCount) ? tags.totalCount : safeTags.length,
    localTagsTruncated: tags.truncated === true,
    localTagSetFingerprint: tagSetFingerprint,
    localStatus: {
      changedFiles: Number.isSafeInteger(localStatus.changedFiles) ? localStatus.changedFiles : null,
      fingerprint: typeof localStatus.fingerprint === 'string' && /^[A-F0-9]{64}$/.test(localStatus.fingerprint) ? localStatus.fingerprint : null,
      headCommit: safeCommit(localStatus.headCommit),
      observedAt: iso(localStatus.observedAt ?? nowMs),
    },
  };
}

function rootFromGit(repoRoot) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repoRoot, shell: false,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, shell: false,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  return { root: realpathSync.native(root), common: realpathSync.native(common) };
}

function readControllerLedger(databasePath, nowMs) {
  if (!existsSync(databasePath)) throw new Error('CONTROLLER_SOURCE_ABSENT');
  const stat = lstatSync(databasePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('CONTROLLER_SOURCE_INVALID');
  const realFile = realpathSync.native(databasePath);
  const db = new DatabaseSync(realFile, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; BEGIN');
    const version = db.prepare("SELECT value FROM controller_meta WHERE key='schemaVersion'").get()?.value;
    if (version !== 'delivery-controller/v1') throw new Error('CONTROLLER_SCHEMA_UNSUPPORTED');
    const rawEvents = db.prepare(`SELECT sequence,task_id,cycle_no,event_type,occurred_at,payload_json,previous_hash,event_hash
      FROM delivery_events ORDER BY sequence`).all();
    const storedHead = db.prepare("SELECT value FROM controller_meta WHERE key='eventChainHead'").get()?.value;
    const chain = verifyControllerEventChain(rawEvents, storedHead);
    const rows = db.prepare(`SELECT r.task_id,r.state,r.current_cycle,r.base_commit,r.initial_head_commit,r.candidate_head_commit,r.updated_at,
        c.state AS cycle_state,n.node_id,n.stage,n.role,n.state AS node_state,n.attempt,n.lease_epoch,n.lease_owner,n.lease_expires_at,
        n.required_head_commit,n.candidate_head_commit AS node_candidate_head_commit
      FROM delivery_runs r
      LEFT JOIN delivery_cycles c ON c.task_id=r.task_id AND c.cycle_no=r.current_cycle
      LEFT JOIN delivery_nodes n ON n.task_id=r.task_id AND n.cycle_no=r.current_cycle
      ORDER BY r.created_at,r.task_id,n.created_at,n.node_id`).all();
    const grouped = new Map();
    for (const row of rows) {
      const key = row.task_id;
      let run = grouped.get(key);
      if (!run) {
        run = { task_id: row.task_id, state: row.state, current_cycle: row.current_cycle,
          base_commit: row.base_commit, initial_head_commit: row.initial_head_commit,
          candidate_head_commit: row.candidate_head_commit, updated_at: row.updated_at,
          cycle_state: row.cycle_state, stages: [] };
        grouped.set(key, run);
      }
      if (!row.node_id) continue;
      run.stages.push({ task_id: row.task_id, cycle_no: row.current_cycle, node_id: row.node_id,
        stage: row.stage, role: row.role, state: row.node_state, attempt: row.attempt,
        lease_epoch: row.lease_epoch, lease_owner: row.lease_owner, lease_expires_at: row.lease_expires_at,
        required_head_commit: row.required_head_commit, candidate_head_commit: row.node_candidate_head_commit });
    }
    const events = rawEvents.map((event) => ({ ...event }));
    return { chain, runs: [...grouped.values()], events };
  } finally {
    try { db.exec('ROLLBACK'); } catch {}
    db.close();
  }
}

function gitRead(root, args) {
  return execFileSync('git', args, { cwd: root, shell: false, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 10_000 });
}

function readLocalTags(root, now) {
  const output = gitRead(root, ['for-each-ref', '--sort=refname', '--format=%(refname:short)%09%(objectname)%09%(creatordate:iso-strict)', 'refs/tags']);
  const rows = output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, objectId, createdAt] = line.split('\t');
    return { name, objectId, createdAt };
  }).filter((row) => row.name && row.objectId);
  const limit = 200;
  const fingerprint = sha256(JSON.stringify(rows.map(({ name, objectId }) => [name, objectId.toLowerCase()])));
  return { totalCount: rows.length, truncated: rows.length > limit, fingerprint,
    items: rows.slice(-limit).map((row) => ({ ...row, createdAt: iso(row.createdAt) })) };
}

function readLocalStatus(root, now) {
  const status = gitRead(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  const changedFiles = status.split('\0').filter(Boolean).length;
  const headCommit = gitRead(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const fingerprint = sha256(`${headCommit}\n${status}`);
  return { changedFiles, fingerprint, headCommit, observedAt: new Date(now).toISOString() };
}

function inside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function readControllerLiveness(common, nowMs) {
  const privateRoot = path.join(common, 'zuri-delivery-control');
  const controllerRoot = path.join(privateRoot, 'controller-v1');
  const heartbeatFile = path.join(controllerRoot, 'controller-liveness.json');
  let privateStat;
  let controllerStat;
  let heartbeatStat;
  try { privateStat = lstatSync(privateRoot); } catch (error) {
    if (error.code === 'ENOENT') throw new Error('CONTROLLER_HEARTBEAT_ABSENT');
    throw error;
  }
  if (!privateStat.isDirectory() || privateStat.isSymbolicLink()) throw new Error('CONTROLLER_HEARTBEAT_INVALID');
  const privateReal = realpathSync.native(privateRoot);
  if (!inside(common, privateReal)) throw new Error('CONTROLLER_HEARTBEAT_INVALID');
  try { controllerStat = lstatSync(controllerRoot); } catch (error) {
    if (error.code === 'ENOENT') throw new Error('CONTROLLER_HEARTBEAT_ABSENT');
    throw error;
  }
  if (!controllerStat.isDirectory() || controllerStat.isSymbolicLink()) throw new Error('CONTROLLER_HEARTBEAT_INVALID');
  const controllerReal = realpathSync.native(controllerRoot);
  if (!inside(privateReal, controllerReal)) throw new Error('CONTROLLER_HEARTBEAT_INVALID');
  try { heartbeatStat = lstatSync(heartbeatFile); } catch (error) {
    if (error.code === 'ENOENT') throw new Error('CONTROLLER_HEARTBEAT_ABSENT');
    throw error;
  }
  if (!heartbeatStat.isFile() || heartbeatStat.isSymbolicLink()) throw new Error('CONTROLLER_HEARTBEAT_INVALID');
  const heartbeatReal = realpathSync.native(heartbeatFile);
  if (!inside(controllerReal, heartbeatReal)) throw new Error('CONTROLLER_HEARTBEAT_INVALID');

  let heartbeat;
  try { heartbeat = JSON.parse(readFileSync(heartbeatReal, 'utf8')); }
  catch { throw new Error('CONTROLLER_HEARTBEAT_INVALID'); }
  if (!heartbeat || heartbeat.schemaVersion !== 'controller-liveness/v1'
      || !Number.isSafeInteger(heartbeat.processId) || heartbeat.processId < 1
      || typeof heartbeat.heartbeatAt !== 'string') throw new Error('CONTROLLER_HEARTBEAT_INVALID');
  const heartbeatMs = asMillis(heartbeat.heartbeatAt);
  if (heartbeatMs === null || new Date(heartbeatMs).toISOString() !== heartbeat.heartbeatAt || heartbeatMs > nowMs) {
    throw new Error('CONTROLLER_HEARTBEAT_INVALID');
  }
  const ageMs = nowMs - heartbeatMs;
  if (ageMs > MAX_HEARTBEAT_AGE_MS) throw new Error('CONTROLLER_HEARTBEAT_STALE');
  try { process.kill(heartbeat.processId, 0); }
  catch (error) {
    if (error?.code === 'ESRCH') throw new Error('CONTROLLER_PROCESS_ABSENT');
    if (error?.code === 'EPERM') throw new Error('CONTROLLER_PROCESS_UNVERIFIABLE');
    throw new Error('CONTROLLER_PROCESS_UNVERIFIABLE');
  }
}

function readRoadmapIntake(common, nowMs) {
  const privateRoot = path.join(common, 'zuri-delivery-control');
  const intakeRoot = path.join(privateRoot, 'roadmap-intake-v1');
  const databasePath = path.join(intakeRoot, 'intake.sqlite');
  let privateStat;
  try { privateStat = lstatSync(privateRoot); } catch (error) {
    if (error.code === 'ENOENT') return emptyCampaignIntake();
    return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_UNAVAILABLE');
  }
  if (!privateStat.isDirectory() || privateStat.isSymbolicLink()) return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_INVALID');
  let privateReal;
  try { privateReal = realpathSync.native(privateRoot); } catch { return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_UNAVAILABLE'); }
  if (!inside(common, privateReal)) return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_INVALID');
  let intakeStat;
  try { intakeStat = lstatSync(intakeRoot); } catch (error) {
    if (error.code === 'ENOENT') return emptyCampaignIntake();
    return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_UNAVAILABLE');
  }
  if (!intakeStat.isDirectory() || intakeStat.isSymbolicLink()) return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_INVALID');
  let intakeReal;
  try { intakeReal = realpathSync.native(intakeRoot); } catch { return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_UNAVAILABLE'); }
  if (!inside(privateReal, intakeReal)) return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_INVALID');
  let databaseStat;
  try { databaseStat = lstatSync(databasePath); } catch (error) {
    if (error.code === 'ENOENT') return emptyCampaignIntake();
    return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_UNAVAILABLE');
  }
  if (!databaseStat.isFile() || databaseStat.isSymbolicLink()) return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_INVALID');
  let databaseReal;
  try { databaseReal = realpathSync.native(databasePath); } catch { return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_UNAVAILABLE'); }
  if (!inside(intakeReal, databaseReal)) return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_INVALID');

  let db;
  try {
    db = new DatabaseSync(databaseReal, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000; BEGIN');
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='intake_evaluations'").get();
    if (!table) return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_INVALID');
    const row = db.prepare('SELECT result_json,created_at FROM intake_evaluations ORDER BY created_at DESC,input_digest DESC LIMIT 1').get();
    if (!row) return emptyCampaignIntake();
    if (typeof row.result_json !== 'string' || typeof row.created_at !== 'string') {
      return emptyCampaignIntake('UNKNOWN', 'INTAKE_RESULT_INVALID');
    }
    let result;
    try { result = JSON.parse(row.result_json); } catch { return emptyCampaignIntake('UNKNOWN', 'INTAKE_RESULT_INVALID'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)
        || result.schemaVersion !== 'roadmap-intake-result/v1'
        || result.authorityGrant !== false || result.dispatchAllowed !== false || result.checksExecuted !== false) {
      return emptyCampaignIntake('UNKNOWN', 'INTAKE_RESULT_INVALID');
    }
    const capturedMs = asMillis(row.created_at);
    if (capturedMs === null || new Date(capturedMs).toISOString() !== row.created_at || capturedMs > nowMs) {
      return emptyCampaignIntake('UNKNOWN', 'INTAKE_RESULT_INVALID');
    }
    return projectCampaignIntake({ state: 'SNAPSHOT', status: result.status, code: result.code,
      observedAt: row.created_at, selectedTaskId: result.selectedTaskId ?? null,
      candidates: Array.isArray(result.candidates) ? result.candidates : [] }, nowMs);
  } catch {
    return emptyCampaignIntake('UNKNOWN', 'INTAKE_SOURCE_UNAVAILABLE');
  } finally {
    db?.close();
  }
}

function readSupervisorObservations(common) {
  const privateRoot = path.join(common, 'zuri-delivery-control');
  const supervisorRoot = path.join(privateRoot, 'supervisors');
  if (!existsSync(supervisorRoot)) return { state: 'NOT_CAPTURED', events: [], ciReceipts: [] };
  const records = [];
  let invalid = false;
  for (const entry of readdirSync(supervisorRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SAFE_TAG.test(entry.name)) continue;
    const file = path.join(supervisorRoot, entry.name, 'events.jsonl');
    try {
      const real = realpathSync.native(file);
      if (!inside(realpathSync.native(privateRoot), real) || !lstatSync(file).isFile()) { invalid = true; continue; }
      const lines = readFileSync(real, 'utf8').split(/\r?\n/).filter(Boolean);
      const parsed = lines.map((line) => JSON.parse(line));
      const verified = verifySupervisorObservations(parsed);
      if (verified.state === 'INVALID') invalid = true;
      else records.push(verified);
    } catch (error) {
      if (error.code !== 'ENOENT') invalid = true;
    }
  }
  if (invalid) return { state: 'INVALID', events: [], ciReceipts: [] };
  const verified = records.flatMap((item) => item.events);
  const ciReceipts = records.flatMap((item) => item.ciReceipts);
  return { state: records.some((item) => item.state === 'VERIFIED') ? 'VERIFIED' : 'NOT_CAPTURED',
    events: verified, ciReceipts };
}

function unavailableSnapshot(reason, now = new Date(), { supervisor = {}, campaignIntake = emptyCampaignIntake(), since = null } = {}) {
  const observedAt = iso(now) ?? new Date().toISOString();
  const sinceMs = asMillis(since);
  const events = (supervisor.state === 'INVALID' ? [] : Array.isArray(supervisor.events) ? supervisor.events : [])
    .filter((event) => sinceMs === null || (asMillis(event.observedAt) ?? 0) >= sinceMs)
    .sort((a, b) => (asMillis(b.observedAt) ?? 0) - (asMillis(a.observedAt) ?? 0))
    .slice(0, 200);
  const intake = projectCampaignIntake(campaignIntake, asMillis(observedAt) ?? Date.now());
  return {
    schemaVersion: WORKER_OBSERVABILITY_SCHEMA_VERSION,
    state: 'UNKNOWN',
    freshness: 'UNKNOWN',
    observedAt,
    reason: safeCode(reason),
    source: { kind: 'LOCAL_DELIVERY_CONTROLLER', proofScope: 'LOCAL_ONLY', controllerLiveness: 'UNKNOWN', eventChain: 'UNKNOWN',
      supervisorReceipts: supervisor.state === 'VERIFIED' ? 'VERIFIED' : supervisor.state === 'INVALID' ? 'UNKNOWN' : 'NOT_CAPTURED',
      roadmapIntake: intake.state, ciReceipts: 'UNKNOWN' },
    summary: { activeWorkers: 0, queuedWorkers: 0, activeTasks: 0, mode: 'UNKNOWN' },
    tasks: [], assignments: [], events, campaignIntake: intake, localTags: [], localTagCount: 0, localTagsTruncated: false, localTagSetFingerprint: null,
    localStatus: { changedFiles: null, fingerprint: null, headCommit: null, observedAt },
  };
}

export function readWorkerObservability({ repoRoot = process.cwd(), since = null, now = () => new Date() } = {}) {
  const snapshotTime = now();
  const nowMs = asMillis(snapshotTime);
  if (nowMs === null) return unavailableSnapshot('INVALID_SNAPSHOT_TIME', new Date());
  let campaignIntake = emptyCampaignIntake();
  let supervisor = {};
  try {
    const paths = rootFromGit(repoRoot);
    campaignIntake = readRoadmapIntake(paths.common, nowMs);
    supervisor = readSupervisorObservations(paths.common);
    if (supervisor.state === 'INVALID') return unavailableSnapshot('SUPERVISOR_SOURCE_INVALID', new Date(nowMs), { supervisor, campaignIntake, since });
    try { readControllerLiveness(paths.common, nowMs); }
    catch (error) { return unavailableSnapshot(error?.code ?? error?.message ?? 'CONTROLLER_SOURCE_UNAVAILABLE', new Date(nowMs), { supervisor, campaignIntake, since }); }
    const databasePath = path.join(paths.common, 'zuri-delivery-control', 'controller-v1.sqlite');
    const ledger = readControllerLedger(databasePath, nowMs);
    const githubCi = readGithubCiReceipts(paths.common, ledger.runs);
    const tags = readLocalTags(paths.root, nowMs);
    const localStatus = readLocalStatus(paths.root, nowMs);
    const snapshot = projectWorkerObservability({ runs: ledger.runs, events: ledger.events,
      supervisor: { ...supervisor, events: [...supervisor.events, ...githubCi.events],
        ciReceipts: [...supervisor.ciReceipts, ...githubCi.receipts] }, ciReceiptSource: githubCi.state,
      campaignIntake,
      tags: { ...tags, totalCount: tags.totalCount, truncated: tags.truncated }, localStatus,
      now: new Date(nowMs), since });
    snapshot.source.controllerLiveness = 'VERIFIED';
    return snapshot;
  } catch (error) {
    return unavailableSnapshot(error?.code ?? error?.message ?? 'CONTROLLER_SOURCE_UNAVAILABLE', new Date(nowMs), { supervisor, campaignIntake, since });
  }
}

export function readControllerEventProjection({ repoRoot = process.cwd(), since = null, now = () => new Date() } = {}) {
  const snapshot = readWorkerObservability({ repoRoot, since, now });
  if (snapshot.state !== 'LIVE') throw new Error('CONTROLLER_EVENT_SOURCE_UNAVAILABLE');
  return snapshot.events;
}

export function createControllerEventReader(repoRoot, readProjection = readControllerEventProjection) {
  return () => readProjection({ repoRoot });
}

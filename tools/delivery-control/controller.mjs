import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openControllerStore, repositoryPaths } from './controller-store.mjs';
import { validatePreparedReceiptPath } from './base-advanced-resume.mjs';

const ROLES = Object.freeze([
  { nodeId: 'worker', stage: 'WORKER_IMPLEMENTATION', role: 'worker' },
  { nodeId: 'verifier', stage: 'INDEPENDENT_VERIFY', role: 'verifier' },
  { nodeId: 'reviewer', stage: 'INDEPENDENT_REVIEW', role: 'reviewer' },
]);
const FAILURE_CLASSES = new Set([
  'METADATA_DEFECT', 'IMPLEMENTATION_FAILURE', 'EXTERNAL_BLOCKER', 'UNKNOWN_EFFECT',
  'IDENTICAL_SEMANTIC_NO_PROGRESS_AT_CAP', 'KNOWN_TRANSIENT_TOOL_ERROR', 'STALE_BASELINE',
]);
const EFFECT_STATES = new Set(['NONE', 'APPLIED', 'PARTIAL', 'UNKNOWN']);
const ROOT_ADMISSION_RUN_STATES = new Set(['PAUSED_BUDGET_EXHAUSTED', 'PAUSED_DEADLINE', 'BLOCKED_BY_ROOT', 'YIELD_REASSESS']);

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function json(value) { return JSON.stringify(value); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function normalizeText(value) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value; }
function normalizeDomainOrFeatureKey(value) {
  if (!nonempty(value)) throw new TypeError('Trusted root binding requires domainOrFeatureKey.');
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '-');
  if (normalized.length > 160
      || !/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/.test(normalized)) {
    throw new TypeError('Trusted root domainOrFeatureKey must be a normalized slash-separated key.');
  }
  return normalized;
}
function normalizeSemantic(value) {
  if (Array.isArray(value)) return value.map(normalizeSemantic);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeSemantic(value[key])]));
  return normalizeText(value);
}
function stableJson(value) { return JSON.stringify(normalizeSemantic(value)); }
export function semanticTaskDigest(taskRecord) { return sha256(stableJson(taskRecord)); }

function git(repoRoot, args, { allowFailure = false, encoding = 'utf8' } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot, shell: false, encoding,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    if (allowFailure) return null;
    throw new Error('git ' + args[0] + ' failed: ' + (error.stderr?.toString?.() || error.message));
  }
}

function parseNul(value) { return value.split('\0').filter(Boolean); }
function pathKey(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function normalizeScopePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new TypeError('writeScope entries must be repository-relative forward-slash paths.');
  }
  const isDirectory = value.endsWith('/');
  const plain = isDirectory ? value.slice(0, -1) : value;
  if (!plain || plain.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('writeScope contains an unsafe path: ' + value);
  }
  return plain + (isDirectory ? '/' : '');
}
function scopeContains(scope, changed) {
  const canonicalScope = normalizeScopePath(scope);
  const canonicalChanged = changed.replaceAll('\\', '/');
  const scopeDirectory = canonicalScope.endsWith('/');
  const a = pathKey(scopeDirectory ? canonicalScope.slice(0, -1) : canonicalScope);
  const b = pathKey(canonicalChanged);
  return scopeDirectory ? b === a || b.startsWith(a + '/') : b === a;
}
function scopesOverlap(left, right) {
  const leftDirectory = left.endsWith('/');
  const rightDirectory = right.endsWith('/');
  const a = pathKey(leftDirectory ? left.slice(0, -1) : left);
  const b = pathKey(rightDirectory ? right.slice(0, -1) : right);
  if (a === b) return true;
  return (leftDirectory && b.startsWith(a + '/')) || (rightDirectory && a.startsWith(b + '/'));
}
function scopeCoversScope(allowed, requested) {
  const allowedDirectory = allowed.endsWith('/');
  const requestedDirectory = requested.endsWith('/');
  const a = pathKey(allowedDirectory ? allowed.slice(0, -1) : allowed);
  const b = pathKey(requestedDirectory ? requested.slice(0, -1) : requested);
  if (allowedDirectory) return a === b || b.startsWith(a + '/');
  return !requestedDirectory && a === b;
}

function nearestExisting(candidate, repoRoot) {
  let current = candidate;
  while (true) {
    try { lstatSync(current); return current; }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      if (path.resolve(current) === path.resolve(repoRoot)) return repoRoot;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function validateRepoPath(repoRoot, relative) {
  const slash = relative.replaceAll('\\', '/');
  if (!slash || slash.startsWith('/') || /^[A-Za-z]:/.test(slash) || slash.split('/').some((part) => !part || part === '.' || part === '..')) {
    return 'Changed path is not a safe repository-relative path.';
  }
  const absolute = path.resolve(repoRoot, ...slash.split('/'));
  const base = process.platform === 'win32' ? repoRoot.toLowerCase() : repoRoot;
  const target = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const rel = path.relative(base, target);
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) return 'Changed path escapes the repository.';
  try {
    const existing = nearestExisting(absolute, repoRoot);
    if (!existing) return 'Changed path has no repository-contained parent.';
    const real = realpathSync.native(existing);
    const realBase = process.platform === 'win32' ? repoRoot.toLowerCase() : repoRoot;
    const realTarget = process.platform === 'win32' ? real.toLowerCase() : real;
    const realRel = path.relative(realBase, realTarget);
    if (path.isAbsolute(realRel) || realRel === '..' || realRel.startsWith('..' + path.sep)) return 'Changed path traverses a symlink or junction outside the repository.';
    try {
      const resolved = realpathSync.native(absolute);
      const resolvedTarget = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      const resolvedRel = path.relative(realBase, resolvedTarget);
      if (path.isAbsolute(resolvedRel) || resolvedRel === '..' || resolvedRel.startsWith('..' + path.sep)) return 'Changed path traverses a symlink or junction outside the repository.';
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code) && error.code !== 'EINVAL') throw error;
    }
  } catch (error) {
    return error.message;
  }
  return null;
}

function statusEntries(repoRoot) {
  const raw = git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  return parseNul(raw).map((entry) => ({ status: entry.slice(0, 2), path: entry.slice(3) }));
}

function fileStateDigest(repoRoot, relative, status) {
  const absolute = path.resolve(repoRoot, ...relative.split('/'));
  let material;
  try {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) material = `symlink:${stat.mode}:${readlinkSync(absolute)}`;
    else if (stat.isFile()) material = `file:${stat.mode}:` + readFileSync(absolute).toString('base64');
    else if (stat.isDirectory()) material = `directory:${stat.mode}`;
    else material = `other:${stat.mode}:${stat.size}`;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    material = 'deleted';
  }
  return sha256(status + '\n' + material);
}

function isAncestor(repoRoot, ancestor, descendant) {
  const result = git(repoRoot, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true });
  if (result !== null) return true;
  return git(repoRoot, ['rev-parse', '--verify', ancestor + '^{commit}'], { allowFailure: true }) !== null
    && git(repoRoot, ['rev-parse', '--verify', descendant + '^{commit}'], { allowFailure: true }) !== null
    && git(repoRoot, ['merge-base', ancestor, descendant], { allowFailure: true }) === ancestor;
}

function pathInside(root, candidate) {
  const base = pathKey(root);
  const target = pathKey(candidate);
  const relative = path.relative(base, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function readPreparedBaseResumeReceipt({ store, run, taskRecord, baseline, preparedBaseReceiptFile }) {
  if (!nonempty(preparedBaseReceiptFile)) throw new Error('PREPARED_BASE_RECEIPT_REQUIRED');
  let resolvedFile;
  const privateRoot = path.join(store.gitCommonDir, 'zuri-delivery-control');
  try { resolvedFile = validatePreparedReceiptPath({ privateRoot, receiptFile: preparedBaseReceiptFile,
    taskId: taskRecord.taskId }); }
  catch (error) {
    if (error.code === 'BASE_ADVANCED_PREPARED_RECEIPT_PATH_MISSING') throw new Error('PREPARED_BASE_RECEIPT_MISSING');
    if (error.code === 'BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED') throw new Error('PREPARED_BASE_RECEIPT_PATH_REDIRECTED');
    throw new Error('PREPARED_BASE_RECEIPT_MUST_BE_PRIVATE');
  }
  const resolvedPrivateRoot = realpathSync(privateRoot);

  let bytes;
  let receipt;
  try {
    bytes = readFileSync(resolvedFile);
    receipt = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch { throw new Error('PREPARED_BASE_RECEIPT_INVALID_JSON'); }
  if (!isRecord(receipt) || receipt.schemaVersion !== 'root-base-prepared-candidate/v1'
      || receipt.taskId !== taskRecord.taskId || receipt.taskId !== run.task_id
      || receipt.cycleNo !== run.current_cycle
      || !nonempty(receipt.reason) || !nonempty(receipt.evidenceRef)
      || ![receipt.oldHeadCommit, receipt.headCommit, receipt.oldBaseCommit, receipt.newBaseCommit]
        .every((sha) => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('PREPARED_BASE_RECEIPT_SCHEMA_INVALID');
  }
  const retainedHead = run.candidate_head_commit ?? run.initial_head_commit;
  if (receipt.oldHeadCommit !== retainedHead || receipt.oldBaseCommit !== run.base_commit) {
    throw new Error('PREPARED_BASE_RECEIPT_OLD_RUN_MISMATCH');
  }
  if (receipt.oldHeadCommit === receipt.headCommit || receipt.oldBaseCommit === receipt.newBaseCommit
      || receipt.newBaseCommit !== baseline.baseRevision || receipt.newBaseCommit !== baseline.base) {
    throw new Error('PREPARED_BASE_RECEIPT_BASELINE_MISMATCH');
  }
  return {
    receipt,
    receiptPath: path.relative(resolvedPrivateRoot, resolvedFile).split(path.sep).join('/'),
    receiptDigest: sha256(bytes),
  };
}

function validatePreparedBaseResume({ repoRoot, run, receipt, current, baseline }) {
  if (receipt.headCommit !== current.headCommit || receipt.headCommit !== baseline.headRevision
      || current.branch !== run.branch || !current.clean || current.violations.length) {
    throw new Error('PREPARED_BASE_RECEIPT_RESULTING_CANDIDATE_MISMATCH');
  }
  for (const [ancestor, descendant] of [
    [receipt.oldBaseCommit, receipt.newBaseCommit],
    [receipt.oldHeadCommit, receipt.headCommit],
    [receipt.newBaseCommit, receipt.headCommit],
  ]) {
    if (!isAncestor(repoRoot, ancestor, descendant)) throw new Error('PREPARED_BASE_RECEIPT_ANCESTRY_MISMATCH');
  }
}

function gitSnapshot(repoRoot, baseCommit, writeScope) {
  const headCommit = git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const branch = git(repoRoot, ['branch', '--show-current']).trim();
  if (!branch || branch.toLowerCase() === 'main') throw new Error('A named non-main task branch is required.');
  if (!isAncestor(repoRoot, baseCommit, headCommit)) throw new Error('The accepted task base is not an ancestor of the current HEAD.');
  const committedPaths = parseNul(git(repoRoot, ['diff', '--name-only', '--no-renames', '-z', baseCommit, headCommit]));
  const dirtyEntries = statusEntries(repoRoot);
  if (git(repoRoot, ['ls-files', '-u', '-z'])) throw new Error('The worktree contains unresolved index stages.');
  const dirtyPaths = dirtyEntries.map((entry) => entry.path);
  const changedPaths = [...new Set([...committedPaths, ...dirtyPaths])].sort((a, b) => a.localeCompare(b));
  const normalizedScopes = writeScope.map(normalizeScopePath);
  const violations = [];
  for (const changed of changedPaths) {
    const pathError = validateRepoPath(repoRoot, changed);
    if (pathError) violations.push({ path: changed, reason: pathError });
    if (!normalizedScopes.some((scope) => scopeContains(scope, changed))) {
      violations.push({ path: changed, reason: 'Changed path is outside the admitted writeScope.' });
    }
  }
  const stateDigest = dirtyEntries.map(({ status, path: changed }) => [changed, status, fileStateDigest(repoRoot, changed, status)]);
  const digest = sha256(stableJson({ headCommit, stateDigest }));
  return { headCommit, branch, baseCommit, committedPaths, dirtyPaths, changedPaths, digest, clean: dirtyPaths.length === 0, violations };
}

function nowIso(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Controller clock returned an invalid time.');
  return date.toISOString();
}
function addMinutes(timestamp, minutes) { return new Date(new Date(timestamp).getTime() + minutes * 60_000).toISOString(); }

function readPolicy(repoRoot) {
  const filename = path.join(repoRoot, 'docs', 'architecture', 'delivery-control', 'contracts', 'model-policy.json');
  const policy = JSON.parse(readFileSync(filename, 'utf8'));
  if (policy.runtimeBoundary?.agentProcedurePolicy !== 'ACTIVE_V4'
      || policy.ordinaryPreflight?.status !== 'ACTIVE'
      || policy.ordinaryPreflight?.enabled !== true) {
    throw new Error('Active v4 ordinary-preflight policy is missing or disabled.');
  }
  const limits = policy.retryAndLineage?.limits;
  const positive = [
    limits?.maxOccurrencesPerNoProgressFingerprint,
    limits?.maxSubmissionAttemptsPerExecutionCycle,
    limits?.maxImplementationRepairRoundsPerExecutionCycle,
    limits?.maxToolRetriesPerExecutionCycle,
    limits?.maxRunDurationMinutesPerExecutionCycle,
    limits?.maxNodeDurationMinutesPerExecutionCycle,
  ];
  if (positive.some((value) => !Number.isSafeInteger(value) || value < 1)) throw new Error('Active v4 delivery caps are unavailable or invalid.');
  if (policy.sessionIdentity?.workerVerifierReviewerMustBeDifferentSessions !== true
      || policy.sessionIdentity?.verifierAndReviewerMustBeDifferentSessions !== true) {
    throw new Error('Distinct worker, verifier, and reviewer session policy is not active.');
  }
  const concurrency = policy.concurrency;
  if (![concurrency?.agentSlotsMaximum, concurrency?.rootSlots, concurrency?.workerSlotsMaximum,
    concurrency?.gateSlots, concurrency?.unverifiedSubmissionQueueMaximum].every(Number.isSafeInteger)
      || concurrency.agentSlotsMaximum < 1 || concurrency.rootSlots < 0
      || concurrency.workerSlotsMaximum < 1 || concurrency.gateSlots < 1
      || concurrency.unverifiedSubmissionQueueMaximum < 1
      || concurrency.agentSlotsMaximum < concurrency.rootSlots + concurrency.workerSlotsMaximum + concurrency.gateSlots) {
    throw new Error('Active v4 role concurrency capacities are unavailable or invalid.');
  }
  return policy;
}

function rolePolicy(policy, role) {
  const key = role === 'verifier' ? 'verify' : role === 'reviewer' ? 'review' : 'worker';
  const selected = policy.models?.[key];
  if (!nonempty(selected?.model) || !nonempty(selected?.reasoningEffort)) throw new Error('The active model policy does not define ' + role + '.');
  return selected;
}

function safeJson(value, label) {
  if (!isRecord(value)) throw new TypeError(label + ' must be a JSON object.');
  return json(value);
}

function checkMandateBinding(binding, taskRecord, repoRoot) {
  if (!isRecord(binding)
      || binding.resolvedBy !== 'root'
      || binding.taskId !== taskRecord.taskId
      || !nonempty(binding.sourceRef)
      || !nonempty(binding.objective)
      || !nonempty(binding.domainOrFeatureKey)
      || !Array.isArray(binding.writeScope)
      || !Array.isArray(binding.authorizedEffects)
      || !Array.isArray(binding.prohibitions)) {
    throw new TypeError('Root must provide an explicit trusted mandate binding with task, objective, scope, source, effects, and prohibitions.');
  }
  let boundRepo;
  try { boundRepo = realpathSync.native(path.resolve(binding.repositoryRoot)); }
  catch { throw new TypeError('Trusted mandate binding must name its repositoryRoot.'); }
  if (pathKey(boundRepo) !== pathKey(repoRoot)) throw new TypeError('Trusted mandate binding repository does not match this controller.');
  if (normalizeText(binding.objective) !== normalizeText(taskRecord.objective)) throw new TypeError('Task objective does not match the root-bound objective.');
  const scopes = binding.writeScope.map(normalizeScopePath);
  for (const scope of taskRecord.writeScope.map(normalizeScopePath)) {
    if (!scopes.some((allowed) => scopeCoversScope(allowed, scope))) {
      throw new TypeError('Task writeScope exceeds the trusted root binding.');
    }
  }
  if (binding.authorizedEffects.some((value) => !nonempty(value)) || binding.prohibitions.some((value) => !nonempty(value))) {
    throw new TypeError('Trusted effect and prohibition entries must be nonempty strings.');
  }
  return {
    sourceRef: binding.sourceRef,
    objective: normalizeText(binding.objective),
    domainOrFeatureKey: normalizeDomainOrFeatureKey(binding.domainOrFeatureKey),
    repositoryRoot: boundRepo,
    writeScope: scopes,
    authorizedEffects: binding.authorizedEffects.map(normalizeText),
    prohibitions: binding.prohibitions.map(normalizeText),
    digest: sha256(stableJson(binding)),
  };
}

function requireTaskRecord(taskRecord) {
  if (!isRecord(taskRecord) || taskRecord.schemaVersion !== 'task-readiness/v1'
      || !nonempty(taskRecord.taskId) || !nonempty(taskRecord.objective)
      || !Array.isArray(taskRecord.acceptance) || !taskRecord.acceptance.length
      || !Array.isArray(taskRecord.writeScope) || !taskRecord.writeScope.length) {
    throw new TypeError('taskRecord is not a complete task-readiness/v1 record.');
  }
  taskRecord.writeScope.forEach(normalizeScopePath);
  if (taskRecord.acceptance.some((item) => !nonempty(item))) throw new TypeError('taskRecord acceptance criteria must be nonempty strings.');
}

function normalizedSessionId(result) { return result?.sessionId ?? result?.session?.id ?? null; }
function resultOutcome(result) { return result?.verdict ?? result?.outcome ?? result?.status ?? null; }
function resultHead(result) { return result?.exactHeadCommit ?? result?.headCommit ?? null; }
function evidenceReference(result) { return result?.evidenceRef ?? result?.resultDigest ?? result?.evidence?.reference ?? null; }

function rowJson(value) { return value ? JSON.parse(value) : null; }

function eventInTransaction(db, clock, taskId, cycleNo, eventType, payload) {
  const occurredAt = nowIso(clock);
  const previousHash = db.prepare("SELECT value FROM controller_meta WHERE key='eventChainHead'").get()?.value ?? 'GENESIS';
  const payloadJson = stableJson(payload);
  const sequence = db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM delivery_events').get().next;
  const eventHash = sha256([previousHash, sequence, taskId ?? '', cycleNo ?? '', eventType, occurredAt, payloadJson].join('\n'));
  db.prepare(`INSERT INTO delivery_events(sequence,task_id,cycle_no,event_type,occurred_at,payload_json,previous_hash,event_hash)
    VALUES(?,?,?,?,?,?,?,?)`).run(sequence, taskId ?? null, cycleNo ?? null, eventType, occurredAt, payloadJson, previousHash, eventHash);
  db.prepare("UPDATE controller_meta SET value=? WHERE key='eventChainHead'").run(eventHash);
  return occurredAt;
}

function priorRoleSessions(db, taskId, cycleNo, currentNodeId) {
  const history = db.prepare(`SELECT payload_json FROM delivery_events WHERE task_id=? AND cycle_no=? AND event_type='BACKEND_HANDLE_RECORDED' ORDER BY sequence`).all(taskId, cycleNo);
  return history.map((item) => rowJson(item.payload_json)).filter((payload) => payload?.nodeId !== currentNodeId && nonempty(payload?.sessionId));
}

function readAndVerifyEvents(db, { includeEvents = false } = {}) {
  const events = db.prepare('SELECT sequence,task_id,cycle_no,event_type,occurred_at,payload_json,previous_hash,event_hash FROM delivery_events ORDER BY sequence').all();
  let previous = 'GENESIS';
  for (const event of events) {
    const expected = sha256([previous, event.sequence, event.task_id ?? '', event.cycle_no ?? '', event.event_type, event.occurred_at, event.payload_json].join('\n'));
    if (event.previous_hash !== previous || event.event_hash !== expected) throw new Error('Controller event chain integrity check failed at sequence ' + event.sequence + '.');
    previous = event.event_hash;
  }
  const head = db.prepare("SELECT value FROM controller_meta WHERE key='eventChainHead'").get()?.value;
  if (head !== previous) throw new Error('Controller event chain head does not match its event history.');
  return includeEvents ? { count: events.length, head: previous, events } : { count: events.length, head: previous };
}

function exactIsoMilliseconds(value) {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function parseSafeIntegerText(value, { positive = false } = {}) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  let parsed;
  try { parsed = BigInt(value); } catch { return null; }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || (positive && parsed < 1n)) return null;
  return Number(parsed);
}

const MAX_WORKER_START_EVENT_SKEW_MS = 60_000;

function inspectCampaignDispatchHistoryInTransaction(db, taskIds, verifiedChain = null) {
  if (!Array.isArray(taskIds) || taskIds.some((taskId) => !nonempty(taskId))
      || new Set(taskIds).size !== taskIds.length) {
    throw new TypeError('Campaign dispatch-history inspection requires unique task IDs.');
  }
  const normalizedTaskIds = [...taskIds].sort();
  const selectedTaskIds = new Set(normalizedTaskIds);
  const chain = verifiedChain ?? readAndVerifyEvents(db, { includeEvents: true });
  const workerIntents = [];
  for (const event of chain.events) {
    if (event.event_type !== 'BACKEND_DISPATCH_INTENT' || !selectedTaskIds.has(event.task_id)) continue;
    let payload;
    try { payload = rowJson(event.payload_json); }
    catch { throw new Error('Campaign worker dispatch event payload is malformed.'); }
    if (!isRecord(payload) || payload.role !== 'worker') continue;
    const cycleNo = Number(event.cycle_no);
    const occurredAtMs = exactIsoMilliseconds(event.occurred_at);
    if (!Number.isSafeInteger(cycleNo) || cycleNo < 1 || occurredAtMs === null) {
      throw new Error('Campaign worker dispatch event identity or timestamp is invalid.');
    }
    workerIntents.push({ taskId: event.task_id, cycleNo, occurredAt: event.occurred_at,
      occurredAtMs, sequence: event.sequence });
  }
  workerIntents.sort((left, right) => left.occurredAtMs - right.occurredAtMs
    || left.sequence - right.sequence || left.taskId.localeCompare(right.taskId) || left.cycleNo - right.cycleNo);
  const intentsByCycle = new Map();
  for (const intent of workerIntents) {
    const key = `${intent.taskId}\n${intent.cycleNo}`;
    const intents = intentsByCycle.get(key) ?? [];
    intents.push(intent);
    intentsByCycle.set(key, intents);
  }
  const runs = [];
  const earliestByCycle = new Map();
  for (const taskId of normalizedTaskIds) {
    const run = db.prepare('SELECT task_id,CAST(current_cycle AS TEXT) AS current_cycle_text FROM delivery_runs WHERE task_id=?').get(taskId);
    if (!run) throw new Error(`Campaign dispatch history run is missing for ${taskId}.`);
    const currentCycle = parseSafeIntegerText(run.current_cycle_text, { positive: true });
    if (currentCycle === null) throw new Error(`Campaign dispatch history current cycle is invalid for ${taskId}.`);
    const cycles = db.prepare(`SELECT CAST(cycle_no AS TEXT) AS cycle_no_text,state,started_at,
      CAST(submissions AS TEXT) AS submissions_text FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no`).all(taskId);
    if (cycles.length !== currentCycle) throw new Error(`Campaign dispatch history is incomplete for ${taskId}.`);
    const cycleSummaries = [];
    for (let index = 0; index < cycles.length; index++) {
      const cycle = cycles[index];
      const cycleNo = parseSafeIntegerText(cycle.cycle_no_text, { positive: true });
      const submissions = parseSafeIntegerText(cycle.submissions_text);
      if (cycleNo !== index + 1) throw new Error(`Campaign dispatch history is not contiguous for ${taskId}.`);
      if (submissions === null) throw new Error('Execution cycle dispatch history has an invalid submission count.');
      const hasStartedAt = cycle.started_at !== null && cycle.started_at !== undefined;
      const startedAtMs = hasStartedAt ? exactIsoMilliseconds(cycle.started_at) : null;
      if (hasStartedAt && startedAtMs === null) throw new Error('Execution cycle dispatch history has an invalid start timestamp.');
      const key = `${taskId}\n${cycleNo}`;
      const intents = intentsByCycle.get(key) ?? [];
      if (intents.length !== submissions) {
        throw new Error('Execution cycle dispatch history does not match immutable worker dispatch events.');
      }
      if (hasStartedAt !== (submissions > 0)) {
        throw new Error('Execution cycle dispatch history is inconsistent: startedAt and submissions disagree.');
      }
      const firstIntent = intents[0] ?? null;
      if (firstIntent) {
        const skew = firstIntent.occurredAtMs - startedAtMs;
        if (skew < 0 || skew > MAX_WORKER_START_EVENT_SKEW_MS) {
          throw new Error('Execution cycle start timestamp does not match immutable worker dispatch events.');
        }
        earliestByCycle.set(key, firstIntent.occurredAt);
      }
      cycleSummaries.push({ cycleNo, state: cycle.state, submissions, startedAt: cycle.started_at ?? null,
        workerIntentCount: intents.length, firstWorkerIntentAt: firstIntent?.occurredAt ?? null });
    }
    runs.push({ taskId, currentCycle, cycles: cycleSummaries });
  }
  for (const intent of workerIntents) {
    if (!earliestByCycle.has(`${intent.taskId}\n${intent.cycleNo}`)) {
      throw new Error('Campaign worker dispatch event references an absent cycle.');
    }
  }
  const earliestWorkerIntentAt = workerIntents[0]?.occurredAt ?? null;
  return {
    schemaVersion: 'campaign-dispatch-history/v1',
    taskIds: normalizedTaskIds,
    runs,
    workerIntents: workerIntents.map(({ taskId, cycleNo, occurredAt, sequence }) => ({ taskId, cycleNo, occurredAt, sequence })),
    earliestWorkerIntentAt,
    eventCount: chain.count,
    eventHead: chain.head,
  };
}

function parseCampaignDeadlinePin(event) {
  let payload;
  try { payload = rowJson(event.payload_json); }
  catch { throw new Error('Campaign deadline pin payload is malformed.'); }
  if (event.task_id !== null || event.cycle_no !== null || !isRecord(payload)
      || payload.schemaVersion !== 'campaign-deadline-bound-pin/v1'
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(payload.campaignId ?? '')
      || !Array.isArray(payload.taskIds) || payload.taskIds.some((taskId) => !nonempty(taskId))
      || new Set(payload.taskIds).size !== payload.taskIds.length
      || !isDeepStrictEqual(payload.taskIds, [...payload.taskIds].sort())
      || !Number.isSafeInteger(payload.campaignDurationMinutes)
      || payload.campaignDurationMinutes < 1 || payload.campaignDurationMinutes > 120
      || exactIsoMilliseconds(payload.sourceDeadlineAt) === null
      || exactIsoMilliseconds(payload.effectiveDeadlineAt) === null
      || Date.parse(payload.effectiveDeadlineAt) > Date.parse(payload.sourceDeadlineAt)) {
    throw new Error('Campaign deadline pin history is invalid.');
  }
  return payload;
}

function reconcileCampaignDeadlineInTransaction(db, clock, { campaignId, taskIds, campaignDurationMinutes,
  checkpointDeadlineAt = null } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(campaignId ?? '')
      || !Array.isArray(taskIds) || taskIds.some((taskId) => !nonempty(taskId))
      || new Set(taskIds).size !== taskIds.length
      || !Number.isSafeInteger(campaignDurationMinutes) || campaignDurationMinutes < 1 || campaignDurationMinutes > 120) {
    throw new TypeError('Campaign deadline reconciliation requires a stable campaignId, unique task IDs, and pinned duration.');
  }
  const chain = readAndVerifyEvents(db, { includeEvents: true });
  const allPins = chain.events.filter((event) => event.event_type === 'CAMPAIGN_DEADLINE_BOUND_PINNED')
    .map((event) => ({ event, payload: parseCampaignDeadlinePin(event) }));
  const campaignPins = allPins.filter((item) => item.payload.campaignId === campaignId);
  const cumulativeTaskIds = [...new Set([
    ...taskIds,
    ...campaignPins.flatMap((item) => item.payload.taskIds),
  ])].sort();
  const conflictingPin = allPins.find(({ payload }) => payload.campaignId !== campaignId
    && payload.taskIds.some((taskId) => cumulativeTaskIds.includes(taskId)));
  if (conflictingPin) {
    const taskId = conflictingPin.payload.taskIds.find((id) => cumulativeTaskIds.includes(id));
    throw new Error(`Campaign deadline pin taskId ${taskId} is already pinned under campaignId ${conflictingPin.payload.campaignId}; overlapping campaigns are not allowed.`);
  }
  const history = inspectCampaignDispatchHistoryInTransaction(db, cumulativeTaskIds, chain);
  let previous = null;
  for (const item of campaignPins) {
    const { event, payload } = item;
    if (payload.campaignDurationMinutes !== campaignDurationMinutes) {
      throw new Error('Pinned campaign duration changed; reassessment is required.');
    }
    const precedingIntents = history.workerIntents.filter((intent) => payload.taskIds.includes(intent.taskId)
      && intent.sequence < event.sequence);
    const earliestPreceding = precedingIntents.reduce((earliest, intent) => earliest === null
      || Date.parse(intent.occurredAt) < Date.parse(earliest) ? intent.occurredAt : earliest, null);
    if (earliestPreceding === null) throw new Error('Campaign deadline pin has no verified worker dispatch source.');
    const sourceDeadlineAt = new Date(Date.parse(earliestPreceding)
      + campaignDurationMinutes * 60_000).toISOString();
    if (payload.sourceDeadlineAt !== sourceDeadlineAt) {
      throw new Error('Campaign deadline pin source does not match its immutable worker dispatch history.');
    }
    if (previous) {
      if (previous.payload.taskIds.some((taskId) => !payload.taskIds.includes(taskId))
          || Date.parse(payload.sourceDeadlineAt) > Date.parse(previous.payload.sourceDeadlineAt)
          || payload.effectiveDeadlineAt !== new Date(Math.min(Date.parse(previous.payload.effectiveDeadlineAt),
            Date.parse(payload.sourceDeadlineAt))).toISOString()) {
        throw new Error('Campaign deadline pin history attempted to extend or discard an earlier bound.');
      }
      if (stableJson(previous.payload) === stableJson(payload)) {
        throw new Error('Campaign deadline pin history contains a redundant no-op event.');
      }
    }
    previous = item;
  }
  const sourceDeadlineAt = history.earliestWorkerIntentAt === null ? null
    : new Date(Date.parse(history.earliestWorkerIntentAt) + campaignDurationMinutes * 60_000).toISOString();
  if (sourceDeadlineAt === null) {
    if (previous || checkpointDeadlineAt !== null && checkpointDeadlineAt !== undefined) {
      throw new Error('A campaign deadline or pin exists without a verified worker dispatch source.');
    }
    return { schemaVersion: 'campaign-deadline-reconciliation/v1', campaignId,
      taskIds: cumulativeTaskIds, campaignDurationMinutes, sourceDeadlineAt: null, effectiveDeadlineAt: null,
      eventCount: chain.count, eventHead: chain.head, changed: false };
  }
  let effectiveDeadlineAt;
  if (previous) {
    if (Date.parse(sourceDeadlineAt) > Date.parse(previous.payload.sourceDeadlineAt)) {
      throw new Error('Campaign deadline source moved later than its immutable pin.');
    }
    effectiveDeadlineAt = new Date(Math.min(Date.parse(previous.payload.effectiveDeadlineAt),
      Date.parse(sourceDeadlineAt))).toISOString();
  } else {
    const checkpointMs = exactIsoMilliseconds(checkpointDeadlineAt);
    effectiveDeadlineAt = checkpointMs !== null && checkpointMs <= Date.parse(sourceDeadlineAt)
      ? new Date(checkpointMs).toISOString() : sourceDeadlineAt;
  }
  const payload = { schemaVersion: 'campaign-deadline-bound-pin/v1', campaignId,
    taskIds: cumulativeTaskIds, campaignDurationMinutes, sourceDeadlineAt, effectiveDeadlineAt };
  const changed = !previous || stableJson(previous.payload) !== stableJson(payload);
  let eventHead = chain.head;
  let eventCount = chain.count;
  if (changed) {
    eventInTransaction(db, clock, null, null, 'CAMPAIGN_DEADLINE_BOUND_PINNED', payload);
    eventHead = db.prepare("SELECT value FROM controller_meta WHERE key='eventChainHead'").get()?.value ?? eventHead;
    eventCount++;
  }
  return { schemaVersion: 'campaign-deadline-reconciliation/v1', campaignId, taskIds: cumulativeTaskIds,
    campaignDurationMinutes, sourceDeadlineAt, effectiveDeadlineAt, eventCount, eventHead, changed };
}

function installCycleAdmissionLockEpoch(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec("INSERT OR IGNORE INTO controller_meta(key,value) VALUES ('resourceLockEpoch','0')");
    for (const [table, prefix] of [['delivery_write_locks', 'write'], ['delivery_domain_locks', 'domain']]) {
      for (const [operation, timing] of [['INSERT', 'insert'], ['UPDATE', 'update'], ['DELETE', 'delete']]) {
        db.exec(`CREATE TRIGGER IF NOT EXISTS ${prefix}_locks_epoch_${timing} AFTER ${operation} ON ${table} BEGIN
          UPDATE controller_meta SET value=CAST(value AS INTEGER)+1 WHERE key='resourceLockEpoch';
        END`);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function queryRuns(db, taskId = null) {
  return taskId
    ? [db.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId)].filter(Boolean)
    : db.prepare('SELECT * FROM delivery_runs ORDER BY created_at,task_id').all();
}

function nodeRows(db, taskId, cycleNo) {
  return db.prepare('SELECT * FROM delivery_nodes WHERE task_id=? AND cycle_no=? ORDER BY CASE stage WHEN \'WORKER_IMPLEMENTATION\' THEN 1 WHEN \'INDEPENDENT_VERIFY\' THEN 2 ELSE 3 END').all(taskId, cycleNo);
}

function runShape(db, row, { includeTaskRecord = false } = {}) {
  const cycles = db.prepare('SELECT * FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no').all(row.task_id);
  const current = cycles.find((item) => item.cycle_no === row.current_cycle) ?? null;
  const nodes = current ? nodeRows(db, row.task_id, row.current_cycle) : [];
  const blockers = [];
  if (row.state.startsWith('BLOCKED') || row.state === 'YIELD_REASSESS' || row.state === 'REPAIR_METADATA') {
    blockers.push({ code: row.state, resumable: true });
  }
  for (const node of nodes) {
    if (['BLOCKED', 'QUARANTINED'].includes(node.state)) blockers.push({ code: node.failure_class ?? node.state, stage: node.stage, resumable: node.state !== 'QUARANTINED' });
  }
  const changedPaths = rowJson(row.changed_paths_json) ?? [];
  const noProgress = db.prepare('SELECT fingerprint,occurrences,updated_at FROM delivery_no_progress WHERE task_id=? ORDER BY updated_at').all(row.task_id)
    .map((item) => ({ fingerprint: item.fingerprint, occurrences: item.occurrences, updatedAt: item.updated_at }));
  const stages = nodes.map((node) => ({
    nodeId: node.node_id,
    stage: node.stage,
    role: node.role,
    status: node.state,
    attempt: node.attempt,
    repairRound: node.repair_round,
    sessionId: node.session_id,
    model: node.model,
    effort: node.effort,
    exactHeadCommit: node.candidate_head_commit ?? node.required_head_commit,
    evidenceRef: rowJson(node.evidence_json)?.evidenceRef ?? null,
    effectState: node.effect_state,
    failureClass: node.failure_class,
    leaseEpoch: node.lease_epoch,
    leaseExpiresAt: node.lease_expires_at,
  }));
  const output = {
    taskId: row.task_id,
    state: row.state,
    currentCycle: row.current_cycle,
    objective: row.objective,
    branch: row.branch,
    baseCommit: row.base_commit,
    initialHeadCommit: row.initial_head_commit,
    candidateHeadCommit: row.candidate_head_commit,
    proofScope: rowJson(row.proof_scope_json) ?? [],
    changedFiles: {
      state: row.candidate_head_commit ? 'CANDIDATE_CAPTURED' : 'BASELINE_CAPTURED',
      paths: changedPaths,
      sourceRef: row.candidate_head_commit ?? row.initial_head_commit,
      snapshotDigest: row.candidate_snapshot_digest ?? row.initial_snapshot_digest,
    },
    dependencies: rowJson(row.dependencies_json) ?? [],
    noProgress,
    stages,
    blockers,
    cycles: cycles.map((cycle) => ({
      cycleNo: cycle.cycle_no,
      state: cycle.state,
      admittedAt: cycle.admitted_at,
      admissionReason: cycle.admission_reason,
      admission: rowJson(cycle.admission_evidence_json),
      startedAt: cycle.started_at,
      pausedAt: cycle.paused_at,
      submissions: cycle.submissions,
      implementationRepairs: cycle.implementation_repairs,
      toolRetries: cycle.tool_retries,
    })),
    rootIntegration: rowJson(row.root_integration_json),
    updatedAt: row.updated_at,
  };
  const latestResume = db.prepare(`SELECT payload_json FROM delivery_events
    WHERE task_id=? AND cycle_no=? AND event_type='TASK_RESUMED' ORDER BY sequence DESC LIMIT 1`)
    .get(row.task_id, row.current_cycle);
  const latestResumePayload = latestResume ? rowJson(latestResume.payload_json) : null;
  if (latestResumePayload?.preparedBaseResume) output.preparedBaseResume = latestResumePayload.preparedBaseResume;
  if (includeTaskRecord) {
    output.taskRecord = rowJson(row.task_json);
    output.taskRecordDigest = semanticTaskDigest(output.taskRecord);
    output.trustedMandateBinding = rowJson(row.trusted_mandate_json);
    output.worktreeRoot = row.worktree_root;
  }
  return output;
}

function insertNodes(db, taskId, cycleNo, taskDigest, now) {
  for (const [index, item] of ROLES.entries()) {
    db.prepare(`INSERT INTO delivery_nodes(task_id,cycle_no,node_id,stage,role,state,input_digest,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(taskId, cycleNo, item.nodeId, item.stage, item.role, index === 0 ? 'READY' : 'WAITING', taskDigest, now, now);
  }
}

function pathConflict(db, taskId, scopes, worktreeRoot = null) {
  if (worktreeRoot) {
    const occupied = db.prepare(`SELECT DISTINCT r.task_id,r.worktree_root FROM delivery_write_locks w
      JOIN delivery_runs r USING(task_id) WHERE w.task_id<>?`).all(taskId);
    const same = occupied.find((row) => pathKey(row.worktree_root) === pathKey(worktreeRoot));
    if (same) return { taskId: same.task_id, scope: 'WORKTREE_LOCK', requested: 'WORKTREE_LOCK' };
  }
  const locks = db.prepare('SELECT task_id,scope_path FROM delivery_write_locks WHERE task_id<>?').all(taskId);
  for (const scope of scopes) {
    for (const lock of locks) {
      if (scopesOverlap(scope, lock.scope_path)) return { taskId: lock.task_id, scope: lock.scope_path, requested: scope };
    }
  }
  return null;
}

function storedDomainOrFeatureKey(row) {
  const binding = row ? rowJson(row.trusted_mandate_json) : null;
  if (!isRecord(binding) || binding.domainOrFeatureKey === undefined || binding.domainOrFeatureKey === null) return null;
  return normalizeDomainOrFeatureKey(binding.domainOrFeatureKey);
}

function domainLockConflict(db, taskId, domainOrFeatureKey) {
  const owner = db.prepare(`SELECT task_id FROM delivery_domain_locks
    WHERE domain_or_feature_key=? AND task_id<>?`).get(domainOrFeatureKey, taskId);
  return owner ? { taskId: owner.task_id, scope: 'DOMAIN_OR_FEATURE_LOCK', requested: domainOrFeatureKey } : null;
}

function acquireDomainLock(db, taskId, domainOrFeatureKey) {
  const own = db.prepare('SELECT domain_or_feature_key FROM delivery_domain_locks WHERE task_id=?').get(taskId);
  if (own) {
    if (own.domain_or_feature_key !== domainOrFeatureKey) throw new Error('DOMAIN_LOCK_BINDING_MISMATCH');
    return null;
  }
  const conflict = domainLockConflict(db, taskId, domainOrFeatureKey);
  if (conflict) return conflict;
  db.prepare('INSERT INTO delivery_domain_locks(domain_or_feature_key,task_id) VALUES(?,?)').run(domainOrFeatureKey, taskId);
  return null;
}

function ensureActiveDomainLocks(db) {
  const rows = db.prepare(`SELECT run.task_id,run.state,run.current_cycle,run.trusted_mandate_json FROM delivery_runs AS run
    WHERE run.current_cycle>0 AND run.state<>'ABANDONED'
      AND (run.state<>'ROOT_INTEGRATED_PENDING_CI' OR EXISTS (
        SELECT 1 FROM delivery_domain_locks AS held WHERE held.task_id=run.task_id
      )) ORDER BY run.task_id`).all();
  for (const row of rows) {
    let domainOrFeatureKey;
    try { domainOrFeatureKey = storedDomainOrFeatureKey(row); }
    catch { throw new Error('ACTIVE_RUN_INVALID_DOMAIN_OR_FEATURE_KEY:' + row.task_id); }
    if (!domainOrFeatureKey) throw new Error('ACTIVE_RUN_MISSING_DOMAIN_OR_FEATURE_KEY:' + row.task_id);
    const conflict = acquireDomainLock(db, row.task_id, domainOrFeatureKey);
    if (conflict) throw new Error('ACTIVE_DOMAIN_OR_FEATURE_LOCK_CONFLICT:' + row.task_id + ':' + conflict.taskId);
  }
}

function releaseNodeLease(db, taskId, cycleNo, nodeId) {
  db.prepare(`UPDATE delivery_nodes SET lease_owner=NULL,lease_expires_at=NULL,updated_at=?
    WHERE task_id=? AND cycle_no=? AND node_id=?`).run(new Date().toISOString(), taskId, cycleNo, nodeId);
}

function requireLease(db, lease, expectedStates = ['LEASED', 'RUNNING'], at = new Date()) {
  if (!isRecord(lease) || !nonempty(lease.taskId) || !nonempty(lease.nodeId) || !nonempty(lease.ownerId)
      || !Number.isSafeInteger(lease.cycleNo) || !Number.isSafeInteger(lease.epoch)) throw new TypeError('A complete fencing lease is required.');
  const row = db.prepare('SELECT * FROM delivery_nodes WHERE task_id=? AND cycle_no=? AND node_id=?').get(lease.taskId, lease.cycleNo, lease.nodeId);
  if (!row || !expectedStates.includes(row.state) || row.lease_owner !== lease.ownerId || row.lease_epoch !== lease.epoch) {
    throw new Error('Lease fencing rejected a stale owner or epoch.');
  }
  if (!row.lease_expires_at || new Date(row.lease_expires_at).getTime() <= new Date(at).getTime()) throw new Error('Lease expired; reacquire with a new fencing epoch.');
  return row;
}

function policyForRun(repoRoot) { return readPolicy(repoRoot); }

function markUnknown(db, clock, node, evidence, operationId) {
  const at = nowIso(clock);
  const op = operationId || node.dispatch_operation_id || `unknown:${randomUUID()}`;
  db.prepare(`INSERT OR IGNORE INTO delivery_unknown_effects(task_id,cycle_no,node_id,operation_id,state,evidence_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(node.task_id, node.cycle_no, node.node_id, op, 'UNKNOWN', stableJson(evidence ?? {}), at);
  db.prepare(`UPDATE delivery_nodes SET state='QUARANTINED',effect_state='UNKNOWN',failure_class='UNKNOWN_EFFECT',
    lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`).run(at, node.task_id, node.cycle_no, node.node_id);
  db.prepare(`UPDATE delivery_runs SET state='QUARANTINED',updated_at=? WHERE task_id=?`).run(at, node.task_id);
  eventInTransaction(db, clock, node.task_id, node.cycle_no, 'UNKNOWN_EFFECT_QUARANTINED', { nodeId: node.node_id, operationId: op });
  return { status: 'QUARANTINED', operationId: op, resumable: true, retryAllowed: false };
}

function recoverExpiredLeases(store, clock) {
  const { db } = store;
  const now = nowIso(clock);
  const expired = db.prepare(`SELECT * FROM delivery_nodes WHERE state IN ('LEASED','RUNNING') AND lease_expires_at IS NOT NULL AND lease_expires_at<=?`).all(now);
  for (const node of expired) {
    if (node.dispatch_operation_id || node.state === 'RUNNING') {
      markUnknown(db, clock, node, { reason: 'Controller restarted or lease expired after dispatch intent.', operationId: node.dispatch_operation_id }, node.dispatch_operation_id);
    } else {
      db.prepare(`UPDATE delivery_nodes SET state='READY',lease_owner=NULL,lease_expires_at=NULL,lease_epoch=lease_epoch+1,updated_at=?
        WHERE task_id=? AND cycle_no=? AND node_id=?`).run(now, node.task_id, node.cycle_no, node.node_id);
      eventInTransaction(db, clock, node.task_id, node.cycle_no, 'UNUSED_LEASE_EXPIRED', { nodeId: node.node_id, fencingEpoch: node.lease_epoch + 1 });
    }
  }
}

function expectedNodeState(row) {
  if (row.state === 'ACTIVE') return 'WORKER_READY';
  return row.state;
}

function cycleAndNode(db, lease) {
  const run = db.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(lease.taskId);
  if (!run) throw new Error('Unknown delivery task: ' + lease.taskId);
  if (run.current_cycle !== lease.cycleNo) throw new Error('Lease belongs to a stale execution cycle.');
  const cycle = db.prepare('SELECT * FROM delivery_cycles WHERE task_id=? AND cycle_no=?').get(lease.taskId, lease.cycleNo);
  const node = db.prepare('SELECT * FROM delivery_nodes WHERE task_id=? AND cycle_no=? AND node_id=?').get(lease.taskId, lease.cycleNo, lease.nodeId);
  if (!cycle || !node) throw new Error('Delivery node or cycle is unavailable.');
  return { run, cycle, node };
}

function setRunState(db, clock, taskId, state) {
  const at = nowIso(clock);
  db.prepare('UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?').run(state, at, taskId);
  return at;
}

function resetPipelineForWorker(db, clock, run, cycle, currentSnapshot, nextState = 'WORKER_READY') {
  const at = nowIso(clock);
  db.prepare(`UPDATE delivery_runs SET state=?,initial_head_commit=?,initial_snapshot_digest=?,candidate_head_commit=NULL,candidate_snapshot_digest=NULL,changed_paths_json=?,updated_at=? WHERE task_id=?`)
    .run(nextState, currentSnapshot.headCommit, currentSnapshot.digest, json(currentSnapshot.changedPaths), at, run.task_id);
  db.prepare(`UPDATE delivery_nodes SET state='READY',input_digest=?,required_head_commit=NULL,required_snapshot_digest=NULL,candidate_head_commit=NULL,candidate_snapshot_digest=NULL,
    session_id=NULL,model=NULL,effort=NULL,backend_ref=NULL,result_digest=NULL,evidence_json=NULL,effect_state='NONE',failure_class=NULL,
    dispatch_operation_id=NULL,dispatch_input_digest=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
    WHERE task_id=? AND cycle_no=? AND node_id='worker'`).run(semanticTaskDigest(rowJson(run.task_json)), at, run.task_id, run.current_cycle);
  db.prepare(`UPDATE delivery_nodes SET state='WAITING',input_digest=?,required_head_commit=NULL,required_snapshot_digest=NULL,candidate_head_commit=NULL,candidate_snapshot_digest=NULL,
    session_id=NULL,model=NULL,effort=NULL,backend_ref=NULL,result_digest=NULL,evidence_json=NULL,effect_state='NONE',failure_class=NULL,
    dispatch_operation_id=NULL,dispatch_input_digest=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
    WHERE task_id=? AND cycle_no=? AND node_id IN ('verifier','reviewer')`).run(semanticTaskDigest(rowJson(run.task_json)), at, run.task_id, run.current_cycle);
  return at;
}

function completePassInTransaction(store, clock, lease, result, { reconciled = false } = {}) {
  const { db, repoRoot } = store;
  const { run, cycle, node } = cycleAndNode(db, lease);
  if (!reconciled && cycle.state !== 'ACTIVE') throw new Error('A paused or inactive execution cycle cannot accept a late PASS.');
  if (!reconciled) requireLease(db, lease, ['RUNNING'], nowIso(clock));
  else if (node.state !== 'QUARANTINED') throw new Error('Unknown effect can only reconcile a quarantined node.');
  if (resultOutcome(result) !== 'PASS') throw new TypeError('completeNode only accepts a PASS result; record other outcomes through failNode.');
  if (result.role !== node.role) throw new Error('Backend role does not match the claimed stage.');
  const sessionId = normalizedSessionId(result);
  if (!nonempty(sessionId)) throw new Error('A backend session id is required for every role result.');
  const expectedModel = rolePolicy(policyForRun(repoRoot), node.role);
  if (result.model !== expectedModel.model || result.effort !== expectedModel.reasoningEffort) throw new Error('Backend model or reasoning effort does not match active policy.');
  const priorSessions = db.prepare('SELECT node_id,session_id FROM delivery_nodes WHERE task_id=? AND cycle_no=? AND session_id IS NOT NULL AND node_id<>?').all(run.task_id, run.current_cycle, node.node_id);
  if (priorSessions.some((bound) => bound.session_id === sessionId)) throw new Error('Worker, verifier, and reviewer must use distinct backend sessions.');
  if (priorRoleSessions(db, run.task_id, run.current_cycle, node.node_id).some((bound) => bound.sessionId === sessionId)) throw new Error('Backend session was already used by a different role in this cycle.');
    if (node.session_id && node.session_id !== sessionId) throw new Error('Backend result session does not match its recorded session handle.');
  const claimedHead = resultHead(result);
  const current = gitSnapshot(run.worktree_root, run.base_commit, rowJson(run.proof_scope_json));
  if (current.violations.length) throw new Error('Candidate contains a scope violation: ' + current.violations[0].path);
  if (!current.clean) throw new Error('Backend candidate must have a clean worktree before a PASS can be recorded.');
  if (claimedHead !== current.headCommit) throw new Error('Backend result head does not match the current Git HEAD.');
  if (node.role === 'worker') {
    if (current.branch !== run.branch) throw new Error('Worker changed branches during implementation.');
    if (current.headCommit === run.initial_head_commit) throw new Error('Worker PASS must identify a new candidate commit, not the admitted baseline.');
  } else {
    if (claimedHead !== node.required_head_commit || current.headCommit !== run.candidate_head_commit
        || current.digest !== run.candidate_snapshot_digest || current.digest !== node.required_snapshot_digest) {
      throw new Error('Verifier and reviewer must inspect the unchanged exact candidate head and snapshot.');
    }
  }
  const evidenceRef = evidenceReference(result);
  if (!nonempty(evidenceRef)) throw new Error('A result or evidence digest reference is required.');
  const at = nowIso(clock);
  const evidence = {
    evidenceRef,
    resultDigest: result.resultDigest ?? null,
    headCommit: current.headCommit,
    snapshotDigest: current.digest,
  };
  db.prepare(`UPDATE delivery_nodes SET state='PASSED',candidate_head_commit=?,candidate_snapshot_digest=?,session_id=?,model=?,effort=?,backend_ref=?,result_digest=?,evidence_json=?,effect_state='APPLIED',failure_class=NULL,
    lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
    .run(current.headCommit, current.digest, sessionId, result.model, result.effort, result.backendRef ?? null, result.resultDigest ?? null, json(evidence), at, run.task_id, run.current_cycle, node.node_id);

  if (node.role === 'worker') {
    db.prepare(`UPDATE delivery_runs SET state='VERIFY_READY',candidate_head_commit=?,candidate_snapshot_digest=?,changed_paths_json=?,updated_at=? WHERE task_id=?`)
      .run(current.headCommit, current.digest, json(current.changedPaths), at, run.task_id);
    db.prepare(`UPDATE delivery_nodes SET state='READY',required_head_commit=?,required_snapshot_digest=?,input_digest=?,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id='verifier'`)
      .run(current.headCommit, current.digest, current.digest, at, run.task_id, run.current_cycle);
    eventInTransaction(db, clock, run.task_id, run.current_cycle, 'WORKER_CANDIDATE_SUBMITTED', { headCommit: current.headCommit, snapshotDigest: current.digest, evidenceRef });
  } else if (node.role === 'verifier') {
    db.prepare(`UPDATE delivery_runs SET state='REVIEW_READY',updated_at=? WHERE task_id=?`).run(at, run.task_id);
    db.prepare(`UPDATE delivery_nodes SET state='READY',required_head_commit=?,required_snapshot_digest=?,input_digest=?,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id='reviewer'`)
      .run(current.headCommit, current.digest, current.digest, at, run.task_id, run.current_cycle);
    eventInTransaction(db, clock, run.task_id, run.current_cycle, 'INDEPENDENT_VERIFICATION_PASSED', { headCommit: current.headCommit, snapshotDigest: current.digest, evidenceRef, sessionId });
  } else {
    db.prepare(`UPDATE delivery_runs SET state='ROOT_DELIVERY_READY',updated_at=? WHERE task_id=?`).run(at, run.task_id);
    eventInTransaction(db, clock, run.task_id, run.current_cycle, 'INDEPENDENT_REVIEW_PASSED', { headCommit: current.headCommit, snapshotDigest: current.digest, evidenceRef, sessionId });
  }
  return { status: 'PASS', taskId: run.task_id, nodeId: node.node_id, exactHeadCommit: current.headCommit, snapshotDigest: current.digest };
}

function applyFailure(store, clock, lease, options) {
  const { db, repoRoot } = store;
  const { run, cycle, node } = cycleAndNode(db, lease);
  const failureClass = options.failureClass;
  const effectState = options.effectState ?? 'UNKNOWN';
  const evidence = options.evidence;
  if (!isRecord(evidence) || !Object.keys(evidence).length) throw new TypeError('Failure evidence must be a nonempty object.');
  if (!EFFECT_STATES.has(effectState)) {
    db.prepare(`UPDATE delivery_nodes SET state='BLOCKED',failure_class='BLOCKED_EFFECT_REASSESS',effect_state='UNKNOWN',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
      .run(nowIso(clock), run.task_id, run.current_cycle, node.node_id);
    setRunState(db, clock, run.task_id, 'BLOCKED_EFFECT_REASSESS');
    eventInTransaction(db, clock, run.task_id, run.current_cycle, 'FAILURE_EFFECT_STATE_INVALID', { nodeId: node.node_id, failureEvidence: evidence });
    return { outcome: 'BLOCKED_EFFECT_REASSESS', resumable: true, retryAllowed: false };
  }
  if (effectState === 'UNKNOWN' || failureClass === 'UNKNOWN_EFFECT') {
    return markUnknown(db, clock, { ...node, task_id: run.task_id, cycle_no: run.current_cycle }, evidence, options.operationId);
  }
  if (failureClass === 'STALE_BASELINE') {
    if (node.role !== 'worker' || effectState !== 'NONE' || options.provenNoEffect !== true) {
      return markUnknown(db, clock, { ...node, task_id: run.task_id, cycle_no: run.current_cycle }, evidence, options.operationId);
    }
    const at = nowIso(clock);
    db.prepare(`UPDATE delivery_nodes SET state='BLOCKED',failure_class='STALE_BASELINE',effect_state='NONE',evidence_json=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
      .run(json(evidence), at, run.task_id, run.current_cycle, node.node_id);
    db.prepare(`UPDATE delivery_cycles SET state='BLOCKED',updated_at=? WHERE task_id=? AND cycle_no=?`)
      .run(at, run.task_id, run.current_cycle);
    db.prepare(`UPDATE delivery_runs SET state='BLOCKED_STALE_BASELINE',updated_at=? WHERE task_id=?`)
      .run(at, run.task_id);
    eventInTransaction(db, clock, run.task_id, run.current_cycle, 'WORKER_LAUNCH_BLOCKED_STALE_BASELINE', {
      nodeId: node.node_id, expectedHeadCommit: evidence.expectedHeadCommit ?? null,
      actualHeadCommit: evidence.actualHeadCommit ?? null, operationId: options.operationId ?? null,
      provenNoEffect: true,
    });
    return { outcome: 'BLOCKED_STALE_BASELINE', resumable: true, retryAllowed: false, effectState: 'NONE' };
  }
  if (!FAILURE_CLASSES.has(failureClass)) {
    db.prepare(`UPDATE delivery_nodes SET state='BLOCKED',failure_class='UNCLASSIFIED',effect_state=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
      .run(effectState, nowIso(clock), run.task_id, run.current_cycle, node.node_id);
    setRunState(db, clock, run.task_id, 'BLOCKED_FOR_REASSESSMENT');
    eventInTransaction(db, clock, run.task_id, run.current_cycle, 'FAILURE_UNCLASSIFIED', { nodeId: node.node_id, failureEvidence: evidence });
    return { outcome: 'BLOCKED_FOR_REASSESSMENT', resumable: true, retryAllowed: false };
  }
  if (failureClass === 'METADATA_DEFECT') {
    if (effectState !== 'NONE') {
      db.prepare(`UPDATE delivery_nodes SET state='BLOCKED',failure_class='BLOCKED_EFFECT_REASSESS',effect_state=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
        .run(effectState, nowIso(clock), run.task_id, run.current_cycle, node.node_id);
      setRunState(db, clock, run.task_id, 'BLOCKED_EFFECT_REASSESS');
      eventInTransaction(db, clock, run.task_id, run.current_cycle, 'METADATA_REPAIR_EFFECT_NOT_NONE', { nodeId: node.node_id, effectState });
      return { outcome: 'BLOCKED_EFFECT_REASSESS', resumable: true, retryAllowed: false };
    }
    const policy = policyForRun(repoRoot);
    const semanticInput = options.semanticInput ?? rowJson(run.task_json);
    const semanticDigest = options.semanticInputDigest ?? sha256(stableJson(semanticInput));
    if (!/^[a-f0-9]{64}$/i.test(semanticDigest)) throw new TypeError('semanticInputDigest must be a SHA-256 hex digest.');
    const fingerprint = sha256(`${node.stage}\n${failureClass}\n${semanticDigest}`);
    const existing = db.prepare('SELECT occurrences FROM delivery_no_progress WHERE task_id=? AND fingerprint=?').get(run.task_id, fingerprint);
    const occurrences = (existing?.occurrences ?? 0) + 1;
    const at = nowIso(clock);
    db.prepare(`INSERT INTO delivery_no_progress(task_id,fingerprint,occurrences,semantic_input_json,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(task_id,fingerprint) DO UPDATE SET occurrences=excluded.occurrences,semantic_input_json=excluded.semantic_input_json,updated_at=excluded.updated_at`)
      .run(run.task_id, fingerprint, occurrences, stableJson(semanticInput), at);
    const outcome = occurrences >= policy.retryAndLineage.limits.maxOccurrencesPerNoProgressFingerprint ? 'YIELD_REASSESS' : 'REPAIR_METADATA';
    db.prepare(`UPDATE delivery_nodes SET state='BLOCKED',failure_class=?,effect_state='NONE',evidence_json=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
      .run(failureClass, json({ evidenceRef: evidence.reference ?? null, outcome, occurrences }), at, run.task_id, run.current_cycle, node.node_id);
    db.prepare('UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?').run(outcome, at, run.task_id);
    eventInTransaction(db, clock, run.task_id, run.current_cycle, outcome, { nodeId: node.node_id, failureClass, semanticDigest, occurrences, noProgressCap: policy.retryAndLineage.limits.maxOccurrencesPerNoProgressFingerprint });
    return { outcome, resumable: true, terminal: false, retryAllowed: false, consumesImplementationRepair: false, occurrences, noProgressCap: policy.retryAndLineage.limits.maxOccurrencesPerNoProgressFingerprint };
  }
  if (failureClass === 'IDENTICAL_SEMANTIC_NO_PROGRESS_AT_CAP') {
    const at = nowIso(clock);
    db.prepare(`UPDATE delivery_nodes SET state='BLOCKED',failure_class=?,effect_state=?,evidence_json=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
      .run(failureClass, effectState, json(evidence), at, run.task_id, run.current_cycle, node.node_id);
    db.prepare('UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?').run('YIELD_REASSESS', at, run.task_id);
    eventInTransaction(db, clock, run.task_id, run.current_cycle, 'YIELD_REASSESS', { nodeId: node.node_id, failureClass, evidenceRef: evidence.reference ?? null });
    return { outcome: 'YIELD_REASSESS', resumable: true, terminal: false, retryAllowed: false, consumesImplementationRepair: false };
  }
  if (failureClass === 'IMPLEMENTATION_FAILURE') {
    const policy = policyForRun(repoRoot);
    const repairs = cycle.implementation_repairs + 1;
    const at = nowIso(clock);
    db.prepare('UPDATE delivery_cycles SET implementation_repairs=?,updated_at=? WHERE task_id=? AND cycle_no=?').run(repairs, at, run.task_id, run.current_cycle);
    db.prepare(`UPDATE delivery_nodes SET state='FAILED',failure_class=?,effect_state=?,evidence_json=?,repair_round=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
      .run(failureClass, effectState, json(evidence), repairs, at, run.task_id, run.current_cycle, node.node_id);
    if (repairs >= policy.retryAndLineage.limits.maxImplementationRepairRoundsPerExecutionCycle) {
      db.prepare(`UPDATE delivery_cycles SET state='PAUSED',paused_at=?,updated_at=? WHERE task_id=? AND cycle_no=?`).run(at, at, run.task_id, run.current_cycle);
      db.prepare(`UPDATE delivery_runs SET state='PAUSED_BUDGET_EXHAUSTED',updated_at=? WHERE task_id=?`).run(at, run.task_id);
      eventInTransaction(db, clock, run.task_id, run.current_cycle, 'IMPLEMENTATION_REPAIR_CAP_EXHAUSTED', { nodeId: node.node_id, repairs, evidenceRef: evidence.reference ?? null });
      return { outcome: 'PAUSED_BUDGET_EXHAUSTED', resumable: true, terminal: false, consumesImplementationRepair: true };
    }
    const current = gitSnapshot(run.worktree_root, run.base_commit, rowJson(run.proof_scope_json));
    if (current.violations.length) {
      db.prepare(`UPDATE delivery_runs SET state='BLOCKED_SCOPE',updated_at=? WHERE task_id=?`).run(at, run.task_id);
      eventInTransaction(db, clock, run.task_id, run.current_cycle, 'IMPLEMENTATION_SCOPE_BLOCKED', { path: current.violations[0].path });
      return { outcome: 'BLOCKED_SCOPE', resumable: true, terminal: false, consumesImplementationRepair: true };
    }
    resetPipelineForWorker(db, clock, run, cycle, current);
    db.prepare(`UPDATE delivery_cycles SET state='ACTIVE',updated_at=? WHERE task_id=? AND cycle_no=?`).run(at, run.task_id, run.current_cycle);
    eventInTransaction(db, clock, run.task_id, run.current_cycle, 'IMPLEMENTATION_REPAIR_ADMITTED', { nodeId: node.node_id, repairs, evidenceRef: evidence.reference ?? null });
    return { outcome: 'ACCEPTANCE_REPAIR', resumable: true, terminal: false, consumesImplementationRepair: true, repairRound: repairs };
  }
  if (failureClass === 'KNOWN_TRANSIENT_TOOL_ERROR') {
    const sameInput = options.sameInput === true && nonempty(options.semanticInputDigest)
      && options.semanticInputDigest === node.dispatch_input_digest;
    const safe = options.idempotent === true || (effectState === 'NONE' && options.provenNoEffect === true);
    const policy = policyForRun(repoRoot);
    const retries = cycle.tool_retries;
    if (!sameInput || !safe || retries >= policy.retryAndLineage.limits.maxToolRetriesPerExecutionCycle) {
      const at = nowIso(clock);
      db.prepare(`UPDATE delivery_nodes SET state='BLOCKED',failure_class=?,effect_state=?,evidence_json=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
        .run(failureClass, effectState, json(evidence), at, run.task_id, run.current_cycle, node.node_id);
      setRunState(db, clock, run.task_id, 'YIELD_REASSESS');
      eventInTransaction(db, clock, run.task_id, run.current_cycle, 'TRANSIENT_RETRY_NOT_ADMITTED', { nodeId: node.node_id, sameInput, safe, retries });
      return { outcome: 'YIELD_REASSESS', resumable: true, terminal: false, retryAllowed: false };
    }
    const at = nowIso(clock);
    db.prepare('UPDATE delivery_cycles SET tool_retries=tool_retries+1,updated_at=? WHERE task_id=? AND cycle_no=?').run(at, run.task_id, run.current_cycle);
    db.prepare(`UPDATE delivery_nodes SET state='READY',failure_class=NULL,effect_state=?,evidence_json=?,dispatch_operation_id=NULL,dispatch_input_digest=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
      .run(effectState, json(evidence), at, run.task_id, run.current_cycle, node.node_id);
    db.prepare('UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?').run(expectedNodeState(run), at, run.task_id);
    eventInTransaction(db, clock, run.task_id, run.current_cycle, 'BOUNDED_TOOL_RETRY_ADMITTED', { nodeId: node.node_id, retries: retries + 1, evidenceRef: evidence.reference ?? null });
    return { outcome: 'BOUNDED_TOOL_RETRY', resumable: true, terminal: false, retryAllowed: true, toolRetries: retries + 1 };
  }
  const at = nowIso(clock);
  db.prepare(`UPDATE delivery_nodes SET state='BLOCKED',failure_class=?,effect_state=?,evidence_json=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
    .run(failureClass, effectState, json(evidence), at, run.task_id, run.current_cycle, node.node_id);
  db.prepare('UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?').run('BLOCKED_EXTERNAL', at, run.task_id);
  eventInTransaction(db, clock, run.task_id, run.current_cycle, 'EXTERNAL_BLOCKER', { nodeId: node.node_id, failureClass, evidenceRef: evidence.reference ?? null });
  return { outcome: 'BLOCKED_EXTERNAL', resumable: true, terminal: false, retryAllowed: false };
}

export async function openDeliveryController({ repoRoot, databasePath, now = () => new Date() } = {}) {
  const store = openControllerStore({ repoRoot, databasePath });
  const { db } = store;
  const clock = now;
  installCycleAdmissionLockEpoch(db);
  readAndVerifyEvents(db);

  function getRun(taskId) {
    const row = db.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId);
    return row ? runShape(db, row, { includeTaskRecord: true }) : null;
  }

  function inspectCampaignDispatchHistory({ taskIds } = {}) {
    if (!Array.isArray(taskIds)) throw new TypeError('Campaign dispatch-history inspection requires taskIds.');
    db.exec('BEGIN');
    try {
      const result = inspectCampaignDispatchHistoryInTransaction(db, taskIds);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  function reconcileCampaignDeadline(input = {}) {
    return store.transaction((tx) => reconcileCampaignDeadlineInTransaction(tx, clock, input));
  }

  function inspectBaseAdvancedPause(taskId) {
    const row = db.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId);
    if (!row) return null;
    const cycle = db.prepare('SELECT cycle_no,state,started_at,paused_at,submissions,implementation_repairs,tool_retries FROM delivery_cycles WHERE task_id=? AND cycle_no=?')
      .get(taskId, row.current_cycle);
    const disposition = db.prepare(`SELECT payload_json FROM delivery_events
      WHERE task_id=? AND cycle_no=? AND event_type='ROOT_BASE_ADVANCED_DISPOSITION_RECORDED'
      ORDER BY sequence DESC LIMIT 1`).get(taskId, row.current_cycle);
    return {
      run: runShape(db, row, { includeTaskRecord: true }),
      cycle,
      baseAdvancedDisposition: disposition ? rowJson(disposition.payload_json) : null,
      activeLeases: db.prepare("SELECT cycle_no,node_id,lease_owner,lease_expires_at FROM delivery_nodes WHERE task_id=? AND state IN ('LEASED','RUNNING') ORDER BY cycle_no,node_id")
        .all(taskId),
      unknownEffects: db.prepare("SELECT cycle_no,node_id,operation_id,created_at FROM delivery_unknown_effects WHERE task_id=? AND state='UNKNOWN' ORDER BY cycle_no,node_id")
        .all(taskId),
      unknownNodes: db.prepare("SELECT cycle_no,node_id FROM delivery_nodes WHERE task_id=? AND effect_state='UNKNOWN' ORDER BY cycle_no,node_id")
        .all(taskId),
    };
  }

  function listRuns() {
    return queryRuns(db).map((row) => runShape(db, row));
  }

  function inspectCycleAdmissionConflicts({ taskId, writeScope } = {}) {
    if (!nonempty(taskId) || !Array.isArray(writeScope) || !writeScope.length) {
      throw new TypeError('Cycle admission conflict inspection requires a taskId and non-empty writeScope.');
    }
    const scopes = [...new Set(writeScope.map(normalizeScopePath))];
    const lockEpoch = db.prepare("SELECT value FROM controller_meta WHERE key='resourceLockEpoch'").get()?.value;
    if (!/^\d+$/.test(lockEpoch ?? '')) throw new Error('Controller resource-lock epoch is unavailable or malformed.');
    const run = db.prepare('SELECT task_id,worktree_root,trusted_mandate_json FROM delivery_runs WHERE task_id=?').get(taskId);
    if (!run) return { taskId, runFound: false, lockEpoch, worktree: [], writeScope: [], domain: [] };

    const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
    const worktree = db.prepare(`SELECT DISTINCT r.task_id,r.worktree_root FROM delivery_write_locks w
      JOIN delivery_runs r USING(task_id) WHERE w.task_id<>? ORDER BY r.task_id,r.worktree_root`).all(taskId)
      .filter((row) => pathKey(row.worktree_root) === pathKey(run.worktree_root))
      .map((row) => ({ taskId: row.task_id, worktreeRoot: row.worktree_root }))
      .sort((left, right) => compare(left.taskId, right.taskId) || compare(left.worktreeRoot, right.worktreeRoot));
    const writeScopeConflicts = [];
    const locks = db.prepare(`SELECT task_id,scope_path FROM delivery_write_locks WHERE task_id<>?
      ORDER BY task_id,scope_path`).all(taskId);
    for (const requested of scopes) {
      for (const lock of locks) {
        if (scopesOverlap(requested, lock.scope_path)) {
          writeScopeConflicts.push({ taskId: lock.task_id, scope: lock.scope_path, requested });
        }
      }
    }
    writeScopeConflicts.sort((left, right) => compare(left.requested, right.requested)
      || compare(left.scope, right.scope) || compare(left.taskId, right.taskId));
    const domainOrFeatureKey = storedDomainOrFeatureKey(run);
    const domainOwner = domainOrFeatureKey
      ? db.prepare('SELECT task_id FROM delivery_domain_locks WHERE domain_or_feature_key=? AND task_id<>?')
        .get(domainOrFeatureKey, taskId)
      : null;
    const domain = domainOwner ? [{ taskId: domainOwner.task_id, domainOrFeatureKey }] : [];
    return { taskId, runFound: true, lockEpoch, worktree, writeScope: writeScopeConflicts, domain };
  }

  function registerTask({ taskRecord, preflightResult, worktreeRoot = store.repoRoot, trustedMandateBinding } = {}) {
    requireTaskRecord(taskRecord);
    const taskPaths = repositoryPaths(worktreeRoot);
    if (pathKey(taskPaths.gitCommonDir) !== pathKey(store.gitCommonDir)) throw new TypeError('Task worktree must belong to this controller Git common directory.');
    const taskRepoRoot = taskPaths.repoRoot;
    const binding = checkMandateBinding(trustedMandateBinding, taskRecord, store.repoRoot);
  if (!isRecord(preflightResult) || preflightResult.schemaVersion !== 'task-preflight-result/v1'
        || !['READY', 'BLOCKED_DEPENDENCY'].includes(preflightResult.status) || preflightResult.taskId !== taskRecord.taskId
        || normalizeText(preflightResult.objective) !== normalizeText(taskRecord.objective)
        || preflightResult.authorityGrant !== false || preflightResult.dispatchAllowed !== false
        || preflightResult.checksExecuted !== false || preflightResult.stateWritePerformed !== false
        || preflightResult.mandateReferenceIsProvenanceOnly !== true) {
      throw new TypeError('registerTask requires a matching READY read-only v4 preflight result; it is not an authority grant.');
    }
    const baseline = preflightResult.baseline;
    if (!isRecord(baseline) || !nonempty(baseline.baseRevision) || !nonempty(baseline.headRevision)
        || !nonempty(baseline.branch) || baseline.branch.toLowerCase() === 'main') {
      throw new TypeError('READY preflight must include the exact base, head, and named task branch.');
    }
    const taskDigest = semanticTaskDigest(taskRecord);
    const dependencies = Array.isArray(preflightResult.dependencies) ? preflightResult.dependencies : [];
    const at = nowIso(clock);
    return store.transaction((tx) => {
      ensureActiveDomainLocks(tx);
      const existing = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskRecord.taskId);
      if (existing) {
        if (existing.current_cycle !== 0) {
          if (semanticTaskDigest(rowJson(existing.task_json)) !== taskDigest) throw new Error('Task identity already exists with different metadata; use resumeTask or root-admitted admitCycle.');
          const existingKey = storedDomainOrFeatureKey(existing);
          if (existingKey && existingKey !== binding.domainOrFeatureKey) throw new Error('Task domainOrFeatureKey cannot change for an existing task identity.');
          return runShape(tx, existing, { includeTaskRecord: true });
        }
        const existingKey = storedDomainOrFeatureKey(existing);
        if (existingKey && existingKey !== binding.domainOrFeatureKey) throw new Error('Task domainOrFeatureKey cannot change for an existing task identity.');
      }
      const current = gitSnapshot(taskRepoRoot, baseline.baseRevision, taskRecord.writeScope);
      if (current.headCommit !== baseline.headRevision || current.branch !== baseline.branch) {
        throw new Error('Preflight baseline is stale; rerun automatic preflight before controller registration.');
      }
      if (current.violations.length) {
        throw new Error('Preflight READY conflicts with actual write scope at ' + current.violations[0].path + '.');
      }
      const unresolvedDeps = dependencies.filter((dependency) => dependency?.accepted !== true);
      if (unresolvedDeps.length && preflightResult.status === 'READY') throw new Error('Preflight READY conflicts with unaccepted dependency evidence.');
      const scopes = taskRecord.writeScope.map(normalizeScopePath);
      const scopeConflict = pathConflict(tx, taskRecord.taskId, scopes, taskRepoRoot);
      const semanticConflict = domainLockConflict(tx, taskRecord.taskId, binding.domainOrFeatureKey);
      const conflict = scopeConflict ?? semanticConflict;
      const dependencyBlocked = preflightResult.status === 'BLOCKED_DEPENDENCY' || unresolvedDeps.length > 0;
      const state = conflict ? 'BLOCKED_SCOPE' : dependencyBlocked ? 'BLOCKED_DEPENDENCY' : 'WORKER_READY';
      const currentCycle = state === 'WORKER_READY' ? 1 : 0;
      const changedPaths = current.changedPaths;
      if (existing?.current_cycle === 0) {
        tx.prepare(`UPDATE delivery_runs SET worktree_root=?,objective=?,acceptance_json=?,task_json=?,trusted_mandate_json=?,branch=?,base_ref=?,base_commit=?,initial_head_commit=?,initial_snapshot_digest=?,
          proof_scope_json=?,changed_paths_json=?,dependencies_json=?,state=?,current_cycle=?,updated_at=? WHERE task_id=?`)
          .run(taskRepoRoot, taskRecord.objective, json(taskRecord.acceptance), json(taskRecord), json(binding), baseline.branch, baseline.base, baseline.baseRevision, baseline.headRevision,
            current.digest, json(scopes), json(changedPaths), json(dependencies), state, currentCycle, at, taskRecord.taskId);
      } else {
        tx.prepare(`INSERT INTO delivery_runs(task_id,worktree_root,objective,acceptance_json,task_json,trusted_mandate_json,branch,base_ref,base_commit,initial_head_commit,initial_snapshot_digest,
          proof_scope_json,changed_paths_json,dependencies_json,state,current_cycle,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(taskRecord.taskId, taskRepoRoot, taskRecord.objective, json(taskRecord.acceptance), json(taskRecord), json(binding), baseline.branch, baseline.base, baseline.baseRevision, baseline.headRevision,
            current.digest, json(scopes), json(changedPaths), json(dependencies), state, currentCycle, at, at);
      }
      if (currentCycle > 0) tx.prepare(`INSERT INTO delivery_cycles(task_id,cycle_no,state,admitted_at,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
        .run(taskRecord.taskId, currentCycle, 'ACTIVE', at, at, at);
      if (currentCycle > 0) {
        const acquired = acquireDomainLock(tx, taskRecord.taskId, binding.domainOrFeatureKey);
        if (acquired) throw new Error('DOMAIN_OR_FEATURE_LOCK_RACE:' + acquired.taskId);
        for (const scope of scopes) tx.prepare('INSERT INTO delivery_write_locks(task_id,scope_path) VALUES(?,?)').run(taskRecord.taskId, scope);
        insertNodes(tx, taskRecord.taskId, currentCycle, taskDigest, at);
      }
      eventInTransaction(tx, clock, taskRecord.taskId, currentCycle, 'TASK_REGISTERED', {
        taskRecordDigest: taskDigest,
        preflight: { status: preflightResult.status, baseCommit: baseline.baseRevision, headCommit: baseline.headRevision, branch: baseline.branch },
        mandateBindingDigest: binding.digest,
        domainOrFeatureKey: binding.domainOrFeatureKey,
        writeScope: scopes,
        ...(conflict ? { conflict } : {}),
        ...(dependencyBlocked ? { unacceptedDependencies: unresolvedDeps.map((item) => item.taskId) } : {}),
      });
      return runShape(tx, tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskRecord.taskId), { includeTaskRecord: true });
    });
  }

  function refreshCycleDeadlines(tx) {
    const policy = readPolicy(store.repoRoot);
    const nowMs = new Date(nowIso(clock)).getTime();
    const active = tx.prepare(`SELECT c.*,r.state AS run_state FROM delivery_cycles c JOIN delivery_runs r USING(task_id)
      WHERE c.state='ACTIVE' AND c.started_at IS NOT NULL`).all();
    for (const cycle of active) {
      const deadline = new Date(cycle.started_at).getTime() + policy.retryAndLineage.limits.maxRunDurationMinutesPerExecutionCycle * 60_000;
      if (nowMs >= deadline) {
        const at = nowIso(clock);
        tx.prepare(`UPDATE delivery_cycles SET state='PAUSED',paused_at=?,updated_at=? WHERE task_id=? AND cycle_no=?`).run(at, at, cycle.task_id, cycle.cycle_no);
        tx.prepare(`UPDATE delivery_runs SET state='PAUSED_DEADLINE',updated_at=? WHERE task_id=?`).run(at, cycle.task_id);
        eventInTransaction(tx, clock, cycle.task_id, cycle.cycle_no, 'CYCLE_DEADLINE_EXHAUSTED', { startedAt: cycle.started_at });
      }
    }
  }

  function nextReadyNodes({ limit = 4 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer.');
    return store.transaction((tx) => {
      ensureActiveDomainLocks(tx);
      recoverExpiredLeases(store, clock);
      refreshCycleDeadlines(tx);
      const policy = readPolicy(store.repoRoot);
      const active = tx.prepare("SELECT role,COUNT(*) AS count FROM delivery_nodes WHERE state IN ('LEASED','RUNNING') GROUP BY role").all();
      const activeByRole = Object.fromEntries(active.map((row) => [row.role, row.count]));
      const activeAll = Object.values(activeByRole).reduce((sum, value) => sum + value, 0);
      const sessionCapacity = policy.concurrency.agentSlotsMaximum - policy.concurrency.rootSlots;
      if (activeAll >= sessionCapacity) return [];
      const queue = tx.prepare(`SELECT n.*,r.objective,r.worktree_root,r.branch,r.base_commit,r.initial_head_commit,r.current_cycle,r.proof_scope_json,r.dependencies_json,r.state AS run_state,
        r.candidate_head_commit,r.candidate_snapshot_digest,c.started_at,c.submissions,c.implementation_repairs,c.tool_retries
        FROM delivery_nodes n JOIN delivery_runs r USING(task_id) JOIN delivery_cycles c USING(task_id,cycle_no)
        WHERE n.state='READY' AND c.state='ACTIVE' ORDER BY n.created_at,r.task_id`).all();
      const unverified = tx.prepare(`SELECT COUNT(*) AS count FROM delivery_nodes WHERE role='worker' AND state='PASSED'
        AND task_id IN (SELECT task_id FROM delivery_runs WHERE state IN ('VERIFY_READY','REVIEW_READY'))`).get().count;
      const output = [];
      for (const node of queue) {
        if (output.length >= limit || activeAll + output.length >= sessionCapacity) break;
        if (node.role === 'worker') {
          if ((activeByRole.worker ?? 0) + output.filter((item) => item.role === 'worker').length >= policy.concurrency.workerSlotsMaximum) continue;
          const workerReservations = unverified + (activeByRole.worker ?? 0) + output.filter((item) => item.role === 'worker').length;
          if (workerReservations >= policy.concurrency.unverifiedSubmissionQueueMaximum) continue;
          if (node.run_state !== 'WORKER_READY') continue;
        } else {
          if ((activeByRole.verifier ?? 0) + (activeByRole.reviewer ?? 0) + output.filter((item) => item.role !== 'worker').length >= policy.concurrency.gateSlots) continue;
          if (node.role === 'verifier' && node.run_state !== 'VERIFY_READY') continue;
          if (node.role === 'reviewer' && node.run_state !== 'REVIEW_READY') continue;
          const current = gitSnapshot(node.worktree_root, node.base_commit, rowJson(node.proof_scope_json));
          if (!current.clean || current.violations.length || current.headCommit !== node.required_head_commit || current.digest !== node.required_snapshot_digest) continue;
        }
        const cycle = tx.prepare('SELECT * FROM delivery_cycles WHERE task_id=? AND cycle_no=?').get(node.task_id, node.cycle_no);
        const run = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(node.task_id);
        output.push({
          taskId: node.task_id,
          nodeId: node.node_id,
          cycleNo: node.cycle_no,
          stage: node.stage,
          role: node.role,
          status: 'READY',
          attempt: node.attempt + 1,
          repairRound: cycle.implementation_repairs,
          inputDigest: node.input_digest,
          baseCommit: run.base_commit,
          requiredHeadCommit: node.required_head_commit,
          expectedLaunchHeadCommit: node.role === 'worker' ? run.initial_head_commit : null,
          candidateHeadCommit: run.candidate_head_commit,
          branch: run.branch,
          writeScope: rowJson(run.proof_scope_json),
          dependencies: rowJson(run.dependencies_json),
        });
      }
      return output;
    });
  }

  function claimNode({ taskId, nodeId, ownerId, leaseMs = 120_000 } = {}) {
    if (!nonempty(taskId) || !nonempty(nodeId) || !nonempty(ownerId)) throw new TypeError('taskId, nodeId, and ownerId are required.');
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw new TypeError('leaseMs must be at least one second.');
    return store.transaction((tx) => {
      ensureActiveDomainLocks(tx);
      recoverExpiredLeases(store, clock);
      refreshCycleDeadlines(tx);
      const node = tx.prepare(`SELECT n.*,r.state AS run_state,r.worktree_root,r.base_commit,r.initial_snapshot_digest,r.initial_head_commit,r.branch,r.proof_scope_json,r.candidate_head_commit,r.candidate_snapshot_digest
        FROM delivery_nodes n JOIN delivery_runs r USING(task_id) WHERE n.task_id=? AND n.node_id=? AND n.cycle_no=(SELECT current_cycle FROM delivery_runs WHERE task_id=?)`)
        .get(taskId, nodeId, taskId);
      if (!node || node.state !== 'READY') throw new Error('Delivery node is not ready to claim.');
      const cycle = tx.prepare('SELECT * FROM delivery_cycles WHERE task_id=? AND cycle_no=?').get(taskId, node.cycle_no);
      if (!cycle || cycle.state !== 'ACTIVE') throw new Error('Execution cycle is not active.');
      const policy = readPolicy(store.repoRoot);
      const active = tx.prepare("SELECT role,COUNT(*) AS count FROM delivery_nodes WHERE state IN ('LEASED','RUNNING') GROUP BY role").all();
      const activeByRole = Object.fromEntries(active.map((item) => [item.role, item.count]));
      const activeAll = Object.values(activeByRole).reduce((sum, value) => sum + value, 0);
      const sessionCapacity = policy.concurrency.agentSlotsMaximum - policy.concurrency.rootSlots;
      const unverified = tx.prepare(`SELECT COUNT(*) AS count FROM delivery_nodes WHERE role='worker' AND state='PASSED'
        AND task_id IN (SELECT task_id FROM delivery_runs WHERE state IN ('VERIFY_READY','REVIEW_READY'))`).get().count;
      if (activeAll >= sessionCapacity
          || (node.role === 'worker' && ((activeByRole.worker ?? 0) >= policy.concurrency.workerSlotsMaximum
            || unverified + (activeByRole.worker ?? 0) >= policy.concurrency.unverifiedSubmissionQueueMaximum))
          || (node.role !== 'worker' && ((activeByRole.verifier ?? 0) + (activeByRole.reviewer ?? 0) >= policy.concurrency.gateSlots))) {
        throw new Error('Atomic claim refused by active policy concurrency limits.');
      }
      const snapshot = gitSnapshot(node.worktree_root, node.base_commit, rowJson(node.proof_scope_json));
      if (snapshot.violations.length) {
        const blockedAt = nowIso(clock);
        tx.prepare(`UPDATE delivery_runs SET state='BLOCKED_SCOPE',updated_at=? WHERE task_id=?`).run(blockedAt, taskId);
        tx.prepare(`UPDATE delivery_cycles SET state='BLOCKED',updated_at=? WHERE task_id=? AND cycle_no=?`).run(blockedAt, taskId, node.cycle_no);
        eventInTransaction(tx, clock, taskId, node.cycle_no, 'CLAIM_BLOCKED_SCOPE', snapshot.violations[0]);
        return { blocked: true, status: 'BLOCKED_SCOPE', taskId, nodeId, reason: snapshot.violations[0].reason };
      }
      if (node.role === 'worker') {
        if (cycle.submissions >= policy.retryAndLineage.limits.maxSubmissionAttemptsPerExecutionCycle) {
          const pausedAt = nowIso(clock);
          tx.prepare(`UPDATE delivery_cycles SET state='PAUSED',paused_at=?,updated_at=? WHERE task_id=? AND cycle_no=?`).run(pausedAt, pausedAt, taskId, node.cycle_no);
          tx.prepare(`UPDATE delivery_runs SET state='PAUSED_BUDGET_EXHAUSTED',updated_at=? WHERE task_id=?`).run(pausedAt, taskId);
          eventInTransaction(tx, clock, taskId, node.cycle_no, 'WORKER_SUBMISSION_CAP_EXHAUSTED', { submissions: cycle.submissions });
          return { blocked: true, status: 'PAUSED_BUDGET_EXHAUSTED', taskId, nodeId };
        }
        if (snapshot.headCommit !== node.initial_head_commit || snapshot.digest !== node.initial_snapshot_digest || snapshot.branch !== node.branch) {
          const blockedAt = nowIso(clock);
          tx.prepare(`UPDATE delivery_runs SET state='BLOCKED_STALE_BASELINE',updated_at=? WHERE task_id=?`).run(blockedAt, taskId);
          tx.prepare(`UPDATE delivery_cycles SET state='BLOCKED',updated_at=? WHERE task_id=? AND cycle_no=?`).run(blockedAt, taskId, node.cycle_no);
          eventInTransaction(tx, clock, taskId, node.cycle_no, 'CLAIM_BLOCKED_STALE_BASELINE', { registeredHead: node.initial_head_commit, currentHead: snapshot.headCommit });
          return { blocked: true, status: 'BLOCKED_STALE_BASELINE', taskId, nodeId };
        }
      } else if (!snapshot.clean || snapshot.headCommit !== node.required_head_commit || snapshot.digest !== node.required_snapshot_digest) {
        const blockedAt = nowIso(clock);
        tx.prepare(`UPDATE delivery_runs SET state='BLOCKED_STALE_CANDIDATE',updated_at=? WHERE task_id=?`).run(blockedAt, taskId);
        tx.prepare(`UPDATE delivery_cycles SET state='BLOCKED',updated_at=? WHERE task_id=? AND cycle_no=?`).run(blockedAt, taskId, node.cycle_no);
        eventInTransaction(tx, clock, taskId, node.cycle_no, 'CLAIM_BLOCKED_STALE_CANDIDATE', { requiredHead: node.required_head_commit, currentHead: snapshot.headCommit, clean: snapshot.clean });
        return { blocked: true, status: 'BLOCKED_STALE_CANDIDATE', taskId, nodeId };
      }
      const at = nowIso(clock);
      const maxLeaseMs = policy.retryAndLineage.limits.maxNodeDurationMinutesPerExecutionCycle * 60_000;
      const expiresAt = addMinutes(at, Math.min(leaseMs, maxLeaseMs) / 60_000);
      const epoch = node.lease_epoch + 1;
      tx.prepare(`UPDATE delivery_nodes SET state='LEASED',lease_owner=?,lease_epoch=?,lease_expires_at=?,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
        .run(ownerId, epoch, expiresAt, at, taskId, node.cycle_no, nodeId);
      eventInTransaction(tx, clock, taskId, node.cycle_no, 'NODE_CLAIMED', { nodeId, ownerId, fencingEpoch: epoch, expiresAt });
      return {
        taskId, nodeId, cycleNo: node.cycle_no, ownerId, epoch, expiresAt,
        stage: node.stage, role: node.role, requiredHeadCommit: node.required_head_commit,
      };
    });
  }

  function heartbeat(lease, leaseMs = 120_000) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw new TypeError('leaseMs must be at least one second.');
    return store.transaction((tx) => {
      const node = requireLease(tx, lease, ['LEASED', 'RUNNING'], nowIso(clock));
      const run = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(lease.taskId);
      const cycle = tx.prepare('SELECT * FROM delivery_cycles WHERE task_id=? AND cycle_no=?').get(lease.taskId, lease.cycleNo);
      const policy = readPolicy(store.repoRoot);
      const at = nowIso(clock);
      const maxLeaseMs = policy.retryAndLineage.limits.maxNodeDurationMinutesPerExecutionCycle * 60_000;
      const nodeDeadline = cycle?.started_at
        ? new Date(new Date(cycle.started_at).getTime() + maxLeaseMs).toISOString()
        : addMinutes(at, maxLeaseMs / 60_000);
      if (new Date(at).getTime() >= new Date(nodeDeadline).getTime()) {
        eventInTransaction(tx, clock, lease.taskId, lease.cycleNo, 'NODE_DEADLINE_EXHAUSTED', { nodeId: lease.nodeId, startedAt: cycle?.started_at ?? null });
        return { ...lease, expired: true, expiresAt: at };
      }
      const requestedExpiry = addMinutes(at, Math.min(leaseMs, maxLeaseMs) / 60_000);
      const expiresAt = new Date(requestedExpiry).getTime() <= new Date(nodeDeadline).getTime() ? requestedExpiry : nodeDeadline;
      tx.prepare('UPDATE delivery_nodes SET lease_expires_at=?,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?')
        .run(expiresAt, at, lease.taskId, lease.cycleNo, lease.nodeId);
      eventInTransaction(tx, clock, lease.taskId, lease.cycleNo, 'NODE_LEASE_HEARTBEAT', { nodeId: lease.nodeId, ownerId: lease.ownerId, fencingEpoch: lease.epoch, expiresAt, runState: run.state });
      return { ...lease, expiresAt };
    });
  }

  function recordDispatchIntent({ lease, operationId, inputDigest } = {}) {
    if (!nonempty(operationId) || !/^[a-f0-9]{64}$/i.test(inputDigest ?? '')) throw new TypeError('Dispatch intent requires operationId and a SHA-256 inputDigest.');
    return store.transaction((tx) => {
      ensureActiveDomainLocks(tx);
      const node = requireLease(tx, lease, ['LEASED'], nowIso(clock));
      const { run, cycle } = cycleAndNode(tx, lease);
      const policy = readPolicy(store.repoRoot);
      if (cycle.state !== 'ACTIVE') throw new Error('Execution cycle is not active.');
      const at = nowIso(clock);
      if (node.role === 'worker') {
        const submissions = cycle.submissions + 1;
        if (submissions > policy.retryAndLineage.limits.maxSubmissionAttemptsPerExecutionCycle) {
          throw new Error('Per-cycle worker submission cap is exhausted.');
        }
        tx.prepare(`UPDATE delivery_cycles SET submissions=?,started_at=COALESCE(started_at,?),updated_at=? WHERE task_id=? AND cycle_no=?`)
          .run(submissions, at, at, run.task_id, run.current_cycle);
      }
      tx.prepare(`UPDATE delivery_nodes SET state='RUNNING',attempt=attempt+1,dispatch_operation_id=?,dispatch_input_digest=?,input_digest=?,updated_at=?
        WHERE task_id=? AND cycle_no=? AND node_id=?`)
        .run(operationId, inputDigest, inputDigest, at, run.task_id, run.current_cycle, node.node_id);
      const taskState = node.role === 'worker' ? 'WORKER_RUNNING' : node.role === 'verifier' ? 'VERIFY_RUNNING' : 'REVIEW_RUNNING';
      tx.prepare('UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?').run(taskState, at, run.task_id);
      eventInTransaction(tx, clock, run.task_id, run.current_cycle, 'BACKEND_DISPATCH_INTENT', { nodeId: node.node_id, operationId, inputDigest, role: node.role });
      return { operationId, inputDigest, attempt: node.attempt + 1 };
    });
  }

  function cancelDispatchBeforeLaunch({ lease, operationId, reason } = {}) {
    if (!nonempty(operationId) || reason !== 'CAMPAIGN_DEADLINE_EXPIRED') {
      throw new TypeError('Pre-launch cancellation requires a dispatch operation and an expired campaign deadline.');
    }
    return store.transaction((tx) => {
      ensureActiveDomainLocks(tx);
      const at = nowIso(clock);
      if (!isRecord(lease) || !nonempty(lease.taskId) || !nonempty(lease.nodeId) || !nonempty(lease.ownerId)
          || !Number.isSafeInteger(lease.cycleNo) || !Number.isSafeInteger(lease.epoch)) {
        throw new TypeError('A complete fencing lease is required.');
      }
      const node = tx.prepare('SELECT * FROM delivery_nodes WHERE task_id=? AND cycle_no=? AND node_id=?')
        .get(lease.taskId, lease.cycleNo, lease.nodeId);
      if (!node || node.state !== 'RUNNING' || node.lease_owner !== lease.ownerId || node.lease_epoch !== lease.epoch) {
        throw new Error('Lease fencing rejected a stale owner or epoch.');
      }
      // A deadline cancellation remains safe after expiry only while this exact
      // owner and fencing epoch still hold the RUNNING row. Recovery or reclaim
      // changes that row and therefore rejects this path.
      if (exactIsoMilliseconds(node.lease_expires_at) === null) {
        throw new Error('Pre-launch cancellation requires an exact lease expiry timestamp.');
      }
      const { run, cycle } = cycleAndNode(tx, lease);
      if (node.dispatch_operation_id !== operationId) throw new Error('Pre-launch cancellation does not match the active dispatch intent.');
      if (node.session_id !== null || node.backend_ref !== null) throw new Error('A backend handle exists for this dispatch operation.');
      if (node.effect_state !== 'NONE') throw new Error('Pre-launch cancellation cannot replace existing effect evidence.');
      if (run.current_cycle !== lease.cycleNo || cycle.state !== 'ACTIVE') {
        throw new Error('Pre-launch cancellation requires the active execution cycle.');
      }
      const chain = readAndVerifyEvents(tx, { includeEvents: true });
      const latestIntent = chain.events.filter((event) => event.task_id === lease.taskId
        && event.cycle_no === lease.cycleNo && event.event_type === 'BACKEND_DISPATCH_INTENT')
        .map((event) => ({ event, payload: rowJson(event.payload_json) }))
        .filter((item) => item.payload?.nodeId === lease.nodeId).at(-1);
      if (latestIntent?.payload?.operationId !== operationId) {
        throw new Error('Pre-launch cancellation does not match the latest immutable dispatch intent.');
      }
      const evidence = { operationId, reason, backendLaunched: false, effectState: 'NONE' };
      tx.prepare(`UPDATE delivery_nodes SET state='BLOCKED',failure_class='CAMPAIGN_DEADLINE_EXPIRED',effect_state='NONE',evidence_json=?,
        lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
        .run(json(evidence), at, lease.taskId, lease.cycleNo, lease.nodeId);
      tx.prepare("UPDATE delivery_cycles SET state='PAUSED',paused_at=?,updated_at=? WHERE task_id=? AND cycle_no=?")
        .run(at, at, lease.taskId, lease.cycleNo);
      tx.prepare("UPDATE delivery_runs SET state='PAUSED_DEADLINE',updated_at=? WHERE task_id=?")
        .run(at, lease.taskId);
      eventInTransaction(tx, clock, lease.taskId, lease.cycleNo, 'BACKEND_DISPATCH_CANCELLED_BEFORE_LAUNCH', {
        nodeId: lease.nodeId, operationId, reason, backendLaunched: false,
        attempt: node.attempt, submissions: cycle.submissions,
      });
      return { cancelled: true, backendLaunched: false, taskId: lease.taskId, cycleNo: lease.cycleNo,
        nodeId: lease.nodeId, operationId, state: 'PAUSED_DEADLINE' };
    });
  }

  function recordBackendHandle({ lease, sessionId, model, effort, backendRef = null } = {}) {
    if (!nonempty(sessionId) || !nonempty(model) || !nonempty(effort)) throw new TypeError('Backend handle requires sessionId, model, and effort.');
    return store.transaction((tx) => {
      const node = requireLease(tx, lease, ['RUNNING'], nowIso(clock));
      const expected = rolePolicy(readPolicy(store.repoRoot), node.role);
      if (model !== expected.model || effort !== expected.reasoningEffort) throw new Error('Backend model selection violates active role policy.');
      const reused = tx.prepare('SELECT node_id FROM delivery_nodes WHERE task_id=? AND cycle_no=? AND session_id=? AND node_id<>?').get(lease.taskId, lease.cycleNo, sessionId, node.node_id);
      if (reused) throw new Error('Backend session is already bound to another role in this cycle.');
      if (priorRoleSessions(tx, lease.taskId, lease.cycleNo, node.node_id).some((bound) => bound.sessionId === sessionId)) throw new Error('Backend session was previously used by another role in this cycle.');
      const at = nowIso(clock);
      tx.prepare(`UPDATE delivery_nodes SET session_id=?,model=?,effort=?,backend_ref=?,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
        .run(sessionId, model, effort, backendRef, at, lease.taskId, lease.cycleNo, lease.nodeId);
      eventInTransaction(tx, clock, lease.taskId, lease.cycleNo, 'BACKEND_HANDLE_RECORDED', { nodeId: node.node_id, sessionId, model, effort, backendRef });
      return { sessionId, model, effort, backendRef };
    });
  }

  function completeNode({ lease, result } = {}) {
    return store.transaction((tx) => {
      if (resultOutcome(result) !== 'PASS') {
        requireLease(tx, lease, ['RUNNING'], nowIso(clock));
        return applyFailure(store, clock, lease, {
          failureClass: result.failureClass,
          effectState: result.effectState ?? 'UNKNOWN',
          evidence: result.evidence ?? { reference: evidenceReference(result), code: result.code ?? 'BACKEND_NON_PASS' },
          semanticInputDigest: result.semanticInputDigest,
          sameInput: result.sameInput,
          idempotent: result.idempotent,
          provenNoEffect: result.provenNoEffect,
          operationId: result.operationId,
        });
      }
      return completePassInTransaction(store, clock, lease, result);
    });
  }

  function failNode({ lease, failureClass, effectState = 'UNKNOWN', evidence, operationId, semanticInput, semanticInputDigest, sameInput, idempotent, provenNoEffect } = {}) {
    return store.transaction((tx) => {
      requireLease(tx, lease, ['RUNNING', 'LEASED'], nowIso(clock));
      return applyFailure(store, clock, lease, { failureClass, effectState, evidence, operationId, semanticInput, semanticInputDigest, sameInput, idempotent, provenNoEffect });
    });
  }

  function reconcileUnknown({ taskId, nodeId, operationId, resolution, effectState, evidence, result } = {}) {
    if (!nonempty(taskId) || !nonempty(nodeId) || !nonempty(operationId) || !isRecord(evidence)
        || !nonempty(evidence.sourceRef) || !nonempty(evidence.finding) || !nonempty(evidence.observedAt)) {
      throw new TypeError('Read-only reconciliation requires task, node, operation, and authoritative evidence.');
    }
    const processProof = evidence.process;
    if (!isRecord(processProof) || processProof.operationId !== operationId
      || !['STOPPED', 'NOT_STARTED'].includes(processProof.status)
      || !nonempty(processProof.identityRef) || !Number.isFinite(Date.parse(processProof.checkedAt))) {
      throw new TypeError('Reconciliation requires a trusted-root process-stop identity attestation for this operation.');
    }
    if (!['NO_EFFECT', 'APPLIED_WITH_RESULT', 'APPLIED_NO_RESULT'].includes(resolution)) throw new TypeError('Unsupported reconciliation resolution.');
    return store.transaction((tx) => {
      refreshCycleDeadlines(tx);
      const unknown = tx.prepare('SELECT * FROM delivery_unknown_effects WHERE task_id=? AND operation_id=? AND state=\'UNKNOWN\'').get(taskId, operationId);
      if (!unknown || unknown.node_id !== nodeId) throw new Error('No matching quarantined effect exists.');
      const node = tx.prepare('SELECT * FROM delivery_nodes WHERE task_id=? AND cycle_no=? AND node_id=?').get(taskId, unknown.cycle_no, nodeId);
      const run = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId);
      const policy = readPolicy(store.repoRoot);
      const at = nowIso(clock);
      if (resolution === 'NO_EFFECT') {
        if (effectState !== 'NONE') throw new TypeError('NO_EFFECT reconciliation must establish effectState NONE.');
        const cycle = tx.prepare('SELECT * FROM delivery_cycles WHERE task_id=? AND cycle_no=?').get(taskId, unknown.cycle_no);
        if (cycle.state !== 'ACTIVE') {
          tx.prepare(`UPDATE delivery_unknown_effects SET state='RESOLVED_NO_EFFECT',resolution_json=?,resolved_at=? WHERE id=?`).run(json({ evidence, effectState }), at, unknown.id);
          tx.prepare(`UPDATE delivery_nodes SET state='BLOCKED',effect_state='NONE',failure_class='CYCLE_INACTIVE',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`).run(at, taskId, unknown.cycle_no, nodeId);
          tx.prepare("UPDATE delivery_runs SET state='PAUSED_CYCLE',updated_at=? WHERE task_id=?").run(at, taskId);
          eventInTransaction(tx, clock, taskId, unknown.cycle_no, 'UNKNOWN_RESOLVED_CYCLE_INACTIVE', { nodeId, operationId, evidenceSource: evidence.sourceRef });
          return { status: 'RESOLVED_NO_EFFECT', retryAllowed: false, resumable: true };
        }
        if (cycle.tool_retries >= policy.retryAndLineage.limits.maxToolRetriesPerExecutionCycle) {
          tx.prepare(`UPDATE delivery_unknown_effects SET state='RESOLVED_NO_EFFECT',resolution_json=?,resolved_at=? WHERE id=?`).run(json({ evidence, effectState }), at, unknown.id);
          tx.prepare(`UPDATE delivery_nodes SET state='BLOCKED',effect_state='NONE',failure_class='RETRY_CAP_EXHAUSTED',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
            .run(at, taskId, unknown.cycle_no, nodeId);
          tx.prepare(`UPDATE delivery_runs SET state='PAUSED_BUDGET_EXHAUSTED',updated_at=? WHERE task_id=?`).run(at, taskId);
          eventInTransaction(tx, clock, taskId, unknown.cycle_no, 'UNKNOWN_RESOLVED_NO_EFFECT_RETRY_CAP_EXHAUSTED', { nodeId, operationId, evidenceSource: evidence.sourceRef });
          return { status: 'RESOLVED_NO_EFFECT', retryAllowed: false, resumable: true };
        }
        tx.prepare(`UPDATE delivery_unknown_effects SET state='RESOLVED_NO_EFFECT',resolution_json=?,resolved_at=? WHERE id=?`).run(json({ evidence, effectState }), at, unknown.id);
        tx.prepare(`UPDATE delivery_cycles SET tool_retries=tool_retries+1,updated_at=? WHERE task_id=? AND cycle_no=?`).run(at, taskId, unknown.cycle_no);
        tx.prepare(`UPDATE delivery_nodes SET state='READY',effect_state='NONE',failure_class=NULL,dispatch_operation_id=NULL,dispatch_input_digest=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
          .run(at, taskId, unknown.cycle_no, nodeId);
        tx.prepare('UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?').run(node.role === 'worker' ? 'WORKER_READY' : node.role === 'verifier' ? 'VERIFY_READY' : 'REVIEW_READY', at, taskId);
        eventInTransaction(tx, clock, taskId, unknown.cycle_no, 'UNKNOWN_RESOLVED_NO_EFFECT', { nodeId, operationId, evidenceSource: evidence.sourceRef, toolRetry: cycle.tool_retries + 1 });
        return { status: 'RESOLVED_NO_EFFECT', retryAllowed: true, resumable: true };
      }
      if (resolution === 'APPLIED_NO_RESULT') {
        if (!['APPLIED', 'PARTIAL'].includes(effectState)) throw new TypeError('APPLIED_NO_RESULT requires a known applied or partial effect.');
        tx.prepare(`UPDATE delivery_unknown_effects SET state='RESOLVED_APPLIED_NO_RESULT',resolution_json=?,resolved_at=? WHERE id=?`).run(json({ evidence, effectState }), at, unknown.id);
        tx.prepare(`UPDATE delivery_nodes SET state='BLOCKED',effect_state=?,failure_class='APPLIED_RESULT_MISSING',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
          .run(effectState, at, taskId, unknown.cycle_no, nodeId);
        tx.prepare(`UPDATE delivery_runs SET state='BLOCKED_FOR_REASSESSMENT',updated_at=? WHERE task_id=?`).run(at, taskId);
        eventInTransaction(tx, clock, taskId, unknown.cycle_no, 'UNKNOWN_RESOLVED_APPLIED_WITHOUT_RESULT', { nodeId, operationId, evidenceSource: evidence.sourceRef });
        return { status: 'BLOCKED_FOR_REASSESSMENT', retryAllowed: false, resumable: true };
      }
      if (effectState !== 'APPLIED' || !isRecord(result)) throw new TypeError('APPLIED_WITH_RESULT requires a known applied effect and complete role result.');
      const appliedCycle = tx.prepare('SELECT state FROM delivery_cycles WHERE task_id=? AND cycle_no=?').get(taskId, unknown.cycle_no);
      if (appliedCycle.state !== 'ACTIVE') {
        tx.prepare(`UPDATE delivery_unknown_effects SET state='RESOLVED_APPLIED',resolution_json=?,resolved_at=? WHERE id=?`).run(json({ evidence, effectState, result }), at, unknown.id);
        tx.prepare(`UPDATE delivery_nodes SET state='BLOCKED',effect_state='APPLIED',failure_class='CYCLE_INACTIVE',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`).run(at, taskId, unknown.cycle_no, nodeId);
        tx.prepare("UPDATE delivery_runs SET state='PAUSED_CYCLE',updated_at=? WHERE task_id=?").run(at, taskId);
        eventInTransaction(tx, clock, taskId, unknown.cycle_no, 'APPLIED_RESULT_CAPTURED_CYCLE_INACTIVE', { nodeId, operationId, evidenceSource: evidence.sourceRef });
        return { status: 'RESOLVED_APPLIED', retryAllowed: false, resumable: true };
      }
      tx.prepare(`UPDATE delivery_unknown_effects SET state='RESOLVED_APPLIED',resolution_json=?,resolved_at=? WHERE id=?`).run(json({ evidence, effectState, resultDigest: result.resultDigest ?? null }), at, unknown.id);
      tx.prepare(`UPDATE delivery_nodes SET state='RUNNING',effect_state='APPLIED',lease_owner='reconciliation',lease_epoch=lease_epoch+1,lease_expires_at=?,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
        .run(addMinutes(at, 1), at, taskId, unknown.cycle_no, nodeId);
      tx.prepare(`UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?`).run(node.role === 'worker' ? 'WORKER_RUNNING' : node.role === 'verifier' ? 'VERIFY_RUNNING' : 'REVIEW_RUNNING', at, taskId);
      const fresh = tx.prepare('SELECT lease_epoch FROM delivery_nodes WHERE task_id=? AND cycle_no=? AND node_id=?').get(taskId, unknown.cycle_no, nodeId);
      const lease = { taskId, nodeId, cycleNo: unknown.cycle_no, ownerId: 'reconciliation', epoch: fresh.lease_epoch };
      const completed = completePassInTransaction(store, clock, lease, result);
      eventInTransaction(tx, clock, taskId, unknown.cycle_no, 'UNKNOWN_RESOLVED_APPLIED_WITH_RESULT', { nodeId, operationId, evidenceSource: evidence.sourceRef, resultDigest: result.resultDigest ?? null });
      return { status: 'RESOLVED_APPLIED', retryAllowed: false, completed };
    });
  }

  function recordRootIntegration({ taskId, headCommit, evidenceRef } = {}) {
    if (!nonempty(taskId) || !nonempty(headCommit) || !nonempty(evidenceRef)) throw new TypeError('Root integration requires taskId, integrated head commit, and evidenceRef.');
    return store.transaction((tx) => {
      ensureActiveDomainLocks(tx);
      const run = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId);
      if (!run || run.state !== 'ROOT_DELIVERY_READY') throw new Error('All worker, exact-head verification, and review stages must pass before root integration.');
      const commit = git(run.worktree_root, ['rev-parse', '--verify', headCommit + '^{commit}']).trim();
      if (commit !== headCommit) throw new Error('Root integration commit does not resolve exactly.');
      if (commit !== run.candidate_head_commit) throw new Error('Root integration must identify the exact candidate reviewed by the worker, verifier, and reviewer.');
      const current = gitSnapshot(run.worktree_root, run.base_commit, rowJson(run.proof_scope_json));
      if (!current.clean || current.violations.length || current.headCommit !== commit
          || current.digest !== run.candidate_snapshot_digest) {
        throw new Error('Root integration requires the unchanged, clean, exact-head candidate snapshot.');
      }
      const at = nowIso(clock);
      const integration = { headCommit: commit, evidenceRef, recordedAt: at, requiredCi: 'NOT_RECORDED_BY_CONTROLLER' };
      tx.prepare(`UPDATE delivery_runs SET state='ROOT_INTEGRATED_PENDING_CI',root_integration_json=?,updated_at=? WHERE task_id=?`).run(json(integration), at, taskId);
      tx.prepare('DELETE FROM delivery_write_locks WHERE task_id=?').run(taskId);
      tx.prepare('DELETE FROM delivery_domain_locks WHERE task_id=?').run(taskId);
      tx.prepare(`UPDATE delivery_cycles SET state='INTEGRATED',updated_at=? WHERE task_id=? AND cycle_no=?`).run(at, taskId, run.current_cycle);
      eventInTransaction(tx, clock, taskId, run.current_cycle, 'ROOT_INTEGRATION_RECORDED', integration);
      return { ...integration, state: 'ROOT_INTEGRATED_PENDING_CI' };
    });
  }

  function recordBaseAdvancedDisposition({ taskId, cycleNo, expectedBaseCommit, expectedCandidateHeadCommit,
    observedBaseCommit, checkpoint, evidenceRef, reason } = {}) {
    const isCommit = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
    if (!nonempty(taskId) || !Number.isSafeInteger(cycleNo) || cycleNo < 1
        || !isCommit(expectedBaseCommit) || !isCommit(expectedCandidateHeadCommit) || !isCommit(observedBaseCommit)
        || observedBaseCommit === expectedBaseCommit || !nonempty(evidenceRef) || !nonempty(reason)
        || !isRecord(checkpoint) || checkpoint.status !== 'ROOT_REPLAN_PAUSED' || checkpoint.code !== 'BASE_ADVANCED'
        || checkpoint.taskId !== taskId || checkpoint.expectedBaseCommit !== expectedBaseCommit
        || checkpoint.candidateHeadCommit !== expectedCandidateHeadCommit || !isCommit(checkpoint.actualBaseCommit)) {
      throw new TypeError('BASE_ADVANCED disposition requires the exact paused delivery checkpoint and commit bindings.');
    }
    return store.transaction((tx) => {
      ensureActiveDomainLocks(tx);
      const run = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId);
      if (!run || !['ROOT_INTEGRATED_PENDING_CI', 'BLOCKED_STALE_CANDIDATE'].includes(run.state)
          || run.current_cycle !== cycleNo || run.base_commit !== expectedBaseCommit
          || run.candidate_head_commit !== expectedCandidateHeadCommit) {
        throw new Error('BASE_ADVANCED_CONTROLLER_RUN_MISMATCH');
      }
      const cycle = tx.prepare('SELECT * FROM delivery_cycles WHERE task_id=? AND cycle_no=?').get(taskId, cycleNo);
      const initialDisposition = run.state === 'ROOT_INTEGRATED_PENDING_CI' && cycle?.state === 'INTEGRATED';
      const prior = tx.prepare(`SELECT payload_json FROM delivery_events WHERE task_id=? AND cycle_no=?
        AND event_type='ROOT_BASE_ADVANCED_DISPOSITION_RECORDED' ORDER BY sequence DESC LIMIT 1`).get(taskId, cycleNo);
      const priorPayload = prior ? rowJson(prior.payload_json) : null;
      const reassessment = run.state === 'BLOCKED_STALE_CANDIDATE' && cycle?.state === 'BLOCKED'
        && priorPayload?.disposition === 'YIELD_REASSESS' && priorPayload?.basis === 'MATERIAL_NEW_EVIDENCE'
        && priorPayload?.source === 'BASE_ADVANCED' && priorPayload.oldBaseCommit === expectedBaseCommit
        && priorPayload.oldHeadCommit === expectedCandidateHeadCommit
        && isDeepStrictEqual(priorPayload.checkpoint, checkpoint);
      if (!initialDisposition && !reassessment) throw new Error('BASE_ADVANCED_CONTROLLER_CYCLE_MISMATCH');
      const active = tx.prepare("SELECT COUNT(*) AS count FROM delivery_nodes WHERE task_id=? AND state IN ('LEASED','RUNNING')").get(taskId).count;
      const unknownEffects = tx.prepare("SELECT COUNT(*) AS count FROM delivery_unknown_effects WHERE task_id=? AND state='UNKNOWN'").get(taskId).count;
      const unknownNodes = tx.prepare("SELECT COUNT(*) AS count FROM delivery_nodes WHERE task_id=? AND effect_state='UNKNOWN'").get(taskId).count;
      if (active) throw new Error('BASE_ADVANCED_ACTIVE_LEASES_PRESENT');
      if (unknownEffects || unknownNodes) throw new Error('BASE_ADVANCED_UNKNOWN_EFFECT_PRESENT');
      const nodes = tx.prepare('SELECT node_id,state,effect_state FROM delivery_nodes WHERE task_id=? AND cycle_no=? ORDER BY node_id').all(taskId, cycleNo);
      if (nodes.length !== 3 || nodes.some((node) => node.state !== 'PASSED' || node.effect_state !== 'APPLIED')) {
        throw new Error('BASE_ADVANCED_ROLE_EVIDENCE_INCOMPLETE');
      }
      const current = gitSnapshot(run.worktree_root, run.base_commit, rowJson(run.proof_scope_json));
      if (!current.clean || current.violations.length || current.branch !== run.branch
          || current.headCommit !== expectedCandidateHeadCommit) {
        throw new Error('BASE_ADVANCED_CANDIDATE_NOT_EXACT_AND_CLEAN');
      }
      if (!isAncestor(run.worktree_root, expectedBaseCommit, observedBaseCommit)) {
        throw new Error('BASE_ADVANCED_NEW_BASE_NOT_DESCENDANT');
      }
      if (!isAncestor(run.worktree_root, checkpoint.actualBaseCommit, observedBaseCommit)) {
        throw new Error('BASE_ADVANCED_CHECKPOINT_BASE_NOT_DESCENDANT');
      }
      const scopes = rowJson(run.proof_scope_json) ?? [];
      const conflict = pathConflict(tx, taskId, scopes, run.worktree_root);
      if (conflict) throw new Error('BASE_ADVANCED_WRITE_SCOPE_LOCKED:' + conflict.taskId);
      const domainOrFeatureKey = storedDomainOrFeatureKey(run);
      if (!domainOrFeatureKey) throw new Error('BASE_ADVANCED_DOMAIN_OR_FEATURE_KEY_REQUIRED');
      const domainConflict = acquireDomainLock(tx, taskId, domainOrFeatureKey);
      if (domainConflict) throw new Error('BASE_ADVANCED_DOMAIN_OR_FEATURE_LOCKED:' + domainConflict.taskId);
      tx.prepare('DELETE FROM delivery_write_locks WHERE task_id=?').run(taskId);
      for (const scope of scopes) tx.prepare('INSERT INTO delivery_write_locks(task_id,scope_path) VALUES(?,?)').run(taskId, scope);
      const at = nowIso(clock);
      if (initialDisposition) {
        tx.prepare("UPDATE delivery_runs SET state='BLOCKED_STALE_CANDIDATE',updated_at=? WHERE task_id=?").run(at, taskId);
        tx.prepare("UPDATE delivery_cycles SET state='BLOCKED',paused_at=?,updated_at=? WHERE task_id=? AND cycle_no=?")
          .run(at, at, taskId, cycleNo);
      } else {
        tx.prepare('UPDATE delivery_runs SET updated_at=? WHERE task_id=?').run(at, taskId);
      }
      eventInTransaction(tx, clock, taskId, cycleNo, 'ROOT_BASE_ADVANCED_DISPOSITION_RECORDED', {
        disposition: 'YIELD_REASSESS', basis: 'MATERIAL_NEW_EVIDENCE', source: 'BASE_ADVANCED',
        oldBaseCommit: expectedBaseCommit, oldHeadCommit: expectedCandidateHeadCommit,
        observedBaseCommit, checkpoint, evidenceRef, reason,
      });
      return runShape(tx, tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId), { includeTaskRecord: true });
    });
  }

  function recordRootDisposition({ taskId, disposition, evidenceRef, reason } = {}) {
    if (!nonempty(taskId) || !['YIELD_REASSESS', 'BLOCKED', 'ABANDONED'].includes(disposition) || !nonempty(evidenceRef) || !nonempty(reason)) {
      throw new TypeError('Root disposition requires a supported resumable/terminal disposition, evidenceRef, and reason.');
    }
    return store.transaction((tx) => {
      const run = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId);
      if (!run) throw new Error('Unknown delivery task.');
      if (run.state === 'QUARANTINED') throw new Error('Unknown effects must be reconciled before root disposition.');
      if (tx.prepare("SELECT 1 FROM delivery_unknown_effects WHERE task_id=? AND state='UNKNOWN' LIMIT 1").get(taskId)) {
        throw new Error('Unknown effects must be reconciled before root disposition.');
      }
      const activeNode = tx.prepare("SELECT node_id FROM delivery_nodes WHERE task_id=? AND state IN ('LEASED','RUNNING') LIMIT 1").get(taskId);
      if (activeNode) throw new Error('Active leases must finish or be safely reconciled before root disposition can release locks.');
      if (disposition !== 'ABANDONED') {
        ensureActiveDomainLocks(tx);
        const scopes = rowJson(run.proof_scope_json) ?? [];
        const pathConflictResult = pathConflict(tx, taskId, scopes, run.worktree_root);
        if (pathConflictResult) throw new Error('Root disposition writeScope conflicts with ' + pathConflictResult.taskId + ' at ' + pathConflictResult.scope);
        const domainOrFeatureKey = storedDomainOrFeatureKey(run);
        if (!domainOrFeatureKey) throw new Error('ROOT_DISPOSITION_DOMAIN_OR_FEATURE_KEY_REQUIRED');
        const domainConflict = acquireDomainLock(tx, taskId, domainOrFeatureKey);
        if (domainConflict) throw new Error('Root disposition domainOrFeatureKey conflicts with ' + domainConflict.taskId);
        tx.prepare('DELETE FROM delivery_write_locks WHERE task_id=?').run(taskId);
        for (const scope of scopes) tx.prepare('INSERT INTO delivery_write_locks(task_id,scope_path) VALUES(?,?)').run(taskId, scope);
      }
      const at = nowIso(clock);
      const state = disposition === 'YIELD_REASSESS' ? 'YIELD_REASSESS' : disposition === 'ABANDONED' ? 'ABANDONED' : 'BLOCKED_BY_ROOT';
      tx.prepare('UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?').run(state, at, taskId);
      if (disposition === 'ABANDONED') {
        tx.prepare('DELETE FROM delivery_write_locks WHERE task_id=?').run(taskId);
        tx.prepare('DELETE FROM delivery_domain_locks WHERE task_id=?').run(taskId);
      }
      tx.prepare(`UPDATE delivery_cycles SET state=?,paused_at=?,updated_at=? WHERE task_id=? AND cycle_no=?`)
        .run(disposition === 'ABANDONED' ? 'ABANDONED' : 'PAUSED', at, at, taskId, run.current_cycle);
      eventInTransaction(tx, clock, taskId, run.current_cycle, 'ROOT_DISPOSITION_RECORDED', { disposition, evidenceRef, reason });
      return { taskId, state, disposition, evidenceRef, recordedAt: at };
    });
  }

  function resumeTask({ taskRecord, preflightResult, trustedMandateBinding, resumeEvidence, preparedBaseReceiptFile } = {}) {
    requireTaskRecord(taskRecord);
    const binding = checkMandateBinding(trustedMandateBinding, taskRecord, store.repoRoot);
    if (!isRecord(preflightResult) || preflightResult.status !== 'READY' || preflightResult.taskId !== taskRecord.taskId
        || preflightResult.authorityGrant !== false || preflightResult.dispatchAllowed !== false || preflightResult.checksExecuted !== false) {
      throw new TypeError('Resume requires a fresh matching READY read-only preflight.');
    }
    return store.transaction((tx) => {
      ensureActiveDomainLocks(tx);
      const run = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskRecord.taskId);
      if (!run) throw new Error('Cannot resume an unregistered task; register it after preflight.');
      const existingKey = storedDomainOrFeatureKey(run);
      if (!existingKey || existingKey !== binding.domainOrFeatureKey) throw new Error('Resume domainOrFeatureKey does not match the original root binding.');
      if (!['REPAIR_METADATA', 'YIELD_REASSESS', 'BLOCKED_EXTERNAL', 'BLOCKED_FOR_REASSESSMENT', 'BLOCKED_EFFECT_REASSESS', 'BLOCKED_STALE_CANDIDATE', 'BLOCKED_STALE_BASELINE'].includes(run.state)) {
        throw new Error('Task is not in a resumable repair or reassessment state.');
      }
      const oldDigest = semanticTaskDigest(rowJson(run.task_json));
      const newDigest = semanticTaskDigest(taskRecord);
      const evidenceChanged = nonempty(resumeEvidence?.reference) && nonempty(resumeEvidence?.reason);
      if (run.state === 'YIELD_REASSESS' && oldDigest === newDigest && !evidenceChanged) {
        throw new Error('No-progress yield requires corrected semantic metadata or material new evidence before resume.');
      }
      const baseline = preflightResult.baseline;
      const requiresPreparedBaseReceipt = ['BLOCKED_STALE_CANDIDATE', 'BLOCKED_STALE_BASELINE'].includes(run.state);
      if (requiresPreparedBaseReceipt && !nonempty(preparedBaseReceiptFile)) throw new Error('PREPARED_BASE_RECEIPT_REQUIRED');
      if (!requiresPreparedBaseReceipt && preparedBaseReceiptFile !== undefined && preparedBaseReceiptFile !== null) {
        throw new Error('PREPARED_BASE_RECEIPT_NOT_APPLICABLE');
      }
      const preparedBase = requiresPreparedBaseReceipt
        ? readPreparedBaseResumeReceipt({ store, run, taskRecord, baseline, preparedBaseReceiptFile }) : null;
      const taskRepoRoot = repositoryPaths(run.worktree_root).repoRoot;
      const current = gitSnapshot(taskRepoRoot, baseline.baseRevision, taskRecord.writeScope);
      if (current.headCommit !== baseline.headRevision || current.branch !== baseline.branch) throw new Error('Resume preflight baseline is stale.');
      if (current.violations.length) throw new Error('Resume scope check failed at ' + current.violations[0].path);
      if (preparedBase) validatePreparedBaseResume({ repoRoot: taskRepoRoot, run, receipt: preparedBase.receipt, current, baseline });
      const oldScopes = rowJson(run.proof_scope_json) ?? [];
      const newScopes = taskRecord.writeScope.map(normalizeScopePath);
      const conflict = pathConflict(tx, taskRecord.taskId, newScopes, run.worktree_root);
      if (conflict) throw new Error('Resume writeScope conflicts with ' + conflict.taskId + ' at ' + conflict.scope);
      const domainConflict = acquireDomainLock(tx, taskRecord.taskId, binding.domainOrFeatureKey);
      if (domainConflict) throw new Error('Resume domainOrFeatureKey conflicts with ' + domainConflict.taskId);
      const digest = semanticTaskDigest(taskRecord);
      const preparedBaseEvidence = preparedBase ? {
        schemaVersion: preparedBase.receipt.schemaVersion,
        taskId: preparedBase.receipt.taskId,
        cycleNo: preparedBase.receipt.cycleNo,
        receiptPath: preparedBase.receiptPath,
        receiptDigest: preparedBase.receiptDigest,
        oldHeadCommit: preparedBase.receipt.oldHeadCommit,
        headCommit: preparedBase.receipt.headCommit,
        oldBaseCommit: preparedBase.receipt.oldBaseCommit,
        newBaseCommit: preparedBase.receipt.newBaseCommit,
        reason: preparedBase.receipt.reason,
        evidenceRef: preparedBase.receipt.evidenceRef,
        ancestryVerified: true,
      } : null;
      eventInTransaction(tx, clock, taskRecord.taskId, run.current_cycle, 'TASK_RESUMED', {
        oldTaskRecordDigest: oldDigest,
        newTaskRecordDigest: digest,
        priorScopes: oldScopes,
        writeScope: newScopes,
        evidenceRef: resumeEvidence?.reference ?? null,
        ...(preparedBaseEvidence ? { preparedBaseResume: preparedBaseEvidence } : {}),
      });
      tx.prepare('DELETE FROM delivery_write_locks WHERE task_id=?').run(taskRecord.taskId);
      for (const scope of newScopes) tx.prepare('INSERT INTO delivery_write_locks(task_id,scope_path) VALUES(?,?)').run(taskRecord.taskId, scope);
      const at = nowIso(clock);
      tx.prepare(`UPDATE delivery_runs SET task_json=?,objective=?,acceptance_json=?,trusted_mandate_json=?,branch=?,base_ref=?,base_commit=?,initial_head_commit=?,initial_snapshot_digest=?,proof_scope_json=?,changed_paths_json=?,dependencies_json=?,state='WORKER_READY',candidate_head_commit=NULL,candidate_snapshot_digest=NULL,updated_at=? WHERE task_id=?`)
        .run(json(taskRecord), taskRecord.objective, json(taskRecord.acceptance), json(binding), baseline.branch, baseline.base, baseline.baseRevision, current.headCommit, current.digest,
          json(newScopes), json(current.changedPaths), json(preflightResult.dependencies ?? []), at, taskRecord.taskId);
      tx.prepare(`UPDATE delivery_cycles SET state='ACTIVE',paused_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=?`).run(at, taskRecord.taskId, run.current_cycle);
      insertNodesForResume(tx, taskRecord.taskId, run.current_cycle, digest, at);
      const resumed = runShape(tx, tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskRecord.taskId), { includeTaskRecord: true });
      if (preparedBaseEvidence) resumed.preparedBaseResume = preparedBaseEvidence;
      return resumed;
    });
  }

  function admitCycle({ taskId, taskRecord, preflightResult, trustedMandateBinding, admission,
    campaignDeadlineAt = null, campaignDeadlineBoundAt = null, campaignId, campaignTaskIds, campaignDurationMinutes,
    expectedResourceLockEpoch = null } = {}) {
    const campaignDeadlineMs = typeof campaignDeadlineAt === 'string' ? Date.parse(campaignDeadlineAt) : null;
    if (campaignDeadlineAt !== null && (typeof campaignDeadlineAt !== 'string' || !Number.isFinite(campaignDeadlineMs)
        || new Date(campaignDeadlineMs).toISOString() !== campaignDeadlineAt)) {
      throw new TypeError('Campaign source deadline evidence must be null or an exact ISO timestamp.');
    }
    const campaignDeadlineBoundMs = typeof campaignDeadlineBoundAt === 'string' ? Date.parse(campaignDeadlineBoundAt) : null;
    if (campaignDeadlineBoundAt !== null && (typeof campaignDeadlineBoundAt !== 'string'
        || !Number.isFinite(campaignDeadlineBoundMs) || new Date(campaignDeadlineBoundMs).toISOString() !== campaignDeadlineBoundAt)) {
      throw new TypeError('Effective campaign deadline bound must be null or an exact ISO timestamp.');
    }
    if (expectedResourceLockEpoch !== null && !/^\d+$/.test(expectedResourceLockEpoch)) {
      throw new TypeError('Expected resource-lock epoch must be a non-negative integer string or null.');
    }
    if (!Array.isArray(campaignTaskIds) || campaignTaskIds.some((id) => !nonempty(id))
        || new Set(campaignTaskIds).size !== campaignTaskIds.length || !campaignTaskIds.includes(taskId)
        || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(campaignId ?? '')
        || !Number.isSafeInteger(campaignDurationMinutes) || campaignDurationMinutes < 1 || campaignDurationMinutes > 120) {
      throw new TypeError('Successor-cycle admission requires campaign identity, the full unique task set, and its pinned duration.');
    }
    if (!nonempty(taskId) || !isRecord(admission) || !nonempty(admission.reason) || !nonempty(admission.evidenceRef)
        || admission.materialChange !== true || !['MATERIAL_NEW_EVIDENCE', 'CORRECTED_IMPLEMENTATION_PLAN'].includes(admission.basis)
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(admission.admissionId ?? '')
        || !/^[a-f0-9]{64}$/.test(admission.admissionRecordDigest ?? '')
        || !/^[a-f0-9]{64}$/.test(admission.taskRecordDigest ?? '')
        || !Number.isSafeInteger(admission.priorCycleNo) || admission.priorCycleNo < 1
        || !['PAUSED', 'EXHAUSTED'].includes(admission.priorCycleState)) {
      throw new TypeError('A new cycle requires a validated immutable root admission record and material evidence or a corrected implementation plan.');
    }
    requireTaskRecord(taskRecord);
    if (taskRecord.taskId !== taskId) throw new TypeError('New cycle must preserve the stable taskId.');
    const binding = checkMandateBinding(trustedMandateBinding, taskRecord, store.repoRoot);
    if (!isRecord(preflightResult) || preflightResult.status !== 'READY' || preflightResult.taskId !== taskId
        || preflightResult.schemaVersion !== 'task-preflight-result/v1'
        || normalizeText(preflightResult.objective) !== normalizeText(taskRecord.objective)
        || preflightResult.authorityGrant !== false || preflightResult.dispatchAllowed !== false
        || preflightResult.checksExecuted !== false || preflightResult.stateWritePerformed !== false
        || preflightResult.mandateReferenceIsProvenanceOnly !== true) {
      throw new TypeError('A new cycle requires a fresh matching READY preflight.');
    }
    const admissionEvidence = {
      admissionId: admission.admissionId,
      admissionRecordDigest: admission.admissionRecordDigest,
      taskRecordDigest: admission.taskRecordDigest,
      priorCycleNo: admission.priorCycleNo,
      priorCycleState: admission.priorCycleState,
      reason: admission.reason,
      evidenceRef: admission.evidenceRef,
      materialChange: admission.materialChange,
      basis: admission.basis,
    };
    return store.transaction((tx) => {
      if (expectedResourceLockEpoch !== null) {
        const currentLockEpoch = tx.prepare("SELECT value FROM controller_meta WHERE key='resourceLockEpoch'").get()?.value;
        if (currentLockEpoch !== expectedResourceLockEpoch) {
          throw new Error('Resource-lock epoch changed after successor-cycle preflight.');
        }
      }
      const deadlinePin = reconcileCampaignDeadlineInTransaction(tx, clock, { campaignId, taskIds: campaignTaskIds,
        campaignDurationMinutes, checkpointDeadlineAt: campaignDeadlineBoundAt });
      if (campaignDeadlineAt !== deadlinePin.sourceDeadlineAt) {
        if (deadlinePin.sourceDeadlineAt !== null && campaignDeadlineAt === null) {
          throw new Error('Campaign deadline evidence is required after verified worker dispatch has anchored the campaign.');
        }
        throw new Error(deadlinePin.sourceDeadlineAt === null
          ? 'Campaign deadline evidence was supplied without a verified worker dispatch anchor.'
          : 'Campaign deadline evidence does not match immutable worker dispatch history and pinned campaign duration.');
      }
      if (campaignDeadlineBoundAt !== deadlinePin.effectiveDeadlineAt) {
        throw new Error('Effective campaign deadline bound does not match the immutable campaign pin.');
      }
      const effectiveCampaignDeadlineMs = deadlinePin.effectiveDeadlineAt === null ? null
        : Date.parse(deadlinePin.effectiveDeadlineAt);
      const run = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId);
      if (!run || run.current_cycle < 1) throw new Error('Cannot admit a successor cycle without a registered execution history.');
      const cycles = tx.prepare(`SELECT cycle_no,state,started_at,CAST(submissions AS TEXT) AS submissions_text
        FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no`).all(taskId);
      if (cycles.length !== run.current_cycle || cycles.some((cycle, index) => cycle.cycle_no !== index + 1)) {
        throw new Error('Execution cycle history is incomplete; a successor cycle cannot be admitted.');
      }
      for (const cycle of cycles) {
        const submissionText = cycle.submissions_text;
        if (typeof submissionText !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(submissionText)) {
          throw new Error('Execution cycle dispatch history has an invalid submission count.');
        }
        let submissions;
        try { submissions = BigInt(submissionText); }
        catch { throw new Error('Execution cycle dispatch history has an invalid submission count.'); }
        if (submissions < 0n || submissions > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('Execution cycle dispatch history has an invalid submission count.');
        }
        const hasStartedAt = cycle.started_at !== null && cycle.started_at !== undefined;
        if (hasStartedAt) {
          const startedAtMs = typeof cycle.started_at === 'string' ? Date.parse(cycle.started_at) : NaN;
          if (!Number.isFinite(startedAtMs) || new Date(startedAtMs).toISOString() !== cycle.started_at) {
            throw new Error('Execution cycle dispatch history has an invalid start timestamp.');
          }
        }
        if (hasStartedAt !== (submissions > 0n)) {
          throw new Error('Execution cycle dispatch history is inconsistent: startedAt and submissions disagree.');
        }
      }
      ensureActiveDomainLocks(tx);
      const existingKey = storedDomainOrFeatureKey(run);
      if (!existingKey || existingKey !== binding.domainOrFeatureKey) throw new Error('New cycle domainOrFeatureKey does not match the original root binding.');
      const priorAdmissionRows = tx.prepare('SELECT task_id,cycle_no,admission_evidence_json FROM delivery_cycles WHERE admission_evidence_json IS NOT NULL').all();
      const priorAdmissions = priorAdmissionRows.map((row) => ({ ...row, admission: rowJson(row.admission_evidence_json) }))
        .filter((row) => row.admission?.admissionId === admission.admissionId);
      if (priorAdmissions.length) {
        if (priorAdmissions.length !== 1 || priorAdmissions[0].task_id !== taskId
            || priorAdmissions[0].cycle_no !== admission.priorCycleNo + 1
            || stableJson(priorAdmissions[0].admission) !== stableJson(admissionEvidence)) {
          throw new Error('Cycle admission identifier is already bound to conflicting lineage or evidence.');
        }
        if (run.current_cycle !== priorAdmissions[0].cycle_no) throw new Error('Cycle admission replay is superseded by a later execution cycle.');
        if (semanticTaskDigest(rowJson(run.task_json)) !== semanticTaskDigest(taskRecord)) {
          throw new Error('Cycle admission replay task record no longer matches the admitted cycle.');
        }
        return runShape(tx, run, { includeTaskRecord: true });
      }
      const previous = cycles.at(-1);
      if (previous.cycle_no !== admission.priorCycleNo || previous.state !== admission.priorCycleState
          || !['PAUSED', 'EXHAUSTED'].includes(previous.state)) {
        throw new Error('Cycle admission predecessor number or state does not match the paused or exhausted controller history.');
      }
      if (!ROOT_ADMISSION_RUN_STATES.has(run.state)) {
        throw new Error('Controller run state is not paused for a successor cycle admission.');
      }
      const activeNodes = tx.prepare("SELECT COUNT(*) AS count FROM delivery_nodes WHERE task_id=? AND state IN ('LEASED','RUNNING')").get(taskId).count;
      const openUnknown = tx.prepare("SELECT COUNT(*) AS count FROM delivery_unknown_effects WHERE task_id=? AND state='UNKNOWN'").get(taskId).count;
      const unknownNodes = tx.prepare("SELECT COUNT(*) AS count FROM delivery_nodes WHERE task_id=? AND (effect_state='UNKNOWN' OR state='QUARANTINED')").get(taskId).count;
      if (activeNodes) throw new Error('Active leases must finish or be reconciled before admitting a new cycle.');
      if (openUnknown || unknownNodes) throw new Error('Unknown effects must be reconciled before admitting a new cycle.');
      const baseline = preflightResult.baseline;
      if (!isRecord(baseline) || !nonempty(baseline.base) || !/^[a-f0-9]{40}$/.test(baseline.baseRevision ?? '')
          || !/^[a-f0-9]{40}$/.test(baseline.headRevision ?? '') || !nonempty(baseline.branch)
          || baseline.branch.toLowerCase() === 'main' || typeof baseline.dirty !== 'boolean') {
        throw new Error('New cycle requires exact READY worktree and base evidence.');
      }
      const taskRepoRoot = repositoryPaths(run.worktree_root).repoRoot;
      const resolvedBase = git(taskRepoRoot, ['rev-parse', '--verify', `${baseline.base}^{commit}`]).trim();
      if (resolvedBase !== baseline.baseRevision) throw new Error('New cycle preflight base reference is stale.');
      const current = gitSnapshot(taskRepoRoot, baseline.baseRevision, taskRecord.writeScope);
      if (current.headCommit !== baseline.headRevision || current.branch !== baseline.branch
          || baseline.dirty !== !current.clean || current.violations.length) throw new Error('New cycle preflight baseline or scope is stale.');
      const scopes = taskRecord.writeScope.map(normalizeScopePath);
      const conflict = pathConflict(tx, taskId, scopes, run.worktree_root);
      if (conflict) throw new Error('New cycle scope conflicts with ' + conflict.taskId + ' at ' + conflict.scope);
      const ownDomain = tx.prepare('SELECT domain_or_feature_key FROM delivery_domain_locks WHERE task_id=?').get(taskId);
      if (ownDomain && ownDomain.domain_or_feature_key !== binding.domainOrFeatureKey) throw new Error('DOMAIN_LOCK_BINDING_MISMATCH');
      const domainConflict = ownDomain ? null : domainLockConflict(tx, taskId, binding.domainOrFeatureKey);
      if (domainConflict) throw new Error('New cycle domainOrFeatureKey conflicts with ' + domainConflict.taskId);
      const at = nowIso(clock);
      if (effectiveCampaignDeadlineMs !== null && Date.parse(at) >= effectiveCampaignDeadlineMs) {
        throw new Error('Campaign deadline expired before successor cycle admission.');
      }
      if (!ownDomain) tx.prepare('INSERT INTO delivery_domain_locks(domain_or_feature_key,task_id) VALUES(?,?)')
        .run(binding.domainOrFeatureKey, taskId);
      tx.prepare('DELETE FROM delivery_write_locks WHERE task_id=?').run(taskId);
      for (const scope of scopes) tx.prepare('INSERT INTO delivery_write_locks(task_id,scope_path) VALUES(?,?)').run(taskId, scope);
      const nextCycle = run.current_cycle + 1;
      tx.prepare(`INSERT INTO delivery_cycles(task_id,cycle_no,state,admitted_at,admission_reason,admission_evidence_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(taskId, nextCycle, 'ACTIVE', at, admission.reason, json(admissionEvidence), at, at);
      const digest = semanticTaskDigest(taskRecord);
      tx.prepare(`UPDATE delivery_runs SET task_json=?,objective=?,acceptance_json=?,trusted_mandate_json=?,branch=?,base_ref=?,base_commit=?,initial_head_commit=?,initial_snapshot_digest=?,proof_scope_json=?,changed_paths_json=?,dependencies_json=?,state='WORKER_READY',current_cycle=?,candidate_head_commit=NULL,candidate_snapshot_digest=NULL,updated_at=? WHERE task_id=?`)
        .run(json(taskRecord), taskRecord.objective, json(taskRecord.acceptance), json(binding), baseline.branch, baseline.base, baseline.baseRevision, current.headCommit, current.digest,
          json(scopes), json(current.changedPaths), json(preflightResult.dependencies ?? []), nextCycle, at, taskId);
      insertNodes(tx, taskId, nextCycle, digest, at);
      eventInTransaction(tx, clock, taskId, nextCycle, 'ROOT_ADMITTED_EXECUTION_CYCLE', {
        ...admissionEvidence, campaignId, campaignDeadlineAt, campaignDeadlineBoundAt,
        campaignDurationMinutes, campaignTaskIds: deadlinePin.taskIds,
        previousCycle: run.current_cycle, semanticTaskDigest: digest,
      });
      if (effectiveCampaignDeadlineMs !== null && Date.parse(nowIso(clock)) >= effectiveCampaignDeadlineMs) {
        throw new Error('Campaign deadline expired during successor cycle admission.');
      }
      return runShape(tx, tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId), { includeTaskRecord: true });
    });
  }

  function releaseLease(lease) {
    return store.transaction((tx) => {
      const node = requireLease(tx, lease, ['LEASED', 'RUNNING'], nowIso(clock));
      if (node.state === 'RUNNING' && node.dispatch_operation_id) throw new Error('A dispatched operation cannot release its lease before completion or reconciliation.');
      const at = nowIso(clock);
      tx.prepare(`UPDATE delivery_nodes SET state='READY',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND cycle_no=? AND node_id=?`)
        .run(at, lease.taskId, lease.cycleNo, lease.nodeId);
      eventInTransaction(tx, clock, lease.taskId, lease.cycleNo, 'UNUSED_NODE_LEASE_RELEASED', { nodeId: lease.nodeId, ownerId: lease.ownerId, fencingEpoch: lease.epoch });
      return { released: true, taskId: lease.taskId, nodeId: lease.nodeId, epoch: lease.epoch };
    });
  }

  function recordPreflightRepair({ taskId, taskRecord, trustedMandateBinding, effectState = 'NONE', evidence, semanticInput } = {}) {
    if (!nonempty(taskId) || !isRecord(taskRecord) || !isRecord(evidence) || !Object.keys(evidence).length) throw new TypeError('Preflight repair requires stable taskId, metadata, and evidence.');
    if (effectState !== 'NONE') return { outcome: 'BLOCKED_EFFECT_REASSESS', resumable: true, terminal: false, retryAllowed: false };
    if (!isRecord(trustedMandateBinding) || trustedMandateBinding.resolvedBy !== 'root' || trustedMandateBinding.taskId !== taskId) {
      throw new TypeError('Preflight repair requires root-bound trusted mandate context.');
    }
    const domainOrFeatureKey = normalizeDomainOrFeatureKey(trustedMandateBinding.domainOrFeatureKey);
    const policy = readPolicy(store.repoRoot);
    return store.transaction((tx) => {
      let row = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId);
      const existingKey = storedDomainOrFeatureKey(row);
      if (existingKey && existingKey !== domainOrFeatureKey) throw new Error('Preflight repair domainOrFeatureKey does not match the original root binding.');
      if (!row) {
        const baselineHead = git(store.repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
        const branch = git(store.repoRoot, ['branch', '--show-current']).trim() || 'unknown';
        const sourceObjective = nonempty(trustedMandateBinding.objective) ? trustedMandateBinding.objective : taskRecord.objective ?? 'Metadata repair';
        const at = nowIso(clock);
        const emptyTask = { schemaVersion: 'task-readiness/v1', taskId, objective: sourceObjective, acceptance: [], writeScope: [], checks: [], mandateReference: 'root-bound-provenance' };
        const emptyDigest = sha256(stableJson(semanticInput ?? taskRecord));
        tx.prepare(`INSERT INTO delivery_runs(task_id,worktree_root,objective,acceptance_json,task_json,trusted_mandate_json,branch,base_ref,base_commit,initial_head_commit,initial_snapshot_digest,proof_scope_json,changed_paths_json,dependencies_json,state,current_cycle,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(taskId, store.repoRoot, sourceObjective, '[]', json(emptyTask), json({ sourceRef: trustedMandateBinding.sourceRef ?? null, domainOrFeatureKey, digest: sha256(stableJson({ ...trustedMandateBinding, domainOrFeatureKey })) }), branch, 'unresolved', baselineHead, baselineHead, sha256('preflight-only'), '[]', '[]', '[]', 'REPAIR_METADATA', 0, at, at);
        row = tx.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(taskId);
        const fingerprint = sha256(`AUTOMATIC_TASK_PREFLIGHT\nMETADATA_DEFECT\n${emptyDigest}`);
        const occurrences = 1;
        tx.prepare('INSERT INTO delivery_no_progress(task_id,fingerprint,occurrences,semantic_input_json,updated_at) VALUES(?,?,?,?,?)')
          .run(taskId, fingerprint, occurrences, stableJson(semanticInput ?? taskRecord), at);
        eventInTransaction(tx, clock, taskId, 0, 'PREFLIGHT_METADATA_DEFECT', { semanticDigest: emptyDigest, occurrences, failureEvidenceRef: evidence.reference ?? null });
        return { outcome: occurrences >= policy.retryAndLineage.limits.maxOccurrencesPerNoProgressFingerprint ? 'YIELD_REASSESS' : 'REPAIR_METADATA', occurrences, noProgressCap: policy.retryAndLineage.limits.maxOccurrencesPerNoProgressFingerprint, resumable: true, consumesImplementationRepair: false };
      }
      if (row.current_cycle !== 0) throw new Error('Use failNode for metadata defects after a worker cycle has started.');
      const digest = sha256(stableJson(semanticInput ?? taskRecord));
      const fingerprint = sha256(`AUTOMATIC_TASK_PREFLIGHT\nMETADATA_DEFECT\n${digest}`);
      const existing = tx.prepare('SELECT occurrences FROM delivery_no_progress WHERE task_id=? AND fingerprint=?').get(taskId, fingerprint);
      const occurrences = (existing?.occurrences ?? 0) + 1;
      const at = nowIso(clock);
      tx.prepare(`INSERT INTO delivery_no_progress(task_id,fingerprint,occurrences,semantic_input_json,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(task_id,fingerprint) DO UPDATE SET occurrences=excluded.occurrences,semantic_input_json=excluded.semantic_input_json,updated_at=excluded.updated_at`)
        .run(taskId, fingerprint, occurrences, stableJson(semanticInput ?? taskRecord), at);
      const outcome = occurrences >= policy.retryAndLineage.limits.maxOccurrencesPerNoProgressFingerprint ? 'YIELD_REASSESS' : 'REPAIR_METADATA';
      tx.prepare('UPDATE delivery_runs SET state=?,updated_at=? WHERE task_id=?').run(outcome, at, taskId);
      eventInTransaction(tx, clock, taskId, 0, 'PREFLIGHT_METADATA_DEFECT', { semanticDigest: digest, occurrences, failureEvidenceRef: evidence.reference ?? null });
      return { outcome, occurrences, noProgressCap: policy.retryAndLineage.limits.maxOccurrencesPerNoProgressFingerprint, resumable: true, consumesImplementationRepair: false };
    });
  }

  function missionControlSnapshot(taskIds = undefined) {
    const runs = listRuns().filter((run) => !Array.isArray(taskIds) || taskIds.includes(run.taskId));
    return {
      schemaVersion: 'delivery-dag-observation/v1',
      freshness: 'LIVE',
      observedAt: nowIso(clock),
      source: 'repository-local-delivery-controller',
      readOnly: true,
      tasks: runs.map((run) => ({
        taskId: run.taskId,
        state: run.state,
        currentCycle: run.currentCycle,
        objective: run.objective,
        branch: run.branch,
        baseCommit: run.baseCommit,
        candidateHeadCommit: run.candidateHeadCommit,
        proofScope: run.proofScope,
        changedFiles: run.changedFiles,
        dependencies: run.dependencies,
        stages: run.stages,
        blockers: run.blockers,
        updatedAt: run.updatedAt,
      })),
    };
  }

  return {
    repoRoot: store.repoRoot,
    databasePath: store.databasePath,
    registerTask,
    nextReadyNodes,
    claimNode,
    heartbeat,
    recordDispatchIntent,
    cancelDispatchBeforeLaunch,
    recordBackendHandle,
    completeNode,
    failNode,
    reconcileUnknown,
    recordRootIntegration,
    recordBaseAdvancedDisposition,
    recordRootDisposition,
    recordPreflightRepair,
    resumeTask,
    admitCycle,
    inspectCampaignDispatchHistory,
    reconcileCampaignDeadline,
    releaseLease,
    getRun,
    inspectBaseAdvancedPause,
    inspectCycleAdmissionConflicts,
    listRuns,
    missionControlSnapshot,
    verifyEventChain: () => {
      const { count, head } = readAndVerifyEvents(db);
      return { count, head };
    },
    close: () => store.close(),
  };
}

function insertNodesForResume(db, taskId, cycleNo, taskDigest, at) {
  db.prepare(`UPDATE delivery_nodes SET state='READY',input_digest=?,required_head_commit=NULL,required_snapshot_digest=NULL,candidate_head_commit=NULL,candidate_snapshot_digest=NULL,
    session_id=NULL,model=NULL,effort=NULL,backend_ref=NULL,result_digest=NULL,evidence_json=NULL,effect_state='NONE',failure_class=NULL,dispatch_operation_id=NULL,dispatch_input_digest=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
    WHERE task_id=? AND cycle_no=? AND node_id='worker'`).run(taskDigest, at, taskId, cycleNo);
  db.prepare(`UPDATE delivery_nodes SET state='WAITING',input_digest=?,required_head_commit=NULL,required_snapshot_digest=NULL,candidate_head_commit=NULL,candidate_snapshot_digest=NULL,
    session_id=NULL,model=NULL,effort=NULL,backend_ref=NULL,result_digest=NULL,evidence_json=NULL,effect_state='NONE',failure_class=NULL,dispatch_operation_id=NULL,dispatch_input_digest=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
    WHERE task_id=? AND cycle_no=? AND node_id IN ('verifier','reviewer')`).run(taskDigest, at, taskId, cycleNo);
}

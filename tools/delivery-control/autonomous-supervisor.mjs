import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { openDeliveryController } from './controller.mjs';
import { repositoryPaths } from './controller-store.mjs';
import { createControllerRunner } from './controller-runner.mjs';
import { admitConfiguredTasks } from './controller-cli.mjs';
import { preflightTask } from './preflight.mjs';
import { runRoadmapIntake } from './roadmap-intake.mjs';
import { createGitHubDeliveryAdapter } from './github-delivery.mjs';
import { startControllerDashboard, startControllerLivenessHeartbeat } from './controller-dashboard.mjs';
import { createControllerEventReader } from './worker-observability-reader.mjs';
import { baseAdvancedResumeSignature, fetchConfiguredBase, prepareBaseAdvancedResume,
  readConfiguredRemoteBase, validatePreparedReceiptPath } from './base-advanced-resume.mjs';

const git = (cwd, argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000 }).trim();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesDigest = (value) => createHash('sha256').update(value).digest('hex');
const pathKey = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
const parse = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const staleResumeStates = new Set(['BLOCKED_STALE_CANDIDATE', 'BLOCKED_STALE_BASELINE']);
const CYCLE_ADMISSION_BASES = new Set(['MATERIAL_NEW_EVIDENCE', 'CORRECTED_IMPLEMENTATION_PLAN']);
const SUPERVISOR_OBSERVATION_STATUSES = new Set(['INTAKE_BOUND', 'INTAKE_WAITING', 'INTAKE_REASSESSMENT_REQUIRED',
  'HOLD_TRUSTED_BINDING', 'HOLD_CYCLE_ADMISSION', 'HOLD_REVIEW_REQUIRED', 'HOLD_AMBIGUOUS_ROADMAP', 'HOLD_DEPENDENCY',
  'HOLD_TASK_STATUS', 'HOLD_SCOPE_CONFLICT', 'HOLD_PREFLIGHT', 'HOLD_RECONCILE',
  'HOLD_REASSESSMENT_REQUIRED', 'HOLD_INTAKE_IN_PROGRESS', 'HOLD_COLLISION', 'HOLD_NO_READY_TASK',
  'HOLD_NOT_ALLOWED', 'HOLD_ENVIRONMENT', 'HOLD_REPOSITORY', 'HOLD_CAMPAIGN', 'HOLD_BASE',
  'HOLD_ROADMAP', 'HOLD_CONTROLLER_STATE', 'HOLD_SCOPE', 'HOLD_USAGE', 'CYCLE_ADMISSION_ACCEPTED', 'CYCLE_ADMISSION_REPLAYED',
  'READY_CANDIDATE', 'ALREADY_COMPLETE',
  'BASE_ADVANCED_RESUME_PREPARED', 'BASE_ADVANCED_RESUME_REASSESSMENT_REQUIRED', 'BASE_ADVANCED_RESUME_REASSESSMENT_QUEUED',
  'PREPARED_BASE_RESUME_ACCEPTED', 'PREPARED_BASE_RESUME_REASSESSMENT_REQUIRED', 'PREPARED_RESUME_REASSESSMENT_QUEUED',
  'ROOT_PREPARATION_REASSESSMENT_REQUIRED', 'PAUSED_DEADLINE', 'DISPATCH_BLOCKED', 'RUNNING', 'YIELD_REASSESS',
  'DELIVERY_REASSESSMENT_REQUIRED', 'PUSHED', 'PR_CREATED', 'MERGED', 'WAITING_CI', 'WAITING_PR_HEAD_UPDATE',
  'WAITING_DRAFT', 'WAITING_REVIEW', 'WAITING_MERGEABILITY', 'WAITING_MERGE_QUEUE', 'WAITING_BASE_UPDATE',
  'WAITING_RETRY_BACKOFF', 'REPLAN_REQUIRED', 'ROOT_REPLAN_PAUSED', 'PULL_REQUEST_CLOSED_UNMERGED',
  'REMOTE_BRANCH_DIVERGED', 'UNKNOWN_EFFECT', 'BLOCKED', 'BUSY', 'RECONCILED_APPLIED']);

async function preparedEvidenceSignature({ binding, run, receiptFile, baseRef, readRemoteBase, privateRoot, stateRoot }) {
  const readEvidence = (file) => {
    try {
      validatePreparedReceiptPath({ privateRoot, stateRoot, receiptFile: file, taskId: binding.taskId,
        cycleNo: run?.currentCycle });
      return { path: fs.realpathSync(file), bytes: fs.readFileSync(file).toString('base64') };
    }
    catch (error) { return { path: path.resolve(file), error: error.code ?? error.message }; }
  };
  let worktree;
  try {
    worktree = {
      root: fs.realpathSync(binding.worktree),
      head: git(binding.worktree, ['rev-parse', '--verify', 'HEAD^{commit}']),
      branch: git(binding.worktree, ['branch', '--show-current']),
      status: git(binding.worktree, ['status', '--porcelain', '--untracked-files=all']),
    };
  } catch (error) { worktree = { error: error.code ?? error.message }; }
  let remoteBaseSha;
  try { remoteBaseSha = await readRemoteBase({ repo: binding.worktree, baseRef }); }
  catch (error) { remoteBaseSha = { error: error.code ?? error.message }; }
  let fetchedBaseSha;
  try { fetchedBaseSha = git(binding.worktree, ['rev-parse', '--verify', `${baseRef}^{commit}`]); }
  catch (error) { fetchedBaseSha = { error: error.code ?? error.message }; }
  return digest({
    taskId: binding.taskId,
    state: run?.state ?? null,
    currentCycle: run?.currentCycle ?? null,
    baseCommit: run?.baseCommit ?? null,
    initialHeadCommit: run?.initialHeadCommit ?? null,
    candidateHeadCommit: run?.candidateHeadCommit ?? null,
    branch: run?.branch ?? null,
    receipt: readEvidence(receiptFile),
    task: readEvidence(binding.taskFile),
    worktree,
    baseRef,
    fetchedBaseSha,
    remoteBaseSha,
  });
}

function preparedBaseError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function shouldYieldFiniteRun(status, result) {
  if (result.active > 0) return false;
  const progressing = new Set(['PUSHED', 'PR_CREATED', 'RECONCILED_APPLIED', 'WAITING_CI', 'WAITING_RETRY_BACKOFF', 'WAITING_MERGE_QUEUE', 'BUSY']);
  return !Object.values(status.deliveries).some((delivery) => progressing.has(delivery.status));
}

function privateFile(privateRoot, filename, code) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error(code);
  let resolved;
  try { resolved = fs.realpathSync(filename); }
  catch { throw new Error(code); }
  if (!within(privateRoot, resolved) || pathKey(resolved) !== pathKey(path.resolve(filename))) throw new Error(code);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(code);
  return { file: resolved, bytes: fs.readFileSync(resolved) };
}

function executableCapabilitySnapshot(taskRecord) {
  const pathValue = process.env.PATH ?? '';
  const pathExtValue = process.env.PATHEXT ?? '';
  const pathEntries = pathValue.split(path.delimiter);
  const extensions = ['', ...pathExtValue.split(';').filter(Boolean)];
  return {
    pathValue,
    pathExtValue,
    checks: (taskRecord?.checks ?? []).map((check) => {
      const executable = check?.executable;
      if (typeof executable !== 'string' || !executable) return { executable: executable ?? null, candidates: [] };
      const candidates = path.isAbsolute(executable) ? [path.resolve(executable)]
        : pathEntries.flatMap((folder) => extensions.map((extension) => path.resolve(folder || '.', executable + extension)));
      return { executable, candidates: [...new Set(candidates)].map((candidate) => {
        try {
          const stat = fs.statSync(candidate);
          return { path: candidate, present: true, isFile: stat.isFile(), size: stat.size, mode: stat.mode,
            mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, dev: stat.dev, ino: stat.ino };
        } catch (error) {
          return { path: candidate, present: false, code: error.code ?? 'STAT_FAILED' };
        }
      }) };
    }),
  };
}

function cycleAdmissionTaskEnvironmentEvidence(privateRoot, binding, admission) {
  const filename = binding?.taskFile ?? admission.record?.taskFile;
  try {
    const taskFile = privateFile(privateRoot, filename, 'CYCLE_ADMISSION_TASK_FILE_MUST_BE_PRIVATE');
    const taskFileDigest = bytesDigest(taskFile.bytes);
    const taskPathMatchesAdmission = pathKey(taskFile.file) === pathKey(admission.taskFile);
    let taskRecord;
    try { taskRecord = JSON.parse(taskFile.bytes.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { return { path: taskFile.file, taskFileDigest, taskPathMatchesAdmission, recordError: 'INVALID_JSON' }; }
    return { path: taskFile.file, taskFileDigest, taskPathMatchesAdmission,
      capabilities: executableCapabilitySnapshot(taskRecord) };
  } catch (error) {
    return { path: filename ?? null, taskPathMatchesAdmission: false, recordError: String(error.code ?? error.message),
      pathValue: process.env.PATH ?? '', pathExtValue: process.env.PATHEXT ?? '' };
  }
}

function cycleAdmissionWorktreeIdentity(worktreePath, expectedCommon) {
  const worktreeRoot = fs.realpathSync(worktreePath);
  const repository = repositoryPaths(worktreeRoot);
  if (pathKey(repository.repoRoot) !== pathKey(worktreeRoot)
      || pathKey(repository.gitCommonDir) !== pathKey(expectedCommon)) {
    throw new Error('CYCLE_ADMISSION_WORKTREE_REPOSITORY_MISMATCH');
  }
  return { worktreeRoot, repositoryRoot: repository.repoRoot, gitCommonDir: repository.gitCommonDir };
}

function sameCycleAdmissionWorktreeIdentity(left, right) {
  return pathKey(left.worktreeRoot) === pathKey(right.worktreeRoot)
    && pathKey(left.repositoryRoot) === pathKey(right.repositoryRoot)
    && pathKey(left.gitCommonDir) === pathKey(right.gitCommonDir);
}

function hasCycleAdmissionLockConflicts(evidence) {
  return ['worktree', 'writeScope', 'domain'].some((key) => Array.isArray(evidence?.[key]) && evidence[key].length > 0);
}

function loadCycleAdmissions({ privateRoot, campaign, intakeCampaign }) {
  const references = campaign.cycleAdmissions ?? [];
  if (!Array.isArray(references)) throw new Error('INVALID_CYCLE_ADMISSIONS');
  const taskIds = new Set();
  const admissionIds = new Set();
  return references.map((reference) => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)
        || Object.keys(reference).sort().join(',') !== 'admissionRecordDigest,recordFile,taskId'
        || typeof reference.taskId !== 'string' || !/^[A-Z][A-Z0-9_-]{0,95}$/.test(reference.taskId)
        || !intakeCampaign.allowedTaskIds.includes(reference.taskId)
        || !/^[a-f0-9]{64}$/.test(reference.admissionRecordDigest ?? '')
        || taskIds.has(reference.taskId)) throw new Error('INVALID_CYCLE_ADMISSION_REFERENCE');
    taskIds.add(reference.taskId);
    const recordFile = privateFile(privateRoot, reference.recordFile, 'CYCLE_ADMISSION_MUST_BE_PRIVATE');
    const actualRecordDigest = bytesDigest(recordFile.bytes);
    if (actualRecordDigest !== reference.admissionRecordDigest) throw new Error('CYCLE_ADMISSION_DIGEST_MISMATCH');
    let record;
    try { record = JSON.parse(recordFile.bytes.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('CYCLE_ADMISSION_INVALID_JSON'); }
    const recordKeys = ['admissionId', 'basis', 'evidenceRef', 'materialChange', 'priorCycleNo', 'priorCycleState',
      'reason', 'schemaVersion', 'taskFile', 'taskId', 'taskRecordDigest'].sort().join(',');
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || Object.keys(record).sort().join(',') !== recordKeys
        || record.schemaVersion !== 'root-execution-cycle-admission/v1'
        || record.taskId !== reference.taskId
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.admissionId ?? '')
        || admissionIds.has(record.admissionId)
        || !Number.isSafeInteger(record.priorCycleNo) || record.priorCycleNo < 1
        || !['PAUSED', 'EXHAUSTED'].includes(record.priorCycleState)
        || !/^[a-f0-9]{64}$/.test(record.taskRecordDigest ?? '')
        || typeof record.reason !== 'string' || !record.reason.trim()
        || typeof record.evidenceRef !== 'string' || !record.evidenceRef.trim()
        || record.materialChange !== true || !CYCLE_ADMISSION_BASES.has(record.basis)) {
      throw new Error('CYCLE_ADMISSION_SCHEMA_INVALID');
    }
    admissionIds.add(record.admissionId);
    const taskFile = privateFile(privateRoot, record.taskFile, 'CYCLE_ADMISSION_TASK_RECORD_MUST_BE_PRIVATE');
    if (bytesDigest(taskFile.bytes) !== record.taskRecordDigest) throw new Error('CYCLE_ADMISSION_TASK_RECORD_DIGEST_MISMATCH');
    let taskRecord;
    try { taskRecord = JSON.parse(taskFile.bytes.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('CYCLE_ADMISSION_TASK_RECORD_INVALID_JSON'); }
    if (!taskRecord || typeof taskRecord !== 'object' || Array.isArray(taskRecord)
        || taskRecord.schemaVersion !== 'task-readiness/v1' || taskRecord.taskId !== record.taskId) {
      throw new Error('CYCLE_ADMISSION_TASK_RECORD_MISMATCH');
    }
    return { ...reference, recordFile: recordFile.file, record, taskFile: taskFile.file, taskRecord };
  });
}

function cycleAdmissionMatches(run, admission) {
  const { record, admissionRecordDigest } = admission;
  const taskRecordDigest = record.taskRecordDigest;
  const cycleNo = record.priorCycleNo + 1;
  const cycle = run?.cycles?.find((item) => item.cycleNo === cycleNo);
  const evidence = cycle?.admission;
  return run?.currentCycle === cycleNo && cycle?.cycleNo === cycleNo
    && evidence?.admissionId === record.admissionId
    && evidence?.admissionRecordDigest === admissionRecordDigest
    && evidence?.taskRecordDigest === taskRecordDigest
    && evidence?.priorCycleNo === record.priorCycleNo
    && evidence?.priorCycleState === record.priorCycleState
    && evidence?.reason === record.reason && evidence?.evidenceRef === record.evidenceRef
    && evidence?.materialChange === record.materialChange && evidence?.basis === record.basis;
}

/** Root-owned private configuration is the authority boundary, never roadmap prose. */
export function loadSupervisorCampaign(repoRoot, campaignFile) {
  const root = fs.realpathSync(repoRoot);
  const common = fs.realpathSync(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const privateRoot = path.join(common, 'zuri-delivery-control');
  const file = fs.realpathSync(campaignFile);
  if (!within(privateRoot, file)) throw new Error('CAMPAIGN_MUST_BE_PRIVATE');
  const campaign = parse(file);
  if (campaign.schemaVersion !== 'autonomous-delivery-campaign/v1'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(campaign.campaignId)
    || fs.realpathSync(campaign.repositoryRoot) !== root
    || !campaign.sourceRef || !Array.isArray(campaign.authorizedEffects)
    || !['intake', 'dispatch', 'rootIntegration', 'push', 'pullRequest', 'merge'].every((effect) => campaign.authorizedEffects.includes(effect))
    || !Array.isArray(campaign.prohibitions) || campaign.prohibitions.length === 0
    || ![1, 2].includes(campaign.maxConcurrent ?? 2)
    || !Number.isInteger(campaign.maxCampaignMinutes ?? 120)
    || (campaign.maxCampaignMinutes ?? 120) < 1 || (campaign.maxCampaignMinutes ?? 120) > 120) throw new Error('INVALID_SUPERVISOR_CAMPAIGN');
  const intakeFile = fs.realpathSync(campaign.intakeCampaignFile);
  if (!within(privateRoot, intakeFile)) throw new Error('INTAKE_CAMPAIGN_MUST_BE_PRIVATE');
  const intakeCampaign = parse(intakeFile);
  if (fs.realpathSync(intakeCampaign.repositoryRoot) !== root || !Array.isArray(intakeCampaign.allowedTaskIds)
    || !intakeCampaign.allowedTaskIds.length || new Set(intakeCampaign.allowedTaskIds).size !== intakeCampaign.allowedTaskIds.length
    || !isDeepStrictEqual(intakeCampaign.prohibitions, campaign.prohibitions)) throw new Error('CAMPAIGN_INTAKE_MISMATCH');
  if (!/^[A-Za-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(campaign.delivery?.expectedOwnerRepo ?? '')
    || !Array.isArray(campaign.delivery.requiredChecks) || !campaign.delivery.requiredChecks.length) throw new Error('DELIVERY_CHECKS_REQUIRED');
  const deliveryBaseRef = `${campaign.delivery.remoteName ?? 'origin'}/${campaign.delivery.base ?? 'main'}`;
  if ((intakeCampaign.baseRef ?? 'origin/main') !== deliveryBaseRef) throw new Error('INTAKE_DELIVERY_BASE_MISMATCH');
  const cycleAdmissions = loadCycleAdmissions({ privateRoot, campaign, intakeCampaign });
  return { root, common, privateRoot, file, campaign, intakeFile, intakeCampaign,
    cycleAdmissions, campaignDigest: digest({ campaign, intakeCampaign,
      cycleAdmissions: cycleAdmissions.map(({ taskId, admissionRecordDigest }) => ({ taskId, admissionRecordDigest })) }) };
}

/** One root service; models never receive this object's GitHub or intake capabilities. */
export async function createAutonomousSupervisor({ repoRoot, campaignFile, controller: providedController,
  runnerFactory = createControllerRunner, intake = runRoadmapIntake, deliveryFactory = createGitHubDeliveryAdapter,
  admit = admitConfiguredTasks, preflight = preflightTask,
  fetchPreparedBase: fetchBase = fetchConfiguredBase, readRemoteBase: readBase = readConfiguredRemoteBase,
  mergeBase, baseAdvancedResume: prepareAdvancedResume = prepareBaseAdvancedResume,
  baseAdvancedResumeSignature: advancedSignature = baseAdvancedResumeSignature,
  now = () => Date.now() }) {
  const loaded = loadSupervisorCampaign(repoRoot, campaignFile);
  const { root, common, privateRoot, campaign, intakeFile, intakeCampaign, campaignDigest, cycleAdmissions } = loaded;
  const stateRoot = path.join(privateRoot, 'supervisors', campaign.campaignId);
  const controllerStateRoot = path.join(common, 'zuri-delivery-control', 'controller-v1');
  fs.mkdirSync(stateRoot, { recursive: true });
  if (!within(privateRoot, fs.realpathSync(stateRoot))) throw new Error('SUPERVISOR_STATE_ESCAPE');
  const lockFile = path.join(stateRoot, 'owner.json');
  const owner = { processId: process.pid, nonce: randomUUID(), startedAt: new Date(now()).toISOString() };
  try { fs.writeFileSync(lockFile, JSON.stringify(owner), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = parse(lockFile);
    if (!Number.isSafeInteger(previous.processId) || previous.processId < 1) throw new Error('SUPERVISOR_LOCK_RECONCILIATION_REQUIRED');
    try { process.kill(previous.processId, 0); throw new Error('SUPERVISOR_ALREADY_RUNNING'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    // This only reclaims the root service lock. Controller leases and unknown effects
    // remain authoritative and keep orphaned model processes quarantined.
    fs.unlinkSync(lockFile);
    fs.writeFileSync(lockFile, JSON.stringify(owner), { flag: 'wx' });
  }
  const checkpointFile = path.join(stateRoot, 'checkpoint.json');
  const releaseLock = () => { if (fs.existsSync(lockFile) && parse(lockFile).nonce === owner.nonce) fs.unlinkSync(lockFile); };
  let state;
  try { state = fs.existsSync(checkpointFile) ? parse(checkpointFile) : { schemaVersion: 'autonomous-supervisor-state/v1', campaignDigest, bindings: [], deliveries: {} }; }
  catch (error) { releaseLock(); throw error; }
  if (state.campaignDigest !== campaignDigest) { releaseLock(); throw new Error('CAMPAIGN_CHANGED_REASSESSMENT_REQUIRED'); }
  state.preparedResumeBlocked ??= {};
  state.preparedResumeReassessments ??= {};
  state.preparedResumeExpectedDigests ??= {};
  state.preparedResumeReceiptFiles ??= {};
  state.baseAdvancedResumeBlocked ??= {};
  state.baseAdvancedResumeReassessments ??= {};
  state.cycleAdmissionCheckpoints ??= {};
  state.cycleAdmissionBlocked ??= {};
  state.deliveryHistory ??= {};
  let controller;
  try { controller = providedController ?? await openDeliveryController({ repoRoot: root }); }
  catch (error) { releaseLock(); throw error; }
  const config = { tasks: [], maxConcurrent: campaign.maxConcurrent ?? 2, codexExecutable: campaign.codexExecutable,
    windowsSandbox: campaign.windowsSandbox, roleTimeoutMs: campaign.roleTimeoutMs };
  for (const admission of cycleAdmissions) {
    if (state.bindings.some((item) => item.taskId === admission.taskId)) continue;
    const run = controller.getRun(admission.taskId);
    if (!run || !run.worktreeRoot || run.taskId !== admission.taskId) continue;
    state.bindings.push({ taskId: admission.taskId, worktree: run.worktreeRoot,
      taskFile: admission.taskFile, trustedMandateBinding: run.trustedMandateBinding });
  }
  let runner;
  try { runner = runnerFactory({ controller, repoRoot: root, stateRoot: controllerStateRoot, config,
    campaignDeadlineGuard: () => !deadlineExpired() }); }
  catch (error) { if (!providedController) controller.close(); releaseLock(); throw error; }
  try {
    for (const binding of state.bindings) {
      runner.addBinding(binding);
      if (cycleAdmissions.some((item) => item.taskId === binding.taskId)) runner.hold?.(binding.taskId);
    }
  }
  catch (error) { await runner.stop(); if (!providedController) controller.close(); releaseLock(); throw error; }
  const adapters = new Map();
  const intakeCache = new Map();
  const lastSignals = new Map();
  const cycleAdmissionWakes = new Set();
  let ticking = false;
  let stopped = false;
  const persist = () => {
    const temporary = checkpointFile + '.' + owner.nonce + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
    fs.renameSync(temporary, checkpointFile);
  };
  const signal = (value, observations) => {
    const key = value.taskId ?? 'campaign';
    const fingerprint = digest(value);
    if (lastSignals.get(key) === fingerprint) return;
    lastSignals.set(key, fingerprint); observations.push(value);
    try {
      const eventFile = path.join(stateRoot, 'events.jsonl');
      let previousDigest = 'LEGACY';
      if (fs.existsSync(eventFile)) {
        const existing = fs.readFileSync(eventFile, 'utf8');
        if (!existing.endsWith('\n')) throw new Error('SUPERVISOR_EVENT_TAIL_INCOMPLETE');
        for (const line of existing.split(/\r?\n/).filter(Boolean)) {
          const record = JSON.parse(line);
          if (record?.schemaVersion !== 'supervisor-observation/v1') continue;
          const { receiptDigest, ...payload } = record;
          const expected = createHash('sha256').update(JSON.stringify(payload)).digest('hex').toUpperCase();
          if (record.previousDigest !== previousDigest || receiptDigest !== expected) throw new Error('SUPERVISOR_EVENT_CHAIN_INVALID');
          previousDigest = receiptDigest;
        }
      }
      const taskId = typeof value.taskId === 'string' && /^[A-Z][A-Z0-9_-]{0,95}$/.test(value.taskId) ? value.taskId : null;
      const run = taskId ? controller.getRun(taskId) : null;
      const status = SUPERVISOR_OBSERVATION_STATUSES.has(value.status) ? value.status : 'UNKNOWN';
      const payload = {
        schemaVersion: 'supervisor-observation/v1',
        taskId,
        cycleNo: Number.isSafeInteger(run?.currentCycle) && run.currentCycle > 0 ? run.currentCycle : null,
        kind: 'SUPERVISOR_STATUS',
        status,
        baseCommit: typeof run?.baseCommit === 'string' ? run.baseCommit : null,
        candidateHeadCommit: typeof run?.candidateHeadCommit === 'string' ? run.candidateHeadCommit : null,
        observedAt: new Date(now()).toISOString(),
        previousDigest,
      };
      const receiptDigest = createHash('sha256').update(JSON.stringify(payload)).digest('hex').toUpperCase();
      fs.appendFileSync(eventFile, JSON.stringify({ ...payload, receiptDigest }) + '\n', { flag: 'a' });
    } catch { /* Telemetry is best-effort; an invalid prior receipt remains quarantined. */ }
  };
  const campaignTaskIds = () => [...new Set([
    ...state.bindings.map((binding) => binding.taskId),
    ...cycleAdmissions.map((admission) => admission.taskId),
  ])].sort();
  let verifiedCampaignDeadlineAt = null;
  let reconciledCampaignTaskIds = [];
  const deadlineExpired = () => {
    verifiedCampaignDeadlineAt = null;
    reconciledCampaignTaskIds = [];
    const exactTimestamp = (value) => {
      if (typeof value !== 'string') return null;
      const milliseconds = Date.parse(value);
      return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : null;
    };
    const taskIds = campaignTaskIds();
    let deadlinePin;
    try {
      if (typeof controller.reconcileCampaignDeadline !== 'function') return true;
      deadlinePin = controller.reconcileCampaignDeadline({ campaignId: campaign.campaignId, taskIds,
        campaignDurationMinutes: campaign.maxCampaignMinutes ?? 120,
        checkpointDeadlineAt: state.deadlineAt ?? null });
    } catch { return true; }
    if (deadlinePin?.schemaVersion !== 'campaign-deadline-reconciliation/v1'
        || deadlinePin.campaignId !== campaign.campaignId
        || deadlinePin.campaignDurationMinutes !== (campaign.maxCampaignMinutes ?? 120)
        || !Array.isArray(deadlinePin.taskIds) || new Set(deadlinePin.taskIds).size !== deadlinePin.taskIds.length
        || !isDeepStrictEqual(deadlinePin.taskIds, [...deadlinePin.taskIds].sort())
        || taskIds.some((taskId) => !deadlinePin.taskIds.includes(taskId))) return true;
    const sourceDeadline = deadlinePin.sourceDeadlineAt === null ? null : exactTimestamp(deadlinePin.sourceDeadlineAt);
    const effectiveDeadline = deadlinePin.effectiveDeadlineAt === null ? null : exactTimestamp(deadlinePin.effectiveDeadlineAt);
    if ((deadlinePin.sourceDeadlineAt !== null && sourceDeadline === null)
        || (deadlinePin.effectiveDeadlineAt !== null && effectiveDeadline === null)
        || (sourceDeadline === null ? effectiveDeadline !== null
          : effectiveDeadline === null || effectiveDeadline > sourceDeadline)) return true;
    verifiedCampaignDeadlineAt = deadlinePin.sourceDeadlineAt;
    reconciledCampaignTaskIds = deadlinePin.taskIds;
    const effectiveValue = effectiveDeadline === null ? null : new Date(effectiveDeadline).toISOString();
    if (state.deadlineAt !== effectiveValue) {
      state.deadlineAt = effectiveValue;
      persist();
    }
    return effectiveDeadline !== null && now() >= effectiveDeadline;
  };
  const wakeAdmittedCycleOnce = (taskId, admission, cycleNo) => {
    const key = JSON.stringify([taskId, admission.record.admissionId, cycleNo]);
    if (cycleAdmissionWakes.has(key)) return false;
    cycleAdmissionWakes.add(key);
    runner.wake?.(taskId);
    return true;
  };
  persist();
  return {
    controller, stateRoot, controllerStateRoot,
    async tick() {
      if (stopped || ticking) return { status: stopped ? 'STOPPED' : 'TICK_ALREADY_RUNNING', observations: [] };
      ticking = true;
      const observations = [];
      try {
        const currentCampaign = loadSupervisorCampaign(root, loaded.file);
        if (currentCampaign.campaignDigest !== campaignDigest) throw new Error('CAMPAIGN_CHANGED_REASSESSMENT_REQUIRED');
        const currentCycleAdmissions = currentCampaign.cycleAdmissions;
        controller.verifyEventChain();
        for (const admission of currentCycleAdmissions) {
          const { taskId } = admission;
          let run;
          let code = 'CYCLE_ADMISSION_CONTROLLER_RUN_REQUIRED';
          try {
            run = controller.getRun(taskId);
          } catch {
            code = 'CYCLE_ADMISSION_CONTROLLER_RUN_UNAVAILABLE';
          }
          if (run?.taskId === taskId && typeof run.worktreeRoot === 'string' && run.worktreeRoot) {
            if (!state.bindings.some((binding) => binding.taskId === taskId)) {
              const binding = { taskId, worktree: run.worktreeRoot, taskFile: admission.taskFile,
                trustedMandateBinding: run.trustedMandateBinding };
              state.bindings.push(binding);
              persist();
              runner.addBinding(binding);
              runner.hold?.(taskId);
            }
            continue;
          }
          runner.hold?.(taskId);
          const signature = digest({ taskId, admissionRecordDigest: admission.admissionRecordDigest, code });
          if (state.cycleAdmissionBlocked[taskId]?.signature !== signature) {
            state.cycleAdmissionBlocked[taskId] = { signature, code };
            persist();
          }
          signal({ taskId, status: 'HOLD_CYCLE_ADMISSION', code }, observations);
          return { status: 'HOLD_CYCLE_ADMISSION', observations };
        }
        if (deadlineExpired()) { await runner.stop(); signal({ status: 'PAUSED_DEADLINE' }, observations); return { status: 'PAUSED_DEADLINE', observations }; }
        let intakeResult;
        const intakeSignature = digest([campaignDigest, git(root, ['rev-parse', '--verify', intakeCampaign.baseRef ?? 'origin/main']), controller.listRuns?.().map((run) => [run.taskId, run.state]) ?? []]);
        if (state.intakeBlocked?.signature === intakeSignature) intakeResult = { status: 'INTAKE_REASSESSMENT_REQUIRED' };
        else try { intakeResult = await intake({ repoRoot: root, campaignFile: intakeFile,
          excludeTaskIds: [...new Set([...state.bindings.map((item) => item.taskId), ...currentCycleAdmissions.map((item) => item.taskId)])] }); delete state.intakeBlocked; }
        catch (error) {
          state.intakeBlocked = { signature: intakeSignature, code: String(error.code ?? error.message) }; persist();
          intakeResult = { status: 'INTAKE_REASSESSMENT_REQUIRED', code: state.intakeBlocked.code };
        }
        state.intake = { status: intakeResult.status ?? 'INTAKE_WAITING', code: intakeResult.code ?? null,
          candidates: (intakeResult.candidates ?? []).map((item) => ({ taskId: item.taskId, status: item.status, code: item.code ?? null })) };
        persist();
        const binding = intakeResult.controllerBinding;
        if (binding && !currentCycleAdmissions.some((item) => item.taskId === binding.taskId)) {
          if (!intakeCampaign.allowedTaskIds.includes(binding.taskId)) throw new Error('INTAKE_TASK_NOT_AUTHORIZED');
          const old = state.bindings.find((item) => item.taskId === binding.taskId);
          if (old && !isDeepStrictEqual(old, binding)) throw new Error('TASK_BINDING_CHANGED');
          if (!old) {
            state.bindings.push(binding); persist();
            runner.addBinding(binding);
            signal({ taskId: binding.taskId, status: 'INTAKE_BOUND' }, observations);
          }
        } else signal({ status: intakeResult.status ?? 'INTAKE_WAITING', code: intakeResult.code ?? null }, observations);
        for (const item of await admit({ controller, repoRoot: root, config, cache: intakeCache })) {
          signal({ taskId: item.taskId, status: item.state ?? item.status, code: item.code ?? null }, observations);
        }
        for (const admission of currentCycleAdmissions) {
          const { record, taskId } = admission;
          const binding = state.bindings.find((item) => item.taskId === taskId);
          const run = controller.getRun(taskId);
          const currentCycle = run?.cycles?.find((item) => item.cycleNo === run.currentCycle);
          const checkpoint = state.cycleAdmissionCheckpoints[taskId];
          const checkpointMatches = Boolean(checkpoint
            && checkpoint.admissionId === record.admissionId
            && checkpoint.admissionRecordDigest === admission.admissionRecordDigest
            && checkpoint.cycleNo === record.priorCycleNo + 1
            && cycleAdmissionMatches(run, admission));
          if (!checkpointMatches) runner.hold?.(taskId);
          let worktreeEvidence = null;
          try {
            if (binding?.worktree) worktreeEvidence = {
              root: fs.realpathSync(binding.worktree),
              head: git(binding.worktree, ['rev-parse', '--verify', 'HEAD^{commit}']),
              branch: git(binding.worktree, ['branch', '--show-current']),
              status: git(binding.worktree, ['status', '--porcelain', '--untracked-files=all']),
              base: git(binding.worktree, ['rev-parse', '--verify', `${intakeCampaign.baseRef ?? 'origin/main'}^{commit}`]),
            };
          } catch (error) { worktreeEvidence = { error: error.code ?? error.message }; }
          let controllerWorktreeEvidence;
          try { controllerWorktreeEvidence = cycleAdmissionWorktreeIdentity(run?.worktreeRoot, common); }
          catch (error) { controllerWorktreeEvidence = { error: error.code ?? error.message }; }
          const taskEnvironmentEvidence = cycleAdmissionTaskEnvironmentEvidence(privateRoot, binding, admission);
          let lockConflictEvidence;
          try {
            lockConflictEvidence = controller.inspectCycleAdmissionConflicts({ taskId,
              writeScope: admission.taskRecord.writeScope });
          } catch (error) { lockConflictEvidence = { error: error.code ?? error.message }; }
          const signature = digest({ taskId, admissionRecordDigest: admission.admissionRecordDigest,
            admissionId: record.admissionId, runState: run?.state ?? null, currentCycle: run?.currentCycle ?? null,
            cycleState: currentCycle?.state ?? null, worktreeEvidence, controllerWorktreeEvidence,
            taskEnvironmentEvidence, lockConflictEvidence });
          if (state.cycleAdmissionBlocked[taskId]?.signature === signature) continue;
          if (checkpoint) {
            if (checkpoint.admissionId !== record.admissionId
                || checkpoint.admissionRecordDigest !== admission.admissionRecordDigest
                || checkpoint.cycleNo !== record.priorCycleNo + 1
                || !cycleAdmissionMatches(run, admission)) {
              state.cycleAdmissionBlocked[taskId] = { signature, code: 'CYCLE_ADMISSION_CHECKPOINT_MISMATCH' };
              persist();
              signal({ taskId, status: 'HOLD_CYCLE_ADMISSION', code: 'CYCLE_ADMISSION_CHECKPOINT_MISMATCH' }, observations);
              continue;
            }
            delete state.cycleAdmissionBlocked[taskId];
            wakeAdmittedCycleOnce(taskId, admission, checkpoint.cycleNo);
            continue;
          }
          try {
            if (!binding || !run) throw new Error('CYCLE_ADMISSION_CONTROLLER_RUN_REQUIRED');
            if (lockConflictEvidence?.error || lockConflictEvidence?.runFound !== true
                || !/^\d+$/.test(lockConflictEvidence.lockEpoch ?? '')) {
              throw new Error('CYCLE_ADMISSION_LOCK_INSPECTION_UNAVAILABLE');
            }
            if (hasCycleAdmissionLockConflicts(lockConflictEvidence)) {
              throw new Error('CYCLE_ADMISSION_RESOURCE_LOCK_CONFLICT');
            }
            const taskFile = privateFile(privateRoot, binding.taskFile, 'CYCLE_ADMISSION_TASK_FILE_MUST_BE_PRIVATE');
            const worktreeIdentity = cycleAdmissionWorktreeIdentity(run.worktreeRoot, common);
            const worktreeRoot = worktreeIdentity.worktreeRoot;
            const bindingWorktreeRoot = fs.realpathSync(binding.worktree);
            if (pathKey(taskFile.file) !== pathKey(admission.taskFile)
                || pathKey(bindingWorktreeRoot) !== pathKey(worktreeRoot)
                || bytesDigest(taskFile.bytes) !== record.taskRecordDigest) {
              throw new Error('CYCLE_ADMISSION_TASK_OR_WORKTREE_BINDING_MISMATCH');
            }
            let taskRecord;
            try { taskRecord = JSON.parse(taskFile.bytes.toString('utf8').replace(/^\uFEFF/, '')); }
            catch { throw new Error('CYCLE_ADMISSION_TASK_RECORD_INVALID_JSON'); }
            if (taskRecord.taskId !== taskId || taskRecord.schemaVersion !== 'task-readiness/v1') {
              throw new Error('CYCLE_ADMISSION_TASK_RECORD_MISMATCH');
            }
            const replay = cycleAdmissionMatches(run, admission);
            if (!replay && (run.currentCycle !== record.priorCycleNo || currentCycle?.state !== record.priorCycleState
                || !['PAUSED', 'EXHAUSTED'].includes(currentCycle.state))) {
              throw new Error('CYCLE_ADMISSION_PREDECESSOR_MISMATCH');
            }
            const ready = await preflight({ repo: worktreeRoot, taskFile: taskFile.file,
              base: intakeCampaign.baseRef ?? 'origin/main' });
            if (ready?.status !== 'READY' || ready.taskId !== taskId) {
              throw new Error(`CYCLE_ADMISSION_PREFLIGHT_${ready?.status ?? 'INVALID'}`);
            }
            if (deadlineExpired()) throw new Error('CYCLE_ADMISSION_CAMPAIGN_DEADLINE_EXPIRED');
            if (typeof controller.admitCycle !== 'function') throw new Error('CYCLE_ADMISSION_CONTROLLER_API_UNAVAILABLE');
            const currentRun = controller.getRun(taskId);
            const currentWorktreeIdentity = cycleAdmissionWorktreeIdentity(currentRun?.worktreeRoot, common);
            const reboundWorktreeRoot = fs.realpathSync(binding.worktree);
            if (!sameCycleAdmissionWorktreeIdentity(worktreeIdentity, currentWorktreeIdentity)
                || pathKey(reboundWorktreeRoot) !== pathKey(worktreeRoot)
                || pathKey(currentRun.worktreeRoot) !== pathKey(worktreeRoot)) {
              throw new Error('CYCLE_ADMISSION_TASK_OR_WORKTREE_BINDING_MISMATCH');
            }
            const currentTaskFile = privateFile(privateRoot, binding.taskFile, 'CYCLE_ADMISSION_TASK_FILE_MUST_BE_PRIVATE');
            if (pathKey(currentTaskFile.file) !== pathKey(admission.taskFile)
                || bytesDigest(currentTaskFile.bytes) !== record.taskRecordDigest) {
              throw new Error('CYCLE_ADMISSION_TASK_OR_WORKTREE_BINDING_MISMATCH');
            }
            try { taskRecord = JSON.parse(currentTaskFile.bytes.toString('utf8').replace(/^\uFEFF/, '')); }
            catch { throw new Error('CYCLE_ADMISSION_TASK_RECORD_INVALID_JSON'); }
            if (taskRecord.taskId !== taskId || taskRecord.schemaVersion !== 'task-readiness/v1') {
              throw new Error('CYCLE_ADMISSION_TASK_RECORD_MISMATCH');
            }
            const postPreflightLocks = controller.inspectCycleAdmissionConflicts({ taskId,
              writeScope: admission.taskRecord.writeScope });
            if (postPreflightLocks?.runFound !== true || !/^\d+$/.test(postPreflightLocks.lockEpoch ?? '')
                || postPreflightLocks.lockEpoch !== lockConflictEvidence.lockEpoch
                || hasCycleAdmissionLockConflicts(postPreflightLocks)) {
              throw new Error('CYCLE_ADMISSION_RESOURCE_LOCK_EPOCH_CHANGED_DURING_PREFLIGHT');
            }
            const admissionInput = {
              admissionId: record.admissionId,
              admissionRecordDigest: admission.admissionRecordDigest,
              taskRecordDigest: record.taskRecordDigest,
              priorCycleNo: record.priorCycleNo,
              priorCycleState: record.priorCycleState,
              reason: record.reason,
              evidenceRef: record.evidenceRef,
              materialChange: record.materialChange,
              basis: record.basis,
            };
            const admitted = controller.admitCycle({ taskId, taskRecord, preflightResult: ready,
              trustedMandateBinding: binding.trustedMandateBinding ?? run.trustedMandateBinding,
              admission: admissionInput, campaignId: campaign.campaignId,
              campaignDeadlineAt: verifiedCampaignDeadlineAt,
              campaignDeadlineBoundAt: state.deadlineAt ?? null,
              campaignTaskIds: reconciledCampaignTaskIds, campaignDurationMinutes: campaign.maxCampaignMinutes ?? 120,
              expectedResourceLockEpoch: postPreflightLocks.lockEpoch });
            if (!cycleAdmissionMatches(admitted, admission)) throw new Error('CYCLE_ADMISSION_CONTROLLER_RESULT_MISMATCH');
            const oldCheckpoint = state.deliveries[taskId];
            if (oldCheckpoint) {
              const history = state.deliveryHistory[taskId] ?? (state.deliveryHistory[taskId] = []);
              const checkpointKey = digest([taskId, record.priorCycleNo, oldCheckpoint, record.admissionId]);
              if (!history.some((item) => item.checkpointKey === checkpointKey)) history.push({ checkpointKey,
                checkpoint: oldCheckpoint, cycleNo: record.priorCycleNo, admissionId: record.admissionId,
                invalidatedAt: new Date(now()).toISOString(), priorEvidenceInvalidated: true });
            }
            delete state.deliveries[taskId];
            delete state.deliveryRevisions?.[taskId];
            delete state.preparedResumeBlocked[taskId];
            delete state.preparedResumeReassessments[taskId];
            delete state.preparedResumeExpectedDigests[taskId];
            delete state.preparedResumeReceiptFiles[taskId];
            delete state.baseAdvancedResumeBlocked[taskId];
            delete state.baseAdvancedResumeReassessments[taskId];
            adapters.delete(taskId);
            state.cycleAdmissionCheckpoints[taskId] = { admissionId: record.admissionId,
              admissionRecordDigest: admission.admissionRecordDigest, cycleNo: admitted.currentCycle,
              taskRecordDigest: record.taskRecordDigest, reconciledAt: new Date(now()).toISOString() };
            delete state.cycleAdmissionBlocked[taskId];
            persist();
            wakeAdmittedCycleOnce(taskId, admission, admitted.currentCycle);
            signal({ taskId, status: replay ? 'CYCLE_ADMISSION_REPLAYED' : 'CYCLE_ADMISSION_ACCEPTED', cycleNo: admitted.currentCycle,
              admissionId: record.admissionId }, observations);
          } catch (error) {
            const code = String(error.code ?? error.message);
            state.cycleAdmissionBlocked[taskId] = { signature, code };
            persist();
            signal({ taskId, status: 'HOLD_CYCLE_ADMISSION', code }, observations);
            continue;
          }
        }
        for (const binding of state.bindings) {
          let file = state.preparedResumeReceiptFiles[binding.taskId]
            ?? path.join(stateRoot, 'prepared', binding.taskId + '.json');
          const baseRef = `${campaign.delivery.remoteName ?? 'origin'}/${campaign.delivery.base ?? 'main'}`;
          let run = controller.getRun(binding.taskId);
          const checkpoint = state.deliveries[binding.taskId];
          if (checkpoint?.status === 'ROOT_REPLAN_PAUSED' && checkpoint.code === 'BASE_ADVANCED') {
            // Hold before inspection/merge and on every restart. The controller
            // state stays non-worker-ready until the receipt is transactionally resumed.
            runner.hold?.(binding.taskId);
            const signatureInput = { repoRoot: root, privateRoot, stateRoot, campaignId: campaign.campaignId,
              binding, checkpoint, controller, baseRef, readRemoteBase: readBase,
              runnerActive: runner.isActive?.(binding.taskId) ?? false };
            const signature = await advancedSignature(signatureInput);
            const previous = state.baseAdvancedResumeBlocked[binding.taskId];
            const reassessment = state.baseAdvancedResumeReassessments[binding.taskId] ?? null;
            if (previous?.signature === signature && !reassessment) continue;
            if (reassessment) { delete state.baseAdvancedResumeReassessments[binding.taskId]; persist(); }
            try {
              const prepared = await prepareAdvancedResume({ repoRoot: root, privateRoot, stateRoot,
                campaignId: campaign.campaignId, binding, checkpoint, controller, runner, baseRef,
                reassessment, fetchBase, readRemoteBase: readBase, mergeBase });
              const currentRun = controller.getRun(binding.taskId);
              if (prepared?.status !== 'READY_TO_RESUME' || prepared.receipt?.taskId !== binding.taskId
                  || prepared.receipt?.cycleNo !== currentRun?.currentCycle
                  || prepared.receipt?.oldHeadCommit !== run?.candidateHeadCommit
                  || prepared.receipt?.oldBaseCommit !== run?.baseCommit
                  || typeof prepared.receiptFile !== 'string' || !within(privateRoot, path.resolve(prepared.receiptFile))) {
                throw new Error('BASE_ADVANCED_PREPARED_RECEIPT_BINDING_MISMATCH');
              }
              validatePreparedReceiptPath({ privateRoot, stateRoot, receiptFile: prepared.receiptFile,
                taskId: binding.taskId, cycleNo: currentRun.currentCycle });
              const receiptFile = fs.realpathSync(prepared.receiptFile);
              if (!within(privateRoot, receiptFile)) throw new Error('BASE_ADVANCED_PREPARED_RECEIPT_NOT_PRIVATE');
              state.preparedResumeReceiptFiles[binding.taskId] = receiptFile;
              const history = state.deliveryHistory[binding.taskId] ?? (state.deliveryHistory[binding.taskId] = []);
              const checkpointKey = digest([binding.taskId, run.currentCycle, checkpoint.expectedBaseCommit,
                checkpoint.actualBaseCommit, checkpoint.candidateHeadCommit]);
              if (!history.some((entry) => entry.checkpointKey === checkpointKey)) history.push({ checkpointKey,
                checkpoint, invalidatedAt: new Date(now()).toISOString(), cycleNo: run.currentCycle,
                oldHeadCommit: prepared.receipt.oldHeadCommit, newHeadCommit: prepared.receipt.headCommit,
                oldBaseCommit: prepared.receipt.oldBaseCommit, newBaseCommit: prepared.receipt.newBaseCommit,
                preparedReceiptFile: receiptFile, priorEvidenceInvalidated: true });
              delete state.deliveries[binding.taskId];
              delete state.deliveryRevisions?.[binding.taskId];
              adapters.delete(binding.taskId);
              delete state.baseAdvancedResumeBlocked[binding.taskId];
              delete state.baseAdvancedResumeReassessments[binding.taskId];
              persist();
              file = receiptFile;
              run = currentRun;
              signal({ taskId: binding.taskId, status: 'BASE_ADVANCED_RESUME_PREPARED', cycleNo: run.currentCycle,
                oldHeadCommit: prepared.receipt.oldHeadCommit, newHeadCommit: prepared.receipt.headCommit,
                oldBaseCommit: prepared.receipt.oldBaseCommit, newBaseCommit: prepared.receipt.newBaseCommit }, observations);
            } catch (error) {
              runner.hold?.(binding.taskId);
              const code = String(error.code ?? error.message);
              const failedSignature = await advancedSignature(signatureInput);
              state.baseAdvancedResumeBlocked[binding.taskId] = { signature: failedSignature, code,
                rootReassessment: reassessment };
              persist();
              signal({ taskId: binding.taskId, status: 'BASE_ADVANCED_RESUME_REASSESSMENT_REQUIRED', code }, observations);
              continue;
            }
          }
          if (staleResumeStates.has(run?.state)) {
            const signature = await preparedEvidenceSignature({ binding, run, receiptFile: file, baseRef, readRemoteBase: readBase, privateRoot, stateRoot });
            const previous = state.preparedResumeBlocked[binding.taskId];
            const reassessment = state.preparedResumeReassessments[binding.taskId] ?? null;
            runner.hold?.(binding.taskId);
            if (previous?.signature === signature && !reassessment) continue;
            if (reassessment) { delete state.preparedResumeReassessments[binding.taskId]; persist(); }
            try {
              const taskBytes = fs.readFileSync(binding.taskFile, 'utf8');
              const taskRecord = JSON.parse(taskBytes.replace(/^\uFEFF/, ''));
              if (taskRecord.taskId !== binding.taskId || !isDeepStrictEqual(taskRecord, run.taskRecord)) {
                throw new Error('PREPARED_BASE_RESUME_TASK_BINDING_MISMATCH');
              }
              const fetchedBaseSha = await fetchBase({ repo: binding.worktree, baseRef });
              if (!/^[a-f0-9]{40}$/.test(fetchedBaseSha)) throw new Error('PREPARED_BASE_FETCH_INVALID');
              const remoteShaAfterFetch = await readBase({ repo: binding.worktree, baseRef });
              if (remoteShaAfterFetch !== fetchedBaseSha) throw preparedBaseError('PREPARED_BASE_REMOTE_ADVANCED');
              const ready = await preflight({ repo: binding.worktree, taskFile: binding.taskFile,
                base: fetchedBaseSha });
              if (ready.status !== 'READY' || ready.taskId !== binding.taskId) {
                throw new Error(`PREPARED_BASE_RESUME_PREFLIGHT_${ready.status ?? 'INVALID'}`);
              }
              const remoteShaBeforeResume = await readBase({ repo: binding.worktree, baseRef });
              if (remoteShaBeforeResume !== fetchedBaseSha) throw preparedBaseError('PREPARED_BASE_REMOTE_ADVANCED');
              if (typeof controller.resumeTask !== 'function') throw new Error('PREPARED_BASE_RESUME_ADAPTER_UNAVAILABLE');
              const resumed = controller.resumeTask({ taskRecord, preflightResult: ready,
                trustedMandateBinding: binding.trustedMandateBinding ?? run.trustedMandateBinding,
                resumeEvidence: { reference: `prepared-base:${path.relative(privateRoot, file).split(path.sep).join('/')}`,
                  reason: 'Root prepared candidate receipt was validated against the retained paused run.' },
                preparedBaseReceiptFile: file });
              const proof = resumed?.preparedBaseResume;
              if (!proof || proof.taskId !== binding.taskId || !/^[a-f0-9]{64}$/.test(proof.receiptDigest ?? '')) {
                throw new Error('PREPARED_BASE_RESUME_PROOF_UNAVAILABLE');
              }
              state.preparedResumeExpectedDigests[binding.taskId] = { cycleNo: resumed.currentCycle, receiptDigest: proof.receiptDigest };
              delete state.preparedResumeBlocked[binding.taskId];
              persist();
              signal({ taskId: binding.taskId, status: 'PREPARED_BASE_RESUME_ACCEPTED' }, observations);
              run = controller.getRun(binding.taskId);
            } catch (error) {
              runner.hold?.(binding.taskId);
              const code = String(error.code ?? error.message);
              const failedSignature = await preparedEvidenceSignature({ binding, run, receiptFile: file, baseRef, readRemoteBase: readBase, privateRoot, stateRoot });
              state.preparedResumeBlocked[binding.taskId] = {
                signature: failedSignature,
                code,
                rootReassessment: reassessment,
              };
              persist();
              signal({ taskId: binding.taskId, status: 'PREPARED_BASE_RESUME_REASSESSMENT_REQUIRED', code }, observations);
              continue;
            }
          }
          if (run?.state === 'WORKER_READY'
              && (run.preparedBaseResume?.receiptDigest || fs.existsSync(file) || state.preparedResumeBlocked[binding.taskId])) {
            runner.hold?.(binding.taskId);
            const signature = await preparedEvidenceSignature({ binding, run, receiptFile: file, baseRef, readRemoteBase: readBase, privateRoot, stateRoot });
            const previous = state.preparedResumeBlocked[binding.taskId];
            const reassessment = state.preparedResumeReassessments[binding.taskId] ?? null;
            if (previous?.signature === signature && !reassessment) continue;
            if (reassessment) { delete state.preparedResumeReassessments[binding.taskId]; persist(); }
            try {
              const proof = run.preparedBaseResume;
              const expected = state.preparedResumeExpectedDigests[binding.taskId];
              if (!proof?.receiptDigest || (expected && (expected.cycleNo !== run.currentCycle
                  || expected.receiptDigest !== proof.receiptDigest))) throw new Error('PREPARED_BASE_RESUME_PROOF_MISMATCH');
              state.preparedResumeExpectedDigests[binding.taskId] = { cycleNo: run.currentCycle, receiptDigest: proof.receiptDigest };
              persist();
              runner.authorizePreparedCandidate(binding.taskId, file, proof.receiptDigest);
              delete state.preparedResumeBlocked[binding.taskId];
              delete state.preparedResumeReassessments[binding.taskId];
              persist();
            } catch (error) {
              const code = String(error.code ?? error.message);
              const failedSignature = await preparedEvidenceSignature({ binding, run, receiptFile: file, baseRef, readRemoteBase: readBase, privateRoot, stateRoot });
              state.preparedResumeBlocked[binding.taskId] = {
                signature: failedSignature,
                code,
                rootReassessment: reassessment,
              };
              persist();
              signal({ taskId: binding.taskId, status: 'ROOT_PREPARATION_REASSESSMENT_REQUIRED', code }, observations);
            }
          }
        }
        if (deadlineExpired()) {
          await runner.stop(); signal({ status: 'PAUSED_DEADLINE' }, observations);
          return { status: 'PAUSED_DEADLINE', observations };
        }
        const dispatched = await runner.tick();
        for (const error of dispatched.errors) signal({ ...error, status: 'DISPATCH_BLOCKED' }, observations);
        if (deadlineExpired()) { await runner.stop(); signal({ status: 'PAUSED_DEADLINE' }, observations); return { status: 'PAUSED_DEADLINE', observations }; }
        // Serialize delivery within this supervisor; each adapter also owns its
        // durable operation lock across independent root processes.
        for (const binding of state.bindings) {
          try {
          let run = controller.getRun(binding.taskId);
          if (run?.state === 'ROOT_DELIVERY_READY') {
            controller.recordRootIntegration({ taskId: run.taskId, headCommit: run.candidateHeadCommit,
              evidenceRef: `root-campaign:${campaign.campaignId}:${campaignDigest}` });
            run = controller.getRun(binding.taskId);
          }
          if (run?.state !== 'ROOT_INTEGRATED_PENDING_CI') continue;
          const revision = digest([run.currentCycle, run.baseCommit, run.candidateHeadCommit]);
          state.deliveryRevisions ??= {};
          if (state.deliveryRevisions[binding.taskId] !== revision) {
            adapters.delete(binding.taskId); delete state.deliveries[binding.taskId];
            state.deliveryRevisions[binding.taskId] = revision; persist();
          }
          if (['ROOT_REPLAN_PAUSED', 'MERGED'].includes(state.deliveries[binding.taskId]?.status)) continue;
          if (!adapters.has(binding.taskId)) adapters.set(binding.taskId, deliveryFactory({ repoRoot: root, worktreeRoot: binding.worktree, controller,
            campaign: { schemaVersion: 'github-delivery-campaign/v1', taskId: run.taskId,
              repository: { remoteName: campaign.delivery.remoteName ?? 'origin', expectedOwnerRepo: campaign.delivery.expectedOwnerRepo },
              branch: { head: run.branch, base: campaign.delivery.base ?? 'main', expectedBaseCommit: run.baseCommit },
              pullRequest: { title: `[${run.taskId}] ${run.objective}`.slice(0, 240),
                body: `Automated delivery under trusted root campaign ${campaign.campaignId}.\n\nTask: ${run.taskId}\n\nExact candidate: ${run.candidateHeadCommit}\n\nWorker, independent Verify and Review passed at this candidate. Applicable hosted CI remains a separate merge gate.` },
              mergeMethod: 'squash',
              requiredChecks: campaign.delivery.requiredChecks, notApplicableChecks: campaign.delivery.notApplicableChecks ?? [],
              authorizedEffects: ['push', 'pullRequest', 'merge'], mandate: { resolvedBy: 'root', sourceRef: campaign.sourceRef,
                repositoryRoot: root, taskId: run.taskId, expectedRepository: campaign.delivery.expectedOwnerRepo,
                headBranch: run.branch, baseBranch: campaign.delivery.base ?? 'main', expectedBaseCommit: run.baseCommit,
                authorizedEffects: ['push', 'pullRequest', 'merge'] } },
            ghExecutable: campaign.ghExecutable ?? 'gh' }));
          const delivery = await adapters.get(binding.taskId).tick(binding.taskId);
          if (delivery.status === 'REPLAN_REQUIRED') delivery.status = 'ROOT_REPLAN_PAUSED';
          state.deliveries[binding.taskId] = delivery; persist();
          signal({ taskId: binding.taskId, status: delivery.status, code: delivery.code ?? null, pullRequest: delivery.number ?? delivery.pullRequest ?? null }, observations);
          } catch (error) {
            const delivery = { status: 'DELIVERY_REASSESSMENT_REQUIRED', code: String(error.code ?? error.message) };
            state.deliveries[binding.taskId] = delivery; persist();
            signal({ taskId: binding.taskId, ...delivery }, observations);
          }
        }
        return { status: 'RUNNING', active: dispatched.active, observations };
      } finally { ticking = false; }
    },
    status() { return { campaignId: campaign.campaignId, campaignDigest, allowedTaskIds: intakeCampaign.allowedTaskIds,
      bindings: state.bindings.map((item) => item.taskId), deliveries: state.deliveries, intake: state.intake,
      preparedResumeBlocked: state.preparedResumeBlocked, baseAdvancedResumeBlocked: state.baseAdvancedResumeBlocked }; },
    reassessPreparedResume({ taskId, evidenceRef, reason } = {}) {
      if (stopped || ticking) throw new Error('SUPERVISOR_NOT_AVAILABLE_FOR_REASSESSMENT');
      if (!state.bindings.some((item) => item.taskId === taskId) || typeof evidenceRef !== 'string' || !evidenceRef.trim()
          || typeof reason !== 'string' || !reason.trim()) throw new TypeError('Root reassessment requires a bound task, evidence reference, and reason.');
      delete state.preparedResumeBlocked[taskId];
      state.preparedResumeReassessments[taskId] = { evidenceRef, reason, requestedAt: new Date(now()).toISOString() };
      persist();
      runner.wake?.(taskId);
      return { taskId, status: 'PREPARED_RESUME_REASSESSMENT_QUEUED' };
    },
    reassessBaseAdvancedResume({ taskId, evidenceRef, reason } = {}) {
      if (stopped || ticking) throw new Error('SUPERVISOR_NOT_AVAILABLE_FOR_REASSESSMENT');
      if (!state.bindings.some((item) => item.taskId === taskId)
          || state.deliveries[taskId]?.status !== 'ROOT_REPLAN_PAUSED'
          || state.deliveries[taskId]?.code !== 'BASE_ADVANCED'
          || typeof evidenceRef !== 'string' || !evidenceRef.trim()
          || typeof reason !== 'string' || !reason.trim()) {
        throw new TypeError('Base advanced reassessment requires the bound paused task, evidence reference, and reason.');
      }
      state.baseAdvancedResumeReassessments[taskId] = { evidenceRef, reason, requestedAt: new Date(now()).toISOString() };
      persist();
      runner.hold?.(taskId);
      return { taskId, status: 'BASE_ADVANCED_RESUME_REASSESSMENT_QUEUED' };
    },
    async stop() {
      stopped = true;
      await runner.stop(); persist();
      if (!providedController) controller.close();
      releaseLock();
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const [command, campaignFile] = argv;
  if (!['run', 'serve'].includes(command) || !campaignFile || argv.length !== 2) throw new Error('Usage: autonomous-supervisor.mjs run|serve <private-campaign.json>');
  const campaign = parse(campaignFile);
  const supervisor = await createAutonomousSupervisor({ repoRoot: campaign.repositoryRoot, campaignFile });
  let stopping = false;
  let dashboard;
  let liveness;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'serve') {
      dashboard = await startControllerDashboard({ port: campaign.dashboardPort ?? 4190,
        readEvents: createControllerEventReader(campaign.repositoryRoot),
        readRuns: async () => {
          const runs = supervisor.controller.listRuns().map((run) => ({ ...run, status: run.state, nodes: run.stages }));
          for (const item of supervisor.status().intake?.candidates ?? []) {
            if (!runs.some((run) => run.taskId === item.taskId)) runs.push({ taskId: item.taskId, status: item.status, stages: [], blockers: [{ code: item.code }] });
          }
          return runs;
        } });
      liveness = startControllerLivenessHeartbeat({ stateRoot: supervisor.controllerStateRoot });
    }
    do {
      const result = await supervisor.tick();
      for (const observation of result.observations) process.stdout.write(JSON.stringify(observation) + '\n');
      if (result.status === 'PAUSED_DEADLINE') break;
      const status = supervisor.status();
      if (command === 'run' && status.bindings.length === status.allowedTaskIds.length
        && status.bindings.every((taskId) => status.deliveries[taskId]?.status === 'MERGED')) break;
      if (command === 'run' && shouldYieldFiniteRun(status, result)) {
        process.stdout.write(JSON.stringify({ status: 'YIELD_REASSESS', intake: status.intake, deliveries: status.deliveries }) + '\n'); break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(5000, campaign.pollIntervalMs ?? 30_000)));
    } while (!stopping);
  } finally {
    liveness?.stop();
    await supervisor.stop();
    if (dashboard) await new Promise((resolve) => dashboard.close(resolve));
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { process.stderr.write(`SUPERVISOR_STOPPED: ${error.message}\n`); process.exitCode = 1; });

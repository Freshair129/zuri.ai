import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { openDeliveryController } from './controller.mjs';
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
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
const parse = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const staleResumeStates = new Set(['BLOCKED_STALE_CANDIDATE', 'BLOCKED_STALE_BASELINE']);
const SUPERVISOR_OBSERVATION_STATUSES = new Set(['INTAKE_BOUND', 'INTAKE_WAITING', 'INTAKE_REASSESSMENT_REQUIRED',
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
  return { root, common, privateRoot, file, campaign, intakeFile, intakeCampaign,
    campaignDigest: digest({ campaign, intakeCampaign }) };
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
  const { root, common, privateRoot, campaign, intakeFile, intakeCampaign, campaignDigest } = loaded;
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
  state.deliveryHistory ??= {};
  let controller;
  try { controller = providedController ?? await openDeliveryController({ repoRoot: root }); }
  catch (error) { releaseLock(); throw error; }
  const config = { tasks: [], maxConcurrent: campaign.maxConcurrent ?? 2, codexExecutable: campaign.codexExecutable,
    windowsSandbox: campaign.windowsSandbox, roleTimeoutMs: campaign.roleTimeoutMs };
  let runner;
  try { runner = runnerFactory({ controller, repoRoot: root, stateRoot: controllerStateRoot, config }); }
  catch (error) { if (!providedController) controller.close(); releaseLock(); throw error; }
  try { for (const binding of state.bindings) runner.addBinding(binding); }
  catch (error) { await runner.stop(); if (!providedController) controller.close(); releaseLock(); throw error; }
  const adapters = new Map();
  const intakeCache = new Map();
  const lastSignals = new Map();
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
  const deadlineExpired = () => {
    if (!state.deadlineAt) {
      const anchors = state.bindings.flatMap((binding) => controller.getRun(binding.taskId)?.cycles ?? [])
        .map((cycle) => Date.parse(cycle.startedAt)).filter(Number.isFinite);
      if (anchors.length) { state.deadlineAt = new Date(Math.min(...anchors) + (campaign.maxCampaignMinutes ?? 120) * 60_000).toISOString(); persist(); }
    }
    return state.deadlineAt && now() >= Date.parse(state.deadlineAt);
  };
  persist();
  return {
    controller, stateRoot, controllerStateRoot,
    async tick() {
      if (stopped || ticking) return { status: stopped ? 'STOPPED' : 'TICK_ALREADY_RUNNING', observations: [] };
      ticking = true;
      const observations = [];
      try {
        if (loadSupervisorCampaign(root, loaded.file).campaignDigest !== campaignDigest) throw new Error('CAMPAIGN_CHANGED_REASSESSMENT_REQUIRED');
        controller.verifyEventChain();
        if (deadlineExpired()) { await runner.stop(); signal({ status: 'PAUSED_DEADLINE' }, observations); return { status: 'PAUSED_DEADLINE', observations }; }
        let intakeResult;
        const intakeSignature = digest([campaignDigest, git(root, ['rev-parse', '--verify', intakeCampaign.baseRef ?? 'origin/main']), controller.listRuns?.().map((run) => [run.taskId, run.state]) ?? []]);
        if (state.intakeBlocked?.signature === intakeSignature) intakeResult = { status: 'INTAKE_REASSESSMENT_REQUIRED' };
        else try { intakeResult = await intake({ repoRoot: root, campaignFile: intakeFile,
          excludeTaskIds: state.bindings.map((item) => item.taskId) }); delete state.intakeBlocked; }
        catch (error) {
          state.intakeBlocked = { signature: intakeSignature, code: String(error.code ?? error.message) }; persist();
          intakeResult = { status: 'INTAKE_REASSESSMENT_REQUIRED', code: state.intakeBlocked.code };
        }
        state.intake = { status: intakeResult.status ?? 'INTAKE_WAITING', code: intakeResult.code ?? null,
          candidates: (intakeResult.candidates ?? []).map((item) => ({ taskId: item.taskId, status: item.status, code: item.code ?? null })) };
        persist();
        const binding = intakeResult.controllerBinding;
        if (binding) {
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

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const git = (cwd, argv) => execFileSync('git', argv, {
  cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000,
  maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isCommit = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const safeTaskId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

function baseRefParts(baseRef, repo) {
  if (typeof baseRef !== 'string') throw new Error('BASE_ADVANCED_REF_INVALID');
  const separator = baseRef.indexOf('/');
  const remote = baseRef.slice(0, separator);
  const branch = baseRef.slice(separator + 1);
  if (separator < 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote) || !branch
      || branch.startsWith('-') || branch.includes('..') || branch.endsWith('/') || branch.includes('//')) {
    throw new Error('BASE_ADVANCED_REF_INVALID');
  }
  const trackingRef = `refs/remotes/${remote}/${branch}`;
  git(repo, ['check-ref-format', trackingRef]);
  git(repo, ['check-ref-format', `refs/heads/${branch}`]);
  return { remote, branch, trackingRef };
}

export function fetchConfiguredBase({ repo, baseRef }) {
  const { remote, branch, trackingRef } = baseRefParts(baseRef, repo);
  git(repo, ['fetch', '--no-tags', remote, `refs/heads/${branch}:${trackingRef}`]);
  const sha = git(repo, ['rev-parse', '--verify', `${trackingRef}^{commit}`]);
  if (!isCommit(sha)) throw new Error('BASE_ADVANCED_FETCH_INVALID');
  return sha;
}

export function readConfiguredRemoteBase({ repo, baseRef }) {
  const { remote, branch } = baseRefParts(baseRef, repo);
  const output = git(repo, ['ls-remote', '--exit-code', '--heads', remote, `refs/heads/${branch}`]);
  const matches = output.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
    .filter(([sha, ref]) => isCommit(sha) && ref === `refs/heads/${branch}`);
  if (matches.length !== 1) throw new Error('BASE_ADVANCED_REMOTE_UNAVAILABLE');
  return matches[0][0];
}

function maybeGit(cwd, argv) {
  try { return git(cwd, argv); }
  catch (error) { if (error.status !== 0) return null; throw error; }
}

function trackingSha(repo, baseRef) {
  const { trackingRef } = baseRefParts(baseRef, repo);
  const sha = maybeGit(repo, ['rev-parse', '--verify', `${trackingRef}^{commit}`]);
  return isCommit(sha) ? sha : null;
}

function worktreeObservation(worktree) {
  const head = maybeGit(worktree, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const branch = maybeGit(worktree, ['branch', '--show-current']);
  const status = maybeGit(worktree, ['status', '--porcelain', '--untracked-files=all']);
  const unmerged = maybeGit(worktree, ['ls-files', '-u', '-z']);
  const mergeHead = maybeGit(worktree, ['rev-parse', '--verify', 'MERGE_HEAD^{commit}']);
  return { head, branch, status, unmerged, mergeHead };
}

function readTask(binding, run, privateRoot) {
  let file;
  try { file = fs.realpathSync(binding.taskFile); } catch { throw new Error('BASE_ADVANCED_TASK_FILE_UNAVAILABLE'); }
  if (!within(privateRoot, file)) throw new Error('BASE_ADVANCED_TASK_FILE_NOT_PRIVATE');
  let bytes;
  let task;
  try {
    bytes = fs.readFileSync(file);
    task = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch { throw new Error('BASE_ADVANCED_TASK_FILE_INVALID'); }
  if (task.taskId !== binding.taskId || !isDeepStrictEqual(task, run.taskRecord)) {
    throw new Error('BASE_ADVANCED_TASK_BINDING_MISMATCH');
  }
  return { task, file, taskDigest: createHash('sha256').update(bytes).digest('hex') };
}

function safePrivateRoots({ repoRoot, privateRoot, stateRoot, campaignId }) {
  const root = fs.realpathSync(repoRoot);
  const common = fs.realpathSync(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const expectedPrivate = path.join(common, 'zuri-delivery-control');
  fs.mkdirSync(expectedPrivate, { recursive: true });
  const actualPrivate = fs.realpathSync(expectedPrivate);
  if (privateRoot && fs.realpathSync(privateRoot) !== actualPrivate) throw new Error('BASE_ADVANCED_PRIVATE_ROOT_MISMATCH');
  if (!safeTaskId(campaignId)) throw new Error('BASE_ADVANCED_CAMPAIGN_ID_INVALID');
  const campaignStateRoot = path.join(actualPrivate, 'supervisors', campaignId);
  fs.mkdirSync(campaignStateRoot, { recursive: true });
  const actualStateRoot = fs.realpathSync(campaignStateRoot);
  if (!within(actualPrivate, actualStateRoot) || (stateRoot && fs.realpathSync(stateRoot) !== actualStateRoot)) {
    throw new Error('BASE_ADVANCED_STATE_ROOT_MISMATCH');
  }
  return { root, common, privateRoot: actualPrivate, stateRoot: actualStateRoot };
}

function requireCheckpoint(checkpoint, run, binding) {
  if (!checkpoint || checkpoint.status !== 'ROOT_REPLAN_PAUSED' || checkpoint.code !== 'BASE_ADVANCED'
      || checkpoint.taskId !== binding.taskId || checkpoint.expectedBaseCommit !== run.baseCommit
      || checkpoint.candidateHeadCommit !== run.candidateHeadCommit || !isCommit(checkpoint.actualBaseCommit)) {
    throw new Error('BASE_ADVANCED_CHECKPOINT_BINDING_MISMATCH');
  }
}

function inspectController(controller, taskId) {
  if (typeof controller.inspectBaseAdvancedPause !== 'function') throw new Error('BASE_ADVANCED_CONTROLLER_INSPECTION_UNAVAILABLE');
  const snapshot = controller.inspectBaseAdvancedPause(taskId);
  if (!snapshot?.run) throw new Error('BASE_ADVANCED_CONTROLLER_RUN_MISSING');
  if (snapshot.activeLeases?.length) throw new Error('BASE_ADVANCED_ACTIVE_LEASES_PRESENT');
  if (snapshot.unknownEffects?.length || snapshot.unknownNodes?.length) throw new Error('BASE_ADVANCED_UNKNOWN_EFFECT_PRESENT');
  return snapshot;
}

function assertBaseAdvancedRunBinding({ binding, run, worktree, snapshot, checkpoint }) {
  const integrated = run.state === 'ROOT_INTEGRATED_PENDING_CI' && snapshot.cycle?.state === 'INTEGRATED';
  const disposition = snapshot.baseAdvancedDisposition;
  const paused = run.state === 'BLOCKED_STALE_CANDIDATE' && snapshot.cycle?.state === 'BLOCKED'
    && disposition?.disposition === 'YIELD_REASSESS' && disposition?.basis === 'MATERIAL_NEW_EVIDENCE'
    && disposition?.source === 'BASE_ADVANCED' && disposition?.oldBaseCommit === run.baseCommit
    && disposition?.oldHeadCommit === run.candidateHeadCommit && isDeepStrictEqual(disposition.checkpoint, checkpoint);
  if ((!integrated && !paused) || run.currentCycle !== snapshot.cycle.cycle_no
      || !Number.isSafeInteger(run.currentCycle) || run.currentCycle < 1) {
    throw new Error('BASE_ADVANCED_CONTROLLER_STATE_MISMATCH');
  }
  const worktreeRoot = fs.realpathSync(binding.worktree);
  if (fs.realpathSync(run.worktreeRoot) !== worktreeRoot || fs.realpathSync(git(worktree, ['rev-parse', '--show-toplevel'])) !== worktreeRoot
      || (binding.branch && binding.branch !== run.branch)) throw new Error('BASE_ADVANCED_WORKTREE_BINDING_MISMATCH');
  const observed = worktreeObservation(worktree);
  if (observed.branch !== run.branch) throw new Error('BASE_ADVANCED_WORKTREE_BINDING_MISMATCH');
  const roleEvidence = run.stages ?? [];
  if (roleEvidence.length !== 3 || roleEvidence.some((stage) => stage.status !== 'PASSED' || stage.effectState !== 'APPLIED')) {
    throw new Error('BASE_ADVANCED_ROLE_EVIDENCE_INCOMPLETE');
  }
  return observed;
}

function directoryFiles(dir) {
  try { return fs.readdirSync(dir).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function putImmutableJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(value));
  try { fs.writeFileSync(file, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!fs.readFileSync(file).equals(bytes)) throw new Error('BASE_ADVANCED_IMMUTABLE_ARTIFACT_MISMATCH');
  }
  return { file, digest: createHash('sha256').update(bytes).digest('hex') };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('BASE_ADVANCED_ARTIFACT_INVALID'); }
}

function attemptFiles(attemptDir, prefix) {
  return directoryFiles(attemptDir).filter((name) => name.startsWith(prefix)).map((name) => path.join(attemptDir, name));
}

function assertNoUnknownAttempts(attemptDir) {
  for (const intentFile of [...attemptFiles(attemptDir, 'fetch-intent-'), ...attemptFiles(attemptDir, 'merge-intent-')]) {
    const intent = readJson(intentFile);
    if (!intent) continue;
    const resultPrefix = intentFile.includes('fetch-intent-') ? 'fetch-result-' : 'reconciliation-';
    const key = path.basename(intentFile).replace(/^(?:fetch|merge)-intent-/, '').replace(/\.json$/, '');
    if (!fs.existsSync(path.join(attemptDir, `${resultPrefix}${key}.json`))) {
      throw new Error(intentFile.includes('fetch-intent-')
        ? 'BASE_ADVANCED_FETCH_OUTCOME_UNKNOWN' : 'BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');
    }
  }
}

function assertNoPriorHeldReconciliation(attemptDir, { taskId, cycleNo, oldHeadCommit, oldBaseCommit, checkpoint, reassessment }) {
  if (reassessment) return;
  for (const file of attemptFiles(attemptDir, 'reconciliation-')) {
    const result = readJson(file);
    if (result?.schemaVersion === 'root-base-advanced-reconciliation/v1'
        && result.taskId === taskId && result.cycleNo === cycleNo
        && result.oldHeadCommit === oldHeadCommit && result.oldBaseCommit === oldBaseCommit
        && isDeepStrictEqual(result.checkpoint, checkpoint)
        && result.status !== 'MERGED_AND_REMOTE_CONFIRMED') {
      throw new Error('BASE_ADVANCED_PRIOR_ATTEMPT_HELD');
    }
  }
}

function privateReference(privateRoot, file) {
  return `private://zuri-delivery-control/${path.relative(privateRoot, file).split(path.sep).join('/')}`;
}

function resolvePrivateReference(privateRoot, reference) {
  const prefix = 'private://zuri-delivery-control/';
  if (typeof reference !== 'string' || !reference.startsWith(prefix)) throw new Error('BASE_ADVANCED_PRIVATE_EVIDENCE_REFERENCE_INVALID');
  const relative = reference.slice(prefix.length).split('/').join(path.sep);
  const file = path.resolve(privateRoot, relative);
  if (!within(privateRoot, file)) throw new Error('BASE_ADVANCED_PRIVATE_EVIDENCE_REFERENCE_INVALID');
  return file;
}

function resultForCurrentHead({ attemptDir, run, worktree, snapshot, checkpoint, task, privateRoot, baseRef }) {
  for (const file of attemptFiles(attemptDir, 'reconciliation-')) {
    const result = readJson(file);
    if (result?.schemaVersion === 'root-base-advanced-reconciliation/v1'
        && result.status === 'MERGED_AND_REMOTE_CONFIRMED'
        && result.taskId === run.taskId && result.cycleNo === run.currentCycle
        && result.oldHeadCommit === run.candidateHeadCommit && result.oldBaseCommit === run.baseCommit
        && result.taskDigest === task.taskDigest && result.checkpoint && isDeepStrictEqual(result.checkpoint, checkpoint)
        && result.dispositionRef === snapshot.baseAdvancedDisposition?.evidenceRef) {
      const current = worktreeObservation(worktree);
      const parentLine = current.head && maybeGit(worktree, ['rev-list', '--parents', '-n', '1', current.head]);
      const parents = parentLine?.split(/\s+/).slice(1) ?? [];
      const key = path.basename(file).replace(/^reconciliation-/, '').replace(/\.json$/, '');
      const fetchIntent = readJson(path.join(attemptDir, `fetch-intent-${key}.json`));
      const fetchResult = readJson(path.join(attemptDir, `fetch-result-${key}.json`));
      const mergeIntent = readJson(path.join(attemptDir, `merge-intent-${key}.json`));
      const dispositionFile = resolvePrivateReference(privateRoot, result.dispositionRef);
      const disposition = readJson(dispositionFile);
      const exactJournal = fetchIntent?.schemaVersion === 'root-base-advanced-fetch-intent/v1'
        && fetchIntent.taskId === run.taskId && fetchIntent.cycleNo === run.currentCycle
        && fetchIntent.oldHeadCommit === run.candidateHeadCommit && fetchIntent.oldBaseCommit === run.baseCommit
        && fetchIntent.baseRef === baseRef
        && fetchResult?.schemaVersion === 'root-base-advanced-fetch-result/v1'
        && fetchResult.status === 'FETCH_CONFIRMED' && fetchResult.baseRef === baseRef
        && fetchResult.fetchedBaseSha === result.newBaseCommit && fetchResult.remoteShaAfterFetch === result.newBaseCommit
        && mergeIntent?.schemaVersion === 'root-base-advanced-merge-intent/v1'
        && mergeIntent.taskId === run.taskId && mergeIntent.cycleNo === run.currentCycle
        && mergeIntent.oldHeadCommit === run.candidateHeadCommit && mergeIntent.oldBaseCommit === run.baseCommit
        && mergeIntent.newBaseCommit === result.newBaseCommit && mergeIntent.baseRef === baseRef
        && mergeIntent.operation === 'git merge --no-edit --no-ff'
        && mergeIntent.dispositionRef === result.dispositionRef
        && disposition?.schemaVersion === 'root-base-advanced-disposition/v1'
        && disposition.taskId === run.taskId && disposition.cycleNo === run.currentCycle
        && disposition.oldHeadCommit === run.candidateHeadCommit && disposition.oldBaseCommit === run.baseCommit
        && disposition.newBaseCommit === result.newBaseCommit && disposition.remoteShaAfterFetch === result.newBaseCommit
        && isDeepStrictEqual(disposition.checkpoint, checkpoint);
      const exactGit = current.head === result.headCommit && current.branch === run.branch && current.status === ''
        && current.unmerged === '' && current.mergeHead === null && parents.length === 2
        && parents[0] === run.candidateHeadCommit && parents[1] === result.newBaseCommit
        && isDeepStrictEqual(result.mergeParents, parents)
        && maybeGit(worktree, ['merge-base', '--is-ancestor', run.baseCommit, result.newBaseCommit]) !== null
        && maybeGit(worktree, ['merge-base', '--is-ancestor', checkpoint.actualBaseCommit, result.newBaseCommit]) !== null
        && maybeGit(worktree, ['merge-base', '--is-ancestor', run.candidateHeadCommit, result.headCommit]) !== null
        && maybeGit(worktree, ['merge-base', '--is-ancestor', result.newBaseCommit, result.headCommit]) !== null;
      if (exactJournal && exactGit) return { result, file, current };
      throw new Error('BASE_ADVANCED_MERGE_RECONCILIATION_INVALID');
    }
  }
  return null;
}

function makePreparedReceipt({ privateRoot, stateRoot, binding, run, result, resultFile, reason }) {
  const evidenceRef = privateReference(privateRoot, resultFile);
  const receipt = {
    schemaVersion: 'root-base-prepared-candidate/v1',
    taskId: binding.taskId,
    cycleNo: run.currentCycle,
    oldHeadCommit: result.oldHeadCommit,
    headCommit: result.headCommit,
    oldBaseCommit: result.oldBaseCommit,
    newBaseCommit: result.newBaseCommit,
    reason,
    evidenceRef,
    reconciliationRef: evidenceRef,
  };
  const receiptKey = digest(receipt);
  const receiptFile = path.join(stateRoot, 'prepared', `${binding.taskId}-cycle-${run.currentCycle}-${receiptKey}.json`);
  const saved = putImmutableJson(receiptFile, receipt);
  return { receipt, receiptFile: saved.file, receiptDigest: saved.digest };
}

/** Build a stable observation fingerprint without fetching or mutating Git state. */
export async function baseAdvancedResumeSignature({ repoRoot, privateRoot, stateRoot, campaignId, binding,
  checkpoint, controller, baseRef, readRemoteBase = readConfiguredRemoteBase, runnerActive = false }) {
  let roots;
  let inspection;
  let remoteBaseSha;
  let worktree;
  let taskBytesDigest;
  let artifactNames = [];
  try {
    roots = safePrivateRoots({ repoRoot, privateRoot, stateRoot, campaignId });
    inspection = inspectController(controller, binding.taskId);
  } catch (error) { inspection = { error: String(error.code ?? error.message) }; }
  try { remoteBaseSha = await readRemoteBase({ repo: binding.worktree, baseRef }); }
  catch (error) { remoteBaseSha = { error: String(error.code ?? error.message) }; }
  try {
    worktree = { root: fs.realpathSync(binding.worktree), ...worktreeObservation(binding.worktree) };
  } catch (error) { worktree = { error: String(error.code ?? error.message) }; }
  try { taskBytesDigest = createHash('sha256').update(fs.readFileSync(binding.taskFile)).digest('hex'); }
  catch (error) { taskBytesDigest = { error: String(error.code ?? error.message) }; }
  if (roots && inspection?.run) {
    const dir = path.join(roots.stateRoot, 'base-advanced-resume', binding.taskId, `cycle-${inspection.run.currentCycle}`);
    artifactNames = directoryFiles(dir).map((name) => {
      const file = path.join(dir, name);
      try { return [name, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]; }
      catch (error) { return [name, error.code ?? error.message]; }
    });
  }
  return digest({
    taskId: binding.taskId,
    checkpoint: checkpoint && { status: checkpoint.status, code: checkpoint.code, taskId: checkpoint.taskId,
      expectedBaseCommit: checkpoint.expectedBaseCommit, actualBaseCommit: checkpoint.actualBaseCommit,
      candidateHeadCommit: checkpoint.candidateHeadCommit, number: checkpoint.number ?? null },
    controller: inspection?.run ? {
      state: inspection.run.state, currentCycle: inspection.run.currentCycle, baseCommit: inspection.run.baseCommit,
      candidateHeadCommit: inspection.run.candidateHeadCommit, initialHeadCommit: inspection.run.initialHeadCommit,
      branch: inspection.run.branch, worktreeRoot: inspection.run.worktreeRoot,
      cycle: inspection.cycle, activeLeases: inspection.activeLeases, unknownEffects: inspection.unknownEffects,
      unknownNodes: inspection.unknownNodes,
    } : inspection,
    worktree, taskBytesDigest, baseRef, trackedBaseSha: (() => { try { return trackingSha(binding.worktree, baseRef); } catch (error) { return { error: error.code ?? error.message }; } })(),
    remoteBaseSha, runnerActive, artifactNames,
  });
}

/**
 * Root-owned BASE_ADVANCED bridge. It revalidates the paused run before the
 * transactional disposition, then uses fetch plus an ordinary merge only.
 */
export async function prepareBaseAdvancedResume({ repoRoot, privateRoot, stateRoot, campaignId, binding,
  checkpoint, controller, runner, baseRef, reassessment = null,
  fetchBase = fetchConfiguredBase, readRemoteBase = readConfiguredRemoteBase,
  mergeBase = ({ repo, newBaseCommit }) => git(repo, ['merge', '--no-edit', '--no-ff', newBaseCommit]) }) {
  const roots = safePrivateRoots({ repoRoot, privateRoot, stateRoot, campaignId });
  const taskId = binding?.taskId;
  if (!safeTaskId(taskId)) throw new Error('BASE_ADVANCED_TASK_ID_INVALID');
  if (runner?.isActive?.(taskId)) throw new Error('BASE_ADVANCED_RUNNER_ACTIVE');
  const snapshot = inspectController(controller, taskId);
  const run = snapshot.run;
  if (checkpoint?.status !== 'ROOT_REPLAN_PAUSED') throw new Error('BASE_ADVANCED_CHECKPOINT_NOT_PAUSED');
  requireCheckpoint(checkpoint, run, binding);
  const task = readTask(binding, run, roots.privateRoot);
  const observed = assertBaseAdvancedRunBinding({ binding, run, worktree: binding.worktree, snapshot, checkpoint });
  if (binding.trustedMandateBinding && run.trustedMandateBinding?.sourceRef !== binding.trustedMandateBinding.sourceRef) {
    throw new Error('BASE_ADVANCED_MANDATE_BINDING_MISMATCH');
  }
  const attemptDir = path.join(roots.stateRoot, 'base-advanced-resume', taskId, `cycle-${run.currentCycle}`);
  fs.mkdirSync(attemptDir, { recursive: true });
  if (!within(roots.stateRoot, fs.realpathSync(attemptDir))) throw new Error('BASE_ADVANCED_ARTIFACT_PATH_ESCAPE');
  assertNoUnknownAttempts(attemptDir);
  assertNoPriorHeldReconciliation(attemptDir, { taskId, cycleNo: run.currentCycle,
    oldHeadCommit: run.candidateHeadCommit, oldBaseCommit: run.baseCommit, checkpoint, reassessment });

  // A completed Git merge whose result was journaled can be finished as a
  // metadata-only receipt write after a restart. A missing result is unknown.
  const completed = resultForCurrentHead({ attemptDir, run, worktree: binding.worktree, snapshot, checkpoint,
    task, privateRoot: roots.privateRoot, baseRef });
  if (completed) {
    const remoteAfter = await readRemoteBase({ repo: binding.worktree, baseRef });
    if (remoteAfter !== completed.result.newBaseCommit) throw new Error('BASE_ADVANCED_REMOTE_MOVED_AFTER_MERGE');
    const reason = `Root recorded a material-evidence YIELD_REASSESS after verifying BASE_ADVANCED and merged the confirmed base within cycle ${run.currentCycle}.`;
    return { status: 'READY_TO_RESUME', ...makePreparedReceipt({ privateRoot: roots.privateRoot, stateRoot: roots.stateRoot,
      binding, run, result: completed.result, resultFile: completed.file, reason }) };
  }
  if (observed.head !== run.candidateHeadCommit || observed.status !== ''
      || observed.unmerged !== '' || observed.mergeHead !== null) throw new Error('BASE_ADVANCED_CANDIDATE_NOT_EXACT_AND_CLEAN');

  let remoteBefore;
  try { remoteBefore = await readRemoteBase({ repo: binding.worktree, baseRef }); }
  catch { throw new Error('BASE_ADVANCED_REMOTE_UNAVAILABLE_BEFORE_FETCH'); }
  if (!isCommit(remoteBefore)) throw new Error('BASE_ADVANCED_REMOTE_SHA_INVALID');
  const trackedBefore = trackingSha(binding.worktree, baseRef);
  const reassessmentDigest = reassessment ? digest({ evidenceRef: reassessment.evidenceRef, reason: reassessment.reason,
    requestedAt: reassessment.requestedAt }) : null;
  // Keep the attempt key stable when a prior fetch updated the local tracking
  // ref. A restart must discover its existing intent/reconciliation instead of
  // treating our own fetch as new evidence and repeating the merge.
  const attemptKey = digest({ taskId, cycleNo: run.currentCycle, oldHeadCommit: run.candidateHeadCommit,
    oldBaseCommit: run.baseCommit, checkpoint, remoteBefore, taskDigest: task.taskDigest, reassessmentDigest });
  const fetchIntentFile = path.join(attemptDir, `fetch-intent-${attemptKey}.json`);
  const fetchResultFile = path.join(attemptDir, `fetch-result-${attemptKey}.json`);
  const reconciliationFile = path.join(attemptDir, `reconciliation-${attemptKey}.json`);
  const priorReconciliation = readJson(reconciliationFile);
  if (priorReconciliation && priorReconciliation.status !== 'MERGED_AND_REMOTE_CONFIRMED') {
    throw new Error('BASE_ADVANCED_PRIOR_ATTEMPT_HELD');
  }
  if (!fs.existsSync(fetchResultFile)) {
    putImmutableJson(fetchIntentFile, { schemaVersion: 'root-base-advanced-fetch-intent/v1', taskId,
      cycleNo: run.currentCycle, oldHeadCommit: run.candidateHeadCommit, oldBaseCommit: run.baseCommit,
      baseRef, remoteBefore, trackedBefore, evidenceSignature: attemptKey });
    const fetchedBaseSha = await fetchBase({ repo: binding.worktree, baseRef });
    if (!isCommit(fetchedBaseSha)) throw new Error('BASE_ADVANCED_FETCH_SHA_INVALID');
    const remoteAfterFetch = await readRemoteBase({ repo: binding.worktree, baseRef });
    if (!isCommit(remoteAfterFetch)) throw new Error('BASE_ADVANCED_REMOTE_SHA_INVALID_AFTER_FETCH');
    const fetchDisposition = fetchedBaseSha === remoteAfterFetch ? 'FETCH_CONFIRMED' : 'REMOTE_MOVED_DURING_FETCH';
    putImmutableJson(fetchResultFile, { schemaVersion: 'root-base-advanced-fetch-result/v1', taskId,
      cycleNo: run.currentCycle, baseRef, fetchedBaseSha, remoteShaAfterFetch: remoteAfterFetch,
      status: fetchDisposition, observedAt: new Date().toISOString() });
    if (fetchDisposition !== 'FETCH_CONFIRMED') throw new Error('BASE_ADVANCED_REMOTE_MOVED_DURING_FETCH');
  }
  const fetchResult = readJson(fetchResultFile);
  if (fetchResult?.status !== 'FETCH_CONFIRMED' || !isCommit(fetchResult.fetchedBaseSha)
      || fetchResult.fetchedBaseSha !== fetchResult.remoteShaAfterFetch) throw new Error('BASE_ADVANCED_FETCH_CONFIRMATION_INVALID');
  const newBaseCommit = fetchResult.fetchedBaseSha;
  if (newBaseCommit === run.baseCommit || !isCommit(newBaseCommit)
      || maybeGit(binding.worktree, ['merge-base', '--is-ancestor', run.baseCommit, newBaseCommit]) === null) {
    throw new Error('BASE_ADVANCED_BASE_NOT_FAST_FORWARD');
  }
  if (maybeGit(binding.worktree, ['merge-base', '--is-ancestor', checkpoint.actualBaseCommit, newBaseCommit]) === null) {
    throw new Error('BASE_ADVANCED_CHECKPOINT_BASE_MISMATCH');
  }

  const reason = `Root recorded a material-evidence YIELD_REASSESS after verifying BASE_ADVANCED, fetched base ${newBaseCommit}, and the fresh remote SHA.`;
  const dispositionFile = path.join(attemptDir, `disposition-${attemptKey}.json`);
  putImmutableJson(dispositionFile, { schemaVersion: 'root-base-advanced-disposition/v1', disposition: 'YIELD_REASSESS',
    basis: 'MATERIAL_NEW_EVIDENCE', taskId, cycleNo: run.currentCycle, oldHeadCommit: run.candidateHeadCommit,
    oldBaseCommit: run.baseCommit, observedBaseCommit: checkpoint.actualBaseCommit,
    newBaseCommit, remoteShaAfterFetch: fetchResult.remoteShaAfterFetch, checkpoint,
    taskDigest: task.taskDigest, evidenceRef: `root-campaign:${campaignId}:BASE_ADVANCED:${attemptKey}`, reason });
  const evidenceRef = privateReference(roots.privateRoot, dispositionFile);
  if (run.state === 'ROOT_INTEGRATED_PENDING_CI') {
    controller.recordBaseAdvancedDisposition({ taskId, cycleNo: run.currentCycle,
      expectedBaseCommit: run.baseCommit, expectedCandidateHeadCommit: run.candidateHeadCommit,
      observedBaseCommit: newBaseCommit, checkpoint, evidenceRef, reason });
  } else if (snapshot.baseAdvancedDisposition?.evidenceRef !== evidenceRef) {
    if (!isDeepStrictEqual(snapshot.baseAdvancedDisposition?.checkpoint, checkpoint)) {
      throw new Error('BASE_ADVANCED_DISPOSITION_MISMATCH');
    }
    controller.recordBaseAdvancedDisposition({ taskId, cycleNo: run.currentCycle,
      expectedBaseCommit: run.baseCommit, expectedCandidateHeadCommit: run.candidateHeadCommit,
      observedBaseCommit: newBaseCommit, checkpoint, evidenceRef, reason });
  }

  const afterDisposition = inspectController(controller, taskId);
  if (afterDisposition.run.state !== 'BLOCKED_STALE_CANDIDATE' || afterDisposition.run.currentCycle !== run.currentCycle
      || afterDisposition.run.baseCommit !== run.baseCommit || afterDisposition.run.candidateHeadCommit !== run.candidateHeadCommit
      || runner?.isActive?.(taskId)) throw new Error('BASE_ADVANCED_PAUSE_PROOF_CHANGED');
  const beforeMerge = worktreeObservation(binding.worktree);
  if (beforeMerge.head !== run.candidateHeadCommit || beforeMerge.branch !== run.branch || beforeMerge.status !== ''
      || beforeMerge.unmerged !== '' || beforeMerge.mergeHead !== null) throw new Error('BASE_ADVANCED_CANDIDATE_CHANGED_BEFORE_MERGE');
  const remoteBeforeMerge = await readRemoteBase({ repo: binding.worktree, baseRef });
  if (remoteBeforeMerge !== newBaseCommit) {
    putImmutableJson(reconciliationFile, { schemaVersion: 'root-base-advanced-reconciliation/v1',
      status: 'REMOTE_MOVED_BEFORE_MERGE', taskId, cycleNo: run.currentCycle,
      oldHeadCommit: run.candidateHeadCommit, oldBaseCommit: run.baseCommit, newBaseCommit,
      headCommit: beforeMerge.head, remoteShaBeforeMerge: remoteBeforeMerge, checkpoint,
      dispositionRef: evidenceRef, taskDigest: task.taskDigest, mergeParents: [],
      observedAt: new Date().toISOString() });
    throw new Error('BASE_ADVANCED_REMOTE_MOVED_BEFORE_MERGE');
  }

  const mergeIntentFile = path.join(attemptDir, `merge-intent-${attemptKey}.json`);
  putImmutableJson(mergeIntentFile, { schemaVersion: 'root-base-advanced-merge-intent/v1', taskId,
    cycleNo: run.currentCycle, oldHeadCommit: run.candidateHeadCommit, oldBaseCommit: run.baseCommit,
    newBaseCommit, baseRef, operation: 'git merge --no-edit --no-ff', evidenceSignature: attemptKey,
    dispositionRef: evidenceRef });
  let mergeError = null;
  try { await mergeBase({ repo: binding.worktree, newBaseCommit }); }
  catch (error) { mergeError = error; }
  const afterMerge = worktreeObservation(binding.worktree);
  const resultingHead = afterMerge.head;
  const parentLine = resultingHead ? maybeGit(binding.worktree, ['rev-list', '--parents', '-n', '1', resultingHead]) : null;
  const parents = parentLine?.split(/\s+/).slice(1) ?? [];
  const applied = afterMerge.branch === run.branch && afterMerge.status === '' && afterMerge.unmerged === ''
    && afterMerge.mergeHead === null && resultingHead !== run.candidateHeadCommit
    && parents.length === 2 && parents[0] === run.candidateHeadCommit && parents[1] === newBaseCommit;
  if (!applied && mergeError) {
    const mergeHead = afterMerge.mergeHead;
    const hasConflict = maybeGit(binding.worktree, ['ls-files', '-u', '-z']) !== '';
    if (mergeError.status === 1 && mergeHead === newBaseCommit && hasConflict) {
      try { git(binding.worktree, ['merge', '--abort']); }
      catch { throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN'); }
      const afterAbort = worktreeObservation(binding.worktree);
      if (afterAbort.head !== run.candidateHeadCommit || afterAbort.branch !== run.branch || afterAbort.status !== ''
          || afterAbort.unmerged !== '' || afterAbort.mergeHead !== null) throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');
      putImmutableJson(reconciliationFile, { schemaVersion: 'root-base-advanced-reconciliation/v1', status: 'MERGE_ABORTED_CONFLICT',
        taskId, cycleNo: run.currentCycle, oldHeadCommit: run.candidateHeadCommit, oldBaseCommit: run.baseCommit,
        newBaseCommit, headCommit: afterAbort.head, remoteShaAfterMerge: null, dispositionRef: evidenceRef,
        conflictProven: true, ownMergeAborted: true, observedAt: new Date().toISOString() });
      throw new Error('BASE_ADVANCED_MERGE_CONFLICT');
    }
    if (resultingHead === run.candidateHeadCommit && afterMerge.status === '' && afterMerge.unmerged === '' && afterMerge.mergeHead === null) {
      putImmutableJson(reconciliationFile, { schemaVersion: 'root-base-advanced-reconciliation/v1', status: 'MERGE_FAILED_NO_EFFECT',
        taskId, cycleNo: run.currentCycle, oldHeadCommit: run.candidateHeadCommit, oldBaseCommit: run.baseCommit,
        newBaseCommit, headCommit: resultingHead, dispositionRef: evidenceRef, observedAt: new Date().toISOString() });
      throw new Error('BASE_ADVANCED_MERGE_FAILED_NO_EFFECT');
    }
    throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');
  }
  if (!applied) throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');

  let remoteAfterMerge;
  try { remoteAfterMerge = await readRemoteBase({ repo: binding.worktree, baseRef }); }
  catch { throw new Error('BASE_ADVANCED_REMOTE_UNCERTAIN_AFTER_MERGE'); }
  const mergeStatus = remoteAfterMerge === newBaseCommit ? 'MERGED_AND_REMOTE_CONFIRMED' : 'MERGED_REMOTE_MOVED';
  const result = { schemaVersion: 'root-base-advanced-reconciliation/v1', status: mergeStatus,
    taskId, cycleNo: run.currentCycle, oldHeadCommit: run.candidateHeadCommit, oldBaseCommit: run.baseCommit,
    newBaseCommit, headCommit: resultingHead, remoteShaAfterMerge: remoteAfterMerge,
    checkpoint, dispositionRef: evidenceRef, taskDigest: task.taskDigest,
    previousRoleAndCiEvidenceInvalidated: true, mergeParents: parents, observedAt: new Date().toISOString() };
  putImmutableJson(reconciliationFile, result);
  if (mergeStatus !== 'MERGED_AND_REMOTE_CONFIRMED') throw new Error('BASE_ADVANCED_REMOTE_MOVED_AFTER_MERGE');
  const saved = makePreparedReceipt({ privateRoot: roots.privateRoot, stateRoot: roots.stateRoot, binding, run,
    result, resultFile: reconciliationFile, reason });
  return { status: 'READY_TO_RESUME', ...saved };
}

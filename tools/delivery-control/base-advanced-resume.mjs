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
const samePath = (left, right) => path.relative(path.resolve(left), path.resolve(right)) === ''
  && path.relative(path.resolve(right), path.resolve(left)) === '';
const pathFailure = (code) => { const error = new Error(code); error.code = code; return error; };

function assertCanonicalDirectory(root, target, { allowMissing = false } = {}) {
  const absoluteRoot = path.resolve(root);
  let rootStat;
  try { rootStat = fs.lstatSync(absoluteRoot); }
  catch { throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_INVALID'); }
  if (rootStat.isSymbolicLink()) throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED');
  if (!rootStat.isDirectory()) throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_INVALID');
  const canonicalRoot = fs.realpathSync(absoluteRoot);
  if (!samePath(absoluteRoot, canonicalRoot)) throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED');

  const absoluteTarget = path.resolve(target);
  if (!within(canonicalRoot, absoluteTarget)) throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_INVALID');
  const relative = path.relative(canonicalRoot, absoluteTarget);
  let current = canonicalRoot;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (allowMissing && error.code === 'ENOENT') return absoluteTarget;
      throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_MISSING');
    }
    if (stat.isSymbolicLink()) throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED');
    if (!stat.isDirectory() || !samePath(fs.realpathSync(current), current)) {
      throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED');
    }
  }
  return absoluteTarget;
}

export function validatePreparedReceiptDirectory({ privateRoot, stateRoot }) {
  const canonicalPrivate = assertCanonicalDirectory(privateRoot, privateRoot);
  const canonicalState = path.resolve(stateRoot);
  const relativeState = path.relative(canonicalPrivate, canonicalState).split(path.sep);
  if (relativeState.length !== 2 || relativeState[0] !== 'supervisors' || !safeTaskId(relativeState[1])) {
    throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_INVALID');
  }
  assertCanonicalDirectory(canonicalPrivate, canonicalState);
  const preparedDirectory = path.join(canonicalState, 'prepared');
  assertCanonicalDirectory(canonicalPrivate, preparedDirectory, { allowMissing: true });
  return preparedDirectory;
}

export function validatePreparedReceiptPath({ privateRoot, stateRoot, receiptFile, taskId, cycleNo,
  requireExisting = true } = {}) {
  if (!safeTaskId(taskId) || typeof receiptFile !== 'string' || !receiptFile) {
    throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_INVALID');
  }
  const canonicalPrivate = assertCanonicalDirectory(privateRoot, privateRoot);
  const absoluteFile = path.resolve(receiptFile);
  let selectedState = stateRoot ? path.resolve(stateRoot) : null;
  if (!selectedState) {
    const relativeFile = path.relative(canonicalPrivate, absoluteFile).split(path.sep);
    if (relativeFile.length !== 4 || relativeFile[0] !== 'supervisors' || !safeTaskId(relativeFile[1])
        || relativeFile[2] !== 'prepared') throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_INVALID');
    selectedState = path.join(canonicalPrivate, 'supervisors', relativeFile[1]);
  }
  const preparedDirectory = validatePreparedReceiptDirectory({ privateRoot: canonicalPrivate, stateRoot: selectedState });
  const expectedFile = path.join(preparedDirectory, path.basename(absoluteFile));
  if (!samePath(absoluteFile, expectedFile)) throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_INVALID');
  const legacyName = `${taskId}.json`;
  const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cyclePattern = new RegExp(`^${escapedTaskId}-cycle-${cycleNo === undefined ? '[1-9][0-9]*' : cycleNo}-[a-f0-9]{64}\\.json$`);
  if (path.basename(absoluteFile) !== legacyName && !cyclePattern.test(path.basename(absoluteFile))) {
    throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_INVALID');
  }
  try {
    const stat = fs.lstatSync(absoluteFile);
    if (stat.isSymbolicLink()) throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED');
    if (!stat.isFile() || !samePath(fs.realpathSync(absoluteFile), absoluteFile)) {
      throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED');
    }
  } catch (error) {
    if (error.code === 'BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED') throw error;
    if (error.code === 'ENOENT' && !requireExisting) return absoluteFile;
    if (error.code === 'ENOENT') throw pathFailure('BASE_ADVANCED_PREPARED_RECEIPT_PATH_MISSING');
    throw error;
  }
  return absoluteFile;
}

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
  try {
    if (fs.lstatSync(expectedPrivate).isSymbolicLink()) throw new Error('BASE_ADVANCED_PRIVATE_ROOT_REDIRECTED');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  fs.mkdirSync(expectedPrivate, { recursive: true });
  const actualPrivate = fs.realpathSync(expectedPrivate);
  if (!samePath(actualPrivate, expectedPrivate) || !within(common, actualPrivate)
      || (privateRoot && (!samePath(path.resolve(privateRoot), actualPrivate)
        || !samePath(fs.realpathSync(privateRoot), actualPrivate)))) {
    throw new Error('BASE_ADVANCED_PRIVATE_ROOT_MISMATCH');
  }
  if (!safeTaskId(campaignId)) throw new Error('BASE_ADVANCED_CAMPAIGN_ID_INVALID');
  const campaignStateRoot = path.join(actualPrivate, 'supervisors', campaignId);
  assertCanonicalDirectory(actualPrivate, campaignStateRoot, { allowMissing: true });
  fs.mkdirSync(campaignStateRoot, { recursive: true });
  const actualStateRoot = fs.realpathSync(campaignStateRoot);
  if (!samePath(actualStateRoot, campaignStateRoot) || !within(actualPrivate, actualStateRoot)
      || (stateRoot && (!samePath(path.resolve(stateRoot), actualStateRoot)
        || !samePath(fs.realpathSync(stateRoot), actualStateRoot)))) {
    throw new Error('BASE_ADVANCED_STATE_ROOT_MISMATCH');
  }
  validatePreparedReceiptDirectory({ privateRoot: actualPrivate, stateRoot: actualStateRoot });
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
  validatePreparedReceiptPath({ privateRoot, stateRoot, receiptFile, taskId: binding.taskId,
    cycleNo: run.currentCycle, requireExisting: false });
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
  validatePreparedReceiptPath({ privateRoot, stateRoot, receiptFile, taskId: binding.taskId,
    cycleNo: run.currentCycle, requireExisting: false });
  const bytes = Buffer.from(JSON.stringify(receipt));
  try { fs.writeFileSync(receiptFile, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    validatePreparedReceiptPath({ privateRoot, stateRoot, receiptFile, taskId: binding.taskId,
      cycleNo: run.currentCycle, requireExisting: true });
    if (!fs.readFileSync(receiptFile).equals(bytes)) throw new Error('BASE_ADVANCED_IMMUTABLE_ARTIFACT_MISMATCH');
  }
  validatePreparedReceiptPath({ privateRoot, stateRoot, receiptFile, taskId: binding.taskId,
    cycleNo: run.currentCycle, requireExisting: true });
  return { receipt, receiptFile, receiptDigest: createHash('sha256').update(bytes).digest('hex') };
}

async function recoverUnjournaledMerge({ attemptDir, taskId, run, worktree, snapshot, checkpoint, task,
  privateRoot, baseRef, readRemoteBase }) {
  const missing = attemptFiles(attemptDir, 'merge-intent-').filter((file) => {
    const key = path.basename(file).replace(/^merge-intent-/, '').replace(/\.json$/, '');
    return !fs.existsSync(path.join(attemptDir, `reconciliation-${key}.json`));
  });
  if (!missing.length) return null;
  if (missing.length !== 1) throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');
  const intentFile = missing[0];
  const key = path.basename(intentFile).replace(/^merge-intent-/, '').replace(/\.json$/, '');
  const intent = readJson(intentFile);
  const fetchIntent = readJson(path.join(attemptDir, `fetch-intent-${key}.json`));
  const fetchResult = readJson(path.join(attemptDir, `fetch-result-${key}.json`));
  const dispositionFile = intent?.dispositionRef ? resolvePrivateReference(privateRoot, intent.dispositionRef) : null;
  const disposition = dispositionFile && readJson(dispositionFile);
  const exactBinding = intent?.schemaVersion === 'root-base-advanced-merge-intent/v1'
    && intent.evidenceSignature === key && intent.taskId === taskId && intent.cycleNo === run.currentCycle
    && intent.oldHeadCommit === run.candidateHeadCommit && intent.oldBaseCommit === run.baseCommit
    && isCommit(intent.newBaseCommit) && intent.newBaseCommit !== run.baseCommit && intent.baseRef === baseRef
    && intent.operation === 'git merge --no-edit --no-ff'
    && intent.taskDigest === task.taskDigest && intent.dispositionRef === snapshot.baseAdvancedDisposition?.evidenceRef
    && dispositionFile && intent.dispositionRef === privateReference(privateRoot, dispositionFile)
    && fetchIntent?.schemaVersion === 'root-base-advanced-fetch-intent/v1'
    && fetchIntent.evidenceSignature === key && fetchIntent.taskId === taskId
    && fetchIntent.cycleNo === run.currentCycle && fetchIntent.oldHeadCommit === run.candidateHeadCommit
    && fetchIntent.oldBaseCommit === run.baseCommit && fetchIntent.baseRef === baseRef
    && fetchResult?.schemaVersion === 'root-base-advanced-fetch-result/v1'
    && fetchResult.status === 'FETCH_CONFIRMED' && fetchResult.taskId === taskId
    && fetchResult.cycleNo === run.currentCycle && fetchResult.baseRef === baseRef
    && fetchResult.fetchedBaseSha === intent.newBaseCommit
    && fetchResult.remoteShaAfterFetch === intent.newBaseCommit
    && disposition?.schemaVersion === 'root-base-advanced-disposition/v1'
    && disposition.disposition === 'YIELD_REASSESS' && disposition.basis === 'MATERIAL_NEW_EVIDENCE'
    && disposition.taskId === taskId && disposition.cycleNo === run.currentCycle
    && disposition.oldHeadCommit === run.candidateHeadCommit && disposition.oldBaseCommit === run.baseCommit
    && disposition.newBaseCommit === intent.newBaseCommit && disposition.taskDigest === task.taskDigest
    && disposition.evidenceRef === `root-campaign:${intent.campaignId}:BASE_ADVANCED:${key}`
    && isDeepStrictEqual(disposition.checkpoint, checkpoint)
    && run.state === 'BLOCKED_STALE_CANDIDATE' && snapshot.cycle?.state === 'BLOCKED'
    && snapshot.baseAdvancedDisposition?.disposition === 'YIELD_REASSESS'
    && snapshot.baseAdvancedDisposition?.basis === 'MATERIAL_NEW_EVIDENCE'
    && snapshot.baseAdvancedDisposition?.source === 'BASE_ADVANCED'
    && snapshot.baseAdvancedDisposition?.oldHeadCommit === run.candidateHeadCommit
    && snapshot.baseAdvancedDisposition?.oldBaseCommit === run.baseCommit
    && isDeepStrictEqual(snapshot.baseAdvancedDisposition?.checkpoint, checkpoint);
  if (!exactBinding) throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');

  const before = worktreeObservation(worktree);
  const parentLine = before.head && maybeGit(worktree, ['rev-list', '--parents', '-n', '1', before.head]);
  const parents = parentLine?.split(/\s+/).slice(1) ?? [];
  const exactGit = before.head !== run.candidateHeadCommit && before.branch === run.branch && before.status === ''
    && before.unmerged === '' && before.mergeHead === null && parents.length === 2
    && parents[0] === run.candidateHeadCommit && parents[1] === intent.newBaseCommit
    && maybeGit(worktree, ['merge-base', '--is-ancestor', run.baseCommit, intent.newBaseCommit]) !== null
    && maybeGit(worktree, ['merge-base', '--is-ancestor', checkpoint.actualBaseCommit, intent.newBaseCommit]) !== null;
  if (!exactGit) throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');
  let remoteShaAfterMerge;
  try { remoteShaAfterMerge = await readRemoteBase({ repo: worktree, baseRef }); }
  catch { throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN'); }
  if (remoteShaAfterMerge !== intent.newBaseCommit) throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');
  const after = worktreeObservation(worktree);
  if (after.head !== before.head || after.branch !== run.branch || after.status !== '' || after.unmerged !== '' || after.mergeHead !== null) {
    throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');
  }
  const file = path.join(attemptDir, `reconciliation-${key}.json`);
  const result = { schemaVersion: 'root-base-advanced-reconciliation/v1', status: 'MERGED_AND_REMOTE_CONFIRMED',
    taskId, cycleNo: run.currentCycle, oldHeadCommit: run.candidateHeadCommit, oldBaseCommit: run.baseCommit,
    newBaseCommit: intent.newBaseCommit, headCommit: after.head, remoteShaAfterMerge, checkpoint,
    dispositionRef: intent.dispositionRef, taskDigest: task.taskDigest,
    previousRoleAndCiEvidenceInvalidated: true, mergeParents: parents, observedAt: intent.observedAt ?? fetchResult.observedAt };
  putImmutableJson(file, result);
  return { result, file, current: after };
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
  const recovered = await recoverUnjournaledMerge({ attemptDir, taskId, run, worktree: binding.worktree,
    snapshot, checkpoint, task, privateRoot: roots.privateRoot, baseRef, readRemoteBase });
  assertNoUnknownAttempts(attemptDir);
  assertNoPriorHeldReconciliation(attemptDir, { taskId, cycleNo: run.currentCycle,
    oldHeadCommit: run.candidateHeadCommit, oldBaseCommit: run.baseCommit, checkpoint, reassessment });

  // A completed Git merge whose result was journaled can be finished as a
  // metadata-only receipt write after a restart. A missing result is unknown.
  const completed = recovered ?? resultForCurrentHead({ attemptDir, run, worktree: binding.worktree, snapshot, checkpoint,
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
    dispositionRef: evidenceRef, campaignId, taskDigest: task.taskDigest, observedAt: new Date().toISOString() });
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

function rootOnlyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function rootOnlyAssert(condition, code) {
  if (!condition) throw rootOnlyError(code);
}

function ensurePrivateDirectory(privateRoot, target) {
  const root = fs.realpathSync(privateRoot);
  rootOnlyAssert(samePath(path.resolve(privateRoot), root), 'ROOT_ONLY_PRIVATE_PATH_REDIRECTED');
  const absoluteTarget = path.resolve(target);
  rootOnlyAssert(within(root, absoluteTarget), 'ROOT_ONLY_PRIVATE_PATH_INVALID');
  let current = root;
  for (const segment of path.relative(root, absoluteTarget).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(current);
      stat = fs.lstatSync(current);
    }
    rootOnlyAssert(!stat.isSymbolicLink() && stat.isDirectory() && samePath(fs.realpathSync(current), current),
      'ROOT_ONLY_PRIVATE_PATH_REDIRECTED');
  }
  return absoluteTarget;
}

function assertPrivateFile(privateRoot, file, topDirectory, { allowMissing = false } = {}) {
  const root = fs.realpathSync(privateRoot);
  rootOnlyAssert(samePath(path.resolve(privateRoot), root), 'ROOT_ONLY_PRIVATE_PATH_REDIRECTED');
  rootOnlyAssert(typeof file === 'string' && file.length > 0, 'ROOT_ONLY_PRIVATE_RECORD_PATH_INVALID');
  const absoluteFile = path.resolve(file);
  rootOnlyAssert(within(root, absoluteFile) && !samePath(root, absoluteFile), 'ROOT_ONLY_PRIVATE_RECORD_PATH_INVALID');
  const segments = path.relative(root, absoluteFile).split(path.sep);
  rootOnlyAssert(segments.length >= 2 && segments[0] === topDirectory
    && segments.every((segment) => segment && segment !== '.' && segment !== '..'),
  'ROOT_ONLY_PRIVATE_RECORD_PATH_INVALID');
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const final = index === segments.length - 1;
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (allowMissing && final && error.code === 'ENOENT') return absoluteFile;
      throw rootOnlyError(error.code === 'ENOENT' ? 'ROOT_ONLY_PRIVATE_RECORD_MISSING' : 'ROOT_ONLY_PRIVATE_RECORD_INVALID');
    }
    rootOnlyAssert(!stat.isSymbolicLink() && samePath(fs.realpathSync(current), current),
      'ROOT_ONLY_PRIVATE_RECORD_PATH_REDIRECTED');
    rootOnlyAssert(final ? stat.isFile() : stat.isDirectory(), 'ROOT_ONLY_PRIVATE_RECORD_INVALID');
  }
  return absoluteFile;
}

function readPrivateJsonRecord(privateRoot, file, topDirectory) {
  const absoluteFile = assertPrivateFile(privateRoot, file, topDirectory);
  let bytes;
  let value;
  try {
    bytes = fs.readFileSync(absoluteFile);
    value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch { throw rootOnlyError('ROOT_ONLY_PRIVATE_RECORD_INVALID'); }
  return { file: absoluteFile, bytes, value, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function writeRootOnlyArtifact(privateRoot, file, value) {
  assertPrivateFile(privateRoot, file, 'supervisors', { allowMissing: true });
  const saved = putImmutableJson(file, value);
  assertPrivateFile(privateRoot, file, 'supervisors');
  return saved;
}

function rootOnlyHold({ privateRoot, attemptDir, taskId, cycleNo, evidenceSignature, code, evidence = {} }) {
  const hold = { schemaVersion: 'root-only-base-advanced-hold/v1', status: 'HELD', taskId,
    cycleNo, evidenceSignature, code, evidence };
  const contentDigest = createHash('sha256').update(JSON.stringify(hold)).digest('hex');
  const file = path.join(attemptDir, `hold-${contentDigest}.json`);
  try { writeRootOnlyArtifact(privateRoot, file, hold); }
  catch (error) {
    if (error.code === 'BASE_ADVANCED_IMMUTABLE_ARTIFACT_MISMATCH') throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
    throw error;
  }
  throw rootOnlyError(code);
}

function readRootOnlyArtifact(privateRoot, attemptDir, filename) {
  const file = path.join(attemptDir, filename);
  try {
    assertPrivateFile(privateRoot, file, 'supervisors');
    return readJson(file);
  } catch (error) {
    if (error.code === 'ROOT_ONLY_PRIVATE_RECORD_MISSING') return null;
    if (error.code?.startsWith('ROOT_ONLY_')) throw error;
    throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
  }
}

function rootOnlyHashedArtifact(privateRoot, attemptDir, prefix) {
  const matches = directoryFiles(attemptDir).filter((name) => name.startsWith(prefix));
  if (matches.length > 1) throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
  if (!matches.length) return null;
  const name = matches[0];
  const match = name.match(/-([a-f0-9]{64})\.json$/);
  if (!match) throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
  const file = path.join(attemptDir, name);
  assertPrivateFile(privateRoot, file, 'supervisors');
  const bytes = fs.readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== match[1]) throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
  let value;
  try { value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT'); }
  return { file, bytes, value, sha256 };
}

function putRootOnlyHashedArtifact(privateRoot, attemptDir, prefix, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = path.join(attemptDir, `${prefix}-${sha256}.json`);
  writeRootOnlyArtifact(privateRoot, file, value);
  return { file, sha256, value };
}

function readRootOnlyHolds(privateRoot, attemptDir, taskId, cycleNo) {
  return directoryFiles(attemptDir).filter((name) => name.startsWith('hold-')).map((name) => {
    const match = name.match(/^hold-([a-f0-9]{64})\.json$/);
    if (!match) throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
    const file = path.join(attemptDir, name);
    assertPrivateFile(privateRoot, file, 'supervisors');
    const bytes = fs.readFileSync(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== match[1]) throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
    let value;
    try { value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT'); }
    if (value?.schemaVersion !== 'root-only-base-advanced-hold/v1' || value.status !== 'HELD'
        || value.taskId !== taskId || value.cycleNo !== cycleNo
        || !/^[a-f0-9]{64}$/.test(value.evidenceSignature ?? '')
        || typeof value.code !== 'string' || !value.code.startsWith('ROOT_ONLY_')) {
      throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
    }
    return { file, sha256, value };
  });
}

function rootOnlyObservationKey({ taskId, cycleNo, admissionFile, expectedAdmissionSha256, expectedTaskSha256,
  binding, code, observed = null, effects = null }) {
  return digest({ taskId, cycleNo, admissionFile: admissionFile ?? null,
    expectedAdmissionSha256: expectedAdmissionSha256 ?? null, expectedTaskSha256: expectedTaskSha256 ?? null,
    worktree: binding?.worktree ?? null, branch: binding?.branch ?? null,
    expectedHeadCommit: binding?.expectedCandidateHeadCommit ?? null,
    expectedOldBaseCommit: binding?.expectedOldBaseCommit ?? null, code, observed, effects });
}

function validateRootOnlyAdmission(admission, { taskId, binding, taskFile, taskSha256,
  expectedOldBaseCommit, expectedCandidateHeadCommit }) {
  const cycleNo = admission?.cycle;
  rootOnlyAssert(Number.isSafeInteger(cycleNo) && cycleNo > 1
    && admission?.schemaVersion === 'root-execution-cycle-admission/v1'
    && admission.taskId === taskId && Number.isSafeInteger(admission.revision) && admission.revision > 0
    && admission.status === 'ADMITTED_NOT_DISPATCHED'
    && admission.basis === 'MATERIAL_NEW_EVIDENCE_AND_CORRECTED_IMPLEMENTATION_PLAN'
    && typeof admission.readinessFile === 'string' && samePath(admission.readinessFile, taskFile)
    && /^[a-f0-9]{64}$/i.test(admission.readinessSha256 ?? '')
    && admission.readinessSha256.toLowerCase() === taskSha256,
  'ROOT_ONLY_ADMISSION_BINDING_INVALID');
  const prior = admission.previousCycles?.find((cycle) => cycle.cycle === cycleNo - 1);
  const priorOldBase = prior?.oldBaseCommit ?? prior?.oldBase;
  const priorCandidateHead = prior?.candidateHeadCommit ?? prior?.candidateHead;
  const priorRepairLimit = prior?.implementationRepairsLimit ?? prior?.implementationRepairLimit;
  const priorDeadline = prior?.deadlineAtUtc ?? prior?.deadlineUtc;
  rootOnlyAssert(typeof prior?.disposition === 'string' && prior.disposition.startsWith('PAUSED_')
    && isCommit(priorCandidateHead) && isCommit(priorOldBase)
    && priorCandidateHead === expectedCandidateHeadCommit && priorOldBase === expectedOldBaseCommit
    && Number.isSafeInteger(prior.implementationRepairsUsed) && Number.isSafeInteger(priorRepairLimit)
    && prior.implementationRepairsUsed === priorRepairLimit
    && prior.controllerRunRows === 0 && prior.controllerCycles === 0
    && prior.unknownEffects === 'NONE_OBSERVED'
    && prior.publication === 'none' && prior.submission === 'none'
    && typeof priorDeadline === 'string' && Number.isFinite(Date.parse(priorDeadline)),
  'ROOT_ONLY_PRIOR_CYCLE_BINDING_INVALID');
  const material = admission.materialNewEvidence;
  const materialOldBase = material?.oldBaseCommit ?? material?.oldBase;
  const materialCandidateHead = material?.oldCandidateHead ?? material?.candidateHead;
  const previousWorktree = material?.cycle04Worktree ?? material?.candidateWorktree;
  const candidateWorktree = material?.cycle05Worktree ?? material?.candidateWorktree;
  const candidateBranch = material?.cycle05Branch ?? material?.candidateBranch;
  rootOnlyAssert(materialOldBase === priorOldBase && materialCandidateHead === priorCandidateHead
    && isCommit(material.currentMain) && material.oldBaseIsAncestor === true
    && material.currentMainIsAncestorOfOldCandidate === false
    && material.controllerRuns === 0 && material.controllerCycles === 0
    && material.unknownEffects === 'NONE_OBSERVED'
    && typeof previousWorktree === 'string' && typeof candidateWorktree === 'string'
    && typeof candidateBranch === 'string'
    && typeof binding?.worktree === 'string' && samePath(binding.worktree, candidateWorktree)
    && binding.branch === candidateBranch
    && !samePath(binding.worktree, previousWorktree), 'ROOT_ONLY_MATERIAL_EVIDENCE_INVALID');
  rootOnlyAssert(admission.cumulativeNoProgress?.knownOccurrences === 1
    && admission.cumulativeNoProgress?.limit === 2
    && typeof admission.cumulativeNoProgress?.knownFingerprint === 'string'
    && admission.cumulativeNoProgress.disposition?.includes('Preserve count 1 unchanged'),
  'ROOT_ONLY_NO_PROGRESS_HISTORY_INVALID');
  const caps = admission.newCycleCaps;
  rootOnlyAssert(Number.isSafeInteger(caps?.maxImplementationRepairRounds) && caps.maxImplementationRepairRounds > 0
    && Number.isSafeInteger(caps.maxSubmissionAttempts) && caps.maxSubmissionAttempts > 0
    && Number.isSafeInteger(caps.maxToolRetries) && caps.maxToolRetries >= 0
    && Number.isSafeInteger(caps.maxRunDurationMinutes) && caps.maxRunDurationMinutes > 0
    && Number.isSafeInteger(caps.maxNodeDurationMinutes) && caps.maxNodeDurationMinutes > 0
    && caps.maxNodeDurationMinutes <= caps.maxRunDurationMinutes
    && caps.deadlineAnchor === 'FIRST_WORKER_DISPATCH'
    && caps.automaticDeadlineExtension === false && caps.deadlineStarted === false,
  'ROOT_ONLY_CYCLE_CAPS_INVALID');
  rootOnlyAssert(typeof binding?.branch === 'string'
    && binding?.expectedOldBaseCommit === priorOldBase
    && binding?.expectedCandidateHeadCommit === priorCandidateHead,
  'ROOT_ONLY_CANDIDATE_BINDING_INVALID');
  return { cycleNo, prior, priorOldBase, priorCandidateHead, material, caps };
}

function validateRootOnlyTask(task, taskId) {
  rootOnlyAssert(task?.schemaVersion === 'task-readiness/v1' && task.taskId === taskId
    && typeof task.objective === 'string' && Array.isArray(task.acceptance) && Array.isArray(task.writeScope)
    && Array.isArray(task.checks) && typeof task.mandateReference === 'string', 'ROOT_ONLY_TASK_BINDING_INVALID');
}

function rootOnlyEffectSnapshot(value) {
  rootOnlyAssert(value && Array.isArray(value.activeWorkers) && Array.isArray(value.unknownEffects)
    && Array.isArray(value.unknownNodes) && Array.isArray(value.unknownOperations),
  'ROOT_ONLY_EFFECT_INSPECTION_UNAVAILABLE');
  return value;
}

async function inspectRootOnlyEffects(inspectTaskEffects, taskId, worktree) {
  if (typeof inspectTaskEffects !== 'function') throw rootOnlyError('ROOT_ONLY_EFFECT_INSPECTION_UNAVAILABLE');
  try { return rootOnlyEffectSnapshot(await inspectTaskEffects({ taskId, worktree })); }
  catch (error) {
    if (error.code === 'ROOT_ONLY_EFFECT_INSPECTION_UNAVAILABLE') throw error;
    throw rootOnlyError('ROOT_ONLY_EFFECT_INSPECTION_UNAVAILABLE');
  }
}

function assertNoUnknownRootOnlyOperations(privateRoot, attemptDir, taskId, cycleNo) {
  const names = directoryFiles(attemptDir);
  const plain = /^(?:hold|operation-intent|fetch-result|merge-intent|merge-result)-[a-f0-9]{64}\.json$/;
  const hashed = /^(?:reconciliation|receipt)-[a-f0-9]{64}-[a-f0-9]{64}\.json$/;
  if (names.some((name) => !plain.test(name) && !hashed.test(name))) throw rootOnlyError('ROOT_ONLY_UNKNOWN_ARTIFACT');
  for (const name of names.filter((item) => item.startsWith('operation-intent-'))) {
    const key = name.slice('operation-intent-'.length, -'.json'.length);
    const intent = readRootOnlyArtifact(privateRoot, attemptDir, name);
    if (!intent || intent.schemaVersion !== 'root-only-base-advanced-operation-intent/v1'
        || intent.taskId !== taskId || intent.cycleNo !== cycleNo || intent.evidenceSignature !== key) {
      throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
    }
    const fetchResult = readRootOnlyArtifact(privateRoot, attemptDir, `fetch-result-${key}.json`);
    if (!fetchResult) throw rootOnlyError('ROOT_ONLY_FETCH_OUTCOME_UNKNOWN');
    if (fetchResult.taskId !== taskId || fetchResult.cycleNo !== cycleNo
        || fetchResult.evidenceSignature !== key) throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
    const mergeIntent = readRootOnlyArtifact(privateRoot, attemptDir, `merge-intent-${key}.json`);
    if (mergeIntent) {
      if (mergeIntent.schemaVersion !== 'root-only-base-advanced-merge-intent/v1'
          || mergeIntent.taskId !== taskId || mergeIntent.cycleNo !== cycleNo
          || mergeIntent.evidenceSignature !== key) throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
      const mergeResult = readRootOnlyArtifact(privateRoot, attemptDir, `merge-result-${key}.json`);
      if (!mergeResult) throw rootOnlyError('ROOT_ONLY_MERGE_OUTCOME_UNKNOWN');
      if (mergeResult.taskId !== taskId || mergeResult.cycleNo !== cycleNo
          || mergeResult.evidenceSignature !== key) throw rootOnlyError('ROOT_ONLY_ARTIFACT_CORRUPT');
    }
  }
}

function rootOnlyParents(worktree, head) {
  const line = head && maybeGit(worktree, ['rev-list', '--parents', '-n', '1', head]);
  return line?.split(/\s+/).slice(1) ?? [];
}

function assertRootOnlyCleanObservation(observed, { branch, head, errorCode }) {
  if (observed.head !== head || observed.branch !== branch || observed.status !== ''
      || observed.unmerged !== '' || observed.mergeHead !== null) throw rootOnlyError(errorCode);
}

function isAncestor(worktree, older, newer) {
  return isCommit(older) && isCommit(newer)
    && maybeGit(worktree, ['merge-base', '--is-ancestor', older, newer]) !== null;
}

function gitOperationInProgress(worktree) {
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply']) {
    let entry;
    try { entry = git(worktree, ['rev-parse', '--git-path', name]); }
    catch { return true; }
    const absolute = path.isAbsolute(entry) ? entry : path.resolve(worktree, entry);
    if (fs.existsSync(absolute)) return true;
  }
  return false;
}

function rootOnlyReceiptFrom(result) {
  return { schemaVersion: 'root-only-base-prepared-candidate/v1', status: 'PREPARED_FOR_FRESH_CYCLE_DISPATCH',
    taskId: result.taskId, cycleNo: result.cycleNo, oldHeadCommit: result.oldHeadCommit,
    headCommit: result.headCommit, oldBaseCommit: result.oldBaseCommit, newBaseCommit: result.newBaseCommit,
    branch: result.branch, worktreeRoot: result.worktreeRoot, baseRef: result.baseRef,
    admissionSha256: result.admissionSha256, taskSha256: result.taskSha256,
    evidenceRef: result.evidenceRef, evidenceSha256: result.evidenceSha256,
    priorCycleHistory: result.priorCycleHistory, cumulativeNoProgress: result.cumulativeNoProgress,
    cycleCaps: result.cycleCaps, controllerRunCreated: false, priorCycleResumed: false,
    workerDispatched: false, verifyDispatched: false, reviewDispatched: false };
}

function makeRootOnlyReceipt({ privateRoot, attemptDir, key, resultFile, result }) {
  const receipt = rootOnlyReceiptFrom({ ...result, evidenceRef: privateReference(privateRoot, resultFile),
    evidenceSha256: createHash('sha256').update(fs.readFileSync(resultFile)).digest('hex') });
  const saved = putRootOnlyHashedArtifact(privateRoot, attemptDir, `receipt-${key}`, receipt);
  return { receipt, receiptFile: saved.file, receiptDigest: saved.sha256 };
}

function validateRootOnlyReceipt(privateRoot, attemptDir, key, resultFile, result) {
  const saved = rootOnlyHashedArtifact(privateRoot, attemptDir, `receipt-${key}-`);
  if (!saved) return null;
  const expected = rootOnlyReceiptFrom({ ...result, evidenceRef: privateReference(privateRoot, resultFile),
    evidenceSha256: createHash('sha256').update(fs.readFileSync(resultFile)).digest('hex') });
  if (!isDeepStrictEqual(saved.value, expected)) throw rootOnlyError('ROOT_ONLY_RECEIPT_CORRUPT');
  return { receipt: saved.value, receiptFile: saved.file, receiptDigest: saved.sha256 };
}

/**
 * Reconcile a newly admitted cycle when the prior paused cycle has no live
 * controller run. This path prepares a clean candidate for a fresh cycle; it
 * never creates controller state or resumes the prior cycle.
 */
export async function prepareRootOnlyBaseAdvancedCandidate({ repoRoot, privateRoot, stateRoot, binding,
  admissionFile, expectedAdmissionSha256, expectedTaskSha256, baseRef, inspectTaskEffects,
  fetchBase = fetchConfiguredBase, readRemoteBase = readConfiguredRemoteBase,
  mergeBase = ({ repo, newBaseCommit }) => git(repo, ['merge', '--no-edit', '--no-ff', newBaseCommit]) } = {}) {
  const taskId = binding?.taskId;
  if (!safeTaskId(taskId) || typeof privateRoot !== 'string') throw rootOnlyError('ROOT_ONLY_INPUT_BINDING_INVALID');
  let roots;
  try { roots = safePrivateRoots({ repoRoot, privateRoot, stateRoot, campaignId: taskId }); }
  catch { throw rootOnlyError('ROOT_ONLY_PRIVATE_ROOT_INVALID'); }
  let admissionRecord;
  let taskRecord;
  let admissionSha256;
  let taskSha256;
  let admitted;
  try {
    rootOnlyAssert(/^[a-f0-9]{64}$/i.test(expectedAdmissionSha256 ?? ''), 'ROOT_ONLY_ADMISSION_HASH_REQUIRED');
    rootOnlyAssert(/^[a-f0-9]{64}$/i.test(expectedTaskSha256 ?? ''), 'ROOT_ONLY_TASK_HASH_REQUIRED');
    admissionRecord = readPrivateJsonRecord(roots.privateRoot, admissionFile, 'evidence');
    taskRecord = readPrivateJsonRecord(roots.privateRoot, binding.taskFile, 'tasks');
    admissionSha256 = admissionRecord.sha256;
    taskSha256 = taskRecord.sha256;
    rootOnlyAssert(admissionSha256 === expectedAdmissionSha256.toLowerCase(), 'ROOT_ONLY_ADMISSION_HASH_MISMATCH');
    rootOnlyAssert(taskSha256 === expectedTaskSha256.toLowerCase(), 'ROOT_ONLY_TASK_HASH_MISMATCH');
    validateRootOnlyTask(taskRecord.value, taskId);
    admitted = validateRootOnlyAdmission(admissionRecord.value, { taskId, binding, taskFile: taskRecord.file, taskSha256,
      expectedOldBaseCommit: binding.expectedOldBaseCommit,
      expectedCandidateHeadCommit: binding.expectedCandidateHeadCommit });
    rootOnlyAssert(baseRef === 'origin/main', 'ROOT_ONLY_BASE_REF_BINDING_INVALID');
  } catch (error) {
    throw rootOnlyError(error.code ?? 'ROOT_ONLY_ADMISSION_INVALID');
  }
  const { cycleNo, material, caps } = admitted;
  const priorCycleHistory = admitted.prior;
  const prior = { ...priorCycleHistory, oldBase: admitted.priorOldBase, candidateHead: admitted.priorCandidateHead };
  const attemptDir = path.join(roots.stateRoot, 'base-advanced-root-only', `cycle-${cycleNo}`);
  try { ensurePrivateDirectory(roots.privateRoot, attemptDir); }
  catch { throw rootOnlyError('ROOT_ONLY_PRIVATE_ARTIFACT_DIRECTORY_INVALID'); }
  let activeEvidenceSignature = null;
  const hold = (code, evidence = {}, observed = null, effects = null) => rootOnlyHold({
    privateRoot: roots.privateRoot, attemptDir, taskId, cycleNo, code, evidence,
    evidenceSignature: activeEvidenceSignature ?? rootOnlyObservationKey({ taskId, cycleNo,
      admissionFile, expectedAdmissionSha256, expectedTaskSha256, binding, code, observed, effects }),
  });
  try { assertNoUnknownRootOnlyOperations(roots.privateRoot, attemptDir, taskId, cycleNo); }
  catch (error) { hold(error.code ?? 'ROOT_ONLY_UNKNOWN_OPERATION_EFFECT', { stage: 'prior-journal' }); }
  let priorHolds;
  try { priorHolds = readRootOnlyHolds(roots.privateRoot, attemptDir, taskId, cycleNo); }
  catch (error) { hold(error.code ?? 'ROOT_ONLY_ARTIFACT_CORRUPT', { stage: 'prior-hold-journal' }); }

  let worktreeRoot;
  let observed;
  try {
    rootOnlyAssert(typeof binding.worktree === 'string' && typeof binding.branch === 'string',
      'ROOT_ONLY_WORKTREE_BINDING_INVALID');
    worktreeRoot = fs.realpathSync(binding.worktree);
    rootOnlyAssert(samePath(path.resolve(binding.worktree), worktreeRoot), 'ROOT_ONLY_WORKTREE_IDENTITY_INVALID');
    const topLevel = fs.realpathSync(git(binding.worktree, ['rev-parse', '--show-toplevel']));
    const common = fs.realpathSync(git(binding.worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    rootOnlyAssert(samePath(worktreeRoot, topLevel) && samePath(roots.common, common), 'ROOT_ONLY_WORKTREE_IDENTITY_INVALID');
    rootOnlyAssert(!samePath(worktreeRoot, material.cycle04Worktree ?? material.candidateWorktree),
      'ROOT_ONLY_PRIOR_WORKTREE_REUSE_FORBIDDEN');
    git(binding.worktree, ['check-ref-format', `refs/heads/${binding.branch}`]);
    observed = worktreeObservation(binding.worktree);
    rootOnlyAssert(!gitOperationInProgress(binding.worktree), 'ROOT_ONLY_GIT_OPERATION_IN_PROGRESS');
    assertRootOnlyCleanObservation(observed, { branch: binding.branch,
      head: observed.head, errorCode: 'ROOT_ONLY_CANDIDATE_NOT_EXACT_AND_CLEAN' });
    rootOnlyAssert(isAncestor(binding.worktree, prior.oldBase, observed.head), 'ROOT_ONLY_CANDIDATE_DIVERGED');
    rootOnlyAssert(isAncestor(binding.worktree, prior.oldBase, material.currentMain), 'ROOT_ONLY_ADMITTED_BASE_INVALID');
  } catch (error) {
    hold(error.code ?? 'ROOT_ONLY_WORKTREE_IDENTITY_INVALID', { stage: 'candidate-preflight' }, observed);
  }

  let effects;
  try { effects = await inspectRootOnlyEffects(inspectTaskEffects, taskId, binding.worktree); }
  catch (error) { hold(error.code ?? 'ROOT_ONLY_EFFECT_INSPECTION_UNAVAILABLE', { stage: 'pre-fetch' }, observed); }
  const emptyEffects = effects.activeWorkers.length === 0 && effects.unknownEffects.length === 0
    && effects.unknownNodes.length === 0 && effects.unknownOperations.length === 0;
  if (!emptyEffects) hold('ROOT_ONLY_ACTIVE_OR_UNKNOWN_EFFECTS', { stage: 'pre-fetch' }, observed, effects);

  let remoteBefore;
  try { remoteBefore = await readRemoteBase({ repo: binding.worktree, baseRef }); }
  catch { hold('ROOT_ONLY_REMOTE_UNAVAILABLE_BEFORE_FETCH', { stage: 'pre-fetch' }, observed, effects); }
  if (!isCommit(remoteBefore)) hold('ROOT_ONLY_REMOTE_SHA_INVALID', { stage: 'pre-fetch', remoteBefore }, observed, effects);
  if (!isAncestor(binding.worktree, prior.oldBase, remoteBefore)
      || !isAncestor(binding.worktree, material.currentMain, remoteBefore)) {
    hold('ROOT_ONLY_ADMITTED_MOVEMENT_NOT_ANCESTOR', { stage: 'pre-fetch', remoteBefore,
      oldBaseCommit: prior.oldBase, admittedMainCommit: material.currentMain }, observed, effects);
  }

  const effectBinding = { activeWorkers: effects.activeWorkers, unknownEffects: effects.unknownEffects,
    unknownNodes: effects.unknownNodes, unknownOperations: effects.unknownOperations };
  const evidenceSignature = digest({ taskId, cycleNo, admissionSha256, taskSha256,
    oldBaseCommit: prior.oldBase, oldHeadCommit: prior.candidateHead, admittedMainCommit: material.currentMain,
    liveRemoteBeforeFetch: remoteBefore, baseRef, branch: binding.branch, worktreeRoot,
    effectBinding });
  activeEvidenceSignature = evidenceSignature;
  const matchingHold = priorHolds.find((item) => item.value.evidenceSignature === evidenceSignature);
  if (matchingHold) throw rootOnlyError(matchingHold.value.code);
  if (priorHolds.length) {
    hold('ROOT_ONLY_PRIOR_ATTEMPT_HELD', { stage: 'prior-hold', changedEvidence: true,
      priorHoldDigests: priorHolds.map((item) => item.sha256), evidenceSignature }, observed, effectBinding);
  }

  const priorMergeResult = readRootOnlyArtifact(roots.privateRoot, attemptDir,
    `merge-result-${evidenceSignature}.json`);
  if (!priorMergeResult && observed.head !== prior.candidateHead) {
    hold('ROOT_ONLY_CANDIDATE_NOT_EXACT_AND_CLEAN', { stage: 'candidate-preflight', head: observed.head }, observed, effectBinding);
  }

  const operationIntentFile = path.join(attemptDir, `operation-intent-${evidenceSignature}.json`);
  const fetchResultFile = path.join(attemptDir, `fetch-result-${evidenceSignature}.json`);
  const mergeIntentFile = path.join(attemptDir, `merge-intent-${evidenceSignature}.json`);
  const mergeResultFile = path.join(attemptDir, `merge-result-${evidenceSignature}.json`);
  let operationIntent = readRootOnlyArtifact(roots.privateRoot, attemptDir, path.basename(operationIntentFile));
  if (!operationIntent) {
    operationIntent = { schemaVersion: 'root-only-base-advanced-operation-intent/v1', taskId,
      cycleNo, evidenceSignature, admissionSha256, taskSha256,
      oldBaseCommit: prior.oldBase, oldHeadCommit: prior.candidateHead,
      admittedMainCommit: material.currentMain, liveRemoteBeforeFetch: remoteBefore,
      branch: binding.branch, worktreeRoot, baseRef,
      operation: 'fetch configured base, then git merge --no-edit --no-ff',
      effectSnapshot: effectBinding };
    try { writeRootOnlyArtifact(roots.privateRoot, operationIntentFile, operationIntent); }
    catch { hold('ROOT_ONLY_OPERATION_INTENT_WRITE_FAILED', { stage: 'before-fetch' }, observed, effectBinding); }
  }
  if (operationIntent.schemaVersion !== 'root-only-base-advanced-operation-intent/v1'
      || operationIntent.evidenceSignature !== evidenceSignature || operationIntent.taskId !== taskId
      || operationIntent.cycleNo !== cycleNo || operationIntent.admissionSha256 !== admissionSha256
      || operationIntent.taskSha256 !== taskSha256) {
    hold('ROOT_ONLY_ARTIFACT_CORRUPT', { stage: 'operation-intent' }, observed, effectBinding);
  }

  let fetchResult = readRootOnlyArtifact(roots.privateRoot, attemptDir, path.basename(fetchResultFile));
  if (!fetchResult) {
    let fetchedBaseSha;
    try { fetchedBaseSha = await fetchBase({ repo: binding.worktree, baseRef }); }
    catch { hold('ROOT_ONLY_FETCH_OUTCOME_UNKNOWN', { stage: 'fetch', evidenceSignature }, observed, effectBinding); }
    let remoteShaAfterFetch;
    try { remoteShaAfterFetch = await readRemoteBase({ repo: binding.worktree, baseRef }); }
    catch {
      const uncertain = { schemaVersion: 'root-only-base-advanced-fetch-result/v1', status: 'REMOTE_UNAVAILABLE_AFTER_FETCH',
        taskId, cycleNo, evidenceSignature, fetchedBaseSha: isCommit(fetchedBaseSha) ? fetchedBaseSha : null,
        remoteShaAfterFetch: null };
      writeRootOnlyArtifact(roots.privateRoot, fetchResultFile, uncertain);
      hold('ROOT_ONLY_REMOTE_UNCERTAIN_AFTER_FETCH', { stage: 'post-fetch', evidenceSignature }, observed, effectBinding);
    }
    const fetchStatus = isCommit(fetchedBaseSha) && isCommit(remoteShaAfterFetch)
      && fetchedBaseSha === remoteShaAfterFetch && remoteBefore === remoteShaAfterFetch
      ? 'FETCH_CONFIRMED' : 'REMOTE_MOVED_OR_FETCH_INVALID';
    fetchResult = { schemaVersion: 'root-only-base-advanced-fetch-result/v1', status: fetchStatus,
      taskId, cycleNo, evidenceSignature, fetchedBaseSha: isCommit(fetchedBaseSha) ? fetchedBaseSha : null,
      remoteShaBeforeFetch: remoteBefore, remoteShaAfterFetch: isCommit(remoteShaAfterFetch) ? remoteShaAfterFetch : null };
    try { writeRootOnlyArtifact(roots.privateRoot, fetchResultFile, fetchResult); }
    catch { hold('ROOT_ONLY_ARTIFACT_CORRUPT', { stage: 'fetch-result' }, observed, effectBinding); }
    if (fetchStatus !== 'FETCH_CONFIRMED') {
      hold('ROOT_ONLY_REMOTE_MOVED_DURING_FETCH', { stage: 'post-fetch', fetchResult }, observed, effectBinding);
    }
  }
  if (fetchResult.schemaVersion !== 'root-only-base-advanced-fetch-result/v1'
      || fetchResult.status !== 'FETCH_CONFIRMED' || fetchResult.evidenceSignature !== evidenceSignature
      || !isCommit(fetchResult.fetchedBaseSha) || fetchResult.fetchedBaseSha !== fetchResult.remoteShaAfterFetch
      || fetchResult.remoteShaBeforeFetch !== remoteBefore) {
    hold('ROOT_ONLY_PRIOR_ATTEMPT_HELD', { stage: 'fetch-result', fetchResult }, observed, effectBinding);
  }
  const newBaseCommit = fetchResult.fetchedBaseSha;
  if (newBaseCommit === prior.oldBase || !isAncestor(binding.worktree, prior.oldBase, newBaseCommit)
      || !isAncestor(binding.worktree, material.currentMain, newBaseCommit)) {
    hold('ROOT_ONLY_FETCHED_BASE_NOT_ADMITTED_DESCENDANT', { stage: 'post-fetch', newBaseCommit,
      oldBaseCommit: prior.oldBase, admittedMainCommit: material.currentMain }, observed, effectBinding);
  }

  const resultForReceipt = async (mergeResult) => {
    const reconciliation = { schemaVersion: 'root-only-base-advanced-reconciliation/v1',
      status: 'MERGED_AND_REMOTE_CONFIRMED', taskId, cycleNo,
      admissionSha256, taskSha256, baseRef, branch: binding.branch, worktreeRoot,
      oldBaseCommit: prior.oldBase, oldHeadCommit: prior.candidateHead,
      admittedMainCommit: material.currentMain, newBaseCommit, fetchedBaseSha: fetchResult.fetchedBaseSha,
      remoteShaBeforeFetch: fetchResult.remoteShaBeforeFetch, remoteShaAfterFetch: fetchResult.remoteShaAfterFetch,
      remoteShaBeforeMerge: mergeResult.remoteShaBeforeMerge, remoteShaAfterMerge: mergeResult.remoteShaAfterMerge,
      headCommit: mergeResult.headCommit, mergeParents: mergeResult.mergeParents,
      priorCycleHistory, cumulativeNoProgress: admissionRecord.value.cumulativeNoProgress,
      cycleCaps: caps, controllerRunCreated: false, priorCycleResumed: false,
      workerDispatched: false, verifyDispatched: false, reviewDispatched: false };
    let reconciliationFile;
    try {
      const saved = putRootOnlyHashedArtifact(roots.privateRoot, attemptDir,
        `reconciliation-${evidenceSignature}`, reconciliation);
      reconciliationFile = saved.file;
    } catch { hold('ROOT_ONLY_RECONCILIATION_WRITE_FAILED', { stage: 'success-receipt' }, observed, effectBinding); }
    let prepared;
    try {
      prepared = validateRootOnlyReceipt(roots.privateRoot, attemptDir, evidenceSignature, reconciliationFile, reconciliation)
        ?? makeRootOnlyReceipt({ privateRoot: roots.privateRoot, attemptDir, key: evidenceSignature,
          resultFile: reconciliationFile, result: reconciliation });
    } catch { hold('ROOT_ONLY_RECEIPT_CORRUPT', { stage: 'success-receipt' }, observed, effectBinding); }
    return { status: 'PREPARED_FOR_FRESH_CYCLE_DISPATCH', ...prepared,
      reconciliation, reconciliationFile, reconciliationDigest: createHash('sha256').update(fs.readFileSync(reconciliationFile)).digest('hex') };
  };

  let mergeResult = readRootOnlyArtifact(roots.privateRoot, attemptDir, path.basename(mergeResultFile));
  if (mergeResult) {
    const exactResult = mergeResult.schemaVersion === 'root-only-base-advanced-merge-result/v1'
      && mergeResult.status === 'MERGED_AND_REMOTE_CONFIRMED' && mergeResult.taskId === taskId
      && mergeResult.cycleNo === cycleNo && mergeResult.evidenceSignature === evidenceSignature
      && mergeResult.oldHeadCommit === prior.candidateHead && mergeResult.oldBaseCommit === prior.oldBase
      && mergeResult.newBaseCommit === newBaseCommit && mergeResult.remoteShaAfterMerge === newBaseCommit
      && Array.isArray(mergeResult.mergeParents)
      && isDeepStrictEqual(mergeResult.mergeParents, [prior.candidateHead, newBaseCommit]);
    if (!exactResult) {
      const heldCode = mergeResult.status === 'MERGE_ABORTED_CONFLICT'
        ? 'ROOT_ONLY_MERGE_CONFLICT' : 'ROOT_ONLY_PRIOR_ATTEMPT_HELD';
      hold(heldCode, { stage: 'merge-result', mergeResult }, observed, effectBinding);
    }
    let liveAfterMerge;
    try { liveAfterMerge = await readRemoteBase({ repo: binding.worktree, baseRef }); }
    catch { hold('ROOT_ONLY_REMOTE_UNCERTAIN_AFTER_MERGE', { stage: 'receipt-recovery' }, observed, effectBinding); }
    const current = worktreeObservation(binding.worktree);
    assertRootOnlyCleanObservation(current, { branch: binding.branch, head: mergeResult.headCommit,
      errorCode: 'ROOT_ONLY_MERGE_RESULT_NOT_CURRENT' });
    if (liveAfterMerge !== newBaseCommit || gitOperationInProgress(binding.worktree)
        || !isDeepStrictEqual(rootOnlyParents(binding.worktree, current.head), [prior.candidateHead, newBaseCommit])) {
      hold('ROOT_ONLY_MERGE_RESULT_NOT_CURRENT', { stage: 'receipt-recovery', liveAfterMerge }, current, effectBinding);
    }
    const savedReconciliation = rootOnlyHashedArtifact(roots.privateRoot, attemptDir, `reconciliation-${evidenceSignature}-`);
    if (savedReconciliation && (savedReconciliation.value.status !== 'MERGED_AND_REMOTE_CONFIRMED'
        || savedReconciliation.value.headCommit !== current.head
        || savedReconciliation.value.admissionSha256 !== admissionSha256
        || savedReconciliation.value.taskSha256 !== taskSha256)) {
      hold('ROOT_ONLY_RECONCILIATION_CORRUPT', { stage: 'receipt-recovery' }, current, effectBinding);
    }
    return resultForReceipt(savedReconciliation?.value ?? { ...mergeResult,
      status: 'MERGED_AND_REMOTE_CONFIRMED', headCommit: current.head,
      mergeParents: [prior.candidateHead, newBaseCommit], remoteShaBeforeMerge: mergeResult.remoteShaBeforeMerge });
  }

  let effectsBeforeMerge;
  try { effectsBeforeMerge = await inspectRootOnlyEffects(inspectTaskEffects, taskId, binding.worktree); }
  catch (error) { hold(error.code ?? 'ROOT_ONLY_EFFECT_INSPECTION_UNAVAILABLE', { stage: 'pre-merge' }, observed, effectBinding); }
  if (effectsBeforeMerge.activeWorkers.length || effectsBeforeMerge.unknownEffects.length
      || effectsBeforeMerge.unknownNodes.length || effectsBeforeMerge.unknownOperations.length) {
    hold('ROOT_ONLY_ACTIVE_OR_UNKNOWN_EFFECTS', { stage: 'pre-merge' }, observed, effectsBeforeMerge);
  }
  let remoteBeforeMerge;
  try { remoteBeforeMerge = await readRemoteBase({ repo: binding.worktree, baseRef }); }
  catch { hold('ROOT_ONLY_REMOTE_UNAVAILABLE_BEFORE_MERGE', { stage: 'pre-merge' }, observed, effectBinding); }
  if (remoteBeforeMerge !== newBaseCommit) {
    hold('ROOT_ONLY_REMOTE_MOVED_BEFORE_MERGE', { stage: 'pre-merge', remoteBeforeMerge, newBaseCommit }, observed, effectBinding);
  }
  const beforeMerge = worktreeObservation(binding.worktree);
  try {
    rootOnlyAssert(!gitOperationInProgress(binding.worktree), 'ROOT_ONLY_GIT_OPERATION_IN_PROGRESS');
    assertRootOnlyCleanObservation(beforeMerge, { branch: binding.branch,
      head: prior.candidateHead, errorCode: 'ROOT_ONLY_CANDIDATE_CHANGED_BEFORE_MERGE' });
  } catch (error) { hold(error.code ?? 'ROOT_ONLY_CANDIDATE_CHANGED_BEFORE_MERGE', { stage: 'pre-merge' }, beforeMerge, effectBinding); }

  const mergeIntent = { schemaVersion: 'root-only-base-advanced-merge-intent/v1', taskId,
    cycleNo, evidenceSignature, admissionSha256, taskSha256,
    oldBaseCommit: prior.oldBase, oldHeadCommit: prior.candidateHead, newBaseCommit,
    baseRef, branch: binding.branch, worktreeRoot, remoteShaBeforeMerge: remoteBeforeMerge,
    operation: 'git merge --no-edit --no-ff', disposition: `PREPARE_FRESH_CYCLE_${cycleNo}` };
  try { writeRootOnlyArtifact(roots.privateRoot, mergeIntentFile, mergeIntent); }
  catch { hold('ROOT_ONLY_MERGE_INTENT_WRITE_FAILED', { stage: 'before-merge' }, beforeMerge, effectBinding); }

  let mergeError = null;
  try { await mergeBase({ repo: binding.worktree, newBaseCommit }); }
  catch (error) { mergeError = error; }
  let afterMerge = worktreeObservation(binding.worktree);
  let parents = rootOnlyParents(binding.worktree, afterMerge.head);
  const exactMerge = afterMerge.branch === binding.branch && afterMerge.status === ''
    && afterMerge.unmerged === '' && afterMerge.mergeHead === null && !gitOperationInProgress(binding.worktree)
    && afterMerge.head !== prior.candidateHead && isDeepStrictEqual(parents, [prior.candidateHead, newBaseCommit]);
  if (!exactMerge && mergeError?.status === 1 && afterMerge.head === prior.candidateHead
      && afterMerge.branch === binding.branch && afterMerge.mergeHead === newBaseCommit && afterMerge.unmerged !== '') {
    try { git(binding.worktree, ['merge', '--abort']); }
    catch { hold('ROOT_ONLY_MERGE_OUTCOME_UNKNOWN', { stage: 'conflict-abort' }, afterMerge, effectBinding); }
    afterMerge = worktreeObservation(binding.worktree);
    if (afterMerge.head !== prior.candidateHead || afterMerge.branch !== binding.branch || afterMerge.status !== ''
        || afterMerge.unmerged !== '' || afterMerge.mergeHead !== null || gitOperationInProgress(binding.worktree)) {
      hold('ROOT_ONLY_MERGE_OUTCOME_UNKNOWN', { stage: 'conflict-abort' }, afterMerge, effectBinding);
    }
    mergeResult = { schemaVersion: 'root-only-base-advanced-merge-result/v1', status: 'MERGE_ABORTED_CONFLICT',
      taskId, cycleNo, evidenceSignature, oldHeadCommit: prior.candidateHead,
      oldBaseCommit: prior.oldBase, newBaseCommit, headCommit: afterMerge.head,
      mergeParents: [], ownMergeAborted: true };
    writeRootOnlyArtifact(roots.privateRoot, mergeResultFile, mergeResult);
    hold('ROOT_ONLY_MERGE_CONFLICT', { stage: 'merge', mergeResult }, afterMerge, effectBinding);
  }
  if (!exactMerge) {
    if (mergeError && afterMerge.head === prior.candidateHead && afterMerge.branch === binding.branch
        && afterMerge.status === '' && afterMerge.unmerged === '' && afterMerge.mergeHead === null
        && !gitOperationInProgress(binding.worktree)) {
      mergeResult = { schemaVersion: 'root-only-base-advanced-merge-result/v1', status: 'MERGE_FAILED_NO_EFFECT',
        taskId, cycleNo, evidenceSignature, oldHeadCommit: prior.candidateHead,
        oldBaseCommit: prior.oldBase, newBaseCommit, headCommit: afterMerge.head, mergeParents: [] };
      writeRootOnlyArtifact(roots.privateRoot, mergeResultFile, mergeResult);
      hold('ROOT_ONLY_MERGE_FAILED_NO_EFFECT', { stage: 'merge', mergeResult }, afterMerge, effectBinding);
    }
    hold('ROOT_ONLY_MERGE_OUTCOME_UNKNOWN', { stage: 'merge', returnedError: Boolean(mergeError) }, afterMerge, effectBinding);
  }

  let remoteAfterMerge;
  try { remoteAfterMerge = await readRemoteBase({ repo: binding.worktree, baseRef }); }
  catch {
    mergeResult = { schemaVersion: 'root-only-base-advanced-merge-result/v1', status: 'MERGED_REMOTE_UNCERTAIN',
      taskId, cycleNo, evidenceSignature, oldHeadCommit: prior.candidateHead,
      oldBaseCommit: prior.oldBase, newBaseCommit, headCommit: afterMerge.head, mergeParents: parents,
      remoteShaBeforeMerge: remoteBeforeMerge, remoteShaAfterMerge: null };
    writeRootOnlyArtifact(roots.privateRoot, mergeResultFile, mergeResult);
    hold('ROOT_ONLY_REMOTE_UNCERTAIN_AFTER_MERGE', { stage: 'post-merge' }, afterMerge, effectBinding);
  }
  const mergeStatus = remoteAfterMerge === newBaseCommit ? 'MERGED_AND_REMOTE_CONFIRMED' : 'MERGED_REMOTE_MOVED';
  mergeResult = { schemaVersion: 'root-only-base-advanced-merge-result/v1', status: mergeStatus,
    taskId, cycleNo, evidenceSignature, admissionSha256, taskSha256,
    oldHeadCommit: prior.candidateHead, oldBaseCommit: prior.oldBase, newBaseCommit,
    headCommit: afterMerge.head, mergeParents: parents, remoteShaBeforeMerge: remoteBeforeMerge,
    remoteShaAfterMerge: isCommit(remoteAfterMerge) ? remoteAfterMerge : null };
  try { writeRootOnlyArtifact(roots.privateRoot, mergeResultFile, mergeResult); }
  catch { hold('ROOT_ONLY_ARTIFACT_CORRUPT', { stage: 'merge-result' }, afterMerge, effectBinding); }
  if (mergeStatus !== 'MERGED_AND_REMOTE_CONFIRMED') {
    hold('ROOT_ONLY_REMOTE_MOVED_AFTER_MERGE', { stage: 'post-merge', mergeResult }, afterMerge, effectBinding);
  }
  const savedReconciliation = await resultForReceipt(mergeResult);
  return { ...savedReconciliation, mergeResultFile };
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { openDeliveryController, semanticTaskDigest } from '../delivery-control/controller.mjs';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const POLICY_SOURCE = path.join(SOURCE_ROOT, 'docs', 'architecture', 'delivery-control', 'contracts', 'model-policy.json');
const tempRoots = new Set();

afterEach(() => {
  for (const root of tempRoots) {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('zuri-delivery-controller-'));
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, shell: false, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function sha(value) {
  return semanticTaskDigest({ value });
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zuri-delivery-controller-'));
  tempRoots.add(root);
  const repoRoot = path.join(root, 'repo');
  mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init', '-b', 'controller-base']);
  git(repoRoot, ['config', 'user.name', 'Controller Test']);
  git(repoRoot, ['config', 'user.email', 'controller-test@example.invalid']);
  const policyPath = path.join(repoRoot, 'docs', 'architecture', 'delivery-control', 'contracts');
  mkdirSync(policyPath, { recursive: true });
  writeFileSync(path.join(policyPath, 'model-policy.json'), readFileSync(POLICY_SOURCE));
  git(repoRoot, ['add', 'docs/architecture/delivery-control/contracts/model-policy.json']);
  git(repoRoot, ['commit', '-m', 'test policy baseline']);
  const baseCommit = git(repoRoot, ['rev-parse', 'HEAD']);
  const databasePath = path.join(repoRoot, '.git', 'controller-test.sqlite');
  return { root, repoRoot, baseCommit, databasePath };
}

function addWorktree(repoRoot, root, baseCommit, label = 'worker') {
  const worktreeRoot = path.join(root, label);
  const branch = `codex/delivery/${label}-${path.basename(root).slice(-6)}`;
  git(repoRoot, ['worktree', 'add', '-b', branch, worktreeRoot, baseCommit]);
  return { worktreeRoot, branch };
}

function taskRecord(taskId, objective, writeScope = ['src/'], extra = {}) {
  return {
    schemaVersion: 'task-readiness/v1',
    taskId,
    objective,
    acceptance: ['The implementation satisfies its bounded acceptance criteria.'],
    writeScope,
    checks: [{ shell: false, executable: 'node', argv: ['--version'], cwd: '.' }],
    mandateReference: 'conversation://trusted-task-provenance',
    ...extra,
  };
}

function trustedBinding(repoRoot, task, domainOrFeatureKey = `test/${task.taskId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`) {
  return {
    resolvedBy: 'root',
    taskId: task.taskId,
    repositoryRoot: repoRoot,
    objective: task.objective,
    domainOrFeatureKey,
    writeScope: task.writeScope,
    sourceRef: 'conversation://trusted-task',
    authorizedEffects: ['edit the admitted local repository scope'],
    prohibitions: ['no production or external effects'],
  };
}

function preflight(task, worktreeRoot, baseCommit, { status = 'READY', dependencies = [] } = {}) {
  return {
    schemaVersion: 'task-preflight-result/v1',
    status,
    taskId: task.taskId,
    objective: task.objective,
    baseline: {
      base: baseCommit,
      baseRevision: baseCommit,
      headRevision: git(worktreeRoot, ['rev-parse', 'HEAD']),
      branch: git(worktreeRoot, ['branch', '--show-current']),
      dirty: false,
    },
    dependencies,
    issues: status === 'READY' ? [] : [{ status, code: 'DEPENDENCY_NOT_DONE' }],
    authorityGrant: false,
    mandateReferenceIsProvenanceOnly: true,
    dispatchAllowed: false,
    checksExecuted: false,
    stateWritePerformed: false,
  };
}

function successorAdmission(task, { admissionId = 'test-cycle-admission-2', admissionRecordDigest = 'a'.repeat(64),
  priorCycleNo = 1, priorCycleState = 'PAUSED', reason = 'Material evidence justifies a bounded successor cycle.',
  evidenceRef = 'test://cycle-admission-evidence', basis = 'MATERIAL_NEW_EVIDENCE' } = {}) {
  return { admissionId, admissionRecordDigest,
    taskRecordDigest: createHash('sha256').update(JSON.stringify(task)).digest('hex'),
    priorCycleNo, priorCycleState, reason, evidenceRef, materialChange: true, basis };
}

function roleResult(role, sessionId, headCommit, resultDigest) {
  return {
    role,
    verdict: 'PASS',
    headCommit,
    exactHeadCommit: headCommit,
    sessionId,
    model: 'gpt-6-luna',
    effort: 'max',
    resultDigest,
    evidenceRef: `test-evidence://${role}`,
  };
}

function dispatch(controller, taskId, nodeId, role, inputDigest = sha(nodeId)) {
  const lease = controller.claimNode({ taskId, nodeId, ownerId: `owner-${nodeId}`, leaseMs: 30_000 });
  assert.equal(lease.blocked, undefined);
  const operationId = `op-${taskId}-${nodeId}`;
  controller.recordDispatchIntent({ lease, operationId, inputDigest });
  const sessionId = `session-${taskId}-${role}`;
  controller.recordBackendHandle({ lease, sessionId, model: 'gpt-6-luna', effort: 'max', backendRef: `codex://${sessionId}` });
  return { lease, operationId, sessionId };
}

function completeWorkerCandidate(controller, task, worktreeRoot) {
  const worker = dispatch(controller, task.taskId, 'worker', 'worker');
  const scope = task.writeScope[0];
  const relativePath = scope.endsWith('/') ? `${scope}controller-candidate.mjs` : scope;
  const file = path.join(worktreeRoot, ...relativePath.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'export const candidate = true;\n');
  git(worktreeRoot, ['add', relativePath]);
  git(worktreeRoot, ['commit', '-m', `worker candidate ${task.taskId}`]);
  const headCommit = git(worktreeRoot, ['rev-parse', 'HEAD']);
  controller.completeNode({ lease: worker.lease,
    result: roleResult('worker', worker.sessionId, headCommit, sha(`worker-result-${task.taskId}`)) });
  return headCommit;
}

function integrateTask(controller, task, worktreeRoot) {
  const headCommit = completeWorkerCandidate(controller, task, worktreeRoot);
  for (const role of ['verifier', 'reviewer']) {
    const node = dispatch(controller, task.taskId, role, role);
    controller.completeNode({ lease: node.lease,
      result: roleResult(role, node.sessionId, headCommit, sha(`${role}-result-${task.taskId}`)) });
  }
  controller.recordRootIntegration({ taskId: task.taskId, headCommit, evidenceRef: `root://integration-${task.taskId}` });
  return headCommit;
}

async function staleCandidateFixture({ includeCandidate = true } = {}) {
  const env = fixture();
  const { worktreeRoot, branch } = addWorktree(env.repoRoot, env.root, env.baseCommit, 'prepared-resume');
  const task = taskRecord('TASK-PREPARED-BASE-RESUME', 'Bind a prepared base to the retained paused run.', ['src/', 'upstream.txt']);
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  controller.registerTask({ taskRecord: task, preflightResult: preflight(task, worktreeRoot, env.baseCommit), worktreeRoot,
    trustedMandateBinding: trustedBinding(env.repoRoot, task) });
  let oldHeadCommit = env.baseCommit;
  if (includeCandidate) {
    const worker = dispatch(controller, task.taskId, 'worker', 'worker');
    mkdirSync(path.join(worktreeRoot, 'src'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'src', 'candidate.mjs'), 'export const candidate = true;\n');
    git(worktreeRoot, ['add', 'src/candidate.mjs']);
    git(worktreeRoot, ['commit', '-m', 'prepared resume candidate']);
    oldHeadCommit = git(worktreeRoot, ['rev-parse', 'HEAD']);
    controller.completeNode({ lease: worker.lease, result: roleResult('worker', worker.sessionId, oldHeadCommit, sha('prepared-resume-worker')) });
  }

  writeFileSync(path.join(env.repoRoot, 'upstream.txt'), 'accepted base advance\n');
  git(env.repoRoot, ['add', 'upstream.txt']);
  git(env.repoRoot, ['commit', '-m', 'advance accepted base']);
  const newBaseCommit = git(env.repoRoot, ['rev-parse', 'HEAD']);
  git(worktreeRoot, ['merge', '--no-ff', '--no-edit', newBaseCommit]);
  const headCommit = git(worktreeRoot, ['rev-parse', 'HEAD']);
  const blocked = controller.claimNode({ taskId: task.taskId, nodeId: includeCandidate ? 'verifier' : 'worker', ownerId: 'stale-check', leaseMs: 30_000 });
  assert.equal(blocked.status, includeCandidate ? 'BLOCKED_STALE_CANDIDATE' : 'BLOCKED_STALE_BASELINE');

  const receiptRoot = path.join(env.repoRoot, '.git', 'zuri-delivery-control', 'supervisors', 'test-campaign', 'prepared');
  mkdirSync(receiptRoot, { recursive: true });
  const preparedBaseReceiptFile = path.join(receiptRoot, `${task.taskId}.json`);
  const receipt = { schemaVersion: 'root-base-prepared-candidate/v1', taskId: task.taskId, cycleNo: 1,
    oldHeadCommit, headCommit, oldBaseCommit: env.baseCommit, newBaseCommit,
    reason: 'Retain the same task cycle on the accepted newer base.', evidenceRef: 'root://prepared-base-fixture' };
  writeFileSync(preparedBaseReceiptFile, JSON.stringify(receipt));
  return { env, controller, task, worktreeRoot, branch, receipt, preparedBaseReceiptFile, oldHeadCommit, newBaseCommit, headCommit,
    pausedState: includeCandidate ? 'BLOCKED_STALE_CANDIDATE' : 'BLOCKED_STALE_BASELINE' };
}

test('runs worker, exact-head verifier, reviewer, and records root integration without claiming CI', async () => {
  const env = fixture();
  const { worktreeRoot, branch } = addWorktree(env.repoRoot, env.root, env.baseCommit);
  const task = taskRecord('TASK-CONTROLLER-PIPELINE', 'Exercise the three-stage controller pipeline.');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const registered = controller.registerTask({
      taskRecord: task,
      preflightResult: preflight(task, worktreeRoot, env.baseCommit),
      worktreeRoot,
      trustedMandateBinding: trustedBinding(env.repoRoot, task),
    });
    assert.equal(registered.state, 'WORKER_READY');
    assert.equal(registered.branch, branch);
    assert.equal(registered.taskRecordDigest, semanticTaskDigest(task));
    assert.deepEqual(controller.nextReadyNodes().map((node) => node.nodeId), ['worker']);

    const worker = dispatch(controller, task.taskId, 'worker', 'worker');
    mkdirSync(path.join(worktreeRoot, 'src'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'src', 'controller-output.mjs'), 'export const ready = true;\n');
    git(worktreeRoot, ['add', 'src/controller-output.mjs']);
    git(worktreeRoot, ['commit', '-m', 'worker candidate']);
    const candidate = git(worktreeRoot, ['rev-parse', 'HEAD']);
    controller.completeNode({ lease: worker.lease, result: roleResult('worker', worker.sessionId, candidate, sha('worker-result')) });
    assert.equal(controller.getRun(task.taskId).state, 'VERIFY_READY');
    assert.equal(controller.getRun(task.taskId).candidateHeadCommit, candidate);
    assert.deepEqual(controller.nextReadyNodes().map((node) => node.nodeId), ['verifier']);
    assert.throws(() => controller.claimNode({ taskId: task.taskId, nodeId: 'reviewer', ownerId: 'reviewer-too-early' }), /not ready to claim/);

    const verifier = dispatch(controller, task.taskId, 'verifier', 'verifier');
    assert.throws(() => controller.completeNode({
      lease: verifier.lease,
      result: roleResult('verifier', worker.sessionId, candidate, sha('wrong-session')),
    }), /distinct backend sessions|previously used by another role/i);
    controller.completeNode({ lease: verifier.lease, result: roleResult('verifier', verifier.sessionId, candidate, sha('verify-result')) });
    assert.equal(controller.getRun(task.taskId).state, 'REVIEW_READY');
    assert.deepEqual(controller.nextReadyNodes().map((node) => node.nodeId), ['reviewer']);

    const reviewer = dispatch(controller, task.taskId, 'reviewer', 'reviewer');
    controller.completeNode({ lease: reviewer.lease, result: roleResult('reviewer', reviewer.sessionId, candidate, sha('review-result')) });
    assert.equal(controller.getRun(task.taskId).state, 'ROOT_DELIVERY_READY');

    const integration = controller.recordRootIntegration({ taskId: task.taskId, headCommit: candidate, evidenceRef: 'root://integration-evidence' });
    assert.equal(integration.state, 'ROOT_INTEGRATED_PENDING_CI');
    assert.equal(integration.requiredCi, 'NOT_RECORDED_BY_CONTROLLER');
    const domainLockDb = new DatabaseSync(env.databasePath);
    assert.equal(domainLockDb.prepare('SELECT COUNT(*) AS count FROM delivery_domain_locks WHERE task_id=?').get(task.taskId).count, 0);
    assert.equal(domainLockDb.prepare('SELECT COUNT(*) AS count FROM delivery_write_locks WHERE task_id=?').get(task.taskId).count, 0);
    domainLockDb.close();
    const snapshot = controller.missionControlSnapshot([task.taskId]);
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.tasks[0].state, 'ROOT_INTEGRATED_PENDING_CI');
    assert.equal(Object.hasOwn(snapshot.tasks[0], 'taskRecord'), false);
    assert.equal(Object.hasOwn(controller.listRuns()[0], 'trustedMandate'), false);
    assert.equal(controller.verifyEventChain().count >= 10, true);
  } finally {
    controller.close();
  }
});

test('BASE_ADVANCED exact checkpoint pauses the integrated cycle, reacquires scope locks, and resumes it with retained counters', async () => {
  const env = fixture();
  const { worktreeRoot } = addWorktree(env.repoRoot, env.root, env.baseCommit, 'base-advanced-cycle');
  const task = taskRecord('TASK-BASE-ADVANCED-CYCLE', 'Resume the exact integrated cycle after a verified base advance.');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    controller.registerTask({ taskRecord: task, preflightResult: preflight(task, worktreeRoot, env.baseCommit), worktreeRoot,
      trustedMandateBinding: trustedBinding(env.repoRoot, task) });
    const worker = dispatch(controller, task.taskId, 'worker', 'worker');
    mkdirSync(path.join(worktreeRoot, 'src'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'src', 'candidate.mjs'), 'export const candidate = true;\n');
    git(worktreeRoot, ['add', 'src/candidate.mjs']); git(worktreeRoot, ['commit', '-m', 'reviewed candidate']);
    const candidate = git(worktreeRoot, ['rev-parse', 'HEAD']);
    controller.completeNode({ lease: worker.lease, result: roleResult('worker', worker.sessionId, candidate, sha('bridge-worker')) });
    const verifier = dispatch(controller, task.taskId, 'verifier', 'verifier');
    controller.completeNode({ lease: verifier.lease, result: roleResult('verifier', verifier.sessionId, candidate, sha('bridge-verifier')) });
    const reviewer = dispatch(controller, task.taskId, 'reviewer', 'reviewer');
    controller.completeNode({ lease: reviewer.lease, result: roleResult('reviewer', reviewer.sessionId, candidate, sha('bridge-reviewer')) });
    controller.recordRootIntegration({ taskId: task.taskId, headCommit: candidate, evidenceRef: 'root://bridge-integration' });
    const before = controller.getRun(task.taskId);
    const beforeCycle = before.cycles[0];

    writeFileSync(path.join(env.repoRoot, 'upstream.txt'), 'accepted upstream base advance\n');
    git(env.repoRoot, ['add', 'upstream.txt']); git(env.repoRoot, ['commit', '-m', 'advance base after review']);
    const newBase = git(env.repoRoot, ['rev-parse', 'HEAD']);
    const checkpoint = { status: 'ROOT_REPLAN_PAUSED', code: 'BASE_ADVANCED', taskId: task.taskId,
      expectedBaseCommit: env.baseCommit, actualBaseCommit: newBase, candidateHeadCommit: candidate, number: 23 };
    const disposition = controller.recordBaseAdvancedDisposition({ taskId: task.taskId, cycleNo: before.currentCycle,
      expectedBaseCommit: env.baseCommit, expectedCandidateHeadCommit: candidate, observedBaseCommit: newBase,
      checkpoint, evidenceRef: 'private://zuri-delivery-control/disposition.json',
      reason: 'The delivery root observed a newer accepted base.' });
    assert.equal(disposition.state, 'BLOCKED_STALE_CANDIDATE');
    assert.equal(controller.getRun(task.taskId).currentCycle, before.currentCycle);
    const afterDisposition = controller.getRun(task.taskId);
    assert.equal(afterDisposition.state, 'BLOCKED_STALE_CANDIDATE');
    assert.equal(afterDisposition.cycles[0].startedAt, beforeCycle.startedAt);
    assert.equal(afterDisposition.cycles[0].submissions, beforeCycle.submissions);
    assert.equal(afterDisposition.cycles[0].implementationRepairs, beforeCycle.implementationRepairs);
    assert.equal(afterDisposition.cycles[0].toolRetries, beforeCycle.toolRetries);
    const lockDb = new DatabaseSync(env.databasePath);
    const locks = lockDb.prepare('SELECT scope_path FROM delivery_write_locks WHERE task_id=? ORDER BY scope_path').all(task.taskId);
    lockDb.close();
    assert.deepEqual(locks.map((row) => row.scope_path), ['src/']);

    git(worktreeRoot, ['merge', '--no-edit', '--no-ff', newBase]);
    const mergedHead = git(worktreeRoot, ['rev-parse', 'HEAD']);
    const privateReceiptRoot = path.join(env.repoRoot, '.git', 'zuri-delivery-control', 'supervisors', 'test-campaign', 'prepared');
    mkdirSync(privateReceiptRoot, { recursive: true });
    const receiptFile = path.join(privateReceiptRoot, `${task.taskId}.json`);
    const receipt = { schemaVersion: 'root-base-prepared-candidate/v1', taskId: task.taskId,
      cycleNo: before.currentCycle, oldHeadCommit: candidate, headCommit: mergedHead,
      oldBaseCommit: env.baseCommit, newBaseCommit: newBase,
      reason: 'Root verified the exact BASE_ADVANCED checkpoint and ordinary merge.',
      evidenceRef: 'private://zuri-delivery-control/disposition.json' };
    writeFileSync(receiptFile, JSON.stringify(receipt));
    const resumed = controller.resumeTask({ taskRecord: task,
      preflightResult: preflight(task, worktreeRoot, newBase), trustedMandateBinding: trustedBinding(env.repoRoot, task),
      resumeEvidence: { reference: 'private://zuri-delivery-control/disposition.json', reason: receipt.reason },
      preparedBaseReceiptFile: receiptFile });
    assert.equal(resumed.state, 'WORKER_READY');
    assert.equal(resumed.currentCycle, before.currentCycle);
    assert.equal(resumed.baseCommit, newBase);
    assert.equal(resumed.cycles[0].startedAt, beforeCycle.startedAt);
    assert.equal(resumed.cycles[0].submissions, beforeCycle.submissions);
    assert.equal(resumed.cycles[0].implementationRepairs, beforeCycle.implementationRepairs);
    assert.equal(resumed.cycles[0].toolRetries, beforeCycle.toolRetries);
    assert.deepEqual(controller.nextReadyNodes().map((node) => node.nodeId), ['worker']);
  } finally { controller.close(); }
});

test('root disposition cannot release an active checkout or accept a late PASS after cycle expiry', async () => {
  const env = fixture();
  let clockValue = new Date();
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath, now: () => clockValue });
  try {
    const task = taskRecord('TASK-DISPOSITION-SAFETY', 'Retain scope locks until the process is stopped.');
    controller.registerTask({ taskRecord: task, preflightResult: preflight(task, env.repoRoot, env.baseCommit), trustedMandateBinding: trustedBinding(env.repoRoot, task) });
    const lease = controller.claimNode({ taskId: task.taskId, nodeId: 'worker', ownerId: 'worker', leaseMs: 30_000 });
    const disposition = () => controller.recordRootDisposition({ taskId: task.taskId, disposition: 'ABANDONED', reason: 'test', evidenceRef: 'fixture://root' });
    assert.throws(disposition, /Active leases/);
    controller.recordDispatchIntent({ lease, operationId: 'live-operation', inputDigest: semanticTaskDigest(task) });
    controller.recordBackendHandle({ lease, sessionId: 'live-worker', model: 'gpt-6-luna', effort: 'max' });
    assert.throws(disposition, /Active leases/);
    const conflict = taskRecord('TASK-SAME-CHECKOUT', 'Do not reuse the checkout.', ['other/']);
    assert.equal(controller.registerTask({ taskRecord: conflict, preflightResult: preflight(conflict, env.repoRoot, env.baseCommit), trustedMandateBinding: trustedBinding(env.repoRoot, conflict) }).state, 'BLOCKED_SCOPE');
    assert.equal(controller.getRun(task.taskId).state, 'WORKER_RUNNING');
    mkdirSync(path.join(env.repoRoot, 'src'), { recursive: true });
    writeFileSync(path.join(env.repoRoot, 'src/candidate'), 'candidate');
    git(env.repoRoot, ['add', 'src/candidate']); git(env.repoRoot, ['commit', '-m', 'candidate']);
    const head = git(env.repoRoot, ['rev-parse', 'HEAD']);
    clockValue = new Date(clockValue.getTime() + 121 * 60_000);
    controller.nextReadyNodes();
    assert.throws(() => controller.completeNode({ lease, result: roleResult('worker', 'live-worker', head, sha('late')) }), /inactive execution cycle|fencing|expired/i);
    assert.equal(controller.getRun(task.taskId).state, 'PAUSED_DEADLINE');
    assert.throws(disposition, /Unknown effects/);
  } finally { controller.close(); }
});

test('a scope escape after worker submission blocks gate dispatch instead of validating the candidate', async () => {
  const env = fixture();
  const { worktreeRoot } = addWorktree(env.repoRoot, env.root, env.baseCommit);
  const task = taskRecord('TASK-GATE-SCOPE-ESCAPE', 'Block verification after a new out-of-scope file appears.', ['src/']);
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    controller.registerTask({
      taskRecord: task,
      preflightResult: preflight(task, worktreeRoot, env.baseCommit),
      worktreeRoot,
      trustedMandateBinding: trustedBinding(env.repoRoot, task),
    });
    const worker = dispatch(controller, task.taskId, 'worker', 'worker');
    mkdirSync(path.join(worktreeRoot, 'src'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'src', 'candidate.mjs'), 'export const candidate = true;\n');
    git(worktreeRoot, ['add', 'src/candidate.mjs']);
    git(worktreeRoot, ['commit', '-m', 'scoped worker candidate']);
    const candidate = git(worktreeRoot, ['rev-parse', 'HEAD']);
    controller.completeNode({ lease: worker.lease, result: roleResult('worker', worker.sessionId, candidate, sha('scoped-result')) });

    writeFileSync(path.join(worktreeRoot, 'outside-scope.txt'), 'must block verification\n');
    const claim = controller.claimNode({ taskId: task.taskId, nodeId: 'verifier', ownerId: 'verifier-runner' });
    assert.equal(claim.blocked, true);
    assert.equal(claim.status, 'BLOCKED_SCOPE');
    assert.equal(controller.getRun(task.taskId).state, 'BLOCKED_SCOPE');
  } finally {
    controller.close();
  }
});

test('same-cycle resumes preserve dispatch and repair counters', async () => {
  const env = fixture();
  const task = taskRecord('TASK-RESUME-COUNTERS', 'Preserve cycle history through resumable reassessment.');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    controller.registerTask({ taskRecord: task, preflightResult: preflight(task, env.repoRoot, env.baseCommit), trustedMandateBinding: trustedBinding(env.repoRoot, task) });
    const first = dispatch(controller, task.taskId, 'worker', 'worker');
    controller.failNode({ lease: first.lease, failureClass: 'IMPLEMENTATION_FAILURE', effectState: 'NONE', evidence: { reference: 'test://implementation-failure' } });
    const second = dispatch(controller, task.taskId, 'worker', 'worker');
    controller.failNode({ lease: second.lease, failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE', evidence: { reference: 'test://external-blocker' } });
    const before = controller.getRun(task.taskId).stages[0];
    assert.equal(before.attempt, 2);
    assert.equal(before.repairRound, 1);

    const resumed = controller.resumeTask({
      taskRecord: task,
      preflightResult: preflight(task, env.repoRoot, env.baseCommit),
      trustedMandateBinding: trustedBinding(env.repoRoot, task),
      resumeEvidence: { reference: 'test://external-clear', reason: 'The external blocker was cleared.' },
    });
    assert.equal(resumed.stages[0].attempt, 2);
    assert.equal(resumed.stages[0].repairRound, 1);
    assert.equal(resumed.cycles[0].submissions, 2);
    assert.equal(resumed.cycles[0].implementationRepairs, 1);
  } finally {
    controller.close();
  }
});

test('prepared-base resume binds the retained candidate and base transactionally and records receipt evidence', async () => {
  const f = await staleCandidateFixture();
  try {
    const before = f.controller.getRun(f.task.taskId);
    assert.equal(before.state, 'BLOCKED_STALE_CANDIDATE');
    assert.equal(before.candidateHeadCommit, f.oldHeadCommit);
    assert.equal(before.baseCommit, f.receipt.oldBaseCommit);
    const preflightResult = preflight(f.task, f.worktreeRoot, f.newBaseCommit);
    const resumed = f.controller.resumeTask({ taskRecord: f.task, preflightResult,
      trustedMandateBinding: trustedBinding(f.env.repoRoot, f.task),
      resumeEvidence: { reference: 'root://prepared-base-fixture', reason: f.receipt.reason },
      preparedBaseReceiptFile: f.preparedBaseReceiptFile });
    assert.equal(resumed.taskId, f.task.taskId);
    assert.equal(resumed.state, 'WORKER_READY');
    assert.equal(resumed.currentCycle, before.currentCycle);
    assert.equal(resumed.baseCommit, f.newBaseCommit);
    assert.equal(resumed.cycles[0].submissions, before.cycles[0].submissions);
    assert.equal(resumed.cycles[0].implementationRepairs, before.cycles[0].implementationRepairs);
    assert.equal(resumed.cycles[0].toolRetries, before.cycles[0].toolRetries);
    assert.equal(resumed.stages[0].attempt, before.stages[0].attempt);
    const readyWorker = f.controller.nextReadyNodes()[0];
    assert.equal(readyWorker.nodeId, 'worker');
    assert.equal(readyWorker.expectedLaunchHeadCommit, f.receipt.headCommit);

    const eventDb = new DatabaseSync(f.env.databasePath);
    const event = eventDb.prepare("SELECT payload_json FROM delivery_events WHERE task_id=? AND event_type='TASK_RESUMED' ORDER BY sequence DESC LIMIT 1").get(f.task.taskId);
    eventDb.close();
    const evidence = JSON.parse(event.payload_json).preparedBaseResume;
    assert.deepEqual(resumed.preparedBaseResume, evidence);
    assert.deepEqual(f.controller.getRun(f.task.taskId).preparedBaseResume, evidence);
    assert.equal(evidence.taskId, f.task.taskId);
    assert.equal(evidence.oldHeadCommit, f.oldHeadCommit);
    assert.equal(evidence.oldBaseCommit, f.receipt.oldBaseCommit);
    assert.equal(evidence.newBaseCommit, f.newBaseCommit);
    assert.equal(evidence.headCommit, f.headCommit);
    assert.equal(evidence.ancestryVerified, true);
    assert.equal(evidence.receiptDigest, createHash('sha256').update(readFileSync(f.preparedBaseReceiptFile)).digest('hex'));
    assert.equal(evidence.receiptPath, `supervisors/test-campaign/prepared/${f.task.taskId}.json`);
  } finally { f.controller.close(); }
});

test('prepared-base resume binds the original admitted head when the baseline changed before a candidate existed', async () => {
  const f = await staleCandidateFixture({ includeCandidate: false });
  try {
    const before = f.controller.getRun(f.task.taskId);
    assert.equal(before.state, 'BLOCKED_STALE_BASELINE');
    assert.equal(before.candidateHeadCommit, null);
    assert.equal(f.receipt.oldHeadCommit, before.initialHeadCommit);
    const resumed = f.controller.resumeTask({ taskRecord: f.task,
      preflightResult: preflight(f.task, f.worktreeRoot, f.newBaseCommit),
      trustedMandateBinding: trustedBinding(f.env.repoRoot, f.task),
      resumeEvidence: { reference: 'root://prepared-base-fixture', reason: f.receipt.reason },
      preparedBaseReceiptFile: f.preparedBaseReceiptFile });
    assert.equal(resumed.state, 'WORKER_READY');
    assert.equal(resumed.taskId, f.task.taskId);
    assert.equal(resumed.currentCycle, before.currentCycle);
    assert.equal(resumed.cycles[0].submissions, before.cycles[0].submissions);
    const readyWorker = f.controller.nextReadyNodes()[0];
    assert.equal(readyWorker.nodeId, 'worker');
    assert.equal(readyWorker.expectedLaunchHeadCommit, f.receipt.headCommit);
  } finally { f.controller.close(); }
});

test('missing or mismatched prepared-base receipts leave paused run, locks, counters, and events unchanged', async (t) => {
  for (const mismatch of ['missing', 'old candidate', 'old base', 'cycle']) {
    await t.test(mismatch, async () => {
      const f = await staleCandidateFixture();
      try {
        const before = f.controller.getRun(f.task.taskId);
        const eventCount = f.controller.verifyEventChain().count;
        const eventDb = new DatabaseSync(f.env.databasePath);
        const lockCount = eventDb.prepare('SELECT COUNT(*) AS count FROM delivery_write_locks WHERE task_id=?').get(f.task.taskId).count;
        eventDb.close();
        if (mismatch !== 'missing') {
          const wrong = { ...f.receipt,
            ...(mismatch === 'old candidate' ? { oldHeadCommit: f.receipt.oldBaseCommit }
              : mismatch === 'old base' ? { oldBaseCommit: f.receipt.oldHeadCommit } : { cycleNo: f.receipt.cycleNo + 1 }) };
          writeFileSync(f.preparedBaseReceiptFile, JSON.stringify(wrong));
        }
        assert.throws(() => f.controller.resumeTask({ taskRecord: f.task,
          preflightResult: preflight(f.task, f.worktreeRoot, f.newBaseCommit),
          trustedMandateBinding: trustedBinding(f.env.repoRoot, f.task),
          resumeEvidence: { reference: 'root://prepared-base-fixture', reason: 'Invalid receipt test.' },
          preparedBaseReceiptFile: mismatch === 'missing'
            ? path.join(path.dirname(f.preparedBaseReceiptFile), `${f.task.taskId}-cycle-${f.receipt.cycleNo}-${createHash('sha256').update(JSON.stringify(f.receipt)).digest('hex')}.json`)
            : f.preparedBaseReceiptFile }),
        /PREPARED_BASE_RECEIPT_(REQUIRED|MISSING|OLD_RUN_MISMATCH|SCHEMA_INVALID)/);
        assert.deepEqual(f.controller.getRun(f.task.taskId), before);
        assert.deepEqual(f.controller.nextReadyNodes(), []);
        assert.equal(f.controller.verifyEventChain().count, eventCount);
        const lockDb = new DatabaseSync(f.env.databasePath);
        assert.equal(lockDb.prepare('SELECT COUNT(*) AS count FROM delivery_write_locks WHERE task_id=?').get(f.task.taskId).count, lockCount);
        lockDb.close();
      } finally { f.controller.close(); }
    });
  }
});

test('controller rejects a prepared directory symlink before reading or resuming', async () => {
  const f = await staleCandidateFixture();
  try {
    const before = f.controller.getRun(f.task.taskId);
    const eventCount = f.controller.verifyEventChain().count;
    const prepared = path.dirname(f.preparedBaseReceiptFile);
    const redirected = path.join(f.env.repoRoot, '.git', 'redirected-prepared-controller');
    mkdirSync(redirected, { recursive: true });
    rmSync(prepared, { recursive: true, force: true });
    symlinkSync(redirected, prepared, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => f.controller.resumeTask({ taskRecord: f.task,
      preflightResult: preflight(f.task, f.worktreeRoot, f.newBaseCommit),
      trustedMandateBinding: trustedBinding(f.env.repoRoot, f.task),
      resumeEvidence: { reference: 'root://prepared-base-fixture', reason: 'Reject redirected receipt directory.' },
      preparedBaseReceiptFile: f.preparedBaseReceiptFile }), /PREPARED_BASE_RECEIPT_PATH_REDIRECTED/);
    assert.deepEqual(f.controller.getRun(f.task.taskId), before);
    assert.deepEqual(f.controller.nextReadyNodes(), []);
    assert.equal(f.controller.verifyEventChain().count, eventCount);
  } finally { f.controller.close(); }
});

test('persists dependency blocks, permits corrected acceptance evidence, and releases path locks only by root disposition', async () => {
  const env = fixture();
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const dependencyTask = taskRecord('TASK-DEPENDENT', 'Wait for its accepted prerequisite.');
    const blocked = controller.registerTask({
      taskRecord: dependencyTask,
      preflightResult: preflight(dependencyTask, env.repoRoot, env.baseCommit, {
        status: 'BLOCKED_DEPENDENCY',
        dependencies: [{ taskId: 'TASK-PREREQUISITE', roadmapStatus: 'IN_PROGRESS', accepted: false, roadmapEvidence: null }],
      }),
      trustedMandateBinding: trustedBinding(env.repoRoot, dependencyTask),
    });
    assert.equal(blocked.state, 'BLOCKED_DEPENDENCY');
    assert.equal(blocked.currentCycle, 0);
    assert.deepEqual(controller.nextReadyNodes(), []);

    const acceptedPreflight = preflight(dependencyTask, env.repoRoot, env.baseCommit, {
      dependencies: [{ taskId: 'TASK-PREREQUISITE', roadmapStatus: 'DONE', accepted: true, roadmapEvidence: { row: 'TASK-PREREQUISITE', evidence: 'accepted revision' } }],
    });
    const ready = controller.registerTask({ taskRecord: dependencyTask, preflightResult: acceptedPreflight, trustedMandateBinding: trustedBinding(env.repoRoot, dependencyTask) });
    assert.equal(ready.state, 'WORKER_READY');
    assert.equal(ready.currentCycle, 1);

    const conflictTask = taskRecord('TASK-CONFLICT', 'Wait until the shared paths are released.');
    const conflict = controller.registerTask({
      taskRecord: conflictTask,
      preflightResult: preflight(conflictTask, env.repoRoot, env.baseCommit),
      trustedMandateBinding: trustedBinding(env.repoRoot, conflictTask),
    });
    assert.equal(conflict.state, 'BLOCKED_SCOPE');
    assert.equal(conflict.currentCycle, 0);
    assert.deepEqual(controller.nextReadyNodes().map((item) => item.taskId), [dependencyTask.taskId]);

    controller.recordRootDisposition({ taskId: dependencyTask.taskId, disposition: 'ABANDONED', evidenceRef: 'root://disposition', reason: 'Fixture released its held scope.' });
    const resumed = controller.registerTask({
      taskRecord: conflictTask,
      preflightResult: preflight(conflictTask, env.repoRoot, env.baseCommit),
      trustedMandateBinding: trustedBinding(env.repoRoot, conflictTask),
    });
    assert.equal(resumed.state, 'WORKER_READY');
    assert.equal(controller.nextReadyNodes()[0].taskId, conflictTask.taskId);
  } finally {
    controller.close();
  }
});

test('root-bound semantic keys reject same-key tasks across disjoint scopes and stay locked through pause and resume', async () => {
  const env = fixture();
  const worktrees = ['semantic-a', 'semantic-b', 'semantic-c'].map((label) => addWorktree(env.repoRoot, env.root, env.baseCommit, label));
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const key = 'delivery-control/workflow-dag-safe-parallel';
    const first = taskRecord('TASK-SEMANTIC-A', 'Hold one semantic delivery domain.', ['src/semantic-a.txt'], {
      domainOrFeatureKey: 'task-prose/untrusted-a',
    });
    const firstBinding = trustedBinding(env.repoRoot, first, ' Delivery Control/Workflow Dag Safe Parallel ');
    const admitted = controller.registerTask({ taskRecord: first, worktreeRoot: worktrees[0].worktreeRoot,
      preflightResult: preflight(first, worktrees[0].worktreeRoot, env.baseCommit), trustedMandateBinding: firstBinding });
    assert.equal(admitted.state, 'WORKER_READY');
    assert.equal(admitted.trustedMandateBinding.domainOrFeatureKey, key);

    const sameKey = taskRecord('TASK-SEMANTIC-B', 'Use the same semantic delivery domain.', ['src/semantic-b.txt'], {
      domainOrFeatureKey: 'task-prose/a-different-key',
    });
    const sameKeyBinding = trustedBinding(env.repoRoot, sameKey, key.toUpperCase());
    const rejected = controller.registerTask({ taskRecord: sameKey, worktreeRoot: worktrees[1].worktreeRoot,
      preflightResult: preflight(sameKey, worktrees[1].worktreeRoot, env.baseCommit), trustedMandateBinding: sameKeyBinding });
    assert.equal(rejected.state, 'BLOCKED_SCOPE');
    assert.equal(rejected.currentCycle, 0);
    assert.equal(rejected.trustedMandateBinding.domainOrFeatureKey, key);
    assert.equal(rejected.blockers[0].code, 'BLOCKED_SCOPE');
    assert.doesNotThrow(() => controller.verifyEventChain());

    const differentKey = taskRecord('TASK-SEMANTIC-C', 'Use an independent semantic key.', ['src/semantic-c.txt'], {
      domainOrFeatureKey: key,
    });
    const separate = controller.registerTask({ taskRecord: differentKey, worktreeRoot: worktrees[2].worktreeRoot,
      preflightResult: preflight(differentKey, worktrees[2].worktreeRoot, env.baseCommit),
      trustedMandateBinding: trustedBinding(env.repoRoot, differentKey, 'delivery-control/independent-feature') });
    assert.equal(separate.state, 'WORKER_READY');
    assert.equal(separate.trustedMandateBinding.domainOrFeatureKey, 'delivery-control/independent-feature');

    const worker = dispatch(controller, first.taskId, 'worker', 'worker');
    controller.failNode({ lease: worker.lease, failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE',
      evidence: { reference: 'test://pause-before-resume' } });
    controller.recordRootDisposition({ taskId: first.taskId, disposition: 'YIELD_REASSESS',
      evidenceRef: 'test://semantic-pause', reason: 'Pause while preserving the semantic lock.' });
    const beforeResume = controller.getRun(first.taskId);
    const beforeCycle = beforeResume.cycles[0];
    const beforeNoProgress = beforeResume.noProgress;
    const domainLockDb = new DatabaseSync(env.databasePath);
    assert.equal(domainLockDb.prepare('SELECT domain_or_feature_key FROM delivery_domain_locks WHERE task_id=?').get(first.taskId).domain_or_feature_key, key);
    domainLockDb.close();
    const stillRejected = controller.registerTask({ taskRecord: sameKey, worktreeRoot: worktrees[1].worktreeRoot,
      preflightResult: preflight(sameKey, worktrees[1].worktreeRoot, env.baseCommit), trustedMandateBinding: sameKeyBinding });
    assert.equal(stillRejected.state, 'BLOCKED_SCOPE');

    const resumed = controller.resumeTask({ taskRecord: first,
      preflightResult: preflight(first, worktrees[0].worktreeRoot, env.baseCommit), trustedMandateBinding: firstBinding,
      resumeEvidence: { reference: 'test://semantic-resume', reason: 'Resume in the same execution cycle.' } });
    assert.equal(resumed.state, 'WORKER_READY');
    assert.equal(resumed.currentCycle, beforeResume.currentCycle);
    assert.equal(resumed.cycles[0].startedAt, beforeCycle.startedAt);
    assert.equal(resumed.cycles[0].submissions, beforeCycle.submissions);
    assert.equal(resumed.cycles[0].implementationRepairs, beforeCycle.implementationRepairs);
    assert.equal(resumed.cycles[0].toolRetries, beforeCycle.toolRetries);
    assert.equal(resumed.trustedMandateBinding.domainOrFeatureKey, key);

    controller.recordRootDisposition({ taskId: first.taskId, disposition: 'BLOCKED',
      evidenceRef: 'test://semantic-cycle-pause', reason: 'Pause before admitting a material new cycle.' });
    const pausedLockDb = new DatabaseSync(env.databasePath);
    assert.equal(pausedLockDb.prepare('SELECT domain_or_feature_key FROM delivery_domain_locks WHERE task_id=?').get(first.taskId).domain_or_feature_key, key);
    pausedLockDb.close();
    const admission = successorAdmission(first);
    const campaignId = 'campaign-semantic-cycle-admission';
    const campaignTaskIds = [first.taskId];
    const campaignDurationMinutes = 120;
    const dispatchHistory = controller.inspectCampaignDispatchHistory({ taskIds: campaignTaskIds });
    const campaignDeadlineAt = new Date(Date.parse(dispatchHistory.earliestWorkerIntentAt)
      + campaignDurationMinutes * 60_000).toISOString();
    const preflightLockEpoch = controller.inspectCycleAdmissionConflicts({ taskId: first.taskId, writeScope: first.writeScope }).lockEpoch;
    const unchangedRun = controller.getRun(first.taskId);
    const eventCountBeforeEpochMismatch = controller.verifyEventChain().count;
    const epochRaceDb = new DatabaseSync(env.databasePath);
    try {
      const originalScope = epochRaceDb.prepare('SELECT scope_path FROM delivery_write_locks WHERE task_id=?').get(first.taskId).scope_path;
      epochRaceDb.prepare('UPDATE delivery_write_locks SET scope_path=? WHERE task_id=?').run('src/transient-epoch-race/', first.taskId);
      epochRaceDb.prepare('UPDATE delivery_write_locks SET scope_path=? WHERE task_id=?').run(originalScope, first.taskId);
    } finally { epochRaceDb.close(); }
    assert.throws(() => controller.admitCycle({ taskId: first.taskId, taskRecord: first,
      preflightResult: preflight(first, worktrees[0].worktreeRoot, env.baseCommit), trustedMandateBinding: firstBinding,
      admission, campaignId, campaignDeadlineAt, campaignDeadlineBoundAt: campaignDeadlineAt, campaignTaskIds, campaignDurationMinutes,
      expectedResourceLockEpoch: preflightLockEpoch }), /Resource-lock epoch changed/);
    assert.deepEqual(controller.getRun(first.taskId), unchangedRun);
    assert.equal(controller.verifyEventChain().count, eventCountBeforeEpochMismatch);
    const currentLockEpoch = controller.inspectCycleAdmissionConflicts({ taskId: first.taskId, writeScope: first.writeScope }).lockEpoch;
    const nextCycle = controller.admitCycle({ taskId: first.taskId, taskRecord: first,
      preflightResult: preflight(first, worktrees[0].worktreeRoot, env.baseCommit), trustedMandateBinding: firstBinding,
      admission, campaignId, campaignDeadlineAt, campaignDeadlineBoundAt: campaignDeadlineAt, campaignTaskIds, campaignDurationMinutes,
      expectedResourceLockEpoch: currentLockEpoch });
    assert.equal(nextCycle.currentCycle, 2);
    assert.equal(nextCycle.cycles[0].submissions, beforeCycle.submissions);
    assert.equal(nextCycle.cycles[0].startedAt, beforeCycle.startedAt);
    assert.equal(nextCycle.cycles[1].submissions, 0);
    assert.equal(nextCycle.cycles[1].admission.admissionId, admission.admissionId);
    assert.deepEqual(nextCycle.noProgress, beforeNoProgress);
    const replayedCycle = controller.admitCycle({ taskId: first.taskId, taskRecord: first,
      preflightResult: preflight(first, worktrees[0].worktreeRoot, env.baseCommit), trustedMandateBinding: firstBinding,
      admission, campaignId, campaignDeadlineAt, campaignDeadlineBoundAt: campaignDeadlineAt, campaignTaskIds, campaignDurationMinutes });
    assert.equal(replayedCycle.currentCycle, 2);
    assert.equal(replayedCycle.cycles.length, 2);
    assert.equal(replayedCycle.cycles[0].submissions, beforeCycle.submissions);
    assert.equal(replayedCycle.cycles[1].submissions, 0);
    assert.throws(() => controller.admitCycle({ taskId: first.taskId, taskRecord: first,
      preflightResult: preflight(first, worktrees[0].worktreeRoot, env.baseCommit), trustedMandateBinding: firstBinding,
      admission: { ...admission, reason: 'Altered content reuses the same immutable admission identifier.' },
      campaignId, campaignDeadlineAt, campaignDeadlineBoundAt: campaignDeadlineAt, campaignTaskIds, campaignDurationMinutes }),
    /already bound to conflicting lineage or evidence/);
    const nextCycleLockDb = new DatabaseSync(env.databasePath);
    assert.equal(nextCycleLockDb.prepare('SELECT domain_or_feature_key FROM delivery_domain_locks WHERE task_id=?').get(first.taskId).domain_or_feature_key, key);
    nextCycleLockDb.close();

    controller.recordRootDisposition({ taskId: first.taskId, disposition: 'ABANDONED',
      evidenceRef: 'test://semantic-terminal', reason: 'Terminally close the fixture task.' });
    const available = controller.registerTask({ taskRecord: sameKey, worktreeRoot: worktrees[1].worktreeRoot,
      preflightResult: preflight(sameKey, worktrees[1].worktreeRoot, env.baseCommit), trustedMandateBinding: sameKeyBinding });
    assert.equal(available.state, 'WORKER_READY');
  } finally {
    controller.close();
  }
});

test('cycle-admission conflict inspection returns current worktree, scope, and domain locks without writes', async () => {
  const env = fixture();
  const targetTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'cycle-lock-target');
  const otherTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'cycle-lock-other');
  const target = taskRecord('TASK-CYCLE-LOCK-TARGET', 'Inspect resource conflicts before cycle reassessment.', ['src/']);
  const other = taskRecord('TASK-CYCLE-LOCK-OTHER', 'Hold conflicting resource locks for inspection.', ['other/']);
  const targetBinding = trustedBinding(env.repoRoot, target, 'delivery-control/cycle-lock-target');
  const otherBinding = trustedBinding(env.repoRoot, other, 'delivery-control/cycle-lock-other');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    controller.registerTask({ taskRecord: target, worktreeRoot: targetTree.worktreeRoot,
      preflightResult: preflight(target, targetTree.worktreeRoot, env.baseCommit), trustedMandateBinding: targetBinding });
    controller.registerTask({ taskRecord: other, worktreeRoot: otherTree.worktreeRoot,
      preflightResult: preflight(other, otherTree.worktreeRoot, env.baseCommit), trustedMandateBinding: otherBinding });
    const initialEpoch = BigInt(controller.inspectCycleAdmissionConflicts({ taskId: target.taskId, writeScope: target.writeScope }).lockEpoch);

    const database = new DatabaseSync(env.databasePath);
    try {
      database.prepare('UPDATE delivery_runs SET worktree_root=? WHERE task_id=?').run(targetTree.worktreeRoot, other.taskId);
      database.prepare('UPDATE delivery_write_locks SET scope_path=? WHERE task_id=?').run('src/shared/', other.taskId);
      database.prepare('DELETE FROM delivery_domain_locks WHERE task_id=?').run(other.taskId);
      database.prepare('UPDATE delivery_domain_locks SET task_id=? WHERE task_id=?').run(other.taskId, target.taskId);
    } finally { database.close(); }

    const readLocks = () => {
      const db = new DatabaseSync(env.databasePath);
      try {
        return {
          write: db.prepare('SELECT task_id,scope_path FROM delivery_write_locks ORDER BY task_id,scope_path').all(),
          domain: db.prepare('SELECT domain_or_feature_key,task_id FROM delivery_domain_locks ORDER BY domain_or_feature_key').all(),
          lockEpoch: db.prepare("SELECT value FROM controller_meta WHERE key='resourceLockEpoch'").get().value,
          runs: db.prepare('SELECT task_id,worktree_root,state,current_cycle,updated_at FROM delivery_runs ORDER BY task_id').all(),
        };
      } finally { db.close(); }
    };
    const before = readLocks();
    const snapshot = controller.inspectCycleAdmissionConflicts({ taskId: target.taskId, writeScope: target.writeScope });
    assert.ok(BigInt(snapshot.lockEpoch) > initialEpoch);
    assert.match(snapshot.lockEpoch, /^\d+$/);
    assert.deepEqual(snapshot, { taskId: target.taskId, runFound: true, lockEpoch: snapshot.lockEpoch,
      worktree: [{ taskId: other.taskId, worktreeRoot: targetTree.worktreeRoot }],
      writeScope: [{ taskId: other.taskId, scope: 'src/shared/', requested: 'src/' }],
      domain: [{ taskId: other.taskId, domainOrFeatureKey: targetBinding.domainOrFeatureKey }] });
    assert.deepEqual(controller.inspectCycleAdmissionConflicts({ taskId: target.taskId, writeScope: target.writeScope }), snapshot);
    assert.equal(readLocks().lockEpoch, snapshot.lockEpoch);
    assert.deepEqual(readLocks(), before);
  } finally {
    controller.close();
  }
});

test('successor-cycle admission rejects active, mismatched, stale, rebound, and unknown-effect predecessors', async () => {
  const env = fixture();
  const tree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'unsafe-cycle-admission');
  const task = taskRecord('TASK-UNSAFE-CYCLE-ADMISSION', 'Reject an unsafe successor-cycle admission.');
  const binding = trustedBinding(env.repoRoot, task, 'delivery-control/unsafe-cycle-admission');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    controller.registerTask({ taskRecord: task, worktreeRoot: tree.worktreeRoot,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding });
    const admission = successorAdmission(task);
    const cycleInput = (overrides = {}) => ({ taskId: task.taskId, taskRecord: task,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding,
      campaignId: 'campaign-unsafe-cycle-admission', campaignTaskIds: [task.taskId], campaignDurationMinutes: 120,
      admission: { ...admission, ...overrides } });

    assert.throws(() => controller.admitCycle(cycleInput()), /predecessor number or state/);
    controller.recordRootDisposition({ taskId: task.taskId, disposition: 'BLOCKED',
      evidenceRef: 'test://unsafe-cycle-pause', reason: 'Pause before checking successor admission guards.' });
    assert.throws(() => controller.admitCycle(cycleInput({ priorCycleNo: 2 })), /predecessor number or state/);
    const inconsistentDb = new DatabaseSync(env.databasePath);
    try {
      inconsistentDb.prepare("UPDATE delivery_runs SET state='ROOT_INTEGRATED_PENDING_CI' WHERE task_id=?").run(task.taskId);
      assert.throws(() => controller.admitCycle(cycleInput()), /Controller run state is not paused/);
      inconsistentDb.prepare("UPDATE delivery_runs SET state='BLOCKED_BY_ROOT' WHERE task_id=?").run(task.taskId);
    } finally { inconsistentDb.close(); }
    assert.throws(() => controller.admitCycle({ ...cycleInput(), trustedMandateBinding: trustedBinding(env.repoRoot, task,
      'delivery-control/different-domain') }), /domainOrFeatureKey does not match/);

    const stalePreflight = preflight(task, tree.worktreeRoot, env.baseCommit);
    stalePreflight.baseline.headRevision = 'f'.repeat(40);
    assert.throws(() => controller.admitCycle({ ...cycleInput(), preflightResult: stalePreflight }), /baseline or scope is stale/);

    const unknownDb = new DatabaseSync(env.databasePath);
    const updated = unknownDb.prepare("UPDATE delivery_nodes SET effect_state='UNKNOWN' WHERE task_id=? AND node_id='worker'")
      .run(task.taskId);
    assert.equal(updated.changes, 1);
    unknownDb.close();
    assert.throws(() => controller.admitCycle(cycleInput()), /Unknown effects must be reconciled/);
    assert.throws(() => controller.admitCycle({ taskId: task.taskId, taskRecord: task,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding,
      campaignId: 'campaign-unsafe-cycle-admission', campaignTaskIds: [task.taskId], campaignDurationMinutes: 120,
      admission: { ...admission, admissionId: undefined } }), /validated immutable root admission record/);
  } finally {
    controller.close();
  }
});

test('successor-cycle admission rejects missing execution history without changing persisted history', async () => {
  const env = fixture();
  const tree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'missing-cycle-history');
  const task = taskRecord('TASK-MISSING-CYCLE-HISTORY', 'Reject successor admission when controller history has a missing cycle row.');
  const binding = trustedBinding(env.repoRoot, task, 'delivery-control/missing-cycle-history');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    controller.registerTask({ taskRecord: task, worktreeRoot: tree.worktreeRoot,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding });
    const worker = dispatch(controller, task.taskId, 'worker', 'worker');
    controller.failNode({ lease: worker.lease, failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE',
      evidence: { reference: 'test://missing-cycle-history-pause' } });
    controller.recordRootDisposition({ taskId: task.taskId, disposition: 'BLOCKED',
      evidenceRef: 'test://missing-cycle-history-pause', reason: 'Pause an eligible predecessor before checking persisted cycle history.' });
    const campaignTaskIds = [task.taskId];
    const campaignDurationMinutes = 120;
    const campaignId = 'campaign-missing-cycle-history';
    const dispatchHistory = controller.inspectCampaignDispatchHistory({ taskIds: campaignTaskIds });
    const campaignDeadlineAt = new Date(Date.parse(dispatchHistory.earliestWorkerIntentAt)
      + campaignDurationMinutes * 60_000).toISOString();

    const database = new DatabaseSync(env.databasePath);
    let before;
    try {
      before = {
        cycles: database.prepare(`SELECT cycle_no,state,admitted_at,admission_reason,admission_evidence_json,started_at,paused_at,
          submissions,implementation_repairs,tool_retries FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no`).all(task.taskId),
        nodes: database.prepare(`SELECT node_id,state,attempt,effect_state,dispatch_operation_id,dispatch_input_digest
          FROM delivery_nodes WHERE task_id=? ORDER BY cycle_no,node_id`).all(task.taskId),
        eventCount: database.prepare('SELECT COUNT(*) AS count FROM delivery_events WHERE task_id=?').get(task.taskId).count,
      };
      assert.equal(before.cycles.length, 1);
      assert.equal(before.cycles[0].state, 'PAUSED');
      assert.equal(before.cycles[0].submissions, 1);
      database.prepare('UPDATE delivery_runs SET current_cycle=2 WHERE task_id=?').run(task.taskId);
    } finally { database.close(); }

    const admission = successorAdmission(task);
    assert.throws(() => controller.admitCycle({ taskId: task.taskId, taskRecord: task,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding, admission,
      campaignId, campaignDeadlineAt, campaignDeadlineBoundAt: campaignDeadlineAt,
      campaignTaskIds, campaignDurationMinutes }),
    /Campaign dispatch history is incomplete/);

    const afterRun = controller.getRun(task.taskId);
    assert.equal(afterRun.currentCycle, 2);
    assert.equal(afterRun.state, 'BLOCKED_BY_ROOT');
    assert.equal(afterRun.cycles.length, 1);
    assert.equal(afterRun.cycles[0].submissions, before.cycles[0].submissions);
    assert.equal(afterRun.cycles[0].implementationRepairs, before.cycles[0].implementation_repairs);
    assert.equal(afterRun.cycles[0].toolRetries, before.cycles[0].tool_retries);
    const afterDb = new DatabaseSync(env.databasePath);
    try {
      const after = {
        cycles: afterDb.prepare(`SELECT cycle_no,state,admitted_at,admission_reason,admission_evidence_json,started_at,paused_at,
          submissions,implementation_repairs,tool_retries FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no`).all(task.taskId),
        nodes: afterDb.prepare(`SELECT node_id,state,attempt,effect_state,dispatch_operation_id,dispatch_input_digest
          FROM delivery_nodes WHERE task_id=? ORDER BY cycle_no,node_id`).all(task.taskId),
        eventCount: afterDb.prepare('SELECT COUNT(*) AS count FROM delivery_events WHERE task_id=?').get(task.taskId).count,
      };
      assert.deepEqual(after, before);
      assert.equal(afterDb.prepare('SELECT COUNT(*) AS count FROM delivery_cycles WHERE task_id=?').get(task.taskId).count, 1);
    } finally { afterDb.close(); }
    assert.equal(controller.verifyEventChain().count, before.eventCount);
  } finally {
    controller.close();
  }
});

test('campaign deadline pins remain monotonic and retain previously pinned task anchors', async () => {
  const env = fixture();
  const firstTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'campaign-pin-anchor-first');
  const secondTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'campaign-pin-anchor-second');
  let clockValue = new Date('2026-10-17T00:00:00.000Z');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath, now: () => clockValue });
  try {
    const firstTask = taskRecord('TASK-CAMPAIGN-PIN-FIRST', 'Keep the earliest worker anchor in a campaign pin.', ['src/first/']);
    const secondTask = taskRecord('TASK-CAMPAIGN-PIN-SECOND', 'Keep omitted campaign task anchors in the pin.', ['src/second/']);
    for (const [task, tree, suffix] of [[firstTask, firstTree, 'first'], [secondTask, secondTree, 'second']]) {
      const binding = trustedBinding(env.repoRoot, task, `test/campaign-pin-${suffix}`);
      controller.registerTask({ taskRecord: task, worktreeRoot: tree.worktreeRoot,
        preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding });
      const worker = dispatch(controller, task.taskId, 'worker', 'worker');
      controller.failNode({ lease: worker.lease, failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE',
        evidence: { reference: `test://campaign-pin-${suffix}` } });
      controller.recordRootDisposition({ taskId: task.taskId, disposition: 'BLOCKED',
        evidenceRef: `test://campaign-pin-${suffix}`, reason: 'Pause after recording the campaign worker anchor.' });
      clockValue = new Date(clockValue.valueOf() + 60_000);
    }

    const campaignId = 'campaign-pin-cumulative';
    const campaignDurationMinutes = 120;
    const firstHistory = controller.inspectCampaignDispatchHistory({ taskIds: [firstTask.taskId] });
    const firstSourceDeadlineAt = new Date(Date.parse(firstHistory.earliestWorkerIntentAt)
      + campaignDurationMinutes * 60_000).toISOString();
    const earlierBoundAt = new Date(Date.parse(firstSourceDeadlineAt) - 60_000).toISOString();
    const initial = controller.reconcileCampaignDeadline({ campaignId, taskIds: [firstTask.taskId],
      campaignDurationMinutes, checkpointDeadlineAt: earlierBoundAt });
    assert.equal(initial.sourceDeadlineAt, firstSourceDeadlineAt);
    assert.equal(initial.effectiveDeadlineAt, earlierBoundAt);

    const firstPinEventCount = controller.verifyEventChain().count;
    const omittedFirstTask = controller.reconcileCampaignDeadline({ campaignId, taskIds: [secondTask.taskId],
      campaignDurationMinutes, checkpointDeadlineAt: new Date(Date.parse(firstSourceDeadlineAt) - 30_000).toISOString() });
    assert.deepEqual(omittedFirstTask.taskIds, [firstTask.taskId, secondTask.taskId].sort());
    assert.equal(omittedFirstTask.sourceDeadlineAt, firstSourceDeadlineAt);
    assert.equal(omittedFirstTask.effectiveDeadlineAt, earlierBoundAt);
    assert.equal(controller.verifyEventChain().count, firstPinEventCount + 1);

    const cumulativeEventCount = controller.verifyEventChain().count;
    const unchanged = controller.reconcileCampaignDeadline({ campaignId, taskIds: [secondTask.taskId],
      campaignDurationMinutes, checkpointDeadlineAt: new Date(Date.parse(firstSourceDeadlineAt) - 30_000).toISOString() });
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.effectiveDeadlineAt, earlierBoundAt);
    assert.equal(controller.verifyEventChain().count, cumulativeEventCount);
    assert.throws(() => controller.reconcileCampaignDeadline({ campaignId, taskIds: [secondTask.taskId],
      campaignDurationMinutes: 90, checkpointDeadlineAt: earlierBoundAt }), /Pinned campaign duration changed/);
    assert.equal(controller.verifyEventChain().count, cumulativeEventCount);
  } finally {
    controller.close();
  }
});

test('a later checkpoint cannot extend a durable campaign deadline pin after controller restart or admission', async () => {
  const env = fixture();
  const tree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'campaign-pin-restart');
  const task = taskRecord('TASK-CAMPAIGN-PIN-RESTART', 'Retain an earlier campaign deadline bound across restart.');
  const binding = trustedBinding(env.repoRoot, task, 'test/campaign-pin-restart');
  let clockValue = new Date('2026-10-17T00:00:00.000Z');
  let controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath, now: () => clockValue });
  controller.registerTask({ taskRecord: task, worktreeRoot: tree.worktreeRoot,
    preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding });
  const worker = dispatch(controller, task.taskId, 'worker', 'worker');
  controller.failNode({ lease: worker.lease, failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE',
    evidence: { reference: 'test://campaign-pin-restart' } });
  controller.recordRootDisposition({ taskId: task.taskId, disposition: 'BLOCKED',
    evidenceRef: 'test://campaign-pin-restart', reason: 'Pause before checking the durable campaign deadline pin.' });

  const campaignId = 'campaign-pin-restart';
  const campaignTaskIds = [task.taskId];
  const campaignDurationMinutes = 120;
  const history = controller.inspectCampaignDispatchHistory({ taskIds: campaignTaskIds });
  const campaignDeadlineAt = new Date(Date.parse(history.earliestWorkerIntentAt)
    + campaignDurationMinutes * 60_000).toISOString();
  const earlierBoundAt = new Date(Date.parse(campaignDeadlineAt) - 60_000).toISOString();
  const laterTamperedBoundAt = new Date(Date.parse(campaignDeadlineAt) - 30_000).toISOString();
  const firstPin = controller.reconcileCampaignDeadline({ campaignId, taskIds: campaignTaskIds,
    campaignDurationMinutes, checkpointDeadlineAt: earlierBoundAt });
  assert.equal(firstPin.effectiveDeadlineAt, earlierBoundAt);
  const pinEventCount = controller.verifyEventChain().count;
  controller.close();

  controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath, now: () => clockValue });
  try {
    const afterRestart = controller.reconcileCampaignDeadline({ campaignId, taskIds: campaignTaskIds,
      campaignDurationMinutes, checkpointDeadlineAt: laterTamperedBoundAt });
    assert.equal(afterRestart.changed, false);
    assert.equal(afterRestart.sourceDeadlineAt, campaignDeadlineAt);
    assert.equal(afterRestart.effectiveDeadlineAt, earlierBoundAt);
    assert.equal(controller.verifyEventChain().count, pinEventCount);
    assert.throws(() => controller.reconcileCampaignDeadline({ campaignId: 'campaign-pin-restart-rotated',
      taskIds: campaignTaskIds, campaignDurationMinutes,
      checkpointDeadlineAt: new Date(Date.parse(campaignDeadlineAt) - 15_000).toISOString() }),
    /already pinned under campaignId campaign-pin-restart; overlapping campaigns are not allowed/);
    assert.equal(controller.verifyEventChain().count, pinEventCount);
    const originalCampaignPin = controller.reconcileCampaignDeadline({ campaignId, taskIds: campaignTaskIds,
      campaignDurationMinutes, checkpointDeadlineAt: laterTamperedBoundAt });
    assert.equal(originalCampaignPin.effectiveDeadlineAt, earlierBoundAt);
    assert.equal(controller.verifyEventChain().count, pinEventCount);

    const snapshot = () => {
      const database = new DatabaseSync(env.databasePath);
      try {
        return {
          run: database.prepare('SELECT task_id,state,current_cycle FROM delivery_runs WHERE task_id=?').get(task.taskId),
          cycles: database.prepare(`SELECT cycle_no,state,started_at,CAST(submissions AS TEXT) AS submissions,
            implementation_repairs,tool_retries,admission_evidence_json FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no`).all(task.taskId),
          nodes: database.prepare('SELECT cycle_no,node_id,state,attempt FROM delivery_nodes WHERE task_id=? ORDER BY cycle_no,node_id').all(task.taskId),
          locks: {
            write: database.prepare('SELECT task_id,scope_path FROM delivery_write_locks WHERE task_id=? ORDER BY scope_path').all(task.taskId),
            domain: database.prepare('SELECT domain_or_feature_key,task_id FROM delivery_domain_locks WHERE task_id=?').all(),
          },
          events: database.prepare('SELECT COUNT(*) AS count FROM delivery_events').get().count,
        };
      } finally { database.close(); }
    };
    const before = snapshot();
    assert.throws(() => controller.admitCycle({ taskId: task.taskId, taskRecord: task,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding,
      admission: successorAdmission(task), campaignId, campaignTaskIds, campaignDurationMinutes,
      campaignDeadlineAt, campaignDeadlineBoundAt: laterTamperedBoundAt }),
    /Effective campaign deadline bound does not match the immutable campaign pin/);
    assert.deepEqual(snapshot(), before);
    assert.equal(controller.verifyEventChain().count, pinEventCount);
  } finally {
    controller.close();
  }
});

test('successor-cycle admission requires and transactionally enforces the campaign deadline after worker dispatch', async () => {
  const env = fixture();
  const tree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'campaign-deadline-admission');
  const task = taskRecord('TASK-CAMPAIGN-DEADLINE-ADMISSION', 'Do not admit a successor after the immutable campaign deadline.');
  const binding = trustedBinding(env.repoRoot, task, 'delivery-control/campaign-deadline-admission');
  let clockValue = new Date();
  let advanceAtAdmissionBoundary = false;
  let admissionClockReads = 0;
  let campaignDeadlineMs = null;
  const now = () => {
    if (advanceAtAdmissionBoundary) {
      admissionClockReads++;
      if (admissionClockReads === 2) clockValue = new Date(campaignDeadlineMs + 1);
    }
    return clockValue;
  };
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath, now });
  try {
    controller.registerTask({ taskRecord: task, worktreeRoot: tree.worktreeRoot,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding });
    const worker = dispatch(controller, task.taskId, 'worker', 'worker');
    controller.failNode({ lease: worker.lease, failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE',
      evidence: { reference: 'test://campaign-deadline-pause' } });
    controller.recordRootDisposition({ taskId: task.taskId, disposition: 'BLOCKED',
      evidenceRef: 'test://campaign-deadline-pause', reason: 'Pause the worker-dispatched predecessor before deadline admission checks.' });

    const admission = successorAdmission(task);
    const campaignTaskIds = [task.taskId];
    const campaignDurationMinutes = 120;
    const campaignId = 'campaign-deadline-admission';
    const dispatchHistory = controller.inspectCampaignDispatchHistory({ taskIds: campaignTaskIds });
    const campaignDeadlineAt = new Date(Date.parse(dispatchHistory.earliestWorkerIntentAt)
      + campaignDurationMinutes * 60_000).toISOString();
    campaignDeadlineMs = Date.parse(campaignDeadlineAt);
    const snapshot = () => {
      const database = new DatabaseSync(env.databasePath);
      try {
        return {
          run: controller.getRun(task.taskId),
          cycles: database.prepare(`SELECT cycle_no,state,admitted_at,admission_reason,admission_evidence_json,started_at,paused_at,
            submissions,implementation_repairs,tool_retries FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no`).all(task.taskId),
          nodes: database.prepare(`SELECT cycle_no,node_id,state,attempt,effect_state,dispatch_operation_id,dispatch_input_digest
            FROM delivery_nodes WHERE task_id=? ORDER BY cycle_no,node_id`).all(task.taskId),
          eventCount: database.prepare('SELECT COUNT(*) AS count FROM delivery_events WHERE task_id=?').get(task.taskId).count,
        };
      } finally { database.close(); }
    };
    const before = snapshot();
    assert.throws(() => controller.admitCycle({ taskId: task.taskId, taskRecord: task,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding,
      admission, campaignId, campaignTaskIds, campaignDurationMinutes }),
    /Campaign deadline evidence is required/);
    assert.deepEqual(snapshot(), before);

    // The deadline-pin event is the first transaction clock read. Advance on
    // the next read, after Git/base validation and immediately before writes.
    advanceAtAdmissionBoundary = true;
    admissionClockReads = 0;
    assert.throws(() => controller.admitCycle({ taskId: task.taskId, taskRecord: task,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding,
      admission, campaignId, campaignDeadlineAt, campaignDeadlineBoundAt: campaignDeadlineAt, campaignTaskIds, campaignDurationMinutes }),
    /Campaign deadline expired before successor cycle admission/);
    assert.deepEqual(snapshot(), before);
    assert.equal(controller.verifyEventChain().count, before.eventCount);
  } finally {
    controller.close();
  }
});

test('an earlier campaign deadline bound is accepted while live and enforced transactionally after expiry', async (t) => {
  const prepare = async (subtest, suffix) => {
    const env = fixture(subtest);
    const tree = addWorktree(env.repoRoot, env.root, env.baseCommit, `earlier-deadline-${suffix}`);
    const task = taskRecord(`TASK-EARLIER-DEADLINE-${suffix.toUpperCase()}`,
      'Keep an earlier valid supervisor checkpoint bound during successor admission.');
    const binding = trustedBinding(env.repoRoot, task, `delivery-control/earlier-deadline-${suffix}`);
    let clockValue = new Date();
    const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath, now: () => clockValue });
    controller.registerTask({ taskRecord: task, worktreeRoot: tree.worktreeRoot,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding });
    const worker = dispatch(controller, task.taskId, 'worker', 'worker');
    controller.failNode({ lease: worker.lease, failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE',
      evidence: { reference: 'test://earlier-deadline-pause' } });
    controller.recordRootDisposition({ taskId: task.taskId, disposition: 'BLOCKED',
      evidenceRef: 'test://earlier-deadline-pause', reason: 'Pause before enforcing the earlier campaign bound.' });
    const campaignTaskIds = [task.taskId];
    const campaignDurationMinutes = 120;
    const campaignId = `campaign-earlier-deadline-${suffix}`;
    const history = controller.inspectCampaignDispatchHistory({ taskIds: campaignTaskIds });
    const campaignDeadlineAt = new Date(Date.parse(history.earliestWorkerIntentAt)
      + campaignDurationMinutes * 60_000).toISOString();
    const campaignDeadlineBoundAt = new Date(Date.parse(campaignDeadlineAt) - 60_000).toISOString();
    return { env, tree, task, binding, controller, campaignId, campaignTaskIds, campaignDurationMinutes,
      campaignDeadlineAt, campaignDeadlineBoundAt, setClock: (value) => { clockValue = new Date(value); } };
  };

  await t.test('admits before the earlier bound expires', async (subtest) => {
    const prepared = await prepare(subtest, 'live');
    try {
      const next = prepared.controller.admitCycle({ taskId: prepared.task.taskId, taskRecord: prepared.task,
        preflightResult: preflight(prepared.task, prepared.tree.worktreeRoot, prepared.env.baseCommit),
        trustedMandateBinding: prepared.binding, admission: successorAdmission(prepared.task),
        campaignId: prepared.campaignId,
        campaignDeadlineAt: prepared.campaignDeadlineAt, campaignDeadlineBoundAt: prepared.campaignDeadlineBoundAt,
        campaignTaskIds: prepared.campaignTaskIds, campaignDurationMinutes: prepared.campaignDurationMinutes });
      assert.equal(next.currentCycle, 2);
      assert.equal(next.cycles.length, 2);
      assert.equal(next.cycles[0].submissions, 1);
    } finally { prepared.controller.close(); }
  });

  await t.test('rejects after the earlier bound expires without admission writes', async (subtest) => {
    const prepared = await prepare(subtest, 'expired');
    const snapshot = () => {
      const database = new DatabaseSync(prepared.env.databasePath);
      try {
        return {
          run: database.prepare('SELECT task_id,state,current_cycle FROM delivery_runs WHERE task_id=?').get(prepared.task.taskId),
          cycles: database.prepare(`SELECT cycle_no,state,started_at,CAST(submissions AS TEXT) AS submissions,
            implementation_repairs,tool_retries,admission_evidence_json FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no`).all(prepared.task.taskId),
          events: database.prepare('SELECT COUNT(*) AS count FROM delivery_events').get().count,
        };
      } finally { database.close(); }
    };
    try {
      const before = snapshot();
      prepared.setClock(Date.parse(prepared.campaignDeadlineBoundAt) + 1);
      assert.throws(() => prepared.controller.admitCycle({ taskId: prepared.task.taskId, taskRecord: prepared.task,
        preflightResult: preflight(prepared.task, prepared.tree.worktreeRoot, prepared.env.baseCommit),
        trustedMandateBinding: prepared.binding, admission: successorAdmission(prepared.task),
        campaignId: prepared.campaignId,
        campaignDeadlineAt: prepared.campaignDeadlineAt, campaignDeadlineBoundAt: prepared.campaignDeadlineBoundAt,
        campaignTaskIds: prepared.campaignTaskIds, campaignDurationMinutes: prepared.campaignDurationMinutes }),
      /Campaign deadline expired before successor cycle admission/);
      assert.deepEqual(snapshot(), before);
      assert.equal(prepared.controller.verifyEventChain().count, before.events);
    } finally { prepared.controller.close(); }
  });
});

test('successor-cycle admission rejects invalid or inconsistent cycle dispatch history without ledger writes', async () => {
  const env = fixture();
  const tree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'inconsistent-cycle-dispatch-history');
  const task = taskRecord('TASK-INCONSISTENT-CYCLE-DISPATCH', 'Reject inconsistent controller dispatch history before admission.');
  const binding = trustedBinding(env.repoRoot, task, 'delivery-control/inconsistent-cycle-dispatch');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    controller.registerTask({ taskRecord: task, worktreeRoot: tree.worktreeRoot,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding });
    controller.recordRootDisposition({ taskId: task.taskId, disposition: 'BLOCKED',
      evidenceRef: 'test://inconsistent-cycle-dispatch', reason: 'Pause before corrupting dispatch history for admission validation.' });
    const admission = successorAdmission(task);
    const snapshot = () => {
      const database = new DatabaseSync(env.databasePath);
      try {
        return {
          run: database.prepare('SELECT * FROM delivery_runs WHERE task_id=?').get(task.taskId),
          cycles: database.prepare(`SELECT cycle_no,state,started_at,CAST(submissions AS TEXT) AS submissions,
            implementation_repairs,tool_retries,
            admission_evidence_json FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no`).all(task.taskId),
          locks: {
            write: database.prepare('SELECT task_id,scope_path FROM delivery_write_locks WHERE task_id=? ORDER BY scope_path').all(task.taskId),
            domain: database.prepare('SELECT domain_or_feature_key,task_id FROM delivery_domain_locks WHERE task_id=?').all(task.taskId),
            epoch: database.prepare("SELECT value FROM controller_meta WHERE key='resourceLockEpoch'").get().value,
          },
          eventCount: database.prepare('SELECT COUNT(*) AS count FROM delivery_events WHERE task_id=?').get(task.taskId).count,
        };
      } finally { database.close(); }
    };
    const corruptions = [
      { startedAt: null, submissions: 1 },
      { startedAt: new Date().toISOString(), submissions: 0 },
      { startedAt: null, submissions: -1 },
      { startedAt: null, submissions: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
      { startedAt: 'not-an-immutable-ISO-anchor', submissions: 1 },
    ];
    for (const corruption of corruptions) {
      const database = new DatabaseSync(env.databasePath);
      try {
        database.prepare('UPDATE delivery_cycles SET started_at=?,submissions=? WHERE task_id=? AND cycle_no=1')
          .run(corruption.startedAt, corruption.submissions, task.taskId);
      } finally { database.close(); }
      const before = snapshot();
      assert.throws(() => controller.admitCycle({ taskId: task.taskId, taskRecord: task,
        preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding, admission,
        campaignId: 'campaign-invalid-cycle-dispatch-history', campaignTaskIds: [task.taskId], campaignDurationMinutes: 120 }),
      /Execution cycle dispatch history (is inconsistent|has an invalid submission count|has an invalid start timestamp|does not match immutable worker dispatch events)/);
      assert.deepEqual(snapshot(), before);
      assert.equal(controller.verifyEventChain().count, before.eventCount);
    }
  } finally {
    controller.close();
  }
});

test('successor admission rejects jointly reset worker projections against the verified event chain without writes', async () => {
  const env = fixture();
  const tree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'reset-worker-dispatch-projection');
  const task = taskRecord('TASK-RESET-WORKER-PROJECTION', 'Reject dispatch projections reset after worker intents were recorded.');
  const binding = trustedBinding(env.repoRoot, task, 'delivery-control/reset-worker-projection');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    controller.registerTask({ taskRecord: task, worktreeRoot: tree.worktreeRoot,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding });
    const worker = dispatch(controller, task.taskId, 'worker', 'worker');
    controller.failNode({ lease: worker.lease, failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE',
      evidence: { reference: 'test://reset-projection-pause' } });
    controller.recordRootDisposition({ taskId: task.taskId, disposition: 'BLOCKED',
      evidenceRef: 'test://reset-projection-pause', reason: 'Pause before checking immutable worker dispatch history.' });
    const campaignTaskIds = [task.taskId];
    const campaignDurationMinutes = 120;
    const history = controller.inspectCampaignDispatchHistory({ taskIds: campaignTaskIds });
    assert.equal(history.workerIntents.length, 1);
    const campaignDeadlineAt = new Date(Date.parse(history.earliestWorkerIntentAt)
      + campaignDurationMinutes * 60_000).toISOString();
    const admission = successorAdmission(task);
    const snapshot = () => {
      const database = new DatabaseSync(env.databasePath);
      try {
        return {
          run: database.prepare('SELECT task_id,state,current_cycle FROM delivery_runs WHERE task_id=?').get(task.taskId),
          cycles: database.prepare(`SELECT cycle_no,state,started_at,CAST(submissions AS TEXT) AS submissions,
            implementation_repairs,tool_retries,admission_evidence_json FROM delivery_cycles WHERE task_id=? ORDER BY cycle_no`).all(task.taskId),
          locks: {
            write: database.prepare('SELECT task_id,scope_path FROM delivery_write_locks WHERE task_id=? ORDER BY scope_path').all(task.taskId),
            domain: database.prepare('SELECT domain_or_feature_key,task_id FROM delivery_domain_locks WHERE task_id=?').all(),
          },
          eventCount: database.prepare('SELECT COUNT(*) AS count FROM delivery_events').get().count,
        };
      } finally { database.close(); }
    };
    const database = new DatabaseSync(env.databasePath);
    try { database.prepare('UPDATE delivery_cycles SET started_at=NULL,submissions=0 WHERE task_id=? AND cycle_no=1').run(task.taskId); }
    finally { database.close(); }
    const before = snapshot();
    assert.throws(() => controller.admitCycle({ taskId: task.taskId, taskRecord: task,
      preflightResult: preflight(task, tree.worktreeRoot, env.baseCommit), trustedMandateBinding: binding, admission,
      campaignId: 'campaign-reset-projection', campaignDeadlineAt, campaignDeadlineBoundAt: campaignDeadlineAt,
      campaignTaskIds, campaignDurationMinutes }),
    /does not match immutable worker dispatch events/);
    assert.deepEqual(snapshot(), before);
    assert.equal(controller.verifyEventChain().count, before.eventCount);
  } finally {
    controller.close();
  }
});

test('YIELD_REASSESS and BLOCKED pauses retain overlapping write locks until terminal abandonment', async () => {
  const env = fixture();
  const firstTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'paused-write-lock-owner');
  const secondTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'paused-write-lock-contender');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const sharedScope = ['src/shared-paused-scope.txt'];
    const first = taskRecord('TASK-PAUSED-WRITE-LOCK-OWNER', 'Retain the overlapping path during reassessment.', sharedScope);
    const contender = taskRecord('TASK-PAUSED-WRITE-LOCK-CONTENDER', 'Attempt the held path under a different semantic key.', sharedScope);
    const firstBinding = trustedBinding(env.repoRoot, first, 'delivery-control/paused-write-lock-owner');
    const contenderBinding = trustedBinding(env.repoRoot, contender, 'delivery-control/paused-write-lock-contender');
    controller.registerTask({ taskRecord: first, worktreeRoot: firstTree.worktreeRoot,
      preflightResult: preflight(first, firstTree.worktreeRoot, env.baseCommit), trustedMandateBinding: firstBinding });

    const worker = dispatch(controller, first.taskId, 'worker', 'worker');
    controller.failNode({ lease: worker.lease, failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE',
      evidence: { reference: 'test://pause-write-lock-owner' } });
    controller.recordRootDisposition({ taskId: first.taskId, disposition: 'YIELD_REASSESS',
      evidenceRef: 'test://yield-write-lock-owner', reason: 'Retain the path while new evidence is assessed.' });

    const locks = new DatabaseSync(env.databasePath);
    assert.deepEqual(locks.prepare('SELECT scope_path FROM delivery_write_locks WHERE task_id=?').all(first.taskId).map((row) => row.scope_path),
      [sharedScope[0]]);
    assert.equal(locks.prepare('SELECT domain_or_feature_key FROM delivery_domain_locks WHERE task_id=?').get(first.taskId).domain_or_feature_key,
      firstBinding.domainOrFeatureKey);
    locks.close();
    const yieldedContender = controller.registerTask({ taskRecord: contender, worktreeRoot: secondTree.worktreeRoot,
      preflightResult: preflight(contender, secondTree.worktreeRoot, env.baseCommit), trustedMandateBinding: contenderBinding });
    assert.equal(yieldedContender.state, 'BLOCKED_SCOPE');
    assert.equal(yieldedContender.currentCycle, 0);

    controller.resumeTask({ taskRecord: first, preflightResult: preflight(first, firstTree.worktreeRoot, env.baseCommit),
      trustedMandateBinding: firstBinding, resumeEvidence: { reference: 'test://resume-write-lock-owner', reason: 'Continue after a documented reassessment.' } });
    controller.recordRootDisposition({ taskId: first.taskId, disposition: 'BLOCKED',
      evidenceRef: 'test://blocked-write-lock-owner', reason: 'Keep the overlapping path reserved while blocked.' });
    const pausedLocks = new DatabaseSync(env.databasePath);
    assert.deepEqual(pausedLocks.prepare('SELECT scope_path FROM delivery_write_locks WHERE task_id=?').all(first.taskId).map((row) => row.scope_path),
      [sharedScope[0]]);
    assert.equal(pausedLocks.prepare('SELECT domain_or_feature_key FROM delivery_domain_locks WHERE task_id=?').get(first.taskId).domain_or_feature_key,
      firstBinding.domainOrFeatureKey);
    pausedLocks.close();
    const blockedContender = controller.registerTask({ taskRecord: contender, worktreeRoot: secondTree.worktreeRoot,
      preflightResult: preflight(contender, secondTree.worktreeRoot, env.baseCommit), trustedMandateBinding: contenderBinding });
    assert.equal(blockedContender.state, 'BLOCKED_SCOPE');
    assert.equal(blockedContender.currentCycle, 0);

    controller.recordRootDisposition({ taskId: first.taskId, disposition: 'ABANDONED',
      evidenceRef: 'test://abandon-write-lock-owner', reason: 'Release both locks at terminal abandonment.' });
    const releasedLocks = new DatabaseSync(env.databasePath);
    assert.equal(releasedLocks.prepare('SELECT COUNT(*) AS count FROM delivery_write_locks WHERE task_id=?').get(first.taskId).count, 0);
    assert.equal(releasedLocks.prepare('SELECT COUNT(*) AS count FROM delivery_domain_locks WHERE task_id=?').get(first.taskId).count, 0);
    releasedLocks.close();
    const admittedContender = controller.registerTask({ taskRecord: contender, worktreeRoot: secondTree.worktreeRoot,
      preflightResult: preflight(contender, secondTree.worktreeRoot, env.baseCommit), trustedMandateBinding: contenderBinding });
    assert.equal(admittedContender.state, 'WORKER_READY');
  } finally {
    controller.close();
  }
});

test('integrated pending-CI dispositions reacquire both locks atomically on conflict', async () => {
  const env = fixture();
  const integratedTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'integrated-lock-reacquire-target');
  const semanticTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'integrated-domain-lock-contender');
  const pathTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'integrated-write-lock-contender');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const sharedKey = 'delivery-control/integrated-lock-reacquire';
    const target = taskRecord('TASK-INTEGRATED-LOCK-REACQUIRE', 'Reacquire both locks before a resumable disposition.', ['src/integrated-target.txt']);
    const targetBinding = trustedBinding(env.repoRoot, target, sharedKey);
    controller.registerTask({ taskRecord: target, worktreeRoot: integratedTree.worktreeRoot,
      preflightResult: preflight(target, integratedTree.worktreeRoot, env.baseCommit), trustedMandateBinding: targetBinding });
    integrateTask(controller, target, integratedTree.worktreeRoot);

    const retainedLockDb = new DatabaseSync(env.databasePath);
    retainedLockDb.prepare('INSERT INTO delivery_domain_locks(domain_or_feature_key,task_id) VALUES(?,?)')
      .run(sharedKey, target.taskId);
    retainedLockDb.close();
    assert.doesNotThrow(() => controller.nextReadyNodes(), 'an integrated pending-CI run with its own valid lock must not self-conflict');
    const releaseLockDb = new DatabaseSync(env.databasePath);
    releaseLockDb.prepare('DELETE FROM delivery_domain_locks WHERE task_id=?').run(target.taskId);
    releaseLockDb.close();

    const semanticContender = taskRecord('TASK-INTEGRATED-SEMANTIC-CONTENDER', 'Hold the target semantic key after integration.', ['src/semantic-contender.txt']);
    controller.registerTask({ taskRecord: semanticContender, worktreeRoot: semanticTree.worktreeRoot,
      preflightResult: preflight(semanticContender, semanticTree.worktreeRoot, env.baseCommit),
      trustedMandateBinding: trustedBinding(env.repoRoot, semanticContender, sharedKey) });
    const beforeSemanticConflict = controller.getRun(target.taskId);
    const semanticEventCount = controller.verifyEventChain().count;
    assert.throws(() => controller.recordRootDisposition({ taskId: target.taskId, disposition: 'YIELD_REASSESS',
      evidenceRef: 'test://integrated-domain-conflict', reason: 'Attempt to reacquire a held semantic key.' }), /domainOrFeatureKey conflicts/);
    const afterSemanticConflict = controller.getRun(target.taskId);
    assert.deepEqual(afterSemanticConflict, beforeSemanticConflict);
    assert.equal(controller.verifyEventChain().count, semanticEventCount);
    let locks = new DatabaseSync(env.databasePath);
    assert.equal(locks.prepare('SELECT COUNT(*) AS count FROM delivery_write_locks WHERE task_id=?').get(target.taskId).count, 0);
    assert.equal(locks.prepare('SELECT COUNT(*) AS count FROM delivery_domain_locks WHERE task_id=?').get(target.taskId).count, 0);
    locks.close();

    controller.recordRootDisposition({ taskId: semanticContender.taskId, disposition: 'ABANDONED',
      evidenceRef: 'test://release-semantic-contender', reason: 'Release its test lock before checking path conflicts.' });
    const pathContender = taskRecord('TASK-INTEGRATED-PATH-CONTENDER', 'Hold the target path under a different semantic key.', ['src/integrated-target.txt']);
    controller.registerTask({ taskRecord: pathContender, worktreeRoot: pathTree.worktreeRoot,
      preflightResult: preflight(pathContender, pathTree.worktreeRoot, env.baseCommit),
      trustedMandateBinding: trustedBinding(env.repoRoot, pathContender, 'delivery-control/integrated-path-contender') });
    const beforePathConflict = controller.getRun(target.taskId);
    const pathEventCount = controller.verifyEventChain().count;
    assert.throws(() => controller.recordRootDisposition({ taskId: target.taskId, disposition: 'BLOCKED',
      evidenceRef: 'test://integrated-path-conflict', reason: 'Attempt to reacquire an overlapping write scope.' }), /writeScope conflicts/);
    const afterPathConflict = controller.getRun(target.taskId);
    assert.deepEqual(afterPathConflict, beforePathConflict);
    assert.equal(controller.verifyEventChain().count, pathEventCount);
    locks = new DatabaseSync(env.databasePath);
    assert.equal(locks.prepare('SELECT COUNT(*) AS count FROM delivery_write_locks WHERE task_id=?').get(target.taskId).count, 0);
    assert.equal(locks.prepare('SELECT COUNT(*) AS count FROM delivery_domain_locks WHERE task_id=?').get(target.taskId).count, 0);
    locks.close();
  } finally {
    controller.close();
  }
});

test('an active legacy run without a semantic key blocks new admission and worker dispatch', async () => {
  const env = fixture();
  const firstTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'legacy-active');
  const secondTree = addWorktree(env.repoRoot, env.root, env.baseCommit, 'legacy-successor');
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const first = taskRecord('TASK-LEGACY-KEY-MISSING', 'Retain a legacy active run.');
    controller.registerTask({ taskRecord: first, worktreeRoot: firstTree.worktreeRoot,
      preflightResult: preflight(first, firstTree.worktreeRoot, env.baseCommit), trustedMandateBinding: trustedBinding(env.repoRoot, first) });
    const legacyDb = new DatabaseSync(env.databasePath);
    legacyDb.prepare('UPDATE delivery_runs SET trusted_mandate_json=? WHERE task_id=?')
      .run(JSON.stringify({ resolvedBy: 'root', taskId: first.taskId, objective: first.objective }), first.taskId);
    legacyDb.close();

    const second = taskRecord('TASK-LEGACY-KEY-SUCCESSOR', 'Must not collide with an unkeyed active run.', ['src/other.txt']);
    assert.throws(() => controller.registerTask({ taskRecord: second, worktreeRoot: secondTree.worktreeRoot,
      preflightResult: preflight(second, secondTree.worktreeRoot, env.baseCommit), trustedMandateBinding: trustedBinding(env.repoRoot, second) }),
    /ACTIVE_RUN_MISSING_DOMAIN_OR_FEATURE_KEY/);
    assert.throws(() => controller.nextReadyNodes(), /ACTIVE_RUN_MISSING_DOMAIN_OR_FEATURE_KEY/);
    assert.equal(controller.getRun(second.taskId), null);
  } finally {
    controller.close();
  }
});

test('metadata repair stays resumable and free, preserves cumulative no-progress, and registers corrected input under the same task id', async () => {
  const env = fixture();
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const taskId = 'TASK-METADATA-REPAIR';
    const objective = 'Correct the task-readiness record without implementation work.';
    const mandate = trustedBinding(env.repoRoot, { taskId, objective, writeScope: ['src/'] });
    const malformedA = { taskId, schemaVersion: 'task-readiness/v0', objective, writeScope: ['src/'], typo: ' required field ' };
    const malformedB = { typo: 'required field', writeScope: ['src/'], objective: 'Correct the task-readiness record without implementation work.', schemaVersion: 'task-readiness/v0', taskId };
    const semanticInputA = { schemaVersion: 'task-readiness/v0', checks: ['wrong command'] };
    const semanticInputB = { checks: [' wrong   command '], schemaVersion: 'task-readiness/v0' };
    const first = controller.recordPreflightRepair({ taskId, taskRecord: malformedA, trustedMandateBinding: mandate, effectState: 'NONE', evidence: { reference: 'preflight://invalid-record' }, semanticInput: semanticInputA });
    assert.equal(first.outcome, 'REPAIR_METADATA');
    const second = controller.recordPreflightRepair({ taskId, taskRecord: malformedB, trustedMandateBinding: mandate, effectState: 'NONE', evidence: { reference: 'preflight://same-invalid-record' }, semanticInput: semanticInputB });
    assert.equal(second.outcome, 'YIELD_REASSESS');
    assert.equal(controller.getRun(taskId).currentCycle, 0);
    assert.equal(controller.getRun(taskId).noProgress[0].occurrences, 2);

    const corrected = taskRecord(taskId, objective, ['src/']);
    const registered = controller.registerTask({
      taskRecord: corrected,
      preflightResult: preflight(corrected, env.repoRoot, env.baseCommit),
      trustedMandateBinding: trustedBinding(env.repoRoot, corrected),
    });
    assert.equal(registered.state, 'WORKER_READY');
    assert.equal(registered.currentCycle, 1);
    assert.equal(registered.noProgress[0].occurrences, 2);
    assert.equal(registered.cycles[0].submissions, 0);
    assert.equal(registered.cycles[0].implementationRepairs, 0);
    assert.equal(controller.recordPreflightRepair({ taskId, taskRecord: malformedA, trustedMandateBinding: mandate, effectState: 'APPLIED', evidence: { reference: 'unexpected-effect' } }).outcome, 'BLOCKED_EFFECT_REASSESS');
  } finally {
    controller.close();
  }
});

test('restart quarantines a dispatched unknown effect, read-only no-effect reconciliation permits a bounded retry, and fencing rejects stale leases', async () => {
  const env = fixture();
  const task = taskRecord('TASK-UNKNOWN-EFFECT', 'Exercise lease expiry and no-effect reconciliation.');
  let clockValue = new Date();
  const now = () => clockValue;
  let controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath, now });
  const registered = controller.registerTask({ taskRecord: task, preflightResult: preflight(task, env.repoRoot, env.baseCommit), trustedMandateBinding: trustedBinding(env.repoRoot, task) });
  const oldLease = controller.claimNode({ taskId: task.taskId, nodeId: 'worker', ownerId: 'runner-old', leaseMs: 1_000 });
  controller.recordDispatchIntent({ lease: oldLease, operationId: 'operation-unknown-1', inputDigest: sha('dispatch-input') });
  controller.close();

  clockValue = new Date(clockValue.getTime() + 2_000);
  controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath, now });
  try {
    assert.deepEqual(controller.nextReadyNodes(), []);
    assert.equal(controller.getRun(task.taskId).state, 'QUARANTINED');
    assert.throws(() => controller.heartbeat(oldLease), /fencing|expired/i);
    const recoveredEventCount = controller.verifyEventChain().count;
    assert.throws(() => controller.cancelDispatchBeforeLaunch({ lease: oldLease, operationId: 'operation-unknown-1',
      reason: 'CAMPAIGN_DEADLINE_EXPIRED' }), /stale owner or epoch/);
    assert.equal(controller.verifyEventChain().count, recoveredEventCount);
    const recoveredDb = new DatabaseSync(env.databasePath);
    try {
      assert.equal(recoveredDb.prepare("SELECT COUNT(*) AS count FROM delivery_unknown_effects WHERE task_id=? AND state='UNKNOWN'")
        .get(task.taskId).count, 1);
      assert.equal(recoveredDb.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE task_id=? AND event_type='BACKEND_DISPATCH_CANCELLED_BEFORE_LAUNCH'")
        .get(task.taskId).count, 0);
    } finally { recoveredDb.close(); }
    const reconciled = controller.reconcileUnknown({
      taskId: task.taskId,
      nodeId: 'worker',
      operationId: 'operation-unknown-1',
      resolution: 'NO_EFFECT',
      effectState: 'NONE',
      evidence: { sourceRef: 'git://worktree-status', finding: 'No candidate or dirty files were created.', observedAt: clockValue.toISOString(),
        process: { status: 'NOT_STARTED', operationId: 'operation-unknown-1', checkedAt: clockValue.toISOString(), identityRef: 'fixture://no-process-spawned' } },
    });
    assert.equal(reconciled.retryAllowed, true);
    assert.equal(controller.getRun(task.taskId).state, 'WORKER_READY');
    assert.equal(controller.getRun(task.taskId).cycles[0].toolRetries, 1);
    const freshLease = controller.claimNode({ taskId: task.taskId, nodeId: 'worker', ownerId: 'runner-new', leaseMs: 30_000 });
    assert.ok(freshLease.epoch > oldLease.epoch);
    const reclaimedEventCount = controller.verifyEventChain().count;
    assert.throws(() => controller.cancelDispatchBeforeLaunch({ lease: oldLease, operationId: 'operation-unknown-1',
      reason: 'CAMPAIGN_DEADLINE_EXPIRED' }), /stale owner or epoch/);
    assert.equal(controller.verifyEventChain().count, reclaimedEventCount);
    controller.releaseLease(freshLease);
    assert.equal(controller.verifyEventChain().count >= 7, true);
  } finally {
    controller.close();
  }
});

test('atomic role claims admit two workers plus one gate and enforce both role caps', async () => {
  const env = fixture();
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const records = ['a', 'b', 'c', 'd', 'e'].map((suffix) => taskRecord(`TASK-SLOT-${suffix}`, `Use isolated role slot ${suffix}.`, [`src/${suffix}.txt`]));
    const trees = [];
    for (const [index, task] of records.entries()) {
      const { worktreeRoot } = addWorktree(env.repoRoot, env.root, env.baseCommit, `slot-${index}`);
      trees.push(worktreeRoot);
      controller.registerTask({ taskRecord: task, preflightResult: preflight(task, worktreeRoot, env.baseCommit), worktreeRoot, trustedMandateBinding: trustedBinding(env.repoRoot, task) });
    }

    for (const index of [2]) {
      const task = records[index];
      const worker = dispatch(controller, task.taskId, 'worker', 'worker');
      mkdirSync(path.join(trees[index], 'src'), { recursive: true });
      writeFileSync(path.join(trees[index], 'src', `${index === 2 ? 'c' : 'd'}.txt`), 'role-cap fixture');
      git(trees[index], ['add', 'src']);
      git(trees[index], ['commit', '-m', `worker candidate ${task.taskId}`]);
      controller.completeNode({ lease: worker.lease, result: roleResult('worker', worker.sessionId,
        git(trees[index], ['rev-parse', 'HEAD']), sha(`candidate-${task.taskId}`)) });
    }

    const ready = controller.nextReadyNodes();
    assert.ok(ready.some((node) => node.taskId === records[2].taskId && node.role === 'verifier'));
    const gate = controller.claimNode({ taskId: records[2].taskId, nodeId: 'verifier', ownerId: 'runner-gate' });
    assert.equal(gate.blocked, undefined);
    controller.recordDispatchIntent({ lease: gate, operationId: 'role-capacity-verifier', inputDigest: sha('role-capacity-verifier') });
    const first = controller.claimNode({ taskId: records[0].taskId, nodeId: 'worker', ownerId: 'runner-a' });
    const second = controller.claimNode({ taskId: records[1].taskId, nodeId: 'worker', ownerId: 'runner-b' });
    assert.equal(first.blocked, undefined);
    assert.equal(second.blocked, undefined);
    assert.throws(() => controller.claimNode({ taskId: records[4].taskId, nodeId: 'worker', ownerId: 'runner-worker-over-cap' }), /concurrency limits/);
    assert.deepEqual(controller.nextReadyNodes(), []);
  } finally {
    controller.close();
  }
});

test('active workers reserve unverified-submission queue capacity in scheduling and atomic claims', async () => {
  const env = fixture();
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const records = [
      taskRecord('TASK-QUEUE-ACTIVE-PENDING', 'Hold one unverified candidate.', ['src/pending.txt']),
      taskRecord('TASK-QUEUE-ACTIVE-WORKER', 'Reserve the other queue slot with an active worker.', ['src/active.txt']),
      taskRecord('TASK-QUEUE-ACTIVE-READY', 'Wait for an available queue reservation.', ['src/ready.txt']),
    ];
    const trees = [];
    for (const [index, task] of records.entries()) {
      const { worktreeRoot } = addWorktree(env.repoRoot, env.root, env.baseCommit, `queue-active-${index}`);
      trees.push(worktreeRoot);
      controller.registerTask({ taskRecord: task, preflightResult: preflight(task, worktreeRoot, env.baseCommit), worktreeRoot,
        trustedMandateBinding: trustedBinding(env.repoRoot, task) });
    }

    completeWorkerCandidate(controller, records[0], trees[0]);
    const activeWorker = controller.claimNode({ taskId: records[1].taskId, nodeId: 'worker', ownerId: 'active-queue-worker' });
    assert.equal(activeWorker.blocked, undefined);
    const ready = controller.nextReadyNodes({ limit: 100 });
    assert.equal(ready.filter((node) => node.role === 'verifier').length, 1);
    assert.equal(ready.filter((node) => node.role === 'worker').length, 0);
    assert.throws(() => controller.claimNode({ taskId: records[2].taskId, nodeId: 'worker', ownerId: 'queue-over-cap' }), /concurrency limits/);
  } finally {
    controller.close();
  }
});

test('workers selected in one ready-node batch reserve unverified-submission queue capacity', async () => {
  const env = fixture();
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const records = [
      taskRecord('TASK-QUEUE-BATCH-PENDING', 'Hold one unverified candidate for review.', ['src/pending.txt']),
      taskRecord('TASK-QUEUE-BATCH-A', 'Compete for the first remaining queue slot.', ['src/a.txt']),
      taskRecord('TASK-QUEUE-BATCH-B', 'Compete for the same batch queue slot.', ['src/b.txt']),
    ];
    const trees = [];
    for (const [index, task] of records.entries()) {
      const { worktreeRoot } = addWorktree(env.repoRoot, env.root, env.baseCommit, `queue-batch-${index}`);
      trees.push(worktreeRoot);
      controller.registerTask({ taskRecord: task, preflightResult: preflight(task, worktreeRoot, env.baseCommit), worktreeRoot,
        trustedMandateBinding: trustedBinding(env.repoRoot, task) });
    }

    completeWorkerCandidate(controller, records[0], trees[0]);
    const ready = controller.nextReadyNodes({ limit: 100 });
    const workerNodes = ready.filter((node) => node.role === 'worker');
    assert.equal(workerNodes.length, 1);
    const selected = workerNodes[0];
    const unselected = records.find((task) => task.taskId !== records[0].taskId && task.taskId !== selected.taskId);
    const lease = controller.claimNode({ taskId: selected.taskId, nodeId: selected.nodeId, ownerId: 'selected-batch-worker' });
    assert.equal(lease.blocked, undefined);
    assert.throws(() => controller.claimNode({ taskId: unselected.taskId, nodeId: 'worker', ownerId: 'unselected-batch-worker' }), /concurrency limits/);
    assert.equal(controller.nextReadyNodes({ limit: 100 }).some((node) => node.role === 'worker'), false);
  } finally {
    controller.close();
  }
});

test('atomic gate capacity refuses a second verifier while one gate session is active', async () => {
  const env = fixture();
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const records = ['a', 'b'].map((suffix) => taskRecord(`TASK-GATE-SLOT-${suffix}`, `Prepare independent gate slot ${suffix}.`, [`src/${suffix}.txt`]));
    const trees = [];
    for (const [index, task] of records.entries()) {
      const { worktreeRoot } = addWorktree(env.repoRoot, env.root, env.baseCommit, `gate-slot-${index}`);
      trees.push(worktreeRoot);
      controller.registerTask({ taskRecord: task, preflightResult: preflight(task, worktreeRoot, env.baseCommit), worktreeRoot, trustedMandateBinding: trustedBinding(env.repoRoot, task) });
    }
    for (const [index, task] of records.entries()) {
      const worker = dispatch(controller, task.taskId, 'worker', 'worker');
      mkdirSync(path.join(trees[index], 'src'), { recursive: true });
      writeFileSync(path.join(trees[index], 'src', `${index === 0 ? 'a' : 'b'}.txt`), 'gate-cap fixture');
      git(trees[index], ['add', 'src']);
      git(trees[index], ['commit', '-m', `worker candidate ${task.taskId}`]);
      controller.completeNode({ lease: worker.lease, result: roleResult('worker', worker.sessionId,
        git(trees[index], ['rev-parse', 'HEAD']), sha(`candidate-${task.taskId}`)) });
    }

    const firstGate = controller.claimNode({ taskId: records[0].taskId, nodeId: 'verifier', ownerId: 'runner-gate-a' });
    assert.equal(firstGate.blocked, undefined);
    assert.throws(() => controller.claimNode({ taskId: records[1].taskId, nodeId: 'verifier', ownerId: 'runner-gate-b' }), /concurrency limits/);
  } finally {
    controller.close();
  }
});

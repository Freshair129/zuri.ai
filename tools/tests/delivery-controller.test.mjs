import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function trustedBinding(repoRoot, task) {
  return {
    resolvedBy: 'root',
    taskId: task.taskId,
    repositoryRoot: repoRoot,
    objective: task.objective,
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
  const receipt = { schemaVersion: 'root-base-prepared-candidate/v1', taskId: task.taskId,
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

    const verifier = dispatch(controller, task.taskId, 'verifier', 'verifier');
    assert.throws(() => controller.completeNode({
      lease: verifier.lease,
      result: roleResult('verifier', worker.sessionId, candidate, sha('wrong-session')),
    }), /distinct backend sessions|previously used by another role/i);
    controller.completeNode({ lease: verifier.lease, result: roleResult('verifier', verifier.sessionId, candidate, sha('verify-result')) });
    assert.equal(controller.getRun(task.taskId).state, 'REVIEW_READY');

    const reviewer = dispatch(controller, task.taskId, 'reviewer', 'reviewer');
    controller.completeNode({ lease: reviewer.lease, result: roleResult('reviewer', reviewer.sessionId, candidate, sha('review-result')) });
    assert.equal(controller.getRun(task.taskId).state, 'ROOT_DELIVERY_READY');

    const integration = controller.recordRootIntegration({ taskId: task.taskId, headCommit: candidate, evidenceRef: 'root://integration-evidence' });
    assert.equal(integration.state, 'ROOT_INTEGRATED_PENDING_CI');
    assert.equal(integration.requiredCi, 'NOT_RECORDED_BY_CONTROLLER');
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
  for (const mismatch of ['missing', 'old candidate', 'old base']) {
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
            ...(mismatch === 'old candidate' ? { oldHeadCommit: f.receipt.oldBaseCommit } : { oldBaseCommit: f.receipt.oldHeadCommit }) };
          writeFileSync(f.preparedBaseReceiptFile, JSON.stringify(wrong));
        }
        assert.throws(() => f.controller.resumeTask({ taskRecord: f.task,
          preflightResult: preflight(f.task, f.worktreeRoot, f.newBaseCommit),
          trustedMandateBinding: trustedBinding(f.env.repoRoot, f.task),
          resumeEvidence: { reference: 'root://prepared-base-fixture', reason: 'Invalid receipt test.' },
          preparedBaseReceiptFile: mismatch === 'missing' ? path.join(path.dirname(f.preparedBaseReceiptFile), 'missing.json') : f.preparedBaseReceiptFile }),
        /PREPARED_BASE_RECEIPT_(REQUIRED|MISSING|OLD_RUN_MISMATCH)/);
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
    controller.releaseLease(freshLease);
    assert.equal(controller.verifyEventChain().count >= 7, true);
  } finally {
    controller.close();
  }
});

test('atomic worker claims enforce configured slot limits even when ready-node selection raced', async () => {
  const env = fixture();
  const controller = await openDeliveryController({ repoRoot: env.repoRoot, databasePath: env.databasePath });
  try {
    const records = ['a', 'b', 'c'].map((suffix) => taskRecord(`TASK-SLOT-${suffix}`, `Use worker slot ${suffix}.`, [`src/${suffix}/`]));
    for (const [index, task] of records.entries()) {
      const { worktreeRoot } = addWorktree(env.repoRoot, env.root, env.baseCommit, `slot-${index}`);
      controller.registerTask({ taskRecord: task, preflightResult: preflight(task, worktreeRoot, env.baseCommit), worktreeRoot, trustedMandateBinding: trustedBinding(env.repoRoot, task) });
    }
    const first = controller.claimNode({ taskId: records[0].taskId, nodeId: 'worker', ownerId: 'runner-a' });
    const second = controller.claimNode({ taskId: records[1].taskId, nodeId: 'worker', ownerId: 'runner-b' });
    assert.equal(first.blocked, undefined);
    assert.equal(second.blocked, undefined);
    assert.throws(() => controller.claimNode({ taskId: records[2].taskId, nodeId: 'worker', ownerId: 'runner-c' }), /concurrency limits/);
  } finally {
    controller.close();
  }
});

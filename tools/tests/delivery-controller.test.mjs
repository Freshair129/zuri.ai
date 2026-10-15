import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { openDeliveryController, semanticTaskDigest } from '../delivery-control/controller.mjs';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const POLICY_SOURCE = path.join(SOURCE_ROOT, 'docs', 'architecture', 'delivery-control', 'contracts', 'model-policy.json');
const tempRoots = new Set();

afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
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
      evidence: { sourceRef: 'git://worktree-status', finding: 'No candidate or dirty files were created.', observedAt: clockValue.toISOString() },
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
    for (const task of records) controller.registerTask({ taskRecord: task, preflightResult: preflight(task, env.repoRoot, env.baseCommit), trustedMandateBinding: trustedBinding(env.repoRoot, task) });
    const first = controller.claimNode({ taskId: records[0].taskId, nodeId: 'worker', ownerId: 'runner-a' });
    const second = controller.claimNode({ taskId: records[1].taskId, nodeId: 'worker', ownerId: 'runner-b' });
    assert.equal(first.blocked, undefined);
    assert.equal(second.blocked, undefined);
    assert.throws(() => controller.claimNode({ taskId: records[2].taskId, nodeId: 'worker', ownerId: 'runner-c' }), /concurrency limits/);
  } finally {
    controller.close();
  }
});

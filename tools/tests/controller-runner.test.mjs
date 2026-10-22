import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createControllerRunner, rolePrompt, commitWorkerCandidate, readPreparedCandidate } from '../delivery-control/controller-runner.mjs';
import { openDeliveryController } from '../delivery-control/controller.mjs';
import { preflightTask } from '../delivery-control/preflight.mjs';
import { admitConfiguredTasks } from '../delivery-control/controller-cli.mjs';
import { runCodexRole } from '../delivery-control/codex-backend.mjs';

test('role prompts keep merge and provider effects outside worker authority', () => {
  for (const role of ['worker', 'verifier', 'reviewer']) {
    const prompt = rolePrompt({ node: { role, taskId: 'TEST', stage: 'TEST' }, task: { objective: 'Bounded work' } });
    assert.match(prompt, /No production, Supabase/);
    assert.match(prompt, /No additional agents/);
    assert.match(prompt, /Do not.*merge/);
  }
});
test('runner rejects two task bindings sharing a canonical checkout', () => {
  assert.throws(() => createControllerRunner({ controller: {}, repoRoot: process.cwd(), stateRoot: process.cwd(),
    config: { tasks: [{ taskId: 'A', worktree: process.cwd() }, { taskId: 'B', worktree: path.resolve('.') }] } }), /DUPLICATE_WORKTREE_BINDING/);
});
test('unchanged pre-claim errors are reported once and suppressed without spawning', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-runner-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const policyPath = path.join(temp, 'docs', 'architecture', 'delivery-control', 'contracts', 'model-policy.json');
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  fs.copyFileSync(new URL('../../docs/architecture/delivery-control/contracts/model-policy.json', import.meta.url), policyPath);
  const file = path.join(temp, 'task.json'); fs.writeFileSync(file, '{}');
  let calls = 0;
  const runner = createControllerRunner({ controller: { nextReadyNodes: () => [{ taskId: 'T1', branch: 'dev', role: 'worker', inputDigest: 'same' }] },
    repoRoot: temp, stateRoot: temp, config: { tasks: [{ taskId: 'T1', taskFile: file, worktree: path.join(temp, 'missing') }] },
    backend: () => { calls++; } });
  const initial = await runner.tick();
  assert.deepEqual(initial.errors, []);
  assert.equal(calls, 0);
  await runner.drain();
  const second = await runner.tick();
  assert.equal(second.errors.length, 1); assert.equal(second.active, 0);
  assert.equal((await runner.tick()).errors.length, 0); assert.equal(calls, 0);
  assert.equal(runner.isActive('T1'), false);
  await runner.stop();
});

test('runner stop aborts a dispatch whose admission read finishes after stop begins', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const mandate = { resolvedBy: 'root', taskId: f.task.taskId, repositoryRoot: f.worktree,
    objective: f.task.objective, domainOrFeatureKey: 'test/candidate-test', writeScope: f.task.writeScope,
    sourceRef: 'trusted fixture', authorizedEffects: ['local fixture changes'], prohibitions: ['external effects'] };
  const readiness = preflightTask({ repo: f.worktree, taskFile: f.taskFile, base: f.baseCommit });
  controller.registerTask({ taskRecord: f.task, preflightResult: readiness, worktreeRoot: f.worktree, trustedMandateBinding: mandate });

  let releaseGetRun;
  const getRunGate = new Promise((resolve) => { releaseGetRun = resolve; });
  let signalGetRunEntered;
  const getRunEntered = new Promise((resolve) => { signalGetRunEntered = resolve; });
  const originalGetRun = controller.getRun.bind(controller);
  const delayedController = new Proxy(controller, {
    get(target, property, receiver) {
      if (property === 'getRun') return async (taskId) => {
        signalGetRunEntered();
        await getRunGate;
        return originalGetRun(taskId);
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  let backendCalled = false;
  let backendSawAborted = false;
  let backendSettled = false;
  const runner = createControllerRunner({ controller: delayedController, repoRoot: f.worktree,
    stateRoot: path.join(f.worktree, '.git/runner-delayed-stop'),
    config: { tasks: [{ taskId: f.task.taskId, taskFile: f.taskFile, worktree: f.worktree, branch: 'codex/fixture' }] },
    backend: async ({ signal }) => {
      backendCalled = true;
      backendSawAborted = signal.aborted;
      return new Promise((resolve) => {
        let timeout;
        const finish = (code) => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', onAbort);
          backendSettled = true;
          resolve({ outcome: 'UNKNOWN', effectState: 'NONE', code });
        };
        const onAbort = () => { backendSawAborted = signal.aborted; finish('aborted-before-backend-start'); };
        if (signal.aborted) onAbort();
        else {
          signal.addEventListener('abort', onAbort, { once: true });
          timeout = setTimeout(() => finish('fixture-timeout'), 500);
        }
      });
    } });

  try {
    const tick = await runner.tick();
    assert.equal(tick.active, 1);
    await getRunEntered;
    const stopping = runner.stop();
    releaseGetRun();
    await stopping;
    assert.equal(backendCalled, true);
    assert.equal(backendSawAborted, true);
    assert.equal(backendSettled, true);
    assert.equal(runner.activeCount(), 0);
  } finally {
    releaseGetRun();
    await runner.stop();
  }
});

function candidateFixture(t) {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-candidate-'));
  const cleanupHooks = [];
  t.after(() => {
    for (const hook of cleanupHooks) hook();
    assert.ok(path.resolve(worktree).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(worktree).startsWith('zuri-candidate-'));
    fs.rmSync(worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const git = (args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const policyPath = 'docs/architecture/delivery-control/contracts/model-policy.json';
  fs.mkdirSync(path.join(worktree, path.dirname(policyPath)), { recursive: true });
  fs.writeFileSync(path.join(worktree, policyPath), fs.readFileSync(new URL('../../docs/architecture/delivery-control/contracts/model-policy.json', import.meta.url)));
  fs.mkdirSync(path.join(worktree, 'docs/roadmap'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'docs/roadmap/ROADMAP.md'), '<!-- roadmap-task-ledger:start -->\n| task_id | status | proof_scope | implementation_state | evidence |\n|---|---|---|---|---|\n| DEP-DONE | done | LOCAL | MERGED | Fixture evidence. |\n<!-- roadmap-task-ledger:end -->\n');
  fs.mkdirSync(path.join(worktree, 'src')); fs.writeFileSync(path.join(worktree, 'src/base'), 'base');
  git(['init', '-q']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
  git(['add', '.']); git(['commit', '-qm', 'base']); git(['branch', '-M', 'codex/fixture']);
  const baseCommit = git(['rev-parse', 'HEAD']);
  const artifactDir = path.join(worktree, '.git/artifacts'); fs.mkdirSync(artifactDir);
  const taskFile = path.join(worktree, '.git/task.json');
  const task = { schemaVersion: 'task-readiness/v1', taskId: 'CANDIDATE-TEST', objective: 'Scoped candidate', acceptance: ['Scoped source only'],
    writeScope: ['src/'], checks: [{ executable: process.execPath, argv: ['--version'], cwd: '.', shell: false }], mandateReference: 'trusted fixture' };
  fs.writeFileSync(taskFile, JSON.stringify(task));
  return { worktree, git, baseCommit, taskFile, task, artifactDir, cleanupHooks, result: { headCommit: baseCommit, resultDigest: 'a'.repeat(64) } };
}

function intakeConfig(f) {
  return { tasks: [{ taskId: f.task.taskId, worktree: f.worktree, taskFile: f.taskFile, base: f.baseCommit,
    trustedMandateBinding: { resolvedBy: 'root', taskId: f.task.taskId, repositoryRoot: f.worktree,
      objective: f.task.objective, domainOrFeatureKey: `test/${f.task.taskId.toLowerCase()}`,
      writeScope: f.task.writeScope, sourceRef: 'trusted intake fixture',
      authorizedEffects: ['local fixture changes'], prohibitions: ['external effects'] } }] };
}

test('runner passes the exact task checks and machine-policy invocation cap to each role backend', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const readiness = preflightTask({ repo: f.worktree, taskFile: f.taskFile, base: f.baseCommit });
  assert.equal(readiness.status, 'READY');
  controller.registerTask({ taskRecord: f.task, preflightResult: readiness, worktreeRoot: f.worktree,
    trustedMandateBinding: { resolvedBy: 'root', taskId: f.task.taskId, repositoryRoot: f.worktree,
      objective: f.task.objective, domainOrFeatureKey: 'test/check-trace', writeScope: f.task.writeScope,
      sourceRef: 'trusted fixture', authorizedEffects: ['local fixture checks'], prohibitions: ['external effects'] } });
  let captured; let failureEvidence;
  const observedController = new Proxy(controller, { get(target, property) {
    if (property === 'failNode') return async (input) => { failureEvidence = input.evidence; return target.failNode(input); };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const traceSha256 = 'c'.repeat(64);
  const runner = createControllerRunner({ controller: observedController, repoRoot: f.worktree, stateRoot: path.join(f.worktree, '.git/runner-check-trace'),
    config: { tasks: [{ taskId: f.task.taskId, taskFile: f.taskFile, worktree: f.worktree, branch: 'codex/fixture' }] },
    backend: async (input) => { captured = input; return { outcome: 'UNKNOWN', effectState: 'NONE', code: 'fixture-complete',
      checkTrace: { status: 'MALFORMED', traceSha256, checks: [{ checkIndex: 0, invocationCount: 1, status: 'MALFORMED', invocations: [{ exitCode: null }] }] } }; } });
  try {
    await runner.tick();
    await runner.drain();
    assert.deepEqual(captured.checks, f.task.checks);
    assert.equal(captured.maxInvocationsPerDeclaredCheckPerRoleSession, 2);
    assert.match(captured.prompt, /at most 2 times in this role session/);
    assert.equal(failureEvidence.checkTrace.traceSha256, traceSha256);
    assert.match(failureEvidence.checkTrace.artifactRef, /^dispatches\/[a-f0-9-]+\/check-trace\.json$/);
    assert.deepEqual(failureEvidence.checkTrace.checks[0].exitCodes, [null]);
  } finally { await runner.stop(); }
});

test('pre-spawn role blocks keep the unavailable check-trace artifact reference null', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const readiness = preflightTask({ repo: f.worktree, taskFile: f.taskFile, base: f.baseCommit });
  controller.registerTask({ taskRecord: f.task, preflightResult: readiness, worktreeRoot: f.worktree,
    trustedMandateBinding: { resolvedBy: 'root', taskId: f.task.taskId, repositoryRoot: f.worktree,
      objective: f.task.objective, domainOrFeatureKey: 'test/pre-spawn-check-trace', writeScope: f.task.writeScope,
      sourceRef: 'trusted fixture', authorizedEffects: ['local fixture checks'], prohibitions: ['external effects'] } });
  let failureEvidence;
  const observedController = new Proxy(controller, { get(target, property) {
    if (property === 'failNode') return async (input) => { failureEvidence = input.evidence; return target.failNode(input); };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const runner = createControllerRunner({ controller: observedController, repoRoot: f.worktree,
    stateRoot: path.join(f.worktree, '.git/runner-check-trace-unavailable'),
    config: { tasks: [{ taskId: f.task.taskId, taskFile: f.taskFile, worktree: f.worktree, branch: 'codex/fixture' }] },
    backend: async () => ({ outcome: 'BLOCKED', failureClass: 'STALE_BASELINE', effectState: 'NONE',
      provenNoEffect: true, code: 'LAUNCH_HEAD_MISMATCH' }) });
  try {
    await runner.tick();
    await runner.drain();
    assert.equal(failureEvidence.checkTrace.status, 'NOT_AVAILABLE');
    assert.equal(failureEvidence.checkTrace.traceSha256, null);
    assert.equal(failureEvidence.checkTrace.artifactRef, null);
  } finally { await runner.stop(); }
});

test('runner prevents launch when the campaign deadline expires at each dispatch boundary', async (t) => {
  for (const expireAtCheck of [1, 2, 3]) {
    await t.test(['after preflight before claim', 'after claim before intent', 'after intent before launch'][expireAtCheck - 1], async (t) => {
      const f = candidateFixture(t);
      const controller = await openDeliveryController({ repoRoot: f.worktree });
      f.cleanupHooks.push(() => controller.close());
      const mandate = { resolvedBy: 'root', taskId: f.task.taskId, repositoryRoot: f.worktree,
        objective: f.task.objective, domainOrFeatureKey: 'test/candidate-test', writeScope: f.task.writeScope,
        sourceRef: 'trusted fixture', authorizedEffects: ['local fixture changes'], prohibitions: ['external effects'] };
      const ready = preflightTask({ repo: f.worktree, taskFile: f.taskFile, base: f.baseCommit });
      controller.registerTask({ taskRecord: f.task, preflightResult: ready, worktreeRoot: f.worktree, trustedMandateBinding: mandate });
      const counts = { claim: 0, release: 0, intent: 0, cancel: 0 };
      const observedController = new Proxy(controller, {
        get(target, property, receiver) {
          if (property === 'claimNode') return (input) => { counts.claim++; return target.claimNode(input); };
          if (property === 'releaseLease') return (input) => { counts.release++; return target.releaseLease(input); };
          if (property === 'recordDispatchIntent') return (input) => { counts.intent++; return target.recordDispatchIntent(input); };
          if (property === 'cancelDispatchBeforeLaunch') return (input) => { counts.cancel++; return target.cancelDispatchBeforeLaunch(input); };
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      let guardChecks = 0;
      let backendCalls = 0;
      const runner = createControllerRunner({ controller: observedController, repoRoot: f.worktree,
        stateRoot: path.join(f.worktree, '.git', `runner-deadline-${expireAtCheck}`),
        config: { tasks: [{ taskId: f.task.taskId, taskFile: f.taskFile, worktree: f.worktree, branch: 'codex/fixture' }] },
        campaignDeadlineGuard: () => ++guardChecks < expireAtCheck,
        backend: async () => { backendCalls++; throw new Error('BACKEND_MUST_NOT_LAUNCH'); } });
      try {
        const tick = await runner.tick();
        assert.equal(tick.active, 1);
        await runner.drain();
        assert.equal(guardChecks, expireAtCheck);
        assert.equal(backendCalls, 0);
        const run = controller.getRun(f.task.taskId);
        const db = new DatabaseSync(controller.databasePath);
        try {
          const node = db.prepare('SELECT state,attempt,effect_state,dispatch_operation_id FROM delivery_nodes WHERE task_id=? AND node_id=\'worker\'')
            .get(f.task.taskId);
          assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_unknown_effects WHERE task_id=?').get(f.task.taskId).count, 0);
          if (expireAtCheck === 1) {
            assert.deepEqual(counts, { claim: 0, release: 0, intent: 0, cancel: 0 });
            assert.equal(node.state, 'READY');
            assert.equal(run.cycles[0].submissions, 0);
            assert.equal(run.state, 'WORKER_READY');
          } else if (expireAtCheck === 2) {
            assert.deepEqual(counts, { claim: 1, release: 1, intent: 0, cancel: 0 });
            assert.equal(node.state, 'READY');
            assert.equal(run.cycles[0].submissions, 0);
            assert.equal(run.state, 'WORKER_READY');
          } else {
            assert.deepEqual(counts, { claim: 1, release: 0, intent: 1, cancel: 1 });
            assert.equal(node.state, 'BLOCKED');
            assert.equal(node.attempt, 1);
            assert.equal(node.effect_state, 'NONE');
            assert.ok(node.dispatch_operation_id);
            assert.equal(run.state, 'PAUSED_DEADLINE');
            assert.equal(run.cycles[0].state, 'PAUSED');
            assert.equal(run.cycles[0].submissions, 1);
            assert.equal(run.cycles[0].implementationRepairs, 0);
            assert.equal(run.cycles[0].toolRetries, 0);
            const cancellation = db.prepare(`SELECT event_type,payload_json FROM delivery_events
              WHERE task_id=? AND event_type='BACKEND_DISPATCH_CANCELLED_BEFORE_LAUNCH'`).get(f.task.taskId);
            assert.ok(cancellation);
            assert.equal(JSON.parse(cancellation.payload_json).backendLaunched, false);
          }
        } finally { db.close(); }
        assert.doesNotThrow(() => controller.verifyEventChain());
      } finally { await runner.stop(); }
    });
  }
});

test('runner records no-launch cancellation when its same-owner lease expires after intent', async (t) => {
  const f = candidateFixture(t);
  let clockValue = new Date();
  const controller = await openDeliveryController({ repoRoot: f.worktree, now: () => clockValue });
  f.cleanupHooks.push(() => controller.close());
  const mandate = { resolvedBy: 'root', taskId: f.task.taskId, repositoryRoot: f.worktree,
    objective: f.task.objective, domainOrFeatureKey: 'test/candidate-test', writeScope: f.task.writeScope,
    sourceRef: 'trusted fixture', authorizedEffects: ['local fixture changes'], prohibitions: ['external effects'] };
  const ready = preflightTask({ repo: f.worktree, taskFile: f.taskFile, base: f.baseCommit });
  controller.registerTask({ taskRecord: f.task, preflightResult: ready, worktreeRoot: f.worktree, trustedMandateBinding: mandate });

  let guardChecks = 0;
  let backendCalls = 0;
  let leaseExpiredAtFinalGuard = false;
  const runner = createControllerRunner({ controller, repoRoot: f.worktree,
    stateRoot: path.join(f.worktree, '.git', 'runner-expired-prelaunch-lease'),
    config: { tasks: [{ taskId: f.task.taskId, taskFile: f.taskFile, worktree: f.worktree, branch: 'codex/fixture' }] },
    campaignDeadlineGuard: () => {
      guardChecks++;
      if (guardChecks === 3) {
        clockValue = new Date(clockValue.getTime() + 31_000);
        const db = new DatabaseSync(controller.databasePath);
        try {
          const row = db.prepare("SELECT lease_expires_at FROM delivery_nodes WHERE task_id=? AND node_id='worker'")
            .get(f.task.taskId);
          leaseExpiredAtFinalGuard = Date.parse(row.lease_expires_at) <= clockValue.getTime();
        } finally { db.close(); }
        return false;
      }
      return true;
    },
    backend: async () => { backendCalls++; throw new Error('BACKEND_MUST_NOT_LAUNCH'); } });
  try {
    const tick = await runner.tick();
    assert.equal(tick.active, 1);
    await runner.drain();
    assert.equal(guardChecks, 3);
    assert.equal(leaseExpiredAtFinalGuard, true);
    assert.equal(backendCalls, 0);
    const run = controller.getRun(f.task.taskId);
    assert.equal(run.state, 'PAUSED_DEADLINE');
    assert.equal(run.cycles[0].state, 'PAUSED');
    assert.equal(run.cycles[0].submissions, 1);
    const db = new DatabaseSync(controller.databasePath);
    try {
      const node = db.prepare(`SELECT state,attempt,effect_state,dispatch_operation_id,lease_owner,lease_expires_at
        FROM delivery_nodes WHERE task_id=? AND node_id='worker'`).get(f.task.taskId);
      assert.equal(node.state, 'BLOCKED');
      assert.equal(node.attempt, 1);
      assert.equal(node.effect_state, 'NONE');
      assert.ok(node.dispatch_operation_id);
      assert.equal(node.lease_owner, null);
      assert.equal(node.lease_expires_at, null);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_unknown_effects WHERE task_id=?').get(f.task.taskId).count, 0);
      const cancellation = db.prepare(`SELECT payload_json FROM delivery_events
        WHERE task_id=? AND event_type='BACKEND_DISPATCH_CANCELLED_BEFORE_LAUNCH'`).get(f.task.taskId);
      assert.ok(cancellation);
      const evidence = JSON.parse(cancellation.payload_json);
      assert.equal(evidence.operationId, node.dispatch_operation_id);
      assert.equal(evidence.backendLaunched, false);
      assert.equal(evidence.reason, 'CAMPAIGN_DEADLINE_EXPIRED');
      assert.equal(evidence.attempt, 1);
      assert.equal(evidence.submissions, 1);
    } finally { db.close(); }
    assert.doesNotThrow(() => controller.verifyEventChain());
  } finally { await runner.stop(); }
});

test('trusted root commits scoped source and binds backend result digest to candidate', (t) => {
  const f = candidateFixture(t);
  fs.writeFileSync(path.join(f.worktree, 'src/new.txt'), 'candidate');
  const result = commitWorkerCandidate(f);
  assert.notEqual(result.headCommit, f.baseCommit);
  assert.equal(f.git(['status', '--porcelain']), '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.artifactDir, 'candidate-commit.json'))).backendResultDigest, f.result.resultDigest);
});
test('root refuses out-of-scope worker effects before staging or committing', (t) => {
  const f = candidateFixture(t);
  fs.writeFileSync(path.join(f.worktree, 'outside.txt'), 'refused');
  assert.throws(() => commitWorkerCandidate(f), /CANDIDATE_BLOCKED_SCOPE/);
  assert.equal(f.git(['rev-parse', 'HEAD']), f.baseCommit);
  assert.equal(f.git(['diff', '--cached', '--name-only']), '');
});

test('root-prepared base merge binds exact receipt bytes through authorization and validation-only commit', async (t) => {
  const f = candidateFixture(t);
  fs.writeFileSync(path.join(f.worktree, 'src/feature.txt'), 'feature'); f.git(['add', 'src/feature.txt']); f.git(['commit', '-qm', 'feature']);
  const oldHeadCommit = f.git(['rev-parse', 'HEAD']);
  f.git(['checkout', '-qb', 'upstream', f.baseCommit]); fs.writeFileSync(path.join(f.worktree, 'upstream.txt'), 'base advance');
  f.git(['add', 'upstream.txt']); f.git(['commit', '-qm', 'new base']); const newBaseCommit = f.git(['rev-parse', 'HEAD']);
  f.git(['checkout', '-q', 'codex/fixture']); f.git(['merge', '--no-ff', '--no-edit', 'upstream']); const headCommit = f.git(['rev-parse', 'HEAD']);
  const input = { ...f, baseCommit: newBaseCommit, result: { ...f.result, headCommit } };
  assert.throws(() => commitWorkerCandidate(input), /NO_CANDIDATE_CHANGES/);
  const preparedReceiptFile = path.join(f.worktree, '.git/zuri-delivery-control/supervisors/fixture/prepared', `${f.task.taskId}.json`); fs.mkdirSync(path.dirname(preparedReceiptFile), { recursive: true });
  const receipt = { schemaVersion: 'root-base-prepared-candidate/v1', taskId: f.task.taskId, cycleNo: 1, oldBaseCommit: f.baseCommit,
    oldHeadCommit, headCommit, newBaseCommit, reason: 'Verified newer base; same task/caps', evidenceRef: 'root fixture operation' };
  fs.writeFileSync(preparedReceiptFile, JSON.stringify(receipt));
  const proof = readPreparedCandidate({ worktree: f.worktree, task: f.task, baseCommit: newBaseCommit, receiptFile: preparedReceiptFile });
  assert.throws(() => readPreparedCandidate({ worktree: f.worktree, task: f.task, baseCommit: newBaseCommit,
    receiptFile: preparedReceiptFile, expectedCycleNo: 2 }), /PREPARED_CANDIDATE_BINDING_MISMATCH/);
  const acceptedBytes = fs.readFileSync(preparedReceiptFile);
  const run = { state: 'WORKER_READY', currentCycle: 1, taskRecord: f.task, baseCommit: newBaseCommit,
    preparedBaseResume: { taskId: f.task.taskId, receiptDigest: proof.receiptDigest } };
  const makeRunner = () => createControllerRunner({ controller: { getRun: () => run }, repoRoot: f.worktree,
    stateRoot: f.artifactDir, config: { tasks: [{ taskId: f.task.taskId, taskFile: f.taskFile,
      worktree: f.worktree, branch: 'codex/fixture' }] }, backend: async () => ({ outcome: 'BLOCKED' }) });
  fs.writeFileSync(preparedReceiptFile, Buffer.concat([acceptedBytes, Buffer.from(' ')]));
  assert.throws(() => readPreparedCandidate({ worktree: f.worktree, task: f.task, baseCommit: newBaseCommit,
    receiptFile: preparedReceiptFile, expectedReceiptDigest: proof.receiptDigest }), /PREPARED_RECEIPT_DIGEST_MISMATCH/);
  const replacedRunner = makeRunner();
  assert.throws(() => replacedRunner.authorizePreparedCandidate(f.task.taskId, preparedReceiptFile, proof.receiptDigest),
    /PREPARED_RECEIPT_DIGEST_MISMATCH/);
  await replacedRunner.stop();
  fs.writeFileSync(preparedReceiptFile, acceptedBytes);
  const acceptedRunner = makeRunner();
  assert.doesNotThrow(() => acceptedRunner.authorizePreparedCandidate(f.task.taskId, preparedReceiptFile, proof.receiptDigest));
  await acceptedRunner.stop();
  const result = commitWorkerCandidate({ ...input, preparedReceiptFile, preparedReceiptDigest: proof.receiptDigest });
  assert.notEqual(result.headCommit, headCommit); assert.equal(f.git(['diff', '--name-only', headCommit, result.headCommit]), '');
  const candidateReceipt = JSON.parse(fs.readFileSync(path.join(f.artifactDir, 'candidate-commit.json')));
  assert.equal(candidateReceipt.validationOnly, true);
  assert.equal(candidateReceipt.preparedReceiptDigest, proof.receiptDigest);
  assert.equal(fs.readFileSync(path.join(f.worktree, 'src/feature.txt'), 'utf8'), 'feature');
});

test('prepared candidate reader rejects a symlinked prepared directory before reading a redirected receipt', (t) => {
  const f = candidateFixture(t);
  const privateRoot = path.join(f.worktree, '.git', 'zuri-delivery-control');
  const prepared = path.join(privateRoot, 'supervisors', 'fixture', 'prepared');
  fs.mkdirSync(prepared, { recursive: true });
  const external = path.join(f.worktree, '.git', 'redirected-prepared-receipts');
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, `${f.task.taskId}.json`), '{}');
  fs.rmSync(prepared, { recursive: true, force: true });
  fs.symlinkSync(external, prepared, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readPreparedCandidate({ worktree: f.worktree, task: f.task,
    baseCommit: f.baseCommit, receiptFile: path.join(prepared, `${f.task.taskId}.json`) }),
  /BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED/);
});
test('runner holds a worker at stale baseline when HEAD changes after dispatch intent but before backend spawn', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const mandate = { resolvedBy: 'root', taskId: f.task.taskId, repositoryRoot: f.worktree,
    objective: f.task.objective, domainOrFeatureKey: 'test/candidate-test', writeScope: f.task.writeScope, sourceRef: 'trusted fixture',
    authorizedEffects: ['local fixture changes'], prohibitions: ['no external effects'] };
  const ready = preflightTask({ repo: f.worktree, taskFile: f.taskFile, base: f.baseCommit });
  assert.equal(ready.status, 'READY');
  controller.registerTask({ taskRecord: f.task, preflightResult: ready, worktreeRoot: f.worktree, trustedMandateBinding: mandate });
  const initialHead = f.git(['rev-parse', 'HEAD']);
  let spawnCalls = 0;
  let countersAtLaunch;
  const runner = createControllerRunner({ controller, repoRoot: f.worktree, stateRoot: path.join(f.worktree, '.git/runner'),
    config: { codexExecutable: process.execPath, windowsSandbox: 'unelevated', tasks: [{ taskId: f.task.taskId,
      taskFile: f.taskFile, worktree: f.worktree, branch: 'codex/fixture' }] },
    backend: async (input) => {
      countersAtLaunch = controller.getRun(f.task.taskId).cycles[0];
      assert.equal(input.expectedLaunchHead, initialHead);
      f.git(['commit', '--allow-empty', '-qm', 'mutate after dispatch intent']);
      return runCodexRole({ ...input, spawnProcess: () => { spawnCalls++; throw new Error('unexpected spawn'); } });
    } });
  try {
    const tick = await runner.tick();
    assert.equal(tick.active, 1);
    await runner.drain();
    assert.equal(spawnCalls, 0);
    const held = controller.getRun(f.task.taskId);
    assert.equal(held.state, 'BLOCKED_STALE_BASELINE');
    assert.equal(held.taskId, f.task.taskId);
    assert.equal(held.currentCycle, 1);
    assert.equal(held.initialHeadCommit, initialHead);
    assert.equal(held.candidateHeadCommit, null);
    assert.equal(held.cycles[0].state, 'BLOCKED');
    assert.equal(held.cycles[0].submissions, countersAtLaunch.submissions);
    assert.equal(held.cycles[0].implementationRepairs, countersAtLaunch.implementationRepairs);
    assert.equal(held.cycles[0].toolRetries, countersAtLaunch.toolRetries);
    assert.equal(held.stages[0].status, 'BLOCKED');
    assert.equal(held.stages[0].failureClass, 'STALE_BASELINE');
    assert.equal(held.stages[0].effectState, 'NONE');
    assert.deepEqual(controller.nextReadyNodes(), []);
    const retryPreflight = preflightTask({ repo: f.worktree, taskFile: f.taskFile, base: f.baseCommit });
    assert.throws(() => controller.resumeTask({ taskRecord: f.task, preflightResult: retryPreflight,
      trustedMandateBinding: mandate, resumeEvidence: { reference: 'fixture://retry', reason: 'No receipt supplied.' } }),
    /PREPARED_BASE_RECEIPT_REQUIRED/);
    assert.deepEqual(controller.getRun(f.task.taskId), held);
    assert.deepEqual(controller.nextReadyNodes(), []);
  } finally { await runner.stop(); }
});
test('CLI intake retries a registration failure only after a durable no-effect backoff', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const cache = new Map();
  const register = controller.registerTask.bind(controller);
  let attempts = 0;
  let clock = Date.parse('2030-01-01T00:00:00.000Z');
  controller.registerTask = () => { attempts++; throw Object.assign(new Error('fixture pre-commit failure'), { code: 'FIXTURE_NO_EFFECT' }); };

  const first = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache, now: () => clock }))[0];
  assert.equal(first.code, 'REGISTRATION_RETRY_BACKOFF');
  assert.equal(first.attempts, 1);
  assert.equal(controller.getRun(f.task.taskId), null);
  const stateFile = path.join(path.dirname(controller.databasePath), 'admission-reconciliation',
    `${createHash('sha256').update(f.task.taskId).digest('hex')}.json`);
  assert.equal(fs.existsSync(stateFile), true);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.records[first.fingerprint].state, 'RETRY_WAIT');
  assert.equal(state.records[first.fingerprint].attempts, 1);

  const early = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache: new Map(), now: () => clock }))[0];
  assert.equal(early.code, 'REGISTRATION_RETRY_BACKOFF');
  assert.equal(attempts, 1);

  clock = Date.parse(first.retryAt) + 1;
  controller.registerTask = register;
  const retried = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache, now: () => clock }))[0];
  assert.equal(retried.code, 'TASK_REGISTRATION_CONFIRMED');
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);
  assert.equal(controller.getRun(f.task.taskId).cycles[0].submissions, 0);
  assert.equal(controller.getRun(f.task.taskId).cycles[0].implementationRepairs, 0);
});

test('CLI intake fails closed when durable RETRY_WAIT attempts or retryAt are missing or malformed', async (t) => {
  const corruptions = [
    ['missing attempts', (record) => { delete record.attempts; }],
    ['malformed attempts', (record) => { record.attempts = '1'; }],
    ['missing retryAt', (record) => { delete record.retryAt; }],
    ['malformed retryAt', (record) => { record.retryAt = 'not-a-date'; }],
  ];

  for (const [name, corrupt] of corruptions) {
    await t.test(name, async (subtest) => {
      const f = candidateFixture(subtest);
      const controller = await openDeliveryController({ repoRoot: f.worktree });
      f.cleanupHooks.push(() => controller.close());
      const config = intakeConfig(f);
      const clock = Date.parse('2030-01-01T00:00:00.000Z');
      let registrationCalls = 0;
      controller.registerTask = () => {
        registrationCalls++;
        throw Object.assign(new Error('fixture pre-commit failure'), { code: 'FIXTURE_NO_EFFECT' });
      };

      const first = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config,
        cache: new Map(), now: () => clock }))[0];
      assert.equal(first.code, 'REGISTRATION_RETRY_BACKOFF');
      assert.equal(first.attempts, 1);
      assert.equal(registrationCalls, 1);

      const stateFile = path.join(path.dirname(controller.databasePath), 'admission-reconciliation',
        `${createHash('sha256').update(f.task.taskId).digest('hex')}.json`);
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const record = state.records[first.fingerprint];
      assert.equal(record.state, 'RETRY_WAIT');
      corrupt(record);
      fs.writeFileSync(stateFile, JSON.stringify(state));

      const held = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config,
        cache: new Map(), now: () => clock }))[0];
      assert.equal(held.code, 'ADMISSION_RECONCILIATION_STATE_UNKNOWN');
      assert.equal(held.hold, true);
      assert.equal(registrationCalls, 1);
      assert.equal(controller.getRun(f.task.taskId), null);
      assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).records[first.fingerprint], record);
    });
  }
});

test('CLI intake reconciles a commit-then-error without duplicate runs, cycles, locks, or events', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const cache = new Map();
  const register = controller.registerTask.bind(controller);
  let calls = 0;
  controller.registerTask = (input) => { calls++; register(input); throw Object.assign(new Error('fixture post-commit error'), { code: 'FIXTURE_AFTER_COMMIT' }); };

  const reconciled = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache }))[0];
  assert.equal(reconciled.code, 'DURABLE_REGISTRATION_RECONCILED');
  assert.equal(reconciled.registrationConfirmed, true);
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);
  const db = new DatabaseSync(controller.databasePath);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_runs WHERE task_id=?').get(f.task.taskId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_cycles WHERE task_id=?').get(f.task.taskId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_write_locks WHERE task_id=?').get(f.task.taskId).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE task_id=? AND event_type='TASK_REGISTERED'").get(f.task.taskId).count, 1);
  } finally { db.close(); }
  await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache });
  assert.equal(calls, 1);
  assert.equal(controller.getRun(f.task.taskId).cycles.length, 1);
});

test('CLI intake does not re-register an unchanged scope-lock hold and recovers after lock release', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const blockerTask = { ...f.task, taskId: 'INTAKE-LOCK-BLOCKER', writeScope: ['src/'] };
  const blockerTaskFile = path.join(f.worktree, '.git', 'intake-lock-blocker.json');
  fs.writeFileSync(blockerTaskFile, JSON.stringify(blockerTask));
  const blockerPreflight = preflightTask({ repo: f.worktree, taskFile: blockerTaskFile, base: f.baseCommit });
  assert.equal(blockerPreflight.status, 'READY');
  controller.registerTask({ taskRecord: blockerTask, preflightResult: blockerPreflight, worktreeRoot: f.worktree,
    trustedMandateBinding: { resolvedBy: 'root', taskId: blockerTask.taskId, repositoryRoot: f.worktree,
      objective: blockerTask.objective, domainOrFeatureKey: 'test/intake-lock-blocker', writeScope: blockerTask.writeScope,
      sourceRef: 'intake lock fixture', authorizedEffects: ['local fixture changes'], prohibitions: ['external effects'] } });

  const register = controller.registerTask.bind(controller);
  let calls = 0;
  controller.registerTask = (input) => { calls++; return register(input); };
  const cache = new Map();
  const first = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache }))[0];
  assert.equal(first.code, 'DURABLE_SCOPE_LOCK_BLOCKED');
  assert.equal(first.hold, true);
  assert.equal(controller.getRun(f.task.taskId).state, 'BLOCKED_SCOPE');
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 0);
  assert.equal(calls, 1);

  const unchanged = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache }))[0];
  assert.equal(unchanged.code, 'DURABLE_SCOPE_LOCK_BLOCKED');
  assert.equal(calls, 1);

  controller.recordRootDisposition({ taskId: blockerTask.taskId, disposition: 'ABANDONED',
    evidenceRef: 'test://intake-lock-released', reason: 'Release the fixture resource lock.' });
  const recovered = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache }))[0];
  assert.equal(recovered.code, 'TASK_REGISTRATION_CONFIRMED');
  assert.equal(recovered.state, 'WORKER_READY');
  assert.equal(calls, 2);
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);
});

test('CLI intake recovers a retry-state write failure after restart from the durable reservation', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const cache = new Map();
  const register = controller.registerTask.bind(controller);
  const getRun = controller.getRun.bind(controller);
  let getRunCalls = 0;
  let registrationCalls = 0;
  let failWithoutEffect = true;
  let clock = Date.parse('2030-01-01T00:00:00.000Z');
  const guardedController = new Proxy(controller, { get(target, property) {
    if (property === 'registerTask') return (input) => {
      registrationCalls++;
      if (failWithoutEffect) throw Object.assign(new Error('fixture no-effect failure'), { code: 'FIXTURE_NO_EFFECT' });
      return register(input);
    };
    if (property === 'getRun') return (taskId) => {
      getRunCalls++;
      if (getRunCalls === 2) {
        fs.renameSync = () => { throw Object.assign(new Error('fixture state write failure'), { code: 'FIXTURE_WRITE_FAILURE' }); };
      }
      return getRun(taskId);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const originalRenameSync = fs.renameSync;
  let first;
  try {
    first = (await admitConfiguredTasks({ controller: guardedController, repoRoot: f.worktree, config, cache,
      now: () => clock }))[0];
  } finally { fs.renameSync = originalRenameSync; }
  assert.equal(first.code, 'ADMISSION_HOLD_PERSIST_FAILED');
  assert.equal(registrationCalls, 1);
  const stateFile = path.join(path.dirname(controller.databasePath), 'admission-reconciliation',
    `${createHash('sha256').update(f.task.taskId).digest('hex')}.json`);
  const reservedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(reservedState.records[first.fingerprint].state, 'REGISTRATION_IN_FLIGHT');
  assert.equal(reservedState.records[first.fingerprint].attempts, 1);

  const persistenceRetry = (await admitConfiguredTasks({ controller: guardedController, repoRoot: f.worktree, config, cache: new Map(),
    now: () => clock }))[0];
  assert.equal(persistenceRetry.code, 'REGISTRATION_RETRY_BACKOFF');
  assert.equal(persistenceRetry.attempts, 1);
  assert.equal(registrationCalls, 1);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).records[persistenceRetry.fingerprint].attempts, 1);

  clock = Date.parse(persistenceRetry.retryAt) + 1;
  failWithoutEffect = false;
  const retried = (await admitConfiguredTasks({ controller: guardedController, repoRoot: f.worktree, config, cache: new Map(),
    now: () => clock }))[0];
  assert.equal(retried.code, 'TASK_REGISTRATION_CONFIRMED');
  assert.equal(registrationCalls, 2);
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);
});

test('CLI intake refuses registration when its durable attempt reservation cannot be written', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  let registrationCalls = 0;
  const guardedController = new Proxy(controller, { get(target, property) {
    if (property === 'registerTask') return (...args) => { registrationCalls++; return target.registerTask(...args); };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const originalRenameSync = fs.renameSync;
  let refused;
  try {
    fs.renameSync = () => { throw Object.assign(new Error('fixture reservation write failure'), { code: 'FIXTURE_WRITE_FAILURE' }); };
    refused = (await admitConfiguredTasks({ controller: guardedController, repoRoot: f.worktree, config,
      cache: new Map() }))[0];
  } finally { fs.renameSync = originalRenameSync; }

  assert.equal(refused.code, 'ADMISSION_HOLD_PERSIST_FAILED');
  assert.equal(registrationCalls, 0);
  assert.equal(controller.getRun(f.task.taskId), null);
});

test('CLI intake reconciles a pending unknown-effect hold when durable registration becomes readable', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const cache = new Map();
  const register = controller.registerTask.bind(controller);
  const getRun = controller.getRun.bind(controller);
  let getRunCalls = 0;
  let registrationCalls = 0;
  const uncertainController = new Proxy(controller, { get(target, property) {
    if (property === 'registerTask') return (input) => {
      registrationCalls++;
      register(input);
      throw Object.assign(new Error('fixture post-commit error'), { code: 'FIXTURE_AFTER_COMMIT' });
    };
    if (property === 'getRun') return (taskId) => {
      getRunCalls++;
      if (getRunCalls === 2) {
        fs.renameSync = () => { throw Object.assign(new Error('fixture hold write failure'), { code: 'FIXTURE_WRITE_FAILURE' }); };
        throw Object.assign(new Error('fixture durable read failure'), { code: 'FIXTURE_READ_FAILURE' });
      }
      return getRun(taskId);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const originalRenameSync = fs.renameSync;
  let uncertain;
  try {
    uncertain = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree, config, cache }))[0];
  } finally { fs.renameSync = originalRenameSync; }
  assert.equal(uncertain.code, 'ADMISSION_HOLD_PERSIST_FAILED');
  assert.equal(registrationCalls, 1);
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);

  const reconciled = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree, config, cache }))[0];
  assert.equal(reconciled.code, 'DURABLE_REGISTRATION_CONFIRMED');
  assert.equal(registrationCalls, 1);
  assert.equal(controller.getRun(f.task.taskId).cycles.length, 1);
  const db = new DatabaseSync(controller.databasePath);
  try { assert.equal(db.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE task_id=? AND event_type='TASK_REGISTERED'").get(f.task.taskId).count, 1); }
  finally { db.close(); }
});

test('CLI intake recovers a crash after registration without duplicating the durable run', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const register = controller.registerTask.bind(controller);
  const getRun = controller.getRun.bind(controller);
  let getRunCalls = 0;
  let registrationCalls = 0;
  const uncertainController = new Proxy(controller, { get(target, property) {
    if (property === 'registerTask') return (input) => {
      registrationCalls++;
      register(input);
      throw Object.assign(new Error('fixture post-commit error'), { code: 'FIXTURE_AFTER_COMMIT' });
    };
    if (property === 'getRun') return (taskId) => {
      getRunCalls++;
      if (getRunCalls === 2) throw Object.assign(new Error('fixture transient durable read failure'), { code: 'FIXTURE_READ_FAILURE' });
      return getRun(taskId);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });

  const persisted = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
    config, cache: new Map() }))[0];
  assert.equal(persisted.code, 'DURABLE_CONTROLLER_STATE_UNKNOWN');
  assert.equal(registrationCalls, 1);
  const stateFile = path.join(path.dirname(controller.databasePath), 'admission-reconciliation',
    `${createHash('sha256').update(f.task.taskId).digest('hex')}.json`);
  const stateBefore = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(stateBefore.stickyHold.fingerprint, persisted.fingerprint);
  assert.equal(stateBefore.stickyHold.phase, 'POST_REGISTRATION_ATTEMPT');
  assert.equal(stateBefore.records[persisted.fingerprint].state, 'REGISTRATION_IN_FLIGHT');
  assert.equal(stateBefore.records[persisted.fingerprint].attempts, 1);

  const reconciled = (await admitConfiguredTasks({ controller, repoRoot: f.worktree,
    config, cache: new Map() }))[0];
  assert.equal(reconciled.code, 'DURABLE_REGISTRATION_CONFIRMED');
  assert.equal(reconciled.registrationConfirmed, true);
  assert.equal(registrationCalls, 1);
  assert.equal(controller.getRun(f.task.taskId).cycles.length, 1);
  const stateAfter = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(stateAfter.stickyHold, undefined);
  assert.equal(stateAfter.records[persisted.fingerprint].state, 'REGISTRATION_CONFIRMED');
  assert.equal(stateAfter.records[persisted.fingerprint].attempts, 1);
  assert.equal(Number.isFinite(Date.parse(stateAfter.records[persisted.fingerprint].confirmedAt)), true);
  assert.equal(stateAfter.reconciledStickyHolds.at(-1).resolution, 'MATCHING_DURABLE_REGISTRATION');
  const db = new DatabaseSync(controller.databasePath);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_runs WHERE task_id=?').get(f.task.taskId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_cycles WHERE task_id=?').get(f.task.taskId).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE task_id=? AND event_type='TASK_REGISTERED'").get(f.task.taskId).count, 1);
  } finally { db.close(); }
});

test('CLI intake clears a persisted pre-registration unknown hold after authoritative absence and registers once', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const getRun = controller.getRun.bind(controller);
  const register = controller.registerTask.bind(controller);
  let getRunCalls = 0;
  let registrationCalls = 0;
  const uncertainController = new Proxy(controller, { get(target, property) {
    if (property === 'getRun') return (taskId) => {
      getRunCalls++;
      if (getRunCalls === 1) throw Object.assign(new Error('fixture pre-registration read failure'), { code: 'FIXTURE_READ_FAILURE' });
      return getRun(taskId);
    };
    if (property === 'registerTask') return (input) => { registrationCalls++; return register(input); };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });

  const first = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
    config, cache: new Map() }))[0];
  assert.equal(first.code, 'DURABLE_CONTROLLER_STATE_UNKNOWN');
  assert.equal(registrationCalls, 0);
  const stateFile = path.join(path.dirname(controller.databasePath), 'admission-reconciliation',
    `${createHash('sha256').update(f.task.taskId).digest('hex')}.json`);
  const stateBefore = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(stateBefore.stickyHold.fingerprint, first.fingerprint);
  assert.equal(stateBefore.stickyHold.phase, 'PRE_REGISTRATION_LOOKUP');

  const recovered = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
    config, cache: new Map() }))[0];
  assert.equal(recovered.code, 'TASK_REGISTRATION_CONFIRMED');
  assert.equal(recovered.registrationConfirmed, true);
  assert.equal(registrationCalls, 1);
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);
  const stateAfter = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(stateAfter.stickyHold, undefined);
  assert.equal(stateAfter.reconciledStickyHolds.at(-1).resolution, 'AUTHORITATIVE_ABSENCE_PRE_REGISTRATION');
});

test('CLI intake converts post-registration authoritative absence to bounded retry without a hot re-register', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const getRun = controller.getRun.bind(controller);
  const register = controller.registerTask.bind(controller);
  let getRunCalls = 0;
  let registrationCalls = 0;
  let clock = Date.parse('2030-01-01T00:00:00.000Z');
  let failWithoutEffect = true;
  const uncertainController = new Proxy(controller, { get(target, property) {
    if (property === 'getRun') return (taskId) => {
      getRunCalls++;
      if (getRunCalls === 2) throw Object.assign(new Error('fixture transient durable read failure'), { code: 'FIXTURE_READ_FAILURE' });
      return getRun(taskId);
    };
    if (property === 'registerTask') return (input) => {
      registrationCalls++;
      if (failWithoutEffect) throw Object.assign(new Error('fixture pre-commit failure'), { code: 'FIXTURE_NO_EFFECT' });
      return register(input);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });

  const unknown = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
    config, cache: new Map(), now: () => clock }))[0];
  assert.equal(unknown.code, 'DURABLE_CONTROLLER_STATE_UNKNOWN');
  assert.equal(registrationCalls, 1);
  const stateFile = path.join(path.dirname(controller.databasePath), 'admission-reconciliation',
    `${createHash('sha256').update(f.task.taskId).digest('hex')}.json`);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).stickyHold.phase, 'POST_REGISTRATION_ATTEMPT');

  const absent = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
    config, cache: new Map(), now: () => clock }))[0];
  assert.equal(absent.code, 'REGISTRATION_RETRY_BACKOFF');
  assert.equal(absent.attempts, 1);
  assert.equal(registrationCalls, 1);
  assert.equal(controller.getRun(f.task.taskId), null);
  const stateAfterAbsence = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(stateAfterAbsence.stickyHold, undefined);
  assert.equal(stateAfterAbsence.records[unknown.fingerprint].state, 'RETRY_WAIT');
  assert.equal(stateAfterAbsence.records[unknown.fingerprint].attempts, 1);
  assert.equal(stateAfterAbsence.reconciledStickyHolds.at(-1).resolution, 'AUTHORITATIVE_ABSENCE_POST_REGISTRATION');

  clock = Date.parse(absent.retryAt) + 1;
  failWithoutEffect = false;
  const retried = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
    config, cache: new Map(), now: () => clock }))[0];
  assert.equal(retried.code, 'TASK_REGISTRATION_CONFIRMED');
  assert.equal(registrationCalls, 2);
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);
});

test('CLI intake keeps legacy and mismatched unknown holds fail-closed', async (t) => {
  for (const [label, mutateHold] of [
    ['legacy hold without phase', (hold) => { delete hold.phase; }],
    ['hold with a different fingerprint', (hold) => { hold.fingerprint = 'f'.repeat(64); }],
  ]) {
    await t.test(label, async (st) => {
      const f = candidateFixture(st);
      const controller = await openDeliveryController({ repoRoot: f.worktree });
      f.cleanupHooks.push(() => controller.close());
      const config = intakeConfig(f);
      const getRun = controller.getRun.bind(controller);
      const register = controller.registerTask.bind(controller);
      let firstRead = true;
      let registrationCalls = 0;
      const uncertainController = new Proxy(controller, { get(target, property) {
        if (property === 'getRun') return (taskId) => {
          if (firstRead) {
            firstRead = false;
            throw Object.assign(new Error('fixture pre-registration read failure'), { code: 'FIXTURE_READ_FAILURE' });
          }
          return getRun(taskId);
        };
        if (property === 'registerTask') return (input) => { registrationCalls++; return register(input); };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      const first = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
        config, cache: new Map() }))[0];
      assert.equal(first.code, 'DURABLE_CONTROLLER_STATE_UNKNOWN');
      const stateFile = path.join(path.dirname(controller.databasePath), 'admission-reconciliation',
        `${createHash('sha256').update(f.task.taskId).digest('hex')}.json`);
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      mutateHold(state.stickyHold);
      fs.writeFileSync(stateFile, JSON.stringify(state));

      const stillHeld = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
        config, cache: new Map() }))[0];
      assert.equal(stillHeld.code, 'DURABLE_CONTROLLER_STATE_UNKNOWN');
      assert.equal(stillHeld.hold, true);
      assert.equal(registrationCalls, 0);
      assert.equal(controller.getRun(f.task.taskId), null);
    });
  }
});

test('CLI intake clears a legacy phase-less unknown hold only after matching durable registration is read', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const readiness = preflightTask({ repo: f.worktree, taskFile: f.taskFile, base: f.baseCommit });
  controller.registerTask({ taskRecord: f.task, preflightResult: readiness, worktreeRoot: f.worktree,
    trustedMandateBinding: config.tasks[0].trustedMandateBinding });
  const getRun = controller.getRun.bind(controller);
  let firstRead = true;
  let registrationCalls = 0;
  const uncertainController = new Proxy(controller, { get(target, property) {
    if (property === 'getRun') return (taskId) => {
      if (firstRead) {
        firstRead = false;
        throw Object.assign(new Error('fixture pre-registration read failure'), { code: 'FIXTURE_READ_FAILURE' });
      }
      return getRun(taskId);
    };
    if (property === 'registerTask') return (input) => { registrationCalls++; return target.registerTask(input); };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });

  const unknown = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
    config, cache: new Map() }))[0];
  assert.equal(unknown.code, 'DURABLE_CONTROLLER_STATE_UNKNOWN');
  const stateFile = path.join(path.dirname(controller.databasePath), 'admission-reconciliation',
    `${createHash('sha256').update(f.task.taskId).digest('hex')}.json`);
  const stateBefore = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  delete stateBefore.stickyHold.phase;
  fs.writeFileSync(stateFile, JSON.stringify(stateBefore));

  const reconciled = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
    config, cache: new Map() }))[0];
  assert.equal(reconciled.code, 'DURABLE_REGISTRATION_CONFIRMED');
  assert.equal(reconciled.registrationConfirmed, true);
  assert.equal(registrationCalls, 0);
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);
  const stateAfter = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(stateAfter.stickyHold, undefined);
  assert.equal(stateAfter.reconciledStickyHolds.at(-1).hold.phase, undefined);
  assert.equal(stateAfter.reconciledStickyHolds.at(-1).resolution, 'MATCHING_DURABLE_REGISTRATION');
  const db = new DatabaseSync(controller.databasePath);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE task_id=? AND event_type='TASK_REGISTERED'")
      .get(f.task.taskId).count, 1);
  } finally { db.close(); }
});

test('repeated intake confirmation preserves suppression after a runner pre-claim failure', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const cache = new Map();
  const initial = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache }))[0];
  assert.equal(initial.code, 'TASK_REGISTRATION_CONFIRMED');
  assert.equal(controller.getRun(f.task.taskId).state, 'WORKER_READY');
  assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);

  let preClaimAttempts = 0;
  let backendCalls = 0;
  const runner = createControllerRunner({ controller, repoRoot: f.worktree,
    stateRoot: path.join(f.worktree, '.git', 'runner-intake-confirmation'),
    config: { tasks: [{ ...config.tasks[0], branch: 'codex/fixture' }] },
    campaignDeadlineGuard: () => { preClaimAttempts++; return false; },
    backend: async () => { backendCalls++; throw new Error('BACKEND_MUST_NOT_START'); } });
  try {
    const first = await runner.tick();
    assert.equal(first.active, 1);
    await runner.drain();
    const suppressed = await runner.tick();
    assert.equal(suppressed.active, 0);
    assert.equal(suppressed.errors.length, 1);
    assert.equal(preClaimAttempts, 1);

    for (let poll = 0; poll < 3; poll++) {
      const confirmation = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache, runner }))[0];
      assert.equal(confirmation.code, 'DURABLE_REGISTRATION_CONFIRMED');
      assert.equal(confirmation.currentCycle, 1);
      const tick = await runner.tick();
      assert.equal(tick.active, 0);
      assert.deepEqual(tick.errors, []);
      await runner.drain();
      assert.equal(preClaimAttempts, 1);
    }
    assert.equal(backendCalls, 0);
    assert.equal(controller.getRun(f.task.taskId).currentCycle, 1);
    assert.equal(controller.nextReadyNodes().length, 1);
  } finally { await runner.stop(); }
});

test('CLI intake keeps the bounded retry cap stable across unrelated run-state changes', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const register = controller.registerTask.bind(controller);
  let calls = 0;
  let clock = Date.parse('2030-01-01T00:00:00.000Z');
  controller.registerTask = (input) => {
    if (input.taskRecord.taskId === f.task.taskId) {
      calls++;
      throw Object.assign(new Error('fixture no-effect error'), { code: 'FIXTURE_NO_EFFECT' });
    }
    return register(input);
  };

  const observation = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config,
    cache: new Map(), now: () => clock }))[0];
  assert.equal(observation.code, 'REGISTRATION_RETRY_BACKOFF');
  assert.equal(observation.attempts, 1);

  const unrelatedTask = { ...f.task, taskId: 'UNRELATED-CONTROLLER-STATE', writeScope: ['src/unrelated/'],
    dependencies: [{ taskId: 'DEP-OPEN' }] };
  const unrelatedTaskFile = path.join(f.worktree, '.git', 'unrelated-task.json');
  fs.writeFileSync(unrelatedTaskFile, JSON.stringify(unrelatedTask));
  const unrelatedMandate = { resolvedBy: 'root', taskId: unrelatedTask.taskId, repositoryRoot: f.worktree,
    objective: unrelatedTask.objective, domainOrFeatureKey: 'test/unrelated-controller-state',
    writeScope: unrelatedTask.writeScope, sourceRef: 'unrelated retry fixture',
    authorizedEffects: ['local fixture changes'], prohibitions: ['external effects'] };
  const unrelatedPreflight = preflightTask({ repo: f.worktree, taskFile: unrelatedTaskFile, base: f.baseCommit });
  assert.equal(unrelatedPreflight.status, 'BLOCKED_DEPENDENCY');
  const blockedUnrelated = register({ taskRecord: unrelatedTask, preflightResult: unrelatedPreflight,
    worktreeRoot: f.worktree, trustedMandateBinding: unrelatedMandate });
  assert.equal(blockedUnrelated.state, 'BLOCKED_DEPENDENCY');

  const afterUnrelatedRegistration = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config,
    cache: new Map(), now: () => clock }))[0];
  assert.equal(afterUnrelatedRegistration.code, 'REGISTRATION_RETRY_BACKOFF');
  assert.equal(afterUnrelatedRegistration.attempts, 1);
  assert.equal(afterUnrelatedRegistration.fingerprint, observation.fingerprint);
  assert.equal(calls, 1);

  fs.writeFileSync(unrelatedTaskFile, JSON.stringify({ ...unrelatedTask, dependencies: [] }));
  const readyUnrelatedPreflight = preflightTask({ repo: f.worktree, taskFile: unrelatedTaskFile, base: f.baseCommit });
  assert.equal(readyUnrelatedPreflight.status, 'READY');
  const readyUnrelated = register({ taskRecord: { ...unrelatedTask, dependencies: [] },
    preflightResult: readyUnrelatedPreflight, worktreeRoot: f.worktree, trustedMandateBinding: unrelatedMandate });
  assert.equal(readyUnrelated.state, 'WORKER_READY');

  const afterUnrelatedStateChange = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config,
    cache: new Map(), now: () => clock }))[0];
  assert.equal(afterUnrelatedStateChange.code, 'REGISTRATION_RETRY_BACKOFF');
  assert.equal(afterUnrelatedStateChange.attempts, 1);
  assert.equal(afterUnrelatedStateChange.fingerprint, observation.fingerprint);
  assert.equal(calls, 1);

  clock = Date.parse(observation.retryAt);
  const second = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config,
    cache: new Map(), now: () => clock }))[0];
  assert.equal(second.code, 'REGISTRATION_RETRY_BACKOFF');
  assert.equal(second.attempts, 2);
  assert.equal(second.fingerprint, observation.fingerprint);
  clock = Date.parse(second.retryAt);
  const exhausted = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config,
    cache: new Map(), now: () => clock }))[0];
  assert.equal(exhausted.attempts, 3);
  assert.equal(exhausted.fingerprint, observation.fingerprint);
  const again = (await admitConfiguredTasks({ controller, repoRoot: f.worktree, config,
    cache: new Map(), now: () => clock }))[0];
  assert.equal(again.code, 'REGISTRATION_RETRY_EXHAUSTED');
  assert.equal(calls, 3);

  const stateFile = path.join(path.dirname(controller.databasePath), 'admission-reconciliation',
    `${createHash('sha256').update(f.task.taskId).digest('hex')}.json`);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.records[exhausted.fingerprint].state, 'HOLD_RETRY_EXHAUSTED');
  assert.equal(state.records[exhausted.fingerprint].attempts, 3);
  assert.equal(state.records[exhausted.fingerprint].retryAt, null);
});

test('CLI intake holds a task when durable state is unknown and runner does not dispatch it', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = intakeConfig(f);
  const readiness = preflightTask({ repo: f.worktree, taskFile: f.taskFile, base: f.baseCommit });
  controller.registerTask({ taskRecord: f.task, preflightResult: readiness, worktreeRoot: f.worktree,
    trustedMandateBinding: config.tasks[0].trustedMandateBinding });
  const uncertainController = new Proxy(controller, { get(target, property) {
    if (property === 'getRun') return () => { throw Object.assign(new Error('fixture unreadable state'), { code: 'FIXTURE_UNKNOWN' }); };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  let backendCalls = 0;
  const runner = createControllerRunner({ controller: uncertainController, repoRoot: f.worktree,
    stateRoot: path.join(f.worktree, '.git', 'runner-intake-hold'),
    config: { tasks: [{ ...config.tasks[0], branch: 'codex/fixture' }] },
    backend: async () => { backendCalls++; throw new Error('BACKEND_MUST_NOT_START'); } });
  try {
    const held = (await admitConfiguredTasks({ controller: uncertainController, repoRoot: f.worktree,
      config, cache: new Map(), runner }))[0];
    assert.equal(held.code, 'DURABLE_CONTROLLER_STATE_UNKNOWN');
    assert.equal(held.hold, true);
    assert.equal(controller.nextReadyNodes().length, 1);
    const tick = await runner.tick();
    assert.equal(tick.active, 0);
    assert.deepEqual(tick.errors, []);
    assert.equal(backendCalls, 0);
    assert.equal(controller.nextReadyNodes().length, 1);
  } finally { await runner.stop(); }
});

test('CLI intake persists dependency-blocked task and wakes after accepted base evidence changes', async (t) => {
  const f = candidateFixture(t);
  f.git(['update-ref', 'refs/remotes/origin/main', f.baseCommit]);
  const task = { ...f.task, dependencies: [{ taskId: 'DEP-OPEN' }] };
  fs.writeFileSync(f.taskFile, JSON.stringify(task));
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const config = { tasks: [{ taskId: task.taskId, worktree: f.worktree, taskFile: f.taskFile,
    trustedMandateBinding: { resolvedBy: 'root', taskId: task.taskId, repositoryRoot: f.worktree,
      objective: task.objective, domainOrFeatureKey: `test/${task.taskId.toLowerCase()}`, writeScope: task.writeScope, sourceRef: 'trusted fixture',
      authorizedEffects: ['fixture checks'], prohibitions: ['external effects'] } }] };
  const cache = new Map();
  await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache });
  assert.equal(controller.getRun(task.taskId).state, 'BLOCKED_DEPENDENCY');
  assert.equal(controller.getRun(task.taskId).currentCycle, 0);
  const roadmap = path.join(f.worktree, 'docs/roadmap/ROADMAP.md');
  fs.writeFileSync(roadmap, fs.readFileSync(roadmap, 'utf8').replace('DEP-DONE', 'DEP-OPEN'));
  f.git(['add', 'docs/roadmap/ROADMAP.md']); f.git(['commit', '-qm', 'accepted dependency evidence']);
  f.git(['update-ref', 'refs/remotes/origin/main', f.git(['rev-parse', 'HEAD'])]);
  await admitConfiguredTasks({ controller, repoRoot: f.worktree, config, cache });
  assert.equal(controller.getRun(task.taskId).state, 'WORKER_READY');
  assert.equal(controller.getRun(task.taskId).currentCycle, 1);
});

test('runner schedules two workers and one independent gate from machine-policy role capacities', async (t) => {
  const f = candidateFixture(t);
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  const tasks = [];
  const bindings = [];
  for (const label of ['A', 'B', 'C']) {
    const worktree = path.join(f.worktree, '.git', `role-capacity-${label}`);
    f.git(['worktree', 'add', '-b', `codex/role-capacity-${label}`, worktree, f.baseCommit]);
    const task = { ...f.task, taskId: `ROLE-CAPACITY-${label}`, writeScope: [`src/${label.toLowerCase()}.txt`] };
    const taskFile = path.join(f.worktree, '.git', `role-capacity-${label}.json`);
    fs.writeFileSync(taskFile, JSON.stringify(task));
    const ready = preflightTask({ repo: worktree, taskFile, base: f.baseCommit });
    assert.equal(ready.status, 'READY');
    controller.registerTask({ taskRecord: task, preflightResult: ready, worktreeRoot: worktree,
      trustedMandateBinding: { resolvedBy: 'root', taskId: task.taskId, repositoryRoot: f.worktree,
        objective: task.objective, domainOrFeatureKey: `test/role-capacity-${label.toLowerCase()}`,
        writeScope: task.writeScope, sourceRef: 'trusted isolated role-capacity fixture',
        authorizedEffects: ['local fixture changes'], prohibitions: ['external effects'] } });
    tasks.push({ task, worktree, taskFile });
    bindings.push({ taskId: task.taskId, worktree, taskFile });
  }

  const candidate = tasks[2];
  const workerLease = controller.claimNode({ taskId: candidate.task.taskId, nodeId: 'worker', ownerId: 'fixture-worker' });
  controller.recordDispatchIntent({ lease: workerLease, operationId: 'role-capacity-candidate', inputDigest: 'c'.repeat(64) });
  const workerSession = randomUUID();
  controller.recordBackendHandle({ lease: workerLease, sessionId: workerSession, model: 'gpt-6-luna', effort: 'max' });
  fs.writeFileSync(path.join(candidate.worktree, 'src', 'c.txt'), 'candidate for exact-head gate');
  f.git(['-C', candidate.worktree, 'add', 'src/c.txt']);
  f.git(['-C', candidate.worktree, 'commit', '-m', 'role capacity verifier candidate']);
  controller.completeNode({ lease: workerLease, result: { role: 'worker', verdict: 'PASS', headCommit: f.git(['-C', candidate.worktree, 'rev-parse', 'HEAD']),
    sessionId: workerSession, model: 'gpt-6-luna', effort: 'max', resultDigest: 'd'.repeat(64), evidenceRef: 'test://role-capacity-candidate' } });

  const pending = [];
  const seen = [];
  let signalTwoStarted;
  let signalThreeStarted;
  const twoStarted = new Promise((resolve) => { signalTwoStarted = resolve; });
  const threeStarted = new Promise((resolve) => { signalThreeStarted = resolve; });
  const runner = createControllerRunner({ controller, repoRoot: f.worktree, stateRoot: path.join(f.worktree, '.git/runner-role-capacity'),
    config: { tasks: bindings, maxConcurrent: 2 },
    backend: async ({ role, worktree, artifactDir, onSession, signal }) => {
      fs.mkdirSync(artifactDir, { recursive: true });
      const sessionId = randomUUID();
      await onSession({ sessionId, model: 'gpt-6-luna', effort: 'max' });
      seen.push({ role, worktree, sessionId });
      return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(result);
        };
        const onAbort = () => finish({ outcome: 'UNKNOWN', effectState: 'NONE', code: 'fixture-aborted' });
        pending.push(finish);
        if (seen.length >= 2) signalTwoStarted();
        if (seen.length >= 3) signalThreeStarted();
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    } });
  const timeouts = [];
  const waitFor = (promise) => Promise.race([promise, new Promise((_, reject) => {
    timeouts.push(setTimeout(() => reject(new Error('ROLE_CAPACITY_DISPATCH_TIMEOUT')), 5000));
  })]);
  try {
    const firstTick = await runner.tick();
    assert.equal(firstTick.active, 2);
    await waitFor(twoStarted);
    const secondTick = await runner.tick();
    assert.equal(secondTick.active, 3);
    await waitFor(threeStarted);
    assert.deepEqual(seen.map((entry) => entry.role).sort(), ['verifier', 'worker', 'worker']);
    assert.equal(runner.activeCount(), 3);
    assert.deepEqual(controller.nextReadyNodes(), []);
    for (const resolve of pending) resolve({ outcome: 'UNKNOWN', effectState: 'NONE', code: 'fixture-release' });
    await runner.drain();
    assert.equal(runner.activeCount(), 0);
    assert.deepEqual(controller.nextReadyNodes(), []);
  } finally {
    for (const timeout of timeouts) clearTimeout(timeout);
    for (const resolve of pending) resolve({ outcome: 'UNKNOWN', effectState: 'NONE', code: 'fixture-cleanup' });
    await runner.stop();
  }
});

test('runner advances two isolated branches through distinct role sessions and durable root-ready state', async (t) => {
  const f = candidateFixture(t);
  const bindings = [];
  const controller = await openDeliveryController({ repoRoot: f.worktree });
  f.cleanupHooks.push(() => controller.close());
  for (const label of ['A', 'B']) {
    const worktree = path.join(f.worktree, '.git', `fixture-${label}`);
    f.git(['worktree', 'add', '-b', `codex/task-${label}`, worktree, f.baseCommit]);
    const task = { ...f.task, taskId: `PIPELINE-${label}`, writeScope: [`src/${label}.txt`] };
    const taskFile = path.join(f.worktree, '.git', `task-${label}.json`);
    fs.writeFileSync(taskFile, JSON.stringify(task));
    const preflightResult = preflightTask({ repo: worktree, taskFile, base: f.baseCommit });
    assert.equal(preflightResult.status, 'READY');
    controller.registerTask({ taskRecord: task, preflightResult, worktreeRoot: worktree,
      trustedMandateBinding: { resolvedBy: 'root', taskId: task.taskId, repositoryRoot: f.worktree,
        objective: task.objective, domainOrFeatureKey: `test/${task.taskId.toLowerCase()}`, writeScope: task.writeScope, sourceRef: 'trusted isolated test',
        authorizedEffects: ['local fixture changes'], prohibitions: ['external effects'] } });
    bindings.push({ taskId: task.taskId, worktree, taskFile });
  }
  const seen = [];
  const runner = createControllerRunner({ controller, repoRoot: f.worktree,
    stateRoot: path.join(f.worktree, '.git/runner'), config: { tasks: bindings, maxConcurrent: 2 },
    backend: async ({ role, worktree, artifactDir, onSession }) => {
      fs.mkdirSync(artifactDir, { recursive: true });
      const sessionId = randomUUID(); await onSession({ sessionId, model: 'gpt-6-luna', effort: 'max' });
      if (role === 'worker') {
        const label = worktree.endsWith('A') ? 'A' : 'B';
        fs.writeFileSync(path.join(worktree, `src/${label}.txt`), 'isolated fixture');
      }
      const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).trim();
      seen.push({ role, sessionId });
      const checkSha256 = createHash('sha256').update(JSON.stringify(f.task.checks[0])).digest('hex');
      return { outcome: 'PASS', headCommit, sessionId, model: 'gpt-6-luna', effort: 'max', evidence: ['synthetic fixture only'], resultDigest: 'b'.repeat(64),
        checkTrace: { status: 'PASS', traceSha256: 'd'.repeat(64), checks: [{ checkIndex: 0, checkSha256, cwdProvenance: 'launch_cwd', invocationCount: 1,
          status: 'PASS', invocations: [{ itemIdSha256: 'e'.repeat(64), cwdProvenance: 'launch_cwd', exitCode: 0 }] }] } };
    } });
  for (let round = 0; round < 5; round++) {
    const tick = await runner.tick(); assert.deepEqual(tick.errors, []);
    await runner.drain();
  }
  await runner.stop();
  assert.equal(seen.length, 6, JSON.stringify(controller.listRuns().map(({ taskId, state, stages, blockers }) => ({ taskId, state, stages, blockers })), null, 2));
  assert.equal(new Set(seen.map((item) => item.sessionId)).size, 6);
  assert.deepEqual(controller.listRuns().map((run) => run.state), ['ROOT_DELIVERY_READY', 'ROOT_DELIVERY_READY']);
  for (const run of controller.listRuns()) {
    assert.ok(controller.getRun(run.taskId).stages.every((stage) => stage.evidenceRef.includes('check-trace.json#PASS:' + 'd'.repeat(64))));
  }
});

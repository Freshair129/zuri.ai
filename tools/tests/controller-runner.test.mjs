import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
      return { outcome: 'PASS', headCommit, sessionId, model: 'gpt-6-luna', effort: 'max', evidence: ['synthetic fixture only'], resultDigest: 'b'.repeat(64) };
    } });
  for (let round = 0; round < 5; round++) {
    const tick = await runner.tick(); assert.deepEqual(tick.errors, []);
    await runner.drain();
  }
  await runner.stop();
  assert.equal(seen.length, 6); assert.equal(new Set(seen.map((item) => item.sessionId)).size, 6);
  assert.deepEqual(controller.listRuns().map((run) => run.state), ['ROOT_DELIVERY_READY', 'ROOT_DELIVERY_READY']);
});

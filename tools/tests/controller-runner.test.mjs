import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createControllerRunner, rolePrompt, commitWorkerCandidate } from '../delivery-control/controller-runner.mjs';
import { openDeliveryController } from '../delivery-control/controller.mjs';
import { preflightTask } from '../delivery-control/preflight.mjs';

test('role prompts keep merge and provider effects outside worker authority', () => {
  for (const role of ['worker', 'verifier', 'reviewer']) {
    const prompt = rolePrompt({ node: { role, taskId: 'TEST', stage: 'TEST' }, task: { objective: 'Bounded work' } });
    assert.match(prompt, /No production, Supabase/);
    assert.match(prompt, /No additional agents/);
    assert.match(prompt, /Do not.*merge/);
  }
});
test('unchanged pre-claim errors are reported once and suppressed without spawning', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-runner-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'task.json'); fs.writeFileSync(file, '{}');
  let calls = 0;
  const runner = createControllerRunner({ controller: { nextReadyNodes: () => [{ taskId: 'T1', branch: 'dev', inputDigest: 'same' }] },
    repoRoot: temp, stateRoot: temp, config: { tasks: [{ taskId: 'T1', taskFile: file, worktree: path.join(temp, 'missing') }] },
    backend: () => { calls++; } });
  assert.equal((await runner.tick()).active, 1);
  await runner.drain();
  const second = await runner.tick();
  assert.equal(second.errors.length, 1); assert.equal(second.active, 0);
  assert.equal((await runner.tick()).errors.length, 0); assert.equal(calls, 0);
  await runner.stop();
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
        objective: task.objective, writeScope: task.writeScope, sourceRef: 'trusted isolated test',
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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { baseAdvancedResumeSignature, prepareBaseAdvancedResume, readConfiguredRemoteBase } from '../delivery-control/base-advanced-resume.mjs';

const git = (cwd, argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', shell: false,
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture(t, { conflict = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-base-advanced-'));
  t.after(() => {
    assert.ok(path.resolve(tmp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Base Advance Test']);
  git(repoRoot, ['config', 'user.email', 'base-advance@example.invalid']);
  if (conflict) {
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'src', 'conflict.txt'), 'base\n');
    git(repoRoot, ['add', 'src/conflict.txt']);
  }
  git(repoRoot, ['commit', '--allow-empty', '-m', 'old base']);
  const oldBaseCommit = git(repoRoot, ['rev-parse', 'HEAD']);
  const remote = path.join(tmp, 'origin.git');
  git(tmp, ['init', '--bare', remote]);
  git(repoRoot, ['remote', 'add', 'origin', remote]);
  git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  const worktree = path.join(tmp, 'candidate');
  const branch = 'codex/task-base-advanced';
  git(repoRoot, ['worktree', 'add', '-b', branch, worktree, oldBaseCommit]);
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'src', 'candidate.mjs'), 'export const candidate = true;\n');
  if (conflict) fs.writeFileSync(path.join(worktree, 'src', 'conflict.txt'), 'candidate\n');
  git(worktree, ['add', 'src']);
  git(worktree, ['commit', '-m', 'reviewed candidate']);
  const oldHeadCommit = git(worktree, ['rev-parse', 'HEAD']);

  if (conflict) fs.writeFileSync(path.join(repoRoot, 'src', 'conflict.txt'), 'upstream\n');
  else fs.writeFileSync(path.join(repoRoot, 'upstream.txt'), 'accepted upstream change\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-m', 'advance base']);
  const newBaseCommit = git(repoRoot, ['rev-parse', 'HEAD']);
  git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

  const privateRoot = path.join(repoRoot, '.git', 'zuri-delivery-control');
  const taskRoot = path.join(privateRoot, 'tasks');
  const stateRoot = path.join(privateRoot, 'supervisors', 'test-campaign');
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.mkdirSync(stateRoot, { recursive: true });
  const task = { schemaVersion: 'task-readiness/v1', taskId: 'TASK-BASE-ADVANCED',
    objective: 'Reassess a reviewed candidate against a newly accepted base.',
    acceptance: ['Resume in the same cycle after a verified merge.'], writeScope: ['src/'], checks: [],
    mandateReference: 'fixture://root-task' };
  const taskFile = path.join(taskRoot, `${task.taskId}.json`);
  fs.writeFileSync(taskFile, JSON.stringify(task));
  const trustedMandateBinding = { resolvedBy: 'root', taskId: task.taskId, sourceRef: 'fixture://root-task' };
  const binding = { taskId: task.taskId, worktree, branch, taskFile, trustedMandateBinding };
  const run = { taskId: task.taskId, state: 'ROOT_INTEGRATED_PENDING_CI', currentCycle: 3,
    baseCommit: oldBaseCommit, candidateHeadCommit: oldHeadCommit, initialHeadCommit: oldBaseCommit,
    branch, worktreeRoot: worktree, taskRecord: task, trustedMandateBinding,
    stages: ['worker', 'verifier', 'reviewer'].map((role) => ({ role, status: 'PASSED', effectState: 'APPLIED' })) };
  const cycle = { cycle_no: run.currentCycle, state: 'INTEGRATED', started_at: '2026-10-15T00:00:00.000Z',
    deadline_at: '2026-10-15T00:30:00.000Z', paused_at: null,
    submissions: 4, implementation_repairs: 1, tool_retries: 2 };
  const unknown = { activeLeases: [], unknownEffects: [], unknownNodes: [] };
  let baseAdvancedDisposition = null;
  let dispositionCalls = 0;
  const controller = {
    getRun: () => run,
    inspectBaseAdvancedPause: () => ({ run, cycle, baseAdvancedDisposition, ...unknown }),
    recordBaseAdvancedDisposition(input) {
      assert.equal(input.taskId, run.taskId);
      assert.equal(input.cycleNo, run.currentCycle);
      assert.equal(input.expectedBaseCommit, oldBaseCommit);
      assert.equal(input.expectedCandidateHeadCommit, oldHeadCommit);
      dispositionCalls++;
      if (run.state === 'ROOT_INTEGRATED_PENDING_CI') {
        run.state = 'BLOCKED_STALE_CANDIDATE';
        cycle.state = 'BLOCKED';
        cycle.paused_at = '2026-10-15T00:05:00.000Z';
      }
      baseAdvancedDisposition = { disposition: 'YIELD_REASSESS', basis: 'MATERIAL_NEW_EVIDENCE', source: 'BASE_ADVANCED',
        oldBaseCommit, oldHeadCommit, observedBaseCommit: input.observedBaseCommit,
        checkpoint: input.checkpoint, evidenceRef: input.evidenceRef };
      return run;
    },
  };
  const checkpoint = { status: 'ROOT_REPLAN_PAUSED', code: 'BASE_ADVANCED', taskId: task.taskId,
    expectedBaseCommit: oldBaseCommit, actualBaseCommit: newBaseCommit, candidateHeadCommit: oldHeadCommit, number: 17 };
  const runner = { resumeCalls: 0, isActive: () => false, resumeTask() { this.resumeCalls++; } };
  const args = { repoRoot, privateRoot, stateRoot, campaignId: 'test-campaign', binding,
    checkpoint, controller, runner, baseRef: 'origin/main' };
  return { repoRoot, privateRoot, stateRoot, worktree, remote, branch, task, taskFile, binding,
    oldBaseCommit, oldHeadCommit, newBaseCommit, run, cycle, unknown, controller, checkpoint, runner, args,
    get baseAdvancedDisposition() { return baseAdvancedDisposition; }, get dispositionCalls() { return dispositionCalls; } };
}

function preservedCycle(cycle) {
  return { cycle_no: cycle.cycle_no, started_at: cycle.started_at, deadline_at: cycle.deadline_at,
    submissions: cycle.submissions, implementation_repairs: cycle.implementation_repairs,
    tool_retries: cycle.tool_retries };
}

function heldReconciliations(f) {
  const attemptDir = path.join(f.stateRoot, 'base-advanced-resume', f.task.taskId, 'cycle-3');
  return fs.readdirSync(attemptDir).filter((name) => name.startsWith('reconciliation-'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(attemptDir, name), 'utf8')));
}

function assertNoPreparedReceiptOrResume(f) {
  assert.equal(fs.existsSync(path.join(f.stateRoot, 'prepared')), false);
  assert.equal(f.runner.resumeCalls, 0);
}

test('BASE_ADVANCED fetches the confirmed remote base, journals disposition, merges ordinarily, and binds receipt to same cycle', async (t) => {
  const f = fixture(t);
  const operations = [];
  const result = await prepareBaseAdvancedResume({ ...f.args,
    mergeBase: ({ repo, newBaseCommit }) => {
      operations.push(['merge', '--no-edit', '--no-ff', newBaseCommit]);
      git(repo, ['merge', '--no-edit', '--no-ff', newBaseCommit]);
    } });
  assert.equal(result.status, 'READY_TO_RESUME');
  assert.equal(result.receipt.taskId, f.task.taskId);
  assert.equal(result.receipt.cycleNo, 3);
  assert.equal(result.receipt.oldHeadCommit, f.oldHeadCommit);
  assert.equal(result.receipt.oldBaseCommit, f.oldBaseCommit);
  assert.equal(result.receipt.newBaseCommit, f.newBaseCommit);
  assert.equal(git(f.worktree, ['rev-parse', 'HEAD']), result.receipt.headCommit);
  assert.deepEqual(git(f.worktree, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1), [f.oldHeadCommit, f.newBaseCommit]);
  assert.deepEqual(operations, [['merge', '--no-edit', '--no-ff', f.newBaseCommit]]);
  assert.equal(f.run.state, 'BLOCKED_STALE_CANDIDATE');
  assert.equal(f.dispositionCalls, 1);
  assert.equal(f.baseAdvancedDisposition.disposition, 'YIELD_REASSESS');
  assert.equal(f.baseAdvancedDisposition.basis, 'MATERIAL_NEW_EVIDENCE');
  assert.equal(f.cycle.submissions, 4);
  assert.equal(f.cycle.implementation_repairs, 1);
  assert.equal(f.cycle.tool_retries, 2);
  const intentFiles = fs.readdirSync(path.join(f.stateRoot, 'base-advanced-resume', f.task.taskId, 'cycle-3'));
  const mergeIntentName = intentFiles.find((name) => name.startsWith('merge-intent-'));
  const mergeIntent = JSON.parse(fs.readFileSync(path.join(f.stateRoot, 'base-advanced-resume', f.task.taskId, 'cycle-3', mergeIntentName)));
  assert.equal(mergeIntent.operation, 'git merge --no-edit --no-ff');
  assert.equal(await readConfiguredRemoteBase({ repo: f.worktree, baseRef: 'origin/main' }), f.newBaseCommit);
});

test('restart after reconciliation journal recreates receipt without repeating the merge', async (t) => {
  const f = fixture(t);
  let merges = 0;
  const mergeBase = ({ repo, newBaseCommit }) => { merges++; git(repo, ['merge', '--no-edit', '--no-ff', newBaseCommit]); };
  const first = await prepareBaseAdvancedResume({ ...f.args, mergeBase });
  fs.unlinkSync(first.receiptFile); // Model a process stop after reconciliation but before the receipt write.
  const recovered = await prepareBaseAdvancedResume({ ...f.args, mergeBase });
  assert.equal(merges, 1);
  assert.equal(recovered.status, 'READY_TO_RESUME');
  assert.equal(recovered.receipt.cycleNo, 3);
  assert.equal(recovered.receipt.oldHeadCommit, f.oldHeadCommit);
  assert.equal(recovered.receipt.headCommit, git(f.worktree, ['rev-parse', 'HEAD']));
  assert.equal(f.dispositionCalls, 1);
});

test('restart proves an exact merge after crash before reconciliation and journals it without retry', async (t) => {
  const f = fixture(t);
  const cycleBefore = preservedCycle(f.cycle);
  let reads = 0; let merges = 0;
  const readRemoteBase = async ({ repo, baseRef }) => {
    reads++;
    if (reads === 4) throw new Error('simulated stop after merge before reconciliation');
    return readConfiguredRemoteBase({ repo, baseRef });
  };
  const mergeBase = ({ repo, newBaseCommit }) => { merges++; git(repo, ['merge', '--no-edit', '--no-ff', newBaseCommit]); };
  const input = { ...f.args, readRemoteBase, mergeBase };
  await assert.rejects(prepareBaseAdvancedResume(input), /BASE_ADVANCED_REMOTE_UNCERTAIN_AFTER_MERGE/);
  const mergedHead = git(f.worktree, ['rev-parse', 'HEAD']);
  assert.deepEqual(git(f.worktree, ['rev-list', '--parents', '-n', '1', mergedHead]).split(' ').slice(1),
    [f.oldHeadCommit, f.newBaseCommit]);
  assert.equal(fs.existsSync(path.join(f.stateRoot, 'prepared')), false);
  assert.equal(fs.readdirSync(path.join(f.stateRoot, 'base-advanced-resume', f.task.taskId, 'cycle-3'))
    .some((name) => name.startsWith('reconciliation-')), false);
  assert.equal(f.runner.resumeCalls, 0);
  assert.deepEqual(preservedCycle(f.cycle), cycleBefore);

  const recovered = await prepareBaseAdvancedResume({ ...input,
    readRemoteBase: ({ repo, baseRef }) => readConfiguredRemoteBase({ repo, baseRef }) });
  assert.equal(recovered.status, 'READY_TO_RESUME');
  assert.equal(merges, 1);
  assert.equal(git(f.worktree, ['rev-parse', 'HEAD']), mergedHead);
  assert.equal(f.dispositionCalls, 1);
  assert.equal(f.run.currentCycle, 3);
  assert.deepEqual(preservedCycle(f.cycle), cycleBefore);
  assert.equal(heldReconciliations(f)[0].status, 'MERGED_AND_REMOTE_CONFIRMED');
});

test('private root symlink redirection is rejected before fetch or disposition', async (t) => {
  const f = fixture(t);
  const redirected = path.join(path.dirname(f.privateRoot), 'redirected-private');
  fs.mkdirSync(redirected, { recursive: true });
  assert.ok(path.resolve(f.privateRoot).startsWith(path.resolve(f.repoRoot) + path.sep));
  fs.rmSync(f.privateRoot, { recursive: true, force: true });
  fs.symlinkSync(redirected, f.privateRoot, process.platform === 'win32' ? 'junction' : 'dir');
  let fetches = 0; let merges = 0;
  await assert.rejects(prepareBaseAdvancedResume({ ...f.args, fetchBase: async () => { fetches++; },
    mergeBase: () => { merges++; } }), /BASE_ADVANCED_PRIVATE_ROOT_REDIRECTED|BASE_ADVANCED_PRIVATE_ROOT_MISMATCH/);
  assert.equal(fetches, 0);
  assert.equal(merges, 0);
  assert.equal(f.dispositionCalls, 0);
  assert.deepEqual(fs.readdirSync(redirected), []);
});

test('prepared directory symlink is rejected before merge or redirected write', async (t) => {
  const f = fixture(t);
  const redirected = path.join(path.dirname(f.privateRoot), 'redirected-prepared');
  fs.mkdirSync(redirected, { recursive: true });
  const prepared = path.join(f.stateRoot, 'prepared');
  fs.mkdirSync(prepared, { recursive: true });
  fs.rmSync(prepared, { recursive: true, force: true });
  fs.symlinkSync(redirected, prepared, process.platform === 'win32' ? 'junction' : 'dir');
  let fetches = 0; let merges = 0;
  await assert.rejects(prepareBaseAdvancedResume({ ...f.args, fetchBase: async () => { fetches++; },
    mergeBase: () => { merges++; } }), /BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED/);
  assert.equal(fetches, 0);
  assert.equal(merges, 0);
  assert.equal(f.dispositionCalls, 0);
  assert.deepEqual(fs.readdirSync(redirected), []);
});

test('prepared receipt file symlink is rejected without modifying its target or repeating merge', async (t) => {
  const f = fixture(t);
  let merges = 0;
  const mergeBase = ({ repo, newBaseCommit }) => { merges++; git(repo, ['merge', '--no-edit', '--no-ff', newBaseCommit]); };
  const first = await prepareBaseAdvancedResume({ ...f.args, mergeBase });
  const target = path.join(path.dirname(f.privateRoot), 'prepared-receipt-target.json');
  const sentinel = Buffer.from('outside target must remain unchanged');
  fs.writeFileSync(target, sentinel);
  fs.unlinkSync(first.receiptFile);
  try { fs.symlinkSync(target, first.receiptFile, 'file'); }
  catch (error) {
    if (error.code === 'EPERM' && process.platform === 'win32') {
      assert.deepEqual(fs.readFileSync(target), sentinel);
      t.skip('Windows host does not permit creating file symlinks for this test.');
      return;
    }
    throw error;
  }
  await assert.rejects(prepareBaseAdvancedResume({ ...f.args, mergeBase }),
    /BASE_ADVANCED_PREPARED_RECEIPT_PATH_REDIRECTED/);
  assert.equal(merges, 1);
  assert.deepEqual(fs.readFileSync(target), sentinel);
  assert.equal(git(f.worktree, ['rev-parse', 'HEAD']), first.receipt.headCommit);
  assert.equal(f.runner.resumeCalls, 0);
});

test('remote movement during fetch holds before disposition or merge', async (t) => {
  const f = fixture(t);
  const oldHead = git(f.worktree, ['rev-parse', 'HEAD']);
  let reads = 0; let merges = 0;
  await assert.rejects(prepareBaseAdvancedResume({ ...f.args,
    readRemoteBase: async ({ repo, baseRef }) => ++reads === 1
      ? readConfiguredRemoteBase({ repo, baseRef }) : 'f'.repeat(40),
    mergeBase: () => { merges++; } }), /BASE_ADVANCED_REMOTE_MOVED_DURING_FETCH/);
  assert.equal(git(f.worktree, ['rev-parse', 'HEAD']), oldHead);
  assert.equal(f.run.state, 'ROOT_INTEGRATED_PENDING_CI');
  assert.equal(f.dispositionCalls, 0);
  assert.equal(merges, 0);
});

test('remote movement after fetch confirmation but before merge is durably held without receipt or retry', async (t) => {
  const f = fixture(t);
  const oldHead = git(f.worktree, ['rev-parse', 'HEAD']);
  const cycleBefore = preservedCycle(f.cycle);
  let reads = 0; let merges = 0;
  const readRemoteBase = async ({ repo, baseRef }) => {
    reads++;
    if (reads === 3) {
      git(f.repoRoot, ['commit', '--allow-empty', '-m', 'remote advanced before candidate merge']);
      git(f.repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    }
    return readConfiguredRemoteBase({ repo, baseRef });
  };
  const input = { ...f.args, readRemoteBase, mergeBase: () => { merges++; } };
  await assert.rejects(prepareBaseAdvancedResume(input), /BASE_ADVANCED_REMOTE_MOVED_BEFORE_MERGE/);
  assert.equal(reads, 3);
  assert.equal(git(f.worktree, ['rev-parse', 'HEAD']), oldHead);
  assert.equal(git(f.worktree, ['branch', '--show-current']), f.branch);
  assert.equal(f.run.state, 'BLOCKED_STALE_CANDIDATE');
  assert.equal(f.run.currentCycle, 3);
  assert.equal(f.run.baseCommit, f.oldBaseCommit);
  assert.equal(f.run.candidateHeadCommit, f.oldHeadCommit);
  assert.equal(f.cycle.state, 'BLOCKED');
  assert.equal(f.dispositionCalls, 1);
  assert.equal(merges, 0);
  assert.deepEqual(preservedCycle(f.cycle), cycleBefore);
  assert.deepEqual(heldReconciliations(f).map((result) => result.status), ['REMOTE_MOVED_BEFORE_MERGE']);
  assertNoPreparedReceiptOrResume(f);
  await assert.rejects(prepareBaseAdvancedResume(input), /BASE_ADVANCED_PRIOR_ATTEMPT_HELD/);
  assert.equal(reads, 3);
  assert.equal(merges, 0);
  assert.equal(git(f.worktree, ['rev-parse', 'HEAD']), oldHead);
  assert.equal(git(f.worktree, ['branch', '--show-current']), f.branch);
  assert.equal(f.run.state, 'BLOCKED_STALE_CANDIDATE');
  assert.equal(f.cycle.state, 'BLOCKED');
  assert.deepEqual(preservedCycle(f.cycle), cycleBefore);
  assertNoPreparedReceiptOrResume(f);
});

test('remote movement after merge before receipt leaves exact merge held without receipt or retry', async (t) => {
  const f = fixture(t);
  const cycleBefore = preservedCycle(f.cycle);
  let reads = 0; let merges = 0;
  const readRemoteBase = async ({ repo, baseRef }) => {
    reads++;
    if (reads === 4) {
      git(f.repoRoot, ['commit', '--allow-empty', '-m', 'remote advanced after candidate merge']);
      git(f.repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    }
    return readConfiguredRemoteBase({ repo, baseRef });
  };
  const mergeBase = ({ repo, newBaseCommit }) => {
    merges++;
    git(repo, ['merge', '--no-edit', '--no-ff', newBaseCommit]);
  };
  const input = { ...f.args, readRemoteBase, mergeBase };
  await assert.rejects(prepareBaseAdvancedResume(input), /BASE_ADVANCED_REMOTE_MOVED_AFTER_MERGE/);
  const mergedHead = git(f.worktree, ['rev-parse', 'HEAD']);
  assert.equal(reads, 4);
  assert.equal(git(f.worktree, ['branch', '--show-current']), f.branch);
  assert.equal(git(f.worktree, ['status', '--porcelain']), '');
  assert.deepEqual(git(f.worktree, ['rev-list', '--parents', '-n', '1', mergedHead]).split(' ').slice(1),
    [f.oldHeadCommit, f.newBaseCommit]);
  assert.equal(f.run.state, 'BLOCKED_STALE_CANDIDATE');
  assert.equal(f.run.currentCycle, 3);
  assert.equal(f.run.baseCommit, f.oldBaseCommit);
  assert.equal(f.run.candidateHeadCommit, f.oldHeadCommit);
  assert.equal(f.cycle.state, 'BLOCKED');
  assert.equal(f.dispositionCalls, 1);
  assert.deepEqual(preservedCycle(f.cycle), cycleBefore);
  assert.deepEqual(heldReconciliations(f).map((result) => result.status), ['MERGED_REMOTE_MOVED']);
  assert.equal(heldReconciliations(f)[0].headCommit, mergedHead);
  assertNoPreparedReceiptOrResume(f);
  await assert.rejects(prepareBaseAdvancedResume(input), /BASE_ADVANCED_PRIOR_ATTEMPT_HELD/);
  assert.notEqual(mergedHead, f.oldHeadCommit);
  assert.equal(merges, 1);
  assert.equal(reads, 4);
  assert.equal(git(f.worktree, ['rev-parse', 'HEAD']), mergedHead);
  assert.equal(git(f.worktree, ['branch', '--show-current']), f.branch);
  assert.equal(f.run.state, 'BLOCKED_STALE_CANDIDATE');
  assert.equal(f.cycle.state, 'BLOCKED');
  assert.deepEqual(preservedCycle(f.cycle), cycleBefore);
  assertNoPreparedReceiptOrResume(f);
});

test('unknown fetch outcome is recorded before the fetch and is never retried', async (t) => {
  const f = fixture(t);
  let fetches = 0; let merges = 0;
  const input = { ...f.args, fetchBase: async () => { fetches++; throw new Error('transport ambiguous'); },
    mergeBase: () => { merges++; } };
  await assert.rejects(prepareBaseAdvancedResume(input), /transport ambiguous/);
  await assert.rejects(prepareBaseAdvancedResume(input), /BASE_ADVANCED_FETCH_OUTCOME_UNKNOWN/);
  assert.equal(fetches, 1);
  assert.equal(merges, 0);
  assert.equal(f.run.state, 'ROOT_INTEGRATED_PENDING_CI');
});

test('active leases, unknown effects, runner activity, dirty candidates, and wrong checkpoints fail closed', async (t) => {
  for (const hold of ['lease', 'unknown effect', 'active runner', 'dirty candidate', 'diverged candidate', 'wrong checkpoint']) {
    await t.test(hold, async (t2) => {
      const f = fixture(t2);
      let merges = 0; let fetches = 0;
      const input = { ...f.args, fetchBase: async () => { fetches++; throw new Error('must not fetch'); },
        mergeBase: () => { merges++; } };
      if (hold === 'lease') f.unknown.activeLeases.push({ node_id: 'worker' });
      if (hold === 'unknown effect') f.unknown.unknownEffects.push({ node_id: 'worker' });
      if (hold === 'active runner') f.runner.isActive = () => true;
      if (hold === 'dirty candidate') fs.writeFileSync(path.join(f.worktree, 'outside.txt'), 'untrusted\n');
      if (hold === 'diverged candidate') git(f.worktree, ['commit', '--allow-empty', '-m', 'candidate changed after checkpoint']);
      if (hold === 'wrong checkpoint') input.checkpoint = { ...f.checkpoint, candidateHeadCommit: 'a'.repeat(40) };
      await assert.rejects(prepareBaseAdvancedResume(input));
      assert.equal(fetches, 0);
      assert.equal(merges, 0);
      assert.equal(f.dispositionCalls, 0);
      assert.equal(f.run.state, 'ROOT_INTEGRATED_PENDING_CI');
    });
  }
});

test('only a proven bridge conflict is aborted, and unchanged evidence cannot repeat the merge', async (t) => {
  const f = fixture(t, { conflict: true });
  let merges = 0;
  const mergeBase = ({ repo, newBaseCommit }) => { merges++; git(repo, ['merge', '--no-edit', '--no-ff', newBaseCommit]); };
  await assert.rejects(prepareBaseAdvancedResume({ ...f.args, mergeBase }), /BASE_ADVANCED_MERGE_CONFLICT/);
  assert.equal(git(f.worktree, ['rev-parse', 'HEAD']), f.oldHeadCommit);
  assert.equal(git(f.worktree, ['status', '--porcelain', '--untracked-files=all']), '');
  assert.throws(() => git(f.worktree, ['rev-parse', '--verify', 'MERGE_HEAD^{commit}']));
  assert.equal(f.run.state, 'BLOCKED_STALE_CANDIDATE');
  await assert.rejects(prepareBaseAdvancedResume({ ...f.args, mergeBase }), /BASE_ADVANCED_PRIOR_ATTEMPT_HELD/);
  assert.equal(merges, 1);
});

test('uncertain merge outcome stays held by its durable intent and is never repeated', async (t) => {
  const f = fixture(t);
  let merges = 0;
  const mergeBase = ({ repo }) => {
    merges++;
    git(repo, ['commit', '--allow-empty', '-m', 'unexpected candidate movement']);
    const error = new Error('merge transport or Git result became uncertain');
    throw error;
  };
  await assert.rejects(prepareBaseAdvancedResume({ ...f.args, mergeBase }), /BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN/);
  await assert.rejects(prepareBaseAdvancedResume({ ...f.args, mergeBase }), /BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN/);
  assert.equal(merges, 1);
  assert.equal(f.run.state, 'BLOCKED_STALE_CANDIDATE');
});

test('base-advanced signature is stable for unchanged evidence and changes when the remote or journal changes', async (t) => {
  const f = fixture(t);
  const input = { ...f.args, readRemoteBase: readConfiguredRemoteBase };
  const first = await baseAdvancedResumeSignature(input);
  assert.equal(first, await baseAdvancedResumeSignature(input));
  fs.writeFileSync(path.join(f.worktree, 'outside.txt'), 'new evidence\n');
  assert.notEqual(first, await baseAdvancedResumeSignature(input));
});

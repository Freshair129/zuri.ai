import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createControllerRunner } from '../delivery-control/controller-runner.mjs';
import { openDeliveryController } from '../delivery-control/controller.mjs';
import { createGitHubDeliveryAdapter, GITHUB_DELIVERY_SCHEMA } from '../delivery-control/github-delivery.mjs';
import { preflightTask } from '../delivery-control/preflight.mjs';

const HEAD_BRANCH = 'codex/delivery-test';
const BASE_BRANCH = 'main';
const REPOSITORY = 'github.com/acme/demo';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function makeFixture({ initialRemoteHead = null, holdRemoteRead = null, queueAfterMerge = false } = {}) {
  const repoRoot = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'github-delivery-test-')));
  git(repoRoot, ['init', '-q', '-b', HEAD_BRANCH]);
  git(repoRoot, ['config', 'core.autocrlf', 'false']);
  git(repoRoot, ['config', 'user.name', 'Delivery Test']);
  git(repoRoot, ['config', 'user.email', 'delivery-test@example.invalid']);
  writeFileSync(path.join(repoRoot, 'candidate.txt'), 'candidate\n', 'utf8');
  git(repoRoot, ['add', 'candidate.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'candidate']);
  const candidateHeadCommit = git(repoRoot, ['rev-parse', 'HEAD']);
  git(repoRoot, ['remote', 'add', 'origin', 'https://github.com/acme/demo.git']);

  const state = {
    repoRoot,
    candidateHeadCommit,
    baseCommit: candidateHeadCommit,
    remoteBase: candidateHeadCommit,
    remoteHead: initialRemoteHead,
    pullRequests: [],
    nextPullRequestNumber: 1,
    requiredChecks: [{ name: 'unit', bucket: 'pending', state: 'IN_PROGRESS', workflow: 'CI' }],
    allChecks: [{ name: 'unit', bucket: 'pending', state: 'IN_PROGRESS', workflow: 'CI' }],
    baseProtection: { required_status_checks: { strict: true, contexts: ['unit'], checks: [] }, enforce_admins: { enabled: true } },
    mutationCalls: [],
    commandCalls: [],
    holdRemoteRead,
    queueAfterMerge,
    queueEntry: null,
  };

  const controller = {
    verifyEventChain() { return { count: 1, head: 'a'.repeat(64) }; },
    getRun(taskId) {
      return {
        taskId,
        state: 'ROOT_INTEGRATED_PENDING_CI',
        branch: HEAD_BRANCH,
        baseCommit: state.baseCommit,
        candidateHeadCommit: state.candidateHeadCommit,
        currentCycle: 1,
        cycles: [{ cycleNo: 1, state: 'INTEGRATED' }],
        rootIntegration: { headCommit: state.candidateHeadCommit, state: 'ROOT_INTEGRATED_PENDING_CI' },
        worktreeRoot: repoRoot,
        stages: [
          { role: 'worker', stage: 'WORKER_IMPLEMENTATION', status: 'PASSED', exactHeadCommit: state.candidateHeadCommit, effectState: 'APPLIED', evidenceRef: 'worker-evidence', sessionId: 'worker-session' },
          { role: 'verifier', stage: 'INDEPENDENT_VERIFY', status: 'PASSED', exactHeadCommit: state.candidateHeadCommit, effectState: 'APPLIED', evidenceRef: 'verify-evidence', sessionId: 'verify-session' },
          { role: 'reviewer', stage: 'INDEPENDENT_REVIEW', status: 'PASSED', exactHeadCommit: state.candidateHeadCommit, effectState: 'APPLIED', evidenceRef: 'review-evidence', sessionId: 'review-session' },
        ],
      };
    },
  };

  const campaign = {
    schemaVersion: GITHUB_DELIVERY_SCHEMA,
    taskId: 'TASK-DELIVERY-TEST',
    repository: { remoteName: 'origin', expectedOwnerRepo: REPOSITORY },
    branch: { head: HEAD_BRANCH, base: BASE_BRANCH, expectedBaseCommit: state.baseCommit },
    pullRequest: { title: 'Delivery adapter test', body: 'Synthetic local fixture.' },
    mergeMethod: 'squash',
    requiredChecks: ['unit'],
    notApplicableChecks: ['optional-e2e'],
    authorizedEffects: ['push', 'pullRequest', 'merge'],
    mandate: {
      resolvedBy: 'root',
      sourceRef: 'test-mandate',
      taskId: 'TASK-DELIVERY-TEST',
      repositoryRoot: repoRoot,
      expectedRepository: REPOSITORY,
      headBranch: HEAD_BRANCH,
      baseBranch: BASE_BRANCH,
      expectedBaseCommit: state.baseCommit,
      authorizedEffects: ['push', 'pullRequest', 'merge'],
    },
  };

  function commandResult(exitCode, stdout = '') {
    return { exitCode, stdout, stderr: '' };
  }

  const runGit = async (args, options) => {
      state.commandCalls.push(['git', [...args]]);
      if (args[0] === 'ls-remote') {
        const ref = args.at(-1);
        if (state.holdRemoteRead) await state.holdRemoteRead(ref);
        const sha = ref === `refs/heads/${BASE_BRANCH}` ? state.remoteBase
          : ref === `refs/heads/${HEAD_BRANCH}` ? state.remoteHead : null;
        return commandResult(0, sha ? `${sha}\t${ref}\n` : '');
      }
      if (args[0] === 'push') {
        state.mutationCalls.push(['push', [...args]]);
        state.remoteHead = args.at(-1).split(':')[0];
        return commandResult(0, '');
      }
      try {
        const result = execFileSync('git', args, {
          cwd: options.cwd,
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return commandResult(0, result);
      } catch (error) {
        if (args[0] === 'merge-base' && error.status === 1) return commandResult(1, error.stdout ?? '');
        throw error;
      }
  };

  const runGh = async (args) => {
      state.commandCalls.push(['gh', [...args]]);
      const command = args.slice(0, 2).join(' ');
      if (command === 'pr list') return commandResult(0, JSON.stringify(state.pullRequests));
      if (command === 'pr create') {
        state.mutationCalls.push(['pullRequest', [...args]]);
        const number = state.nextPullRequestNumber++;
        state.pullRequests = [{
          number,
          url: `https://github.com/acme/demo/pull/${number}`,
          state: 'OPEN',
          headRefName: HEAD_BRANCH,
          headRefOid: state.candidateHeadCommit,
          baseRefName: BASE_BRANCH,
          baseRefOid: state.remoteBase,
          isDraft: false,
          mergedAt: null,
          reviewDecision: 'APPROVED',
          mergeStateStatus: 'CLEAN',
        }];
        return commandResult(0, state.pullRequests[0].url);
      }
      if (command === 'pr view') {
        const number = Number(args[2]);
        const pr = state.pullRequests.find((item) => item.number === number);
        return pr ? commandResult(0, JSON.stringify(pr)) : commandResult(1, '');
      }
      if (command === 'pr checks') {
        const checks = args.includes('--required') ? state.requiredChecks : state.allChecks;
        const hasPending = checks.some((item) => item.bucket === 'pending');
        return commandResult(hasPending ? 8 : 0, JSON.stringify(checks));
      }
      if (command === 'api graphql') {
        return commandResult(0, JSON.stringify({ data: { repository: { pullRequest: { mergeQueueEntry: state.queueEntry } } } }));
      }
      if (args[0] === 'api' && args[1]?.endsWith('/protection')) {
        return state.baseProtection
          ? commandResult(0, JSON.stringify(state.baseProtection))
          : commandResult(1, JSON.stringify({ message: 'Not Found' }));
      }
      if (command === 'pr merge') {
        state.mutationCalls.push(['merge', [...args]]);
        const pr = state.pullRequests.find((item) => item.number === Number(args[2]));
        if (state.queueAfterMerge) {
          state.queueEntry = { id: 'queue-entry-1', position: 1, state: 'QUEUED' };
        } else {
          pr.state = 'MERGED';
          pr.mergedAt = '2026-10-15T00:00:00Z';
        }
        return commandResult(0, '');
      }
      throw new Error(`Unexpected gh command: ${args.join(' ')}`);
  };

  function makeAdapter() {
    return createGitHubDeliveryAdapter({ repoRoot, controller, campaign, runGit, runGh });
  }

  return { ...state, state, campaign, controller, makeAdapter, runGit, runGh };
}

test('campaign validation requires a root-matching explicit effect list', () => {
  const fixture = makeFixture();
  try {
    const invalid = structuredClone(fixture.campaign);
    invalid.authorizedEffects = { push: true, pullRequest: true, merge: true };
    assert.throws(() => createGitHubDeliveryAdapter({ repoRoot: fixture.repoRoot, controller: fixture.controller, campaign: invalid }), /Invalid GitHub delivery campaign|explicitly authorize/);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('repository remotes reject nondefault ports and non-git SSH users', async () => {
  for (const remote of [
    'https://github.com:8443/acme/demo.git',
    'ssh://deploy@github.com/acme/demo.git',
    'ssh://git@github.com:2222/acme/demo.git',
    'deploy@github.com:acme/demo.git',
  ]) {
    const fixture = makeFixture();
    try {
      git(fixture.repoRoot, ['remote', 'set-url', 'origin', remote]);
      const result = await fixture.makeAdapter().tick();
      assert.equal(result.status, 'BLOCKED', remote);
      assert.equal(result.code, 'REMOTE_REPOSITORY_MISMATCH', remote);
      assert.deepEqual(fixture.state.mutationCalls, [], remote);
    } finally {
      rmSync(fixture.repoRoot, { recursive: true, force: true });
    }
  }
  const fixture = makeFixture();
  try {
    git(fixture.repoRoot, ['remote', 'set-url', 'origin', 'ssh://git@github.com:22/acme/demo.git']);
    assert.equal((await fixture.makeAdapter().tick()).status, 'PUSHED');
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('branch-protection guard refuses missing, non-strict, and unenforced base rules', async () => {
  const protections = [
    null,
    { required_status_checks: { strict: false, contexts: ['unit'] }, enforce_admins: { enabled: true } },
    { required_status_checks: { strict: true, contexts: ['unit'] }, enforce_admins: { enabled: false } },
    { required_status_checks: { strict: true, contexts: [] }, enforce_admins: { enabled: true } },
  ];
  for (const protection of protections) {
    const fixture = makeFixture();
    try {
      const adapter = fixture.makeAdapter();
      await adapter.tick();
      await adapter.tick();
      fixture.state.requiredChecks = [{ name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' }];
      fixture.state.allChecks = [{ name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' }];
      fixture.state.baseProtection = protection;
      const blocked = await adapter.tick();
      assert.equal(blocked.status, 'BLOCKED');
      assert.match(blocked.code, /^BASE_PROTECTION_/);
      assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest']);
    } finally {
      rmSync(fixture.repoRoot, { recursive: true, force: true });
    }
  }
});

test('the adapter accepts an exact passed controller pipeline from a linked candidate worktree', async (t) => {
  const tempRoot = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'github-delivery-pipeline-')));
  const repoRoot = path.join(tempRoot, 'primary');
  const worktreeRoot = path.join(tempRoot, 'candidate');
  const branch = 'codex/delivery-linked-candidate';
  const taskId = 'TASK-GITHUB-LINKED-PIPELINE';
  const taskFile = path.join(repoRoot, '.git', 'task.json');
  let controller;
  let runner;
  t.after(async () => {
    if (runner) await runner.stop();
    if (controller) controller.close();
    try { git(repoRoot, ['worktree', 'remove', '--force', worktreeRoot]); } catch {}
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Delivery Pipeline Test']);
  git(repoRoot, ['config', 'user.email', 'delivery-pipeline@example.invalid']);
  mkdirSync(path.join(repoRoot, 'docs', 'architecture', 'delivery-control', 'contracts'), { recursive: true });
  mkdirSync(path.join(repoRoot, 'docs', 'roadmap'), { recursive: true });
  mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'docs', 'architecture', 'delivery-control', 'contracts', 'model-policy.json'),
    readFileSync(new URL('../../docs/architecture/delivery-control/contracts/model-policy.json', import.meta.url)));
  writeFileSync(path.join(repoRoot, 'docs', 'roadmap', 'ROADMAP.md'), '<!-- roadmap-task-ledger:start -->\n| task_id | status | proof_scope | implementation_state | evidence |\n|---|---|---|---|---|\n| DEP-DONE | done | LOCAL | MERGED | Fixture dependency. |\n<!-- roadmap-task-ledger:end -->\n');
  writeFileSync(path.join(repoRoot, 'src', 'base.txt'), 'baseline\n');
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-q', '-m', 'pipeline base']);
  const baseCommit = git(repoRoot, ['rev-parse', 'HEAD']);
  git(repoRoot, ['remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
  git(repoRoot, ['worktree', 'add', '-q', '-b', branch, worktreeRoot, baseCommit]);

  const taskRecord = {
    schemaVersion: 'task-readiness/v1',
    taskId,
    objective: 'Verify GitHub delivery against the actual linked-worktree controller pipeline.',
    acceptance: ['The controller records a worker candidate and independent verifier and reviewer on the exact head.'],
    writeScope: ['src/'],
    checks: [{ shell: false, executable: process.execPath, argv: ['--version'], cwd: '.' }],
    mandateReference: 'fixture://trusted-root-mandate',
  };
  writeFileSync(taskFile, JSON.stringify(taskRecord));
  const preflightResult = preflightTask({ repo: worktreeRoot, taskFile, base: baseCommit });
  assert.equal(preflightResult.status, 'READY', JSON.stringify(preflightResult.issues));
  controller = await openDeliveryController({ repoRoot });
  const trustedMandateBinding = {
    resolvedBy: 'root', taskId, repositoryRoot: repoRoot,
    objective: taskRecord.objective, writeScope: taskRecord.writeScope,
    sourceRef: 'fixture://trusted-root-mandate',
    authorizedEffects: ['local fixture candidate only'],
    prohibitions: ['no external provider calls'],
  };
  controller.registerTask({ taskRecord, preflightResult, worktreeRoot, trustedMandateBinding });

  const sessions = [];
  const failures = [];
  const completeFailure = controller.failNode;
  controller.failNode = async (input) => { failures.push(input); return completeFailure(input); };
  runner = createControllerRunner({
    controller,
    repoRoot,
    stateRoot: path.join(tempRoot, 'runner-state'),
    config: { tasks: [{ taskId, taskFile, worktree: worktreeRoot }], maxConcurrent: 1 },
    backend: async ({ role, worktree, artifactDir, onSession }) => {
      mkdirSync(artifactDir, { recursive: true });
      const sessionId = randomUUID();
      sessions.push({ role, sessionId });
      await onSession({ sessionId, model: 'gpt-6-luna', effort: 'max' });
      if (role === 'worker') writeFileSync(path.join(worktree, 'src', 'candidate.txt'), 'synthetic backend candidate\n');
      return {
        outcome: 'PASS',
        headCommit: git(worktree, ['rev-parse', 'HEAD']),
        sessionId,
        model: 'gpt-6-luna',
        effort: 'max',
        evidence: ['Synthetic test backend only; no provider was invoked.'],
        resultDigest: 'e'.repeat(64),
      };
    },
  });
  for (let round = 0; round < 5 && controller.getRun(taskId).state !== 'ROOT_DELIVERY_READY'; round++) {
    const result = await runner.tick();
    assert.deepEqual(result.errors, []);
    await runner.drain();
  }
  await runner.stop();
  runner = null;
  const run = controller.getRun(taskId);
  assert.equal(run.state, 'ROOT_DELIVERY_READY', JSON.stringify({ run, failures }));
  assert.equal(run.worktreeRoot, realpathSync.native(worktreeRoot));
  assert.equal(git(repoRoot, ['branch', '--show-current']), 'main');
  assert.equal(git(worktreeRoot, ['branch', '--show-current']), branch);
  assert.equal(new Set(sessions.map((item) => item.sessionId)).size, 3);
  controller.recordRootIntegration({ taskId, headCommit: run.candidateHeadCommit, evidenceRef: 'fixture://root-integration' });

  const state = {
    remoteBase: baseCommit,
    remoteHead: run.candidateHeadCommit,
    pullRequests: [{ number: 31, url: 'https://github.com/acme/demo/pull/31', state: 'OPEN',
      headRefName: branch, headRefOid: run.candidateHeadCommit, baseRefName: BASE_BRANCH, baseRefOid: baseCommit,
      isDraft: false, mergedAt: null, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }],
    checks: [{ name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' }],
  };
  const commandResult = (exitCode, stdout = '') => ({ exitCode, stdout, stderr: '' });
  const runGit = async (args, options) => {
    if (args[0] === 'ls-remote') {
      const ref = args.at(-1);
      const sha = ref === `refs/heads/${BASE_BRANCH}` ? state.remoteBase
        : ref === `refs/heads/${branch}` ? state.remoteHead : null;
      return commandResult(0, sha ? `${sha}\t${ref}\n` : '');
    }
    return commandResult(0, execFileSync('git', args, { cwd: options.cwd, encoding: 'utf8', windowsHide: true }));
  };
  const runGh = async (args) => {
    const command = args.slice(0, 2).join(' ');
    if (command === 'pr list') return commandResult(0, JSON.stringify(state.pullRequests));
    if (command === 'pr view') return commandResult(0, JSON.stringify(state.pullRequests.find((item) => item.number === Number(args[2]))));
    if (command === 'pr checks') return commandResult(0, JSON.stringify(state.checks));
    if (args[0] === 'api' && args[1]?.endsWith('/protection')) {
      return commandResult(0, JSON.stringify({ required_status_checks: { strict: true, contexts: ['unit'] }, enforce_admins: { enabled: true } }));
    }
    if (command === 'api graphql') return commandResult(0, JSON.stringify({ data: { repository: { pullRequest: { mergeQueueEntry: null } } } }));
    if (command === 'pr merge') {
      const pr = state.pullRequests.find((item) => item.number === Number(args[2]));
      pr.state = 'MERGED'; pr.mergedAt = '2026-10-15T00:00:00Z';
      return commandResult(0, '');
    }
    throw new Error('Unexpected synthetic GitHub call: ' + args.join(' '));
  };
  const campaign = {
    schemaVersion: GITHUB_DELIVERY_SCHEMA,
    taskId,
    repository: { remoteName: 'origin', expectedOwnerRepo: REPOSITORY },
    branch: { head: branch, base: BASE_BRANCH, expectedBaseCommit: baseCommit },
    pullRequest: { title: 'Linked pipeline fixture', body: 'Test-only candidate.' },
    mergeMethod: 'squash', requiredChecks: ['unit'], notApplicableChecks: [],
    authorizedEffects: ['push', 'pullRequest', 'merge'],
    mandate: { resolvedBy: 'root', sourceRef: 'fixture://trusted-root-mandate', taskId,
      repositoryRoot: realpathSync.native(repoRoot), expectedRepository: REPOSITORY,
      headBranch: branch, baseBranch: BASE_BRANCH, expectedBaseCommit: baseCommit,
      authorizedEffects: ['push', 'pullRequest', 'merge'] },
  };
  const result = await createGitHubDeliveryAdapter({
    repoRoot, worktreeRoot, controller, campaign, runGit, runGh,
  }).tick();
  assert.equal(result.status, 'MERGED', JSON.stringify(result));
  assert.equal(result.candidateHeadCommit, run.candidateHeadCommit);
  assert.equal(state.pullRequests[0].state, 'MERGED');
});

test('a pre-existing merged PR without durable CI and merge intent is not accepted', async () => {
  const fixture = makeFixture();
  fixture.state.remoteHead = fixture.candidateHeadCommit;
  fixture.state.pullRequests = [{
    number: 9,
    url: 'https://github.com/acme/demo/pull/9',
    state: 'MERGED',
    headRefName: HEAD_BRANCH,
    headRefOid: fixture.candidateHeadCommit,
    baseRefName: BASE_BRANCH,
    baseRefOid: fixture.state.baseCommit,
    isDraft: false,
    mergedAt: '2026-10-15T00:00:00Z',
    reviewDecision: 'APPROVED',
    mergeStateStatus: 'CLEAN',
  }];
  try {
    const result = await fixture.makeAdapter().tick();
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.code, 'MERGED_PULL_REQUEST_NO_AUTHORIZED_CI_INTENT');
    assert.deepEqual(fixture.state.mutationCalls, []);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('merge queue returns WAITING immediately and a later merged PR rechecks CI', async () => {
  const fixture = makeFixture({ queueAfterMerge: true });
  try {
    const adapter = fixture.makeAdapter();
    assert.equal((await adapter.tick()).status, 'PUSHED');
    assert.equal((await adapter.tick()).status, 'PR_CREATED');
    fixture.state.requiredChecks = [{ name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' }];
    fixture.state.allChecks = [{ name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' }];

    const queued = await adapter.tick();
    assert.equal(queued.status, 'WAITING_MERGE_QUEUE');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest', 'merge']);

    const pr = fixture.state.pullRequests[0];
    pr.state = 'MERGED';
    pr.mergedAt = '2026-10-15T00:00:00Z';
    fixture.state.queueEntry = null;
    fixture.state.remoteBase = 'd'.repeat(40);
    fixture.state.requiredChecks = [{ name: 'unit', bucket: 'fail', state: 'FAILURE', workflow: 'CI' }];
    fixture.state.allChecks = [{ name: 'unit', bucket: 'fail', state: 'FAILURE', workflow: 'CI' }];

    const refused = await adapter.tick();
    assert.equal(refused.status, 'BLOCKED');
    assert.equal(refused.code, 'MERGED_PULL_REQUEST_CI_NOT_ACCEPTED');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest', 'merge']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a missing remote candidate is pushed once, then a later tick creates its PR', async () => {
  const fixture = makeFixture();
  try {
    const adapter = fixture.makeAdapter();
    const pushed = await adapter.tick();
    assert.equal(pushed.status, 'PUSHED');
    assert.equal(fixture.state.remoteHead, fixture.candidateHeadCommit);
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push']);

    const created = await adapter.tick();
    assert.equal(created.status, 'PR_CREATED');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a newly gated commit fast-forwards an existing PR without force and preserves prior receipts', async () => {
  const fixture = makeFixture();
  try {
    const firstRevision = fixture.candidateHeadCommit;
    const adapter = fixture.makeAdapter();
    assert.equal((await adapter.tick()).status, 'PUSHED');
    assert.equal((await adapter.tick()).status, 'PR_CREATED');

    writeFileSync(path.join(fixture.repoRoot, 'next.txt'), 'next approved revision\n');
    git(fixture.repoRoot, ['add', 'next.txt']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'next approved revision']);
    const nextRevision = git(fixture.repoRoot, ['rev-parse', 'HEAD']);
    fixture.state.candidateHeadCommit = nextRevision;

    const resumed = await fixture.makeAdapter().tick();
    assert.equal(resumed.status, 'PUSHED', JSON.stringify(resumed));
    assert.equal(resumed.priorRemoteHead, firstRevision);
    assert.equal(fixture.state.remoteHead, nextRevision);
    const updatePush = fixture.state.mutationCalls.filter(([action]) => action === 'push').at(-1)[1];
    assert.equal(updatePush.includes('--force'), false);
    assert.equal(updatePush.includes('--force-with-lease'), false);
    assert.equal(updatePush.at(-1), `${nextRevision}:refs/heads/${HEAD_BRANCH}`);

    const receiptDir = path.join(fixture.repoRoot, '.git', 'zuri-delivery-control', 'github-delivery-v1', 'receipts');
    const taskDir = readdirSync(receiptDir).find((entry) => entry !== 'locks');
    const revisions = readdirSync(path.join(receiptDir, taskDir)).filter((entry) => entry.endsWith('.jsonl'));
    assert.equal(revisions.length, 2, 'the completed first-revision receipt remains beside the new one');

    const waitingForProvider = await fixture.makeAdapter().tick();
    assert.equal(waitingForProvider.status, 'WAITING_PR_HEAD_UPDATE');
    fixture.state.pullRequests[0].headRefOid = nextRevision;
    fixture.state.requiredChecks = [{ name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' }];
    fixture.state.allChecks = [{ name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' }];
    const merged = await fixture.makeAdapter().tick();
    assert.equal(merged.status, 'MERGED', JSON.stringify(merged));
    assert.equal(merged.candidateHeadCommit, nextRevision);
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest', 'push', 'merge']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a new controller candidate cannot overwrite a divergent remote PR head', async () => {
  const fixture = makeFixture();
  try {
    const base = fixture.state.baseCommit;
    assert.equal((await fixture.makeAdapter().tick()).status, 'PUSHED');
    assert.equal((await fixture.makeAdapter().tick()).status, 'PR_CREATED');

    git(fixture.repoRoot, ['switch', '-c', 'fixture/divergent', base]);
    writeFileSync(path.join(fixture.repoRoot, 'divergent.txt'), 'remote side\n');
    git(fixture.repoRoot, ['add', 'divergent.txt']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'divergent remote side']);
    const divergent = git(fixture.repoRoot, ['rev-parse', 'HEAD']);
    git(fixture.repoRoot, ['switch', HEAD_BRANCH]);
    writeFileSync(path.join(fixture.repoRoot, 'next.txt'), 'approved side\n');
    git(fixture.repoRoot, ['add', 'next.txt']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'approved side']);
    fixture.state.candidateHeadCommit = git(fixture.repoRoot, ['rev-parse', 'HEAD']);
    fixture.state.remoteHead = divergent;
    fixture.state.pullRequests[0].headRefOid = divergent;

    const held = await fixture.makeAdapter().tick();
    assert.equal(held.status, 'BLOCKED', JSON.stringify(held));
    assert.equal(held.code, 'REMOTE_BRANCH_NOT_FAST_FORWARD', JSON.stringify(held));
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a pending unknown effect from an older revision is reconciled read-only and holds the new revision', async () => {
  const fixture = makeFixture();
  const divergent = 'c'.repeat(40);
  let ambiguous = true;
  const firstAdapter = createGitHubDeliveryAdapter({
    repoRoot: fixture.repoRoot,
    controller: fixture.controller,
    campaign: fixture.campaign,
    runGit: async (args, options) => {
      if (args[0] === 'push' && ambiguous) {
        ambiguous = false;
        fixture.state.mutationCalls.push(['push', [...args]]);
        fixture.state.remoteHead = divergent;
        throw new Error('connection dropped after request');
      }
      return fixture.runGit(args, options);
    },
    runGh: fixture.runGh,
  });
  try {
    const first = await firstAdapter.tick();
    assert.equal(first.status, 'BLOCKED');
    assert.equal(first.code, 'DELIVERY_STEP_FAILED');

    writeFileSync(path.join(fixture.repoRoot, 'next.txt'), 'new gated revision\n');
    git(fixture.repoRoot, ['add', 'next.txt']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'new gated revision']);
    fixture.state.candidateHeadCommit = git(fixture.repoRoot, ['rev-parse', 'HEAD']);

    const held = await fixture.makeAdapter().tick();
    assert.equal(held.status, 'UNKNOWN_EFFECT');
    assert.equal(held.code, 'PRIOR_REVISION_PENDING_INTENT');
    assert.equal(held.observations.length, 1);
    assert.equal(held.observations[0].observation.status, 'UNKNOWN');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a changed base returns a typed replan outcome with the actual commit and no mutation', async () => {
  const fixture = makeFixture({ initialRemoteHead: null });
  try {
    const adapter = fixture.makeAdapter();
    const pushed = await adapter.tick();
    assert.equal(pushed.status, 'PUSHED');
    const advanced = 'b'.repeat(40);
    fixture.state.remoteBase = advanced;
    const result = await adapter.tick();
    assert.equal(result.status, 'REPLAN_REQUIRED');
    assert.equal(result.code, 'BASE_ADVANCED');
    assert.equal(result.expectedBaseCommit, fixture.state.baseCommit);
    assert.equal(result.actualBaseCommit, advanced);
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('CI waits nonblockingly and merge requires every applicable check plus exact head', async () => {
  const fixture = makeFixture({ initialRemoteHead: null });
  try {
    const adapter = fixture.makeAdapter();
    const pushed = await adapter.tick();
    assert.equal(pushed.status, 'PUSHED');
    const created = await adapter.tick();
    assert.equal(created.status, 'PR_CREATED');

    const waiting = await adapter.tick();
    assert.equal(waiting.status, 'WAITING_CI');
    assert.equal(waiting.code, 'CI_PENDING');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest']);

    fixture.state.requiredChecks = [{ name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' }];
    fixture.state.allChecks = [
      { name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' },
      { name: 'optional-e2e', bucket: 'skipping', state: 'SKIPPED', workflow: 'E2E' },
    ];
    const merged = await adapter.tick();
    assert.equal(merged.status, 'MERGED');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest', 'merge']);
    const mergeArgs = fixture.state.mutationCalls.at(-1)[1];
    assert.ok(mergeArgs.includes('--match-head-commit'));
    assert.ok(mergeArgs.includes(fixture.candidateHeadCommit));
    assert.ok(!mergeArgs.includes('--admin'));
    assert.ok(!mergeArgs.includes('--auto'));
    const reconciledMerge = await adapter.tick();
    assert.equal(reconciledMerge.status, 'MERGED');
    assert.equal(reconciledMerge.source, 'github-reconciliation');
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('an optional but applicable failed check blocks merge', async () => {
  const fixture = makeFixture({ initialRemoteHead: null });
  try {
    const adapter = fixture.makeAdapter();
    await adapter.tick();
    await adapter.tick();
    fixture.state.requiredChecks = [{ name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' }];
    fixture.state.allChecks = [
      { name: 'unit', bucket: 'pass', state: 'SUCCESS', workflow: 'CI' },
      { name: 'lint-extra', bucket: 'fail', state: 'FAILURE', workflow: 'Optional Checks' },
    ];
    const blocked = await adapter.tick();
    assert.equal(blocked.status, 'BLOCKED');
    assert.equal(blocked.code, 'CI_CHECK_NOT_ACCEPTED');
    assert.deepEqual(blocked.failures, [{ name: 'lint-extra', bucket: 'fail' }]);
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('an ambiguous push is reconciled as UNKNOWN without another mutation', async () => {
  const fixture = makeFixture();
  const divergent = 'c'.repeat(40);
  let ambiguous = true;
  const adapter = createGitHubDeliveryAdapter({
    repoRoot: fixture.repoRoot,
    controller: fixture.controller,
    campaign: fixture.campaign,
    runGit: async (args, options) => {
      if (args[0] === 'push' && ambiguous) {
        ambiguous = false;
        fixture.state.mutationCalls.push(['push', [...args]]);
        fixture.state.remoteHead = divergent;
        throw new Error('connection dropped after request');
      }
      return fixture.runGit(args, options);
    },
    runGh: fixture.runGh,
  });
  try {
    const first = await adapter.tick();
    assert.equal(first.status, 'BLOCKED', JSON.stringify(first));
    assert.equal(first.code, 'DELIVERY_STEP_FAILED');
    const second = await adapter.tick();
    assert.equal(second.status, 'UNKNOWN_EFFECT');
    const third = await adapter.tick();
    assert.equal(third.status, 'UNKNOWN_EFFECT');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a completed push with a lost response is reconciled before PR creation', async () => {
  const fixture = makeFixture();
  let lostResponse = true;
  const adapter = createGitHubDeliveryAdapter({
    repoRoot: fixture.repoRoot,
    controller: fixture.controller,
    campaign: fixture.campaign,
    runGit: async (args, options) => {
      if (args[0] === 'push' && lostResponse) {
        lostResponse = false;
        fixture.state.mutationCalls.push(['push', [...args]]);
        fixture.state.remoteHead = fixture.candidateHeadCommit;
        throw new Error('connection dropped after server applied push');
      }
      return fixture.runGit(args, options);
    },
    runGh: fixture.runGh,
  });
  try {
    const first = await adapter.tick();
    assert.equal(first.status, 'BLOCKED', JSON.stringify(first));
    assert.equal(first.code, 'DELIVERY_STEP_FAILED');
    const reconciled = await adapter.tick();
    assert.equal(reconciled.status, 'RECONCILED_APPLIED');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push']);
    const created = await adapter.tick();
    assert.equal(created.status, 'PR_CREATED');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push', 'pullRequest']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a crash with proven no effect is backed off before the bounded retry', async () => {
  const fixture = makeFixture();
  let lostResponse = true;
  const adapter = createGitHubDeliveryAdapter({
    repoRoot: fixture.repoRoot,
    controller: fixture.controller,
    campaign: fixture.campaign,
    runGit: async (args, options) => {
      if (args[0] === 'push' && lostResponse) {
        lostResponse = false;
        fixture.state.mutationCalls.push(['push', [...args]]);
        throw new Error('connection dropped before remote effect');
      }
      return fixture.runGit(args, options);
    },
    runGh: fixture.runGh,
  });
  try {
    const first = await adapter.tick();
    assert.equal(first.code, 'DELIVERY_STEP_FAILED');
    const reconciled = await adapter.tick();
    assert.equal(reconciled.status, 'RECONCILED_NO_EFFECT');
    assert.ok(reconciled.retryAt);
    const backedOff = await adapter.tick();
    assert.equal(backedOff.status, 'WAITING_RETRY_BACKOFF');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['push']);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a second adapter cannot mutate while another process holds the delivery lock', async () => {
  let releaseRemoteRead;
  let reachedRemoteRead;
  const held = new Promise((resolve) => { releaseRemoteRead = resolve; });
  const reached = new Promise((resolve) => { reachedRemoteRead = resolve; });
  const fixture = makeFixture({ holdRemoteRead: async () => {
    reachedRemoteRead();
    await held;
  } });
  fixture.state.remoteHead = fixture.candidateHeadCommit;
  try {
    const first = fixture.makeAdapter();
    const second = fixture.makeAdapter();
    const firstTick = first.tick();
    await reached;
    const secondResult = await second.tick();
    assert.equal(secondResult.status, 'BUSY');
    releaseRemoteRead();
    const firstResult = await firstTick;
    assert.equal(firstResult.status, 'PR_CREATED');
    assert.deepEqual(fixture.state.mutationCalls.map(([action]) => action), ['pullRequest']);
  } finally {
    releaseRemoteRead();
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

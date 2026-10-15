import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGitHubDeliveryAdapter, GITHUB_DELIVERY_SCHEMA } from '../delivery-control/github-delivery.mjs';

const HEAD_BRANCH = 'codex/delivery-test';
const BASE_BRANCH = 'main';
const REPOSITORY = 'github.com/acme/demo';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function makeFixture({ initialRemoteHead = null, holdRemoteRead = null } = {}) {
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
    mutationCalls: [],
    commandCalls: [],
    holdRemoteRead,
  };

  const controller = {
    verifyEventChain() { return { count: 1, head: 'a'.repeat(64) }; },
    getRun(taskId) {
      return {
        taskId,
        state: 'ROOT_INTEGRATED_PENDING_CI',
        branch: HEAD_BRANCH,
        baseCommit: state.baseCommit,
        candidateHeadCommit,
        currentCycle: 1,
        cycles: [{ cycleNo: 1, state: 'INTEGRATED' }],
        rootIntegration: { headCommit: candidateHeadCommit, state: 'ROOT_INTEGRATED_PENDING_CI' },
        worktreeRoot: repoRoot,
        stages: [
          { role: 'worker', stage: 'WORKER_IMPLEMENTATION', status: 'PASSED', exactHeadCommit: candidateHeadCommit, effectState: 'APPLIED', evidenceRef: 'worker-evidence', sessionId: 'worker-session' },
          { role: 'verifier', stage: 'INDEPENDENT_VERIFY', status: 'PASSED', exactHeadCommit: candidateHeadCommit, effectState: 'APPLIED', evidenceRef: 'verify-evidence', sessionId: 'verify-session' },
          { role: 'reviewer', stage: 'INDEPENDENT_REVIEW', status: 'PASSED', exactHeadCommit: candidateHeadCommit, effectState: 'APPLIED', evidenceRef: 'review-evidence', sessionId: 'review-session' },
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
      const result = execFileSync('git', args, {
        cwd: options.cwd,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return commandResult(0, result);
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
        return commandResult(0, JSON.stringify({ data: { repository: { pullRequest: { mergeQueueEntry: null } } } }));
      }
      if (command === 'pr merge') {
        state.mutationCalls.push(['merge', [...args]]);
        const pr = state.pullRequests.find((item) => item.number === Number(args[2]));
        pr.state = 'MERGED';
        pr.mergedAt = '2026-10-15T00:00:00Z';
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

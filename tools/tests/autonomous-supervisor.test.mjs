import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createAutonomousSupervisor, loadSupervisorCampaign, shouldYieldFiniteRun } from '../delivery-control/autonomous-supervisor.mjs';

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-supervisor-'));
  t.after(() => { const relative = path.relative(os.tmpdir(), folder); assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative)); fs.rmSync(folder, { recursive: true, force: true }); });
  execFileSync('git', ['init', '-q', folder]);
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: folder });
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8' }).trim();
  const remote = path.join(folder, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: folder });
  execFileSync('git', ['push', '--quiet', 'origin', 'HEAD:refs/heads/main'], { cwd: folder });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', baseSha], { cwd: folder });
  const privateRoot = path.join(folder, '.git', 'zuri-delivery-control'); fs.mkdirSync(privateRoot, { recursive: true });
  const intakeFile = path.join(privateRoot, 'intake.json');
  const campaignFile = path.join(privateRoot, 'supervisor.json');
  const prohibitions = ['production', 'Supabase', 'credentials', 'grants'];
  fs.writeFileSync(intakeFile, JSON.stringify({ repositoryRoot: folder, baseRef: 'origin/main', allowedTaskIds: ['T1'], prohibitions }));
  const campaign = { schemaVersion: 'autonomous-delivery-campaign/v1', campaignId: 'fixture', repositoryRoot: folder,
    sourceRef: 'trusted user fixture mandate', authorizedEffects: ['intake', 'dispatch', 'rootIntegration', 'push', 'pullRequest', 'merge'],
    prohibitions, intakeCampaignFile: intakeFile, delivery: { expectedOwnerRepo: 'github.com/fixture/repo', requiredChecks: ['verify'] } };
  fs.writeFileSync(campaignFile, JSON.stringify(campaign));
  const runs = new Map(); const seen = []; const bindings = [];
  const resumeCalls = []; const preflightCalls = []; const runnerEvents = []; const authorizeCalls = [];
  const hooks = { resumeImpl: null, fetchedBaseSha: 'c'.repeat(40), remoteBaseSha: 'c'.repeat(40), afterResume: null,
    baseAdvancedImpl: null, baseAdvancedSignature: 'stable-base-advanced-signature' };
  const controller = { getRun: (id) => runs.get(id), verifyEventChain: () => ({ count: 0, head: 'GENESIS' }),
    resumeTask: (input) => { resumeCalls.push(input); if (!hooks.resumeImpl) throw new Error('TEST_RESUME_NOT_CONFIGURED'); return hooks.resumeImpl(input); },
    recordRootIntegration: ({ taskId, headCommit }) => { const run = runs.get(taskId); assert.equal(run.state, 'ROOT_DELIVERY_READY'); assert.equal(headCommit, run.candidateHeadCommit); run.state = 'ROOT_INTEGRATED_PENDING_CI'; seen.push('integration'); } };
  const inputBinding = { taskId: 'T1', worktree: folder, taskFile: path.join(privateRoot, 'task.json') };
  const options = { repoRoot: folder, campaignFile, controller, intake: async () => ({ controllerBinding: inputBinding }),
    fetchPreparedBase: async () => hooks.fetchedBaseSha,
    readRemoteBase: async () => hooks.remoteBaseSha,
    baseAdvancedResume: async (input) => {
      if (!hooks.baseAdvancedImpl) throw new Error('TEST_BASE_ADVANCED_NOT_CONFIGURED');
      return hooks.baseAdvancedImpl(input);
    },
    baseAdvancedResumeSignature: async () => hooks.baseAdvancedSignature,
    admit: async () => [], preflight: async ({ taskFile, base }) => {
      preflightCalls.push(base);
      return { status: 'READY', taskId: 'T1', baseline: {
        base, baseRevision: base, headRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8' }).trim(), branch: 'codex/t1' } };
    },
    runnerFactory: () => {
      const held = new Set();
      return {
        addBinding: (item) => bindings.push(item),
        isActive: () => false,
        hold: (taskId) => held.add(taskId),
        wake: (taskId) => held.delete(taskId),
        authorizePreparedCandidate: (taskId, receiptFile, expectedDigest) => {
          authorizeCalls.push({ taskId, receiptFile, expectedDigest });
          const run = runs.get(taskId);
          if (run?.preparedBaseResume?.receiptDigest !== expectedDigest
              || createHash('sha256').update(fs.readFileSync(receiptFile)).digest('hex') !== expectedDigest) {
            throw new Error('PREPARED_RECEIPT_DIGEST_MISMATCH');
          }
          runnerEvents.push('authorize'); held.delete(taskId);
        },
        tick: async () => {
          runnerEvents.push('tick');
          if (!held.has('T1') && runs.get('T1')?.state === 'WORKER_READY') runnerEvents.push('worker-dispatch');
          return { active: 0, errors: [] };
        },
        stop: async () => {},
      };
    },
    deliveryFactory: () => ({ tick: async () => { seen.push('delivery'); return { status: 'MERGED', pullRequest: 1 }; } }) };
  return { folder, privateRoot, campaignFile, campaign, options, runs, seen, bindings, resumeCalls, preflightCalls,
    runnerEvents, authorizeCalls, hooks, inputBinding };
}

function preparePausedRun(f, receiptOverrides = {}) {
  const task = { schemaVersion: 'task-readiness/v1', taskId: 'T1', objective: 'Resume a prepared candidate.',
    acceptance: ['Resume only after receipt proof.'], writeScope: ['src/'],
    checks: [{ shell: false, executable: 'node', argv: ['--version'], cwd: '.' }], mandateReference: 'fixture://trusted' };
  const trustedMandateBinding = { resolvedBy: 'root', taskId: 'T1', repositoryRoot: f.folder, objective: task.objective,
    writeScope: task.writeScope, sourceRef: 'fixture://trusted', authorizedEffects: ['local fixture checks'], prohibitions: ['external effects'] };
  fs.writeFileSync(f.inputBinding.taskFile, JSON.stringify(task));
  const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.folder, encoding: 'utf8' }).trim();
  const run = { taskId: 'T1', state: 'BLOCKED_STALE_CANDIDATE', currentCycle: 2, candidateHeadCommit: 'a'.repeat(40),
    initialHeadCommit: 'a'.repeat(40), branch: 'codex/t1', baseCommit: 'b'.repeat(40), objective: task.objective,
    taskRecord: task, trustedMandateBinding, cycles: [{ cycleNo: 1, submissions: 3, implementationRepairs: 2, toolRetries: 1,
      startedAt: new Date().toISOString() }] };
  f.runs.set('T1', run);
  const preparedDir = path.join(f.privateRoot, 'supervisors', 'fixture', 'prepared');
  fs.mkdirSync(preparedDir, { recursive: true });
  const file = path.join(preparedDir, 'T1.json');
  const receipt = { schemaVersion: 'root-base-prepared-candidate/v1', taskId: 'T1', cycleNo: 2, oldHeadCommit: 'a'.repeat(40),
    headCommit, oldBaseCommit: 'b'.repeat(40), newBaseCommit: 'c'.repeat(40), reason: 'Root prepared a newer base.',
    evidenceRef: 'root://prepared-candidate', ...receiptOverrides };
  fs.writeFileSync(file, JSON.stringify(receipt));
  f.hooks.resumeImpl = (input) => {
    f.runnerEvents.push('resume');
    const receiptBytes = fs.readFileSync(input.preparedBaseReceiptFile);
    const current = JSON.parse(receiptBytes.toString('utf8'));
    if (input.taskRecord.taskId !== run.taskId || current.taskId !== run.taskId
        || current.oldHeadCommit !== run.candidateHeadCommit || current.oldBaseCommit !== run.baseCommit
        || current.newBaseCommit !== input.preflightResult.baseline.baseRevision
        || current.headCommit !== input.preflightResult.baseline.headRevision || current.cycleNo !== run.currentCycle) throw new Error('PREPARED_BASE_RECEIPT_BINDING_MISMATCH');
    run.preparedBaseResume = { taskId: run.taskId, receiptDigest: createHash('sha256').update(receiptBytes).digest('hex') };
    run.state = 'WORKER_READY'; run.baseCommit = current.newBaseCommit; run.candidateHeadCommit = null;
    f.hooks.afterResume?.(input);
    return run;
  };
  return { task, run, file, receipt, headCommit };
}

test('campaign authority is private and exact repository bound', (t) => {
  const f = fixture(t);
  assert.equal(loadSupervisorCampaign(f.folder, f.campaignFile).campaign.campaignId, 'fixture');
  const publicFile = path.join(f.folder, 'campaign.json'); fs.copyFileSync(f.campaignFile, publicFile);
  assert.throws(() => loadSupervisorCampaign(f.folder, publicFile), /CAMPAIGN_MUST_BE_PRIVATE/);
  fs.writeFileSync(f.campaignFile, JSON.stringify({ ...f.campaign, authorizedEffects: ['intake'] }));
  assert.throws(() => loadSupervisorCampaign(f.folder, f.campaignFile), /INVALID_SUPERVISOR_CAMPAIGN/);
});

test('prepared-base root adapter proves the paused run before authorizing or dispatching a worker', async (t) => {
  const f = fixture(t);
  const prepared = preparePausedRun(f);
  const supervisor = await createAutonomousSupervisor(f.options);
  const result = await supervisor.tick();
  assert.equal(result.status, 'RUNNING');
  assert.equal(f.resumeCalls.length, 1);
  assert.equal(f.resumeCalls[0].preparedBaseReceiptFile, prepared.file);
  assert.equal(f.resumeCalls[0].taskRecord.taskId, 'T1');
  assert.equal(f.resumeCalls[0].preflightResult.baseline.baseRevision, prepared.receipt.newBaseCommit);
  assert.equal(f.authorizeCalls[0].expectedDigest, prepared.run.preparedBaseResume.receiptDigest);
  assert.deepEqual(f.runnerEvents, ['resume', 'authorize', 'tick', 'worker-dispatch']);
  assert.equal(prepared.run.state, 'WORKER_READY');
  assert.equal(prepared.run.currentCycle, 2);
  assert.equal(prepared.run.cycles[0].submissions, 3);
  await supervisor.stop();
});

test('unchanged invalid prepared-base evidence stays held across iterations and restart until changed or reassessed', async (t) => {
  const f = fixture(t);
  const prepared = preparePausedRun(f, { oldHeadCommit: 'd'.repeat(40) });
  const rejectReceipt = f.hooks.resumeImpl;
  f.hooks.resumeImpl = (input) => { f.runnerEvents.push('resume'); return rejectReceipt(input); };
  let supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(f.resumeCalls.length, 1);
  assert.equal(f.runs.get('T1').state, 'BLOCKED_STALE_CANDIDATE');
  assert.deepEqual(f.runnerEvents.filter((item) => item === 'worker-dispatch'), []);
  await supervisor.tick();
  assert.equal(f.resumeCalls.length, 1);
  await supervisor.stop();

  supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(f.resumeCalls.length, 1);
  assert.equal(supervisor.status().preparedResumeBlocked.T1.code, 'PREPARED_BASE_RECEIPT_BINDING_MISMATCH');
  const reassessed = supervisor.reassessPreparedResume({ taskId: 'T1', evidenceRef: 'root://reassessment', reason: 'Root reviewed the same receipt.' });
  assert.equal(reassessed.status, 'PREPARED_RESUME_REASSESSMENT_QUEUED');
  await supervisor.tick();
  assert.equal(f.resumeCalls.length, 2);
  assert.deepEqual(f.runnerEvents.filter((item) => item === 'worker-dispatch'), []);

  writeFileSync(prepared.file, JSON.stringify({ ...prepared.receipt, oldHeadCommit: 'a'.repeat(40) }));
  await supervisor.tick();
  assert.equal(f.resumeCalls.length, 3);
  assert.equal(f.runs.get('T1').state, 'WORKER_READY');
  assert.equal(f.runnerEvents.at(-1), 'worker-dispatch', JSON.stringify({ events: f.runnerEvents,
    blocked: supervisor.status().preparedResumeBlocked, auth: f.authorizeCalls,
    proof: f.runs.get('T1')?.preparedBaseResume,
    actualDigest: createHash('sha256').update(fs.readFileSync(prepared.file)).digest('hex') }));
  await supervisor.stop();
});

test('receipt replacement after transactional resume cannot pass runner authorization', async (t) => {
  const f = fixture(t);
  const prepared = preparePausedRun(f);
  f.hooks.afterResume = () => writeFileSync(prepared.file, JSON.stringify({ ...prepared.receipt, reason: 'replacement bytes' }));
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(f.runs.get('T1').state, 'WORKER_READY');
  assert.equal(f.authorizeCalls.length, 1);
  assert.equal(f.authorizeCalls[0].expectedDigest, f.runs.get('T1').preparedBaseResume.receiptDigest);
  assert.equal(supervisor.status().preparedResumeBlocked.T1.code, 'PREPARED_RECEIPT_DIGEST_MISMATCH');
  assert.deepEqual(f.runnerEvents.filter((item) => item === 'worker-dispatch'), []);
  await supervisor.tick();
  assert.equal(f.authorizeCalls.length, 1);
  assert.deepEqual(f.runnerEvents.filter((item) => item === 'worker-dispatch'), []);
  await supervisor.stop();
});

test('receipt removal after transactional resume keeps Worker held', async (t) => {
  const f = fixture(t);
  const prepared = preparePausedRun(f);
  f.hooks.afterResume = () => unlinkSync(prepared.file);
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(f.runs.get('T1').state, 'WORKER_READY');
  assert.equal(f.authorizeCalls.length, 1);
  assert.equal(supervisor.status().preparedResumeBlocked.T1.code, 'ENOENT');
  assert.deepEqual(f.runnerEvents.filter((item) => item === 'worker-dispatch'), []);
  await supervisor.stop();
});

test('stale origin/main is rejected before the paused run can resume', async (t) => {
  const f = fixture(t);
  const prepared = preparePausedRun(f);
  f.hooks.remoteBaseSha = 'd'.repeat(40);
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(f.resumeCalls.length, 0);
  assert.deepEqual(f.preflightCalls, []);
  assert.equal(f.runs.get('T1').state, 'BLOCKED_STALE_CANDIDATE');
  assert.equal(supervisor.status().preparedResumeBlocked.T1.code, 'PREPARED_BASE_REMOTE_ADVANCED');
  assert.deepEqual(f.runnerEvents.filter((item) => item === 'worker-dispatch'), []);
  f.hooks.remoteBaseSha = prepared.receipt.newBaseCommit;
  await supervisor.tick();
  assert.equal(f.resumeCalls.length, 1);
  assert.equal(f.runs.get('T1').state, 'WORKER_READY');
  await supervisor.stop();
});

test('a receipt cannot choose a stale origin/main preflight SHA', async (t) => {
  const f = fixture(t);
  const prepared = preparePausedRun(f);
  delete f.options.fetchPreparedBase;
  delete f.options.readRemoteBase;
  const actualOriginMain = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: f.folder, encoding: 'utf8' }).trim();
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(f.preflightCalls[0], actualOriginMain);
  assert.notEqual(f.preflightCalls[0], prepared.receipt.newBaseCommit);
  assert.equal(f.resumeCalls.length, 1);
  assert.equal(f.runs.get('T1').state, 'BLOCKED_STALE_CANDIDATE');
  assert.equal(supervisor.status().preparedResumeBlocked.T1.code, 'PREPARED_BASE_RECEIPT_BINDING_MISMATCH');
  assert.deepEqual(f.runnerEvents.filter((item) => item === 'worker-dispatch'), []);
  await supervisor.stop();
});

test('only exact root-ready pipeline reaches delivery and restart does not re-deliver merged work', async (t) => {
  const f = fixture(t);
  const run = { taskId: 'T1', state: 'QUARANTINED', candidateHeadCommit: 'a'.repeat(40), branch: 'codex/t1', baseCommit: 'b'.repeat(40) };
  f.runs.set('T1', run);
  let supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick(); assert.deepEqual(f.seen, []); assert.equal(f.bindings.length, 1);
  run.state = 'ROOT_DELIVERY_READY';
  await supervisor.tick(); assert.deepEqual(f.seen, ['integration', 'delivery']);
  await supervisor.tick(); assert.equal(f.seen.length, 2);
  await supervisor.stop();
  supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick(); assert.equal(f.seen.length, 2);
  await supervisor.stop();
});

test('second live supervisor and changed campaign are blocked before effects', async (t) => {
  const f = fixture(t); const supervisor = await createAutonomousSupervisor(f.options);
  await assert.rejects(createAutonomousSupervisor(f.options), /SUPERVISOR_ALREADY_RUNNING/);
  fs.writeFileSync(f.campaignFile, JSON.stringify({ ...f.campaign, sourceRef: 'changed' }));
  await assert.rejects(supervisor.tick(), /CAMPAIGN_CHANGED_REASSESSMENT_REQUIRED/);
  assert.deepEqual(f.seen, []); await supervisor.stop();
  await assert.rejects(createAutonomousSupervisor(f.options), /CAMPAIGN_CHANGED_REASSESSMENT_REQUIRED/);
});

test('pending CI is a resumable wait and unknown worker state is not integrated', async (t) => {
  const f = fixture(t); let ticks = 0;
  f.options.deliveryFactory = () => ({ tick: async () => ({ status: ++ticks === 1 ? 'WAITING_CI' : 'MERGED' }) });
  f.runs.set('T1', { taskId: 'T1', state: 'ROOT_INTEGRATED_PENDING_CI', candidateHeadCommit: 'a'.repeat(40), branch: 'codex/t1', baseCommit: 'b'.repeat(40) });
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick(); assert.equal(supervisor.status().deliveries.T1.status, 'WAITING_CI');
  await supervisor.tick(); assert.equal(supervisor.status().deliveries.T1.status, 'MERGED');
  await supervisor.stop();
});

test('intake exception is held without stopping an independently ready delivery', async (t) => {
  const f = fixture(t); const original = f.options.intake; let calls = 0;
  f.options.intake = async (input) => { if (++calls > 1) throw new Error('TASK_METADATA_UNAVAILABLE'); return original(input); };
  f.runs.set('T1', { taskId: 'T1', state: 'WORKER_READY', candidateHeadCommit: 'a'.repeat(40), branch: 'codex/t1', baseCommit: 'b'.repeat(40) });
  const supervisor = await createAutonomousSupervisor(f.options); await supervisor.tick();
  f.runs.get('T1').state = 'ROOT_DELIVERY_READY';
  await supervisor.tick(); assert.deepEqual(f.seen, ['integration', 'delivery']);
  await supervisor.tick(); assert.equal(calls, 2); // unchanged failed intake is suppressed
  await supervisor.stop();
});

test('deadline is anchored to actual worker cycle and survives restart', async (t) => {
  const f = fixture(t);
  f.runs.set('T1', { taskId: 'T1', state: 'ROOT_DELIVERY_READY', candidateHeadCommit: 'a'.repeat(40),
    cycles: [{ startedAt: new Date(Date.now() - 121 * 60_000).toISOString() }] });
  let supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE'); assert.deepEqual(f.seen, []);
  await supervisor.stop(); supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE'); assert.deepEqual(f.seen, []);
  await supervisor.stop();
});

test('finite run yields an idle dependency or replan hold without claiming completion', () => {
  assert.equal(shouldYieldFiniteRun({ deliveries: {}, intake: { status: 'HOLD_DEPENDENCY' } }, { active: 0 }), true);
  assert.equal(shouldYieldFiniteRun({ deliveries: { T1: { status: 'ROOT_REPLAN_PAUSED' } } }, { active: 0 }), true);
  assert.equal(shouldYieldFiniteRun({ deliveries: { T1: { status: 'WAITING_CI' } } }, { active: 0 }), false);
  assert.equal(shouldYieldFiniteRun({ deliveries: { T1: { status: 'RECONCILED_APPLIED' } } }, { active: 0 }), false);
  assert.equal(shouldYieldFiniteRun({ deliveries: {} }, { active: 1 }), false);
});

test('a base advance pauses only that revision until autonomous root supplies fresh gates', async (t) => {
  const f = fixture(t); let calls = 0;
  f.options.deliveryFactory = () => ({ tick: async () => { calls++; return { status: 'REPLAN_REQUIRED', code: 'BASE_ADVANCED', actualBaseCommit: 'c'.repeat(40) }; } });
  const run = { taskId: 'T1', state: 'ROOT_INTEGRATED_PENDING_CI', candidateHeadCommit: 'a'.repeat(40), branch: 'codex/t1', baseCommit: 'b'.repeat(40) };
  f.runs.set('T1', run);
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick(); await supervisor.tick(); assert.equal(calls, 1);
  assert.equal(supervisor.status().deliveries.T1.status, 'ROOT_REPLAN_PAUSED');
  run.candidateHeadCommit = 'd'.repeat(40); run.baseCommit = 'c'.repeat(40);
  await supervisor.tick(); assert.equal(calls, 2);
  await supervisor.stop();
});

test('BASE_ADVANCED prepared resume invalidates prior delivery evidence and dispatches after receipt authorization', async (t) => {
  const f = fixture(t);
  const prepared = preparePausedRun(f);
  prepared.run.state = 'ROOT_INTEGRATED_PENDING_CI';
  prepared.run.currentCycle = 2;
  let deliveryCalls = 0;
  f.options.deliveryFactory = () => ({ tick: async () => {
    deliveryCalls++;
    return { status: 'REPLAN_REQUIRED', code: 'BASE_ADVANCED', expectedBaseCommit: prepared.run.baseCommit,
      actualBaseCommit: 'c'.repeat(40), candidateHeadCommit: prepared.run.candidateHeadCommit, number: 17 };
  } });
  f.hooks.baseAdvancedImpl = async ({ binding, checkpoint, stateRoot }) => {
    assert.equal(binding.taskId, 'T1');
    assert.equal(checkpoint.status, 'ROOT_REPLAN_PAUSED');
    assert.equal(checkpoint.code, 'BASE_ADVANCED');
    prepared.run.state = 'BLOCKED_STALE_CANDIDATE';
    const receipt = { schemaVersion: 'root-base-prepared-candidate/v1', taskId: 'T1', cycleNo: 2,
      oldHeadCommit: prepared.run.candidateHeadCommit, headCommit: prepared.headCommit,
      oldBaseCommit: prepared.run.baseCommit, newBaseCommit: 'c'.repeat(40),
      reason: 'The root fetched and merged the exact advanced base.', evidenceRef: 'private://base-advanced' };
    const folder = path.join(stateRoot, 'prepared'); fs.mkdirSync(folder, { recursive: true });
    const receiptFile = path.join(folder, 'T1-cycle-2.json'); fs.writeFileSync(receiptFile, JSON.stringify(receipt));
    return { status: 'READY_TO_RESUME', receipt, receiptFile };
  };
  const resume = f.hooks.resumeImpl;
  f.hooks.resumeImpl = (input) => {
    const run = resume(input);
    run.stages = [{ role: 'worker', status: 'READY' }, { role: 'verifier', status: 'WAITING' }, { role: 'reviewer', status: 'WAITING' }];
    return run;
  };
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(supervisor.status().deliveries.T1.status, 'ROOT_REPLAN_PAUSED');
  f.runnerEvents.length = 0;
  const result = await supervisor.tick();
  assert.equal(deliveryCalls, 1);
  assert.equal(f.resumeCalls.length, 1);
  assert.equal(f.resumeCalls[0].preparedBaseReceiptFile, f.authorizeCalls[0].receiptFile);
  assert.equal(prepared.run.state, 'WORKER_READY');
  assert.equal(prepared.run.currentCycle, 2);
  assert.deepEqual(prepared.run.stages.map((stage) => stage.status), ['READY', 'WAITING', 'WAITING']);
  assert.deepEqual(f.runnerEvents, ['resume', 'authorize', 'tick', 'worker-dispatch']);
  assert.equal(supervisor.status().deliveries.T1, undefined);
  const checkpoint = JSON.parse(fs.readFileSync(path.join(supervisor.stateRoot, 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.deliveryHistory.T1[0].priorEvidenceInvalidated, true);
  assert.equal(checkpoint.deliveryHistory.T1[0].checkpoint.status, 'ROOT_REPLAN_PAUSED');
  assert.equal(result.observations.some((item) => item.status === 'BASE_ADVANCED_RESUME_PREPARED'), true);
  await supervisor.stop();
});

test('unchanged BASE_ADVANCED evidence remains held across ticks and supervisor restart', async (t) => {
  const f = fixture(t);
  const prepared = preparePausedRun(f);
  prepared.run.state = 'ROOT_INTEGRATED_PENDING_CI';
  prepared.run.currentCycle = 2;
  let deliveries = 0; let bridgeCalls = 0;
  f.options.deliveryFactory = () => ({ tick: async () => {
    deliveries++;
    return { status: 'REPLAN_REQUIRED', code: 'BASE_ADVANCED', expectedBaseCommit: prepared.run.baseCommit,
      actualBaseCommit: 'c'.repeat(40), candidateHeadCommit: prepared.run.candidateHeadCommit };
  } });
  f.hooks.baseAdvancedImpl = async () => { bridgeCalls++; throw new Error('BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN'); };
  let supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  await supervisor.tick();
  await supervisor.tick();
  assert.equal(bridgeCalls, 1);
  assert.equal(deliveries, 1);
  assert.equal(supervisor.status().baseAdvancedResumeBlocked.T1.code, 'BASE_ADVANCED_MERGE_OUTCOME_UNKNOWN');
  assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
  await supervisor.stop();

  supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(bridgeCalls, 1);
  assert.equal(deliveries, 1);
  assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
  await supervisor.stop();
});

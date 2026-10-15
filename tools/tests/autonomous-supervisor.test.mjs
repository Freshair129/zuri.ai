import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createAutonomousSupervisor, loadSupervisorCampaign } from '../delivery-control/autonomous-supervisor.mjs';

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-supervisor-'));
  t.after(() => { const relative = path.relative(os.tmpdir(), folder); assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative)); fs.rmSync(folder, { recursive: true, force: true }); });
  execFileSync('git', ['init', '-q', folder]);
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: folder });
  const privateRoot = path.join(folder, '.git', 'zuri-delivery-control'); fs.mkdirSync(privateRoot, { recursive: true });
  const intakeFile = path.join(privateRoot, 'intake.json');
  const campaignFile = path.join(privateRoot, 'supervisor.json');
  const prohibitions = ['production', 'Supabase', 'credentials', 'grants'];
  fs.writeFileSync(intakeFile, JSON.stringify({ repositoryRoot: folder, baseRef: 'HEAD', allowedTaskIds: ['T1'], prohibitions }));
  const campaign = { schemaVersion: 'autonomous-delivery-campaign/v1', campaignId: 'fixture', repositoryRoot: folder,
    sourceRef: 'trusted user fixture mandate', authorizedEffects: ['intake', 'dispatch', 'rootIntegration', 'push', 'pullRequest', 'merge'],
    prohibitions, intakeCampaignFile: intakeFile, delivery: { expectedOwnerRepo: 'fixture/repo', requiredChecks: ['verify'] } };
  fs.writeFileSync(campaignFile, JSON.stringify(campaign));
  const runs = new Map(); const seen = []; const bindings = [];
  const controller = { getRun: (id) => runs.get(id), verifyEventChain: () => ({ count: 0, head: 'GENESIS' }),
    recordRootIntegration: ({ taskId, headCommit }) => { const run = runs.get(taskId); assert.equal(run.state, 'ROOT_DELIVERY_READY'); assert.equal(headCommit, run.candidateHeadCommit); run.state = 'ROOT_INTEGRATED_PENDING_CI'; seen.push('integration'); } };
  const inputBinding = { taskId: 'T1', worktree: folder, taskFile: path.join(privateRoot, 'task.json') };
  const options = { repoRoot: folder, campaignFile, controller, intake: async () => ({ controllerBinding: inputBinding }),
    admit: async () => [], runnerFactory: () => ({ addBinding: (item) => bindings.push(item), tick: async () => ({ active: 0, errors: [] }), stop: async () => {} }),
    deliveryFactory: () => ({ tick: async () => { seen.push('delivery'); return { status: 'MERGED', pullRequest: 1 }; } }) };
  return { folder, privateRoot, campaignFile, campaign, options, runs, seen, bindings };
}

test('campaign authority is private and exact repository bound', (t) => {
  const f = fixture(t);
  assert.equal(loadSupervisorCampaign(f.folder, f.campaignFile).campaign.campaignId, 'fixture');
  const publicFile = path.join(f.folder, 'campaign.json'); fs.copyFileSync(f.campaignFile, publicFile);
  assert.throws(() => loadSupervisorCampaign(f.folder, publicFile), /CAMPAIGN_MUST_BE_PRIVATE/);
  fs.writeFileSync(f.campaignFile, JSON.stringify({ ...f.campaign, authorizedEffects: ['intake'] }));
  assert.throws(() => loadSupervisorCampaign(f.folder, f.campaignFile), /INVALID_SUPERVISOR_CAMPAIGN/);
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

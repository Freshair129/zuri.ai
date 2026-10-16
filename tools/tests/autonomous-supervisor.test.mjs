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
  const clock = { current: Date.now() };
  const runs = new Map(); const workerIntentHistory = new Map(); const campaignDeadlinePins = new Map(); const seen = []; const bindings = [];
  const resumeCalls = []; const preflightCalls = []; const runnerEvents = []; const authorizeCalls = []; const admissionCalls = []; const runnerInstances = [];
  const runnerDeadlineGuards = [];
  const makeWorkerIntents = (run) => {
    const intents = []; let sequence = 1;
    for (const cycle of run?.cycles ?? []) {
      const count = Number.isSafeInteger(cycle.submissions) && cycle.submissions > 0 ? Math.min(cycle.submissions, 20) : 0;
      const startedAt = typeof cycle.startedAt === 'string' && Number.isFinite(Date.parse(cycle.startedAt))
        ? Date.parse(cycle.startedAt) : clock.current;
      for (let index = 0; index < count; index++) intents.push({ taskId: run.taskId, cycleNo: cycle.cycleNo,
        occurredAt: new Date(startedAt + 5 + index).toISOString(), sequence: sequence++ });
    }
    return intents;
  };
  const rawRunsSet = runs.set.bind(runs);
  runs.set = (taskId, run) => {
    rawRunsSet(taskId, run);
    workerIntentHistory.set(taskId, makeWorkerIntents(run));
    return runs;
  };
  const inspectFakeCampaignDispatchHistory = ({ taskIds }) => {
    if (!Array.isArray(taskIds) || new Set(taskIds).size !== taskIds.length) throw new Error('FAKE_INVALID_TASK_IDS');
    const normalizedTaskIds = [...taskIds].sort(); const workerIntents = [];
    for (const taskId of normalizedTaskIds) {
      const run = runs.get(taskId);
      if (!run) throw new Error(`Campaign dispatch history run is missing for ${taskId}.`);
      if (!Number.isSafeInteger(run.currentCycle) || run.currentCycle < 1 || !Array.isArray(run.cycles)
          || run.cycles.length !== run.currentCycle) throw new Error('Campaign dispatch history is incomplete.');
      const intents = workerIntentHistory.get(taskId) ?? [];
      for (let index = 0; index < run.cycles.length; index++) {
        const cycle = run.cycles[index];
        if (cycle?.cycleNo !== index + 1) throw new Error('Campaign dispatch history is not contiguous.');
        if (!Number.isSafeInteger(cycle.submissions) || cycle.submissions < 0) throw new Error('Invalid submission count.');
        const hasStartedAt = cycle.startedAt !== null && cycle.startedAt !== undefined;
        const startedAt = hasStartedAt ? Date.parse(cycle.startedAt) : null;
        if (hasStartedAt && (!Number.isFinite(startedAt) || new Date(startedAt).toISOString() !== cycle.startedAt)) {
          throw new Error('Invalid start timestamp.');
        }
        const cycleIntents = intents.filter((item) => item.cycleNo === cycle.cycleNo);
        if (cycleIntents.length !== cycle.submissions) throw new Error('Projection does not match immutable worker dispatch events.');
        if (hasStartedAt !== (cycle.submissions > 0)) throw new Error('Inconsistent dispatch projection.');
        if (cycleIntents.length) {
          const firstIntentAt = Math.min(...cycleIntents.map((item) => Date.parse(item.occurredAt)));
          if (firstIntentAt < startedAt || firstIntentAt - startedAt > 60_000) throw new Error('Start does not match worker intent events.');
        }
      }
      if (intents.some((item) => !run.cycles.some((cycle) => cycle.cycleNo === item.cycleNo))) {
        throw new Error('Worker dispatch event references an absent cycle.');
      }
      workerIntents.push(...intents);
    }
    workerIntents.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.sequence - right.sequence);
    return { schemaVersion: 'campaign-dispatch-history/v1', taskIds: normalizedTaskIds, workerIntents,
      earliestWorkerIntentAt: workerIntents[0]?.occurredAt ?? null };
  };
  const reconcileFakeCampaignDeadline = ({ campaignId, taskIds, campaignDurationMinutes, checkpointDeadlineAt = null }) => {
    const previous = campaignDeadlinePins.get(campaignId) ?? null;
    if (previous && previous.campaignDurationMinutes !== campaignDurationMinutes) throw new Error('Pinned campaign duration changed.');
    const cumulativeTaskIds = [...new Set([...(taskIds ?? []), ...(previous?.taskIds ?? [])])].sort();
    const history = inspectFakeCampaignDispatchHistory({ taskIds: cumulativeTaskIds });
    if (history.earliestWorkerIntentAt === null) {
      if (previous || checkpointDeadlineAt !== null) throw new Error('Deadline or pin without dispatch source.');
      return { schemaVersion: 'campaign-deadline-reconciliation/v1', campaignId, taskIds: cumulativeTaskIds,
        campaignDurationMinutes, sourceDeadlineAt: null, effectiveDeadlineAt: null, changed: false };
    }
    const sourceDeadlineAt = new Date(Date.parse(history.earliestWorkerIntentAt)
      + campaignDurationMinutes * 60_000).toISOString();
    if (previous && Date.parse(sourceDeadlineAt) > Date.parse(previous.sourceDeadlineAt)) throw new Error('Source deadline moved later.');
    const checkpointMs = typeof checkpointDeadlineAt === 'string' && Number.isFinite(Date.parse(checkpointDeadlineAt))
      && new Date(Date.parse(checkpointDeadlineAt)).toISOString() === checkpointDeadlineAt ? Date.parse(checkpointDeadlineAt) : null;
    const effectiveDeadlineAt = previous
      ? new Date(Math.min(Date.parse(previous.effectiveDeadlineAt), Date.parse(sourceDeadlineAt))).toISOString()
      : checkpointMs !== null && checkpointMs <= Date.parse(sourceDeadlineAt)
        ? checkpointDeadlineAt : sourceDeadlineAt;
    const current = { campaignId, taskIds: cumulativeTaskIds, campaignDurationMinutes, sourceDeadlineAt, effectiveDeadlineAt };
    const changed = !previous || JSON.stringify(previous) !== JSON.stringify(current);
    if (changed) campaignDeadlinePins.set(campaignId, current);
    return { schemaVersion: 'campaign-deadline-reconciliation/v1', ...current, changed };
  };
  const hooks = { resumeImpl: null, fetchedBaseSha: 'c'.repeat(40), remoteBaseSha: 'c'.repeat(40), afterResume: null,
    baseAdvancedImpl: null, baseAdvancedSignature: 'stable-base-advanced-signature', cycleAdmissionImpl: null,
    cycleAdmissionConflicts: { lockEpoch: '0', worktree: [], writeScope: [], domain: [] } };
  const controller = { getRun: (id) => runs.get(id), verifyEventChain: () => ({ count: 0, head: 'GENESIS' }),
    inspectCampaignDispatchHistory: inspectFakeCampaignDispatchHistory,
    reconcileCampaignDeadline: reconcileFakeCampaignDeadline,
    inspectCycleAdmissionConflicts: ({ taskId }) => ({ taskId, runFound: runs.has(taskId), ...hooks.cycleAdmissionConflicts }),
    resumeTask: (input) => { resumeCalls.push(input); if (!hooks.resumeImpl) throw new Error('TEST_RESUME_NOT_CONFIGURED'); return hooks.resumeImpl(input); },
    admitCycle: (input) => { admissionCalls.push(input); if (!hooks.cycleAdmissionImpl) throw new Error('TEST_CYCLE_ADMISSION_NOT_CONFIGURED'); return hooks.cycleAdmissionImpl(input); },
    recordRootIntegration: ({ taskId, headCommit }) => { const run = runs.get(taskId); assert.equal(run.state, 'ROOT_DELIVERY_READY'); assert.equal(headCommit, run.candidateHeadCommit); run.state = 'ROOT_INTEGRATED_PENDING_CI'; seen.push('integration'); } };
  const inputBinding = { taskId: 'T1', worktree: folder, taskFile: path.join(privateRoot, 'task.json') };
  const options = { repoRoot: folder, campaignFile, controller, now: () => clock.current,
    intake: async () => ({ controllerBinding: inputBinding }),
    fetchPreparedBase: async () => hooks.fetchedBaseSha,
    readRemoteBase: async () => hooks.remoteBaseSha,
    baseAdvancedResume: async (input) => {
      if (!hooks.baseAdvancedImpl) throw new Error('TEST_BASE_ADVANCED_NOT_CONFIGURED');
      return hooks.baseAdvancedImpl(input);
    },
    baseAdvancedResumeSignature: async () => hooks.baseAdvancedSignature,
    admit: async () => [], preflight: async ({ taskFile, base }) => {
      preflightCalls.push(base);
      const task = JSON.parse(fs.readFileSync(taskFile, 'utf8').replace(/^\uFEFF/, ''));
      return { schemaVersion: 'task-preflight-result/v1', status: 'READY', taskId: task.taskId, objective: task.objective,
        baseline: { base, baseRevision: base, headRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8' }).trim(),
          branch: 'codex/t1', dirty: false }, dependencies: [], authorityGrant: false, dispatchAllowed: false,
        checksExecuted: false, stateWritePerformed: false, mandateReferenceIsProvenanceOnly: true };
    },
    runnerFactory: ({ campaignDeadlineGuard } = {}) => {
      runnerDeadlineGuards.push(campaignDeadlineGuard);
      const held = new Set();
      const suppressed = new Set();
      const instance = {
        addBinding: (item) => bindings.push(item),
        isActive: () => false,
        hold: (taskId) => held.add(taskId),
        wake: (taskId) => { instance.wakeCalls.push(taskId); held.delete(taskId); suppressed.delete(taskId); },
        wakeCalls: [], held, suppressed,
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
          if (!held.has('T1') && !suppressed.has('T1') && runs.get('T1')?.state === 'WORKER_READY') runnerEvents.push('worker-dispatch');
          return { active: 0, errors: [] };
        },
        stop: async () => {},
      };
      runnerInstances.push(instance);
      return instance;
    },
    deliveryFactory: () => ({ tick: async () => { seen.push('delivery'); return { status: 'MERGED', pullRequest: 1 }; } }) };
  return { folder, privateRoot, campaignFile, campaign, options, runs, workerIntentHistory, campaignDeadlinePins,
    refreshWorkerDispatchHistory: (taskId, run) => workerIntentHistory.set(taskId, makeWorkerIntents(run)),
    seen, bindings, resumeCalls, preflightCalls,
    runnerEvents, authorizeCalls, admissionCalls, runnerDeadlineGuards, runnerInstances, hooks, inputBinding, clock };
}

function prepareCycleAdmission(f, { admissionOverrides = {}, taskOverrides = {}, runOverrides = {} } = {}) {
  const tasksDir = path.join(f.privateRoot, 'tasks'); fs.mkdirSync(tasksDir, { recursive: true });
  const task = { schemaVersion: 'task-readiness/v1', taskId: 'T1', objective: 'Continue the same bounded task.',
    acceptance: ['Admit only after material root evidence.'], writeScope: ['src/'],
    checks: [{ shell: false, executable: 'node', argv: ['--version'], cwd: '.' }], mandateReference: 'fixture://trusted',
    ...taskOverrides };
  const taskFile = path.join(tasksDir, 'T1.json');
  const taskBytes = Buffer.from(JSON.stringify(task)); fs.writeFileSync(taskFile, taskBytes);
  const trustedMandateBinding = { resolvedBy: 'root', taskId: 'T1', repositoryRoot: f.folder, objective: task.objective,
    writeScope: task.writeScope, domainOrFeatureKey: 'fixture/successor-cycle', sourceRef: 'fixture://trusted',
    authorizedEffects: ['local fixture checks'], prohibitions: ['external effects'] };
  const run = { taskId: 'T1', state: 'BLOCKED_BY_ROOT', currentCycle: 1, taskRecord: task,
    taskRecordDigest: createHash('sha256').update(JSON.stringify(task)).digest('hex'),
    trustedMandateBinding, worktreeRoot: f.folder, branch: 'codex/t1',
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.folder, encoding: 'utf8' }).trim(),
    cycles: [{ cycleNo: 1, state: 'PAUSED', startedAt: new Date(f.clock.current - 10 * 60_000).toISOString(),
      submissions: 3, implementationRepairs: 2, toolRetries: 1 }], noProgress: [{ fingerprint: 'same-input', occurrences: 2 }],
    ...runOverrides };
  f.runs.set('T1', run);
  const admission = { schemaVersion: 'root-execution-cycle-admission/v1', admissionId: 'fixture-cycle-admission-2',
    taskId: 'T1', priorCycleNo: 1, priorCycleState: 'PAUSED', taskRecordDigest: createHash('sha256').update(taskBytes).digest('hex'),
    taskFile, reason: 'Root recorded material new implementation evidence.', evidenceRef: 'root://cycle-evidence',
    materialChange: true, basis: 'MATERIAL_NEW_EVIDENCE', ...admissionOverrides };
  const admissionFile = path.join(f.privateRoot, 'cycle-admissions', 'T1-cycle-2.json');
  fs.mkdirSync(path.dirname(admissionFile), { recursive: true });
  const admissionBytes = Buffer.from(JSON.stringify(admission)); fs.writeFileSync(admissionFile, admissionBytes);
  f.campaign.cycleAdmissions = [{ taskId: 'T1', recordFile: admissionFile,
    admissionRecordDigest: createHash('sha256').update(admissionBytes).digest('hex') }];
  fs.writeFileSync(f.campaignFile, JSON.stringify(f.campaign));
  f.inputBinding.taskFile = taskFile;
  f.inputBinding.trustedMandateBinding = trustedMandateBinding;
  let committed = false;
  f.hooks.cycleAdmissionImpl = ({ admission: input }) => {
    if (!committed) {
      assert.equal(run.currentCycle, 1);
      run.cycles.push({ cycleNo: 2, state: 'ACTIVE', startedAt: null, submissions: 0,
        implementationRepairs: 0, toolRetries: 0, admission: input });
      run.currentCycle = 2; run.state = 'WORKER_READY'; run.taskRecord = task;
      run.taskRecordDigest = input.taskRecordDigest; committed = true;
      return run;
    }
    const cycle = run.cycles.find((item) => item.cycleNo === 2);
    assert.deepEqual(cycle.admission, input);
    return run;
  };
  return { task, taskFile, taskBytes, admission, admissionFile, admissionBytes, trustedMandateBinding, run,
    loseCheckpoint: () => { const checkpoint = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json'); if (fs.existsSync(checkpoint)) fs.unlinkSync(checkpoint); } };
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
    taskRecord: task, trustedMandateBinding, cycles: [
      { cycleNo: 1, submissions: 3, implementationRepairs: 2, toolRetries: 1,
        startedAt: new Date(Date.now() - 10 * 60_000).toISOString() },
      { cycleNo: 2, state: 'PAUSED', submissions: 0, implementationRepairs: 0, toolRetries: 0, startedAt: null },
    ] };
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

test('successor-cycle admission references are private, digest-pinned, and schema validated', (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  assert.equal(loadSupervisorCampaign(f.folder, f.campaignFile).cycleAdmissions[0].record.admissionId,
    prepared.admission.admissionId);

  fs.writeFileSync(prepared.admissionFile, JSON.stringify({ ...prepared.admission, reason: 'Altered after root pinning.' }));
  assert.throws(() => loadSupervisorCampaign(f.folder, f.campaignFile), /CYCLE_ADMISSION_DIGEST_MISMATCH/);

  fs.writeFileSync(prepared.admissionFile, prepared.admissionBytes);
  const outsideFile = path.join(f.folder, 'public-cycle-admission.json'); fs.writeFileSync(outsideFile, prepared.admissionBytes);
  f.campaign.cycleAdmissions[0].recordFile = outsideFile;
  f.campaign.cycleAdmissions[0].admissionRecordDigest = createHash('sha256').update(prepared.admissionBytes).digest('hex');
  fs.writeFileSync(f.campaignFile, JSON.stringify(f.campaign));
  assert.throws(() => loadSupervisorCampaign(f.folder, f.campaignFile), /CYCLE_ADMISSION_MUST_BE_PRIVATE/);

  f.campaign.cycleAdmissions[0].recordFile = prepared.admissionFile;
  const malformedBytes = Buffer.from(JSON.stringify({ ...prepared.admission, schemaVersion: 'untrusted/v1' }));
  fs.writeFileSync(prepared.admissionFile, malformedBytes);
  f.campaign.cycleAdmissions[0].admissionRecordDigest = createHash('sha256').update(malformedBytes).digest('hex');
  fs.writeFileSync(f.campaignFile, JSON.stringify(f.campaign));
  assert.throws(() => loadSupervisorCampaign(f.folder, f.campaignFile), /CYCLE_ADMISSION_SCHEMA_INVALID/);
});

test('successor admission retains prior counters and no-progress history, then dispatches the admitted cycle', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f, { admissionOverrides: { priorCycleState: 'EXHAUSTED' } });
  prepared.run.cycles[0].state = 'EXHAUSTED';
  const supervisor = await createAutonomousSupervisor(f.options);
  const result = await supervisor.tick();
  assert.equal(result.status, 'RUNNING');
  assert.equal(f.admissionCalls.length, 1);
  assert.equal(f.admissionCalls[0].preflightResult.status, 'READY');
  assert.equal(f.admissionCalls[0].admission.admissionId, prepared.admission.admissionId);
  assert.equal(prepared.run.currentCycle, 2);
  assert.equal(prepared.run.cycles[0].submissions, 3);
  assert.equal(prepared.run.cycles[0].implementationRepairs, 2);
  assert.equal(prepared.run.cycles[0].toolRetries, 1);
  assert.deepEqual(prepared.run.noProgress, [{ fingerprint: 'same-input', occurrences: 2 }]);
  assert.deepEqual(f.runnerEvents, ['tick', 'worker-dispatch']);
  const checkpoint = JSON.parse(fs.readFileSync(path.join(supervisor.stateRoot, 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.cycleAdmissionCheckpoints.T1.admissionId, prepared.admission.admissionId);
  await supervisor.stop();
});

test('successor admission replays after controller commit and lost supervisor checkpoint without a duplicate cycle', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  const admit = f.hooks.cycleAdmissionImpl;
  let interruptAfterCommit = true;
  f.hooks.cycleAdmissionImpl = (input) => {
    const run = admit(input);
    if (interruptAfterCommit) { interruptAfterCommit = false; throw new Error('simulated process loss after controller commit'); }
    return run;
  };

  let supervisor = await createAutonomousSupervisor(f.options);
  const first = await supervisor.tick();
  assert.equal(first.observations.some((item) => item.status === 'HOLD_CYCLE_ADMISSION'), true);
  assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
  assert.equal(prepared.run.currentCycle, 2);
  await supervisor.stop();
  prepared.loseCheckpoint();

  f.runnerEvents.length = 0;
  supervisor = await createAutonomousSupervisor(f.options);
  const replay = await supervisor.tick();
  assert.equal(replay.observations.some((item) => item.status === 'CYCLE_ADMISSION_REPLAYED'), true);
  assert.equal(f.admissionCalls.length, 2);
  assert.equal(prepared.run.currentCycle, 2);
  assert.equal(prepared.run.cycles.length, 2);
  assert.deepEqual(f.runnerEvents, ['tick', 'worker-dispatch']);
  await supervisor.stop();
});

test('active predecessor cycle holds successor admission before any dispatch', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  prepared.run.cycles[0].state = 'ACTIVE';
  prepared.run.cycles[0].startedAt = new Date().toISOString();
  f.refreshWorkerDispatchHistory('T1', prepared.run);
  prepared.run.state = 'WORKER_READY';
  const supervisor = await createAutonomousSupervisor(f.options);
  const result = await supervisor.tick();
  assert.equal(result.observations.some((item) => item.status === 'HOLD_CYCLE_ADMISSION'
    && item.code === 'CYCLE_ADMISSION_PREDECESSOR_MISMATCH'), true);
  assert.equal(f.admissionCalls.length, 0);
  assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
  await supervisor.stop();
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
  const run = { taskId: 'T1', state: 'QUARANTINED', currentCycle: 1, cycles: [
    { cycleNo: 1, state: 'ACTIVE', submissions: 0, startedAt: null },
  ], candidateHeadCommit: 'a'.repeat(40), branch: 'codex/t1', baseCommit: 'b'.repeat(40) };
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
  f.runs.set('T1', { taskId: 'T1', state: 'ROOT_INTEGRATED_PENDING_CI', currentCycle: 1,
    cycles: [{ cycleNo: 1, state: 'ACTIVE', submissions: 0, startedAt: null }],
    candidateHeadCommit: 'a'.repeat(40), branch: 'codex/t1', baseCommit: 'b'.repeat(40) });
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick(); assert.equal(supervisor.status().deliveries.T1.status, 'WAITING_CI');
  await supervisor.tick(); assert.equal(supervisor.status().deliveries.T1.status, 'MERGED');
  await supervisor.stop();
});

test('intake exception is held without stopping an independently ready delivery', async (t) => {
  const f = fixture(t); const original = f.options.intake; let calls = 0;
  f.options.intake = async (input) => { if (++calls > 1) throw new Error('TASK_METADATA_UNAVAILABLE'); return original(input); };
  f.runs.set('T1', { taskId: 'T1', state: 'WORKER_READY', currentCycle: 1,
    cycles: [{ cycleNo: 1, state: 'ACTIVE', submissions: 0, startedAt: null }],
    candidateHeadCommit: 'a'.repeat(40), branch: 'codex/t1', baseCommit: 'b'.repeat(40) });
  const supervisor = await createAutonomousSupervisor(f.options); await supervisor.tick();
  f.runs.get('T1').state = 'ROOT_DELIVERY_READY';
  await supervisor.tick(); assert.deepEqual(f.seen, ['integration', 'delivery']);
  await supervisor.tick(); assert.equal(calls, 2); // unchanged failed intake is suppressed
  await supervisor.stop();
});

test('deadline is anchored to actual worker cycle and survives restart', async (t) => {
  const f = fixture(t);
  f.runs.set('T1', { taskId: 'T1', state: 'ROOT_DELIVERY_READY', currentCycle: 1, candidateHeadCommit: 'a'.repeat(40),
    cycles: [{ cycleNo: 1, state: 'ACTIVE', submissions: 1,
      startedAt: new Date(Date.now() - 121 * 60_000).toISOString() }] });
  let supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE'); assert.deepEqual(f.seen, []);
  assert.equal(typeof f.runnerDeadlineGuards[0], 'function'); assert.equal(f.runnerDeadlineGuards[0](), false);
  await supervisor.stop(); supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE'); assert.deepEqual(f.seen, []);
  assert.equal(f.runnerDeadlineGuards[1](), false);
  await supervisor.stop();
});

test('successor admission and restart preserve the immutable original campaign deadline', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f, { admissionOverrides: { priorCycleState: 'EXHAUSTED' } });
  prepared.run.cycles[0].state = 'EXHAUSTED';
  prepared.run.cycles[0].startedAt = new Date(f.clock.current - 119 * 60_000).toISOString();
  f.refreshWorkerDispatchHistory('T1', prepared.run);
  let supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'RUNNING');
  assert.equal(prepared.run.currentCycle, 2);
  const originalDeadline = JSON.parse(fs.readFileSync(path.join(supervisor.stateRoot, 'checkpoint.json'), 'utf8')).deadlineAt;
  const earliestWorkerIntentAt = f.workerIntentHistory.get('T1')[0].occurredAt;
  assert.equal(originalDeadline, new Date(Date.parse(earliestWorkerIntentAt) + 120 * 60_000).toISOString());
  prepared.run.cycles[1].startedAt = new Date(f.clock.current).toISOString();
  prepared.run.cycles[1].submissions = 1;
  f.refreshWorkerDispatchHistory('T1', prepared.run);
  assert.equal(JSON.parse(fs.readFileSync(path.join(supervisor.stateRoot, 'checkpoint.json'), 'utf8')).deadlineAt, originalDeadline);
  await supervisor.stop();

  f.clock.current += 2 * 60_000;
  supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(prepared.run.currentCycle, 2);
  assert.equal(f.admissionCalls.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(supervisor.stateRoot, 'checkpoint.json'), 'utf8')).deadlineAt, originalDeadline);
  await supervisor.stop();
});

test('an earlier valid checkpoint deadline permits admission while live and holds after it expires', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  const checkpointFile = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json');
  fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
  const campaignDigest = loadSupervisorCampaign(f.folder, f.campaignFile).campaignDigest;
  const earlierBound = new Date(f.clock.current + 30_000).toISOString();
  fs.writeFileSync(checkpointFile, JSON.stringify({ schemaVersion: 'autonomous-supervisor-state/v1',
    campaignDigest, bindings: [], deliveries: {}, deadlineAt: earlierBound }));

  let supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'RUNNING');
  assert.equal(prepared.run.currentCycle, 2);
  assert.equal(f.admissionCalls.length, 1);
  const admissionCall = f.admissionCalls[0];
  const expectedSourceDeadline = new Date(Date.parse(f.workerIntentHistory.get('T1')[0].occurredAt)
    + 120 * 60_000).toISOString();
  assert.equal(admissionCall.campaignDeadlineAt, expectedSourceDeadline);
  assert.equal(admissionCall.campaignDeadlineBoundAt, earlierBound);
  assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, earlierBound);
  await supervisor.stop();

  f.clock.current += 60_000;
  f.runnerEvents.length = 0;
  const tamperedLaterBound = new Date(Date.parse(expectedSourceDeadline) - 60_000).toISOString();
  assert.ok(Date.parse(tamperedLaterBound) > Date.parse(earlierBound));
  assert.ok(Date.parse(tamperedLaterBound) <= Date.parse(expectedSourceDeadline));
  fs.writeFileSync(checkpointFile, JSON.stringify({ schemaVersion: 'autonomous-supervisor-state/v1',
    campaignDigest, bindings: [], deliveries: {}, deadlineAt: tamperedLaterBound }));
  supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(f.admissionCalls.length, 1);
  assert.equal(prepared.run.currentCycle, 2);
  assert.deepEqual(f.runnerEvents, []);
  assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, earlierBound);
  assert.equal(f.campaignDeadlinePins.get('fixture').effectiveDeadlineAt, earlierBound);
  await supervisor.stop();
});

test('malformed or later checkpoint deadlines reconcile to the earliest immutable cycle anchor', async (t) => {
  const f = fixture(t);
  const startedAt = new Date(f.clock.current - 121 * 60_000).toISOString();
  f.runs.set('T1', { taskId: 'T1', state: 'ROOT_DELIVERY_READY', currentCycle: 1,
    cycles: [{ cycleNo: 1, state: 'ACTIVE', submissions: 1, startedAt }] });
  const expectedDeadline = new Date(Date.parse(f.workerIntentHistory.get('T1')[0].occurredAt) + 120 * 60_000).toISOString();
  let supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  await supervisor.stop();

  const checkpointFile = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json');
  for (const corruptedDeadline of ['not-an-iso-deadline', new Date(Date.parse(expectedDeadline) + 90 * 60_000).toISOString()]) {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    checkpoint.deadlineAt = corruptedDeadline;
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint));
    supervisor = await createAutonomousSupervisor(f.options);
    assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
    assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, expectedDeadline);
    assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
    await supervisor.stop();
  }
});

test('malformed immutable cycle-start evidence fails closed without admission or dispatch', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f, { runOverrides: { cycles: [
    { cycleNo: 1, state: 'PAUSED', startedAt: 'not-an-immutable-ISO-anchor', submissions: 3,
      implementationRepairs: 2, toolRetries: 1 },
  ] } });
  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(f.admissionCalls.length, 0);
  assert.equal(prepared.run.currentCycle, 1);
  assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
  await supervisor.stop();
});

test('inconsistent dispatch history cannot use an extended valid checkpoint deadline to dispatch', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f, { runOverrides: { cycles: [
    { cycleNo: 1, state: 'PAUSED', startedAt: null, submissions: 1,
      implementationRepairs: 2, toolRetries: 1 },
  ] } });
  const checkpointFile = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json');
  fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
  const extendedDeadline = new Date(f.clock.current + 24 * 60 * 60_000).toISOString();
  fs.writeFileSync(checkpointFile, JSON.stringify({ schemaVersion: 'autonomous-supervisor-state/v1',
    campaignDigest: loadSupervisorCampaign(f.folder, f.campaignFile).campaignDigest,
    bindings: [], deliveries: {}, deadlineAt: extendedDeadline }));

  const predecessor = structuredClone(prepared.run.cycles[0]);
  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(f.admissionCalls.length, 0);
  assert.deepEqual(prepared.run.cycles, [predecessor]);
  assert.equal(prepared.run.currentCycle, 1);
  assert.deepEqual(f.runnerEvents, []);
  assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, extendedDeadline);
  await supervisor.stop();
});

test('resetting both mutable dispatch projections cannot erase immutable worker intent anchors', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  prepared.run.cycles[0].startedAt = null;
  prepared.run.cycles[0].submissions = 0;
  const resetProjection = structuredClone(prepared.run.cycles[0]);
  const checkpointFile = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json');
  fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
  const extendedDeadline = new Date(f.clock.current + 24 * 60 * 60_000).toISOString();
  fs.writeFileSync(checkpointFile, JSON.stringify({ schemaVersion: 'autonomous-supervisor-state/v1',
    campaignDigest: loadSupervisorCampaign(f.folder, f.campaignFile).campaignDigest,
    bindings: [], deliveries: {}, deadlineAt: extendedDeadline }));

  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(f.admissionCalls.length, 0);
  assert.equal(prepared.run.currentCycle, 1);
  assert.deepEqual(prepared.run.cycles, [resetProjection]);
  assert.deepEqual(f.runnerEvents, []);
  assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, extendedDeadline);
  await supervisor.stop();
});

test('a configured cycle admission without its controller run holds before intake or dispatch', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  f.runs.delete('T1');
  let intakeCalls = 0;
  const intake = f.options.intake;
  f.options.intake = async (...args) => { intakeCalls++; return intake(...args); };
  const checkpointFile = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json');
  fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
  const futureDeadline = new Date(f.clock.current + 24 * 60 * 60_000).toISOString();
  fs.writeFileSync(checkpointFile, JSON.stringify({ schemaVersion: 'autonomous-supervisor-state/v1',
    campaignDigest: loadSupervisorCampaign(f.folder, f.campaignFile).campaignDigest,
    bindings: [], deliveries: {}, deadlineAt: futureDeadline }));

  const supervisor = await createAutonomousSupervisor(f.options);
  const result = await supervisor.tick();
  assert.equal(result.status, 'HOLD_CYCLE_ADMISSION');
  assert.deepEqual(result.observations, [{ taskId: 'T1', status: 'HOLD_CYCLE_ADMISSION',
    code: 'CYCLE_ADMISSION_CONTROLLER_RUN_REQUIRED' }]);
  assert.equal(intakeCalls, 0);
  assert.equal(f.admissionCalls.length, 0);
  assert.deepEqual(f.runnerEvents, []);
  assert.equal(f.runnerInstances[0].held.has('T1'), true);
  assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, futureDeadline);
  assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).cycleAdmissionBlocked.T1.code,
    'CYCLE_ADMISSION_CONTROLLER_RUN_REQUIRED');

  f.runs.set('T1', prepared.run);
  assert.equal((await supervisor.tick()).status, 'RUNNING');
  assert.equal(intakeCalls, 1);
  assert.equal(f.admissionCalls.length, 1);
  assert.equal(prepared.run.currentCycle, 2);
  await supervisor.stop();
});

test('invalid dispatch counts and timestamps cannot be masked by a future checkpoint', async (t) => {
  const corruptions = [
    { name: 'negative submissions', startedAt: null, submissions: -1 },
    { name: 'non-safe submissions', startedAt: null, submissions: Number.MAX_SAFE_INTEGER + 1 },
    { name: 'malformed start with submissions', startedAt: 'not-an-immutable-ISO-anchor', submissions: 1 },
  ];
  for (const corruption of corruptions) await t.test(corruption.name, async (subtest) => {
    const f = fixture(subtest);
    const prepared = prepareCycleAdmission(f, { runOverrides: { cycles: [
      { cycleNo: 1, state: 'PAUSED', startedAt: corruption.startedAt, submissions: corruption.submissions,
        implementationRepairs: 0, toolRetries: 0 },
    ] } });
    const checkpointFile = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json');
    fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
    const extendedDeadline = new Date(f.clock.current + 24 * 60 * 60_000).toISOString();
    fs.writeFileSync(checkpointFile, JSON.stringify({ schemaVersion: 'autonomous-supervisor-state/v1',
      campaignDigest: loadSupervisorCampaign(f.folder, f.campaignFile).campaignDigest,
      bindings: [], deliveries: {}, deadlineAt: extendedDeadline }));

    const supervisor = await createAutonomousSupervisor(f.options);
    assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
    assert.equal(f.admissionCalls.length, 0);
    assert.equal(prepared.run.currentCycle, 1);
    assert.deepEqual(f.runnerEvents, []);
    assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, extendedDeadline);
    await supervisor.stop();
  });
});

test('missing earliest controller cycle fails closed despite a later-cycle deadline anchor', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f, { runOverrides: { currentCycle: 2, cycles: [
    { cycleNo: 2, state: 'ACTIVE', startedAt: new Date(f.clock.current - 10 * 60_000).toISOString(), submissions: 1,
      implementationRepairs: 0, toolRetries: 0 },
  ] } });
  const checkpointFile = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json');
  fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
  const extendedDeadline = new Date(f.clock.current + 24 * 60 * 60_000).toISOString();
  fs.writeFileSync(checkpointFile, JSON.stringify({ schemaVersion: 'autonomous-supervisor-state/v1',
    campaignDigest: loadSupervisorCampaign(f.folder, f.campaignFile).campaignDigest,
    bindings: [], deliveries: {}, deadlineAt: extendedDeadline }));

  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(f.admissionCalls.length, 0);
  assert.deepEqual(f.runnerEvents, []);
  assert.equal(prepared.run.currentCycle, 2);
  assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, extendedDeadline);
  await supervisor.stop();
});

test('invalid controller currentCycle fails closed despite a future checkpoint', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f, { runOverrides: { currentCycle: 0 } });
  const checkpointFile = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json');
  fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
  const futureDeadline = new Date(f.clock.current + 24 * 60 * 60_000).toISOString();
  fs.writeFileSync(checkpointFile, JSON.stringify({ schemaVersion: 'autonomous-supervisor-state/v1',
    campaignDigest: loadSupervisorCampaign(f.folder, f.campaignFile).campaignDigest,
    bindings: [], deliveries: {}, deadlineAt: futureDeadline }));

  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(f.admissionCalls.length, 0);
  assert.deepEqual(f.runnerEvents, []);
  assert.equal(prepared.run.currentCycle, 0);
  assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, futureDeadline);
  await supervisor.stop();
});

test('duplicate controller cycle numbers fail closed despite a future checkpoint', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f, { runOverrides: { currentCycle: 2, cycles: [
    { cycleNo: 1, state: 'PAUSED', startedAt: null, submissions: 0, implementationRepairs: 0, toolRetries: 0 },
    { cycleNo: 1, state: 'ACTIVE', startedAt: new Date(f.clock.current - 10 * 60_000).toISOString(),
      submissions: 1, implementationRepairs: 0, toolRetries: 0 },
  ] } });
  const checkpointFile = path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json');
  fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
  const futureDeadline = new Date(f.clock.current + 24 * 60 * 60_000).toISOString();
  fs.writeFileSync(checkpointFile, JSON.stringify({ schemaVersion: 'autonomous-supervisor-state/v1',
    campaignDigest: loadSupervisorCampaign(f.folder, f.campaignFile).campaignDigest,
    bindings: [], deliveries: {}, deadlineAt: futureDeadline }));

  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(f.admissionCalls.length, 0);
  assert.deepEqual(f.runnerEvents, []);
  assert.equal(prepared.run.currentCycle, 2);
  assert.equal(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')).deadlineAt, futureDeadline);
  await supervisor.stop();
});

test('checkpointed successor wakes once per cycle and does not clear same-instance runner suppression', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  let supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'RUNNING');
  assert.deepEqual(f.runnerInstances[0].wakeCalls, ['T1']);
  f.runnerInstances[0].suppressed.add('T1');
  f.runnerEvents.length = 0;
  await supervisor.tick();
  assert.deepEqual(f.runnerInstances[0].wakeCalls, ['T1']);
  assert.equal(f.runnerInstances[0].suppressed.has('T1'), true);
  assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
  await supervisor.stop();

  supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.deepEqual(f.runnerInstances[1].wakeCalls, ['T1']);
  await supervisor.tick();
  assert.deepEqual(f.runnerInstances[1].wakeCalls, ['T1']);
  assert.equal(prepared.run.currentCycle, 2);
  assert.equal(f.admissionCalls.length, 1);
  await supervisor.stop();
});

test('expired original deadline blocks a pending successor admission before dispatch', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f, { admissionOverrides: { priorCycleState: 'EXHAUSTED' } });
  prepared.run.cycles[0].state = 'EXHAUSTED';
  prepared.run.cycles[0].startedAt = new Date(f.clock.current - 121 * 60_000).toISOString();
  f.refreshWorkerDispatchHistory('T1', prepared.run);
  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(f.admissionCalls.length, 0);
  assert.deepEqual(f.runnerEvents, []);
  await supervisor.stop();
});

test('deadline expiry during successor preflight blocks admission and dispatch', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f, { admissionOverrides: { priorCycleState: 'EXHAUSTED' } });
  prepared.run.cycles[0].state = 'EXHAUSTED';
  prepared.run.cycles[0].startedAt = new Date(f.clock.current - 119 * 60_000).toISOString();
  f.refreshWorkerDispatchHistory('T1', prepared.run);
  const readyPreflight = f.options.preflight;
  f.options.preflight = async (input) => {
    const result = await readyPreflight(input);
    f.clock.current += 2 * 60_000;
    return result;
  };
  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'PAUSED_DEADLINE');
  assert.equal(prepared.run.currentCycle, 1);
  assert.equal(f.admissionCalls.length, 0);
  assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
  await supervisor.stop();
});

test('successor admission rereads the pinned private task after preflight', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  const originalPreflight = f.options.preflight;
  f.options.preflight = async (input) => {
    const ready = await originalPreflight(input);
    fs.writeFileSync(prepared.taskFile, JSON.stringify({ ...prepared.task, objective: 'Mutated while preflight was pending.' }));
    return ready;
  };
  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'RUNNING');
  assert.equal(f.admissionCalls.length, 0);
  assert.equal(f.runs.get('T1').currentCycle, 1);
  const checkpoint = JSON.parse(fs.readFileSync(path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.cycleAdmissionBlocked.T1.code, 'CYCLE_ADMISSION_TASK_OR_WORKTREE_BINDING_MISMATCH');
  assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
  await supervisor.stop();
});

test('successor admission preflights the controller-pinned worktree and rejects path retargeting', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  const originalPreflight = f.options.preflight;
  const retarget = path.join(f.folder, 'retargeted-worktree-path');
  fs.mkdirSync(retarget);
  let preflightRepo;
  f.options.preflight = async (input) => {
    preflightRepo = input.repo;
    const ready = await originalPreflight(input);
    f.bindings.find((item) => item.taskId === 'T1').worktree = retarget;
    return ready;
  };
  const predecessor = structuredClone(prepared.run.cycles[0]);
  const noProgress = structuredClone(prepared.run.noProgress);
  const supervisor = await createAutonomousSupervisor(f.options);
  assert.equal((await supervisor.tick()).status, 'RUNNING');
  assert.equal(preflightRepo, fs.realpathSync(prepared.run.worktreeRoot));
  assert.equal(preflightRepo, f.folder);
  assert.equal(f.admissionCalls.length, 0);
  assert.equal(f.runs.get('T1').currentCycle, 1);
  assert.deepEqual(f.runs.get('T1').cycles[0], predecessor);
  assert.deepEqual(f.runs.get('T1').noProgress, noProgress);
  const checkpoint = JSON.parse(fs.readFileSync(path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.cycleAdmissionBlocked.T1.code, 'CYCLE_ADMISSION_TASK_OR_WORKTREE_BINDING_MISMATCH');
  assert.equal(f.runnerEvents.includes('worker-dispatch'), false);
  await supervisor.stop();
});

test('cycle admission resource conflicts stay suppressed until a controller lock is released', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  const originalConflicts = structuredClone(f.hooks.cycleAdmissionConflicts);
  f.hooks.cycleAdmissionConflicts = { ...originalConflicts, lockEpoch: '1',
    writeScope: [{ taskId: 'OTHER', scope: 'src/shared/', requested: 'src/' }] };
  const predecessor = structuredClone(prepared.run.cycles[0]);
  const noProgress = structuredClone(prepared.run.noProgress);
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(f.preflightCalls.length, 0);
  assert.equal(f.admissionCalls.length, 0);
  const firstCheckpoint = JSON.parse(fs.readFileSync(path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json'), 'utf8'));
  assert.equal(firstCheckpoint.cycleAdmissionBlocked.T1.code, 'CYCLE_ADMISSION_RESOURCE_LOCK_CONFLICT');

  await supervisor.tick();
  assert.equal(f.preflightCalls.length, 0);
  assert.equal(f.admissionCalls.length, 0);

  f.hooks.cycleAdmissionConflicts = { ...originalConflicts, lockEpoch: '2' };
  await supervisor.tick();
  assert.equal(f.preflightCalls.length, 1);
  assert.equal(f.admissionCalls.length, 1);
  assert.equal(prepared.run.currentCycle, 2);
  assert.deepEqual(prepared.run.cycles[0], predecessor);
  assert.deepEqual(prepared.run.noProgress, noProgress);
  assert.equal(f.runnerEvents.includes('worker-dispatch'), true);
  await supervisor.stop();
});

test('a durable lock epoch change during awaited preflight permits one reassessment after transient conflict release', async (t) => {
  const f = fixture(t);
  const prepared = prepareCycleAdmission(f);
  const originalPreflight = f.options.preflight;
  let mutateLockEpoch = true;
  f.options.preflight = async (input) => {
    const result = await originalPreflight(input);
    if (mutateLockEpoch) {
      mutateLockEpoch = false;
      // Represents an external lock acquire+release committed while preflight awaited.
      f.hooks.cycleAdmissionConflicts.lockEpoch = '2';
    }
    return result;
  };
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(f.preflightCalls.length, 1);
  assert.equal(f.admissionCalls.length, 0);
  let checkpoint = JSON.parse(fs.readFileSync(path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.cycleAdmissionBlocked.T1.code, 'CYCLE_ADMISSION_RESOURCE_LOCK_EPOCH_CHANGED_DURING_PREFLIGHT');

  await supervisor.tick();
  assert.equal(f.preflightCalls.length, 2);
  assert.equal(f.admissionCalls.length, 1);
  assert.equal(f.admissionCalls[0].expectedResourceLockEpoch, '2');
  assert.equal(prepared.run.currentCycle, 2);
  checkpoint = JSON.parse(fs.readFileSync(path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.cycleAdmissionBlocked.T1, undefined);
  await supervisor.tick();
  assert.equal(f.preflightCalls.length, 2);
  assert.equal(f.admissionCalls.length, 1);
  await supervisor.stop();
});

test('blocked successor environment is reassessed only after its executable capability changes', async (t) => {
  const f = fixture(t);
  const executable = path.join(f.privateRoot, 'checks', 'deferred-check.exe');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  const prepared = prepareCycleAdmission(f, { taskOverrides: { checks: [
    { shell: false, executable, argv: ['--version'], cwd: '.' },
  ] } });
  const originalPreflight = f.options.preflight;
  let preflightCalls = 0;
  f.options.preflight = async (input) => {
    preflightCalls++;
    const ready = await originalPreflight(input);
    return fs.existsSync(executable) ? ready : { ...ready, status: 'BLOCKED_ENVIRONMENT' };
  };
  const supervisor = await createAutonomousSupervisor(f.options);
  await supervisor.tick();
  assert.equal(preflightCalls, 1);
  assert.equal(f.admissionCalls.length, 0);
  const firstCheckpoint = JSON.parse(fs.readFileSync(path.join(f.privateRoot, 'supervisors', 'fixture', 'checkpoint.json'), 'utf8'));
  assert.equal(firstCheckpoint.cycleAdmissionBlocked.T1.code, 'CYCLE_ADMISSION_PREFLIGHT_BLOCKED_ENVIRONMENT');
  await supervisor.tick();
  assert.equal(preflightCalls, 1);
  assert.equal(f.admissionCalls.length, 0);
  assert.deepEqual(fs.readFileSync(prepared.taskFile), prepared.taskBytes);

  fs.writeFileSync(executable, 'fixture capability is now present');
  await supervisor.tick();
  assert.equal(preflightCalls, 2);
  assert.equal(f.admissionCalls.length, 1);
  assert.equal(f.runs.get('T1').currentCycle, 2);
  assert.equal(f.runnerEvents.includes('worker-dispatch'), true);
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
  const run = { taskId: 'T1', state: 'ROOT_INTEGRATED_PENDING_CI', currentCycle: 1,
    cycles: [{ cycleNo: 1, state: 'ACTIVE', submissions: 0, startedAt: null }],
    candidateHeadCommit: 'a'.repeat(40), branch: 'codex/t1', baseCommit: 'b'.repeat(40) };
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
    const receiptBytes = Buffer.from(JSON.stringify(receipt));
    const receiptDigest = createHash('sha256').update(receiptBytes).digest('hex');
    const receiptFile = path.join(folder, `T1-cycle-2-${receiptDigest}.json`); fs.writeFileSync(receiptFile, receiptBytes);
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

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { openDeliveryController } from './controller.mjs';
import { createControllerRunner } from './controller-runner.mjs';
import { admitConfiguredTasks } from './controller-cli.mjs';
import { runRoadmapIntake } from './roadmap-intake.mjs';
import { createGitHubDeliveryAdapter } from './github-delivery.mjs';
import { startControllerDashboard } from './controller-dashboard.mjs';

const git = (cwd, argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000 }).trim();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
const parse = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

export function shouldYieldFiniteRun(status, result) {
  if (result.active > 0) return false;
  const progressing = new Set(['PUSHED', 'PR_CREATED', 'WAITING_CI', 'WAITING_RETRY_BACKOFF', 'WAITING_MERGE_QUEUE', 'BUSY']);
  return !Object.values(status.deliveries).some((delivery) => progressing.has(delivery.status));
}

/** Root-owned private configuration is the authority boundary, never roadmap prose. */
export function loadSupervisorCampaign(repoRoot, campaignFile) {
  const root = fs.realpathSync(repoRoot);
  const common = fs.realpathSync(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const privateRoot = path.join(common, 'zuri-delivery-control');
  const file = fs.realpathSync(campaignFile);
  if (!within(privateRoot, file)) throw new Error('CAMPAIGN_MUST_BE_PRIVATE');
  const campaign = parse(file);
  if (campaign.schemaVersion !== 'autonomous-delivery-campaign/v1'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(campaign.campaignId)
    || fs.realpathSync(campaign.repositoryRoot) !== root
    || !campaign.sourceRef || !Array.isArray(campaign.authorizedEffects)
    || !['intake', 'dispatch', 'rootIntegration', 'push', 'pullRequest', 'merge'].every((effect) => campaign.authorizedEffects.includes(effect))
    || !Array.isArray(campaign.prohibitions) || campaign.prohibitions.length === 0
    || ![1, 2].includes(campaign.maxConcurrent ?? 2)
    || !Number.isInteger(campaign.maxCampaignMinutes ?? 120)
    || (campaign.maxCampaignMinutes ?? 120) < 1 || (campaign.maxCampaignMinutes ?? 120) > 120) throw new Error('INVALID_SUPERVISOR_CAMPAIGN');
  const intakeFile = fs.realpathSync(campaign.intakeCampaignFile);
  if (!within(privateRoot, intakeFile)) throw new Error('INTAKE_CAMPAIGN_MUST_BE_PRIVATE');
  const intakeCampaign = parse(intakeFile);
  if (fs.realpathSync(intakeCampaign.repositoryRoot) !== root || !Array.isArray(intakeCampaign.allowedTaskIds)
    || !intakeCampaign.allowedTaskIds.length || new Set(intakeCampaign.allowedTaskIds).size !== intakeCampaign.allowedTaskIds.length
    || !isDeepStrictEqual(intakeCampaign.prohibitions, campaign.prohibitions)) throw new Error('CAMPAIGN_INTAKE_MISMATCH');
  if (!/^[A-Za-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(campaign.delivery?.expectedOwnerRepo ?? '')
    || !Array.isArray(campaign.delivery.requiredChecks) || !campaign.delivery.requiredChecks.length) throw new Error('DELIVERY_CHECKS_REQUIRED');
  return { root, common, privateRoot, file, campaign, intakeFile, intakeCampaign,
    campaignDigest: digest({ campaign, intakeCampaign }) };
}

/** One root service; models never receive this object's GitHub or intake capabilities. */
export async function createAutonomousSupervisor({ repoRoot, campaignFile, controller: providedController,
  runnerFactory = createControllerRunner, intake = runRoadmapIntake, deliveryFactory = createGitHubDeliveryAdapter,
  admit = admitConfiguredTasks,
  now = () => Date.now() }) {
  const loaded = loadSupervisorCampaign(repoRoot, campaignFile);
  const { root, common, privateRoot, campaign, intakeFile, intakeCampaign, campaignDigest } = loaded;
  const stateRoot = path.join(privateRoot, 'supervisors', campaign.campaignId);
  fs.mkdirSync(stateRoot, { recursive: true });
  if (!within(privateRoot, fs.realpathSync(stateRoot))) throw new Error('SUPERVISOR_STATE_ESCAPE');
  const lockFile = path.join(stateRoot, 'owner.json');
  const owner = { processId: process.pid, nonce: randomUUID(), startedAt: new Date(now()).toISOString() };
  try { fs.writeFileSync(lockFile, JSON.stringify(owner), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = parse(lockFile);
    if (!Number.isSafeInteger(previous.processId) || previous.processId < 1) throw new Error('SUPERVISOR_LOCK_RECONCILIATION_REQUIRED');
    try { process.kill(previous.processId, 0); throw new Error('SUPERVISOR_ALREADY_RUNNING'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    // This only reclaims the root service lock. Controller leases and unknown effects
    // remain authoritative and keep orphaned model processes quarantined.
    fs.unlinkSync(lockFile);
    fs.writeFileSync(lockFile, JSON.stringify(owner), { flag: 'wx' });
  }
  const checkpointFile = path.join(stateRoot, 'checkpoint.json');
  const releaseLock = () => { if (fs.existsSync(lockFile) && parse(lockFile).nonce === owner.nonce) fs.unlinkSync(lockFile); };
  let state;
  try { state = fs.existsSync(checkpointFile) ? parse(checkpointFile) : { schemaVersion: 'autonomous-supervisor-state/v1', campaignDigest, bindings: [], deliveries: {} }; }
  catch (error) { releaseLock(); throw error; }
  if (state.campaignDigest !== campaignDigest) { releaseLock(); throw new Error('CAMPAIGN_CHANGED_REASSESSMENT_REQUIRED'); }
  let controller;
  try { controller = providedController ?? await openDeliveryController({ repoRoot: root }); }
  catch (error) { releaseLock(); throw error; }
  const config = { tasks: [], maxConcurrent: campaign.maxConcurrent ?? 2, codexExecutable: campaign.codexExecutable,
    windowsSandbox: campaign.windowsSandbox, roleTimeoutMs: campaign.roleTimeoutMs };
  let runner;
  try { runner = runnerFactory({ controller, repoRoot: root, stateRoot: path.join(common, 'zuri-delivery-control', 'controller-v1'), config }); }
  catch (error) { if (!providedController) controller.close(); releaseLock(); throw error; }
  try { for (const binding of state.bindings) runner.addBinding(binding); }
  catch (error) { await runner.stop(); if (!providedController) controller.close(); releaseLock(); throw error; }
  const adapters = new Map();
  const intakeCache = new Map();
  const lastSignals = new Map();
  let ticking = false;
  let stopped = false;
  const persist = () => {
    const temporary = checkpointFile + '.' + owner.nonce + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
    fs.renameSync(temporary, checkpointFile);
  };
  const signal = (value, observations) => {
    const key = value.taskId ?? 'campaign';
    const fingerprint = digest(value);
    if (lastSignals.get(key) === fingerprint) return;
    lastSignals.set(key, fingerprint); observations.push(value);
    fs.appendFileSync(path.join(stateRoot, 'events.jsonl'), JSON.stringify({ at: new Date(now()).toISOString(), ...value }) + '\n');
  };
  const deadlineExpired = () => {
    if (!state.deadlineAt) {
      const anchors = state.bindings.flatMap((binding) => controller.getRun(binding.taskId)?.cycles ?? [])
        .map((cycle) => Date.parse(cycle.startedAt)).filter(Number.isFinite);
      if (anchors.length) { state.deadlineAt = new Date(Math.min(...anchors) + (campaign.maxCampaignMinutes ?? 120) * 60_000).toISOString(); persist(); }
    }
    return state.deadlineAt && now() >= Date.parse(state.deadlineAt);
  };
  persist();
  return {
    controller, stateRoot,
    async tick() {
      if (stopped || ticking) return { status: stopped ? 'STOPPED' : 'TICK_ALREADY_RUNNING', observations: [] };
      ticking = true;
      const observations = [];
      try {
        if (loadSupervisorCampaign(root, loaded.file).campaignDigest !== campaignDigest) throw new Error('CAMPAIGN_CHANGED_REASSESSMENT_REQUIRED');
        controller.verifyEventChain();
        if (deadlineExpired()) { await runner.stop(); signal({ status: 'PAUSED_DEADLINE' }, observations); return { status: 'PAUSED_DEADLINE', observations }; }
        let intakeResult;
        const intakeSignature = digest([campaignDigest, git(root, ['rev-parse', '--verify', intakeCampaign.baseRef ?? 'origin/main']), controller.listRuns?.().map((run) => [run.taskId, run.state]) ?? []]);
        if (state.intakeBlocked?.signature === intakeSignature) intakeResult = { status: 'INTAKE_REASSESSMENT_REQUIRED' };
        else try { intakeResult = await intake({ repoRoot: root, campaignFile: intakeFile,
          excludeTaskIds: state.bindings.map((item) => item.taskId) }); delete state.intakeBlocked; }
        catch (error) {
          state.intakeBlocked = { signature: intakeSignature, code: String(error.code ?? error.message) }; persist();
          intakeResult = { status: 'INTAKE_REASSESSMENT_REQUIRED', code: state.intakeBlocked.code };
        }
        state.intake = { status: intakeResult.status ?? 'INTAKE_WAITING', code: intakeResult.code ?? null,
          candidates: (intakeResult.candidates ?? []).map((item) => ({ taskId: item.taskId, status: item.status, code: item.code ?? null })) };
        persist();
        const binding = intakeResult.controllerBinding;
        if (binding) {
          if (!intakeCampaign.allowedTaskIds.includes(binding.taskId)) throw new Error('INTAKE_TASK_NOT_AUTHORIZED');
          const old = state.bindings.find((item) => item.taskId === binding.taskId);
          if (old && !isDeepStrictEqual(old, binding)) throw new Error('TASK_BINDING_CHANGED');
          if (!old) {
            state.bindings.push(binding); persist();
            runner.addBinding(binding);
            signal({ taskId: binding.taskId, status: 'INTAKE_BOUND' }, observations);
          }
        } else signal({ status: intakeResult.status ?? 'INTAKE_WAITING', code: intakeResult.code ?? null }, observations);
        for (const item of await admit({ controller, repoRoot: root, config, cache: intakeCache })) {
          signal({ taskId: item.taskId, status: item.state ?? item.status, code: item.code ?? null }, observations);
        }
        for (const binding of state.bindings) {
          const file = path.join(stateRoot, 'prepared', binding.taskId + '.json');
          if (controller.getRun(binding.taskId)?.state === 'WORKER_READY' && fs.existsSync(file)) {
            try { runner.authorizePreparedCandidate(binding.taskId, file); }
            catch (error) { runner.hold(binding.taskId); signal({ taskId: binding.taskId, status: 'ROOT_PREPARATION_REASSESSMENT_REQUIRED', code: String(error.message) }, observations); }
          }
        }
        const dispatched = await runner.tick();
        for (const error of dispatched.errors) signal({ ...error, status: 'DISPATCH_BLOCKED' }, observations);
        if (deadlineExpired()) { await runner.stop(); signal({ status: 'PAUSED_DEADLINE' }, observations); return { status: 'PAUSED_DEADLINE', observations }; }
        // Serialize delivery within this supervisor; each adapter also owns its
        // durable operation lock across independent root processes.
        for (const binding of state.bindings) {
          try {
          let run = controller.getRun(binding.taskId);
          if (run?.state === 'ROOT_DELIVERY_READY') {
            controller.recordRootIntegration({ taskId: run.taskId, headCommit: run.candidateHeadCommit,
              evidenceRef: `root-campaign:${campaign.campaignId}:${campaignDigest}` });
            run = controller.getRun(binding.taskId);
          }
          if (run?.state !== 'ROOT_INTEGRATED_PENDING_CI') continue;
          const revision = digest([run.currentCycle, run.baseCommit, run.candidateHeadCommit]);
          state.deliveryRevisions ??= {};
          if (state.deliveryRevisions[binding.taskId] !== revision) {
            adapters.delete(binding.taskId); delete state.deliveries[binding.taskId];
            state.deliveryRevisions[binding.taskId] = revision; persist();
          }
          if (['ROOT_REPLAN_PAUSED', 'MERGED'].includes(state.deliveries[binding.taskId]?.status)) continue;
          if (!adapters.has(binding.taskId)) adapters.set(binding.taskId, deliveryFactory({ repoRoot: root, worktreeRoot: binding.worktree, controller,
            campaign: { schemaVersion: 'github-delivery-campaign/v1', taskId: run.taskId,
              repository: { remoteName: campaign.delivery.remoteName ?? 'origin', expectedOwnerRepo: campaign.delivery.expectedOwnerRepo },
              branch: { head: run.branch, base: campaign.delivery.base ?? 'main', expectedBaseCommit: run.baseCommit },
              pullRequest: { title: `[${run.taskId}] ${run.objective}`.slice(0, 240),
                body: `Automated delivery under trusted root campaign ${campaign.campaignId}.\n\nTask: ${run.taskId}\n\nExact candidate: ${run.candidateHeadCommit}\n\nWorker, independent Verify and Review passed at this candidate. Applicable hosted CI remains a separate merge gate.` },
              mergeMethod: 'squash',
              requiredChecks: campaign.delivery.requiredChecks, notApplicableChecks: campaign.delivery.notApplicableChecks ?? [],
              authorizedEffects: ['push', 'pullRequest', 'merge'], mandate: { resolvedBy: 'root', sourceRef: campaign.sourceRef,
                repositoryRoot: root, taskId: run.taskId, expectedRepository: campaign.delivery.expectedOwnerRepo,
                headBranch: run.branch, baseBranch: campaign.delivery.base ?? 'main', expectedBaseCommit: run.baseCommit,
                authorizedEffects: ['push', 'pullRequest', 'merge'] } },
            ghExecutable: campaign.ghExecutable ?? 'gh' }));
          const delivery = await adapters.get(binding.taskId).tick(binding.taskId);
          if (delivery.status === 'REPLAN_REQUIRED') delivery.status = 'ROOT_REPLAN_PAUSED';
          state.deliveries[binding.taskId] = delivery; persist();
          signal({ taskId: binding.taskId, status: delivery.status, code: delivery.code ?? null, pullRequest: delivery.number ?? delivery.pullRequest ?? null }, observations);
          } catch (error) {
            const delivery = { status: 'DELIVERY_REASSESSMENT_REQUIRED', code: String(error.code ?? error.message) };
            state.deliveries[binding.taskId] = delivery; persist();
            signal({ taskId: binding.taskId, ...delivery }, observations);
          }
        }
        return { status: 'RUNNING', active: dispatched.active, observations };
      } finally { ticking = false; }
    },
    status() { return { campaignId: campaign.campaignId, campaignDigest, allowedTaskIds: intakeCampaign.allowedTaskIds,
      bindings: state.bindings.map((item) => item.taskId), deliveries: state.deliveries, intake: state.intake }; },
    async stop() {
      stopped = true;
      await runner.stop(); persist();
      if (!providedController) controller.close();
      releaseLock();
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const [command, campaignFile] = argv;
  if (!['run', 'serve'].includes(command) || !campaignFile || argv.length !== 2) throw new Error('Usage: autonomous-supervisor.mjs run|serve <private-campaign.json>');
  const campaign = parse(campaignFile);
  const supervisor = await createAutonomousSupervisor({ repoRoot: campaign.repositoryRoot, campaignFile });
  let stopping = false;
  let dashboard;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'serve') dashboard = await startControllerDashboard({ port: campaign.dashboardPort ?? 4190,
      readRuns: async () => {
        const runs = supervisor.controller.listRuns().map((run) => ({ ...run, status: run.state, nodes: run.stages }));
        for (const item of supervisor.status().intake?.candidates ?? []) {
          if (!runs.some((run) => run.taskId === item.taskId)) runs.push({ taskId: item.taskId, status: item.status, stages: [], blockers: [{ code: item.code }] });
        }
        return runs;
      } });
    do {
      const result = await supervisor.tick();
      for (const observation of result.observations) process.stdout.write(JSON.stringify(observation) + '\n');
      if (result.status === 'PAUSED_DEADLINE') break;
      const status = supervisor.status();
      if (command === 'run' && status.bindings.length === status.allowedTaskIds.length
        && status.bindings.every((taskId) => status.deliveries[taskId]?.status === 'MERGED')) break;
      if (command === 'run' && shouldYieldFiniteRun(status, result)) {
        process.stdout.write(JSON.stringify({ status: 'YIELD_REASSESS', intake: status.intake, deliveries: status.deliveries }) + '\n'); break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(5000, campaign.pollIntervalMs ?? 30_000)));
    } while (!stopping);
  } finally {
    await supervisor.stop();
    if (dashboard) await new Promise((resolve) => dashboard.close(resolve));
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { process.stderr.write(`SUPERVISOR_STOPPED: ${error.message}\n`); process.exitCode = 1; });

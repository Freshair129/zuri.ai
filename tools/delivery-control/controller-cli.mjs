#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { preflightTask } from './preflight.mjs';
import { createControllerRunner, bindWorktree } from './controller-runner.mjs';
import { startControllerDashboard, startControllerLivenessHeartbeat } from './controller-dashboard.mjs';
import { readControllerEventProjection } from './worker-observability-reader.mjs';

export async function admitConfiguredTasks({ controller, repoRoot, config, cache = new Map() }) {
  const observations = [];
  for (const binding of config.tasks) {
    try {
    const existing = controller.getRun(binding.taskId);
    if (existing?.currentCycle > 0) continue;
    let before;
    try { before = fs.readFileSync(binding.taskFile, 'utf8'); } catch { before = null; }
    const preflightResult = preflightTask({ repo: binding.worktree, taskFile: binding.taskFile, base: binding.base ?? 'origin/main' });
    const lockState = controller.listRuns().map((run) => [run.taskId, run.state]);
    const fingerprint = JSON.stringify([before, preflightResult, lockState]);
    if (cache.get(binding.taskId) === fingerprint) continue;
    cache.set(binding.taskId, fingerprint);
    if (!['READY', 'BLOCKED_DEPENDENCY'].includes(preflightResult.status)) { observations.push(preflightResult); continue; }
    if (fs.readFileSync(binding.taskFile, 'utf8') !== before) throw new Error('TASK_BINDING_CHANGED');
    const taskRecord = JSON.parse(before.replace(/^\uFEFF/, ''));
    if (taskRecord.taskId !== binding.taskId) throw new Error('TASK_BINDING_MISMATCH');
    bindWorktree({ repoRoot, worktree: binding.worktree, branch: preflightResult.baseline.branch });
    observations.push(await controller.registerTask({ taskRecord, preflightResult, worktreeRoot: binding.worktree,
      trustedMandateBinding: binding.trustedMandateBinding }));
    } catch {
      observations.push({ taskId: binding.taskId, status: 'BLOCKED_FOR_REASSESSMENT', code: 'INTAKE_RECONCILIATION_REQUIRED' });
    }
  }
  return observations;
}

export async function main(argv = process.argv.slice(2)) {
  const [command, configFile] = argv;
  if (!['admit', 'run', 'serve', 'status'].includes(command) || !configFile || argv.length !== 2) {
    throw new Error('Usage: node tools/delivery-control/controller-cli.mjs admit|run|serve|status <private-config.json>');
  }
  const config = JSON.parse(fs.readFileSync(path.resolve(configFile), 'utf8').replace(/^\uFEFF/, ''));
  const repoRoot = fs.realpathSync(config.repoRoot);
  const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: repoRoot, encoding: 'utf8', shell: false, windowsHide: true }).trim();
  const stateRoot = path.join(fs.realpathSync(commonDir), 'zuri-delivery-control', 'controller-v1');
  const { openDeliveryController } = await import('./controller.mjs');
  const controller = await openDeliveryController({ repoRoot });
  const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const intakeCache = new Map();
  let dashboard;
  let liveness;
  let runner;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'admit') {
      for (const observation of await admitConfiguredTasks({ controller, repoRoot, config, cache: intakeCache })) print(observation);
      return;
    }
    if (command === 'status') { print(await controller.listRuns()); return; }
    runner = createControllerRunner({ controller, repoRoot, stateRoot, config });
    if (command === 'serve') {
      dashboard = await startControllerDashboard({ port: config.dashboardPort ?? 4190,
        readRuns: async () => (await controller.listRuns()).map((run) => ({ ...run, status: run.state, nodes: run.stages })),
        readEvents: async () => readControllerEventProjection({ repoRoot }) });
      liveness = startControllerLivenessHeartbeat({ stateRoot });
      print({ code: 'DASHBOARD_LISTENING', url: `http://127.0.0.1:${dashboard.address().port}`, processId: process.pid });
    }
    while (!stopping) {
      for (const observation of await admitConfiguredTasks({ controller, repoRoot, config, cache: intakeCache })) {
        print({ code: 'INTAKE_OBSERVED', taskId: observation.taskId, state: observation.state ?? observation.status });
      }
      const tick = await runner.tick();
      for (const error of tick.errors) print({ code: 'DISPATCH_BLOCKED', ...error });
      if (command === 'run') {
        await runner.drain();
        if (runner.activeCount() === 0 && (await controller.nextReadyNodes({ limit: 100 })).filter((node) => config.tasks.some((task) => task.taskId === node.taskId)).length === 0) break;
        // A refused dispatch must not become an unbounded immediate retry loop.
        if (tick.active === 0) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    print({ code: 'RUNNER_STOPPED', runs: await controller.listRuns() });
  } finally {
    liveness?.stop();
    await runner?.stop();
    if (dashboard) await new Promise((resolve) => dashboard.close(resolve));
    controller.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.code ?? 'CONTROLLER_ERROR'}: ${error.message}\n`); process.exitCode = 1; });
}

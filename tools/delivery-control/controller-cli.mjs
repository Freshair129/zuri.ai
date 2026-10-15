#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { preflightTask } from './preflight.mjs';
import { createControllerRunner, bindWorktree } from './controller-runner.mjs';
import { startControllerDashboard } from './controller-dashboard.mjs';

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
  let dashboard;
  let runner;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'admit') {
      for (const binding of config.tasks) {
        const taskRecord = JSON.parse(fs.readFileSync(binding.taskFile, 'utf8').replace(/^\uFEFF/, ''));
        if (taskRecord.taskId !== binding.taskId) throw new Error('TASK_BINDING_MISMATCH');
        const preflightResult = preflightTask({ repo: binding.worktree, taskFile: binding.taskFile, base: binding.base ?? 'origin/main' });
        if (preflightResult.status !== 'READY') { print(preflightResult); continue; }
        bindWorktree({ repoRoot, worktree: binding.worktree, branch: preflightResult.baseline.branch });
        print(await controller.registerTask({ taskRecord, preflightResult, worktreeRoot: binding.worktree,
          trustedMandateBinding: binding.trustedMandateBinding }));
      }
      return;
    }
    if (command === 'status') { print(await controller.listRuns()); return; }
    runner = createControllerRunner({ controller, repoRoot, stateRoot, config });
    if (command === 'serve') {
      dashboard = await startControllerDashboard({ port: config.dashboardPort ?? 4190,
        readRuns: async () => (await controller.listRuns()).map((run) => ({ ...run, status: run.state, nodes: run.stages })) });
      print({ code: 'DASHBOARD_LISTENING', url: `http://127.0.0.1:${dashboard.address().port}`, processId: process.pid });
    }
    while (!stopping) {
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
    await runner?.stop();
    if (dashboard) await new Promise((resolve) => dashboard.close(resolve));
    controller.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.code ?? 'CONTROLLER_ERROR'}: ${error.message}\n`); process.exitCode = 1; });
}

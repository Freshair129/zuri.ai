import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyFailure, preflightTask } from '../delivery-control/preflight.mjs';

const PREFLIGHT = path.resolve('tools/delivery-control/preflight.mjs');

function runGit(cwd, ...args) {
  return execFileSync('git', args, { cwd, shell: false, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function cleanupFixture(root) {
  const tempRoot = path.resolve(os.tmpdir());
  const absolute = path.resolve(root);
  assert.ok(absolute.startsWith(tempRoot + path.sep), 'fixture cleanup stays under the OS temp directory');
  assert.ok(path.basename(absolute).startsWith('task-preflight-'), 'fixture cleanup targets the named test directory');
  rmSync(absolute, { recursive: true, force: true });
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'task-preflight-'));
  t.after(() => cleanupFixture(root));
  const repo = path.join(root, 'repo');
  mkdirSync(repo);
  mkdirSync(path.join(repo, 'docs', 'roadmap'), { recursive: true });
  mkdirSync(path.join(repo, 'docs', 'architecture', 'delivery-control', 'contracts'), { recursive: true });
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'base.txt'), 'base\n');
  writeFileSync(path.join(repo, 'docs', 'roadmap', 'ROADMAP.md'), [
    '<!-- roadmap-task-ledger:start -->',
    '| task_id | status | proof_scope | implementation_state | evidence |',
    '|---|---|---|---|---|',
    '| TASK-DEP-DONE | done | UNKNOWN | UNKNOWN | Canonical row evidence is retained. |',
    '| TASK-DEP-OPEN | review | HOSTED_CI | MERGED | Review remains open. |',
    '<!-- roadmap-task-ledger:end -->',
    '',
  ].join('\n'));
  writeFileSync(path.join(repo, 'docs', 'architecture', 'delivery-control', 'contracts', 'model-policy.json'), JSON.stringify({
    version: 4,
    status: 'ACTIVE',
    ordinaryPreflight: { status: 'ACTIVE', enabled: true, schema: 'task-readiness/v1' },
    retryAndLineage: { limits: { maxOccurrencesPerNoProgressFingerprint: 2 } },
  }, null, 2));
  runGit(repo, 'init', '--quiet');
  runGit(repo, 'config', 'user.email', 'preflight-test@example.invalid');
  runGit(repo, 'config', 'user.name', 'Preflight Fixture');
  runGit(repo, 'add', '.');
  runGit(repo, 'commit', '--quiet', '-m', 'fixture baseline');
  runGit(repo, 'branch', '-M', 'codex/preflight-fixture');
  const baseRevision = runGit(repo, 'rev-parse', 'HEAD');
  runGit(repo, 'update-ref', 'refs/remotes/origin/main', baseRevision);
  const commonDir = path.resolve(repo, runGit(repo, 'rev-parse', '--git-common-dir'));
  const taskDirectory = path.join(commonDir, 'zuri-delivery-control', 'tasks');
  mkdirSync(taskDirectory, { recursive: true });
  return {
    root,
    repo,
    commonDir,
    taskDirectory,
    baseRevision,
    taskFile: path.join(taskDirectory, 'task.json'),
  };
}

function taskRecord(overrides = {}) {
  return {
    schemaVersion: 'task-readiness/v1',
    taskId: 'TASK-PREFLIGHT-FIXTURE',
    objective: 'Verify automatic task preflight behavior.',
    acceptance: ['The preflight reports the available baseline and scoped changes.'],
    writeScope: ['src/'],
    checks: [{ shell: false, executable: process.execPath, argv: ['--version'], cwd: '.' }],
    mandateReference: 'conversation://trusted-context/task-preflight-fixture',
    ...overrides,
  };
}

function saveTask(fixtureData, value) {
  writeFileSync(fixtureData.taskFile, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function runPreflight(fixtureData, options = {}) {
  return preflightTask({
    taskFile: fixtureData.taskFile,
    repo: fixtureData.repo,
    base: 'origin/main',
    ...options,
  });
}

test('valid task reads a canonical done dependency and keeps scoped dirty work ready', (t) => {
  const f = fixture(t);
  const marker = path.join(f.root, 'must-not-be-created.txt');
  const valid = taskRecord({
    checks: [{
      shell: false,
      executable: process.execPath,
      argv: ['-e', 'require("fs").writeFileSync(' + JSON.stringify(marker) + ', "ran")'],
      cwd: '.',
    }],
    dependencies: [{ taskId: 'TASK-DEP-DONE', revision: f.baseRevision }],
  });
  saveTask(f, valid);
  writeFileSync(path.join(f.repo, 'src', 'local.txt'), 'scoped working change\n');

  const result = runPreflight(f, { includeChanged: true });

  assert.equal(result.status, 'READY');
  assert.equal(result.baseline.branch, 'codex/preflight-fixture');
  assert.equal(result.baseline.dirty, true);
  assert.deepEqual(result.baseline.dirtyPaths, ['src/local.txt']);
  assert.deepEqual(result.baseline.committedChangedPaths, []);
  assert.equal(result.dependencies[0].accepted, true);
  assert.equal(result.dependencies[0].proofScope, 'UNKNOWN');
  assert.match(result.dependencies[0].roadmapEvidence, /Canonical row evidence/);
  assert.equal(result.dependencies[0].revisionIsAncestorOfBase, true);
  assert.equal(result.checks[0].capability, 'AVAILABLE');
  assert.equal(result.checksExecuted, false);
  assert.equal(result.authorityGrant, false);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.stateWritePerformed, false);
  assert.equal(result.mandateReferenceIsProvenanceOnly, true);
  assert.equal(existsSync(marker), false, 'declared checks are never run by preflight');
});

test('malformed metadata can be corrected without reservations or implementation repair capacity', (t) => {
  const f = fixture(t);
  const malformed = taskRecord();
  delete malformed.acceptance;
  saveTask(f, malformed);
  const before = readFileSync(f.taskFile, 'utf8');

  const first = runPreflight(f);

  assert.equal(first.status, 'REPAIR_METADATA');
  assert.equal(first.metadataRepair.consumesImplementationRepair, false);
  assert.equal(first.stateWritePerformed, false);
  assert.equal(existsSync(path.join(f.commonDir, 'zuri-delivery-control', 'preparation-attempts')), false);
  saveTask(f, taskRecord());
  const corrected = runPreflight(f);

  assert.equal(corrected.status, 'READY');
  assert.equal(corrected.taskId, first.taskId);
  assert.notEqual(readFileSync(f.taskFile, 'utf8'), before);
  assert.deepEqual(readdirSync(path.join(f.commonDir, 'zuri-delivery-control')).sort(), ['tasks']);
  assert.deepEqual(readdirSync(f.taskDirectory), ['task.json']);
});

test('canonical non-done and absent dependencies block readiness', (t) => {
  const f = fixture(t);
  saveTask(f, taskRecord({ dependencies: [{ taskId: 'TASK-DEP-OPEN' }] }));
  const open = runPreflight(f);
  assert.equal(open.status, 'BLOCKED_DEPENDENCY');
  assert.equal(open.dependencies[0].roadmapStatus, 'review');

  saveTask(f, taskRecord({ dependencies: [{ taskId: 'TASK-NOT-IN-ROADMAP' }] }));
  const absent = runPreflight(f);
  assert.equal(absent.status, 'BLOCKED_DEPENDENCY');
  assert.equal(absent.dependencies[0].roadmapStatus, 'UNKNOWN');
});

test('POSIX backslash filenames cannot masquerade as an allowed directory', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  saveTask(f, taskRecord());
  const filename = 'src\\outside.txt';
  writeFileSync(path.join(f.repo, filename), 'outside the src directory\n');
  const dirty = runPreflight(f, { includeChanged: true });
  assert.equal(dirty.status, 'BLOCKED_SCOPE');
  assert.ok(dirty.baseline.dirtyPaths.includes(filename));
  runGit(f.repo, 'add', '--', filename);
  runGit(f.repo, 'commit', '--quiet', '-m', 'out-of-scope POSIX filename');
  const committed = runPreflight(f, { includeChanged: true });
  assert.equal(committed.status, 'BLOCKED_SCOPE');
  assert.ok(committed.baseline.committedChangedPaths.includes(filename));
});

test('dirty and committed paths outside writeScope block readiness', (t) => {
  const f = fixture(t);
  saveTask(f, taskRecord());
  writeFileSync(path.join(f.repo, 'outside-dirty.txt'), 'unscoped\n');
  const dirty = runPreflight(f, { includeChanged: true });
  assert.equal(dirty.status, 'BLOCKED_SCOPE');
  assert.ok(dirty.issues.some((item) => item.code === 'CHANGE_OUTSIDE_WRITE_SCOPE'));

  rmSync(path.join(f.repo, 'outside-dirty.txt'));
  writeFileSync(path.join(f.repo, 'outside-committed.txt'), 'committed outside scope\n');
  runGit(f.repo, 'add', 'outside-committed.txt');
  runGit(f.repo, 'commit', '--quiet', '-m', 'out of scope change');
  const committed = runPreflight(f, { includeChanged: true });
  assert.equal(committed.status, 'BLOCKED_SCOPE');
  assert.equal(committed.baseline.dirty, false);
  assert.deepEqual(committed.baseline.committedChangedPaths, ['outside-committed.txt']);
});

test('task source path and symlink escapes are blocked', (t) => {
  const f = fixture(t);
  saveTask(f, taskRecord());
  const outsideTask = path.join(f.root, 'outside-task.json');
  writeFileSync(outsideTask, JSON.stringify(taskRecord()));
  assert.equal(preflightTask({ taskFile: outsideTask, repo: f.repo }).status, 'BLOCKED_SCOPE');

  const outsideDirectory = path.join(f.root, 'outside-source');
  mkdirSync(outsideDirectory);
  writeFileSync(path.join(outsideDirectory, 'task.json'), JSON.stringify(taskRecord()));
  const sourceLink = path.join(f.repo, 'source-link');
  try {
    symlinkSync(outsideDirectory, sourceLink, process.platform === 'win32' ? 'junction' : 'dir');
    const result = preflightTask({ taskFile: path.join(sourceLink, 'task.json'), repo: f.repo });
    assert.equal(result.status, 'BLOCKED_SCOPE');
    assert.equal(result.issues[0].code, 'TASK_FILE_ESCAPE');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  }
});

test('writeScope rejects symlink escapes and accepts a trailing directory marker', (t) => {
  const f = fixture(t);
  const outsideDirectory = path.join(f.root, 'outside-scope');
  mkdirSync(outsideDirectory);
  const scopeLink = path.join(f.repo, 'src', 'escape');
  try {
    symlinkSync(outsideDirectory, scopeLink, process.platform === 'win32' ? 'junction' : 'dir');
    saveTask(f, taskRecord({ writeScope: ['src/escape/'] }));
    const result = runPreflight(f);
    assert.equal(result.status, 'BLOCKED_SCOPE');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    saveTask(f, taskRecord({ writeScope: ['../outside-scope'] }));
    assert.equal(runPreflight(f).status, 'BLOCKED_SCOPE');
  }
});

test('unavailable base or declared check capability blocks readiness', (t) => {
  const f = fixture(t);
  saveTask(f, taskRecord());
  const missingBase = runPreflight(f, { base: 'origin/missing-base' });
  assert.equal(missingBase.status, 'BLOCKED_ENVIRONMENT');
  assert.ok(missingBase.issues.some((item) => item.code === 'BASELINE_UNAVAILABLE'));

  saveTask(f, taskRecord({ checks: [{ shell: false, executable: 'zuri-preflight-missing-command', argv: [], cwd: '.' }] }));
  const missingExecutable = runPreflight(f);
  assert.equal(missingExecutable.status, 'BLOCKED_ENVIRONMENT');
  assert.equal(missingExecutable.checks[0].capability, 'UNAVAILABLE');
});

test('a Windows batch executable cannot pass shell:false capability checks', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows executable semantics are specific to Windows.');
  const f = fixture(t);
  const batchFile = path.join(f.root, 'check.cmd');
  writeFileSync(batchFile, '@echo off\r\n');
  saveTask(f, taskRecord({ checks: [{ shell: false, executable: batchFile, argv: [], cwd: '.' }] }));

  const result = runPreflight(f);

  assert.equal(result.status, 'BLOCKED_ENVIRONMENT');
  assert.match(result.issues.find((item) => item.code === 'CHECK_EXECUTABLE_UNAVAILABLE').message, /require shell execution/);
});

test('main branch is blocked and CLI JSON is machine-readable', (t) => {
  const f = fixture(t);
  saveTask(f, taskRecord());
  runGit(f.repo, 'checkout', '--quiet', '-B', 'main');
  const main = runPreflight(f);
  assert.equal(main.status, 'BLOCKED_SCOPE');
  assert.ok(main.issues.some((item) => item.code === 'MAIN_BRANCH_DISPATCH_BLOCKED'));

  runGit(f.repo, 'checkout', '--quiet', '-B', 'codex/preflight-cli');
  const output = execFileSync(process.execPath, [PREFLIGHT, '--task-file', f.taskFile, '--repo', f.repo, '--base', 'origin/main', '--changed', '--json'], {
    cwd: f.repo, shell: false, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const json = JSON.parse(output);
  assert.equal(json.status, 'READY');
  assert.equal(json.baseline.branch, 'codex/preflight-cli');
  assert.equal(json.checksExecuted, false);
});

test('canonical no-progress and transient routes require safe bounded evidence', () => {
  const yielded = classifyFailure({ failureClass: 'IDENTICAL_SEMANTIC_NO_PROGRESS_AT_CAP', effectState: 'NONE' });
  assert.equal(yielded.outcome, 'YIELD_REASSESS');
  assert.equal(yielded.resumable, true);
  assert.equal(yielded.terminal, false);
  const transient = { failureClass: 'KNOWN_TRANSIENT_TOOL_ERROR', effectState: 'NONE' };
  assert.equal(classifyFailure(transient).retryAllowed, false);
  const safe = { ...transient, sameInput: true, provenNoEffect: true, remainingToolRetries: 1 };
  assert.equal(classifyFailure(safe).outcome, 'BOUNDED_TOOL_RETRY');
  assert.equal(classifyFailure(safe).retryAllowed, true);
  assert.equal(classifyFailure({ ...safe, remainingToolRetries: 0 }).retryAllowed, false);
  assert.equal(classifyFailure({ ...safe, sameInput: false }).retryAllowed, false);
  assert.equal(classifyFailure({ ...safe, effectState: 'APPLIED' }).retryAllowed, false);
  assert.equal(classifyFailure({ ...safe, effectState: 'UNKNOWN' }).outcome, 'READ_ONLY_RECONCILE');
});

test('failure classification separates metadata, implementation, external, and unknown effects', () => {
  const metadata = { acceptance: ['missing criterion wording'] };
  const repair = classifyFailure({ failureClass: 'METADATA_DEFECT', effectState: 'NONE', metadata, noProgressCap: 2 });
  assert.equal(repair.outcome, 'METADATA_REPAIR');
  assert.equal(repair.preflightStatus, 'REPAIR_METADATA');
  assert.equal(repair.consumesImplementationRepair, false);

  const yieldResult = classifyFailure({
    failureClass: 'METADATA_DEFECT',
    effectState: 'NONE',
    metadata: { objective: 'same   objective', acceptance: ['same wording'] },
    priorMetadata: [{ acceptance: ['same wording'], objective: ' same objective ' }],
    noProgressCap: 2,
  });
  assert.equal(yieldResult.outcome, 'YIELD_REASSESS');
  assert.equal(yieldResult.resumable, true);
  assert.equal(yieldResult.terminal, false);

  assert.equal(classifyFailure({ failureClass: 'IMPLEMENTATION_FAILURE', effectState: 'NONE' }).outcome, 'ACCEPTANCE_REPAIR');
  assert.equal(classifyFailure({ failureClass: 'EXTERNAL_BLOCKER', effectState: 'NONE' }).outcome, 'BLOCKED_EXTERNAL');
  const unknown = classifyFailure({ failureClass: 'UNKNOWN_EFFECT', effectState: 'UNKNOWN' });
  assert.equal(unknown.outcome, 'READ_ONLY_RECONCILE');
  assert.equal(unknown.retryAllowed, false);
  const unclassified = classifyFailure({});
  assert.equal(unclassified.terminal, false);
  assert.equal(unclassified.resumable, true);
  const effectNotClear = classifyFailure({ failureClass: 'METADATA_DEFECT', effectState: 'APPLIED', metadata, noProgressCap: 2 });
  assert.equal(effectNotClear.outcome, 'BLOCKED_EFFECT_REASSESS');
  assert.equal(effectNotClear.consumesImplementationRepair, false);
});

test('a yielded metadata task resumes after the same task record is corrected', (t) => {
  const f = fixture(t);
  const malformed = taskRecord();
  malformed.checks[0].shell = true;
  saveTask(f, malformed);
  const yielded = classifyFailure({
    failureClass: 'METADATA_DEFECT',
    effectState: 'NONE',
    metadata: malformed,
    priorMetadata: [malformed],
    noProgressCap: 2,
  });
  assert.equal(yielded.outcome, 'YIELD_REASSESS');
  saveTask(f, taskRecord());

  const resumed = runPreflight(f);

  assert.equal(resumed.status, 'READY');
  assert.equal(resumed.taskId, malformed.taskId);
});

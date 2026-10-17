import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { backendEnvironment, buildCodexInvocation, commandTokens, createRoleCheckTrace, runCodexRole, writeBufferFullySync } from '../delivery-control/codex-backend.mjs';

test('worker environment strips database provider and deploy credentials', () => {
  assert.deepEqual(backendEnvironment({ SystemRoot: 'windows', PATH: 'bin', CODEX_HOME: 'auth-location',
    DATABASE_URL: 'private', OPENAI_API_KEY: 'private', VERCEL_TOKEN: 'private' }),
  { SystemRoot: 'windows', PATH: 'bin', CODEX_HOME: 'auth-location' });
});

test('roles select exact policy model, effort, sandbox and no shell prompt argument', () => {
  const folder = path.resolve('.');
  for (const role of ['worker', 'verifier', 'reviewer']) {
    const args = buildCodexInvocation({ windowsSandbox: 'unelevated', role, worktree: folder, schemaFile: path.join(folder, 's'), resultFile: path.join(folder, 'r') });
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-luna');
    assert.equal(args[args.indexOf('--sandbox') + 1], role === 'worker' ? 'workspace-write' : 'read-only');
    assert.ok(args.includes('model_reasoning_effort="max"'));
    assert.ok(!args.join(' ').includes('dangerously'));
    assert.equal(args.at(-1), '-');
  }
  assert.throws(() => buildCodexInvocation({ role: 'root' }), /Unsupported/);
});

test('Windows config isolation requires an explicit restricted sandbox implementation', () => {
  const folder = path.resolve('.');
  const input = { role: 'worker', worktree: folder, schemaFile: path.join(folder, 's'), resultFile: path.join(folder, 'r'), platform: 'win32' };
  assert.throws(() => buildCodexInvocation(input), /WINDOWS_SANDBOX_PROFILE_REQUIRED/);
  assert.throws(() => buildCodexInvocation({ ...input, windowsSandbox: 'disabled' }), /INVALID_WINDOWS_SANDBOX/);
  const args = buildCodexInvocation({ ...input, windowsSandbox: 'unelevated' });
  assert.ok(args.includes('windows.sandbox="unelevated"'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(!args.some((arg) => /bypass|ignore-rules|danger-full/.test(arg)));
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-codex-backend-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  return { dir, head };
}
function processStub({ result, session = 'session-1', code = 0, onInvocation = () => {}, traceEvents = [], rawTrace = null, onStop = () => {} }) {
  return (executable, args, options) => {
    onInvocation({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { onStop(); setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
    child.stdin.once('finish', () => {
      if (session) child.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: session })}\n`);
      if (rawTrace !== null) child.stdout.write(rawTrace);
      else for (const event of traceEvents) child.stdout.write(`${JSON.stringify(event)}\n`);
      if (result) fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(result));
      setImmediate(() => child.emit('close', code, null));
    });
    return child;
  };
}
function checkFixture(dir) {
  const cwd = dir;
  const check = { shell: false, executable: process.execPath, argv: ['--test', 'suite with space.test.mjs'], cwd: '.' };
  const quote = (value) => `"${value}"`;
  return { check, cwd, command: `${quote(check.executable)} --test ${quote(check.argv[1])}` };
}
function startedCommand(id, command) {
  return { type: 'item.started', item: { id, type: 'command_execution', command, aggregated_output: '', status: 'in_progress' } };
}
function completedCommand(id, command, exitCode, status = exitCode === 0 ? 'completed' : 'failed') {
  return { type: 'item.completed', item: { id, type: 'command_execution', command, aggregated_output: 'redacted fixture output', exit_code: exitCode, status } };
}
test('JSONL capture completes partial file writes and rejects stalled persistence', () => {
  const source = Buffer.from('complete trace bytes');
  const stored = Buffer.alloc(source.length);
  let offset = 0;
  const writePartial = (_fd, buffer, start, length) => {
    const count = Math.min(3, length);
    buffer.copy(stored, offset, start, start + count);
    offset += count;
    return count;
  };
  assert.equal(writeBufferFullySync(1, source, writePartial), source.length);
  assert.deepEqual(stored, source);
  assert.throws(() => writeBufferFullySync(1, source, () => 0), /BACKEND_TRACE_WRITE_FAILED/);
});
test('fresh session is bound before accepting exact head result and output directory cannot be reused', async (t) => {
  const { dir, head } = fixture(t);
  const { check, command } = checkFixture(dir);
  let bound;
  const config = { executable: process.execPath, windowsSandbox: 'unelevated', role: 'verifier', worktree: dir, artifactDir: path.join(dir, 'private'),
    expectedHead: head, prompt: 'Inspect only', checks: [check], onSession: async (value) => { bound = value; },
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: head, summary: 'Checked', evidence: ['fixture'] },
      traceEvents: [startedCommand('check-item', command), completedCommand('check-item', command, 0)],
      onInvocation: ({ options }) => { assert.equal(options.shell, false); assert.equal(options.windowsHide, true); } }) };
  const result = await runCodexRole(config);
  assert.equal(result.outcome, 'PASS'); assert.equal(bound.sessionId, 'session-1');
  await assert.rejects(runCodexRole(config), /DIRECTORY_REUSED/);
});
test('Windows command quoting preserves executable, spaces and exact arguments', () => {
  assert.deepEqual(commandTokens(String.raw`"C:\Program Files\Node\node.exe" --test "tests\suite with space.test.mjs"`, 'win32'),
    [String.raw`C:\Program Files\Node\node.exe`, '--test', String.raw`tests\suite with space.test.mjs`]);
  assert.deepEqual(commandTokens(String.raw`& 'C:\Program Files\Node\node.exe' --test 'suite with space.test.mjs'`, 'win32'),
    [String.raw`C:\Program Files\Node\node.exe`, '--test', 'suite with space.test.mjs']);
});
test('an executable alias matches its deterministic PATH resolution', (t) => {
  const { dir } = fixture(t);
  const lookupExecutable = process.platform === 'win32' ? 'where.exe' : 'which';
  const resolveFromPath = (executable) => execFileSync(lookupExecutable, [executable], { encoding: 'utf8', windowsHide: true })
    .split(/\r?\n/).find(Boolean).trim();
  const aliases = ['node', 'git'];
  const checks = aliases.map((executable) => ({ shell: false, executable, argv: ['--version'], cwd: '.' }));
  const commands = aliases.map((executable) => `"${resolveFromPath(executable)}" --version`);
  const trace = createRoleCheckTrace({ checks, invocationCap: 2, worktree: dir, platform: process.platform, environment: backendEnvironment() });
  for (const [index, command] of commands.entries()) {
    trace.observe(startedCommand(`alias-item-${index}`, command));
    trace.observe(completedCommand(`alias-item-${index}`, command, 0));
  }
  assert.deepEqual(trace.summary('a'.repeat(64)).checks.map((check) => check.status), ['PASS', 'PASS']);
});
test('a declared non-root check cwd cannot pass when CLI JSONL omits item.cwd', (t) => {
  const { dir } = fixture(t);
  const { command } = checkFixture(dir);
  const check = { shell: false, executable: process.execPath, argv: ['--test', 'suite with space.test.mjs'], cwd: 'nested' };
  const trace = createRoleCheckTrace({ checks: [check], invocationCap: 2, worktree: dir });
  trace.observe(startedCommand('root-only-item', command));
  trace.observe(completedCommand('root-only-item', command, 0));
  assert.equal(trace.summary('a'.repeat(64)).status, 'UNSUPPORTED');
  assert.equal(trace.summary('a'.repeat(64)).checks[0].status, 'UNSUPPORTED_CWD');
});
test('0.162.1 item JSON projection proves a root-launched check and duplicate events count once', async (t) => {
  const { dir, head } = fixture(t);
  const { check, cwd, command } = checkFixture(dir);
  const start = startedCommand('check-item-1', command);
  const complete = completedCommand('check-item-1', command, 0);
  assert.equal(Object.hasOwn(start.item, 'cwd'), false);
  assert.equal(Object.hasOwn(complete.item, 'cwd'), false);
  const result = await runCodexRole({ executable: process.execPath, windowsSandbox: 'unelevated', role: 'verifier', worktree: dir,
    artifactDir: path.join(dir, 'private'), expectedHead: head, prompt: 'Verify', checks: [check],
    maxInvocationsPerDeclaredCheckPerRoleSession: 2,
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: head, summary: 'Verified', evidence: ['claimed pass'] },
      traceEvents: [start, start, complete, complete],
      onInvocation: ({ args, options }) => {
        assert.equal(options.cwd, dir);
        assert.equal(args[args.indexOf('--cd') + 1], dir);
      } }) });
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.checkTrace.status, 'PASS');
  assert.equal(result.checkTrace.checks[0].invocationCount, 1);
  assert.equal(result.checkTrace.checks[0].cwdProvenance, 'launch_cwd');
  assert.deepEqual(result.checkTrace.checks[0].invocations.map((run) => run.exitCode), [0]);
  assert.match(result.checkTrace.checks[0].checkSha256, /^[a-f0-9]{64}$/);
  assert.match(result.checkTrace.traceSha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(path.join(dir, 'private', 'check-trace.json'), 'utf8').includes(command), false);
});
test('required check missing from command_execution events overrides a claimed pass', async (t) => {
  const { dir, head } = fixture(t);
  const { check, cwd, command } = checkFixture(dir);
  const result = await runCodexRole({ executable: process.execPath, windowsSandbox: 'unelevated', role: 'verifier', worktree: dir,
    artifactDir: path.join(dir, 'private'), expectedHead: head, prompt: 'Verify', checks: [check],
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: head, summary: 'Verified', evidence: ['run node --test'] },
      traceEvents: [startedCommand('prefixed-check', `Set-Location nested; ${command}`),
        completedCommand('prefixed-check', `Set-Location nested; ${command}`, 0),
        { type: 'item.completed', item: { id: 'not-command', type: 'message', text: command } }] }) });
  assert.equal(result.outcome, 'BLOCKED');
  assert.equal(result.code, 'REQUIRED_CHECK_EVIDENCE_INCOMPLETE');
  assert.equal(result.checkTrace.checks[0].status, 'MISSING');
});
test('failed required check exit code overrides a claimed pass', async (t) => {
  const { dir, head } = fixture(t);
  const { check, cwd, command } = checkFixture(dir);
  const result = await runCodexRole({ executable: process.execPath, windowsSandbox: 'unelevated', role: 'verifier', worktree: dir,
    artifactDir: path.join(dir, 'private'), expectedHead: head, prompt: 'Verify', checks: [check],
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: head, summary: 'Verified', evidence: [] },
      traceEvents: [startedCommand('check-failed', command), completedCommand('check-failed', command, 7)] }) });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.code, 'REQUIRED_CHECK_EVIDENCE_FAILED');
  assert.equal(result.checkTrace.checks[0].invocations[0].exitCode, 7);
  assert.equal(result.checkTrace.checks[0].status, 'FAILED');
});
test('third matching command execution stops the role session and fails closed', async (t) => {
  const { dir, head } = fixture(t);
  const { check, cwd, command } = checkFixture(dir);
  let stopped = false;
  const traceEvents = ['1', '2', '3'].map((id) => startedCommand(`check-${id}`, command));
  const result = await runCodexRole({ executable: process.execPath, windowsSandbox: 'unelevated', role: 'verifier', worktree: dir,
    artifactDir: path.join(dir, 'private'), expectedHead: head, prompt: 'Verify', checks: [check],
    maxInvocationsPerDeclaredCheckPerRoleSession: 2,
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: head, summary: 'Verified', evidence: [] }, traceEvents,
      onStop: () => { stopped = true; } }) });
  assert.equal(stopped, true);
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.code, 'REQUIRED_CHECK_INVOCATION_CAP_EXCEEDED');
  assert.equal(result.checkTrace.status, 'OVER_BUDGET');
  assert.equal(result.checkTrace.checks[0].invocationCount, 3);
});
test('truncated final JSONL event is rejected even when the final result claims pass', async (t) => {
  const { dir, head } = fixture(t);
  const { check } = checkFixture(dir);
  const result = await runCodexRole({ executable: process.execPath, windowsSandbox: 'unelevated', role: 'verifier', worktree: dir,
    artifactDir: path.join(dir, 'private'), expectedHead: head, prompt: 'Verify', checks: [check],
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: head, summary: 'Verified', evidence: [] }, rawTrace: '{"type":"item.started"' }) });
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.code, 'MALFORMED_EVENT_TRACE');
  assert.equal(result.checkTrace.status, 'MALFORMED');
});
test('worker launch HEAD mismatch is proven no-effect and never calls spawnProcess', async (t) => {
  const { dir, head } = fixture(t);
  const { check } = checkFixture(dir);
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit', '--allow-empty', '-qm', 'advance between dispatch intent and backend launch'], { cwd: dir });
  let spawnCalls = 0;
  const result = await runCodexRole({ executable: process.execPath, windowsSandbox: 'unelevated', role: 'worker', worktree: dir,
    artifactDir: path.join(dir, 'private'), expectedLaunchHead: head, prompt: 'Work', checks: [check],
    spawnProcess: () => { spawnCalls++; throw new Error('spawn must not be called'); } });
  assert.equal(spawnCalls, 0);
  assert.equal(result.outcome, 'BLOCKED');
  assert.equal(result.failureClass, 'STALE_BASELINE');
  assert.equal(result.effectState, 'NONE');
  assert.equal(result.provenNoEffect, true);
  assert.equal(result.code, 'LAUNCH_HEAD_MISMATCH');
  assert.equal(result.expectedHeadCommit, head);
  assert.notEqual(result.actualHeadCommit, head);
  assert.equal(fs.existsSync(path.join(dir, 'private', 'process.json')), false);
});
test('backend failure is unknown with no worker retry or invented session', async (t) => {
  const { dir, head } = fixture(t);
  const { check } = checkFixture(dir);
  const result = await runCodexRole({ executable: process.execPath, windowsSandbox: 'unelevated', role: 'worker', worktree: dir,
    artifactDir: path.join(dir, 'private'), expectedLaunchHead: head, prompt: 'Work', checks: [check], spawnProcess: processStub({ code: 1, session: null }) });
  assert.equal(result.outcome, 'UNKNOWN'); assert.equal(result.effectState, 'UNKNOWN'); assert.equal(result.sessionId, null);
});
test('gate result cannot attest a different head', async (t) => {
  const { dir, head } = fixture(t);
  const { check } = checkFixture(dir);
  const result = await runCodexRole({ executable: process.execPath, windowsSandbox: 'unelevated', role: 'reviewer', worktree: dir,
    artifactDir: path.join(dir, 'private'), expectedHead: head, prompt: 'Review', checks: [check],
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: 'a'.repeat(40), summary: 'Wrong head', evidence: [] } }) });
  assert.equal(result.code, 'HEAD_CHANGED');
});
test('stalled session persistence cannot outlive deadline plus stop grace', async (t) => {
  const { dir, head } = fixture(t);
  const { check } = checkFixture(dir);
  const started = Date.now();
  const result = await runCodexRole({ executable: process.execPath, windowsSandbox: 'unelevated', role: 'worker', worktree: dir,
    artifactDir: path.join(dir, 'private'), timeoutMs: 20, expectedLaunchHead: head, prompt: 'Bounded test', checks: [check],
    onSession: () => new Promise(() => {}),
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: head, summary: 'Stalled', evidence: [] } }) });
  assert.equal(result.outcome, 'UNKNOWN'); assert.equal(result.code, 'DEADLINE_EXCEEDED');
  assert.ok(Date.now() - started < 12_000);
});

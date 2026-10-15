import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { backendEnvironment, buildCodexInvocation, runCodexRole } from '../delivery-control/codex-backend.mjs';

test('worker environment strips database provider and deploy credentials', () => {
  assert.deepEqual(backendEnvironment({ SystemRoot: 'windows', PATH: 'bin', CODEX_HOME: 'auth-location',
    DATABASE_URL: 'private', OPENAI_API_KEY: 'private', VERCEL_TOKEN: 'private' }),
  { SystemRoot: 'windows', PATH: 'bin', CODEX_HOME: 'auth-location' });
});

test('roles select exact policy model, effort, sandbox and no shell prompt argument', () => {
  const folder = path.resolve('.');
  for (const role of ['worker', 'verifier', 'reviewer']) {
    const args = buildCodexInvocation({ role, worktree: folder, schemaFile: path.join(folder, 's'), resultFile: path.join(folder, 'r') });
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-luna');
    assert.equal(args[args.indexOf('--sandbox') + 1], role === 'worker' ? 'workspace-write' : 'read-only');
    assert.ok(args.includes('model_reasoning_effort="max"'));
    assert.ok(!args.join(' ').includes('dangerously'));
    assert.equal(args.at(-1), '-');
  }
  assert.throws(() => buildCodexInvocation({ role: 'root' }), /Unsupported/);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-codex-backend-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  return { dir, head };
}
function processStub({ result, session = 'session-1', code = 0, onInvocation = () => {} }) {
  return (executable, args, options) => {
    onInvocation({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.stdin.once('finish', () => {
      if (session) child.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: session })}\n`);
      if (result) fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(result));
      setImmediate(() => child.emit('close', code, null));
    });
    return child;
  };
}
test('fresh session is bound before accepting exact head result and output directory cannot be reused', async (t) => {
  const { dir, head } = fixture(t);
  let bound;
  const config = { executable: process.execPath, role: 'verifier', worktree: dir, artifactDir: path.join(dir, 'private'),
    expectedHead: head, prompt: 'Inspect only', onSession: async (value) => { bound = value; },
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: head, summary: 'Checked', evidence: ['fixture'] },
      onInvocation: ({ options }) => { assert.equal(options.shell, false); assert.equal(options.windowsHide, true); } }) };
  const result = await runCodexRole(config);
  assert.equal(result.outcome, 'PASS'); assert.equal(bound.sessionId, 'session-1');
  await assert.rejects(runCodexRole(config), /DIRECTORY_REUSED/);
});
test('backend failure is unknown with no worker retry or invented session', async (t) => {
  const { dir } = fixture(t);
  const result = await runCodexRole({ executable: process.execPath, role: 'worker', worktree: dir,
    artifactDir: path.join(dir, 'private'), prompt: 'Work', spawnProcess: processStub({ code: 1, session: null }) });
  assert.equal(result.outcome, 'UNKNOWN'); assert.equal(result.effectState, 'UNKNOWN'); assert.equal(result.sessionId, null);
});
test('gate result cannot attest a different head', async (t) => {
  const { dir, head } = fixture(t);
  const result = await runCodexRole({ executable: process.execPath, role: 'reviewer', worktree: dir,
    artifactDir: path.join(dir, 'private'), expectedHead: head, prompt: 'Review',
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: 'a'.repeat(40), summary: 'Wrong head', evidence: [] } }) });
  assert.equal(result.code, 'HEAD_CHANGED');
});
test('stalled session persistence cannot outlive deadline plus stop grace', async (t) => {
  const { dir, head } = fixture(t);
  const started = Date.now();
  const result = await runCodexRole({ executable: process.execPath, role: 'worker', worktree: dir,
    artifactDir: path.join(dir, 'private'), timeoutMs: 20, prompt: 'Bounded test',
    onSession: () => new Promise(() => {}),
    spawnProcess: processStub({ result: { outcome: 'PASS', headCommit: head, summary: 'Stalled', evidence: [] } }) });
  assert.equal(result.outcome, 'UNKNOWN'); assert.equal(result.code, 'DEADLINE_EXCEEDED');
  assert.ok(Date.now() - started < 12_000);
});

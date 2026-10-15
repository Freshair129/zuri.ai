import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ROLE_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['outcome', 'headCommit', 'summary', 'evidence'],
  properties: {
    outcome: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED'] },
    headCommit: { type: 'string' }, summary: { type: 'string', maxLength: 8192 },
    evidence: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 1024 } },
  },
};
const ROLES = new Set(['worker', 'verifier', 'reviewer']);
const sha = (s) => createHash('sha256').update(s).digest('hex');
export function backendEnvironment(source = process.env) {
  const names = new Set(['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP',
    'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME', 'LANG', 'LC_ALL']);
  return Object.fromEntries(Object.entries(source).filter(([key]) => names.has(key.toUpperCase())));
}
export function buildCodexInvocation({ role, worktree, schemaFile, resultFile, windowsSandbox = null, platform = process.platform }) {
  if (!ROLES.has(role)) throw new Error('Unsupported role');
  for (const value of [worktree, schemaFile, resultFile]) {
    if (!path.isAbsolute(value)) throw new Error('Backend paths must be absolute');
  }
  if (windowsSandbox !== null && !['mxc', 'elevated', 'unelevated'].includes(windowsSandbox)) throw new Error('INVALID_WINDOWS_SANDBOX');
  if (platform === 'win32' && !windowsSandbox) throw new Error('WINDOWS_SANDBOX_PROFILE_REQUIRED');
  return ['--no-daemon', '--ask-for-approval', 'never', 'exec', '--ignore-user-config',
    '--model', 'gpt-6-luna', '--config', 'model_reasoning_effort="max"',
    ...(platform === 'win32' ? ['--config', `windows.sandbox="${windowsSandbox}"`] : []),
    '--sandbox', role === 'worker' ? 'workspace-write' : 'read-only',
    '--cd', worktree, '--json', '--color', 'never', '--output-schema', schemaFile,
    '--output-last-message', resultFile, '-'];
}

/** One fresh role session; no automatic retries or provider/model fallback. */
export async function runCodexRole({ executable, role, worktree, artifactDir, prompt,
  timeoutMs = 45 * 60_000, expectedHead = null, expectedLaunchHead = null, onSession = async () => {},
  spawnProcess = spawn, signal, windowsSandbox = null }) {
  if (!path.isAbsolute(executable) || !fs.statSync(executable).isFile()) throw new Error('CODEX_EXECUTABLE_REQUIRED');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45 * 60_000) throw new Error('Invalid role deadline');
  fs.mkdirSync(artifactDir, { recursive: true });
  const schemaFile = path.join(artifactDir, 'result-schema.json');
  const resultFile = path.join(artifactDir, 'result.json');
  // A dispatch directory is single-use. Stale output can never satisfy a new gate.
  if (fs.existsSync(resultFile) || fs.existsSync(path.join(artifactDir, 'events.jsonl'))) throw new Error('DISPATCH_DIRECTORY_REUSED');
  fs.writeFileSync(schemaFile, JSON.stringify(ROLE_RESULT_SCHEMA));
  const args = buildCodexInvocation({ role, worktree, schemaFile, resultFile, windowsSandbox });
  const events = fs.openSync(path.join(artifactDir, 'events.jsonl'), 'wx');
  const errors = fs.openSync(path.join(artifactDir, 'stderr.log'), 'wx');
  let child;
  let timedOut = false;
  let sessionId = null;
  let parseBuffer = '';
  let bytes = 0;
  let callbackError = null;
  let callbacks = Promise.resolve();
  let disposed = false;
  let processExited = false;
  let releaseWait;
  let stopTimer;
  const stopped = new Promise((resolve) => { releaseWait = resolve; });
  const stop = () => {
    if (stopTimer) return;
    if (processExited) { releaseWait({ code: null, signal: 'STOP_AFTER_EXIT' }); return; }
    stopTimer = setTimeout(() => {
      if (child?.pid && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
      releaseWait({ code: null, signal: 'STOP_DEADLINE' });
    }, 5000);
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 3000 }); } catch {}
    } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
  };
  let timer;
  try {
    // A worker's launch point is the controller's persisted initial snapshot.
    // Re-read it synchronously at the last point before spawn so a checkout
    // change after claim/dispatch intent cannot start a stale worker session.
    if (role === 'worker' || expectedLaunchHead !== null) {
      let actualLaunchHead = null;
      try {
        actualLaunchHead = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: worktree, encoding: 'utf8', windowsHide: true,
        }).trim();
      } catch {
        return { outcome: 'BLOCKED', failureClass: 'STALE_BASELINE', effectState: 'NONE', provenNoEffect: true,
          code: 'LAUNCH_HEAD_UNAVAILABLE', expectedHeadCommit: expectedLaunchHead, actualHeadCommit: null, artifactDir };
      }
      if (!/^[a-f0-9]{40}$/.test(expectedLaunchHead ?? '') || actualLaunchHead !== expectedLaunchHead) {
        return { outcome: 'BLOCKED', failureClass: 'STALE_BASELINE', effectState: 'NONE', provenNoEffect: true,
          code: 'LAUNCH_HEAD_MISMATCH', expectedHeadCommit: expectedLaunchHead, actualHeadCommit: actualLaunchHead, artifactDir };
      }
    }
    child = spawnProcess(executable, args, { cwd: worktree, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      env: backendEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
    child.once('exit', () => { processExited = true; });
    child.once('close', () => { processExited = true; });
    fs.writeFileSync(path.join(artifactDir, 'process.json'), JSON.stringify({ pid: child.pid ?? null,
      startedAt: new Date().toISOString(), executable, worktree, role }));
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const capture = (fd, chunk) => {
      if (disposed || callbackError) return false;
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { callbackError = new Error('BACKEND_OUTPUT_LIMIT'); stop(); return false; }
      fs.writeSync(fd, chunk);
      return true;
    };
    child.stderr.on('data', (chunk) => capture(errors, chunk));
    child.stdout.on('data', (chunk) => {
      if (!capture(events, chunk)) return;
      parseBuffer += chunk.toString('utf8');
      const lines = parseBuffer.split('\n'); parseBuffer = lines.pop();
      for (const line of lines) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
          if (sessionId && sessionId !== event.thread_id) { callbackError = new Error('BACKEND_SESSION_CHANGED'); stop(); }
          if (!sessionId) {
            sessionId = event.thread_id;
            callbacks = callbacks.then(() => onSession({ sessionId, model: 'gpt-6-luna', effort: 'max' }))
              .catch((error) => { callbackError = error; stop(); });
          }
        }
      }
    });
    const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, sig) => resolve({ code, signal: sig })); });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    const exit = await Promise.race([closed, stopped]);
    await Promise.race([callbacks, stopped]);
    if (timedOut || signal?.aborted || callbackError || exit.code !== 0 || !sessionId) {
      return { outcome: 'UNKNOWN', effectState: role === 'worker' ? 'UNKNOWN' : 'NONE', sessionId,
        code: timedOut ? 'DEADLINE_EXCEEDED' : signal?.aborted ? 'CANCELLED' : callbackError?.message ?? 'BACKEND_FAILED',
        exitCode: exit.code, artifactDir };
    }
    let result;
    try {
      if (fs.statSync(resultFile).size > 128 * 1024) throw new Error('RESULT_TOO_LARGE');
      result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    } catch {
      return { outcome: 'UNKNOWN', effectState: role === 'worker' ? 'UNKNOWN' : 'NONE', sessionId, code: 'INVALID_BACKEND_RESULT', artifactDir };
    }
    if (!['PASS', 'FAIL', 'BLOCKED'].includes(result.outcome) || !/^[a-f0-9]{40}$/.test(result.headCommit)
      || typeof result.summary !== 'string' || result.summary.length > 8192 || !Array.isArray(result.evidence)
      || result.evidence.length > 64 || !result.evidence.every((s) => typeof s === 'string' && s.length <= 1024)) {
      return { outcome: 'UNKNOWN', effectState: role === 'worker' ? 'UNKNOWN' : 'NONE', sessionId, code: 'INVALID_BACKEND_RESULT', artifactDir };
    }
    const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8', windowsHide: true }).trim();
    if (actualHead !== result.headCommit || (expectedHead && expectedHead !== actualHead)) {
      return { outcome: 'UNKNOWN', effectState: 'UNKNOWN', sessionId, code: 'HEAD_CHANGED', artifactDir };
    }
    return { ...result, sessionId, model: 'gpt-6-luna', effort: 'max', artifactDir,
      resultDigest: sha(fs.readFileSync(resultFile)) };
  } finally {
    disposed = true;
    clearTimeout(timer); clearTimeout(stopTimer); signal?.removeEventListener('abort', stop);
    fs.closeSync(events); fs.closeSync(errors);
  }
}

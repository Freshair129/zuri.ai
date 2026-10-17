import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

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

/** Write the complete buffer or fail closed if the filesystem cannot make progress. */
export function writeBufferFullySync(fd, buffer, writeSync = fs.writeSync) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('TRACE_BUFFER_REQUIRED');
  let offset = 0;
  while (offset < buffer.length) {
    const remaining = buffer.length - offset;
    const written = writeSync(fd, buffer, offset, remaining);
    if (!Number.isSafeInteger(written) || written <= 0 || written > remaining) {
      throw new Error('BACKEND_TRACE_WRITE_FAILED');
    }
    offset += written;
  }
  return offset;
}

/** Parse a single command string using Windows command-line quoting (plus PowerShell single quotes). */
export function commandTokens(command, platform = process.platform) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const tokens = [];
  let token = '';
  let active = false;
  let doubleQuoted = false;
  let singleQuoted = false;
  let firstToken = true;
  const finish = () => {
    if (active) tokens.push(token);
    token = ''; active = false;
  };
  for (let i = 0; i < command.length;) {
    const char = command[i];
    if (!doubleQuoted && !singleQuoted && /\s/.test(char)) { finish(); i++; continue; }
    if (platform === 'win32' && firstToken && !active && !doubleQuoted && !singleQuoted && char === '&' && command[i + 1] !== '&') {
      // PowerShell's call operator may prefix a quoted executable path.
      i++; firstToken = false; continue;
    }
    if (!/\s/.test(char)) firstToken = false;
    if (platform === 'win32' && !singleQuoted && char === '\\') {
      let end = i;
      while (command[end] === '\\') end++;
      const count = end - i;
      if (command[end] === '"') {
        token += '\\'.repeat(Math.floor(count / 2));
        active = true;
        if (count % 2 === 1) token += '"';
        else if (doubleQuoted && command[end + 1] === '"') { token += '"'; end++; }
        else doubleQuoted = !doubleQuoted;
        i = end + 1; continue;
      }
      token += '\\'.repeat(count); active = true; i = end; continue;
    }
    if (!doubleQuoted && char === "'") {
      active = true;
      if (singleQuoted && command[i + 1] === "'") { token += "'"; i += 2; continue; }
      singleQuoted = !singleQuoted; i++; continue;
    }
    if (!singleQuoted && char === '"') {
      active = true;
      if (platform === 'win32') {
        if (doubleQuoted && command[i + 1] === '"') { token += '"'; i += 2; continue; }
        doubleQuoted = !doubleQuoted;
        i++;
        continue;
      }
      doubleQuoted = !doubleQuoted; i++; continue;
    }
    if (platform !== 'win32' && char === '\\' && !singleQuoted && i + 1 < command.length) {
      token += command[i + 1]; active = true; i += 2; continue;
    }
    token += char; active = true; i++;
  }
  if (doubleQuoted || singleQuoted) return null;
  finish();
  return tokens.length ? tokens : null;
}

function normalizedPath(value, worktree, platform) {
  if (typeof value !== 'string' || !value) return null;
  const api = platform === 'win32' ? path.win32 : path.posix;
  const absolute = api.normalize(api.isAbsolute(value) ? value : api.resolve(worktree, value));
  return platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function environmentValue(environment, name) {
  const entry = Object.entries(environment ?? {}).find(([key]) => key.toUpperCase() === name);
  return entry?.[1];
}

function executableIdentity(value, { platform, environment, cwd }) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const literal = platform === 'win32' ? value.toLowerCase() : value;
  const hasDirectory = api.isAbsolute(value) || value.includes('/') || (platform === 'win32' && value.includes('\\'));
  if (hasDirectory) {
    if (!cwd && !api.isAbsolute(value)) return { resolved: null, literal };
    const resolved = api.normalize(api.isAbsolute(value) ? value : api.resolve(cwd, value));
    return { resolved: platform === 'win32' ? resolved.toLowerCase() : resolved, literal };
  }

  const pathValue = environmentValue(environment, 'PATH');
  const searchPath = typeof pathValue === 'string' ? pathValue : '';
  const directories = searchPath.split(api.delimiter).filter(Boolean);
  const pathExtValue = environmentValue(environment, 'PATHEXT');
  const pathExt = platform === 'win32'
    ? (typeof pathExtValue === 'string' && pathExtValue ? pathExtValue : '.COM;.EXE;.BAT;.CMD')
      .split(';').filter(Boolean)
    : [''];
  const extensions = platform === 'win32' && !api.extname(value) ? pathExt : [''];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = api.join(directory, `${value}${extension}`);
      try {
        if (fs.statSync(candidate).isFile()) {
          const resolved = api.normalize(candidate);
          return { resolved: platform === 'win32' ? resolved.toLowerCase() : resolved, literal };
        }
      } catch { /* Continue through the captured PATH order. */ }
    }
  }
  return { resolved: null, literal };
}

function executableMatches(actual, expected, options) {
  const actualId = executableIdentity(actual, options);
  const expectedId = executableIdentity(expected, options);
  if (actualId.resolved && expectedId.resolved) return actualId.resolved === expectedId.resolved;
  return actualId.literal === expectedId.literal;
}

function validateDeclaredChecks(checks, cap) {
  if (!Array.isArray(checks) || checks.length === 0 || !Number.isSafeInteger(cap) || cap < 1 || cap > 10) {
    throw new Error('INVALID_REQUIRED_CHECK_POLICY');
  }
  for (const check of checks) {
    if (!check || typeof check !== 'object' || check.shell !== false
      || typeof check.executable !== 'string' || !check.executable.trim()
      || !Array.isArray(check.argv) || !check.argv.every((arg) => typeof arg === 'string')
      || typeof check.cwd !== 'string' || !check.cwd.trim()) throw new Error('INVALID_REQUIRED_CHECK_POLICY');
  }
}

/** Tracks only real command_execution items. Its public summary contains hashes, counts and exit codes. */
export function createRoleCheckTrace({ checks, invocationCap, worktree, platform = process.platform, environment = backendEnvironment() }) {
  validateDeclaredChecks(checks, invocationCap);
  const items = new Map();
  const invocations = checks.map(() => []);
  let malformed = false;
  let overBudget = false;
  let nextSequence = 0;
  let errorCode = null;

  const markMalformed = () => { malformed = true; errorCode ??= 'MALFORMED_EVENT_TRACE'; };
  const matchingChecks = (command, cwd) => {
    const actual = commandTokens(command, platform);
    if (!actual) return null;
    const actualCwd = normalizedPath(cwd ?? worktree, worktree, platform);
    if (!actualCwd) return null;
    return checks.flatMap((check, index) => {
      const expected = [check.executable, ...check.argv];
      if (actual.length !== expected.length) return [];
      const isExecutableMatch = executableMatches(actual[0], expected[0], { platform, environment, cwd: actualCwd });
      if (!isExecutableMatch || !actual.slice(1).every((arg, i) => arg === expected[i + 1])) return [];
      if (normalizedPath(check.cwd, worktree, platform) !== actualCwd) return [];
      return [index];
    });
  };

  function observe(event) {
    if (errorCode) return errorCode;
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
      markMalformed(); return errorCode;
    }
    if (event.type !== 'item.started' && event.type !== 'item.completed') return null;
    const item = event.item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) { markMalformed(); return errorCode; }
    if (item.type !== 'command_execution') return null;
    if (typeof item.id !== 'string' || !item.id || typeof item.command !== 'string'
      || (item.cwd !== undefined && item.cwd !== null && typeof item.cwd !== 'string')) {
      markMalformed(); return errorCode;
    }
    let record = items.get(item.id);
    if (event.type === 'item.started') {
      if (!item.command.trim() || item.status !== 'in_progress'
        || (item.exit_code !== undefined && item.exit_code !== null)) {
        markMalformed(); return errorCode;
      }
      if (record) {
        if (!record.started || record.command !== item.command || record.cwd !== (item.cwd ?? null)) markMalformed();
        return errorCode;
      }
      const matched = matchingChecks(item.command, item.cwd);
      if (matched === null) { markMalformed(); return errorCode; }
      record = { id: item.id, command: item.command, cwd: item.cwd ?? null, matched, sequence: nextSequence++, started: true,
        cwdProvenance: typeof item.cwd === 'string' ? 'item_cwd' : 'launch_cwd',
        completed: false, exitCode: null, status: null };
      items.set(item.id, record);
      for (const checkIndex of matched) {
        invocations[checkIndex].push(record);
        if (invocations[checkIndex].length > invocationCap) {
          overBudget = true; errorCode = 'REQUIRED_CHECK_INVOCATION_CAP_EXCEEDED';
          return errorCode;
        }
      }
      return null;
    }

    if (!record || !record.started) { markMalformed(); return errorCode; }
    if (item.command !== record.command) { markMalformed(); return errorCode; }
    if (item.cwd !== undefined && item.cwd !== null && item.cwd !== record.cwd) { markMalformed(); return errorCode; }
    const exitCode = item.exit_code;
    if (exitCode !== null && exitCode !== undefined && !Number.isSafeInteger(exitCode)) {
      markMalformed(); return errorCode;
    }
    if (!['completed', 'failed', 'declined'].includes(item.status)) { markMalformed(); return errorCode; }
    if (record.completed) {
      if (record.exitCode !== (exitCode ?? null) || record.status !== item.status) markMalformed();
      return errorCode;
    }
    record.completed = true; record.exitCode = exitCode ?? null; record.status = item.status;
    return null;
  }

  function summary(traceDigest) {
    const checksSummary = checks.map((check, index) => {
      const runs = invocations[index].slice().sort((a, b) => a.sequence - b.sequence);
      const last = runs.at(-1);
      const cwdProvenances = new Set(runs.map((run) => run.cwdProvenance));
      const status = overBudget && runs.length > invocationCap ? 'OVER_BUDGET'
        : check.cwd && normalizedPath(check.cwd, worktree, platform) !== normalizedPath(worktree, worktree, platform) ? 'UNSUPPORTED_CWD'
          : !last ? 'MISSING'
          : runs.some((run) => !run.completed || run.exitCode === null) ? 'MISSING_COMPLETION'
            : last.status !== 'completed' || last.exitCode !== 0 ? 'FAILED' : 'PASS';
      return { checkIndex: index, checkSha256: sha(JSON.stringify(check)), invocationCount: runs.length,
        cwdProvenance: cwdProvenances.size > 1 ? 'mixed' : cwdProvenances.values().next().value ?? null,
        invocations: runs.map((run) => ({ itemIdSha256: sha(run.id), cwdProvenance: run.cwdProvenance, exitCode: run.exitCode })), status };
    });
    const status = malformed ? 'MALFORMED' : overBudget ? 'OVER_BUDGET'
      : checksSummary.every((item) => item.status === 'PASS') ? 'PASS'
        : checksSummary.some((item) => item.status === 'UNSUPPORTED_CWD') ? 'UNSUPPORTED' : 'FAIL';
    return { schemaVersion: 'role-check-trace/v1', status, traceSha256: traceDigest, invocationCap,
      checks: checksSummary, errorCode };
  }

  return { observe, summary, markMalformed, get errorCode() { return errorCode; } };
}

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
  spawnProcess = spawn, signal, windowsSandbox = null, checks = [], maxInvocationsPerDeclaredCheckPerRoleSession = 2 }) {
  if (!path.isAbsolute(executable) || !fs.statSync(executable).isFile()) throw new Error('CODEX_EXECUTABLE_REQUIRED');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45 * 60_000) throw new Error('Invalid role deadline');
  validateDeclaredChecks(checks, maxInvocationsPerDeclaredCheckPerRoleSession);
  const executionEnvironment = backendEnvironment();
  const checkTrace = createRoleCheckTrace({ checks, invocationCap: maxInvocationsPerDeclaredCheckPerRoleSession,
    worktree, environment: executionEnvironment });
  fs.mkdirSync(artifactDir, { recursive: true });
  const schemaFile = path.join(artifactDir, 'result-schema.json');
  const resultFile = path.join(artifactDir, 'result.json');
  const traceFile = path.join(artifactDir, 'events.jsonl');
  const checkTraceFile = path.join(artifactDir, 'check-trace.json');
  // A dispatch directory is single-use. Stale output can never satisfy a new gate.
  if (fs.existsSync(resultFile) || fs.existsSync(traceFile) || fs.existsSync(checkTraceFile)) throw new Error('DISPATCH_DIRECTORY_REUSED');
  fs.writeFileSync(schemaFile, JSON.stringify(ROLE_RESULT_SCHEMA));
  const args = buildCodexInvocation({ role, worktree, schemaFile, resultFile, windowsSandbox });
  const events = fs.openSync(traceFile, 'wx');
  const errors = fs.openSync(path.join(artifactDir, 'stderr.log'), 'wx');
  let child;
  let timedOut = false;
  let sessionId = null;
  let parseBuffer = '';
  const decoder = new StringDecoder('utf8');
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
    if (!child?.pid) { try { child?.kill?.('SIGTERM'); } catch {} return; }
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
      env: executionEnvironment, stdio: ['pipe', 'pipe', 'pipe'] });
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
    try { writeBufferFullySync(fd, chunk); }
    catch { callbackError = new Error('BACKEND_TRACE_WRITE_FAILED'); stop(); return false; }
      return true;
    };
    child.stderr.on('data', (chunk) => capture(errors, chunk));
    child.stdout.on('data', (chunk) => {
      if (!capture(events, chunk)) return;
      parseBuffer += decoder.write(chunk);
      const lines = parseBuffer.split('\n'); parseBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); }
        catch { checkTrace.markMalformed(); callbackError = new Error('MALFORMED_EVENT_TRACE'); stop(); return; }
        if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
          checkTrace.markMalformed();
          callbackError = new Error('MALFORMED_EVENT_TRACE'); stop(); return;
        }
        if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
          if (sessionId && sessionId !== event.thread_id) { callbackError = new Error('BACKEND_SESSION_CHANGED'); stop(); }
          if (!sessionId) {
            sessionId = event.thread_id;
            callbacks = callbacks.then(() => onSession({ sessionId, model: 'gpt-6-luna', effort: 'max' }))
              .catch((error) => { callbackError = error; stop(); });
          }
        }
        const traceError = checkTrace.observe(event);
        if (traceError) { callbackError = new Error(traceError); stop(); return; }
      }
    });
    const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, sig) => resolve({ code, signal: sig })); });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    const exit = await Promise.race([closed, stopped]);
    await Promise.race([callbacks, stopped]);
    parseBuffer += decoder.end();
    if (parseBuffer.trim() && !callbackError) {
      let event;
      try { event = JSON.parse(parseBuffer); }
      catch { checkTrace.markMalformed(); callbackError = new Error('MALFORMED_EVENT_TRACE'); }
      if (!callbackError) {
        if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
          checkTrace.markMalformed(); callbackError = new Error('MALFORMED_EVENT_TRACE');
        }
        else {
          if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
            if (sessionId && sessionId !== event.thread_id) callbackError = new Error('BACKEND_SESSION_CHANGED');
            else if (!sessionId) {
              sessionId = event.thread_id;
              callbacks = callbacks.then(() => onSession({ sessionId, model: 'gpt-6-luna', effort: 'max' }))
                .catch((error) => { callbackError = error; stop(); });
            }
          }
          const traceError = checkTrace.observe(event);
          if (traceError) callbackError = new Error(traceError);
        }
      }
    }
    const traceDigest = sha(fs.readFileSync(traceFile));
    const checkEvidence = checkTrace.summary(traceDigest);
    fs.writeFileSync(checkTraceFile, JSON.stringify(checkEvidence), { flag: 'wx' });
    if (timedOut || signal?.aborted || callbackError || exit.code !== 0 || !sessionId) {
      return { outcome: 'UNKNOWN', effectState: role === 'worker' ? 'UNKNOWN' : 'NONE', sessionId,
        code: timedOut ? 'DEADLINE_EXCEEDED' : signal?.aborted ? 'CANCELLED' : callbackError?.message ?? 'BACKEND_FAILED',
        exitCode: exit.code, artifactDir, checkTrace: checkEvidence };
    }
    let result;
    try {
      if (fs.statSync(resultFile).size > 128 * 1024) throw new Error('RESULT_TOO_LARGE');
      result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    } catch {
      return { outcome: 'UNKNOWN', effectState: role === 'worker' ? 'UNKNOWN' : 'NONE', sessionId, code: 'INVALID_BACKEND_RESULT', artifactDir, checkTrace: checkEvidence };
    }
    if (!['PASS', 'FAIL', 'BLOCKED'].includes(result.outcome) || !/^[a-f0-9]{40}$/.test(result.headCommit)
      || typeof result.summary !== 'string' || result.summary.length > 8192 || !Array.isArray(result.evidence)
      || result.evidence.length > 64 || !result.evidence.every((s) => typeof s === 'string' && s.length <= 1024)) {
      return { outcome: 'UNKNOWN', effectState: role === 'worker' ? 'UNKNOWN' : 'NONE', sessionId, code: 'INVALID_BACKEND_RESULT', artifactDir, checkTrace: checkEvidence };
    }
    const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8', windowsHide: true }).trim();
    if (actualHead !== result.headCommit || (expectedHead && expectedHead !== actualHead)) {
      return { outcome: 'UNKNOWN', effectState: 'UNKNOWN', sessionId, code: 'HEAD_CHANGED', artifactDir, checkTrace: checkEvidence };
    }
    if (result.outcome === 'PASS' && ['MALFORMED', 'OVER_BUDGET'].includes(checkEvidence.status)) {
      return { ...result, outcome: 'UNKNOWN', effectState: role === 'worker' ? 'UNKNOWN' : 'NONE',
        code: checkEvidence.status === 'OVER_BUDGET' ? 'REQUIRED_CHECK_INVOCATION_CAP_EXCEEDED' : 'REQUIRED_CHECK_TRACE_MALFORMED',
        sessionId, model: 'gpt-6-luna', effort: 'max', artifactDir, checkTrace: checkEvidence,
        resultDigest: sha(fs.readFileSync(resultFile)) };
    }
    const checkStatuses = checkEvidence.checks.map((check) => check.status);
    const failedCheck = checkStatuses.includes('FAILED');
    const unsupportedCwd = checkEvidence.status === 'UNSUPPORTED' || checkStatuses.includes('UNSUPPORTED_CWD');
    const checkOverride = result.outcome === 'PASS' && checkEvidence.status !== 'PASS'
      ? failedCheck ? { outcome: 'FAIL', code: 'REQUIRED_CHECK_EVIDENCE_FAILED' }
        : unsupportedCwd ? { outcome: 'BLOCKED', code: 'REQUIRED_CHECK_CWD_UNSUPPORTED' }
          : { outcome: 'BLOCKED', code: 'REQUIRED_CHECK_EVIDENCE_INCOMPLETE' }
      : {};
    return { ...result, ...checkOverride,
      sessionId, model: 'gpt-6-luna', effort: 'max', artifactDir, checkTrace: checkEvidence,
      resultDigest: sha(fs.readFileSync(resultFile)) };
  } finally {
    disposed = true;
    clearTimeout(timer); clearTimeout(stopTimer); signal?.removeEventListener('abort', stop);
    fs.closeSync(events); fs.closeSync(errors);
  }
}

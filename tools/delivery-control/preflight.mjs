#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { accessSync, closeSync, constants as fsConstants, lstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const REPOSITORY = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const ROADMAP_RELATIVE = 'docs/roadmap/ROADMAP.md';
const POLICY_RELATIVE = 'docs/architecture/delivery-control/contracts/model-policy.json';
const TASK_KEYS = new Set(['schemaVersion', 'taskId', 'objective', 'acceptance', 'writeScope', 'checks', 'dependencies', 'mandateReference']);
const CHECK_KEYS = new Set(['shell', 'executable', 'argv', 'cwd']);
const DEPENDENCY_KEYS = new Set(['taskId', 'revision']);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, shell: false, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 }).trimEnd();
}

function semanticMetadata(value) {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (Array.isArray(value)) return value.map(semanticMetadata);
  if (record(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, semanticMetadata(value[key])]));
  }
  return value;
}

function isInside(root, candidate) {
  const base = process.platform === 'win32' ? root.toLowerCase() : root;
  const target = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const relative = path.relative(base, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function normalizedPath(value) {
  const plain = process.platform === 'win32'
    ? value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
    : value;
  const normalized = path.normalize(plain);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function safeRelativePath(value, { allowDot = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    return { ok: false, reason: 'Use a repository-relative path with forward slashes.' };
  }
  if (allowDot && value === '.') return { ok: true, value };
  const normalized = value.endsWith('/') ? value.slice(0, -1) : value;
  if (!normalized) return { ok: false, reason: 'Path must name a repository entry.' };
  const segments = normalized.split('/');
  if (segments.some((part) => part === '' || part === '.' || part === '..')) {
    return { ok: false, reason: 'Empty, dot, and parent path segments are not allowed.' };
  }
  if (segments.some((part) => /[\u0000-\u001f\u007f:*?"<>|]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) {
    return { ok: false, reason: 'The path contains a non-portable or reserved name.' };
  }
  return { ok: true, value: normalized };
}

function nearestExisting(candidate, root) {
  let current = candidate;
  while (true) {
    try {
      lstatSync(current);
      return current;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      if (normalizedPath(current) === normalizedPath(root)) return root;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function checkedRepoPath(root, relative, { allowDot = false, requireExisting = false } = {}) {
  const lexical = safeRelativePath(relative, { allowDot });
  if (!lexical.ok) return { ok: false, kind: 'scope', reason: lexical.reason };
  const candidate = lexical.value === '.' ? root : path.resolve(root, ...lexical.value.split('/'));
  if (!isInside(root, candidate)) return { ok: false, kind: 'scope', reason: 'Path escapes the repository.' };
  try {
    const existing = nearestExisting(candidate, root);
    if (!existing) return { ok: false, kind: 'scope', reason: 'Path has no repository-contained parent.' };
    const realExisting = realpathSync.native(existing);
    if (!isInside(root, realExisting)) return { ok: false, kind: 'scope', reason: 'A symlink or junction escapes the repository.' };
    let realCandidate = null;
    try {
      realCandidate = realpathSync.native(candidate);
      if (!isInside(root, realCandidate)) return { ok: false, kind: 'scope', reason: 'A symlink or junction escapes the repository.' };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
        if (error.code === 'ELOOP') return { ok: false, kind: 'scope', reason: 'Path contains a symlink loop.' };
        if (error.code !== 'EINVAL') throw error;
      }
    }
    if (requireExisting && !realCandidate) return { ok: false, kind: 'missing', reason: 'Path does not exist.' };
    return { ok: true, path: candidate, realPath: realCandidate };
  } catch (error) {
    return { ok: false, kind: 'scope', reason: error.message };
  }
}

function addIssue(issues, status, code, message, at) {
  issues.push({ status, code, message, ...(at ? { path: at } : {}) });
}

function validateTaskShape(task) {
  const issues = [];
  if (!record(task)) return [{ status: 'REPAIR_METADATA', code: 'TASK_METADATA_INVALID', message: 'Task file must contain one JSON object.' }];
  for (const key of Object.keys(task)) {
    if (!TASK_KEYS.has(key)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_UNKNOWN_FIELD', 'Unknown task metadata field.', '$.' + key);
  }
  for (const key of ['schemaVersion', 'taskId', 'objective', 'acceptance', 'writeScope', 'checks', 'mandateReference']) {
    if (!Object.hasOwn(task, key)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_FIELD_REQUIRED', 'Required task metadata field is missing.', '$.' + key);
  }
  if (task.schemaVersion !== 'task-readiness/v1') addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_SCHEMA_VERSION', 'Expected schemaVersion task-readiness/v1.', '$.schemaVersion');
  if (!text(task.taskId) || task.taskId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(task.taskId)) {
    addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_TASK_ID', 'taskId must be a stable nonempty identifier.', '$.taskId');
  }
  if (!text(task.objective)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_OBJECTIVE', 'objective must be a nonempty string.', '$.objective');
  if (!text(task.mandateReference)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_MANDATE_REFERENCE', 'mandateReference must be a nonempty provenance pointer.', '$.mandateReference');
  if (!Array.isArray(task.acceptance) || task.acceptance.length < 1 || task.acceptance.some((item) => !text(item))) {
    addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_ACCEPTANCE', 'acceptance must contain at least one nonempty string.', '$.acceptance');
  }
  if (!Array.isArray(task.writeScope) || task.writeScope.length < 1 || task.writeScope.some((item) => !text(item))) {
    addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_WRITE_SCOPE', 'writeScope must contain at least one nonempty path.', '$.writeScope');
  }
  if (Array.isArray(task.writeScope)) {
    const seen = new Set();
    for (const [index, item] of task.writeScope.entries()) {
      if (!text(item)) continue;
      const checked = safeRelativePath(item);
      if (!checked.ok) addIssue(issues, 'BLOCKED_SCOPE', 'WRITE_SCOPE_PATH_INVALID', checked.reason, '$.writeScope/' + index);
      const key = process.platform === 'win32' ? checked.value?.toLowerCase() : checked.value;
      if (seen.has(key)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_DUPLICATE_SCOPE', 'writeScope entries must be unique.', '$.writeScope/' + index);
      seen.add(key);
    }
  }
  if (!Array.isArray(task.checks) || task.checks.length < 1) {
    addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_CHECKS', 'checks must contain at least one structured check.', '$.checks');
  } else {
    for (const [index, check] of task.checks.entries()) {
      const at = '$.checks/' + index;
      if (!record(check)) {
        addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_CHECK_INVALID', 'Each check must be an object.', at);
        continue;
      }
      for (const key of Object.keys(check)) {
        if (!CHECK_KEYS.has(key)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_CHECK_UNKNOWN_FIELD', 'Unknown check field.', at + '/' + key);
      }
      for (const key of CHECK_KEYS) {
        if (!Object.hasOwn(check, key)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_CHECK_FIELD_REQUIRED', 'Required check field is missing.', at + '/' + key);
      }
      if (check.shell !== false) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_SHELL_FORBIDDEN', 'Every check must declare shell: false.', at + '/shell');
      if (!text(check.executable)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_EXECUTABLE', 'executable must be a nonempty string.', at + '/executable');
      if (!Array.isArray(check.argv) || check.argv.some((item) => typeof item !== 'string')) {
        addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_ARGV', 'argv must be an array of strings.', at + '/argv');
      }
      if (!text(check.cwd)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_CWD', 'cwd must be a repository-relative path.', at + '/cwd');
      else {
        const checked = safeRelativePath(check.cwd, { allowDot: true });
        if (!checked.ok) addIssue(issues, 'BLOCKED_SCOPE', 'CHECK_CWD_PATH_INVALID', checked.reason, at + '/cwd');
      }
    }
  }
  if (Object.hasOwn(task, 'dependencies')) {
    if (!Array.isArray(task.dependencies)) {
      addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_DEPENDENCIES', 'dependencies must be an array.', '$.dependencies');
    } else {
      const seen = new Set();
      for (const [index, dependency] of task.dependencies.entries()) {
        const at = '$.dependencies/' + index;
        if (!record(dependency)) {
          addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_DEPENDENCY_INVALID', 'Each dependency must be an object.', at);
          continue;
        }
        for (const key of Object.keys(dependency)) {
          if (!DEPENDENCY_KEYS.has(key)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_DEPENDENCY_UNKNOWN_FIELD', 'Unknown dependency field.', at + '/' + key);
        }
        if (!text(dependency.taskId) || dependency.taskId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(dependency.taskId)) {
          addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_DEPENDENCY_ID', 'Dependency taskId must be a stable nonempty identifier.', at + '/taskId');
        }
        if (Object.hasOwn(dependency, 'revision') && !text(dependency.revision)) {
          addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_DEPENDENCY_REVISION', 'revision must be a nonempty string when supplied.', at + '/revision');
        }
        if (seen.has(dependency.taskId)) addIssue(issues, 'REPAIR_METADATA', 'TASK_METADATA_DUPLICATE_DEPENDENCY', 'Dependency taskId values must be unique.', at + '/taskId');
        seen.add(dependency.taskId);
      }
    }
  }
  return issues;
}

function taskFilePath(repoRoot, commonDir, input) {
  const candidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(repoRoot, input);
  const allowedRoot = [repoRoot, commonDir].find((root) => isInside(root, candidate));
  if (!allowedRoot) return { ok: false, reason: 'Task file path escapes the repository and its private git common directory.' };
  let real;
  try { real = realpathSync.native(candidate); } catch (error) { return { ok: false, reason: error.message, missing: error.code === 'ENOENT' }; }
  if (![repoRoot, commonDir].some((root) => isInside(root, real))) return { ok: false, reason: 'Task file symlink or junction escapes the repository and its private git common directory.' };
  try {
    if (!statSync(real).isFile()) return { ok: false, reason: 'Task file must be a regular file.' };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  return { ok: true, path: real };
}

function nativeWindowsExecutable(file, size) {
  if (!/\.(exe|com)$/i.test(file) || size < 88) return false;
  const descriptor = openSync(file, 'r');
  try {
    const dos = Buffer.alloc(64);
    if (readSync(descriptor, dos, 0, dos.length, 0) !== dos.length || dos.toString('ascii', 0, 2) !== 'MZ') return false;
    const offset = dos.readUInt32LE(60);
    if (offset < 64 || offset > size - 24) return false;
    const pe = Buffer.alloc(24);
    if (readSync(descriptor, pe, 0, pe.length, offset) !== pe.length || !pe.subarray(0, 4).equals(Buffer.from('PE\0\0'))) return false;
    const flags = pe.readUInt16LE(22);
    return (flags & 0x0002) !== 0 && (flags & 0x2000) === 0;
  } finally {
    closeSync(descriptor);
  }
}

function findExecutable(executable, repoRoot) {
  const hasPath = path.isAbsolute(executable) || executable.includes('/') || executable.includes('\\');
  let candidates = [];
  if (path.isAbsolute(executable)) candidates = [executable];
  else if (hasPath) {
    const checked = checkedRepoPath(repoRoot, executable.replaceAll('\\', '/'), { requireExisting: true });
    if (!checked.ok) return { ok: false, kind: checked.kind === 'scope' ? 'scope' : 'environment', reason: checked.reason };
    candidates = [checked.realPath];
  } else {
    const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const extensions = process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];
    candidates = pathEntries.flatMap((entry) => extensions.map((extension) => path.join(entry, process.platform === 'win32' && !path.extname(executable) ? executable + extension : executable)));
  }
  for (const candidate of candidates) {
    try {
      const info = statSync(candidate);
      if (!info.isFile()) continue;
      if (process.platform === 'win32') {
        if (/\.(bat|cmd)$/i.test(candidate)) return { ok: false, kind: 'environment', reason: 'Batch files require shell execution and cannot satisfy shell: false.' };
        if (!nativeWindowsExecutable(candidate, info.size)) continue;
      } else {
        accessSync(candidate, fsConstants.X_OK);
      }
      return { ok: true, path: realpathSync.native(candidate) };
    } catch {}
  }
  return { ok: false, kind: 'environment', reason: 'Declared executable is not available on this machine.' };
}

function scopeContains(repoRoot, scopeEntry, changedPath) {
  const normalizedScope = safeRelativePath(scopeEntry)?.value;
  if (!normalizedScope) return false;
  const scopeChecked = checkedRepoPath(repoRoot, normalizedScope);
  if (!scopeChecked.ok) return false;
  // Scope intent is stable before and after files exist. Only an explicit
  // directory marker authorizes descendants; a filename never expands itself.
  const isDirectory = scopeEntry.endsWith('/');
  if (!isDirectory) return normalizedPath(changedPath) === normalizedPath(normalizedScope);
  const left = process.platform === 'win32' ? normalizedScope.toLowerCase() : normalizedScope;
  const right = process.platform === 'win32' ? changedPath.toLowerCase() : changedPath;
  return right === left || right.startsWith(left + '/');
}

function statusPaths(porcelain) {
  const values = porcelain.split('\0');
  const changed = [];
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item || item.length < 4) continue;
    const status = item.slice(0, 2);
    changed.push(item.slice(3));
    if (status.includes('R') || status.includes('C')) {
      const next = values[++index];
      if (next) changed.push(next);
    }
  }
  // Git -z uses repository path bytes. A POSIX backslash is a filename
  // character, so converting it to a separator could disguise a scope escape.
  return [...new Set(changed)].sort();
}

function policyNoProgressCap(repoRoot) {
  const file = path.join(repoRoot, ...POLICY_RELATIVE.split('/'));
  const policy = JSON.parse(readFileSync(file, 'utf8'));
  if (policy?.version !== 4 || policy?.status !== 'ACTIVE' ||
      policy?.ordinaryPreflight?.status !== 'ACTIVE' ||
      policy?.ordinaryPreflight?.enabled !== true ||
      policy?.ordinaryPreflight?.schema !== 'task-readiness/v1') {
    throw new Error('Active v4 ordinary preflight policy is unavailable.');
  }
  const cap = policy?.retryAndLineage?.limits?.maxOccurrencesPerNoProgressFingerprint;
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('Active policy no-progress cap is missing or invalid.');
  return cap;
}

function roadmapLedger(repoRoot, baseCommit) {
  // A task cannot accept its own dependency by editing the working ledger.
  const source = git(repoRoot, ['show', baseCommit + ':' + ROADMAP_RELATIVE]);
  const start = source.indexOf('<!-- roadmap-task-ledger:start -->');
  const end = source.indexOf('<!-- roadmap-task-ledger:end -->');
  if (start < 0 || end <= start) throw new Error('Canonical roadmap task ledger markers are missing.');
  const lines = source.slice(start, end).split(/\r?\n/).filter((line) => line.startsWith('|'));
  const header = lines.shift()?.split('|').map((cell) => cell.trim()).filter(Boolean) ?? [];
  const indexes = Object.fromEntries(header.map((name, index) => [name, index]));
  for (const name of ['task_id', 'status', 'proof_scope', 'implementation_state', 'evidence']) {
    if (!Number.isInteger(indexes[name])) throw new Error('Canonical roadmap task ledger is missing column ' + name + '.');
  }
  const tasks = new Map();
  for (const line of lines) {
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length <= indexes.evidence) continue;
    const taskId = cells[indexes.task_id];
    if (!taskId || taskId === '---') continue;
    if (tasks.has(taskId)) throw new Error('Canonical roadmap task ledger repeats ' + taskId + '.');
    tasks.set(taskId, {
      taskId,
      status: cells[indexes.status],
      proofScope: cells[indexes.proof_scope],
      implementationState: cells[indexes.implementation_state],
      evidence: cells.slice(indexes.evidence).join(' | '),
    });
  }
  return tasks;
}

function resolveCommit(repoRoot, ref) {
  return git(repoRoot, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']);
}

function ancestor(repoRoot, earlier, later) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', earlier, later], {
      cwd: repoRoot, shell: false, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function issueStatus(issues) {
  for (const status of ['BLOCKED_SCOPE', 'BLOCKED_ENVIRONMENT', 'BLOCKED_DEPENDENCY', 'REPAIR_METADATA']) {
    if (issues.some((item) => item.status === status)) return status;
  }
  return 'READY';
}

function emptyResult(status, issues, taskId = null) {
  return {
    schemaVersion: 'task-preflight-result/v1',
    status,
    taskId,
    issues,
    metadataRepair: {
      consumesImplementationRepair: false,
      noProgressCap: null,
      repeatedIdenticalMetadataOutcome: 'YIELD_REASSESS',
      resumable: true,
    },
    authorityGrant: false,
    dispatchAllowed: false,
    mandateReferenceIsProvenanceOnly: true,
    checksExecuted: false,
    stateWritePerformed: false,
  };
}

function validatePathBindings(task, repoRoot, issues) {
  for (const [index, scope] of task.writeScope.entries()) {
    const checked = checkedRepoPath(repoRoot, scope);
    if (!checked.ok) addIssue(issues, 'BLOCKED_SCOPE', 'WRITE_SCOPE_ESCAPE', checked.reason, '$.writeScope/' + index);
  }
  for (const [index, check] of task.checks.entries()) {
    const cwd = checkedRepoPath(repoRoot, check.cwd, { allowDot: true, requireExisting: true });
    if (!cwd.ok) {
      addIssue(issues, cwd.kind === 'scope' ? 'BLOCKED_SCOPE' : 'BLOCKED_ENVIRONMENT', 'CHECK_CWD_UNAVAILABLE', cwd.reason, '$.checks/' + index + '/cwd');
      continue;
    }
    try {
      if (!statSync(cwd.path).isDirectory()) addIssue(issues, 'BLOCKED_ENVIRONMENT', 'CHECK_CWD_NOT_DIRECTORY', 'Declared check cwd is not a directory.', '$.checks/' + index + '/cwd');
    } catch (error) {
      addIssue(issues, 'BLOCKED_ENVIRONMENT', 'CHECK_CWD_UNAVAILABLE', error.message, '$.checks/' + index + '/cwd');
    }
    const executable = findExecutable(check.executable, repoRoot);
    if (!executable.ok) {
      addIssue(issues, executable.kind === 'scope' ? 'BLOCKED_SCOPE' : 'BLOCKED_ENVIRONMENT', 'CHECK_EXECUTABLE_UNAVAILABLE', executable.reason, '$.checks/' + index + '/executable');
    }
  }
}

function inspectDependencies(task, repoRoot, baseCommit, issues) {
  let ledger;
  try { ledger = roadmapLedger(repoRoot, baseCommit); } catch (error) {
    addIssue(issues, 'BLOCKED_ENVIRONMENT', 'ROADMAP_LEDGER_UNAVAILABLE', error.message, ROADMAP_RELATIVE);
    return [];
  }
  const dependencies = [];
  for (const dependency of task.dependencies ?? []) {
    const row = ledger.get(dependency.taskId);
    if (!row) {
      addIssue(issues, 'BLOCKED_DEPENDENCY', 'DEPENDENCY_NOT_IN_ROADMAP', 'Dependency is not present in the canonical roadmap task ledger.', '$.dependencies');
      dependencies.push({ taskId: dependency.taskId, roadmapStatus: 'UNKNOWN', accepted: false, roadmapEvidence: null });
      continue;
    }
    const accepted = row.status.toLowerCase() === 'done';
    const entry = {
      taskId: row.taskId,
      roadmapStatus: row.status,
      proofScope: row.proofScope,
      implementationState: row.implementationState,
      roadmapEvidence: row.evidence,
      accepted,
    };
    if (!accepted) {
      addIssue(issues, 'BLOCKED_DEPENDENCY', 'DEPENDENCY_NOT_DONE', 'Canonical roadmap status is ' + row.status + '; dependency is not accepted as done.', '$.dependencies');
    }
    if (dependency.revision) {
      try {
        const revision = resolveCommit(repoRoot, dependency.revision);
        entry.resolvedRevision = revision;
        entry.revisionIsAncestorOfBase = ancestor(repoRoot, revision, baseCommit);
        if (!entry.revisionIsAncestorOfBase) {
          entry.accepted = false;
          addIssue(issues, 'BLOCKED_DEPENDENCY', 'DEPENDENCY_REVISION_NOT_IN_BASE', 'Dependency revision is not an ancestor of the selected base.', '$.dependencies');
        }
      } catch {
        entry.accepted = false;
        addIssue(issues, 'BLOCKED_DEPENDENCY', 'DEPENDENCY_REVISION_UNAVAILABLE', 'Dependency revision cannot be resolved to a commit.', '$.dependencies');
      }
    }
    dependencies.push(entry);
  }
  return dependencies;
}

export function classifyFailure({
  failureClass,
  effectState = 'UNKNOWN',
  metadata,
  priorMetadata = [],
  noProgressCap,
  sameInput = false,
  idempotent = false,
  provenNoEffect = false,
  remainingToolRetries = 0,
} = {}) {
  if (effectState === 'UNKNOWN' || failureClass === 'UNKNOWN_EFFECT') {
    return {
      outcome: 'READ_ONLY_RECONCILE',
      resumable: true,
      terminal: false,
      retryAllowed: false,
      consumesImplementationRepair: false,
      nextAction: 'Quarantine the attempted effect and reconcile it read-only from its authoritative source.',
    };
  }
  if (!['NONE', 'APPLIED', 'PARTIAL'].includes(effectState)) {
    return {
      outcome: 'BLOCKED_EFFECT_REASSESS',
      resumable: true,
      terminal: false,
      retryAllowed: false,
      consumesImplementationRepair: false,
      nextAction: 'Establish the prior operation effect state before selecting a repair route.',
    };
  }
  if (failureClass === 'IDENTICAL_SEMANTIC_NO_PROGRESS_AT_CAP') {
    return {
      outcome: 'YIELD_REASSESS', resumable: true, terminal: false,
      retryAllowed: false, consumesImplementationRepair: false,
      nextAction: 'Preserve the task and prior evidence; reassess with material new evidence before resuming.',
    };
  }
  if (failureClass === 'KNOWN_TRANSIENT_TOOL_ERROR') {
    const bounded = Number.isSafeInteger(remainingToolRetries) && remainingToolRetries > 0;
    const safe = idempotent === true || (effectState === 'NONE' && provenNoEffect === true);
    const allowed = sameInput === true && safe && bounded;
    return {
      outcome: allowed ? 'BOUNDED_TOOL_RETRY' : 'YIELD_REASSESS',
      resumable: true, terminal: false, retryAllowed: allowed,
      consumesImplementationRepair: false,
      nextAction: allowed
        ? 'Root records one retry against the active cycle budget before repeating the same operation and input.'
        : 'Reassess the task; establish same-input safety and remaining retry capacity before a tool retry.',
    };
  }
  if (failureClass === 'METADATA_DEFECT' || failureClass === 'METADATA_ERROR') {
    if (effectState !== 'NONE') {
      return {
        outcome: 'BLOCKED_EFFECT_REASSESS',
        resumable: true,
        terminal: false,
        retryAllowed: false,
        consumesImplementationRepair: false,
        nextAction: 'Reconcile the prior effect first; metadata repair is free only after no product effect is established.',
      };
    }
    if (!Number.isSafeInteger(noProgressCap) || noProgressCap < 1) throw new TypeError('A positive policy no-progress cap is required.');
    const current = semanticMetadata(metadata);
    const occurrences = 1 + priorMetadata.filter((previous) => isDeepStrictEqual(semanticMetadata(previous), current)).length;
    if (occurrences >= noProgressCap) {
      return {
        outcome: 'YIELD_REASSESS',
        resumable: true,
        terminal: false,
        retryAllowed: false,
        consumesImplementationRepair: false,
        identicalMetadataOccurrences: occurrences,
        noProgressCap,
        nextAction: 'Yield this task for reassessment; resume the same task only after corrected metadata or new evidence arrives.',
      };
    }
    return {
      outcome: 'METADATA_REPAIR',
      preflightStatus: 'REPAIR_METADATA',
      resumable: true,
      terminal: false,
      retryAllowed: false,
      consumesImplementationRepair: false,
      identicalMetadataOccurrences: occurrences,
      noProgressCap,
      nextAction: 'Correct task metadata and rerun automatic preflight; no implementation repair capacity is consumed.',
    };
  }
  if (failureClass === 'IMPLEMENTATION_FAILURE' || failureClass === 'IMPLEMENTATION_DEFECT') {
    return {
      outcome: 'ACCEPTANCE_REPAIR',
      resumable: true,
      terminal: false,
      retryAllowed: false,
      consumesImplementationRepair: true,
      nextAction: 'Repair the implementation within its separate acceptance repair budget and repeat affected evidence.',
    };
  }
  if (failureClass === 'EXTERNAL_BLOCKER') {
    return {
      outcome: 'BLOCKED_EXTERNAL',
      resumable: true,
      terminal: false,
      retryAllowed: false,
      consumesImplementationRepair: false,
      nextAction: 'Resume the same task when the named external capability or decision becomes available.',
    };
  }
  return {
    outcome: 'BLOCKED_UNCLASSIFIED',
    resumable: true,
    terminal: false,
    retryAllowed: false,
    consumesImplementationRepair: false,
    nextAction: 'Keep the task blocked and resumable while Sol triages the failure evidence.',
  };
}

export function preflightTask({ taskFile, repo = REPOSITORY, base = 'origin/main', includeChanged = false } = {}) {
  const issues = [];
  if (!text(taskFile)) return emptyResult('REPAIR_METADATA', [{ status: 'REPAIR_METADATA', code: 'TASK_FILE_REQUIRED', message: 'A task file path is required.' }]);

  let repoRoot;
  let commonDir;
  try {
    const suppliedRepo = realpathSync.native(path.resolve(repo));
    repoRoot = realpathSync.native(git(suppliedRepo, ['rev-parse', '--show-toplevel']));
    commonDir = realpathSync.native(git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  } catch (error) {
    return emptyResult('BLOCKED_ENVIRONMENT', [{ status: 'BLOCKED_ENVIRONMENT', code: 'REPOSITORY_UNAVAILABLE', message: error.message }]);
  }

  const source = taskFilePath(repoRoot, commonDir, taskFile);
  if (!source.ok) {
    const status = source.missing ? 'REPAIR_METADATA' : source.reason.includes('escapes') ? 'BLOCKED_SCOPE' : 'BLOCKED_ENVIRONMENT';
    return emptyResult(status, [{ status, code: status === 'REPAIR_METADATA' ? 'TASK_FILE_MISSING' : status === 'BLOCKED_SCOPE' ? 'TASK_FILE_ESCAPE' : 'TASK_FILE_UNAVAILABLE', message: source.reason }]);
  }

  let task;
  try { task = JSON.parse(readFileSync(source.path, 'utf8')); } catch (error) {
    const status = error instanceof SyntaxError ? 'REPAIR_METADATA' : 'BLOCKED_ENVIRONMENT';
    return emptyResult(status, [{ status, code: status === 'REPAIR_METADATA' ? 'TASK_METADATA_JSON_INVALID' : 'TASK_FILE_UNAVAILABLE', message: error.message }]);
  }

  const shapeIssues = validateTaskShape(task);
  if (shapeIssues.length) {
    return emptyResult(issueStatus(shapeIssues), shapeIssues, record(task) && text(task.taskId) ? task.taskId : null);
  }

  validatePathBindings(task, repoRoot, issues);
  if (issues.some((item) => item.status === 'BLOCKED_SCOPE')) return emptyResult('BLOCKED_SCOPE', issues, task.taskId);

  let noProgressCap = null;
  try { noProgressCap = policyNoProgressCap(repoRoot); } catch (error) {
    addIssue(issues, 'BLOCKED_ENVIRONMENT', 'ACTIVE_POLICY_UNAVAILABLE', error.message, POLICY_RELATIVE);
  }

  let baseCommit;
  let headCommit;
  let branch;
  try {
    baseCommit = resolveCommit(repoRoot, base);
    headCommit = git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
    branch = git(repoRoot, ['branch', '--show-current']);
  } catch (error) {
    addIssue(issues, 'BLOCKED_ENVIRONMENT', 'BASELINE_UNAVAILABLE', 'Unable to resolve repository base, head, or branch: ' + error.message);
    return emptyResult('BLOCKED_ENVIRONMENT', issues, task.taskId);
  }

  if (!branch) addIssue(issues, 'BLOCKED_ENVIRONMENT', 'BRANCH_UNAVAILABLE', 'A named working branch is required for preflight.');
  else if (branch.toLowerCase() === 'main') addIssue(issues, 'BLOCKED_SCOPE', 'MAIN_BRANCH_DISPATCH_BLOCKED', 'Preflight cannot mark a task ready on the main branch.');
  try {
    if (!ancestor(repoRoot, baseCommit, headCommit)) {
      addIssue(issues, 'BLOCKED_SCOPE', 'BASE_NOT_ANCESTOR', 'Selected base is not an ancestor of the current head.');
    }
  } catch (error) {
    addIssue(issues, 'BLOCKED_ENVIRONMENT', 'BASE_ANCESTRY_UNAVAILABLE', error.message);
  }

  let dirtyPaths = [];
  let committedChangedPaths = [];
  let dirty = false;
  try {
    const porcelain = git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    dirty = porcelain.length > 0;
    dirtyPaths = statusPaths(porcelain);
    const diff = git(repoRoot, ['diff', '--name-only', '--no-renames', '-z', baseCommit, headCommit]);
    committedChangedPaths = diff.split('\0').filter(Boolean);
  } catch (error) {
    addIssue(issues, 'BLOCKED_ENVIRONMENT', 'WORKTREE_STATUS_UNAVAILABLE', error.message);
  }

  const changedPaths = [...new Set([...committedChangedPaths, ...dirtyPaths])].sort();
  for (const changed of changedPaths) {
    const checked = checkedRepoPath(repoRoot, changed);
    if (!checked.ok) {
      addIssue(issues, 'BLOCKED_SCOPE', 'CHANGED_PATH_ESCAPE', checked.reason, changed);
      continue;
    }
    if (!task.writeScope.some((scope) => scopeContains(repoRoot, scope, changed))) {
      addIssue(issues, 'BLOCKED_SCOPE', 'CHANGE_OUTSIDE_WRITE_SCOPE', 'Changed path is outside the declared writeScope.', changed);
    }
  }

  const dependencies = inspectDependencies(task, repoRoot, baseCommit, issues);
  const status = issueStatus(issues);
  const checks = task.checks.map((check) => {
    const executable = findExecutable(check.executable, repoRoot);
    const cwd = checkedRepoPath(repoRoot, check.cwd, { allowDot: true, requireExisting: true });
    return {
      executable: check.executable,
      argv: check.argv,
      cwd: check.cwd,
      shell: false,
      capability: executable.ok && cwd.ok ? 'AVAILABLE' : 'UNAVAILABLE',
      ...(executable.ok ? { resolvedExecutable: executable.path } : {}),
    };
  });
  return {
    schemaVersion: 'task-preflight-result/v1',
    status,
    taskId: task.taskId,
    objective: task.objective,
    baseline: {
      base,
      baseRevision: baseCommit,
      headRevision: headCommit,
      branch,
      dirty,
      ...(includeChanged ? { changedPaths, committedChangedPaths, dirtyPaths } : {}),
    },
    dependencies,
    checks,
    issues,
    metadataRepair: {
      consumesImplementationRepair: false,
      noProgressCap,
      repeatedIdenticalMetadataOutcome: 'YIELD_REASSESS',
      resumable: true,
    },
    authorityGrant: false,
    mandateReference: task.mandateReference,
    mandateReferenceIsProvenanceOnly: true,
    dispatchAllowed: false,
    checksExecuted: false,
    stateWritePerformed: false,
  };
}

function parseArgs(argv) {
  const options = { base: 'origin/main', includeChanged: false, json: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--changed' || flag === '--json') {
      if (seen.has(flag)) throw new Error('Duplicate option ' + flag + '.');
      seen.add(flag);
      if (flag === '--changed') options.includeChanged = true;
      else options.json = true;
      continue;
    }
    if (!['--task-file', '--base', '--repo'].includes(flag)) throw new Error('Unknown option ' + flag + '.');
    if (seen.has(flag)) throw new Error('Duplicate option ' + flag + '.');
    seen.add(flag);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error('Option ' + flag + ' requires a value.');
    if (flag === '--task-file') options.taskFile = value;
    else if (flag === '--base') options.base = value;
    else options.repo = value;
  }
  if (!options.taskFile) throw new Error('Usage: node tools/delivery-control/preflight.mjs --task-file <file> [--base <git-ref>] [--changed] [--json] [--repo <path>]');
  return options;
}

function humanOutput(result) {
  const lines = [result.status + (result.taskId ? '  ' + result.taskId : '')];
  if (result.baseline) {
    lines.push('base ' + result.baseline.base + ' (' + result.baseline.baseRevision + ')');
    lines.push('head ' + result.baseline.headRevision + ' on ' + (result.baseline.branch || '(detached)') + (result.baseline.dirty ? ' [dirty]' : ' [clean]'));
  }
  for (const item of result.issues ?? []) lines.push('- ' + item.code + ': ' + item.message + (item.path ? ' [' + item.path + ']' : ''));
  lines.push('Authority grant: false; checks executed: false; state written: false.');
  return lines.join('\n') + '\n';
}

function runCli() {
  let options;
  let result;
  try {
    options = parseArgs(process.argv.slice(2));
    result = preflightTask(options);
  } catch (error) {
    const wantsJson = process.argv.includes('--json');
    result = emptyResult('REPAIR_METADATA', [{ status: 'REPAIR_METADATA', code: 'CLI_ARGUMENTS_INVALID', message: error.message }]);
    process.stdout.write(wantsJson ? JSON.stringify(result, null, 2) + '\n' : humanOutput(result));
    process.exitCode = 1;
    return;
  }
  process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : humanOutput(result));
  if (result.status !== 'READY') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli();

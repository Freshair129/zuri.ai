#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { preflightTask } from './preflight.mjs';
import { semanticTaskDigest } from './controller.mjs';
import { createControllerRunner, bindWorktree } from './controller-runner.mjs';
import { startControllerDashboard, startControllerLivenessHeartbeat } from './controller-dashboard.mjs';
import { readControllerEventProjection } from './worker-observability-reader.mjs';
import { startWorkerObservabilityPublisher, DEFAULT_WORKER_OBSERVABILITY_PUBLISH_INTERVAL_MS,
  MAX_WORKER_OBSERVABILITY_PUBLISH_INTERVAL_MS } from './worker-observability-publisher.mjs';

export function resolveWorkerObservabilityExportDirectory(repoRoot) {
  return path.resolve(repoRoot, 'apps', 'server', '.worker-observability.local');
}

export function resolveWorkerObservabilityPublishIntervalMs(configuredInterval) {
  if (!Number.isSafeInteger(configuredInterval) || configuredInterval < 1) {
    return DEFAULT_WORKER_OBSERVABILITY_PUBLISH_INTERVAL_MS;
  }
  return Math.min(configuredInterval, MAX_WORKER_OBSERVABILITY_PUBLISH_INTERVAL_MS);
}

export function startConfiguredWorkerObservabilityPublisher({
  repoRoot,
  config = {},
  startPublisher = startWorkerObservabilityPublisher,
  onError = () => {},
} = {}) {
  return startPublisher({
    repoRoot,
    exportDirectory: resolveWorkerObservabilityExportDirectory(repoRoot),
    intervalMs: resolveWorkerObservabilityPublishIntervalMs(config.workerObservabilityPublishIntervalMs),
    onError,
  });
}

const INTAKE_RECONCILIATION_SCHEMA = 'controller-intake-reconciliation/v1';
const MAX_REGISTRATION_ATTEMPTS = 3;
const REGISTRATION_RETRY_BACKOFF_MS = [1_000, 2_000];
const UNKNOWN_HOLD_PHASES = ['PRE_REGISTRATION_LOOKUP', 'POST_REGISTRATION_ATTEMPT'];
const UNKNOWN_HOLD_RESOLUTIONS = [
  'MATCHING_DURABLE_REGISTRATION',
  'AUTHORITATIVE_ABSENCE_PRE_REGISTRATION',
  'AUTHORITATIVE_ABSENCE_POST_REGISTRATION',
];

function normalizeSemantic(value) {
  if (Array.isArray(value)) return value.map(normalizeSemantic);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeSemantic(value[key])]));
  }
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function semanticDigest(value) {
  return digest(JSON.stringify(normalizeSemantic(value)));
}

function samePath(left, right) {
  return pathIdentity(left) === pathIdentity(right);
}

function pathIdentity(value) {
  let resolved = path.resolve(value);
  try { resolved = fs.realpathSync.native(resolved); } catch {}
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function stableBindingDigest(binding) {
  return semanticDigest({ taskId: binding.taskId, worktree: pathIdentity(binding.worktree),
    mandateDigest: semanticDigest(binding.trustedMandateBinding) });
}

function runMatchesStableIdentity(run, binding) {
  return Boolean(run
    && run.taskId === binding.taskId
    && run.trustedMandateBinding?.digest === semanticDigest(binding.trustedMandateBinding)
    && samePath(run.worktreeRoot, binding.worktree));
}

function runMatchesIdentity(run, binding, taskRecord) {
  return Boolean(run
    && run.taskId === binding.taskId
    && run.taskRecordDigest === semanticTaskDigest(taskRecord)
    && run.trustedMandateBinding?.digest === semanticDigest(binding.trustedMandateBinding)
    && samePath(run.worktreeRoot, binding.worktree));
}

function runMatchesRegistrationInput(run, binding, taskRecord, preflightResult) {
  if (!runMatchesIdentity(run, binding, taskRecord)) return false;
  const baseline = preflightResult?.baseline;
  return Boolean(baseline
    && run.branch === baseline.branch
    && run.baseCommit === baseline.baseRevision
    && run.initialHeadCommit === baseline.headRevision
    && JSON.stringify(normalizeSemantic(run.dependencies ?? []))
      === JSON.stringify(normalizeSemantic(preflightResult.dependencies ?? [])));
}

function isCanonicalUtcTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function inspectLockConflictSnapshot(controller, taskId, taskRecord) {
  const inspected = controller.inspectCycleAdmissionConflicts({ taskId, writeScope: taskRecord.writeScope });
  return normalizeSemantic({
    worktree: inspected.worktree ?? [],
    writeScope: inspected.writeScope ?? [],
    domain: inspected.domain ?? [],
  });
}

function hasLockConflicts(snapshot) {
  return ['worktree', 'writeScope', 'domain'].some((key) => Array.isArray(snapshot?.[key]) && snapshot[key].length > 0);
}

function pendingSticky(fingerprint, code, detail, recordedAt, phase, bindingDigest) {
  return { kind: 'sticky', hold: { fingerprint, code, detail, recordedAt,
    ...(phase ? { phase } : {}), ...(bindingDigest ? { bindingDigest } : {}) } };
}

function isCurrentUnknownHold(hold, fingerprint, bindingDigest) {
  return hold?.code === 'DURABLE_CONTROLLER_STATE_UNKNOWN'
    && hold.fingerprint === fingerprint
    && (hold.bindingDigest === undefined || hold.bindingDigest === bindingDigest)
    && (hold.phase === undefined || UNKNOWN_HOLD_PHASES.includes(hold.phase));
}

function resolveUnknownHold(file, taskId, expectedHold, resolution, resolvedAt, record) {
  let matched = false;
  const saved = updateReconciliation(file, taskId, (state) => {
    const hold = state.stickyHold;
    if (hold?.code !== expectedHold.code || hold.fingerprint !== expectedHold.fingerprint
        || hold.phase !== expectedHold.phase || hold.recordedAt !== expectedHold.recordedAt) return state;
    state.reconciledStickyHolds ??= [];
    state.reconciledStickyHolds.push({ hold: { ...hold }, resolution, resolvedAt });
    delete state.stickyHold;
    if (record) state.records[expectedHold.fingerprint] = record;
    matched = true;
    return state;
  });
  return saved && matched;
}

function persistPendingReconciliation(file, taskId, pending) {
  if (pending?.kind === 'sticky' && pending.hold) {
    return updateReconciliation(file, taskId, (state) => {
      state.stickyHold ??= pending.hold;
      return state;
    });
  }
  return false;
}

function reconciliationFile(controller, repoRoot, taskId) {
  let privateRoot;
  if (typeof controller.databasePath === 'string' && controller.databasePath.trim()) {
    privateRoot = path.dirname(path.resolve(controller.databasePath));
  } else {
    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: repoRoot, encoding: 'utf8', shell: false, windowsHide: true }).trim();
    privateRoot = path.join(fs.realpathSync(commonDir), 'zuri-delivery-control', 'controller-v1');
  }
  return path.join(privateRoot, 'admission-reconciliation', `${digest(taskId)}.json`);
}

function readReconciliation(file, taskId) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') return { state: { schemaVersion: INTAKE_RECONCILIATION_SCHEMA, taskId, records: {} } };
    return { error };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { error: new Error('ADMISSION_STATE_NOT_REGULAR_FILE') };
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state?.schemaVersion !== INTAKE_RECONCILIATION_SCHEMA || state.taskId !== taskId
        || !state.records || typeof state.records !== 'object' || Array.isArray(state.records)) {
      return { error: new Error('ADMISSION_STATE_SCHEMA_MISMATCH') };
    }
    for (const [fingerprint, record] of Object.entries(state.records)) {
      if (!/^[a-f0-9]{64}$/.test(fingerprint) || record?.fingerprint !== fingerprint
          || !['RETRY_WAIT', 'HOLD_RETRY_EXHAUSTED', 'HOLD_PREFLIGHT', 'HOLD_SCOPE_CONFLICT',
            'REGISTRATION_IN_FLIGHT', 'REGISTRATION_CONFIRMED'].includes(record.state)
          || (record.state === 'REGISTRATION_IN_FLIGHT'
            && (!Number.isSafeInteger(record.attempts) || record.attempts < 1
              || record.attempts > MAX_REGISTRATION_ATTEMPTS
              || typeof record.reservedAt !== 'string' || !Number.isFinite(Date.parse(record.reservedAt))))
          || (record.state === 'REGISTRATION_CONFIRMED'
            && (!Number.isSafeInteger(record.attempts) || record.attempts < 1
              || record.attempts > MAX_REGISTRATION_ATTEMPTS
              || typeof record.reservedAt !== 'string' || !Number.isFinite(Date.parse(record.reservedAt))
              || typeof record.confirmedAt !== 'string' || !Number.isFinite(Date.parse(record.confirmedAt))))
          || (record.state === 'RETRY_WAIT'
            && (!Number.isSafeInteger(record.attempts) || record.attempts < 1
              || record.attempts >= MAX_REGISTRATION_ATTEMPTS
              || !isCanonicalUtcTimestamp(record.retryAt)))
          || (record.state === 'HOLD_SCOPE_CONFLICT'
            && !['worktree', 'writeScope', 'domain'].every((key) => Array.isArray(record.conflictSnapshot?.[key])))) {
        return { error: new Error('ADMISSION_STATE_RECORD_MISMATCH') };
      }
    }
    if (state.stickyHold && (typeof state.stickyHold.code !== 'string'
        || !/^[a-f0-9]{64}$/.test(state.stickyHold.fingerprint ?? ''))) {
      return { error: new Error('ADMISSION_STATE_HOLD_MISMATCH') };
    }
    if (state.stickyHold?.bindingDigest !== undefined
        && !/^[a-f0-9]{64}$/.test(state.stickyHold.bindingDigest)) {
      return { error: new Error('ADMISSION_STATE_HOLD_BINDING_MISMATCH') };
    }
    if (state.stickyHold?.phase !== undefined && !UNKNOWN_HOLD_PHASES.includes(state.stickyHold.phase)) {
      return { error: new Error('ADMISSION_STATE_HOLD_PHASE_MISMATCH') };
    }
    if (state.reconciledStickyHolds !== undefined
        && (!Array.isArray(state.reconciledStickyHolds) || state.reconciledStickyHolds.some((entry) => (
          entry?.hold?.code !== 'DURABLE_CONTROLLER_STATE_UNKNOWN'
          || !/^[a-f0-9]{64}$/.test(entry.hold.fingerprint ?? '')
          || !UNKNOWN_HOLD_RESOLUTIONS.includes(entry.resolution)
          || !(UNKNOWN_HOLD_PHASES.includes(entry.hold.phase)
            || (entry.hold.phase === undefined && entry.resolution === 'MATCHING_DURABLE_REGISTRATION'))
          || typeof entry.resolvedAt !== 'string' || !Number.isFinite(Date.parse(entry.resolvedAt))
        )))) {
      return { error: new Error('ADMISSION_STATE_RECONCILIATION_MISMATCH') };
    }
    return { state };
  } catch (error) { return { error }; }
}

function writeReconciliation(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(state)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, file); }
  catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
}

function updateReconciliation(file, taskId, update) {
  const loaded = readReconciliation(file, taskId);
  if (loaded.error) return false;
  const state = update(loaded.state) ?? loaded.state;
  try { writeReconciliation(file, state); return true; }
  catch { return false; }
}

function confirmRegistrationReservation(file, taskId, reservation, confirmedAt) {
  let matchedReservation = false;
  const saved = updateReconciliation(file, taskId, (state) => {
    const current = state.records[reservation.fingerprint];
    if (current?.state !== 'REGISTRATION_IN_FLIGHT'
        || current.attempts !== reservation.attempts || current.reservedAt !== reservation.reservedAt) return state;
    state.records[reservation.fingerprint] = { ...current, state: 'REGISTRATION_CONFIRMED',
      code: 'REGISTRATION_ATTEMPT_CONFIRMED', confirmedAt };
    matchedReservation = true;
    return state;
  });
  return saved && matchedReservation;
}

function epochMs(now) {
  const value = typeof now === 'function' ? now() : Date.now();
  const result = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(result)) throw new TypeError('INTAKE_CLOCK_INVALID');
  return result;
}

function holdObservation(taskId, code, details = {}) {
  return { taskId, status: 'BLOCKED_FOR_REASSESSMENT', code, hold: true, ...details };
}

function observe(observations, observation, runner, cache, fingerprint, wakeForNewWorkerReadyRun = false, pending = null) {
  observations.push(observation);
  if (observation.hold) {
    runner?.hold(observation.taskId);
    if (fingerprint) cache.set(observation.taskId, { fingerprint, kind: 'hold', observation, ...(pending ? { pending } : {}) });
  } else if (observation.registrationConfirmed) {
    const priorIntakeHold = cache.get(observation.taskId)?.kind === 'hold';
    if (priorIntakeHold || wakeForNewWorkerReadyRun) runner?.wake(observation.taskId);
    cache.set(observation.taskId, { fingerprint, kind: 'confirmed' });
  }
}

export async function admitConfiguredTasks({ controller, repoRoot, config, cache = new Map(), runner, now = () => Date.now() }) {
  const observations = [];
  for (const binding of config.tasks) {
    let fingerprint;
    let file;
    try {
      const before = fs.readFileSync(binding.taskFile, 'utf8');
      const preflightResult = preflightTask({ repo: binding.worktree, taskFile: binding.taskFile, base: binding.base ?? 'origin/main' });
      file = reconciliationFile(controller, repoRoot, binding.taskId);
      fingerprint = digest(JSON.stringify([before, normalizeSemantic(preflightResult),
        binding.taskId, binding.worktree, normalizeSemantic(binding.trustedMandateBinding)]));
      let existing;
      try { existing = controller.getRun(binding.taskId); }
      catch {
        const detail = 'Durable controller state could not be read.';
        const pending = pendingSticky(fingerprint, 'DURABLE_CONTROLLER_STATE_UNKNOWN', detail,
          new Date(epochMs(now)).toISOString(), 'PRE_REGISTRATION_LOOKUP', stableBindingDigest(binding));
        const saved = updateReconciliation(file, binding.taskId, (state) => {
          state.stickyHold ??= pending.hold;
          return state;
        });
        observe(observations, holdObservation(binding.taskId, saved ? 'DURABLE_CONTROLLER_STATE_UNKNOWN' : 'ADMISSION_HOLD_PERSIST_FAILED', {
          fingerprint, reasonCode: saved ? undefined : 'DURABLE_CONTROLLER_STATE_UNKNOWN', detail,
        }), runner, cache, fingerprint, false, saved ? null : pending);
        continue;
      }

      const loaded = readReconciliation(file, binding.taskId);
      if (loaded.error) {
        observe(observations, holdObservation(binding.taskId, 'ADMISSION_RECONCILIATION_STATE_UNKNOWN', {
          fingerprint, detail: 'Durable admission state could not be verified.',
        }), runner, cache, fingerprint, false, cache.get(binding.taskId)?.pending ?? null);
        continue;
      }
      const stickyHold = loaded.state.stickyHold;
      const bindingDigest = stableBindingDigest(binding);
      const reconcilableUnknownHold = isCurrentUnknownHold(stickyHold, fingerprint, bindingDigest);
      const reconcilableStalePreRegistrationHold = stickyHold?.code === 'DURABLE_CONTROLLER_STATE_UNKNOWN'
        && stickyHold.phase === 'PRE_REGISTRATION_LOOKUP'
        && stickyHold.fingerprint !== fingerprint
        && stickyHold.bindingDigest === bindingDigest
        && (!existing || runMatchesStableIdentity(existing, binding));
      if (stickyHold && !reconcilableUnknownHold && !reconcilableStalePreRegistrationHold) {
        observe(observations, holdObservation(binding.taskId, stickyHold.code, {
          fingerprint: stickyHold.fingerprint, detail: stickyHold.detail,
        }), runner, cache, fingerprint);
        continue;
      }
      const currentTime = epochMs(now);

      let taskRecord;
      try { taskRecord = JSON.parse(before.replace(/^\uFEFF/, '')); }
      catch {
        const detail = 'Task record could not be parsed by intake.';
        const saved = updateReconciliation(file, binding.taskId, (state) => {
          state.records[fingerprint] = { fingerprint, state: 'HOLD_PREFLIGHT', attempts: 0, code: 'TASK_RECORD_INVALID', detail };
          return state;
        });
        observe(observations, holdObservation(binding.taskId, saved ? 'TASK_RECORD_INVALID' : 'ADMISSION_HOLD_PERSIST_FAILED', {
          fingerprint, reasonCode: saved ? undefined : 'TASK_RECORD_INVALID', detail,
        }), runner, cache, fingerprint);
        continue;
      }
      if (taskRecord.taskId !== binding.taskId) {
        const detail = 'Configured task ID does not match the durable task record.';
        const saved = updateReconciliation(file, binding.taskId, (state) => {
          state.records[fingerprint] = { fingerprint, state: 'HOLD_PREFLIGHT', attempts: 0, code: 'TASK_BINDING_MISMATCH', detail };
          return state;
        });
        observe(observations, holdObservation(binding.taskId, saved ? 'TASK_BINDING_MISMATCH' : 'ADMISSION_HOLD_PERSIST_FAILED', {
          fingerprint, reasonCode: saved ? undefined : 'TASK_BINDING_MISMATCH', detail,
        }), runner, cache, fingerprint);
        continue;
      }

      if (reconcilableUnknownHold || reconcilableStalePreRegistrationHold) {
        if (existing) {
          const matchesUnknownHold = reconcilableStalePreRegistrationHold
            ? runMatchesStableIdentity(existing, binding)
            : runMatchesRegistrationInput(existing, binding, taskRecord, preflightResult);
          if (!matchesUnknownHold) {
            observe(observations, holdObservation(binding.taskId, stickyHold.code, {
              fingerprint: stickyHold.fingerprint, detail: 'Durable state does not match the input bound to the unknown hold.',
            }), runner, cache, fingerprint);
            continue;
          }
          const saved = resolveUnknownHold(file, binding.taskId, stickyHold,
            'MATCHING_DURABLE_REGISTRATION', new Date(currentTime).toISOString());
          if (!saved) {
            observe(observations, holdObservation(binding.taskId, stickyHold.code, {
              fingerprint: stickyHold.fingerprint, detail: 'The matching durable registration was read, but the stale hold could not be durably reclassified.',
            }), runner, cache, fingerprint);
            continue;
          }
          delete loaded.state.stickyHold;
        } else if (stickyHold.phase === 'PRE_REGISTRATION_LOOKUP') {
          const saved = resolveUnknownHold(file, binding.taskId, stickyHold,
            'AUTHORITATIVE_ABSENCE_PRE_REGISTRATION', new Date(currentTime).toISOString());
          if (!saved) {
            observe(observations, holdObservation(binding.taskId, stickyHold.code, {
              fingerprint: stickyHold.fingerprint, detail: 'Durable absence was read, but the pre-registration hold could not be durably reclassified.',
            }), runner, cache, fingerprint);
            continue;
          }
          delete loaded.state.stickyHold;
        } else if (stickyHold.phase === 'POST_REGISTRATION_ATTEMPT') {
          const prior = loaded.state.records[fingerprint];
          const priorAttempts = prior?.attempts ?? 0;
          const hasReservation = prior?.state === 'REGISTRATION_IN_FLIGHT';
          const attempts = hasReservation ? priorAttempts : priorAttempts + 1;
          if (!Number.isSafeInteger(priorAttempts) || priorAttempts < 0
              || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > MAX_REGISTRATION_ATTEMPTS) {
            observe(observations, holdObservation(binding.taskId, stickyHold.code, {
              fingerprint: stickyHold.fingerprint, attempts: priorAttempts,
              detail: 'The prior registration attempt count is missing, invalid, or exhausted; the unknown hold remains active.',
            }), runner, cache, fingerprint);
            continue;
          }
          const exhausted = attempts >= MAX_REGISTRATION_ATTEMPTS;
          const retryAt = exhausted ? null : new Date(currentTime + REGISTRATION_RETRY_BACKOFF_MS[attempts - 1]).toISOString();
          const code = exhausted ? 'REGISTRATION_RETRY_EXHAUSTED' : 'REGISTRATION_RETRY_BACKOFF';
          const detail = exhausted
            ? 'An authoritative read found no durable registration after the bounded attempt cap.'
            : 'An authoritative read found no durable registration; retry is held until the backoff expires.';
          const record = { fingerprint, state: exhausted ? 'HOLD_RETRY_EXHAUSTED' : 'RETRY_WAIT',
            attempts, code, retryAt, failureCode: 'DURABLE_CONTROLLER_STATE_UNKNOWN', detail,
            updatedAt: new Date(currentTime).toISOString() };
          const saved = resolveUnknownHold(file, binding.taskId, stickyHold,
            'AUTHORITATIVE_ABSENCE_POST_REGISTRATION', new Date(currentTime).toISOString(), record);
          if (!saved) {
            observe(observations, holdObservation(binding.taskId, stickyHold.code, {
              fingerprint: stickyHold.fingerprint, attempts,
              detail: 'Durable absence was read, but the post-registration hold could not be durably reclassified.',
            }), runner, cache, fingerprint);
            continue;
          }
          observe(observations, holdObservation(binding.taskId, code, {
            fingerprint, attempts, retryAt, detail,
          }), runner, cache, fingerprint);
          continue;
        } else {
          observe(observations, holdObservation(binding.taskId, stickyHold.code, {
            fingerprint: stickyHold.fingerprint,
            detail: 'A legacy unknown hold has no phase and no matching durable registration; it remains held.',
          }), runner, cache, fingerprint);
          continue;
        }
      }

      const inFlightReservations = Object.entries(loaded.state.records)
        .filter(([, record]) => record.state === 'REGISTRATION_IN_FLIGHT');
      if (inFlightReservations.length > 0) {
        const [reservedFingerprint, reservation] = inFlightReservations[0];
        if (inFlightReservations.length !== 1 || reservedFingerprint !== fingerprint) {
          observe(observations, holdObservation(binding.taskId, 'DURABLE_REGISTRATION_MISMATCH', {
            fingerprint: reservedFingerprint,
            detail: 'A durable registration reservation is bound to a different task input and remains held.',
          }), runner, cache, fingerprint);
          continue;
        }
        if (existing) {
          if (!runMatchesRegistrationInput(existing, binding, taskRecord, preflightResult)) {
            const detail = 'The durable run does not match the input bound to the in-flight registration reservation.';
            const pending = pendingSticky(fingerprint, 'DURABLE_REGISTRATION_MISMATCH', detail,
              new Date(currentTime).toISOString());
            const saved = updateReconciliation(file, binding.taskId, (state) => {
              state.stickyHold ??= pending.hold;
              return state;
            });
            observe(observations, holdObservation(binding.taskId, saved ? pending.hold.code : 'ADMISSION_HOLD_PERSIST_FAILED', {
              fingerprint, reasonCode: saved ? undefined : pending.hold.code, detail,
            }), runner, cache, fingerprint);
            continue;
          }
          const confirmed = confirmRegistrationReservation(file, binding.taskId, reservation,
            new Date(currentTime).toISOString());
          if (!confirmed) {
            observe(observations, holdObservation(binding.taskId, 'ADMISSION_HOLD_PERSIST_FAILED', {
              fingerprint, attempts: reservation.attempts,
              detail: 'The matching durable registration was read, but its attempt reservation could not be durably reconciled.',
            }), runner, cache, fingerprint);
            continue;
          }
        } else {
          const attempts = reservation.attempts;
          const exhausted = attempts >= MAX_REGISTRATION_ATTEMPTS;
          const retryAt = exhausted ? null : new Date(currentTime + REGISTRATION_RETRY_BACKOFF_MS[attempts - 1]).toISOString();
          const code = exhausted ? 'REGISTRATION_RETRY_EXHAUSTED' : 'REGISTRATION_RETRY_BACKOFF';
          const detail = exhausted
            ? 'An authoritative read found no durable registration after the bounded attempt cap.'
            : 'An authoritative read found no durable registration; retry is held until the backoff expires.';
          const record = { fingerprint, state: exhausted ? 'HOLD_RETRY_EXHAUSTED' : 'RETRY_WAIT',
            attempts, code, retryAt, failureCode: 'REGISTRATION_ATTEMPT_RECOVERED_ABSENT', detail,
            updatedAt: new Date(currentTime).toISOString() };
          let matchedReservation = false;
          const saved = updateReconciliation(file, binding.taskId, (state) => {
            const current = state.records[fingerprint];
            if (current?.state !== 'REGISTRATION_IN_FLIGHT'
                || current.attempts !== reservation.attempts || current.reservedAt !== reservation.reservedAt) return state;
            state.records[fingerprint] = record;
            matchedReservation = true;
            return state;
          });
          if (!saved || !matchedReservation) {
            observe(observations, holdObservation(binding.taskId, saved
              ? 'ADMISSION_RECONCILIATION_STATE_UNKNOWN' : 'ADMISSION_HOLD_PERSIST_FAILED', {
              fingerprint, attempts,
              detail: 'The in-flight registration reservation could not be durably reconciled after authoritative absence.',
            }), runner, cache, fingerprint);
            continue;
          }
          observe(observations, holdObservation(binding.taskId, code, {
            fingerprint, attempts, retryAt, detail,
          }), runner, cache, fingerprint);
          continue;
        }
      }

      if (existing && !runMatchesIdentity(existing, binding, taskRecord)) {
        const detail = 'Durable task state does not match the configured task, worktree, or trusted mandate.';
        const pending = pendingSticky(fingerprint, 'DURABLE_REGISTRATION_MISMATCH', detail, new Date(currentTime).toISOString());
        const saved = updateReconciliation(file, binding.taskId, (state) => {
          state.stickyHold ??= pending.hold;
          return state;
        });
        observe(observations, holdObservation(binding.taskId, saved ? 'DURABLE_REGISTRATION_MISMATCH' : 'ADMISSION_HOLD_PERSIST_FAILED', {
          fingerprint, reasonCode: saved ? undefined : 'DURABLE_REGISTRATION_MISMATCH', detail,
        }), runner, cache, fingerprint, false, saved ? null : pending);
        continue;
      }
      const matchesRegistrationInput = existing && runMatchesRegistrationInput(existing, binding, taskRecord, preflightResult);
      if (existing?.currentCycle > 0) {
        observe(observations, { ...existing, registrationConfirmed: true, code: 'DURABLE_REGISTRATION_CONFIRMED' }, runner, cache, fingerprint);
        continue;
      }
      if (matchesRegistrationInput && existing.state !== 'BLOCKED_SCOPE') {
        observe(observations, { ...existing, registrationConfirmed: true, code: 'DURABLE_REGISTRATION_CONFIRMED' }, runner, cache, fingerprint);
        continue;
      }
      if (matchesRegistrationInput && existing.state === 'BLOCKED_SCOPE') {
        let conflictSnapshot;
        try { conflictSnapshot = inspectLockConflictSnapshot(controller, binding.taskId, taskRecord); }
        catch {
          const detail = 'Durable resource-lock state could not be inspected.';
          const pending = pendingSticky(fingerprint, 'DURABLE_LOCK_STATE_UNKNOWN', detail, new Date(currentTime).toISOString());
          const saved = updateReconciliation(file, binding.taskId, (state) => {
            state.stickyHold ??= pending.hold;
            return state;
          });
          observe(observations, holdObservation(binding.taskId, saved ? pending.hold.code : 'ADMISSION_HOLD_PERSIST_FAILED', {
            fingerprint, reasonCode: saved ? undefined : pending.hold.code, detail,
          }), runner, cache, fingerprint, false, saved ? null : pending);
          continue;
        }
        const priorScope = loaded.state.records[fingerprint];
        const hasPriorScope = priorScope?.state === 'HOLD_SCOPE_CONFLICT';
        const sameSnapshot = hasPriorScope
          && JSON.stringify(priorScope.conflictSnapshot) === JSON.stringify(conflictSnapshot);
        if (hasLockConflicts(conflictSnapshot) && (!hasPriorScope || sameSnapshot)) {
          const record = { fingerprint, state: 'HOLD_SCOPE_CONFLICT', attempts: priorScope?.attempts ?? 0,
            code: 'DURABLE_SCOPE_LOCK_BLOCKED', conflictSnapshot,
            detail: 'Registration remains blocked by the same durable resource-lock conflict.',
            updatedAt: new Date(currentTime).toISOString() };
          const saved = sameSnapshot || updateReconciliation(file, binding.taskId, (state) => {
            state.records[fingerprint] = record;
            return state;
          });
          observe(observations, holdObservation(binding.taskId, saved ? record.code : 'ADMISSION_HOLD_PERSIST_FAILED', {
            fingerprint, reasonCode: saved ? undefined : record.code, conflictSnapshot, detail: record.detail,
          }), runner, cache, fingerprint);
          continue;
        }
        if (hasPriorScope && sameSnapshot && !hasLockConflicts(conflictSnapshot)) {
          const detail = 'Durable task state remains scope-blocked without a matching resource-lock conflict.';
          const pending = pendingSticky(fingerprint, 'DURABLE_SCOPE_BLOCK_REASON_UNKNOWN', detail, new Date(currentTime).toISOString());
          const saved = updateReconciliation(file, binding.taskId, (state) => {
            state.stickyHold ??= pending.hold;
            return state;
          });
          observe(observations, holdObservation(binding.taskId, saved ? pending.hold.code : 'ADMISSION_HOLD_PERSIST_FAILED', {
            fingerprint, reasonCode: saved ? undefined : pending.hold.code, detail,
          }), runner, cache, fingerprint, false, saved ? null : pending);
          continue;
        }
      }

      const pending = cache.get(binding.taskId)?.pending;
      if (pending?.kind === 'sticky') {
        const saved = persistPendingReconciliation(file, binding.taskId, pending);
        observe(observations, holdObservation(binding.taskId, saved ? pending.hold.code : 'ADMISSION_HOLD_PERSIST_FAILED', {
          fingerprint: pending.hold.fingerprint, reasonCode: saved ? undefined : pending.hold.code,
          detail: pending.hold.detail,
        }), runner, cache, fingerprint, false, saved ? null : pending);
        continue;
      }
      const prior = loaded.state.records[fingerprint];
      const confirmedReservation = Object.values(loaded.state.records)
        .find((record) => record.state === 'REGISTRATION_CONFIRMED');
      if (confirmedReservation && !existing) {
        observe(observations, holdObservation(binding.taskId, 'DURABLE_REGISTRATION_STATE_UNKNOWN', {
          fingerprint: confirmedReservation.fingerprint, attempts: confirmedReservation.attempts,
          detail: 'A prior registration was durably confirmed, but its controller run is now absent; the task remains held.',
        }), runner, cache, fingerprint);
        continue;
      }
      if (prior?.state === 'HOLD_RETRY_EXHAUSTED' || prior?.state === 'HOLD_PREFLIGHT') {
        observe(observations, holdObservation(binding.taskId, prior.code, {
          fingerprint, attempts: prior.attempts ?? 0, retryAt: prior.retryAt ?? null, detail: prior.detail,
        }), runner, cache, fingerprint);
        continue;
      }
      if (prior?.state === 'RETRY_WAIT' && Date.parse(prior.retryAt) > currentTime) {
        observe(observations, holdObservation(binding.taskId, 'REGISTRATION_RETRY_BACKOFF', {
          fingerprint, attempts: prior.attempts, retryAt: prior.retryAt,
        }), runner, cache, fingerprint);
        continue;
      }
      if (!['READY', 'BLOCKED_DEPENDENCY'].includes(preflightResult.status)) {
        const detail = `Automatic preflight returned ${preflightResult.status ?? 'an unknown status'}.`;
        const saved = updateReconciliation(file, binding.taskId, (state) => {
          state.records[fingerprint] = { fingerprint, state: 'HOLD_PREFLIGHT', attempts: 0, code: 'AUTOMATIC_PREFLIGHT_BLOCKED', detail };
          return state;
        });
        const observation = saved
          ? { ...preflightResult, hold: true, code: 'AUTOMATIC_PREFLIGHT_BLOCKED', fingerprint }
          : holdObservation(binding.taskId, 'ADMISSION_HOLD_PERSIST_FAILED', { fingerprint, reasonCode: 'AUTOMATIC_PREFLIGHT_BLOCKED' });
        observe(observations, observation, runner, cache, fingerprint);
        continue;
      }
      if (fs.readFileSync(binding.taskFile, 'utf8') !== before) {
        const detail = 'Task binding changed after preflight and before controller registration.';
        const saved = updateReconciliation(file, binding.taskId, (state) => {
          state.records[fingerprint] = { fingerprint, state: 'HOLD_PREFLIGHT', attempts: 0, code: 'TASK_BINDING_CHANGED', detail };
          return state;
        });
        observe(observations, holdObservation(binding.taskId, saved ? 'TASK_BINDING_CHANGED' : 'ADMISSION_HOLD_PERSIST_FAILED', {
          fingerprint, reasonCode: saved ? undefined : 'TASK_BINDING_CHANGED', detail,
        }), runner, cache, fingerprint);
        continue;
      }
      try { bindWorktree({ repoRoot, worktree: binding.worktree, branch: preflightResult.baseline.branch }); }
      catch {
        const detail = 'Configured worktree could not be verified for registration.';
        const saved = updateReconciliation(file, binding.taskId, (state) => {
          state.records[fingerprint] = { fingerprint, state: 'HOLD_PREFLIGHT', attempts: 0, code: 'WORKTREE_BINDING_INVALID', detail };
          return state;
        });
        observe(observations, holdObservation(binding.taskId, saved ? 'WORKTREE_BINDING_INVALID' : 'ADMISSION_HOLD_PERSIST_FAILED', {
          fingerprint, reasonCode: saved ? undefined : 'WORKTREE_BINDING_INVALID', detail,
        }), runner, cache, fingerprint);
        continue;
      }
      const priorAttempts = prior?.attempts ?? 0;
      const attempts = priorAttempts + 1;
      if (!Number.isSafeInteger(priorAttempts) || priorAttempts < 0
          || !Number.isSafeInteger(attempts) || attempts > MAX_REGISTRATION_ATTEMPTS) {
        observe(observations, holdObservation(binding.taskId, 'ADMISSION_RECONCILIATION_STATE_UNKNOWN', {
          fingerprint, attempts: priorAttempts,
          detail: 'The prior registration attempt count is missing, invalid, or exhausted; registration remains held.',
        }), runner, cache, fingerprint);
        continue;
      }
      const reservation = { fingerprint, state: 'REGISTRATION_IN_FLIGHT', attempts,
        code: 'REGISTRATION_ATTEMPT_RESERVED', reservedAt: new Date(currentTime).toISOString() };
      let reservationInstalled = false;
      const reservationSaved = updateReconciliation(file, binding.taskId, (state) => {
        const current = state.records[fingerprint];
        if (JSON.stringify(current ?? null) !== JSON.stringify(prior ?? null)) return state;
        state.records[fingerprint] = reservation;
        reservationInstalled = true;
        return state;
      });
      if (!reservationSaved || !reservationInstalled) {
        observe(observations, holdObservation(binding.taskId, reservationSaved
          ? 'ADMISSION_RECONCILIATION_STATE_UNKNOWN' : 'ADMISSION_HOLD_PERSIST_FAILED', {
          fingerprint, attempts,
          detail: 'A registration attempt could not be durably reserved; the controller was not called.',
        }), runner, cache, fingerprint);
        continue;
      }
      try {
        const registered = await controller.registerTask({ taskRecord, preflightResult, worktreeRoot: binding.worktree,
          trustedMandateBinding: binding.trustedMandateBinding });
        if (!runMatchesRegistrationInput(registered, binding, taskRecord, preflightResult)) {
          const detail = 'Controller returned durable state that does not match the attempted registration input.';
          const pending = pendingSticky(fingerprint, 'DURABLE_REGISTRATION_MISMATCH', detail, new Date(currentTime).toISOString());
          const saved = updateReconciliation(file, binding.taskId, (state) => {
            state.stickyHold ??= pending.hold;
            return state;
          });
          observe(observations, holdObservation(binding.taskId, saved ? 'DURABLE_REGISTRATION_MISMATCH' : 'ADMISSION_HOLD_PERSIST_FAILED', {
            fingerprint, reasonCode: saved ? undefined : 'DURABLE_REGISTRATION_MISMATCH', detail,
          }), runner, cache, fingerprint, false, saved ? null : pending);
          continue;
        }
        const confirmed = confirmRegistrationReservation(file, binding.taskId, reservation,
          new Date(currentTime).toISOString());
        if (!confirmed) {
          observe(observations, holdObservation(binding.taskId, 'ADMISSION_HOLD_PERSIST_FAILED', {
            fingerprint, attempts: reservation.attempts,
            detail: 'The controller returned a matching registration, but its attempt reservation could not be durably reconciled.',
          }), runner, cache, fingerprint);
          continue;
        }
        if (registered.state === 'BLOCKED_SCOPE' && registered.currentCycle === 0) {
          let conflictSnapshot;
          try { conflictSnapshot = inspectLockConflictSnapshot(controller, binding.taskId, taskRecord); }
          catch {
            const detail = 'Durable resource-lock state could not be inspected after registration.';
            const pending = pendingSticky(fingerprint, 'DURABLE_LOCK_STATE_UNKNOWN', detail, new Date(currentTime).toISOString());
            const saved = updateReconciliation(file, binding.taskId, (state) => {
              state.stickyHold ??= pending.hold;
              return state;
            });
            observe(observations, holdObservation(binding.taskId, saved ? pending.hold.code : 'ADMISSION_HOLD_PERSIST_FAILED', {
              fingerprint, reasonCode: saved ? undefined : pending.hold.code, detail,
            }), runner, cache, fingerprint, false, saved ? null : pending);
            continue;
          }
          if (!hasLockConflicts(conflictSnapshot)) {
            const detail = 'Controller returned a scope-blocked registration without a matching durable resource-lock conflict.';
            const pending = pendingSticky(fingerprint, 'DURABLE_SCOPE_BLOCK_REASON_UNKNOWN', detail, new Date(currentTime).toISOString());
            const saved = updateReconciliation(file, binding.taskId, (state) => {
              state.stickyHold ??= pending.hold;
              return state;
            });
            observe(observations, holdObservation(binding.taskId, saved ? pending.hold.code : 'ADMISSION_HOLD_PERSIST_FAILED', {
              fingerprint, reasonCode: saved ? undefined : pending.hold.code, detail,
            }), runner, cache, fingerprint, false, saved ? null : pending);
            continue;
          }
          const record = { fingerprint, state: 'HOLD_SCOPE_CONFLICT', attempts: reservation.attempts,
            code: 'DURABLE_SCOPE_LOCK_BLOCKED', conflictSnapshot,
            detail: 'Registration is blocked by a durable resource-lock conflict.',
            updatedAt: new Date(currentTime).toISOString() };
          const saved = updateReconciliation(file, binding.taskId, (state) => {
            state.records[fingerprint] = record;
            return state;
          });
          observe(observations, holdObservation(binding.taskId, saved ? record.code : 'ADMISSION_HOLD_PERSIST_FAILED', {
            fingerprint, reasonCode: saved ? undefined : record.code, conflictSnapshot, detail: record.detail,
          }), runner, cache, fingerprint);
          continue;
        }
        observe(observations, { ...registered, registrationConfirmed: true, code: 'TASK_REGISTRATION_CONFIRMED' }, runner, cache, fingerprint,
          registered.state === 'WORKER_READY' && (!existing || existing.state !== 'WORKER_READY'));
      } catch (error) {
        let durable;
        try { durable = controller.getRun(binding.taskId); }
        catch {
          const detail = 'Registration failed and durable controller state could not be reconciled.';
          const pending = pendingSticky(fingerprint, 'DURABLE_CONTROLLER_STATE_UNKNOWN', detail,
            new Date(currentTime).toISOString(), 'POST_REGISTRATION_ATTEMPT', stableBindingDigest(binding));
          const saved = updateReconciliation(file, binding.taskId, (state) => {
            state.stickyHold ??= pending.hold;
            return state;
          });
          observe(observations, holdObservation(binding.taskId, saved ? 'DURABLE_CONTROLLER_STATE_UNKNOWN' : 'ADMISSION_HOLD_PERSIST_FAILED', {
            fingerprint, reasonCode: saved ? undefined : 'DURABLE_CONTROLLER_STATE_UNKNOWN', detail,
          }), runner, cache, fingerprint, false, saved ? null : pending);
          continue;
        }
        if (durable) {
          if (runMatchesRegistrationInput(durable, binding, taskRecord, preflightResult)) {
            const confirmed = confirmRegistrationReservation(file, binding.taskId, reservation,
              new Date(currentTime).toISOString());
            if (confirmed) {
              observe(observations, { ...durable, registrationConfirmed: true, code: 'DURABLE_REGISTRATION_RECONCILED' }, runner, cache, fingerprint,
                durable.state === 'WORKER_READY' && (!existing || existing.state !== 'WORKER_READY'));
            } else {
              observe(observations, holdObservation(binding.taskId, 'ADMISSION_HOLD_PERSIST_FAILED', {
                fingerprint, attempts: reservation.attempts,
                detail: 'The matching durable registration was read, but its attempt reservation could not be durably reconciled.',
              }), runner, cache, fingerprint);
            }
          } else {
            const detail = 'Registration failed and the durable task state does not match the attempted input.';
            const pending = pendingSticky(fingerprint, 'DURABLE_REGISTRATION_MISMATCH', detail, new Date(currentTime).toISOString());
            const saved = updateReconciliation(file, binding.taskId, (state) => {
              state.stickyHold ??= pending.hold;
              return state;
            });
            observe(observations, holdObservation(binding.taskId, saved ? 'DURABLE_REGISTRATION_MISMATCH' : 'ADMISSION_HOLD_PERSIST_FAILED', {
              fingerprint, reasonCode: saved ? undefined : 'DURABLE_REGISTRATION_MISMATCH',
              failureCode: String(error?.code ?? 'REGISTRATION_ERROR'), detail,
            }), runner, cache, fingerprint, false, saved ? null : pending);
          }
          continue;
        }
        const attempts = reservation.attempts;
        const exhausted = attempts >= MAX_REGISTRATION_ATTEMPTS;
        const retryAt = exhausted ? null : new Date(currentTime + REGISTRATION_RETRY_BACKOFF_MS[attempts - 1]).toISOString();
        const code = exhausted ? 'REGISTRATION_RETRY_EXHAUSTED' : 'REGISTRATION_RETRY_BACKOFF';
        const detail = exhausted
          ? 'No-effect registration attempts reached the bounded retry cap.'
          : 'Registration had no durable effect; retry is held until the backoff expires.';
        const record = { fingerprint, state: exhausted ? 'HOLD_RETRY_EXHAUSTED' : 'RETRY_WAIT',
          attempts, code, retryAt, failureCode: String(error?.code ?? 'REGISTRATION_ERROR'), detail,
          updatedAt: new Date(currentTime).toISOString() };
        const saved = updateReconciliation(file, binding.taskId, (state) => {
          state.records[fingerprint] = record;
          return state;
        });
        observe(observations, holdObservation(binding.taskId, saved ? code : 'ADMISSION_HOLD_PERSIST_FAILED', {
          fingerprint, reasonCode: saved ? undefined : code, attempts, retryAt, detail,
        }), runner, cache, fingerprint);
      }
    } catch {
      const detail = 'Intake could not verify the configured task and controller state.';
      const pending = fingerprint ? pendingSticky(fingerprint, 'INTAKE_RECONCILIATION_REQUIRED', detail, new Date().toISOString()) : null;
      const saved = fingerprint && file ? updateReconciliation(file, binding.taskId, (state) => {
        state.stickyHold ??= pending.hold;
        return state;
      }) : false;
      observe(observations, holdObservation(binding.taskId, saved ? 'INTAKE_RECONCILIATION_REQUIRED' : 'ADMISSION_HOLD_PERSIST_FAILED', {
        ...(fingerprint ? { fingerprint } : {}), reasonCode: saved ? undefined : 'INTAKE_RECONCILIATION_REQUIRED', detail,
      }), runner, cache, fingerprint, false, saved || !pending ? null : pending);
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
  let observabilityPublisher;
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
      observabilityPublisher = startConfiguredWorkerObservabilityPublisher({
        repoRoot,
        config,
        onError: () => process.stderr.write('WORKER_OBSERVABILITY_EXPORT_FAILED\n'),
      });
      dashboard = await startControllerDashboard({ port: config.dashboardPort ?? 4190,
        readRuns: async () => (await controller.listRuns()).map((run) => ({ ...run, status: run.state, nodes: run.stages })),
        readEvents: async () => readControllerEventProjection({ repoRoot }) });
      liveness = startControllerLivenessHeartbeat({ stateRoot });
      print({ code: 'DASHBOARD_LISTENING', url: `http://127.0.0.1:${dashboard.address().port}`, processId: process.pid });
    }
    while (!stopping) {
      for (const observation of await admitConfiguredTasks({ controller, repoRoot, config, cache: intakeCache, runner })) {
        print({ code: 'INTAKE_OBSERVED', taskId: observation.taskId, state: observation.state ?? observation.status,
          intakeCode: observation.code ?? null, ...(observation.hold ? { hold: true, attempts: observation.attempts ?? null,
            retryAt: observation.retryAt ?? null, fingerprint: observation.fingerprint ?? null } : {}) });
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
    observabilityPublisher?.stop();
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

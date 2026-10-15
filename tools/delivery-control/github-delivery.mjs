import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { closeSync, constants as fsConstants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export const GITHUB_DELIVERY_SCHEMA = 'github-delivery-campaign/v1';
export const GITHUB_DELIVERY_RECEIPT_SCHEMA = 'github-delivery-receipt/v1';

const REQUIRED_EFFECTS = Object.freeze(['push', 'pullRequest', 'merge']);
const REQUIRED_ROLES = Object.freeze([
  ['worker', 'WORKER_IMPLEMENTATION'],
  ['verifier', 'INDEPENDENT_VERIFY'],
  ['reviewer', 'INDEPENDENT_REVIEW'],
]);
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const MAX_COMMAND_TIMEOUT_MS = 60_000;
const MAX_MUTATION_ATTEMPTS = 2;
const MUTATION_RETRY_DELAY_MS = 30_000;
const MERGE_QUEUE_QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergeQueueEntry{id position state}}}}';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
}

function canonicalRepository(value) {
  if (typeof value !== 'string') return null;
  const parts = value.replace(/\.git$/i, '').split('/');
  if (parts.length !== 3 || !/^[A-Za-z0-9.-]+$/.test(parts[0])
      || parts.slice(1).some((part) => !part || !/^[A-Za-z0-9_.-]+$/.test(part))) return null;
  return parts.map((part) => part.toLowerCase()).join('/');
}

function canonicalRemote(raw) {
  if (!nonempty(raw)) return null;
  let host;
  let pathname;
  if (/^https:\/\//i.test(raw) || /^ssh:\/\//i.test(raw)) {
    let url;
    try { url = new URL(raw); } catch { return null; }
    const isSsh = url.protocol === 'ssh:';
    if ((!isSsh && url.username) || url.password || (isSsh && url.username !== 'git')
        || (!isSsh && url.port) || (isSsh && url.port && url.port !== '22')
        || url.search || url.hash) return null;
    host = url.hostname;
    pathname = url.pathname;
  } else {
    const match = /^(?:([^@/:]+)@)?([^:/]+):(.+)$/.exec(raw);
    if (!match || match[1] !== 'git') return null;
    host = match[2];
    pathname = '/' + match[3];
  }
  const cleanPath = pathname.replace(/^\//, '').replace(/\.git$/i, '');
  const repo = canonicalRepository(host + '/' + cleanPath);
  return repo;
}

function validateUniqueStrings(value, name, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0)
      || value.some((item) => !nonempty(item) || item !== item.trim())
      || new Set(value).size !== value.length) {
    throw new TypeError('Invalid campaign field: ' + name);
  }
  return [...value];
}

function validateCampaign(campaign, repoRoot) {
  const expectedRepository = campaign?.repository?.expectedOwnerRepo;
  if (!isRecord(campaign) || campaign.schemaVersion !== GITHUB_DELIVERY_SCHEMA
      || !nonempty(campaign.taskId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(campaign.taskId)
      || !isRecord(campaign.repository) || !nonempty(campaign.repository.remoteName)
      || !/^[A-Za-z0-9._-]+$/.test(campaign.repository.remoteName)
      || campaign.repository.remoteName.startsWith('-')
      || !nonempty(expectedRepository)
      || canonicalRepository(expectedRepository) !== expectedRepository.toLowerCase()
      || !isRecord(campaign.branch) || !nonempty(campaign.branch.head) || !nonempty(campaign.branch.base)
      || campaign.branch.head.startsWith('-') || campaign.branch.base.startsWith('-')
      || !isCommit(campaign.branch.expectedBaseCommit)
      || !isRecord(campaign.pullRequest) || !nonempty(campaign.pullRequest.title)
      || !nonempty(campaign.pullRequest.body)
      || !['merge', 'rebase', 'squash'].includes(campaign.mergeMethod)) {
    throw new TypeError('Invalid GitHub delivery campaign.');
  }
  const requiredChecks = validateUniqueStrings(campaign.requiredChecks, 'requiredChecks', { required: true });
  const notApplicableChecks = validateUniqueStrings(campaign.notApplicableChecks, 'notApplicableChecks');
  if (requiredChecks.some((name) => notApplicableChecks.includes(name))) {
    throw new TypeError('A required check cannot be marked not applicable.');
  }
  if (!Array.isArray(campaign.authorizedEffects)
      || REQUIRED_EFFECTS.some((effect) => !campaign.authorizedEffects.includes(effect))
      || campaign.authorizedEffects.some((effect) => !REQUIRED_EFFECTS.includes(effect))
      || new Set(campaign.authorizedEffects).size !== REQUIRED_EFFECTS.length) {
    throw new TypeError('Campaign must explicitly authorize push, pullRequest, and merge.');
  }
  const mandate = campaign.mandate;
  if (!isRecord(mandate) || mandate.resolvedBy !== 'root' || !nonempty(mandate.sourceRef)
      || mandate.taskId !== campaign.taskId
      || mandate.repositoryRoot !== repoRoot
      || mandate.expectedRepository !== campaign.repository.expectedOwnerRepo
      || mandate.headBranch !== campaign.branch.head
      || mandate.baseBranch !== campaign.branch.base
      || mandate.expectedBaseCommit !== campaign.branch.expectedBaseCommit
      || !Array.isArray(mandate.authorizedEffects)
      || stableJson([...mandate.authorizedEffects].sort()) !== stableJson([...REQUIRED_EFFECTS].sort())) {
    throw new TypeError('Campaign does not contain a matching trusted root mandate.');
  }
  return {
    requiredChecks,
    notApplicableChecks,
    digest: sha256(stableJson(campaign)),
  };
}

function commandResult(result) {
  if (!isRecord(result)) throw new TypeError('Command runner must return a result object.');
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout ?? '');
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr ?? '');
  const exitCode = Number.isInteger(result.exitCode) ? result.exitCode
    : Number.isInteger(result.code) ? result.code : null;
  return {
    exitCode,
    stdout,
    stderr,
    processError: typeof result.processError === 'string' ? result.processError
      : typeof result.errorCode === 'string' ? result.errorCode : null,
    signal: typeof result.signal === 'string' ? result.signal : null,
    timedOut: result.timedOut === true,
  };
}

function execFileResult(executable, args, { cwd, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      resolve(commandResult({
        exitCode: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
        stdout,
        stderr,
        processError: error && !Number.isInteger(error.code) ? String(error.code ?? error.message) : null,
        signal: error?.signal ?? null,
        timedOut: error?.killed === true,
      }));
    });
  });
}

function parseJson(stdout, description) {
  try { return JSON.parse(stdout); } catch {
    throw new Error(description + '_INVALID_JSON');
  }
}

function resultError(code, details = {}) {
  return { status: 'BLOCKED', code, ...details };
}

function writeReceipt(pathname, events, { taskId, campaignDigest, eventType, operationId, action, effectState, evidence, now }) {
  const previousHash = events.at(-1)?.hash ?? 'GENESIS';
  const body = {
    schemaVersion: GITHUB_DELIVERY_RECEIPT_SCHEMA,
    sequence: events.length + 1,
    taskId,
    campaignDigest,
    occurredAt: now().toISOString(),
    eventType,
    ...(operationId ? { operationId } : {}),
    ...(action ? { action } : {}),
    ...(effectState ? { effectState } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
    previousHash,
  };
  const record = { ...body, hash: sha256(stableJson(body)) };
  const fd = openSync(pathname, fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_WRONLY, 0o600);
  try {
    writeSync(fd, JSON.stringify(record) + '\n', undefined, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  events.push(record);
  return record;
}

function readReceipts(pathname, taskId, campaignDigest = null) {
  if (!existsSync(pathname)) return [];
  const text = readFileSync(pathname, 'utf8');
  if (!text.endsWith('\n')) throw new Error('RECEIPT_TAIL_INCOMPLETE');
  const lines = text.split(/\r?\n/).filter(Boolean);
  let previousHash = 'GENESIS';
  let boundDigest = campaignDigest;
  const events = [];
  for (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch { throw new Error('RECEIPT_INVALID_JSON'); }
    const { hash, ...body } = record;
    if (!boundDigest && events.length === 0 && nonempty(record.campaignDigest)) boundDigest = record.campaignDigest;
    if (record.schemaVersion !== GITHUB_DELIVERY_RECEIPT_SCHEMA
        || record.sequence !== events.length + 1
        || record.taskId !== taskId
        || !nonempty(record.campaignDigest)
        || record.campaignDigest !== boundDigest
        || record.previousHash !== previousHash
        || hash !== sha256(stableJson(body))) {
      throw new Error('RECEIPT_CHAIN_INVALID');
    }
    previousHash = hash;
    events.push(record);
  }
  return events;
}

function pendingIntent(events) {
  const outcomes = new Set(events.filter((event) => event.eventType === 'MUTATION_RECONCILED').map((event) => event.operationId));
  return events.findLast((event) => event.eventType === 'MUTATION_INTENT' && !outcomes.has(event.operationId)) ?? null;
}

function mutationAttempts(events, action) {
  return events.filter((event) => event.eventType === 'MUTATION_INTENT' && event.action === action).length;
}

function latestNoEffect(events, action) {
  return events.findLast((event) => event.eventType === 'MUTATION_RECONCILED'
    && event.action === action && event.effectState === 'NONE') ?? null;
}

function acquireDurableLock(lockPath) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const db = new DatabaseSync(lockPath);
  try {
    db.exec('PRAGMA busy_timeout=0;');
    db.exec('CREATE TABLE IF NOT EXISTS lock_guard (id INTEGER PRIMARY KEY CHECK(id = 1), nonce INTEGER NOT NULL);');
    db.exec('INSERT OR IGNORE INTO lock_guard (id, nonce) VALUES (1, 0);');
    db.exec('BEGIN IMMEDIATE;');
    db.exec('UPDATE lock_guard SET nonce = nonce + 1 WHERE id = 1;');
  } catch (error) {
    db.close();
    if (String(error.code ?? '').includes('SQLITE_BUSY') || /locked|busy/i.test(error.message)) return null;
    throw error;
  }
  return {
    release() {
      try { db.exec('COMMIT;'); } finally { db.close(); }
    },
    abort() {
      try { db.exec('ROLLBACK;'); } catch {}
      db.close();
    },
  };
}

function receiptPaths(commonDir, campaign) {
  const stateDir = path.join(commonDir, 'zuri-delivery-control', 'github-delivery-v1');
  const taskHash = sha256(campaign.taskId);
  const remoteKey = campaign.repository.expectedOwnerRepo.toLowerCase() + '\n' + campaign.branch.head;
  const lockHash = sha256(remoteKey);
  return {
    stateDir,
    receiptDir: path.join(stateDir, 'receipts', taskHash),
    legacyReceiptPath: path.join(stateDir, 'receipts', taskHash + '.jsonl'),
    lockPath: path.join(stateDir, 'locks', lockHash + '.sqlite'),
  };
}

function revisionReceiptPath(paths, campaign, candidateHeadCommit) {
  const revisionKey = sha256(campaign.taskId + '\n' + campaign.branch.expectedBaseCommit + '\n' + candidateHeadCommit);
  return path.join(paths.receiptDir, revisionKey + '.jsonl');
}

function priorReceiptFiles(paths, currentReceiptPath, taskId) {
  const candidates = [];
  if (existsSync(paths.legacyReceiptPath)) candidates.push(paths.legacyReceiptPath);
  if (existsSync(paths.receiptDir)) {
    for (const entry of readdirSync(paths.receiptDir, { withFileTypes: true })) {
      if (!entry.name.endsWith('.jsonl')) continue;
      if (!entry.isFile()) throw new Error('RECEIPT_PATH_NOT_REGULAR_FILE');
      candidates.push(path.join(paths.receiptDir, entry.name));
    }
  }
  const current = path.resolve(currentReceiptPath);
  return candidates.filter((pathname) => path.resolve(pathname) !== current)
    .map((pathname) => ({ pathname, events: readReceipts(pathname, taskId) }));
}

function parseRemoteRefs(stdout, expectedRef) {
  const rows = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/));
  const matches = rows.filter((row) => row.length >= 2 && row[1] === expectedRef);
  if (matches.length > 1) throw new Error('REMOTE_REF_AMBIGUOUS');
  return matches.length ? matches[0][0] : null;
}

function checkKey(item) {
  return nonempty(item?.name) ? item.name : null;
}

function normalizeCheckArray(value, description) {
  if (!Array.isArray(value)) throw new Error(description + '_INVALID');
  return value.map((item) => {
    if (!isRecord(item) || !nonempty(item.name) || !nonempty(item.bucket)) throw new Error(description + '_INVALID');
    return { name: item.name, bucket: item.bucket.toLowerCase(), state: String(item.state ?? ''),
      workflow: String(item.workflow ?? ''), completedAt: item.completedAt ?? null };
  });
}

function matchingPrs(prs, campaign) {
  if (!Array.isArray(prs)) throw new Error('PULL_REQUEST_LIST_INVALID');
  return prs.filter((pr) => pr?.headRefName === campaign.branch.head && pr?.baseRefName === campaign.branch.base);
}

function isMerged(pr) {
  return pr?.state === 'MERGED' || Boolean(pr?.mergedAt);
}

function hasAuthorizedMergeEvidence(events, { number, candidateHeadCommit, expectedBaseCommit, operationId, requiredChecks }) {
  return events.some((receipt) => receipt.eventType === 'MUTATION_INTENT' && receipt.action === 'merge'
      && (!operationId || receipt.operationId === operationId)
      && receipt.evidence?.number === number
      && receipt.evidence?.candidateHeadCommit === candidateHeadCommit
      && receipt.evidence?.expectedBaseCommit === expectedBaseCommit
      && receipt.evidence?.baseProtection?.strict === true
      && receipt.evidence?.baseProtection?.enforcedForAdmins === true
      && Array.isArray(receipt.evidence?.baseProtection?.requiredChecks)
      && stableJson([...receipt.evidence.baseProtection.requiredChecks].sort()) === stableJson([...requiredChecks].sort())
      && events.some((observation) => observation.eventType === 'CI_OBSERVED'
        && observation.sequence < receipt.sequence
        && observation.evidence?.number === number
        && observation.evidence?.headRefOid === candidateHeadCommit
        && observation.evidence?.baseRefOid === expectedBaseCommit
        && observation.evidence?.result?.status === 'PASS'));
}

function verifyGateRecord(run, campaign, repoRoot, eventChain) {
  if (!isRecord(eventChain) || !Number.isSafeInteger(eventChain.count) || eventChain.count < 1
      || !/^[a-f0-9]{64}$/.test(eventChain.head ?? '')) return resultError('CONTROLLER_EVENT_CHAIN_INVALID');
  if (!isRecord(run) || run.taskId !== campaign.taskId) return resultError('CONTROLLER_TASK_MISSING');
  if (run.state !== 'ROOT_INTEGRATED_PENDING_CI') return resultError('CONTROLLER_NOT_ROOT_INTEGRATED', { controllerState: run.state ?? null });
  if (run.branch !== campaign.branch.head || run.baseCommit !== campaign.branch.expectedBaseCommit
      || !isCommit(run.candidateHeadCommit) || !isRecord(run.rootIntegration)
      || run.rootIntegration.headCommit !== run.candidateHeadCommit
      || run.rootIntegration.state !== undefined && run.rootIntegration.state !== 'ROOT_INTEGRATED_PENDING_CI'
      || !Array.isArray(run.cycles) || !run.cycles.some((cycle) => cycle.cycleNo === run.currentCycle && cycle.state === 'INTEGRATED')) {
    return resultError('CONTROLLER_INTEGRATION_BINDING_MISMATCH');
  }
  if (path.resolve(run.worktreeRoot ?? '') !== repoRoot) return resultError('CONTROLLER_WORKTREE_MISMATCH');
  const candidate = run.candidateHeadCommit;
  if (!Array.isArray(run.stages)) return resultError('CONTROLLER_GATE_STAGES_MISSING');
  const sessions = new Set();
  for (const [role, stage] of REQUIRED_ROLES) {
    const matches = run.stages.filter((item) => item?.role === role && item?.stage === stage);
    if (matches.length !== 1) return resultError('CONTROLLER_GATE_STAGE_AMBIGUOUS', { role });
    const item = matches[0];
    if (item.status !== 'PASSED' || item.exactHeadCommit !== candidate
        || item.effectState !== 'APPLIED' || !nonempty(item.evidenceRef)
        || !nonempty(item.sessionId) || sessions.has(item.sessionId)) {
      return resultError('CONTROLLER_GATE_NOT_ACCEPTED', { role });
    }
    sessions.add(item.sessionId);
  }
  return { candidateHeadCommit: candidate, proofScope: run.proofScope, changedFiles: run.changedFiles, eventChainHead: eventChain.head };
}

export function createGitHubDeliveryAdapter({
  repoRoot,
  worktreeRoot,
  controller,
  campaign,
  ghExecutable = 'gh',
  gitExecutable = 'git',
  runGh,
  runGit,
  now = () => new Date(),
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
} = {}) {
  if (!nonempty(repoRoot) || !isRecord(controller)
      || typeof controller.getRun !== 'function' || typeof controller.verifyEventChain !== 'function'
      || !nonempty(ghExecutable) || !nonempty(gitExecutable)
      || !Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 1 || commandTimeoutMs > MAX_COMMAND_TIMEOUT_MS) {
    throw new TypeError('GitHub delivery adapter requires repoRoot, durable controller, executables, and bounded command timeout.');
  }
  const canonicalRoot = realpathSync.native(path.resolve(repoRoot));
  const candidateRoot = realpathSync.native(path.resolve(worktreeRoot ?? repoRoot));
  const checked = validateCampaign(campaign, canonicalRoot);
  const gh = runGh ?? ((args, options) => execFileResult(ghExecutable, args, options));
  const gitRunner = runGit ?? ((args, options) => execFileResult(gitExecutable, args, options));

  async function invokeGit(args, { allowedExitCodes = [0] } = {}) {
    const result = commandResult(await gitRunner(args, { cwd: candidateRoot, timeoutMs: commandTimeoutMs }));
    if (!allowedExitCodes.includes(result.exitCode)) {
      throw new Error('GIT_COMMAND_FAILED:' + args[0] + ':' + (result.processError ?? result.exitCode ?? result.signal ?? 'UNKNOWN'));
    }
    return result;
  }

  async function invokeGh(args, { allowedExitCodes = [0] } = {}) {
    const result = commandResult(await gh(args, { cwd: candidateRoot, timeoutMs: commandTimeoutMs }));
    if (!allowedExitCodes.includes(result.exitCode)) {
      throw new Error('GITHUB_COMMAND_FAILED:' + args[0] + ':' + (result.processError ?? result.exitCode ?? result.signal ?? 'UNKNOWN'));
    }
    return result;
  }

  async function commonDirectory() {
    const result = await invokeGit(['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return realpathSync.native(result.stdout.trim());
  }

  async function assertGitBinding(gate) {
    const top = realpathSync.native((await invokeGit(['rev-parse', '--show-toplevel'])).stdout.trim());
    if (top !== candidateRoot) return resultError('REPOSITORY_ROOT_MISMATCH');
    const repositoryCommon = commandResult(await gitRunner(['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: canonicalRoot, timeoutMs: commandTimeoutMs }));
    if (repositoryCommon.exitCode !== 0 || realpathSync.native(repositoryCommon.stdout.trim()) !== await commonDirectory()) return resultError('WORKTREE_REPOSITORY_MISMATCH');
    const branch = (await invokeGit(['branch', '--show-current'])).stdout.trim();
    if (branch !== campaign.branch.head) return resultError('LOCAL_BRANCH_MISMATCH', { actualBranch: branch });
    const head = (await invokeGit(['rev-parse', '--verify', 'HEAD^{commit}'])).stdout.trim();
    if (head !== gate.candidateHeadCommit) return resultError('LOCAL_HEAD_MISMATCH', { actualHead: head });
    const status = (await invokeGit(['status', '--porcelain=v1', '--untracked-files=all'])).stdout;
    if (status.trim()) return resultError('LOCAL_WORKTREE_DIRTY');
    const ancestor = await invokeGit(['merge-base', '--is-ancestor', campaign.branch.expectedBaseCommit, head], { allowedExitCodes: [0, 1] });
    if (ancestor.exitCode !== 0) return resultError('CANDIDATE_NOT_BASED_ON_ADMITTED_COMMIT');

    const fetchUrls = (await invokeGit(['remote', 'get-url', '--all', campaign.repository.remoteName])).stdout
      .split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const pushUrls = (await invokeGit(['remote', 'get-url', '--push', '--all', campaign.repository.remoteName])).stdout
      .split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const expected = canonicalRepository(campaign.repository.expectedOwnerRepo);
    if (fetchUrls.length !== 1 || pushUrls.length !== 1
        || canonicalRemote(fetchUrls[0]) !== expected || canonicalRemote(pushUrls[0]) !== expected) {
      return resultError('REMOTE_REPOSITORY_MISMATCH');
    }
    await invokeGit(['check-ref-format', 'refs/heads/' + campaign.branch.head]);
    await invokeGit(['check-ref-format', 'refs/heads/' + campaign.branch.base]);
    return { head };
  }

  async function remoteRef(ref) {
    const result = await invokeGit(['ls-remote', '--refs', campaign.repository.remoteName, ref]);
    return parseRemoteRefs(result.stdout, ref);
  }

  async function inspectPriorIntent(intent) {
    try {
      if (intent.action === 'push') {
        if (intent.evidence?.branch !== campaign.branch.head
            || intent.evidence?.remoteName !== campaign.repository.remoteName) {
          return { status: 'UNAVAILABLE', reason: 'revision-remote-binding-changed' };
        }
        const remoteHead = await remoteRef('refs/heads/' + campaign.branch.head);
        return { status: remoteHead === intent.evidence.candidateHeadCommit ? 'APPLIED'
          : remoteHead === null ? 'NONE' : 'UNKNOWN', remoteHead };
      }
      if (intent.action === 'pullRequest') {
        if (intent.evidence?.headBranch !== campaign.branch.head
            || intent.evidence?.baseBranch !== campaign.branch.base) {
          return { status: 'UNAVAILABLE', reason: 'revision-branch-binding-changed' };
        }
        const prs = matchingPrs(await pullRequestList(), campaign);
        const exact = prs.filter((pr) => pr.headRefOid === intent.evidence.candidateHeadCommit);
        return exact.length === 1 ? { status: 'APPLIED', number: exact[0].number, headRefOid: exact[0].headRefOid }
          : !prs.length ? { status: 'NONE' } : { status: 'UNKNOWN', pullRequestNumbers: prs.map((pr) => pr.number) };
      }
      if (intent.action === 'merge') {
        const pr = await pullRequestView(intent.evidence.number);
        if (pr.headRefName !== campaign.branch.head || pr.baseRefName !== campaign.branch.base) {
          return { status: 'UNAVAILABLE', reason: 'revision-branch-binding-changed' };
        }
        if (isMerged(pr) && pr.headRefOid === intent.evidence.candidateHeadCommit) {
          return { status: 'APPLIED', number: pr.number, headRefOid: pr.headRefOid, mergedAt: pr.mergedAt };
        }
        if (pr.state === 'OPEN' && pr.headRefOid === intent.evidence.candidateHeadCommit) {
          const queue = await mergeQueueEntry(pr.number);
          return queue ? { status: 'APPLIED', number: pr.number, queued: true, queueState: queue.state ?? null }
            : { status: 'NONE', number: pr.number, state: pr.state, headRefOid: pr.headRefOid };
        }
        return { status: 'UNKNOWN', number: pr.number, state: pr.state, headRefOid: pr.headRefOid };
      }
      return { status: 'UNAVAILABLE', reason: 'unsupported-prior-intent' };
    } catch (error) {
      return { status: 'UNAVAILABLE', reason: String(error.message ?? error) };
    }
  }

  async function pushFastForward({ taskId, gate, remoteHeadCommit, pullRequest, events }) {
    if (!isCommit(remoteHeadCommit)) return resultError('REMOTE_BRANCH_HEAD_INVALID', { taskId });
    const ancestry = await invokeGit(['merge-base', '--is-ancestor', remoteHeadCommit, gate.candidateHeadCommit], { allowedExitCodes: [0, 1] });
    if (ancestry.exitCode !== 0) {
      return resultError('REMOTE_BRANCH_NOT_FAST_FORWARD', {
        taskId, priorRemoteHead: remoteHeadCommit, candidateHeadCommit: gate.candidateHeadCommit,
      });
    }
    if (pullRequest) {
      const fresh = await pullRequestView(pullRequest.number);
      if (fresh.state !== 'OPEN' || fresh.headRefName !== campaign.branch.head
          || fresh.baseRefName !== campaign.branch.base || fresh.headRefOid !== remoteHeadCommit
          || fresh.baseRefOid !== campaign.branch.expectedBaseCommit) {
        return resultError('FAST_FORWARD_PR_PRECONDITION_CHANGED', {
          taskId, number: fresh.number, expectedHead: remoteHeadCommit,
          actualHead: fresh.headRefOid, expectedBase: campaign.branch.expectedBaseCommit,
          actualBase: fresh.baseRefOid, state: fresh.state,
        });
      }
    }
    const mutation = await performMutation('push', ['push', '--porcelain', campaign.repository.remoteName,
      gate.candidateHeadCommit + ':refs/heads/' + campaign.branch.head],
    { candidateHeadCommit: gate.candidateHeadCommit, remoteName: campaign.repository.remoteName,
      branch: campaign.branch.head, priorRemoteHead: remoteHeadCommit,
      ...(pullRequest ? { pullRequestNumber: pullRequest.number } : {}) },
    events, async () => {
      const current = await remoteRef('refs/heads/' + campaign.branch.head);
      if (current === gate.candidateHeadCommit) return { status: 'APPLIED', evidence: { remoteHead: current, priorRemoteHead: remoteHeadCommit } };
      if (current === remoteHeadCommit) return { status: 'NONE', evidence: { remoteHead: current, priorRemoteHead: remoteHeadCommit } };
      return { status: 'UNKNOWN', evidence: { remoteHead: current, expectedHead: gate.candidateHeadCommit, priorRemoteHead: remoteHeadCommit } };
    });
    return { ...mutation, taskId, candidateHeadCommit: gate.candidateHeadCommit, priorRemoteHead: remoteHeadCommit };
  }

  async function pullRequestList() {
    const args = ['pr', 'list', '--repo', campaign.repository.expectedOwnerRepo,
      '--head', campaign.branch.head, '--base', campaign.branch.base, '--state', 'all', '--limit', '100',
      '--json', 'number,url,state,headRefName,headRefOid,baseRefName,baseRefOid,isDraft,mergedAt,reviewDecision,mergeStateStatus'];
    const result = await invokeGh(args);
    const parsed = parseJson(result.stdout, 'PULL_REQUEST_LIST');
    if (!Array.isArray(parsed)) throw new Error('PULL_REQUEST_LIST_INVALID');
    if (parsed.length >= 100) throw new Error('PULL_REQUEST_LIST_LIMIT_REACHED');
    return parsed;
  }

  async function pullRequestView(number) {
    const result = await invokeGh(['pr', 'view', String(number), '--repo', campaign.repository.expectedOwnerRepo,
      '--json', 'number,url,state,headRefName,headRefOid,baseRefName,baseRefOid,isDraft,mergedAt,reviewDecision,mergeStateStatus']);
    const pr = parseJson(result.stdout, 'PULL_REQUEST_VIEW');
    if (!isRecord(pr) || pr.number !== number) throw new Error('PULL_REQUEST_VIEW_INVALID');
    return pr;
  }

  async function mergeQueueEntry(number) {
    const [host, owner, name] = campaign.repository.expectedOwnerRepo.split('/');
    if (host !== 'github.com') throw new Error('MERGE_QUEUE_HOST_UNSUPPORTED');
    const result = await invokeGh(['api', 'graphql',
      '-F', 'owner=' + owner, '-F', 'name=' + name, '-F', 'number=' + number,
      '-f', 'query=' + MERGE_QUEUE_QUERY]);
    const payload = parseJson(result.stdout, 'MERGE_QUEUE');
    if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.data.repository)
        || !isRecord(payload.data.repository.pullRequest)
        || Object.hasOwn(payload, 'errors')) throw new Error('MERGE_QUEUE_QUERY_INCOMPLETE');
    return payload.data.repository.pullRequest.mergeQueueEntry ?? null;
  }

  async function readBaseProtection() {
    const [host, owner, name] = campaign.repository.expectedOwnerRepo.split('/');
    const endpoint = `repos/${owner}/${name}/branches/${encodeURIComponent(campaign.branch.base)}/protection`;
    let response;
    try {
      response = commandResult(await gh(['api', endpoint, '--hostname', host], { cwd: candidateRoot, timeoutMs: commandTimeoutMs }));
    } catch (error) {
      return resultError('BASE_PROTECTION_UNAVAILABLE', { detail: String(error.message ?? error) });
    }
    if (response.exitCode !== 0 || response.processError || response.timedOut) {
      return resultError('BASE_PROTECTION_UNAVAILABLE', { exitCode: response.exitCode, processError: response.processError });
    }
    let protection;
    try { protection = parseJson(response.stdout, 'BASE_PROTECTION'); } catch (error) {
      return resultError('BASE_PROTECTION_UNAVAILABLE', { detail: String(error.message ?? error) });
    }
    if (!isRecord(protection)) return resultError('BASE_PROTECTION_UNAVAILABLE');
    const statusChecks = protection.required_status_checks;
    const enforceAdmins = protection.enforce_admins;
    if (!isRecord(statusChecks) || statusChecks.strict !== true) {
      return resultError('BASE_PROTECTION_NOT_STRICT', { strict: statusChecks?.strict ?? null });
    }
    if (!isRecord(enforceAdmins) || enforceAdmins.enabled !== true) {
      return resultError('BASE_PROTECTION_NOT_ENFORCED', { enforcedForAdmins: enforceAdmins?.enabled ?? null });
    }
    const protectedChecks = new Set([
      ...(Array.isArray(statusChecks.contexts) ? statusChecks.contexts : []),
      ...(Array.isArray(statusChecks.checks) ? statusChecks.checks.map((item) => item?.context).filter(nonempty) : []),
    ]);
    const missingRequiredChecks = checked.requiredChecks.filter((name) => !protectedChecks.has(name));
    if (missingRequiredChecks.length) {
      return resultError('BASE_PROTECTION_REQUIRED_CHECKS_MISSING', { missingRequiredChecks });
    }
    return {
      status: 'PASS',
      evidence: {
        strict: true,
        enforcedForAdmins: true,
        requiredChecks: [...checked.requiredChecks],
      },
    };
  }

  async function requiredAndAllChecks(number) {
    const suffix = ['--repo', campaign.repository.expectedOwnerRepo, '--json', 'bucket,name,state,workflow,completedAt'];
    const requiredArgs = ['pr', 'checks', String(number), '--required', ...suffix];
    const allArgs = ['pr', 'checks', String(number), ...suffix];
    const requiredResult = commandResult(await gh(requiredArgs, { cwd: candidateRoot, timeoutMs: commandTimeoutMs }));
    const allResult = commandResult(await gh(allArgs, { cwd: candidateRoot, timeoutMs: commandTimeoutMs }));
    const parseOutput = (result, description) => {
      const parsed = result.stdout.trim() ? parseJson(result.stdout, description) : [];
      if (!Array.isArray(parsed)) throw new Error(description + '_INVALID');
      if (![0, 1, 8].includes(result.exitCode) && !result.processError) {
        throw new Error(description + '_COMMAND_FAILED');
      }
      if (result.processError) throw new Error(description + '_COMMAND_FAILED');
      return normalizeCheckArray(parsed, description);
    };
    return {
      required: parseOutput(requiredResult, 'REQUIRED_CHECKS'),
      all: parseOutput(allResult, 'ALL_CHECKS'),
      requiredExitCode: requiredResult.exitCode,
      allExitCode: allResult.exitCode,
    };
  }

  function evaluateChecks(observed) {
    if (!observed.required.length || !observed.all.length) return { status: 'WAITING_CI', code: 'NO_CHECK_RESULTS' };
    const requiredNames = observed.required.map(checkKey);
    if (new Set(requiredNames).size !== requiredNames.length) return { status: 'BLOCKED', code: 'DUPLICATE_REQUIRED_CHECK' };
    const expected = checked.requiredChecks;
    const extraRequired = requiredNames.filter((name) => !expected.includes(name));
    if (extraRequired.length) return { status: 'BLOCKED', code: 'REQUIRED_CHECK_POLICY_CHANGED', extraRequired };
    const missingRequired = expected.filter((name) => !requiredNames.includes(name));
    const allNames = observed.all.map(checkKey);
    if (new Set(allNames).size !== allNames.length) return { status: 'BLOCKED', code: 'DUPLICATE_CHECK_NAME' };
    if (missingRequired.length || expected.some((name) => !allNames.includes(name))) {
      return { status: 'WAITING_CI', code: 'EXPECTED_CHECKS_NOT_REPORTED', missing: [...new Set([...missingRequired, ...expected.filter((name) => !allNames.includes(name))])] };
    }
    const notApplicable = [];
    const failures = [];
    const pending = [];
    const unknown = [];
    for (const check of observed.all) {
      if (check.bucket === 'pass') continue;
      if (check.bucket === 'skipping' && checked.notApplicableChecks.includes(check.name)
          && !expected.includes(check.name)) {
        notApplicable.push(check.name);
      } else if (check.bucket === 'pending') {
        pending.push(check.name);
      } else if (['fail', 'cancel', 'skipping'].includes(check.bucket)) {
        failures.push({ name: check.name, bucket: check.bucket });
      } else {
        unknown.push({ name: check.name, bucket: check.bucket });
      }
    }
    if (failures.length) return { status: 'BLOCKED', code: 'CI_CHECK_NOT_ACCEPTED', failures, notApplicable };
    if (unknown.length) return { status: 'BLOCKED', code: 'CI_CHECK_STATE_UNKNOWN', unknown, notApplicable };
    if (pending.length) return { status: 'WAITING_CI', code: 'CI_PENDING', pending, notApplicable };
    const absentRequiredRows = expected.filter((name) => {
      const row = observed.required.find((item) => item.name === name);
      return !row || row.bucket !== 'pass';
    });
    if (absentRequiredRows.length) return { status: 'WAITING_CI', code: 'REQUIRED_CHECKS_NOT_GREEN', missing: absentRequiredRows, notApplicable };
    return { status: 'PASS', code: 'CI_ACCEPTED', notApplicable, checked: observed.all.map(({ name, bucket, state, workflow }) => ({ name, bucket, state, workflow })) };
  }

  async function gateSnapshot() {
    const [eventChain, run] = await Promise.all([
      Promise.resolve(controller.verifyEventChain()),
      Promise.resolve(controller.getRun(campaign.taskId)),
    ]);
    return { run, gate: verifyGateRecord(run, campaign, candidateRoot, eventChain), eventChain };
  }

  function event(events, eventType, evidence, extra = {}) {
    return writeReceipt(receiptFile, events, {
      taskId: campaign.taskId, campaignDigest: checked.digest, eventType, evidence, now, ...extra,
    });
  }

  async function confirmMergedPullRequest(prSnapshot, gate, events, { operationId } = {}) {
    if (!prSnapshot || prSnapshot.headRefOid !== gate.candidateHeadCommit || prSnapshot.isDraft
        || prSnapshot.headRefName !== campaign.branch.head || prSnapshot.baseRefName !== campaign.branch.base) {
      return resultError('MERGED_PULL_REQUEST_BINDING_MISMATCH', { number: prSnapshot?.number ?? null });
    }
    if (!hasAuthorizedMergeEvidence(events, {
      number: prSnapshot.number,
      candidateHeadCommit: gate.candidateHeadCommit,
      expectedBaseCommit: campaign.branch.expectedBaseCommit,
      requiredChecks: checked.requiredChecks,
      operationId,
    })) {
      return resultError('MERGED_PULL_REQUEST_NO_AUTHORIZED_CI_INTENT', { number: prSnapshot.number });
    }
    const fresh = await pullRequestView(prSnapshot.number);
    if (!isMerged(fresh) || fresh.headRefOid !== gate.candidateHeadCommit
        || fresh.headRefName !== campaign.branch.head || fresh.baseRefName !== campaign.branch.base || fresh.isDraft) {
      return resultError('MERGED_PULL_REQUEST_BINDING_MISMATCH', { number: fresh.number });
    }
    if (fresh.reviewDecision === 'CHANGES_REQUESTED' || fresh.reviewDecision === 'REVIEW_REQUIRED') {
      return resultError('MERGED_PULL_REQUEST_REVIEW_NOT_ACCEPTED', { number: fresh.number, reviewDecision: fresh.reviewDecision });
    }
    const checkObservation = evaluateChecks(await requiredAndAllChecks(fresh.number));
    event(events, 'CI_OBSERVED', {
      number: fresh.number,
      headRefOid: fresh.headRefOid,
      baseRefOid: fresh.baseRefOid,
      result: checkObservation,
    });
    if (checkObservation.status !== 'PASS') {
      return resultError('MERGED_PULL_REQUEST_CI_NOT_ACCEPTED', {
        number: fresh.number,
        ciStatus: checkObservation.status,
        ciCode: checkObservation.code,
      });
    }
    event(events, 'REMOTE_MERGE_CONFIRMED', {
      number: fresh.number,
      url: fresh.url,
      headRefOid: fresh.headRefOid,
      mergedAt: fresh.mergedAt,
      ciStatus: checkObservation.status,
      reviewDecision: fresh.reviewDecision ?? null,
    });
    return {
      status: 'MERGED',
      number: fresh.number,
      url: fresh.url,
      headCommit: gate.candidateHeadCommit,
      source: 'github-reconciliation',
    };
  }

  async function reconcileIntent(intent, events) {
    let state;
    let evidence;
    if (intent.action === 'push') {
      const [headSha] = await Promise.all([remoteRef('refs/heads/' + campaign.branch.head)]);
      if (headSha === intent.evidence.candidateHeadCommit) {
        state = 'APPLIED';
        evidence = { remoteHead: headSha };
      } else if (!headSha) {
        state = 'NONE';
        evidence = { remoteHead: null };
      } else {
        state = 'UNKNOWN';
        evidence = { remoteHead: headSha, expectedHead: intent.evidence.candidateHeadCommit };
      }
    } else if (intent.action === 'pullRequest') {
      const prs = matchingPrs(await pullRequestList(), campaign);
      const exact = prs.filter((pr) => pr.headRefOid === intent.evidence.candidateHeadCommit);
      if (exact.length === 1) {
        state = 'APPLIED';
        evidence = { number: exact[0].number, url: exact[0].url, state: exact[0].state, headRefOid: exact[0].headRefOid };
      } else if (exact.length > 1 || prs.length > 1 || (prs.length === 1 && !exact.length)) {
        state = 'UNKNOWN';
        evidence = { matchingPullRequests: prs.map((pr) => ({ number: pr.number, state: pr.state, headRefOid: pr.headRefOid })) };
      } else {
        state = 'NONE';
        evidence = { pullRequests: [] };
      }
    } else if (intent.action === 'merge') {
      const pr = await pullRequestView(intent.evidence.number);
      if (isMerged(pr) && pr.headRefOid === intent.evidence.candidateHeadCommit) {
        const confirmed = await confirmMergedPullRequest(pr, { candidateHeadCommit: intent.evidence.candidateHeadCommit }, events, { operationId: intent.operationId });
        if (confirmed.status === 'MERGED') {
          state = 'APPLIED';
          evidence = { number: pr.number, url: pr.url, mergedAt: pr.mergedAt, headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid };
        } else {
          state = 'UNKNOWN';
          evidence = { number: pr.number, state: pr.state, headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid, refusal: confirmed.code };
        }
      } else if (pr.state === 'OPEN' && pr.headRefOid === intent.evidence.candidateHeadCommit) {
        if (!hasAuthorizedMergeEvidence(events, {
          number: pr.number,
          candidateHeadCommit: intent.evidence.candidateHeadCommit,
          expectedBaseCommit: intent.evidence.expectedBaseCommit,
          requiredChecks: checked.requiredChecks,
          operationId: intent.operationId,
        })) {
          state = 'UNKNOWN';
          evidence = { number: pr.number, state: pr.state, headRefOid: pr.headRefOid, refusal: 'MERGE_INTENT_WITHOUT_CI_PASS' };
        } else {
        const queue = await mergeQueueEntry(pr.number);
        if (queue) {
          state = 'APPLIED';
          evidence = { number: pr.number, queued: true, queueState: queue.state ?? null, position: queue.position ?? null };
        } else {
          state = 'NONE';
          evidence = { number: pr.number, state: pr.state, headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid, mergeStateStatus: pr.mergeStateStatus };
        }
        }
      } else {
        state = 'UNKNOWN';
        evidence = { number: pr.number, state: pr.state, headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid };
      }
    } else {
      state = 'UNKNOWN';
      evidence = { reason: 'unsupported-intent' };
    }
    if (state === 'UNKNOWN') {
      event(events, 'RECONCILIATION_UNRESOLVED', evidence, { operationId: intent.operationId, action: intent.action, effectState: 'UNKNOWN' });
      return { status: 'UNKNOWN_EFFECT', action: intent.action, evidence };
    }
    const reconciledEvidence = state === 'NONE'
      ? { ...evidence, retryAfter: new Date(now().getTime() + MUTATION_RETRY_DELAY_MS).toISOString() }
      : evidence;
    event(events, 'MUTATION_RECONCILED', reconciledEvidence, { operationId: intent.operationId, action: intent.action, effectState: state });
    return {
      status: state === 'APPLIED' ? (intent.action === 'merge' && evidence.queued ? 'WAITING_MERGE_QUEUE' : 'RECONCILED_APPLIED') : 'RECONCILED_NO_EFFECT',
      action: intent.action,
      evidence: reconciledEvidence,
      ...(state === 'NONE' ? { retryAt: reconciledEvidence.retryAfter } : {}),
    };
  }

  async function performMutation(action, args, evidence, events, reconcile) {
    const attempts = mutationAttempts(events, action);
    if (attempts >= MAX_MUTATION_ATTEMPTS) {
      return resultError('MUTATION_ATTEMPT_CAP', { action, attempts });
    }
    const lastNone = latestNoEffect(events, action);
    if (lastNone?.evidence?.retryAfter && now().getTime() < Date.parse(lastNone.evidence.retryAfter)) {
      return { status: 'WAITING_RETRY_BACKOFF', action, retryAt: lastNone.evidence.retryAfter };
    }
    const operationId = randomUUID();
    event(events, 'MUTATION_INTENT', evidence, { operationId, action, effectState: 'UNKNOWN' });
    const result = commandResult(await (action === 'push'
      ? gitRunner(args, { cwd: candidateRoot, timeoutMs: commandTimeoutMs })
      : gh(args, { cwd: candidateRoot, timeoutMs: commandTimeoutMs })));
    let observed;
    try {
      observed = await reconcile({ operationId, action, evidence });
    } catch (error) {
      event(events, 'RECONCILIATION_UNRESOLVED', { code: String(error.message ?? 'REMOTE_READ_FAILED'), commandExitCode: result.exitCode }, {
        operationId, action, effectState: 'UNKNOWN',
      });
      return { status: 'UNKNOWN_EFFECT', action, code: String(error.message ?? 'REMOTE_READ_FAILED') };
    }
    if (observed.status === 'APPLIED') {
      event(events, 'MUTATION_RECONCILED', observed.evidence, { operationId, action, effectState: 'APPLIED' });
      if (action === 'merge' && observed.evidence?.queued) return { status: 'WAITING_MERGE_QUEUE', action, evidence: observed.evidence };
      return { status: action === 'push' ? 'PUSHED' : action === 'pullRequest' ? 'PR_CREATED' : 'MERGED', action, evidence: observed.evidence };
    }
    if (observed.status === 'UNKNOWN') {
      event(events, 'RECONCILIATION_UNRESOLVED', observed.evidence, { operationId, action, effectState: 'UNKNOWN' });
      return { status: 'UNKNOWN_EFFECT', action, evidence: observed.evidence };
    }
    const retryAfter = new Date(now().getTime() + MUTATION_RETRY_DELAY_MS).toISOString();
    const noEffectEvidence = {
      ...observed.evidence,
      commandExitCode: result.exitCode,
      processError: result.processError,
      retryAfter,
    };
    event(events, 'MUTATION_RECONCILED', noEffectEvidence, { operationId, action, effectState: 'NONE' });
    return {
      status: 'NO_EFFECT_RECONCILED',
      action,
      retryable: attempts + 1 < MAX_MUTATION_ATTEMPTS,
      retryAt: retryAfter,
      commandExitCode: result.exitCode,
    };
  }

  async function tick(taskId = campaign.taskId) {
    if (taskId !== campaign.taskId) return resultError('CAMPAIGN_TASK_MISMATCH');
    let commonDir;
    try {
      commonDir = await commonDirectory();
    } catch (error) {
      return resultError('GIT_COMMON_DIRECTORY_UNAVAILABLE', { detail: String(error.message ?? error) });
    }
    const paths = receiptPaths(commonDir, campaign);
    let lock;
    try { lock = acquireDurableLock(paths.lockPath); } catch (error) {
      return resultError('DELIVERY_LOCK_UNAVAILABLE', { detail: String(error.message ?? error) });
    }
    if (!lock) return { status: 'BUSY', taskId, repository: campaign.repository.expectedOwnerRepo, branch: campaign.branch.head };
    try {
      const { run, gate, eventChain } = await gateSnapshot();
      if (gate.status === 'BLOCKED') return { ...gate, taskId };
      const currentReceiptPath = revisionReceiptPath(paths, campaign, gate.candidateHeadCommit);
      mkdirSync(path.dirname(currentReceiptPath), { recursive: true });
      receiptFile = currentReceiptPath;
      let events;
      let priorReceipts;
      try {
        events = readReceipts(receiptFile, campaign.taskId, checked.digest);
        priorReceipts = priorReceiptFiles(paths, currentReceiptPath, campaign.taskId);
      } catch (error) {
        return resultError('RECEIPT_INVALID', { detail: String(error.message ?? error) });
      }
      const gitBinding = await assertGitBinding(gate);
      if (gitBinding.status === 'BLOCKED') return { ...gitBinding, taskId };
      const priorPending = priorReceipts.flatMap((receipt) => {
        const intent = pendingIntent(receipt.events);
        return intent ? [{ ...receipt, intent }] : [];
      });
      if (priorPending.length) {
        const observations = await Promise.all(priorPending.map(async (receipt) => ({
          revision: path.basename(receipt.pathname, '.jsonl'),
          action: receipt.intent.action,
          observation: await inspectPriorIntent(receipt.intent),
        })));
        return { status: 'UNKNOWN_EFFECT', code: 'PRIOR_REVISION_PENDING_INTENT', taskId, observations };
      }
      const unresolved = pendingIntent(events);
      if (unresolved) {
        try {
          const reconciled = await reconcileIntent(unresolved, events);
          return { ...reconciled, taskId, candidateHeadCommit: gate.candidateHeadCommit };
        } catch (error) {
          event(events, 'RECONCILIATION_UNRESOLVED', { code: String(error.message ?? 'REMOTE_READ_FAILED') }, {
            operationId: unresolved.operationId, action: unresolved.action, effectState: 'UNKNOWN',
          });
          return { status: 'UNKNOWN_EFFECT', taskId, action: unresolved.action, code: String(error.message ?? 'REMOTE_READ_FAILED') };
        }
      }

      const baseRef = 'refs/heads/' + campaign.branch.base;
      const headRef = 'refs/heads/' + campaign.branch.head;
      const [actualBaseCommit, remoteHeadCommit] = await Promise.all([remoteRef(baseRef), remoteRef(headRef)]);

      let prs;
      try { prs = matchingPrs(await pullRequestList(), campaign); } catch (error) {
        return resultError('GITHUB_READ_FAILED', { taskId, detail: String(error.message ?? error) });
      }
      if (prs.length > 1) {
        return resultError('PULL_REQUEST_AMBIGUOUS', { taskId, pullRequestNumbers: prs.map((pr) => pr.number) });
      }
      if (prs.length === 1 && isMerged(prs[0])) {
        const confirmed = await confirmMergedPullRequest(prs[0], gate, events);
        return { ...confirmed, taskId };
      }
      if (prs.length === 1 && prs[0].state !== 'OPEN') {
        return resultError('PULL_REQUEST_CLOSED_UNMERGED', { taskId, number: prs[0].number, state: prs[0].state });
      }
      if (actualBaseCommit !== campaign.branch.expectedBaseCommit) {
        return { status: 'REPLAN_REQUIRED', code: 'BASE_ADVANCED', taskId,
          expectedBaseCommit: campaign.branch.expectedBaseCommit, actualBaseCommit };
      }

      if (prs.length === 0) {
        if (remoteHeadCommit && remoteHeadCommit !== gate.candidateHeadCommit) {
          return pushFastForward({ taskId, gate, remoteHeadCommit, events });
        }
        if (!remoteHeadCommit) {
          const mutation = await performMutation('push', ['push', '--porcelain', campaign.repository.remoteName,
            gate.candidateHeadCommit + ':refs/heads/' + campaign.branch.head],
          { candidateHeadCommit: gate.candidateHeadCommit, remoteName: campaign.repository.remoteName, branch: campaign.branch.head },
          events, async () => {
            const current = await remoteRef(headRef);
            return current === gate.candidateHeadCommit ? { status: 'APPLIED', evidence: { remoteHead: current } }
              : current === null ? { status: 'NONE', evidence: { remoteHead: null } }
                : { status: 'UNKNOWN', evidence: { remoteHead: current, expectedHead: gate.candidateHeadCommit } };
          });
          return { ...mutation, taskId, candidateHeadCommit: gate.candidateHeadCommit };
        }
        const mutation = await performMutation('pullRequest', ['pr', 'create', '--repo', campaign.repository.expectedOwnerRepo,
          '--title', campaign.pullRequest.title, '--body', campaign.pullRequest.body,
          '--base', campaign.branch.base, '--head', campaign.branch.head],
        { candidateHeadCommit: gate.candidateHeadCommit, headBranch: campaign.branch.head, baseBranch: campaign.branch.base },
        events, async () => {
          const current = matchingPrs(await pullRequestList(), campaign);
          const exact = current.filter((pr) => pr.headRefOid === gate.candidateHeadCommit);
          if (exact.length === 1) return { status: 'APPLIED', evidence: { number: exact[0].number, url: exact[0].url, headRefOid: exact[0].headRefOid } };
          if (current.length || exact.length > 1) return { status: 'UNKNOWN', evidence: { pullRequests: current.map((pr) => ({ number: pr.number, state: pr.state, headRefOid: pr.headRefOid })) } };
          return { status: 'NONE', evidence: { pullRequests: [] } };
        });
        return { ...mutation, taskId, candidateHeadCommit: gate.candidateHeadCommit };
      }

      const listed = prs[0];
      if (listed.baseRefOid !== campaign.branch.expectedBaseCommit) {
        return { status: 'REPLAN_REQUIRED', code: 'BASE_ADVANCED', taskId,
          expectedBaseCommit: campaign.branch.expectedBaseCommit, actualBaseCommit: listed.baseRefOid, number: listed.number };
      }
      if (remoteHeadCommit !== gate.candidateHeadCommit) {
        if (remoteHeadCommit && listed.headRefOid === remoteHeadCommit) {
          return pushFastForward({ taskId, gate, remoteHeadCommit, pullRequest: listed, events });
        }
        return resultError('PULL_REQUEST_HEAD_MISMATCH', { taskId, number: listed.number,
          expectedHead: gate.candidateHeadCommit, remoteHeadCommit, pullRequestHead: listed.headRefOid });
      }
      if (listed.headRefOid !== gate.candidateHeadCommit) {
        if (isCommit(listed.headRefOid)) {
          const ancestry = await invokeGit(['merge-base', '--is-ancestor', listed.headRefOid, gate.candidateHeadCommit], { allowedExitCodes: [0, 1] });
          if (ancestry.exitCode === 0) {
            return { status: 'WAITING_PR_HEAD_UPDATE', taskId, number: listed.number,
              expectedHead: gate.candidateHeadCommit, actualHead: listed.headRefOid };
          }
        }
        return resultError('PULL_REQUEST_HEAD_MISMATCH', { taskId, number: listed.number,
          expectedHead: gate.candidateHeadCommit, remoteHeadCommit, pullRequestHead: listed.headRefOid });
      }
      if (listed.isDraft) return { status: 'WAITING_DRAFT', taskId, number: listed.number, url: listed.url };
      const pr = await pullRequestView(listed.number);
      if (pr.state !== 'OPEN' || pr.headRefName !== campaign.branch.head || pr.baseRefName !== campaign.branch.base
          || pr.headRefOid !== gate.candidateHeadCommit || pr.baseRefOid !== campaign.branch.expectedBaseCommit) {
        return resultError('PULL_REQUEST_CHANGED', { taskId, number: pr.number, state: pr.state, headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid });
      }
      if (pr.reviewDecision === 'CHANGES_REQUESTED') {
        return resultError('REVIEW_CHANGES_REQUESTED', { taskId, number: pr.number });
      }
      if (pr.reviewDecision === 'REVIEW_REQUIRED') {
        return { status: 'WAITING_REVIEW', taskId, number: pr.number, url: pr.url };
      }
      if (pr.mergeStateStatus !== 'CLEAN') {
        return { status: 'WAITING_MERGEABILITY', taskId, number: pr.number, mergeStateStatus: pr.mergeStateStatus };
      }
      let checkObservation;
      try { checkObservation = evaluateChecks(await requiredAndAllChecks(pr.number)); } catch (error) {
        return resultError('CI_READ_FAILED', { taskId, number: pr.number, detail: String(error.message ?? error) });
      }
      event(events, 'CI_OBSERVED', {
        number: pr.number,
        headRefOid: pr.headRefOid,
        baseRefOid: pr.baseRefOid,
        result: checkObservation,
      });
      if (checkObservation.status !== 'PASS') {
        return { ...checkObservation, taskId, number: pr.number, url: pr.url, headCommit: gate.candidateHeadCommit };
      }
      const fresh = await pullRequestView(pr.number);
      if (fresh.state !== 'OPEN' || fresh.headRefOid !== gate.candidateHeadCommit
          || fresh.baseRefOid !== campaign.branch.expectedBaseCommit || fresh.baseRefOid !== pr.baseRefOid) {
        return resultError('MERGE_PRECONDITION_CHANGED', {
          taskId, number: pr.number, expectedHead: gate.candidateHeadCommit,
          actualHead: fresh.headRefOid, expectedBase: campaign.branch.expectedBaseCommit,
          actualBase: fresh.baseRefOid,
        });
      }
      const [freshBase, freshRemoteHead] = await Promise.all([remoteRef(baseRef), remoteRef(headRef)]);
      if (freshBase !== campaign.branch.expectedBaseCommit) {
        return { status: 'REPLAN_REQUIRED', code: 'BASE_ADVANCED', taskId,
          expectedBaseCommit: campaign.branch.expectedBaseCommit, actualBaseCommit: freshBase };
      }
      if (freshRemoteHead !== gate.candidateHeadCommit) {
        return resultError('REMOTE_BRANCH_DIVERGED', { taskId, expectedHead: gate.candidateHeadCommit, actualHead: freshRemoteHead });
      }
      let queueEntry;
      try { queueEntry = await mergeQueueEntry(pr.number); } catch (error) {
        return resultError('MERGE_QUEUE_STATUS_UNAVAILABLE', { taskId, number: pr.number, detail: String(error.message ?? error) });
      }
      if (queueEntry) {
        return { status: 'WAITING_MERGE_QUEUE', taskId, number: pr.number, queueState: queueEntry.state ?? null, position: queueEntry.position ?? null };
      }
      // This is the last PR/base/head read before merge. GitHub's server-side
      // --match-head-commit precondition protects against a concurrent head push.
      const actionView = await pullRequestView(pr.number);
      if (actionView.state !== 'OPEN' || actionView.headRefOid !== gate.candidateHeadCommit
          || actionView.baseRefOid !== campaign.branch.expectedBaseCommit
          || actionView.mergeStateStatus !== 'CLEAN') {
        return resultError('MERGE_PRECONDITION_CHANGED', { taskId, number: pr.number, actualHead: actionView.headRefOid, actualBase: actionView.baseRefOid, mergeStateStatus: actionView.mergeStateStatus });
      }
      const baseProtection = await readBaseProtection();
      if (baseProtection.status !== 'PASS') return { ...baseProtection, taskId, number: pr.number };
      const mutation = await performMutation('merge', ['pr', 'merge', String(pr.number),
        '--repo', campaign.repository.expectedOwnerRepo,
        '--match-head-commit', gate.candidateHeadCommit,
        '--' + campaign.mergeMethod],
      { number: pr.number, candidateHeadCommit: gate.candidateHeadCommit,
        expectedBaseCommit: campaign.branch.expectedBaseCommit, baseProtection: baseProtection.evidence },
      events, async ({ operationId }) => {
        const current = await pullRequestView(pr.number);
        if (isMerged(current) && current.headRefOid === gate.candidateHeadCommit) {
          const confirmed = await confirmMergedPullRequest(current, gate, events, { operationId });
          if (confirmed.status !== 'MERGED') {
            return { status: 'UNKNOWN', evidence: { number: current.number, state: current.state,
              headRefOid: current.headRefOid, baseRefOid: current.baseRefOid, refusal: confirmed.code } };
          }
          return { status: 'APPLIED', evidence: { number: current.number, url: current.url, mergedAt: current.mergedAt, headRefOid: current.headRefOid, baseRefOid: current.baseRefOid } };
        }
        if (current.state === 'OPEN' && current.headRefOid === gate.candidateHeadCommit) {
          const queued = await mergeQueueEntry(current.number);
          if (queued) return { status: 'APPLIED', evidence: { number: current.number, queued: true, queueState: queued.state ?? null, position: queued.position ?? null } };
          return { status: 'NONE', evidence: { number: current.number, state: current.state, headRefOid: current.headRefOid, baseRefOid: current.baseRefOid, mergeStateStatus: current.mergeStateStatus } };
        }
        return { status: 'UNKNOWN', evidence: { number: current.number, state: current.state, headRefOid: current.headRefOid, baseRefOid: current.baseRefOid } };
      });
      return { ...mutation, taskId, number: pr.number, url: pr.url, candidateHeadCommit: gate.candidateHeadCommit };
    } catch (error) {
      return resultError('DELIVERY_STEP_FAILED', { taskId, detail: String(error.message ?? error) });
    } finally {
      lock.release();
    }
  }

  let receiptFile;
  return {
    async tick(taskId = campaign.taskId) {
      try { return await tick(taskId); } catch (error) {
        return resultError('DELIVERY_ADAPTER_FAILED', { taskId, detail: String(error.message ?? error) });
      }
    },
    campaign: Object.freeze({
      taskId: campaign.taskId,
      repository: campaign.repository.expectedOwnerRepo,
      headBranch: campaign.branch.head,
      baseBranch: campaign.branch.base,
      expectedBaseCommit: campaign.branch.expectedBaseCommit,
    }),
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createControllerEventReader,
  projectWorkerObservability,
  readControllerEventProjection,
  readWorkerObservability,
  verifyControllerEventChain,
} from '../delivery-control/worker-observability-reader.mjs';

test('supervisor event reader uses the bound repository root', async () => {
  const expectedRoot = 'C:\\zuri\\repo';
  let received;
  const reader = createControllerEventReader(expectedRoot, async (options) => {
    received = options;
    return [{ kind: 'LOCAL_STATUS_CHANGED' }];
  });
  assert.deepEqual(await reader(), [{ kind: 'LOCAL_STATUS_CHANGED' }]);
  assert.deepEqual(received, { repoRoot: expectedRoot });
});

const hash = (value) => createHash('sha256').update(value).digest('hex');
const commit = 'a'.repeat(40);
const base = 'b'.repeat(40);
const now = new Date('2026-10-16T04:00:00.000Z');

function event(sequence, taskId, cycleNo, eventType, occurredAt, payload) {
  const payloadJson = JSON.stringify(payload);
  const previousHash = sequence === 1 ? 'GENESIS' : null;
  return { sequence, task_id: taskId, cycle_no: cycleNo, event_type: eventType, occurred_at: occurredAt,
    payload_json: payloadJson, previous_hash: previousHash,
    event_hash: hash(['GENESIS', sequence, taskId ?? '', cycleNo ?? '', eventType, occurredAt, payloadJson].join('\n')) };
}

function activeRun(taskId, { state = 'RUNNING', runState = 'RUNNING', epoch = 1, expiresAt = '2026-10-16T04:01:00.000Z', heartbeatAt = '2026-10-16T03:59:55.000Z', role = 'worker', stage = 'WORKER_IMPLEMENTATION', nodeId = 'worker' } = {}) {
  return {
    task_id: taskId, state: runState, current_cycle: 1, base_commit: base,
    initial_head_commit: commit, candidate_head_commit: commit,
    cycle_state: 'ACTIVE', updated_at: heartbeatAt,
    stages: [{ task_id: taskId, cycle_no: 1, node_id: nodeId, stage, role, state, attempt: 1,
      lease_epoch: epoch, lease_owner: 'private-owner-id', lease_expires_at: expiresAt,
      required_head_commit: commit, candidate_head_commit: commit, evidence_json: null }],
  };
}

function heartbeat(taskId, { epoch = 1, expiresAt = '2026-10-16T04:01:00.000Z', at = '2026-10-16T03:59:55.000Z', ownerId = 'private-owner-id', nodeId = 'worker' } = {}) {
  return { sequence: 1, task_id: taskId, cycle_no: 1, event_type: 'NODE_LEASE_HEARTBEAT', occurred_at: at,
    payload_json: JSON.stringify({ nodeId, ownerId, fencingEpoch: epoch, expiresAt }) };
}

function snapshot({ runs = [], events = [], supervisor = {}, tags = [], localStatus = {}, since = null } = {}) {
  return projectWorkerObservability({ runs, events, supervisor, tags, localStatus, now, since });
}

function createRepoWithLedger({ events = [], runs = [], corruptHead = false,
  controllerHeartbeat = { schemaVersion: 'controller-liveness/v1', processId: 123,
    heartbeatAt: now.toISOString() } } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'zuri-worker-observability-'));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true });
  git(['init']);
  git(['config', 'user.email', 'worker-test@example.invalid']);
  git(['config', 'user.name', 'Worker Test']);
  writeFileSync(path.join(root, 'seed.txt'), 'seed');
  git(['add', 'seed.txt']);
  git(['commit', '-m', 'seed']);
  const privateRoot = path.join(root, '.git', 'zuri-delivery-control');
  mkdirSync(privateRoot, { recursive: true });
  const controllerStateRoot = path.join(privateRoot, 'controller-v1');
  mkdirSync(controllerStateRoot, { recursive: true });
  const heartbeatPath = path.join(controllerStateRoot, 'controller-liveness.json');
  if (controllerHeartbeat !== null) {
    writeFileSync(heartbeatPath, typeof controllerHeartbeat === 'string'
      ? controllerHeartbeat : JSON.stringify(controllerHeartbeat));
  }
  const db = new DatabaseSync(path.join(privateRoot, 'controller-v1.sqlite'));
  db.exec(`CREATE TABLE controller_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE delivery_events (sequence INTEGER PRIMARY KEY, task_id TEXT, cycle_no INTEGER, event_type TEXT,
      occurred_at TEXT, payload_json TEXT, previous_hash TEXT, event_hash TEXT);
    CREATE TABLE delivery_runs (task_id TEXT PRIMARY KEY, state TEXT, current_cycle INTEGER, base_commit TEXT,
      initial_head_commit TEXT, candidate_head_commit TEXT, updated_at TEXT, created_at TEXT);
    CREATE TABLE delivery_cycles (task_id TEXT, cycle_no INTEGER, state TEXT, PRIMARY KEY(task_id,cycle_no));
    CREATE TABLE delivery_nodes (task_id TEXT, cycle_no INTEGER, node_id TEXT, stage TEXT, role TEXT, state TEXT,
      attempt INTEGER, lease_epoch INTEGER, lease_owner TEXT, lease_expires_at TEXT, required_head_commit TEXT,
      candidate_head_commit TEXT, evidence_json TEXT, created_at TEXT, PRIMARY KEY(task_id,cycle_no,node_id));`);
  const lastHash = events.at(-1)?.event_hash ?? 'GENESIS';
  db.prepare('INSERT INTO controller_meta(key,value) VALUES (?,?)').run('schemaVersion', 'delivery-controller/v1');
  db.prepare('INSERT INTO controller_meta(key,value) VALUES (?,?)').run('eventChainHead', corruptHead ? 'f'.repeat(64) : lastHash);
  const insertEvent = db.prepare(`INSERT INTO delivery_events(sequence,task_id,cycle_no,event_type,occurred_at,payload_json,previous_hash,event_hash)
    VALUES(?,?,?,?,?,?,?,?)`);
  for (const item of events) insertEvent.run(item.sequence, item.task_id, item.cycle_no, item.event_type,
    item.occurred_at, item.payload_json, item.previous_hash, item.event_hash);
  for (const run of runs) {
    db.prepare(`INSERT INTO delivery_runs(task_id,state,current_cycle,base_commit,initial_head_commit,candidate_head_commit,updated_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(run.task_id, run.state, run.current_cycle, run.base_commit,
      run.initial_head_commit, run.candidate_head_commit, run.updated_at, run.updated_at);
    db.prepare('INSERT INTO delivery_cycles(task_id,cycle_no,state) VALUES(?,?,?)').run(run.task_id, run.current_cycle, run.cycle_state);
    for (const stage of run.stages) db.prepare(`INSERT INTO delivery_nodes(task_id,cycle_no,node_id,stage,role,state,attempt,lease_epoch,
      lease_owner,lease_expires_at,required_head_commit,candidate_head_commit,evidence_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(stage.task_id, stage.cycle_no, stage.node_id, stage.stage,
      stage.role, stage.state, stage.attempt, stage.lease_epoch, stage.lease_owner, stage.lease_expires_at,
      stage.required_head_commit, stage.candidate_head_commit, stage.evidence_json, run.updated_at);
  }
  db.close();
  return { root, privateRoot, heartbeatPath, databasePath: path.join(privateRoot, 'controller-v1.sqlite') };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function writeCiReceipt(repoRoot, taskId, { head = commit, baseCommit = base } = {}) {
  const receiptRoot = path.join(repoRoot, '.git', 'zuri-delivery-control', 'github-delivery-v1', 'receipts');
  const taskHash = hash(taskId);
  const revisionHash = hash(`${taskId}\n${baseCommit}\n${head}`);
  const taskDirectory = path.join(receiptRoot, taskHash);
  mkdirSync(taskDirectory, { recursive: true });
  const body = {
    schemaVersion: 'github-delivery-receipt/v1', sequence: 1, taskId, campaignDigest: 'c'.repeat(64),
    occurredAt: '2026-10-16T03:58:00.000Z', eventType: 'CI_OBSERVED',
    evidence: { headRefOid: head, baseRefOid: baseCommit, result: {
      code: 'CI_ACCEPTED', checked: [{ bucket: 'pass' }], failures: [], pending: [], unknown: [],
    } },
    previousHash: 'GENESIS',
  };
  const record = { ...body, hash: hash(JSON.stringify(stableValue(body))) };
  const file = path.join(taskDirectory, `${revisionHash}.jsonl`);
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  return file;
}

test('read-only snapshot verifies ledger without changing its SQLite bytes and reports local-only data', (t) => {
  const taskId = 'TASK-ZAI-101';
  const heartbeatEvent = event(1, taskId, 1, 'NODE_LEASE_HEARTBEAT', '2026-10-16T03:59:55.000Z', {
    nodeId: 'worker', ownerId: 'private-owner-id', fencingEpoch: 1, expiresAt: '2026-10-16T04:01:00.000Z',
  });
  const run = activeRun(taskId);
  const { root, databasePath, heartbeatPath } = createRepoWithLedger({ events: [heartbeatEvent], runs: [run] });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['tag', 'local-demo'], { cwd: root, stdio: 'ignore', windowsHide: true });
  const before = readFileSync(databasePath);
  const heartbeatBefore = readFileSync(heartbeatPath);
  const result = readWorkerObservability({ repoRoot: root, now: () => now });
  const after = readFileSync(databasePath);
  const heartbeatAfter = readFileSync(heartbeatPath);
  assert.deepEqual(after, before);
  assert.deepEqual(heartbeatAfter, heartbeatBefore);
  assert.equal(result.state, 'LIVE');
  assert.equal(result.summary.activeWorkers, 1);
  assert.equal(result.source.ciReceipts, 'NOT_CAPTURED');
  assert.equal(result.assignments[0].lease.state, 'FRESH');
  assert.equal(result.assignments[0].contextMemory.state, 'NOT_CAPTURED');
  assert.equal(result.source.controllerLiveness, 'VERIFIED');
  assert.deepEqual(result.localTags.map((tag) => tag.name), ['local-demo']);
  assert.match(result.localTagSetFingerprint, /^[A-F0-9]{64}$/);
  const serialized = JSON.stringify(result);
  for (const privateValue of ['private-owner-id', root, 'NODE_LEASE_HEARTBEAT']) assert.equal(serialized.includes(privateValue), false);
});

test('CI receipt source distinguishes unconfigured, verified-empty, and invalid sources', (t) => {
  const missing = createRepoWithLedger();
  t.after(() => rmSync(missing.root, { recursive: true, force: true }));
  assert.equal(readWorkerObservability({ repoRoot: missing.root, now: () => now }).source.ciReceipts, 'NOT_CAPTURED');

  mkdirSync(path.join(missing.privateRoot, 'github-delivery-v1'), { recursive: true });
  const empty = readWorkerObservability({ repoRoot: missing.root, now: () => now });
  assert.equal(empty.state, 'LIVE');
  assert.equal(empty.source.ciReceipts, 'VERIFIED_EMPTY');

  const invalid = createRepoWithLedger();
  t.after(() => rmSync(invalid.root, { recursive: true, force: true }));
  writeFileSync(path.join(invalid.privateRoot, 'github-delivery-v1'), 'not a directory');
  const unavailable = readWorkerObservability({ repoRoot: invalid.root, now: () => now });
  assert.equal(unavailable.state, 'UNKNOWN');
  assert.equal(unavailable.source.ciReceipts, 'UNKNOWN');
});

test('absent or invalid ledger returns an explicit UNKNOWN snapshot', (t) => {
  const absent = mkdtempSync(path.join(tmpdir(), 'zuri-worker-unknown-'));
  t.after(() => rmSync(absent, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: absent, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'unknown@example.invalid'], { cwd: absent, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Unknown'], { cwd: absent, stdio: 'ignore', windowsHide: true });
  writeFileSync(path.join(absent, 'x'), 'x');
  execFileSync('git', ['add', 'x'], { cwd: absent, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: absent, stdio: 'ignore', windowsHide: true });
  const result = readWorkerObservability({ repoRoot: absent, now: () => now });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.summary.mode, 'UNKNOWN');
  assert.equal(result.source.eventChain, 'UNKNOWN');
});

test('controller liveness heartbeat is required, valid, and no more than 15000 ms old', (t) => {
  const absent = createRepoWithLedger({ controllerHeartbeat: null });
  const invalid = createRepoWithLedger({ controllerHeartbeat: 'not-json' });
  const stale = createRepoWithLedger({ controllerHeartbeat: { schemaVersion: 'controller-liveness/v1',
    processId: 123, heartbeatAt: '2026-10-16T03:59:44.999Z' } });
  const freshAtLimit = createRepoWithLedger({ controllerHeartbeat: { schemaVersion: 'controller-liveness/v1',
    processId: 123, heartbeatAt: '2026-10-16T03:59:45.000Z' } });
  const future = createRepoWithLedger({ controllerHeartbeat: { schemaVersion: 'controller-liveness/v1',
    processId: 123, heartbeatAt: '2026-10-16T04:00:00.001Z' } });
  for (const fixture of [absent, invalid, stale, freshAtLimit, future]) {
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  }

  const read = (fixture) => readWorkerObservability({ repoRoot: fixture.root, now: () => now });
  assert.equal(read(absent).state, 'UNKNOWN');
  assert.equal(read(absent).reason, 'CONTROLLER_HEARTBEAT_ABSENT');
  assert.equal(read(absent).source.controllerLiveness, 'UNKNOWN');
  assert.equal(read(invalid).state, 'UNKNOWN');
  assert.equal(read(invalid).reason, 'CONTROLLER_HEARTBEAT_INVALID');
  assert.equal(read(stale).state, 'UNKNOWN');
  assert.equal(read(stale).reason, 'CONTROLLER_HEARTBEAT_STALE');
  assert.equal(read(freshAtLimit).state, 'LIVE');
  assert.equal(read(freshAtLimit).source.controllerLiveness, 'VERIFIED');
  assert.equal(read(future).state, 'UNKNOWN');
  assert.equal(read(future).reason, 'CONTROLLER_HEARTBEAT_INVALID');
});

test('invalid append-only controller event chain returns UNKNOWN instead of an empty LIVE event list', (t) => {
  const taskId = 'TASK-ZAI-001';
  const heartbeatEvent = event(1, taskId, 1, 'NODE_LEASE_HEARTBEAT', '2026-10-16T03:59:55.000Z', {
    nodeId: 'worker', ownerId: 'private-owner-id', fencingEpoch: 1, expiresAt: '2026-10-16T04:01:00.000Z',
  });
  const { root } = createRepoWithLedger({ events: [heartbeatEvent], runs: [activeRun(taskId)], corruptHead: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = readWorkerObservability({ repoRoot: root, now: () => now });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.source.eventChain, 'UNKNOWN');
  assert.deepEqual(result.events, []);
  assert.throws(() => readControllerEventProjection({ repoRoot: root, now: () => now }), /CONTROLLER_EVENT_SOURCE_UNAVAILABLE/);
});

test('event chain rejects sequence gaps, hash changes, and a mismatched stored head', () => {
  const first = event(1, 'TASK-ZAI-001', 1, 'TASK_REGISTERED', '2026-10-16T03:50:00.000Z', {});
  assert.equal(verifyControllerEventChain([first], first.event_hash).state, 'VERIFIED');
  assert.throws(() => verifyControllerEventChain([{ ...first, sequence: 2 }], first.event_hash), /CONTROLLER_EVENT_CHAIN_INVALID/);
  assert.throws(() => verifyControllerEventChain([{ ...first, payload_json: '{"changed":true}' }], first.event_hash), /CONTROLLER_EVENT_CHAIN_INVALID/);
  assert.throws(() => verifyControllerEventChain([first], 'f'.repeat(64)), /CONTROLLER_EVENT_CHAIN_INVALID/);
});

test('fresh heartbeat and fencing epoch are required for active workers', () => {
  const taskId = 'TASK-ZAI-001';
  const fresh = snapshot({ runs: [activeRun(taskId)], events: [heartbeat(taskId)] });
  assert.equal(fresh.summary.activeWorkers, 1);
  assert.equal(fresh.assignments[0].lease.state, 'FRESH');

  const missingProof = snapshot({ runs: [activeRun(taskId)] });
  assert.equal(missingProof.assignments[0].lease.state, 'UNKNOWN');
  assert.equal(missingProof.summary.mode, 'UNKNOWN');

  const stale = snapshot({ runs: [activeRun(taskId)], events: [heartbeat(taskId, { at: '2026-10-16T03:59:44.000Z' })] });
  assert.equal(stale.summary.activeWorkers, 0);
  assert.equal(stale.assignments[0].lease.state, 'STALE');
  assert.equal(stale.summary.mode, 'UNKNOWN');

  const wrongEpoch = snapshot({ runs: [activeRun(taskId)], events: [heartbeat(taskId, { epoch: 2 })] });
  assert.equal(wrongEpoch.summary.activeWorkers, 0);
  assert.equal(wrongEpoch.assignments[0].lease.state, 'UNKNOWN');
  assert.equal(wrongEpoch.summary.mode, 'UNKNOWN');

  const expiredAt = '2026-10-16T03:59:59.000Z';
  const expired = snapshot({ runs: [activeRun(taskId, { expiresAt: expiredAt })], events: [heartbeat(taskId, { expiresAt: expiredAt })] });
  assert.equal(expired.summary.activeWorkers, 0);
  assert.equal(expired.assignments[0].lease.state, 'EXPIRED');

  const inProgressWorker = activeRun('TASK-ZAI-008');
  inProgressWorker.candidate_head_commit = null;
  inProgressWorker.stages[0].candidate_head_commit = null;
  inProgressWorker.stages[0].required_head_commit = null;
  const headUnknown = snapshot({ runs: [inProgressWorker], events: [heartbeat('TASK-ZAI-008')] });
  assert.equal(headUnknown.assignments[0].checkedHeadCommit, null);
});

test('active run state without a matching current-cycle active node makes mode UNKNOWN', () => {
  const taskId = 'TASK-ZAI-011';
  const missingStage = activeRun(taskId);
  missingStage.stages = [];
  assert.equal(snapshot({ runs: [missingStage] }).summary.mode, 'UNKNOWN');

  const wrongCycle = activeRun(taskId);
  wrongCycle.stages[0].cycle_no = 0;
  assert.equal(snapshot({ runs: [wrongCycle] }).summary.mode, 'UNKNOWN');

  const invalidCycle = activeRun(taskId);
  invalidCycle.current_cycle = 0;
  assert.equal(snapshot({ runs: [invalidCycle] }).summary.mode, 'UNKNOWN');
});

test('READY-only queue and distinct-task overlapping leases determine idle, solo, and swarm', () => {
  const readyRun = activeRun('TASK-ZAI-002', { state: 'READY', runState: 'READY', role: 'verifier', stage: 'INDEPENDENT_VERIFICATION', nodeId: 'verifier' });
  const waitingRun = activeRun('TASK-ZAI-003', { state: 'WAITING', runState: 'WAITING', role: 'reviewer', stage: 'INDEPENDENT_REVIEW', nodeId: 'reviewer' });
  const queued = snapshot({ runs: [readyRun, waitingRun] });
  assert.equal(queued.summary.queuedWorkers, 1);
  assert.equal(queued.summary.mode, 'IDLE');

  const twoTaskEvents = [heartbeat('TASK-ZAI-001'), heartbeat('TASK-ZAI-004')];
  const swarm = snapshot({ runs: [activeRun('TASK-ZAI-001'), activeRun('TASK-ZAI-004')], events: twoTaskEvents });
  assert.equal(swarm.summary.activeWorkers, 2);
  assert.equal(swarm.summary.activeTasks, 2);
  assert.equal(swarm.summary.mode, 'SWARM');

  const sameTask = activeRun('TASK-ZAI-005');
  sameTask.stages.push({ ...sameTask.stages[0], node_id: 'reviewer', role: 'reviewer', stage: 'INDEPENDENT_REVIEW' });
  const solo = snapshot({ runs: [sameTask], events: [heartbeat('TASK-ZAI-005'), heartbeat('TASK-ZAI-005', { nodeId: 'reviewer' })] });
  assert.equal(solo.summary.activeWorkers, 2);
  assert.equal(solo.summary.activeTasks, 1);
  assert.equal(solo.summary.mode, 'SOLO');
});

test('truncated local tag snapshots retain a full-set fingerprint without claiming completeness', () => {
  const result = snapshot({ tags: { items: [{ name: 'tag-visible-in-window', objectId: commit }], totalCount: 201,
    truncated: true, fingerprint: 'c'.repeat(64) } });
  assert.equal(result.localTagCount, 201);
  assert.equal(result.localTagsTruncated, true);
  assert.equal(result.localTagSetFingerprint, 'C'.repeat(64));

  const noDigest = snapshot({ tags: { items: [{ name: 'tag-visible-in-window', objectId: commit }], totalCount: 201,
    truncated: true } });
  assert.equal(noDigest.localTagSetFingerprint, null);
});

test('CI receipts are reported only for exact head and base, with mismatches marked STALE', () => {
  const taskId = 'TASK-ZAI-009';
  const run = activeRun(taskId);
  const receipt = { taskId, cycleNo: 1, exactHeadCommit: commit, baseCommit: base, state: 'PASS',
    observedAt: '2026-10-16T03:58:00.000Z', checks: { passed: 8, failed: 0, pending: 0, unknown: 0 } };
  const exact = snapshot({ runs: [run], supervisor: { ciReceipts: [receipt] } });
  assert.equal(exact.tasks[0].ci.state, 'PASS');
  assert.equal(exact.tasks[0].ci.checks.passed, 8);
  const stale = snapshot({ runs: [run], supervisor: { ciReceipts: [{ ...receipt, exactHeadCommit: 'c'.repeat(40) }] } });
  assert.equal(stale.tasks[0].ci.state, 'STALE');
});

test('verified exact-head CI receipt is projected locally and a broken receipt chain returns UNKNOWN', (t) => {
  const taskId = 'TASK-ZAI-010';
  const run = activeRun(taskId);
  const { root } = createRepoWithLedger({ runs: [run] });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receiptFile = writeCiReceipt(root, taskId);

  const exact = readWorkerObservability({ repoRoot: root, now: () => now });
  assert.equal(exact.state, 'LIVE');
  assert.equal(exact.source.ciReceipts, 'VERIFIED');
  assert.equal(exact.tasks[0].ci.state, 'PASS');
  assert.equal(exact.events.find((item) => item.kind === 'CI_OBSERVED')?.status, 'PASS');

  const staleRun = { ...run, candidate_head_commit: 'd'.repeat(40) };
  const { root: staleRoot } = createRepoWithLedger({ runs: [staleRun] });
  t.after(() => rmSync(staleRoot, { recursive: true, force: true }));
  writeCiReceipt(staleRoot, taskId);
  const stale = readWorkerObservability({ repoRoot: staleRoot, now: () => now });
  assert.equal(stale.tasks[0].ci.state, 'STALE');
  assert.equal(stale.events.find((item) => item.kind === 'CI_OBSERVED')?.status, 'STALE');

  const record = JSON.parse(readFileSync(receiptFile, 'utf8'));
  record.evidence.result.code = 'CI_CHECK_NOT_ACCEPTED';
  writeFileSync(receiptFile, `${JSON.stringify(record)}\n`);
  const invalid = readWorkerObservability({ repoRoot: root, now: () => now });
  assert.equal(invalid.state, 'UNKNOWN');
  assert.equal(invalid.reason, 'GITHUB_RECEIPT_CHAIN_INVALID');
});

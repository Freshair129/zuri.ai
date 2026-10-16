import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { publicControllerSnapshot, startControllerDashboard, startControllerLivenessHeartbeat } from '../delivery-control/controller-dashboard.mjs';
test('public snapshot excludes private configuration and non-code failure reasons', () => {
  const snapshot = publicControllerSnapshot([{ taskId: 'T1', status: 'RUNNING', prompt: 'secret', worktree: '/private',
    nodes: [{ stage: 'worker', status: 'RUNNING', attempt: 1, reason: '/secret/path', token: 'secret' }] }]);
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
  assert.equal(snapshot.runs[0].nodes[0].reason, null);
});
test('public snapshot admits sanitized stale CI observations without exposing revision bindings', () => {
  const snapshot = publicControllerSnapshot([], [{ taskId: 'TASK-ZAI-010', cycleNo: 2, role: 'delivery',
    kind: 'CI_OBSERVED', status: 'STALE', observedAt: '2026-10-16T04:00:00.000Z', sequence: 7,
    exactHeadCommit: 'private-head', baseCommit: 'private-base' }]);
  assert.deepEqual(snapshot.events, [{ taskId: 'TASK-ZAI-010', cycleNo: 2, role: 'delivery', kind: 'CI_OBSERVED',
    status: 'STALE', observedAt: '2026-10-16T04:00:00.000Z', sequence: 7 }]);
  assert.equal(JSON.stringify(snapshot).includes('private-head'), false);
  assert.equal(JSON.stringify(snapshot).includes('private-base'), false);
});
test('loopback web is read-only, no-store and rejects cross-origin and rebinding requests', async (t) => {
  const server = await startControllerDashboard({ readRuns: () => [], port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${url}/api/state`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await response.json()).runs, []);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { Host: 'evil.invalid' } }, (res) => { res.resume(); resolve(res.statusCode); });
    request.on('error', reject);
  });
  assert.equal(status, 403);
});

test('unavailable or invalid event source is surfaced as unavailable, not a verified empty feed', async (t) => {
  const server = await startControllerDashboard({ readRuns: () => [], readEvents: () => { throw new Error('private detail'); }, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/state`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { code: 'STATE_UNAVAILABLE' });
});

test('controller serve liveness is atomically refreshed in its private state directory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-liveness-test-'));
  const stateRoot = path.join(root, 'controller-v1');
  let timestamp = new Date('2026-10-16T04:00:00.000Z');
  let publisher;
  t.after(() => { publisher?.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  publisher = startControllerLivenessHeartbeat({ stateRoot, processId: 999, intervalMs: 5, now: () => timestamp });
  const first = JSON.parse(fs.readFileSync(publisher.heartbeatFile, 'utf8'));
  assert.deepEqual(first, { schemaVersion: 'controller-liveness/v1', processId: 999,
    heartbeatAt: '2026-10-16T04:00:00.000Z' });

  timestamp = new Date('2026-10-16T04:00:01.000Z');
  await new Promise((resolve) => setTimeout(resolve, 25));
  const second = JSON.parse(fs.readFileSync(publisher.heartbeatFile, 'utf8'));
  assert.equal(second.heartbeatAt, timestamp.toISOString());
  assert.deepEqual(fs.readdirSync(stateRoot), ['controller-liveness.json']);
  assert.throws(() => startControllerLivenessHeartbeat({ stateRoot, intervalMs: 5001 }), /between 1 and 5000 ms/);
});

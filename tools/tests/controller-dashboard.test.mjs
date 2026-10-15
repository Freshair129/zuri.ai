import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { publicControllerSnapshot, startControllerDashboard } from '../delivery-control/controller-dashboard.mjs';
test('public snapshot excludes private configuration and non-code failure reasons', () => {
  const snapshot = publicControllerSnapshot([{ taskId: 'T1', status: 'RUNNING', prompt: 'secret', worktree: '/private',
    nodes: [{ stage: 'worker', status: 'RUNNING', attempt: 1, reason: '/secret/path', token: 'secret' }] }]);
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
  assert.equal(snapshot.runs[0].nodes[0].reason, null);
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

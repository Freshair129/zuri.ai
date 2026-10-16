import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { projectWorkerObservability } from '../delivery-control/worker-observability-reader.mjs';
import {
  publishWorkerObservabilitySnapshot,
  startWorkerObservabilityPublisher,
  WORKER_OBSERVABILITY_EXPORT_FILENAME,
} from '../delivery-control/worker-observability-publisher.mjs';

const now = new Date('2026-10-16T04:00:00.000Z');

function privateProjectionFixture() {
  const privateValues = [
    'private prompt payload',
    'C:\\private\\session\\state.json',
    'session-identity-secret',
    'lease-owner-secret',
    'credential-secret',
  ];
  const snapshot = projectWorkerObservability({
    runs: [{
      task_id: 'TASK-ZAI-119', state: 'RUNNING', current_cycle: 11,
      base_commit: 'a'.repeat(40), candidate_head_commit: 'b'.repeat(40),
      updated_at: now.toISOString(),
      stages: [{
        task_id: 'TASK-ZAI-119', cycle_no: 11, node_id: 'worker', stage: 'IMPLEMENTATION', role: 'worker',
        state: 'RUNNING', attempt: 1, lease_epoch: 1, lease_owner: privateValues[3],
        lease_expires_at: new Date(now.getTime() + 30_000).toISOString(),
        required_head_commit: 'b'.repeat(40), candidate_head_commit: 'b'.repeat(40),
        prompt: privateValues[0], sessionPath: privateValues[1], credential: privateValues[4],
      }],
    }],
    events: [{
      sequence: 1, task_id: 'TASK-ZAI-119', cycle_no: 11, event_type: 'TASK_REGISTERED',
      occurred_at: now.toISOString(), payload_json: JSON.stringify({
        prompt: privateValues[0], sessionPath: privateValues[1], sessionId: privateValues[2],
        credential: privateValues[4],
      }),
    }],
    now,
    localStatus: {
      changedFiles: 0,
      fingerprint: null,
      headCommit: 'a'.repeat(40),
      observedAt: now.toISOString(),
    },
  });
  return { snapshot, privateValues };
}

test('atomically publishes the sanitized projection without private raw values', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zuri-worker-export-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { snapshot, privateValues } = privateProjectionFixture();

  const published = publishWorkerObservabilitySnapshot({
    repoRoot: 'C:\\zuri\\repo',
    exportDirectory: directory,
    readSnapshot: () => snapshot,
    now: () => now,
  });

  assert.equal(published.destination, path.join(directory, WORKER_OBSERVABILITY_EXPORT_FILENAME));
  assert.equal(published.snapshot.state, 'LIVE');
  const serialized = readFileSync(published.destination, 'utf8');
  assert.deepEqual(JSON.parse(serialized), snapshot);
  for (const privateValue of privateValues) assert.equal(serialized.includes(privateValue), false);
  assert.deepEqual(readdirSync(directory), [WORKER_OBSERVABILITY_EXPORT_FILENAME]);
});

test('replaces projections with unknown fields at any depth with a redacted UNKNOWN snapshot', (t) => {
  const { snapshot, privateValues } = privateProjectionFixture();
  const contaminated = [
    { ...snapshot, prompt: privateValues[0] },
    structuredClone(snapshot),
  ];
  contaminated[1].events[0].credential = privateValues[4];

  for (const candidate of contaminated) {
    const directory = mkdtempSync(path.join(tmpdir(), 'zuri-worker-export-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const { snapshot: publishedSnapshot, destination } = publishWorkerObservabilitySnapshot({
      repoRoot: 'C:\\zuri\\repo',
      exportDirectory: directory,
      readSnapshot: () => candidate,
      now: () => now,
    });
    const serialized = readFileSync(destination, 'utf8');

    assert.equal(publishedSnapshot.state, 'UNKNOWN');
    assert.equal(JSON.parse(serialized).state, 'UNKNOWN');
    for (const privateValue of privateValues) assert.equal(serialized.includes(privateValue), false);
  }
});

test('accepts reader-generated assignment references beyond three digits', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zuri-worker-export-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { snapshot } = privateProjectionFixture();
  const assignment = { ...snapshot.assignments[0], assignmentRef: 'worker-1000' };

  const published = publishWorkerObservabilitySnapshot({
    repoRoot: 'C:\\zuri\\repo',
    exportDirectory: directory,
    readSnapshot: () => ({ ...snapshot, assignments: [assignment] }),
    now: () => now,
  });

  assert.equal(published.snapshot.state, 'LIVE');
  assert.equal(published.snapshot.assignments[0].assignmentRef, 'worker-1000');
});

test('publishes UNKNOWN when the host reader cannot verify its source', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zuri-worker-export-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const { snapshot, destination } = publishWorkerObservabilitySnapshot({
    repoRoot: 'C:\\zuri\\repo',
    exportDirectory: directory,
    readSnapshot: () => { throw new Error('controller unavailable'); },
    now: () => now,
  });

  assert.equal(snapshot.state, 'UNKNOWN');
  assert.equal(JSON.parse(readFileSync(destination, 'utf8')).schemaVersion, 'worker-observability/v1');
});

test('starts with an immediate export and stops its bounded publisher timer', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zuri-worker-export-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { snapshot } = privateProjectionFixture();
  let reads = 0;
  const publisher = startWorkerObservabilityPublisher({
    repoRoot: 'C:\\zuri\\repo',
    exportDirectory: directory,
    intervalMs: 10,
    readSnapshot: () => { reads += 1; return snapshot; },
  });
  assert.equal(reads, 1);
  await new Promise((resolve) => setTimeout(resolve, 35));
  publisher.stop();
  const stoppedAt = reads;
  await new Promise((resolve) => setTimeout(resolve, 25));
  publisher.stop();
  assert.ok(stoppedAt > 1);
  assert.equal(reads, stoppedAt);
});

test('rejects a publisher interval longer than five seconds', () => {
  assert.throws(() => startWorkerObservabilityPublisher({
    repoRoot: 'C:\\zuri\\repo',
    exportDirectory: 'C:\\zuri\\export',
    intervalMs: 5_001,
  }), /publication interval/);
});

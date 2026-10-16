import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  resolveWorkerObservabilityExportDirectory,
  resolveWorkerObservabilityPublishIntervalMs,
  startConfiguredWorkerObservabilityPublisher,
} from '../delivery-control/controller-cli.mjs';

test('resolves the dedicated export directory alongside apps/server', () => {
  const repoRoot = path.resolve('C:\\zuri\\repo');
  assert.equal(resolveWorkerObservabilityExportDirectory(repoRoot),
    path.join(repoRoot, 'apps', 'server', '.worker-observability.local'));
});

test('keeps the configured publication interval at or below five seconds', () => {
  assert.equal(resolveWorkerObservabilityPublishIntervalMs(undefined), 2_000);
  assert.equal(resolveWorkerObservabilityPublishIntervalMs(100), 100);
  assert.equal(resolveWorkerObservabilityPublishIntervalMs(12_000), 5_000);
  assert.equal(resolveWorkerObservabilityPublishIntervalMs(0), 2_000);
});

test('starts the sanitized export publisher from the serve configuration', () => {
  const repoRoot = path.resolve('C:\\zuri\\repo');
  let received;
  const token = { stop() {} };
  const result = startConfiguredWorkerObservabilityPublisher({
    repoRoot,
    config: { workerObservabilityPublishIntervalMs: 8_000 },
    startPublisher: (options) => { received = options; return token; },
  });

  assert.equal(result, token);
  assert.equal(received.repoRoot, repoRoot);
  assert.equal(received.exportDirectory, path.join(repoRoot, 'apps', 'server', '.worker-observability.local'));
  assert.equal(received.intervalMs, 5_000);
});

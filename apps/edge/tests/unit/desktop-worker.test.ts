import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDesktopWorkerCommand, parseDesktopWorkerInit } from '../../src/desktop-worker.js';

const init = (overrides: Record<string, unknown> = {}) => ({
  type: 'initialize',
  version: 1,
  deviceId: 'DEV-DESKTOP-01',
  deviceKey: 'edgk_synthetic_test_credential',
  cloudBaseUrl: 'https://zuri.example',
  dataRoot: 'C:\\Users\\pc\\AppData\\Local\\Zuri\\runtime',
  ragUrl: 'http://127.0.0.1:8888',
  pollIntervalMs: 5000,
  heartbeatIntervalMs: 40000,
  provider: { llmEnabled: false, llmAllowCloud: false, headlessEnabled: false, headlessBin: 'claude' },
  ...overrides,
});

test('Desktop init is bounded, loopback-scoped, and keeps the key in the private contract', () => {
  const parsed = parseDesktopWorkerInit(init());
  assert.equal(parsed.deviceKey, 'edgk_synthetic_test_credential');
  assert.equal(parsed.provider.headlessEnabled, false);
  assert.throws(() => parseDesktopWorkerInit(init({ cloudBaseUrl: 'https://user:pass@zuri.example' })), /INVALID_CLOUD_ORIGIN/);
  assert.throws(() => parseDesktopWorkerInit(init({ ragUrl: 'https://public.example' })), /INVALID_INIT/);
  assert.throws(() => parseDesktopWorkerInit(init({ deviceKey: 'not-a-device-key' })), /INVALID_INIT/);
});

test('Desktop control accepts only stop and heartbeat, with a bounded stop deadline', () => {
  assert.deepEqual(parseDesktopWorkerCommand({ type: 'heartbeat', version: 1 }), {
    type: 'heartbeat', version: 1,
  });
  assert.equal(parseDesktopWorkerCommand({ type: 'stop', version: 1, deadlineMs: 1000 }).deadlineMs, 1000);
  assert.throws(() => parseDesktopWorkerCommand({ type: 'stop', version: 1, deadlineMs: 300001 }), /INVALID_MESSAGE/);
  assert.throws(() => parseDesktopWorkerCommand({ type: 'run', version: 1, command: 'format' }), /INVALID_MESSAGE/);
});


// Contract for periodic liveness reporting.
//
// This exists because the heartbeat had no caller at all: the method was on the interface,
// implemented twice, and invoked from nowhere in src/. A call no one makes cannot fail visibly,
// which is why it was posting to a 404 route undetected. These tests pin the properties that make
// the reporting mean something once it is actually wired: that it repeats inside the cloud's
// liveness window, and that it can never take down the process it reports for.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  startHeartbeat,
  resolveIntervalMs,
  CLOUD_ONLINE_WINDOW_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from '../../src/zuri-api/heartbeat.js';
import type { HeartbeatPayload } from '../../src/zuri-api/types.js';

/** A controllable interval: nothing fires until the test says so. */
function fakeTimers() {
  let handler: (() => void) | null = null;
  let cleared = false;
  let requestedMs: number | undefined;
  return {
    // Deliberately not named intervalMs: the helper is spread into HeartbeatOptions, and a
    // matching name would overwrite the very value under test.
    get requestedIntervalMs() {
      return requestedMs;
    },
    get cleared() {
      return cleared;
    },
    fire() {
      handler?.();
    },
    setIntervalFn: ((fn: () => void, ms?: number) => {
      handler = fn;
      requestedMs = ms;
      return { unref() {} } as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval,
    clearIntervalFn: (() => {
      cleared = true;
    }) as unknown as typeof clearInterval,
  };
}

function recordingClient(behaviour: () => Promise<{ acknowledged: boolean }> = async () => ({ acknowledged: true })) {
  const sent: HeartbeatPayload[] = [];
  return {
    sent,
    client: {
      async sendHeartbeat(payload: HeartbeatPayload) {
        sent.push(payload);
        return behaviour();
      },
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('heartbeat interval', () => {
  it('stays under the window zuri-ai uses to decide a device is gone', () => {
    assert.ok(
      DEFAULT_HEARTBEAT_INTERVAL_MS < CLOUD_ONLINE_WINDOW_MS,
      'a heartbeat slower than the window can never keep a device online',
    );
  });

  it('leaves room for a missed tick, so one blip does not read as death', () => {
    // Two consecutive intervals must still fit inside the window.
    assert.ok(DEFAULT_HEARTBEAT_INTERVAL_MS * 2 < CLOUD_ONLINE_WINDOW_MS);
  });

  it('clamps a configured interval that would break the report rather than honouring it', () => {
    assert.strictEqual(resolveIntervalMs(10 * 60_000), CLOUD_ONLINE_WINDOW_MS / 2);
    assert.ok(resolveIntervalMs(10 * 60_000) * 2 <= CLOUD_ONLINE_WINDOW_MS);
  });

  it('refuses a zero or negative interval instead of spinning', () => {
    for (const bad of [0, -1, Number.NaN, undefined]) {
      assert.strictEqual(resolveIntervalMs(bad), DEFAULT_HEARTBEAT_INTERVAL_MS, `rejected ${bad}`);
    }
  });

  it('keeps a deliberately short interval, so an operator can still tighten it', () => {
    assert.strictEqual(resolveIntervalMs(10_000), 10_000);
  });
});

describe('heartbeat reporting', () => {
  it('announces immediately rather than waiting out the first interval', async () => {
    const { sent, client } = recordingClient();
    const timers = fakeTimers();
    startHeartbeat({ client, deviceId: 'DEV-01', ...timers });
    await flush();
    assert.strictEqual(sent.length, 1, 'a restart should show as online without a delay');
  });

  it('repeats on the interval and reports the device it is speaking for', async () => {
    const { sent, client } = recordingClient();
    const timers = fakeTimers();
    startHeartbeat({ client, deviceId: 'DEV-01', ...timers });
    await flush();
    // Settling between beats, because real ones are 40s apart — firing them back to back would be
    // testing the in-flight guard instead, which has its own case below.
    timers.fire();
    await flush();
    timers.fire();
    await flush();
    assert.strictEqual(sent.length, 3);
    for (const payload of sent) {
      assert.strictEqual(payload.deviceId, 'DEV-01');
      assert.strictEqual(payload.status, 'healthy');
      assert.strictEqual(payload.contractVersion, '0.1.0b');
    }
  });

  it('omits businessId, which the credential supplies and a mismatch would 403', async () => {
    const { sent, client } = recordingClient();
    const timers = fakeTimers();
    startHeartbeat({ client, deviceId: 'DEV-01', ...timers });
    await flush();
    assert.ok(!Object.hasOwn(sent[0] as object, 'businessId'));
  });

  it('survives a failing cloud — telemetry must never take down the webhook', async () => {
    let calls = 0;
    const { client } = recordingClient(async () => {
      calls += 1;
      throw new Error('Zuri API request failed (503)');
    });
    const events: Array<{ ok: boolean; reason?: string }> = [];
    const timers = fakeTimers();
    startHeartbeat({ client, deviceId: 'DEV-01', onEvent: (e) => events.push(e), ...timers });
    await flush();
    timers.fire();
    await flush();

    assert.strictEqual(calls, 2, 'a failure does not stop the schedule');
    assert.deepEqual(
      events.map((e) => e.ok),
      [false, false],
    );
    assert.match(events[0].reason ?? '', /503/, 'the reason is reported, not swallowed silently');
  });

  // The bug this replaces: `status` was the literal 'healthy' on every beat. Ollama's server died
  // while its tray app kept running, every answer fell back to the pattern reader, and the console
  // showed a green device the whole time.
  it('reports what the probe says, not a constant', async () => {
    const { sent, client } = recordingClient();
    const timers = fakeTimers();
    let health: 'healthy' | 'degraded' | 'unavailable' = 'healthy';
    startHeartbeat({ client, deviceId: 'DEV-01', status: () => health, ...timers });
    await flush();
    health = 'degraded';
    timers.fire();
    await flush();
    assert.deepEqual(sent.map((p) => p.status), ['healthy', 'degraded']);
  });

  it('reports degraded when the probe itself throws, rather than going quiet', async () => {
    const { sent, client } = recordingClient();
    const timers = fakeTimers();
    startHeartbeat({
      client,
      deviceId: 'DEV-01',
      status: () => { throw new Error('cannot assess'); },
      ...timers,
    });
    await flush();
    assert.strictEqual(sent.length, 1, 'a device that cannot assess itself still reports');
    assert.strictEqual(sent[0].status, 'degraded');
  });

  // Without the guard, a cloud that accepts the connection and never answers accumulates one hung
  // request per interval while onEvent reports nothing — silent for minutes, at exactly the moment
  // the device has already been marked offline.
  it('skips a beat rather than stacking one on top of a request that has not returned', async () => {
    let release: (() => void) | undefined;
    const { sent, client } = recordingClient(
      () => new Promise((resolve) => { release = () => resolve({ acknowledged: true }); }),
    );
    const events: Array<{ ok: boolean; reason?: string }> = [];
    const timers = fakeTimers();
    startHeartbeat({ client, deviceId: 'DEV-01', onEvent: (e) => events.push(e), ...timers });
    await flush();
    assert.strictEqual(sent.length, 1, 'the first beat is in flight');

    timers.fire();
    timers.fire();
    await flush();
    assert.strictEqual(sent.length, 1, 'no second request while the first is outstanding');
    assert.strictEqual(events.filter((e) => /in flight/.test(e.reason ?? '')).length, 2, 'and it says so');

    release?.();
    await flush();
    timers.fire();
    await flush();
    assert.strictEqual(sent.length, 2, 'the next beat proceeds once the first settles');
  });

  it('stops when told to, so a shutdown does not leave a timer reporting a dead server', async () => {
    const { sent, client } = recordingClient();
    const timers = fakeTimers();
    const stop = startHeartbeat({ client, deviceId: 'DEV-01', ...timers });
    await flush();
    stop();
    assert.ok(timers.cleared);
    assert.strictEqual(sent.length, 1);
  });

  it('passes the requested interval through to the timer', async () => {
    const { client } = recordingClient();
    const timers = fakeTimers();
    startHeartbeat({ client, deviceId: 'DEV-01', intervalMs: 15_000, ...timers });
    await flush();
    assert.strictEqual(timers.requestedIntervalMs, 15_000);
  });
});

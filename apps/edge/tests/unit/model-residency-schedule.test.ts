// @req FR-244 — the residency schedule: what actually decides when `warm`/`release`
//   fire from the polled directive. Pins the change-only rule (no repeated calls
//   while the directive stays the same) and that a failed poll never throws.
// @spec ADR-094 D6 option A
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startModelResidencySchedule, resolveResidencyIntervalMs } from '../../src/answer/providers/model-residency-schedule.js';

/** A controllable interval: nothing fires until the test says so (same helper shape as heartbeat.test.ts). */
function fakeTimers() {
  let handler: (() => void) | null = null;
  let cleared = false;
  return {
    get cleared() { return cleared; },
    fire() { handler?.(); },
    setIntervalFn: ((fn: () => void) => { handler = fn; return { unref() {} } as unknown as NodeJS.Timeout; }) as unknown as typeof setInterval,
    clearIntervalFn: (() => { cleared = true; }) as unknown as typeof clearInterval,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('model residency schedule', () => {
  it('clamps a missing/invalid interval to the default, and a tiny one to the floor', () => {
    assert.equal(resolveResidencyIntervalMs(undefined), 60_000);
    assert.equal(resolveResidencyIntervalMs(0), 60_000);
    assert.equal(resolveResidencyIntervalMs(-5), 60_000);
    assert.equal(resolveResidencyIntervalMs(1), 5_000);
    assert.equal(resolveResidencyIntervalMs(120_000), 120_000);
  });

  it('fires immediately on start, warming on true and releasing on false', async () => {
    const timers = fakeTimers();
    const calls: string[] = [];
    startModelResidencySchedule({
      shouldBeWarm: async () => true, warm: () => calls.push('warm'), release: () => calls.push('release'),
      ...timers,
    });
    await flush();
    assert.deepEqual(calls, ['warm']);
  });

  it('acts only on a change from the last known directive, never repeating a call', async () => {
    const timers = fakeTimers();
    const calls: string[] = [];
    let warm = true;
    startModelResidencySchedule({
      shouldBeWarm: async () => warm, warm: () => calls.push('warm'), release: () => calls.push('release'),
      ...timers,
    });
    await flush();
    assert.deepEqual(calls, ['warm']);

    // Same directive again: no repeated call.
    timers.fire(); await flush();
    assert.deepEqual(calls, ['warm']);

    // Directive flips: exactly one release.
    warm = false;
    timers.fire(); await flush();
    assert.deepEqual(calls, ['warm', 'release']);

    // Flips back: exactly one warm.
    warm = true;
    timers.fire(); await flush();
    assert.deepEqual(calls, ['warm', 'release', 'warm']);
  });

  it('skips a poll already in flight rather than queueing it', async () => {
    const timers = fakeTimers();
    let resolveFirst: (() => void) | null = null;
    let pollCount = 0;
    startModelResidencySchedule({
      shouldBeWarm: () => { pollCount += 1; return new Promise((resolve) => { resolveFirst = () => resolve(true); }); },
      warm: () => {}, release: () => {}, ...timers,
    });
    await flush();
    timers.fire(); // fires while the first poll is still pending
    await flush();
    assert.equal(pollCount, 1);
    resolveFirst!();
    await flush();
  });

  it('swallows a failed poll and reports it through onEvent, never throwing', async () => {
    const timers = fakeTimers();
    const events: Array<{ ok: boolean; reason?: string }> = [];
    assert.doesNotThrow(() => startModelResidencySchedule({
      shouldBeWarm: async () => { throw new Error('CONVERSATION_NETWORK_FAILED'); },
      warm: () => {}, release: () => {}, onEvent: (event) => events.push(event), ...timers,
    }));
    await flush();
    assert.equal(events.length, 1);
    assert.equal(events[0].ok, false);
    assert.equal(events[0].reason, 'CONVERSATION_NETWORK_FAILED');
  });

  it('returns a stop function that clears the timer', () => {
    const timers = fakeTimers();
    const stop = startModelResidencySchedule({ shouldBeWarm: async () => true, warm: () => {}, release: () => {}, ...timers });
    assert.equal(timers.cleared, false);
    stop();
    assert.equal(timers.cleared, true);
  });
});

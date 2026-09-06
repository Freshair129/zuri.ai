import type { IZuriApiClient } from './client.js';

/**
 * Periodic liveness reporting for this device.
 *
 * The client has been able to send a heartbeat for as long as it has existed, and nothing ever
 * called it — the method was on the interface, implemented twice, and invoked from nowhere in
 * `src/`. So the cloud's Edge tab could only ever show this device as absent, and the route being
 * wrong went unnoticed for exactly that reason: a call no one makes cannot fail visibly.
 *
 * It has to repeat rather than fire once at startup. zuri-ai marks a device offline once its last
 * heartbeat is older than EDGE_DEVICE_ONLINE_WINDOW_MS, which is 120s, so a single announcement at
 * boot would show the device online for two minutes and absent for the rest of its uptime — worse
 * than never reporting, because it looks like a device that keeps dying.
 */

/** zuri-ai's liveness window (EDGE_DEVICE_ONLINE_WINDOW_MS in its edge-device-registry). */
export const CLOUD_ONLINE_WINDOW_MS = 120_000;

/**
 * Comfortably inside the window at roughly a third of it, so the device survives two consecutive
 * failed ticks — a restart of the cloud container, or a blip on the way to it — without ever
 * appearing to have gone away.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 40_000;

/** Leaves room for one whole missed tick inside the window; past this a single blip reads as death. */
const MAX_INTERVAL_MS = Math.floor(CLOUD_ONLINE_WINDOW_MS / 2);
const MIN_INTERVAL_MS = 5_000;

/** The vocabulary zuri-ai accepts, and audits transitions between. */
export type EdgeStatus = 'healthy' | 'degraded' | 'unavailable';

export interface HeartbeatOptions {
  client: Pick<IZuriApiClient, 'sendHeartbeat'>;
  deviceId: string;
  intervalMs?: number;
  /**
   * What to report. Defaults to `healthy`, which is what this used to send unconditionally — and
   * that is the bug: it reported a green device while ollama's server was dead and every answer was
   * silently falling back to the pattern reader. The cloud has had `degraded` and `unavailable` all
   * along and audits the transitions; not using them made the Edge tab a check that the process
   * exists rather than a check that it works.
   *
   * Failure here is not a reason to skip the beat: a probe that throws means the device could not
   * assess itself, which is `degraded` — going quiet would read as gone.
   */
  status?: () => Promise<EdgeStatus> | EdgeStatus;
  /** Reported alongside each tick so the console shows what this device is running. */
  registeredQueries?: string[];
  approvedTemplates?: string[];
  onEvent?: (event: { ok: boolean; ms: number; reason?: string; status?: EdgeStatus }) => void;
  /** Injectable for tests; defaults to the real timers. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/**
 * Clamp into the range where the report actually means something.
 *
 * An interval above half the cloud's window is not a slower heartbeat, it is an unreliable one:
 * one dropped tick and the device reads as offline until the next success. Rather than honour a
 * number that quietly breaks the feature, this pins it to the widest spacing that still tolerates
 * a miss. The floor exists for the opposite mistake — a `0` or a negative would spin.
 */
export function resolveIntervalMs(requested: number | undefined): number {
  if (!Number.isFinite(requested) || !requested || requested <= 0) return DEFAULT_HEARTBEAT_INTERVAL_MS;
  return Math.min(Math.max(Math.floor(requested), MIN_INTERVAL_MS), MAX_INTERVAL_MS);
}

/**
 * Begin reporting liveness. Returns a stop function.
 *
 * Fires once immediately so the console reflects a fresh start without waiting out an interval,
 * then repeats. Every failure is swallowed after being reported through `onEvent`: liveness
 * reporting is telemetry, and telemetry that can take down the process that serves customers is a
 * worse bug than the silence it replaces.
 */
export function startHeartbeat(options: HeartbeatOptions): () => void {
  const {
    client,
    deviceId,
    registeredQueries = [],
    approvedTemplates = [],
    onEvent,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = options;
  const intervalMs = resolveIntervalMs(options.intervalMs);
  const readStatus = options.status ?? (() => 'healthy' as EdgeStatus);

  /*
   * One beat at a time.
   *
   * `setInterval` fires regardless of whether the last call settled. Without this, a cloud that
   * accepts the connection and never answers accumulates one hung request per interval while
   * `onEvent` reports nothing at all — so the log goes silent for minutes at exactly the moment the
   * device has already been marked offline. Skipping is the right answer rather than queueing:
   * a heartbeat describes now, and a backlog of them describes nothing.
   */
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) {
      onEvent?.({ ok: false, ms: 0, reason: 'previous heartbeat still in flight' });
      return;
    }
    inFlight = true;
    const started = Date.now();
    try {
      let status: EdgeStatus;
      try {
        status = await readStatus();
      } catch {
        status = 'degraded';
      }
      await client.sendHeartbeat({
        contractVersion: '0.1.0b',
        deviceId,
        status,
        registeredQueries,
        approvedTemplates,
        timestamp: new Date().toISOString(),
      });
      onEvent?.({ ok: true, ms: Date.now() - started, status });
    } catch (error) {
      onEvent?.({
        ok: false,
        ms: Date.now() - started,
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const timer = setIntervalFn(() => void tick(), intervalMs);
  // Never a reason to hold the process open: if everything else has finished, this machine has
  // nothing left to be alive for.
  (timer as unknown as { unref?: () => void }).unref?.();

  return () => clearIntervalFn(timer);
}

/**
 * Drives `warm`/`release` from the cloud's aggregate residency directive (FR-244,
 * ADR-094 D6 option A).
 *
 * Same shape as `startHeartbeat` on purpose — one in-flight poll at a time, an
 * immediate first tick so a restart converges without waiting out an interval,
 * every failure swallowed and reported through `onEvent` rather than raised,
 * `unref()`'d so it is never a reason to hold the process open, and a stop
 * function for clean shutdown.
 *
 * The one difference: this acts only on a *change* from the last known
 * directive. Calling `warmModel` every poll while the model is already pinned
 * is a harmless no-op against Ollama, but Ollama's own log fills with a
 * `keep_alive` request every tick for no observable effect, so the first
 * successful poll (to correct drift from the always-warm default a fresh
 * process starts in) and every state change after it are the only calls made.
 */

export interface ModelResidencyScheduleOptions {
  /** Wraps the residency client's own network/contract errors; never throws. */
  shouldBeWarm: () => Promise<boolean>;
  /** Fire-and-forget, same shape as desktop-worker's own `triggerWarm`. */
  warm: () => void;
  /** Fire-and-forget release. */
  release: () => void;
  intervalMs?: number;
  onEvent?: (event: { ok: boolean; shouldBeWarm?: boolean; changed?: boolean; reason?: string }) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 5_000;

export function resolveResidencyIntervalMs(requested: number | undefined): number {
  if (!Number.isFinite(requested) || !requested || requested <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(Math.floor(requested), MIN_INTERVAL_MS);
}

export function startModelResidencySchedule(options: ModelResidencyScheduleOptions): () => void {
  const { shouldBeWarm, warm, release, onEvent, setIntervalFn = setInterval, clearIntervalFn = clearInterval } = options;
  const intervalMs = resolveResidencyIntervalMs(options.intervalMs);
  let inFlight = false;
  let lastKnown: boolean | null = null;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const warmNow = await shouldBeWarm();
      const changed = warmNow !== lastKnown;
      if (changed) (warmNow ? warm : release)();
      lastKnown = warmNow;
      onEvent?.({ ok: true, shouldBeWarm: warmNow, changed });
    } catch (error) {
      onEvent?.({ ok: false, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const timer = setIntervalFn(() => void tick(), intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => clearIntervalFn(timer);
}

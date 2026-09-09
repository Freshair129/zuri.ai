// @req FR-149, FR-152 — the polling cadence the supervised LINE worker follows.
// @spec ADR-061
// @tested tests/unit/server-line-worker-cadence.test.js
//
// Split out of `server-line-worker.mjs` only so it can be tested: that file is a top-level-await
// script whose import *is* the process, so nothing inside it can be exercised from a test.

/** Delay after a round that did work. Shorter than the old flat second, on purpose. */
export const FAST_MS = 250
/** First delay after a round that found nothing. */
export const IDLE_START_MS = 1_000
/** Ceiling for the idle backoff. Affordable because admission nudges the endpoint directly. */
export const IDLE_MAX_MS = 10_000
/** A rich menu publish is never inside a conversation's latency budget; keep its own floor. */
export const RICH_MENU_MIN_INTERVAL_MS = 1_000

/**
 * Did this round do anything?
 *
 * Both worker endpoints report `status: 'IDLE'` for a round that found nothing, so that — not the
 * HTTP status — is the signal. A 401 or 503 has no `status` at all and counts as no work, which
 * makes a misconfigured or failing deployment back off instead of hammering.
 */
export const didWork = (ok, body) => Boolean(ok) && Boolean(body?.status) && body.status !== 'IDLE'

/**
 * The next delay, and the idle interval to carry into the round after it.
 *
 * A productive round resets the backoff immediately, so a burst of traffic runs at FAST_MS
 * throughout rather than paying for however quiet it was beforehand.
 */
export function nextCadence({ worked, idleMs = IDLE_START_MS }) {
  if (worked) return { delayMs: FAST_MS, idleMs: IDLE_START_MS }
  return { delayMs: idleMs, idleMs: Math.min(IDLE_MAX_MS, idleMs * 2) }
}

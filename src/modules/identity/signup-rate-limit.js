// @req FR-120 — the per-source rate limit the requirement names as one of two
//   compensating controls for the enumeration a distinguishable "email taken"
//   answer permits.
// @spec SEC-008
// @tested tests/unit/fr120-signup-rate-limit.test.js

/**
 * A fixed-window counter held in this Node process's own memory.
 *
 * **Read the limitations before relying on it.** They are written here rather
 * than in a commit message because a control described more strongly than it is
 * built is worse than one described honestly — the FR-120 row states the same
 * limits for the same reason.
 *
 * 1. **Per-process.** Two replicas keep two counters, so the effective limit is
 *    the configured one multiplied by the number of instances. It resets on
 *    every restart and deploy.
 * 2. **Only as trustworthy as the address it is given.** The route keys on the
 *    forwarded client address, which is a client-supplied header unless a proxy
 *    the deployment trusts overwrites it. An attacker who can set that header
 *    rotates it and this counts each attempt against a fresh bucket.
 * 3. **One shared bucket when no proxy sets the header at all** — every caller
 *    then keys on the same fallback, and the limit becomes installation-wide.
 *    That is why the window is generous rather than tight: a limit low enough
 *    to matter against a scanner would lock out an honest office behind one NAT.
 *
 * What it therefore is: a speed bump against a naive scanner, and nothing at all
 * against a deliberate attacker. The control FR-120 actually leans on is the
 * audit trail, which records every account that comes into existence. This is
 * the second one, and it is the weaker of the two.
 */

export const SIGNUP_RATE_LIMIT_MAX = 20
export const SIGNUP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

/**
 * Entries are tiny (a count and a timestamp), so this cap is about refusing to
 * let an unauthenticated caller grow a Map without bound, not about memory.
 *
 * At the cap the oldest window is evicted rather than the new key refused.
 * Fail-closed here would be its own denial of service: anyone able to fill the
 * table could lock every honest caller out of signing up. Eviction means an
 * attacker holding more than this many distinct source keys can push their own
 * entry out and start again — but an attacker with that many addresses defeats
 * a per-address counter by rotating them anyway, so the cap gives away nothing
 * that limitation 2 above had not already given away.
 */
export const SIGNUP_RATE_LIMIT_MAX_KEYS = 10_000

/**
 * @param {object} [options]
 * @param {number} [options.max] attempts permitted per key per window
 * @param {number} [options.windowMs] window length in milliseconds
 * @param {number} [options.maxKeys] distinct keys held before the oldest is evicted
 * @param {() => number} [options.now] clock, injectable so a test need not sleep
 */
export function createSignupRateLimiter({
  max = SIGNUP_RATE_LIMIT_MAX,
  windowMs = SIGNUP_RATE_LIMIT_WINDOW_MS,
  maxKeys = SIGNUP_RATE_LIMIT_MAX_KEYS,
  now = Date.now,
} = {}) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const windows = new Map()

  function prune(at) {
    for (const [key, window] of windows) {
      if (window.resetAt <= at) windows.delete(key)
    }
  }

  return {
    /**
     * Counts one attempt against `key` and says whether it is permitted.
     *
     * Counting happens on every call, including refused ones: a caller already
     * over the limit does not get their window shortened by continuing to try.
     *
     * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}}
     */
    check(key) {
      const at = now()
      const bucket = typeof key === 'string' && key ? key : 'unknown'
      prune(at)

      let window = windows.get(bucket)
      if (!window) {
        // Map iteration order is insertion order, so the first key is the
        // longest-held. Every expired one is already gone by the prune above.
        if (windows.size >= maxKeys) windows.delete(windows.keys().next().value)
        window = { count: 0, resetAt: at + windowMs }
        windows.set(bucket, window)
      }

      window.count += 1
      const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - at) / 1000))
      return {
        allowed: window.count <= max,
        remaining: Math.max(0, max - window.count),
        retryAfterSeconds,
      }
    },

    /** Test seam only — the route never calls this. */
    reset() {
      windows.clear()
    },

    get size() {
      return windows.size
    },
  }
}

/**
 * The instance the route uses. Module-level on purpose: a limiter constructed
 * per request would count every attempt as the first one, which is the failure
 * this whole file exists to avoid and would be invisible in every test that
 * built its own instance.
 */
export const signupRateLimiter = createSignupRateLimiter()

/**
 * The address a request is counted against.
 *
 * `x-forwarded-for` may carry a proxy chain; the client is its first hop. This
 * trusts the header, which is only sound behind a proxy that overwrites it —
 * see limitation 2 above. When nothing supplies one, every caller shares
 * `'unknown'` and the limit becomes installation-wide, which is stated rather
 * than hidden because a bucket everyone shares is a very different control from
 * one bucket per caller.
 */
export function signupSourceKey(headers) {
  const forwarded = headers?.get?.('x-forwarded-for') || ''
  const firstHop = forwarded.split(',')[0]?.trim()
  if (firstHop) return firstHop
  const realIp = headers?.get?.('x-real-ip')?.trim()
  return realIp || 'unknown'
}

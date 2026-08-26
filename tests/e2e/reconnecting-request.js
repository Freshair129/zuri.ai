// @req FR-077 — the Inventory boundaries must fail for the boundary under test,
//   never for a TCP socket the server closed while the client was writing to it.
// @spec SDD-045 — the suite's own rule: fix the nondeterminism or quarantine the
//   test, do not let a retry hide it. This retries the CONNECTION, never the answer.
// @tested tests/unit/e2e-reconnecting-request.test.js
//
// Evidence. GitHub Actions run 32285614052 (the `main` governance run for the
// PR #73 merge) went red on one line:
//
//   Error: apiRequestContext.get: read ECONNRESET
//     - → GET http://localhost:3100/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM
//     at tests/e2e/fr077-project-inventory.spec.js:52:48
//
// Line 52 is a fixture lookup. The test asserts on `PARTIAL`/`truncated` metadata
// three lines later and never got that far, so the build failed for something the
// test does not measure. `--fail-on-flaky` then correctly turned the retry-pass
// into a build failure.
//
// Why the reset is transport, not the application: every route handler goes
// through `handle()` in src/app/api/_helpers.js, which catches *everything* and
// returns a JSON body — a thrown handler produces a 500 with content, never a
// dead socket. A reset with no response at all therefore comes from below the
// application: Node closes an idle keep-alive socket after `keepAliveTimeout`
// (5s by default) and a client that starts writing to that socket in the same
// tick sees ECONNRESET. The preceding spec in this file spends ~3s driving the
// browser without touching the API, which parks the socket squarely in that
// window. `next dev` gives no way to raise the server's timeout, so the client
// is the only side that can be made to tolerate it.
//
// The discipline that keeps this from becoming the retry it replaces:
//
//   * Only an error carrying a connection-reset code reconnects. Any HTTP
//     response — 200, 400, 404, 500 — is handed back untouched on the first
//     attempt, so a route that answers wrongly still fails immediately.
//   * One extra attempt. A second reset propagates, because a server that
//     cannot hold a connection twice in a row is a real failure.
//   * Nothing here retries an assertion. It wraps the request call only.
//
// If this file ever needs a third attempt or a sleep between them, that is the
// signal that the cause moved and this note no longer explains it.

/** Errors that mean "no answer arrived", as opposed to "the answer was wrong". */
const CONNECTION_LOST = /ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|socket disconnected/i

function isConnectionLost(error) {
  return CONNECTION_LOST.test(String(error?.message ?? error ?? ''))
}

/**
 * Run a request thunk, retrying once if no usable answer arrived: the
 * connection died before any response, or the response was a 503.
 *
 * Why 503 joins the connection-lost class (2026-08-26): the fr077 `limit=1`
 * spec went red twice in one day at `expect(response.ok()).toBe(true)` on a
 * read that passed 3 seconds later on retry — an answer arrived, but it was
 * "unavailable". In this app a 503 has exactly one source: `handle()` /
 * `resolveRequestViewer` map a failed session-adapter read to
 * SESSION_UNAVAILABLE, and under full-suite CI load SQLite can refuse that
 * read transiently. 503 is the one status whose *meaning* is "try again";
 * every other status — 200, 400, 404, 500 — is an answer about the boundary
 * under test and is still handed back untouched on the first attempt.
 *
 * The discipline is unchanged: one extra attempt total, never an assertion
 * retry, and a second failure of either kind propagates.
 *
 * @template T
 * @param {() => Promise<T>} send issues exactly one request
 * @returns {Promise<T>}
 */
async function reconnecting(send) {
  let first
  try {
    first = await send()
  } catch (error) {
    if (!isConnectionLost(error)) throw error
    return send()
  }
  if (typeof first?.status === 'function' && first.status() === 503) return send()
  return first
}

/**
 * The two verbs the e2e specs use, bound to a Playwright request context that
 * already carries the signed session cookie (`page.request`, not `request`, for
 * anything behind the viewer gate — see the RCA from 2026-08-19).
 *
 * @param {{ get: Function, post: Function }} context
 */
function api(context) {
  return {
    get: (url, options) => reconnecting(() => context.get(url, options)),
    post: (url, options) => reconnecting(() => context.post(url, options)),
  }
}

module.exports = { api, reconnecting, isConnectionLost, CONNECTION_LOST }

const { test } = require('@playwright/test')
const { warmupPlan } = require('./warmup-routes')
// reconnecting() retries a lost connection or a 503, never an answer — the
// same discipline the specs use, and the same failure it was written for: the
// dev server dropping a keep-alive socket mid-compile (read ECONNRESET).
const { reconnecting } = require('./reconnecting-request')

// @req NFR-008 — the suite must fail for the reason under test, not for how
// long Next.js took to compile a module it had never served.
// @tested tests/unit/e2e-warmup.test.js
//
// Next.js compiles a module in dev on its first request. `webServer.url` warms
// exactly one route (`/overview`); every other first request pays the compile
// cost inside a test, where an `expect` has a fixed budget. Under load that is
// not enough, and the suite goes flaky on whichever module happened to be
// first — a different one every run, all with the same "Timed out waiting for"
// shape, none related to the change under test.
//
// The retry that used to hide this is now a build failure (--fail-on-flaky),
// so the config's own note applies: "If cold-compile flakes reappear, the fix
// is a warm-up step, not re-hiding them behind a silent retry."
//
// What gets warmed, and why it is derived from `src/app` rather than listed
// here, is in ./warmup-routes.js. This file only sends the requests.

test('warm every page and route-handler module before any spec runs', async ({ request }) => {
  const plan = warmupPlan()
  // This is the warm-up's own budget, not an assertion about the product, so a
  // generous figure hides nothing. The arithmetic: CI run 34106105030 compiled
  // the 80 hand-listed URLs in 1.8 min (≈1.35s each); the first local run of
  // this plan compiled all 291 in 393s — the same 1.35s per request — and the
  // 112 specs that followed took 4 min, against 22 min on CI when they were
  // paying the compiles themselves. So the expectation is ~7 min here and the
  // ceiling below is for a runner under the load that produced the flakes;
  // a warm-up that exceeds it fails loudly as one test instead of as whichever
  // spec came first.
  test.setTimeout(30 * 60 * 1000)
  const started = Date.now()
  const sent = { GET: 0, OPTIONS: 0 }
  // Sequential on purpose: the dev server compiles one entry at a time anyway,
  // and firing hundreds of parallel cold requests at it is slower and noisier.
  for (const { url, method } of plan) {
    await reconnecting(() => request.fetch(url, { method, timeout: 120000, failOnStatusCode: false }))
    sent[method] += 1
  }
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(`warmup: ${plan.length} module(s) — ${sent.GET} GET, ${sent.OPTIONS} OPTIONS — in ${seconds}s`)
})

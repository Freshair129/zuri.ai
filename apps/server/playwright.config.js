const { defineConfig } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
// @req FR-046 — the port and the isolated database are one decision made in one
// place, so the web server and the seeder cannot disagree, and a second worktree
// does not collide with the first. The primary checkout still runs on :3100.
const { e2eTarget } = require('./tests/e2e/e2e-target')
const { E2E_PASSWORD, E2E_SESSION_SECRET } = require('./tests/e2e/e2e-auth')
const { E2E_PLUGIN_CLIENT_ID, E2E_PLUGIN_CLIENT_NAME, e2ePluginRedirectUri } = require('./tests/e2e/e2e-plugin')

const target = e2eTarget()

// Prefer the Playwright-managed chromium for this version; if its download is
// unavailable (offline machine), fall back to any locally installed
// ms-playwright chromium build.
function resolveChromium() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  try {
    const own = path.join(root, 'chromium-1148', 'chrome-win', 'chrome.exe')
    if (fs.existsSync(own)) return undefined // let Playwright use its default
    const candidates = fs
      .readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse()
    for (const dir of candidates) {
      for (const sub of ['chrome-win64', 'chrome-win']) {
        const exe = path.join(root, dir, sub, 'chrome.exe')
        if (fs.existsSync(exe)) return exe
      }
    }
  } catch {}
  // Last resort — 2026-09-02: a machine with NO ms-playwright directory at all
  // (browsers never downloaded) still usually has a stable Chrome or Edge, and
  // Playwright can drive either through CDP. Without this, every spec fails with
  // "Executable doesn't exist" before a single page is opened, which reads as
  // 87 product failures instead of one missing download. ZURI_E2E_BROWSER pins
  // an explicit executable when the guess below is wrong.
  const explicit = process.env.ZURI_E2E_BROWSER
  if (explicit && fs.existsSync(explicit)) return explicit
  const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean)
  for (const base of programFiles) {
    for (const rel of ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"]) {
      const exe = path.join(base, rel)
      if (fs.existsSync(exe)) return exe
    }
  }
  return undefined
}

const executablePath = resolveChromium()

module.exports = defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.js',
  timeout: 60000,
  // 10s until 2026-09-07, when the numbers stopped supporting it. The note
  // below says cold compiles are the whole story and a warm-up fixes them; the
  // same test measured on CI says otherwise:
  //
  //   smoke.spec.js › universal routes › dependencies view renders edges
  //     run 34089371518 (green):  12.8s
  //     run 34106105030 attempt:  16.7s  → failed an expect at 10s
  //     run 34106105030 retry:     8.8s  → passed
  //
  // 8.8s is the WARM number, against a 10s budget — 1.2s of headroom on a
  // shared runner whose own variance is larger than that. So each run tipped a
  // different assertion over and reported exactly `1 flaky`, which is why the
  // suite looked like it had a rotating bug rather than a calibration problem.
  // Route retention (next.config.js `onDemandEntries`, PR #267) removes the
  // 16.7-vs-8.8 half of that; this removes the rest.
  //
  // This is not the retry-hiding that --fail-on-flaky exists to stop: a test
  // that is broken still fails, and one that passes still passes on its first
  // attempt. What it stops measuring is how long Next.js dev-mode rendering
  // took on a busy runner, which is not a property of the product.
  expect: { timeout: 30000 },
  // One retry is kept to *label* flakiness, not to hide it. `npm run test:e2e`
  // passes --fail-on-flaky, so a test that passes only on retry fails the build
  // while its report still distinguishes "flaky" from "consistently broken" —
  // which a bare retries:0 would throw away.
  //
  // The original justification for the retry was Next.js on-demand compile cost
  // on first hit. That is no longer load-bearing: on 2026-08-17 the full suite
  // ran clean twice at --retries=0, both at default workers and at --workers=1.
  // If cold-compile flakes reappear, the fix is a warm-up step, not re-hiding
  // them behind a silent retry.
  //
  // They did reappear the same day, under load — three specs in one run, all
  // "Timed out waiting for toHaveURL", none related to the change under test,
  // and a control run on the unchanged tree flaked too. So: the warm-up project
  // below, as promised, rather than a longer expect timeout.
  //
  // 2026-09-07: the warm-up alone was not enough, and the measurements are in
  // the `expect` note above. Two things it could not reach: Next dev evicts a
  // compiled route after 60s idle (fixed in next.config.js), and a warm page can
  // still need ~9s under CI load. The warm-up stays — it is still the only thing
  // that keeps a first hit off a test's clock — but it is no longer asked to
  // carry the whole margin on its own.
  retries: 1,
  // Serial on purpose, and it costs nothing. Measured on 2026-08-17, 12-core
  // machine, full suite at --retries=0:
  //
  //   idle   6 workers → 43 passed, 154s
  //   idle   1 worker  → 43 passed, 156s      ← 6-way parallelism buys 1.3%
  //   loaded 6 workers → 1 FAILED,  264s
  //   loaded 1 worker  → 43 passed, 275s
  //
  // Two seconds between six workers and one, on an idle machine, means the
  // workers were never running in parallel in any useful sense: `webServer`
  // starts ONE Next dev server and every worker queues behind it. Under load
  // that queue grows past the 10s `expect` budget and the suite reports compile
  // latency as a failure — three specs in one run, all "Timed out waiting for
  // toHaveURL", none related to the change under test.
  //
  // So parallelism here was not buying speed, it was buying nondeterminism.
  // If a future change makes the workers genuinely independent — a server per
  // worker, or a production build instead of dev — re-measure before raising
  // this. The number to beat is 154s.
  workers: 1,
  projects: [
    { name: 'warmup', testMatch: /warmup\.setup\.js/ },
    // Every spec waits for the warm-up, so no test is the one that pays for a
    // cold compile. `webServer.url` only ever warmed /overview.
    { name: 'e2e', dependencies: ['warmup'], testMatch: /.*\.spec\.js/ },
  ],
  use: {
    baseURL: target.baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: `npm run dev -- -p ${target.port}`,
    url: `${target.baseURL}/overview`,
    // Still false: this run owns its server and its database, and reusing a
    // server someone else started would mean testing against their data.
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ...process.env,
      // Same `target` object global setup reads, so the server and the seeded
      // database are the same database by construction rather than by two
      // literals that happen to match.
      DATABASE_URL: target.databaseUrl,
      ZURI_SESSION_SECRET: E2E_SESSION_SECRET,
      ZURI_SEED_OWNER_PASSWORD: E2E_PASSWORD,
      // @req FR-123 — the plugin boundary is fail-closed without a registered
      // client, so the consent screen cannot be reached at all unless this run
      // registers one. Test-only, and only for this isolated server.
      ZURI_PLUGIN_CLIENT_ID: E2E_PLUGIN_CLIENT_ID,
      ZURI_PLUGIN_CLIENT_NAME: E2E_PLUGIN_CLIENT_NAME,
      ZURI_PLUGIN_REDIRECT_URIS: e2ePluginRedirectUri(),
    },
  },
})

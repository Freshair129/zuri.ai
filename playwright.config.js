const { defineConfig } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

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
  return undefined
}

const executablePath = resolveChromium()

module.exports = defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.js',
  timeout: 60000,
  expect: { timeout: 10000 },
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
  retries: 1,
  use: {
    baseURL: 'http://localhost:3100',
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'npm run dev -- -p 3100',
    url: 'http://localhost:3100/overview',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ...process.env,
      DATABASE_URL: 'file:./e2e.db',
      ZURI_LOCAL_DEMO_AUTH: '1',
    },
  },
})

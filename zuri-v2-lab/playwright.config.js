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
  timeout: 60000,
  expect: { timeout: 10000 },
  // E2E runs against the dev server; first hits can pay Next.js on-demand
  // compile cost, so allow one retry to absorb cold-route flakes.
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
    reuseExistingServer: true,
    timeout: 120000,
  },
})

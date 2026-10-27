// @spec ADR-115 — explicit owned PostgreSQL/HTTPS package fixture; never the :3100 suite.
// @tested tests/e2e/compact-core.spec.js
const { defineConfig } = require('@playwright/test')
module.exports = defineConfig({
  testDir: './tests/e2e', testMatch: 'compact-core.spec.js', workers: 1,
  timeout: 600000, expect: { timeout: 15000 }, retries: 1,
  outputDir: 'node_modules/.cache/compact-core-results',
  // Password material must not enter traces, screenshots or video.
  use: { trace: 'off', screenshot: 'off', video: 'off' },
})

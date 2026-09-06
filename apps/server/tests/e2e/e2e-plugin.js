// @req FR-123 — one definition of the e2e plugin client, shared by the
// Playwright web-server env and the spec that drives the consent screen. Two
// literals in two files is the mismatch `e2e-target.js` exists to prevent.
// @spec ADR-052, SEC-022
// @tested tests/e2e/fr123-plugin-consent.spec.js

const { e2eTarget } = require('./e2e-target')

const E2E_PLUGIN_CLIENT_ID = 'zuri-plugin-e2e'
const E2E_PLUGIN_CLIENT_NAME = 'Zuri E2E Harness'

// The registered target is a path on the app's own origin. Nothing serves it —
// it 404s — which is the point: the browser lands there with the code in the
// query string and the spec reads it, without the suite needing a second
// listener on a loopback port it would then have to own and free.
function e2ePluginRedirectUri(options = {}) {
  return `${e2eTarget(options).baseURL}/plugin/e2e-callback`
}

module.exports = { E2E_PLUGIN_CLIENT_ID, E2E_PLUGIN_CLIENT_NAME, e2ePluginRedirectUri }

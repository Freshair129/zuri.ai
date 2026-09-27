import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Which verification a pull request's diff needs.
//
// The point of extracting a service is that a change confined to it is verified
// by the service alone: its own job (minutes), the governance chain (the doc
// graph scans services/*/src and test), and the apps/server tests that import
// the service's code — the Core-side contract tests. The full apps/server suite
// and production build cannot observe such a change, so they are skipped.
//
// Fails safe like ci-code-changes.mjs: a service counts as isolated only when it
// is listed here AND the whole diff is inside services/<name>/. Anything else —
// a doc, apps/server, a workflow, a compose file under apps/server, an empty or
// unreadable diff — is `server=true`, the full suite.
//
// A service may join ISOLATED_SERVICES only once governance.yml has a job that
// installs, tests and builds it (pinned by tests/unit/ci-change-scope.test.js).

export const ISOLATED_SERVICES = Object.freeze(['conversation-runtime', 'market-intelligence'])

const servicePath = new RegExp(`^services/(${ISOLATED_SERVICES.map((name) => name.replace(/[-]/g, '\\-')).join('|')})/`)

function changedPaths(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/** The isolated services a diff touches, or null when anything else changed (full suite). */
export function isolatedServices(text) {
  const paths = changedPaths(text)
  if (paths.length === 0) return null
  const services = new Set()
  for (const file of paths) {
    const match = servicePath.exec(file)
    if (!match) return null
    services.add(match[1])
  }
  return [...services].sort()
}

/**
 * apps/server test files (relative to apps/server) that reference a service's
 * directory — the Core-side contract tests for that service. `files` maps a
 * test path to its source text so the rule is testable without a checkout.
 */
export function contractTestsFor(services, files) {
  const needles = services.map((name) => `services/${name}/`)
  return Object.entries(files)
    .filter(([, source]) => needles.some((needle) => source.includes(needle)))
    .map(([file]) => file)
    .sort()
}

function walkTests(dir, root, out = {}) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walkTests(full, root, out)
    else if (entry.endsWith('.test.js')) out[path.relative(root, full).split(path.sep).join('/')] = readFileSync(full, 'utf8')
  }
  return out
}

export function scopeOutputs(text, serverRoot) {
  const services = isolatedServices(text)
  if (!services) return { server: 'true', services: '', contracts: '' }
  const contracts = contractTestsFor(services, walkTests(path.join(serverRoot, 'tests'), serverRoot))
  return { server: 'false', services: services.join(' '), contracts: contracts.join(' ') }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Consume the complete pipe before returning; early exit would break pipefail callers.
  const input = readFileSync(0, 'utf8')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const outputs = scopeOutputs(input, path.join(repoRoot, 'apps', 'server'))
  for (const [key, value] of Object.entries(outputs)) console.log(`${key}=${value}`)
}

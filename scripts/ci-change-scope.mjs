import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
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

// ---------------------------------------------------------------------------
// Related mode (2026-09-27, owner instruction: "narrow, per FR").
//
// A pull request that changes apps/server used to run the whole suite in four
// shards (~7-8 min, the first shard carrying the PostgreSQL WorkToolPort run).
// In related mode it runs only (one job, or up to four shards for a large selection):
//   a. the test files that import a changed source file, directly or
//      transitively — vitest's own `vitest related` module graph
//      (apps/server/scripts/vitest-related.mjs), never a hand-rolled parser;
//   b. every test file naming a requirement id (FR-/NFR-/BR-/SEC-/SDD-) that a
//      changed source file declares with `@req`, plus the tests its `@tested`
//      names — the same edges the doc graph draws (scripts/doc-graph.mjs);
//   c. the changed test files themselves, and tests that name a changed file's
//      path (string-pinning tests read source instead of importing it).
//
// It FAILS SAFE to the full suite, in the same spirit as isolatedServices():
// related mode is an allowlist of paths it can reason about, and anything
// outside it, anything in FULL_SUITE_TRIGGERS, a deleted source file, an empty
// selection, a selection above FAN_OUT_LIMIT of the suite, or a graph
// computation that fails or times out, is `test_mode=full`. Pushes to `main`,
// the schedule and workflow_dispatch never reach this code (governance.yml),
// and the `ci:full` pull request label skips it too.
// ---------------------------------------------------------------------------

/** Above this share of the whole suite, a narrowed run saves too little to be worth the risk. */
export const FAN_OUT_LIMIT = 0.4

/** GitHub passes the list through a job output and an environment variable; stay far below 32 KiB. */
export const MAX_LIST_CHARS = 24000

/** Seconds the module-graph computation may take before the full suite is chosen instead. */
export const RELATED_TIMEOUT_MS = 180000

/**
 * Files per related shard. One job for a small selection; a large one is still
 * split (up to the full run's four runners), because a single runner at
 * ~1.3 s/file loses the parallelism the four shards bought: 170 files serially
 * would take as long as the full suite does sharded.
 */
export const RELATED_FILES_PER_SHARD = 45
export const MAX_SHARDS = 4

export function relatedShardCount(count) {
  return Math.min(MAX_SHARDS, Math.max(1, Math.ceil(count / RELATED_FILES_PER_SHARD)))
}

export const POSTGRES_TEST = 'tests/integration/conversation-runtime-work-tool-port.test.js'

/**
 * Paths whose change forces the full suite even inside an otherwise related
 * diff: every test depends on them, or tests read them without importing them
 * (so no module graph can see the dependency), or they are the CI itself.
 */
export const FULL_SUITE_TRIGGERS = Object.freeze([
  { pattern: /(^|\/)package(-lock)?\.json$|(^|\/)npm-shrinkwrap\.json$|(^|\/)(yarn\.lock|pnpm-lock\.yaml)$/, reason: 'package manifest or lockfile' },
  { pattern: /^apps\/server\/prisma\//, reason: 'prisma schema or migrations' },
  { pattern: /^\.github\//, reason: 'CI workflow' },
  { pattern: /^(apps\/server\/)?scripts\//, reason: 'scripts (the CI scope itself, generators, spawned CLIs)' },
  { pattern: /^apps\/server\/vitest[^/]*\.config\.[cm]?js$/, reason: 'vitest config' },
  { pattern: /^apps\/server\/tests\/(setup|global-setup[^/]*)\.js$/, reason: 'vitest setup / global setup' },
  { pattern: /^apps\/server\/tests\/(helpers|fixtures)\//, reason: 'shared test helpers or fixtures' },
  { pattern: /^apps\/server\/src\/lib\//, reason: 'widely shared module (src/lib)' },
  { pattern: /^apps\/server\/src\/(middleware|instrumentation)\.[cm]?[jt]sx?$/, reason: 'widely shared module (middleware/instrumentation)' },
  { pattern: /^(apps\/server\/src\/modules\/agent|services\/conversation-runtime\/src)\/line-answer-policy\.js$/, reason: 'answer-policy mirror (parity across Core and the service)' },
  { pattern: /(^|\/)\.env[^/]*$|^apps\/server\/(config|contracts)\/|^apps\/server\/[^/]+\.(js|json|mjs|cjs)$/, reason: 'env, config or contract files' },
])

// What related mode can reason about. Everything else is the full suite.
const RELATED_SOURCE = /^(apps\/server\/(src|runtime|tests\/factories)\/|services\/(conversation-runtime|market-intelligence)\/)/
const RELATED_TEST = /^apps\/server\/tests\/(unit|integration)\/.+\.test\.js$/
const RELATED_TEST_SUPPORT = /^apps\/server\/tests\/(unit|integration)\//
const INERT = /^(docs\/|\.brain\/|AGENTS\.md$|CLAUDE\.md$|README\.md$|apps\/server\/tests\/e2e\/)/
const DOCUMENT = /^(docs\/|\.brain\/|AGENTS\.md$|CLAUDE\.md$|README\.md$)/
const ANNOTATION = /@(req|tested)\s+([^\n]*)/g
const ID_LIST = /(?:FR|NFR|BR|SEC|SDD)-\d{3}/g
const POSTGRES_PATHS = /conversation-runtime|work-tool|line-conversation-jobs|line-project-work/

/**
 * Whether a diff is eligible for related mode, before anything is installed.
 * `exists(path)` reports whether a repo-relative path is in the checked-out tree.
 */
export function relatedEligibility(text, exists = () => true) {
  const paths = changedPaths(text)
  if (paths.length === 0) return { eligible: false, reason: 'empty diff' }
  let sawServer = false
  for (const file of paths) {
    const trigger = FULL_SUITE_TRIGGERS.find(({ pattern }) => pattern.test(file))
    if (trigger) return { eligible: false, reason: `${trigger.reason}: ${file}` }
    if (INERT.test(file)) continue
    if (RELATED_TEST.test(file) || RELATED_TEST_SUPPORT.test(file)) { sawServer = true; continue }
    if (RELATED_SOURCE.test(file)) {
      if (!exists(file)) return { eligible: false, reason: `deleted or renamed source: ${file}` }
      sawServer = true
      continue
    }
    return { eligible: false, reason: `outside related scope: ${file}` }
  }
  if (!sawServer) return { eligible: false, reason: 'no apps/server source or test changed' }
  return { eligible: true, reason: 'related' }
}

const idPattern = (id) => new RegExp(`(^|[^0-9A-Za-z])${id}(?![0-9])`)

/**
 * The related selection from pure inputs, so every rule is testable without a
 * checkout or a vitest run.
 *   changed      — repo-relative changed paths
 *   graph        — tests vitest reports as importing a changed source (null = the computation failed)
 *   all          — every test file of the suite (apps/server-relative)
 *   testSources  — apps/server-relative test path → source text
 *   sourceTexts  — repo-relative changed source path → its current text
 */
export function selectRelated({ changed, graph, all, testSources, sourceTexts }) {
  const full = (reason) => ({ mode: 'full', reason, related: [], postgres: false })
  if (!Array.isArray(graph)) return full('related computation failed')
  if (!all.length) return full('no test files found')
  const suite = new Set(all)
  const selected = new Set(graph.filter((file) => suite.has(file)))
  const reasons = { graph: selected.size, req: 0, tested: 0, changedTests: 0, named: 0 }
  const add = (file, kind) => {
    if (!suite.has(file) || selected.has(file)) return
    selected.add(file)
    reasons[kind] += 1
  }

  const ids = new Set()
  const tested = new Set()
  for (const file of changed) {
    if (RELATED_TEST.test(file)) add(file.replace(/^apps\/server\//, ''), 'changedTests')
    const text = sourceTexts[file]
    if (text == null || RELATED_TEST.test(file)) continue
    for (const [, kind, rest] of text.matchAll(ANNOTATION)) {
      if (kind === 'req') for (const id of rest.match(ID_LIST) || []) ids.add(id)
      else for (const name of rest.split('—')[0].replace(/\([^)]*\)/g, '').split(',').map((s) => s.split('::')[0].trim()).filter(Boolean)) tested.add(name)
    }
  }
  const idTests = [...ids].map(idPattern)
  const names = changed
    .filter((file) => !RELATED_TEST.test(file))
    .map((file) => (DOCUMENT.test(file) ? path.posix.basename(file) : file.replace(/^apps\/server\/(src\/)?/, '').replace(/\.[cm]?[jt]sx?$/, '')))
    .filter((name) => name.length >= 8)
  for (const [file, source] of Object.entries(testSources)) {
    if (idTests.some((pattern) => pattern.test(source))) add(file, 'req')
    if (names.some((name) => source.includes(name))) add(file, 'named')
  }
  for (const name of tested) {
    const hit = all.find((file) => file === name || file.endsWith(`/${name}`))
    if (hit) add(hit, 'tested')
  }

  const related = [...selected].sort()
  if (related.length === 0) return full('no related tests found')
  if (related.length > all.length * FAN_OUT_LIMIT) {
    return full(`fan-out ${related.length}/${all.length} tests exceeds ${Math.round(FAN_OUT_LIMIT * 100)}%`)
  }
  if (related.join(' ').length > MAX_LIST_CHARS) return full('related list too long to pass through CI outputs')
  const postgres = selected.has(POSTGRES_TEST) || changed.some((file) => POSTGRES_PATHS.test(file))
  const detail = Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(' ')
  return { mode: 'related', reason: `${related.length}/${all.length} tests (${detail}; ids=${[...ids].sort().join(',') || '-'})`, related, postgres }
}

/** Runs vitest's module graph over the changed sources; null on any failure or timeout. */
export function vitestRelated(repoRoot, changed, { timeout = RELATED_TIMEOUT_MS } = {}) {
  const serverRoot = path.join(repoRoot, 'apps', 'server')
  const sources = changed.filter((file) => RELATED_SOURCE.test(file) && existsSync(path.join(repoRoot, file)))
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ci-related-'))
  const out = path.join(dir, 'related.json')
  try {
    const args = [path.join(serverRoot, 'scripts', 'vitest-related.mjs'), '--out', out, ...sources.map((file) => path.join(repoRoot, file))]
    if (sources.length === 0) {
      // Only tests (or inert files) changed: the graph has nothing to add, but
      // the suite listing is still needed. Pass one test so vitest lists files.
      const firstTest = changed.find((file) => RELATED_TEST.test(file) && existsSync(path.join(repoRoot, file)))
      if (!firstTest) return null
      args.push(path.join(repoRoot, firstTest))
    }
    const run = spawnSync(process.execPath, args, { cwd: serverRoot, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] })
    if (run.status !== 0 || !existsSync(out)) {
      process.stderr.write(`vitest-related failed (status ${run.status}${run.signal ? `, ${run.signal}` : ''})\n${run.stderr || ''}`)
      return null
    }
    const result = JSON.parse(readFileSync(out, 'utf8'))
    if (!Array.isArray(result.all) || !Array.isArray(result.related)) return null
    return sources.length === 0 ? { all: result.all, related: [] } : result
  } catch (error) {
    process.stderr.write(`vitest-related failed: ${error.message}\n`)
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The whole related-mode decision for a diff, as GitHub output key/values. */
export function relatedOutputs(text, repoRoot, { graphRunner = vitestRelated } = {}) {
  const changed = changedPaths(text)
  const exists = (file) => existsSync(path.join(repoRoot, file))
  const eligibility = relatedEligibility(text, exists)
  const full = (reason) => ({ test_mode: 'full', test_reason: reason, related: '', postgres: 'false', test_shards: '[1,2,3,4]', test_shard_total: '4' })
  if (!eligibility.eligible) return full(eligibility.reason)
  const serverRoot = path.join(repoRoot, 'apps', 'server')
  const graph = graphRunner(repoRoot, changed)
  if (!graph) return full('related computation failed or timed out')
  const testSources = walkTests(path.join(serverRoot, 'tests'), serverRoot)
  const sourceTexts = {}
  for (const file of changed) if (exists(file) && statSync(path.join(repoRoot, file)).isFile()) sourceTexts[file] = readFileSync(path.join(repoRoot, file), 'utf8')
  const selection = selectRelated({ changed, graph: graph.related, all: graph.all, testSources, sourceTexts })
  if (selection.mode !== 'related') return full(selection.reason)
  const shards = relatedShardCount(selection.related.length)
  return {
    test_mode: 'related',
    test_reason: selection.reason,
    related: selection.related.join(' '),
    postgres: String(selection.postgres),
    test_shards: JSON.stringify(Array.from({ length: shards }, (_, i) => i + 1)),
    test_shard_total: String(shards),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Consume the complete pipe before returning; early exit would break pipefail callers.
  const input = readFileSync(0, 'utf8')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const mode = process.argv[2]
  let outputs
  if (mode === '--related-eligible') {
    const { eligible, reason } = relatedEligibility(input, (file) => existsSync(path.join(repoRoot, file)))
    outputs = { candidate: String(eligible), candidate_reason: reason }
  } else if (mode === '--related') {
    outputs = relatedOutputs(input, repoRoot)
  } else {
    outputs = scopeOutputs(input, path.join(repoRoot, 'apps', 'server'))
  }
  for (const [key, value] of Object.entries(outputs)) console.log(`${key}=${value}`)
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { executeTests, fetchControl, main, validateControl, validateTestReport } from '../../scripts/verification-qualify.mjs'

const HEAD = 'a'.repeat(40)
const TREE = 'b'.repeat(40)
const FILE = 'tests/unit/core-consumer.test.js'
const PG = ['tests/integration/conversation-runtime-work-tool-port.test.js',
  'tests/integration/line-memory-erasure-due-query.test.js']
const success = name => ({ name, status: 'completed', conclusion: 'success' })
const cleaned = { containment: 'BOUND', cleanup: 'VERIFIED', remainingActive: 0 }
function control() {
  const run = { ...success('governance'), id: 17, run_attempt: 2, head_sha: HEAD,
    repository: { full_name: 'Freshair129/zuri.ai' }, path: '.github/workflows/governance.yml',
    event: 'push', head_branch: 'main', head_commit: { tree_id: TREE } }
  const jobs = ['changes', 'govern', 'build', 'conversation-runtime', 'market-intelligence', 'scm',
    'tests (1/4)', 'tests (2/4)', 'tests (3/4)', 'tests (4/4)', 'verify'].map((name, index) => ({
    ...success(name), id: index + 100, run_id: run.id, run_attempt: run.run_attempt, head_sha: HEAD, steps: [],
  }))
  for (const job of jobs.filter(job => job.name.startsWith('tests'))) {
    job.steps.push(success('Unit and integration tests'))
  }
  jobs.find(job => job.name === 'tests (1/4)').steps.push(success('WorkToolPort on PostgreSQL'))
  jobs.find(job => job.name === 'conversation-runtime').steps = [
    'Conversation Runtime tests', 'Conversation Runtime build and boundary scan',
    'Build standalone service image through the deployment Compose overlay',
    'Drain and stop the image in a disposable project',
  ].map(success)
  return { run, jobs }
}
function report(server, files = [FILE]) {
  return { success: true, numPassedTests: files.length, numFailedTests: 0, numFailedTestSuites: 0, numPendingTests: 0,
    testResults: files.map(file => ({ name: path.join(server, file), status: 'passed',
      assertionResults: [{ status: 'passed' }] })) }
}

test('only a complete successful exact-main full control is accepted', () => {
  const { run, jobs } = control()
  const result = validateControl(run, jobs, HEAD, 17)
  assert.equal(result.id, 17)
  assert.equal(result.attempt, 2)
  assert.equal(result.tree, TREE)
  assert.equal(result.cacheClass, 'UNVERIFIED')
})

for (const mutate of [
  c => { c.run.id = 18 }, c => { c.run.repository.full_name = 'elsewhere/repo' },
  c => { c.run.path = '.github/workflows/edge-ci.yml' }, c => { c.run.event = 'pull_request' },
  c => { c.run.head_branch = 'feature' }, c => { c.run.head_sha = 'c'.repeat(40) },
  c => { c.run.status = 'in_progress' }, c => { c.run.conclusion = 'failure' },
  c => { c.jobs.pop() }, c => { c.jobs.push(c.jobs[0]) }, c => { c.jobs[0].run_attempt = 1 },
  c => { c.jobs[0].head_sha = 'c'.repeat(40) }, c => { c.jobs[0].run_id = 18 },
  c => { c.jobs[0].conclusion = 'cancelled' }, c => { c.jobs[0].conclusion = 'skipped' },
  c => { c.jobs.find(j => j.name === 'tests (2/4)').steps[0].conclusion = 'skipped' },
  c => { c.jobs.find(j => j.name === 'tests (1/4)').steps.pop() },
  c => { c.jobs.find(j => j.name === 'conversation-runtime').steps.pop() },
  c => { c.jobs.find(j => j.name === 'tests (3/4)').steps.push(success('Related unit and integration tests (pull request)')) },
]) {
  test('rejects invalid control: ' + mutate.toString(), () => {
    const c = control(); mutate(c)
    assert.throws(() => validateControl(c.run, c.jobs, HEAD, 17))
  })
}

test('fetches attempt-specific job pages and detects an incomplete page', async () => {
  const { run, jobs } = control()
  const many = [...jobs, ...Array.from({ length: 91 }, (_, i) =>
    ({ ...jobs[0], id: 1000 + i, name: 'extra-' + i }))]
  const seen = []
  const fetch = async url => {
    seen.push(url)
    const payload = url.includes('/jobs?')
      ? { total_count: many.length, jobs: new URL(url).searchParams.get('page') === '1' ? many.slice(0, 100) : many.slice(100) }
      : run
    return { ok: true, json: async () => payload }
  }
  assert.equal((await fetchControl(17, HEAD, null, fetch)).jobs.length, 102)
  assert.ok(seen.some(url => url.includes('/attempts/2/jobs?per_page=100&page=2')))
  await assert.rejects(fetchControl(17, HEAD, null, async url => ({
    ok: true, json: async () => url.includes('/jobs?') ? { total_count: 12, jobs: [] } : run,
  })), /INCOMPLETE/)
})

test('control API failures, invalid IDs and a changed attempt cannot be accepted', async () => {
  await assert.rejects(fetchControl('../wrong', HEAD), /INVALID_CONTROL_RUN_ID/)
  await assert.rejects(fetchControl(17, HEAD, null, async () => ({ ok: false, status: 403 })), /API_STATUS:403/)
  const { run, jobs } = control()
  let reads = 0
  await assert.rejects(fetchControl(17, HEAD, null, async url => ({
    ok: true, json: async () => url.includes('/jobs?') ? { total_count: jobs.length, jobs }
      : ++reads === 1 ? run : { ...run, run_attempt: 3 },
  })), /CHANGED_DURING_READ/)
})

test('test evidence requires every selected file to execute passing assertions', () => {
  const server = path.resolve('server')
  const good = report(server)
  assert.equal(validateTestReport(good, [FILE], server).passed, 1)
  for (const change of [
    r => { r.numPassedTests = 0 }, r => { r.numFailedTests = 1 },
    r => { r.numFailedTestSuites = 1 }, r => { r.success = false },
    r => { r.testResults = [] }, r => { r.testResults[0].name = path.join(server, 'tests/unit/other.test.js') },
    r => { r.testResults[0].assertionResults = [{ status: 'pending' }] },
    r => { r.testResults[0].status = 'failed' },
  ]) {
    const invalid = structuredClone(good); change(invalid)
    assert.throws(() => validateTestReport(invalid, [FILE], server))
  }
})

function executionFixture(t) {
  const parent = path.resolve(tmpdir())
  const container = mkdtempSync(path.join(parent, 'zuri-qualification-'))
  const root = path.join(container, 'repo')
  const server = path.join(root, 'apps/server')
  const proof = path.join(server, 'node_modules/.cache/zuri-test-proof/vitest.json')
  const output = path.join(container, 'output')
  mkdirSync(path.dirname(proof), { recursive: true })
  mkdirSync(output)
  t.after(() => {
    assert.equal(path.dirname(container), parent)
    assert.ok(path.basename(container).startsWith('zuri-qualification-'))
    rmSync(container, { recursive: true, force: true })
  })
  return { root, server, proof, output, inventory: { discovered: [FILE], selected: [FILE] },
    receipt: { omissionsAllowed: false, scopeAdoptionQualified: false } }
}

test('engines execute separately via argv and preserve both reports and their counts', async t => {
  const f = executionFixture(t)
  const calls = []
  const run = (command, args, options) => {
    calls.push({ command, args, options })
    const sqlite = args.includes('test')
    assert.equal(options.shell, false)
    assert.equal(options.env.GITHUB_TOKEN, undefined)
    assert.equal(options.env.DATABASE_URL, undefined)
    assert.equal(Boolean(options.env.ZURI_RELATED_TESTS_FILE), sqlite)
    if (sqlite) assert.equal(readFileSync(options.env.ZURI_RELATED_TESTS_FILE, 'utf8'), FILE + '\n')
    writeFileSync(f.proof, JSON.stringify(report(f.server, sqlite ? [FILE] : PG)))
    return { status: 0, stdout: 'passed', stderr: '', lifecycle: cleaned }
  }
  await executeTests(f.root, f.inventory, f.output, f.receipt, run, '/trusted/npm-cli.js')
  assert.equal(calls.length, 2)
  assert.equal(f.receipt.engines.sqlite.counts.passed, 1)
  assert.equal(f.receipt.engines.postgres.counts.passed, 2)
  for (const engine of ['sqlite', 'postgres']) {
    assert.equal(f.receipt.engines[engine].status, 'PASS')
    assert.ok(readFileSync(path.join(f.output, engine + '.report.json'), 'utf8'))
  }
  assert.equal(f.receipt.omissionsAllowed, false)
})

test('stale/empty reports and command failures stop qualification before the next engine', async t => {
  const f = executionFixture(t)
  writeFileSync(f.proof, JSON.stringify(report(f.server)))
  let calls = 0
  await assert.rejects(executeTests(f.root, f.inventory, f.output, f.receipt, () => {
    calls++
    return { status: 0, stdout: '', stderr: '', lifecycle: cleaned }
  }, '/trusted/npm-cli.js'), /MISSING_TEST_REPORT/)
  assert.equal(calls, 1)
  assert.equal(f.receipt.engines.sqlite.status, 'FAIL')
  assert.equal(f.receipt.engines.postgres.status, 'NOT_RUN')
})

test('PostgreSQL failure is retained even after SQLite passes', async t => {
  const f = executionFixture(t)
  await assert.rejects(executeTests(f.root, f.inventory, f.output, f.receipt, (_command, args) => {
    const sqlite = args.includes('test')
    writeFileSync(f.proof, JSON.stringify(report(f.server, sqlite ? [FILE] : PG)))
    return { status: sqlite ? 0 : 1, stdout: '', stderr: 'engine failure', lifecycle: cleaned }
  }, '/trusted/npm-cli.js'), /TEST_COMMAND_FAILED:postgres/)
  assert.equal(f.receipt.engines.sqlite.status, 'PASS')
  assert.equal(f.receipt.engines.postgres.status, 'FAIL')
  assert.equal(JSON.parse(readFileSync(path.join(f.output, 'receipt.json'), 'utf8')).engines.postgres.exitCode, 1)
})

test('explicit additions cannot hide an empty discovered set at execution', async t => {
  const f = executionFixture(t)
  await assert.rejects(executeTests(f.root, { discovered: [], selected: [FILE] }, f.output, f.receipt,
    () => { throw new Error('must not execute') }, '/trusted/npm-cli.js'), /EMPTY_CORE_DISCOVERY/)
})

test('a failing report preserves failed counts and stops before PostgreSQL', async t => {
  const f = executionFixture(t)
  await assert.rejects(executeTests(f.root, f.inventory, f.output, f.receipt, () => {
    const failed = report(f.server)
    failed.success = false; failed.numPassedTests = 0; failed.numFailedTests = 1
    failed.testResults[0].status = 'failed'
    failed.testResults[0].assertionResults = [{ status: 'failed' }]
    writeFileSync(f.proof, JSON.stringify(failed))
    return { status: 1, stdout: '', stderr: 'assertion failed', lifecycle: cleaned }
  }, '/trusted/npm-cli.js'), /TEST_REPORT_NOT_PASSING/)
  assert.equal(f.receipt.engines.sqlite.counts.failed, 1)
  assert.equal(f.receipt.engines.sqlite.status, 'FAIL')
  assert.equal(f.receipt.engines.postgres.status, 'NOT_RUN')
})

for (const result of [
  { status: 0, lifecycle: { containment: 'BOUND', cleanup: 'UNVERIFIED', remainingActive: 1 } },
  { status: null, error: { code: 'ETIMEDOUT' }, lifecycle: cleaned },
  { status: null, error: { code: 'CANCELLED' }, lifecycle: cleaned },
  { status: null, error: { code: 'CONTAINMENT_FAILED' }, lifecycle: { ...cleaned, containment: 'NOT_BOUND' } },
]) {
  test('passing assertions cannot mask supervision failure: ' + (result.error?.code ?? 'cleanup'), async t => {
    const f = executionFixture(t)
    let calls = 0
    await assert.rejects(executeTests(f.root, f.inventory, f.output, f.receipt, () => {
      calls++
      writeFileSync(f.proof, JSON.stringify(report(f.server)))
      return result
    }, '/trusted/npm-cli.js'), /TEST_COMMAND_FAILED|PROCESS_CLEANUP_UNVERIFIED/)
    assert.equal(calls, 1)
    const saved = JSON.parse(readFileSync(path.join(f.output, 'receipt.json'), 'utf8'))
    assert.equal(saved.engines.sqlite.status, 'FAIL')
    assert.equal(saved.engines.sqlite.counts.passed, 1)
    assert.equal(saved.engines.postgres.status, 'NOT_RUN')
    assert.equal(saved.engines.sqlite.lifecycle.cleanup, result.lifecycle.cleanup)
  })
}

test('workflow is manual-only with no required-gate output or dependency cache saving', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const workflow = readFileSync(path.join(root, '.github/workflows/scoped-verification-qualification.yml'), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /pull_request_target:|pull_request:|push:|schedule:|actions\/cache\/save|continue-on-error:/)
  assert.match(workflow, /actions: read/)
  assert.match(workflow, /contents: read/)
  assert.match(workflow, /timeout-minutes: 20/)
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/)
  assert.match(workflow, /persist-credentials: false/)
})

for (const failure of ['403', 'head', 'step', 'attempt', 'pagination', 'tree', 'network']) {
  test('main saves unvalidated control provenance on rejection: ' + failure, async t => {
    const f = executionFixture(t)
    const git = args => {
      const result = spawnSync('git', ['-c', 'safe.directory=' + f.root, '-c', 'commit.gpgsign=false',
        '-c', 'user.name=Q1 fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      { cwd: f.root, encoding: 'utf8', windowsHide: true })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim()
    }
    git(['init', '--quiet'])
    writeFileSync(path.join(f.root, 'fixture.txt'), 'synthetic fixture\n')
    git(['add', 'fixture.txt']); git(['commit', '--quiet', '-m', 'fixture'])
    const head = git(['rev-parse', 'HEAD'])
    const tree = git(['rev-parse', 'HEAD^{tree}'])
    const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'Freshair129/zuri.ai', GITHUB_SHA: head, GITHUB_TOKEN: 'SYNTHETIC_SECRET_MARKER' }
    const oldEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
    Object.assign(process.env, env)
    const oldFetch = globalThis.fetch
    t.after(() => {
      globalThis.fetch = oldFetch
      for (const [key, value] of Object.entries(oldEnv)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })
    const { run, jobs } = control()
    run.head_sha = head; run.head_commit.tree_id = failure === 'tree' ? TREE : tree
    for (const job of jobs) job.head_sha = head
    if (failure === 'head') run.head_sha = HEAD
    if (failure === 'step') jobs.find(job => job.name === 'tests (1/4)').steps.pop()
    let reads = 0
    globalThis.fetch = async url => {
      if (failure === 'network') throw new Error('SYNTHETIC_SECRET_MARKER in arbitrary transport error')
      if (failure === '403') return { ok: false, status: 403 }
      const payload = url.includes('/jobs?')
        ? { total_count: jobs.length, jobs: failure === 'pagination' ? [] : jobs }
        : { ...run, run_attempt: ++reads === 2 && failure === 'attempt' ? 3 : 2 }
      return { ok: true, status: 200, json: async () => ({ ...payload, arbitrary: 'SYNTHETIC_SECRET_MARKER' }) }
    }
    await assert.rejects(main(['--control-run-id', '17', '--output', f.output], f.root))
    const raw = readFileSync(path.join(f.output, 'receipt.json'), 'utf8')
    const saved = JSON.parse(raw)
    assert.deepEqual(saved.requestedControl, { repository: 'Freshair129/zuri.ai',
      workflow: '.github/workflows/governance.yml', runId: 17 })
    assert.equal(saved.status, 'FAIL')
    assert.equal(saved.omissionsAllowed, false)
    assert.equal(saved.scopeAdoptionQualified, false)
    assert.equal(saved.control, undefined)
    assert.equal(saved.engines, undefined)
    assert.equal(saved.observedControl.validation, 'UNVALIDATED')
    assert.doesNotMatch(raw, /SYNTHETIC_SECRET_MARKER|Authorization|Bearer /)
    if (failure === '403') assert.equal(saved.observedControl.requests[0].statusCode, 403)
    else if (failure === 'network') assert.equal(saved.observedControl.requests[0].error, 'NETWORK_ERROR')
    else {
      assert.equal(saved.observedControl.runs[0].id, 17)
      assert.equal(saved.observedControl.runs[0].attempt, 2)
      if (failure === 'attempt') assert.deepEqual(saved.observedControl.runs.map(run => run.attempt), [2, 3])
      if (failure === 'step') {
        const job = saved.observedControl.jobs.find(job => job.name === 'tests (1/4)')
        assert.ok(job.steps.some(step => step.name === 'Unit and integration tests'))
        assert.ok(!job.steps.some(step => step.name === 'WorkToolPort on PostgreSQL'))
      }
      if (failure === 'pagination') assert.equal(saved.observedControl.pages[0].received, 0)
    }
  })
}

#!/usr/bin/env node
// @spec docs/architecture/VERIFICATION-POLICY.md
// @tested tools/tests/verification-qualify.test.mjs
// Manual execution evidence only; this receipt never authorizes CI omissions.
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectChanges, createVerificationPlan } from './verification-plan.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY = 'Freshair129/zuri.ai'
const WORKFLOW = '.github/workflows/scoped-verification-qualification.yml'
const JOBS = ['changes', 'govern', 'build', 'conversation-runtime', 'market-intelligence', 'scm',
  'tests (1/4)', 'tests (2/4)', 'tests (3/4)', 'tests (4/4)', 'verify']
const POSTGRES = ['tests/integration/conversation-runtime-work-tool-port.test.js',
  'tests/integration/line-memory-erasure-due-query.test.js']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')) }
function save(file, value) { writeFileSync(file, JSON.stringify(value, null, 2) + '\n') }
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  assert(result.status === 0, 'GIT_READ_FAILED:' + args[0])
  return result.stdout.trim()
}
function sha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex') }
function positiveInteger(value) { return /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value)) }
function passed(step) { return step?.status === 'completed' && step.conclusion === 'success' }
const textField = value => typeof value === 'string' ? value.slice(0, 256) : null
const integerField = value => Number.isSafeInteger(value) ? value : null
function observedRun(run) {
  return { id: integerField(run.id), attempt: integerField(run.run_attempt), head: textField(run.head_sha),
    tree: textField(run.head_commit?.tree_id), status: textField(run.status), conclusion: textField(run.conclusion),
    repository: textField(run.repository?.full_name), workflow: textField(run.path),
    event: textField(run.event), branch: textField(run.head_branch) }
}
function observedJob(job) {
  return { id: integerField(job.id), name: textField(job.name), runId: integerField(job.run_id),
    attempt: integerField(job.run_attempt), head: textField(job.head_sha), status: textField(job.status),
    conclusion: textField(job.conclusion), startedAt: textField(job.started_at), completedAt: textField(job.completed_at),
    runnerLabels: Array.isArray(job.labels) ? job.labels.slice(0, 32).map(textField) : [],
    stepsTruncated: Array.isArray(job.steps) && job.steps.length > 50,
    steps: Array.isArray(job.steps) ? job.steps.slice(0, 50).map(step => ({ number: integerField(step.number),
      name: textField(step.name), status: textField(step.status), conclusion: textField(step.conclusion),
      startedAt: textField(step.started_at), completedAt: textField(step.completed_at) })) : [] }
}

export function validateControl(run, jobs, head, runId) {
  assert(positiveInteger(runId) && Number(run.id) === Number(runId), 'CONTROL_ID_MISMATCH')
  assert(run.repository?.full_name === REPOSITORY && run.path === '.github/workflows/governance.yml'
    && run.event === 'push' && run.head_branch === 'main', 'CONTROL_WORKFLOW_MISMATCH')
  assert(run.head_sha === head && /^[a-f0-9]{40}$/.test(head), 'CONTROL_HEAD_MISMATCH')
  assert(passed(run) && positiveInteger(run.run_attempt), 'CONTROL_NOT_SUCCESSFUL')
  assert(Array.isArray(jobs) && jobs.length > 0 && new Set(jobs.map(job => job.id)).size === jobs.length,
    'CONTROL_JOBS_INVALID')
  for (const job of jobs) {
    assert(job.run_id === run.id && job.run_attempt === run.run_attempt && job.head_sha === head, 'CONTROL_JOB_IDENTITY')
  }
  const jobByName = name => {
    const matches = jobs.filter(job => job.name === name)
    assert(matches.length === 1 && passed(matches[0]), 'CONTROL_JOB_NOT_SUCCESSFUL:' + name)
    return matches[0]
  }
  const stepPassed = (job, name) => {
    const steps = job.steps?.filter(step => step.name === name) ?? []
    assert(steps.length === 1 && passed(steps[0]), 'CONTROL_STEP_NOT_SUCCESSFUL:' + name)
  }
  for (const name of JOBS) jobByName(name)
  for (let shard = 1; shard <= 4; shard++) {
    const job = jobByName('tests (' + shard + '/4)')
    stepPassed(job, 'Unit and integration tests')
    assert(!job.steps.some(step => step.name === 'Related unit and integration tests (pull request)'
      && step.conclusion === 'success'), 'CONTROL_RELATED_ONLY')
  }
  stepPassed(jobByName('tests (1/4)'), 'WorkToolPort on PostgreSQL')
  const runtime = jobByName('conversation-runtime')
  for (const name of ['Conversation Runtime tests', 'Conversation Runtime build and boundary scan',
    'Build standalone service image through the deployment Compose overlay',
    'Drain and stop the image in a disposable project']) stepPassed(runtime, name)
  return {
    id: run.id, attempt: run.run_attempt, head, tree: run.head_commit?.tree_id ?? null,
    url: 'https://github.com/' + REPOSITORY + '/actions/runs/' + run.id,
    event: run.event, startedAt: textField(run.run_started_at), updatedAt: textField(run.updated_at),
    jobs: jobs.map(observedJob),
    cacheClass: 'UNVERIFIED', actualNodeVersion: 'UNVERIFIED',
  }
}

export async function fetchControl(runId, head, token, fetchFn = fetch, observations = {}) {
  assert(positiveInteger(runId), 'INVALID_CONTROL_RUN_ID')
  Object.assign(observations, { validation: 'UNVALIDATED', requests: [], runs: [], pages: [], jobs: [], jobsTruncated: false })
  const endpoint = 'https://api.github.com/repos/' + REPOSITORY + '/actions/runs/' + runId
  const get = async (url, role, page = null) => {
    const request = { role, page, statusCode: null, error: null }
    observations.requests.push(request)
    let response
    try {
      response = await fetchFn(url, { headers: {
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      }, signal: AbortSignal.timeout(30_000), redirect: 'error' })
    } catch {
      request.error = 'NETWORK_ERROR'
      throw new Error('GITHUB_REQUEST_FAILED:' + role)
    }
    request.statusCode = integerField(response.status)
    if (!response.ok) {
      request.error = 'HTTP_ERROR'
      throw new Error('GITHUB_API_STATUS:' + request.statusCode)
    }
    try { return await response.json() } catch {
      request.error = 'INVALID_JSON'
      throw new Error('GITHUB_INVALID_JSON:' + role)
    }
  }
  const run = await get(endpoint, 'run-initial')
  observations.runs.push(observedRun(run))
  // Reject the run before using its attempt in a URL.
  assert(positiveInteger(run.run_attempt), 'CONTROL_ATTEMPT_INVALID')
  const jobs = []
  let total = null
  for (let page = 1; page <= 100; page++) {
    const batch = await get(endpoint + '/attempts/' + run.run_attempt + '/jobs?per_page=100&page=' + page, 'jobs', page)
    observations.pages.push({ page, total: integerField(batch.total_count),
      received: Array.isArray(batch.jobs) ? batch.jobs.length : null, collectedBefore: jobs.length })
    if (Array.isArray(batch.jobs)) {
      observations.jobs.push(...batch.jobs.slice(0, 200 - observations.jobs.length).map(observedJob))
      observations.jobsTruncated ||= jobs.length + batch.jobs.length > 200
    }
    assert(Number.isSafeInteger(batch.total_count) && batch.total_count > 0 && batch.total_count <= 10_000
      && Array.isArray(batch.jobs) && batch.jobs.length > 0 && batch.jobs.length <= 100, 'CONTROL_JOBS_INCOMPLETE')
    total ??= batch.total_count
    assert(batch.total_count === total, 'CONTROL_JOBS_CHANGED')
    jobs.push(...batch.jobs)
    if (jobs.length >= total) break
  }
  assert(jobs.length === total, 'CONTROL_JOBS_INCOMPLETE')
  const latest = await get(endpoint, 'run-recheck')
  observations.runs.push(observedRun(latest))
  assert(latest.run_attempt === run.run_attempt && latest.status === run.status
    && latest.conclusion === run.conclusion && latest.head_sha === run.head_sha, 'CONTROL_CHANGED_DURING_READ')
  return validateControl(run, jobs, head, runId)
}

export function validateTestReport(report, expected, serverRoot) {
  assert(report && report.success === true && Number.isInteger(report.numPassedTests)
    && report.numPassedTests > 0 && report.numFailedTests === 0 && report.numFailedTestSuites === 0,
  'TEST_REPORT_NOT_PASSING')
  assert(Array.isArray(report.testResults) && report.testResults.length === expected.length, 'TEST_FILES_MISMATCH')
  const normalize = file => path.resolve(serverRoot, file).replaceAll('\\', '/').toLowerCase()
  const names = report.testResults.map(file => normalize(file.name))
  assert(new Set(names).size === names.length && expected.every(file => names.includes(normalize(file))),
    'TEST_FILES_MISMATCH')
  for (const file of report.testResults) {
    assert(file.status === 'passed' && Array.isArray(file.assertionResults)
      && file.assertionResults.some(result => result.status === 'passed')
      && !file.assertionResults.some(result => result.status === 'failed'), 'TEST_FILE_DID_NOT_PASS:' + file.name)
  }
  return { passed: report.numPassedTests, failed: report.numFailedTests,
    pending: report.numPendingTests ?? null, files: report.testResults.length }
}

function npmCli() {
  const bin = path.dirname(process.execPath)
  const choices = [process.env.npm_execpath, path.join(bin, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(bin, '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean)
  const found = choices.find(file => file.endsWith('npm-cli.js') && existsSync(file))
  assert(found, 'NPM_CLI_NOT_FOUND')
  return found
}

// The adapter owns the job handle. Losing this parent's stdin also requests cleanup.
export async function runOwnedWindowsProcess(command, args, options) {
  assert(process.platform === 'win32', 'WINDOWS_SUPERVISOR_REQUIRED')
  assert(Number.isInteger(options.timeout) && options.timeout > 0 && options.timeout <= 600_000, 'INVALID_TIMEOUT')
  assert(!existsSync(options.evidencePath), 'PROCESS_EVIDENCE_ALREADY_EXISTS')
  const logs = [options.logPath, options.logPath + '.stdout', options.logPath + '.stderr'].map(file => openSync(file, 'wx'))
  const adapterEvidence = options.evidencePath + '.adapter.json'
  const unverified = { status: null, error: { code: 'SUPERVISOR_UNVERIFIED' },
    lifecycle: { containment: 'UNVERIFIED', cleanup: 'UNVERIFIED', remainingActive: null } }
  try {
    const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      options.adapter ?? path.join(ROOT, 'scripts/verification-process-win.ps1')], {
      cwd: options.cwd, env: options.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let cancelled = false
    let watchdog = false
    let spawnError = false
    const cancel = () => {
      cancelled = true
      if (child.stdin.writable) child.stdin.write('{"cancel":true}\n')
    }
    child.stdin.on('error', () => {}) // Broken control pipe cannot produce a verified result.
    child.on('error', () => { spawnError = true })
    child.stdout.on('data', data => { writeSync(logs[0], data); writeSync(logs[1], data) })
    child.stderr.on('data', data => { writeSync(logs[0], data); writeSync(logs[2], data) })
    const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
    // Secondary bound if the adapter cannot report. Kill-on-close still applies; proof remains UNVERIFIED.
    const deadline = setTimeout(() => { watchdog = true; child.kill() }, options.timeout + 15_000)
    process.on('SIGINT', cancel)
    process.on('SIGTERM', cancel)
    options.signal?.addEventListener('abort', cancel, { once: true })
    let exit
    try {
      child.stdin.write(JSON.stringify({ command, args, cwd: options.cwd, timeout: options.timeout,
        bootstrap: fileURLToPath(import.meta.url), resultPath: adapterEvidence }) + '\n')
      if (options.signal?.aborted) cancel()
      exit = await closed
    } finally {
      clearTimeout(deadline)
      process.off('SIGINT', cancel)
      process.off('SIGTERM', cancel)
      options.signal?.removeEventListener('abort', cancel)
      child.stdin.destroy()
    }
    let result = unverified
    if (!spawnError && !watchdog && !exit.signal && existsSync(adapterEvidence)) {
      try { result = readJson(adapterEvidence) } catch { /* Keep unverified evidence. */ }
    }
    result.supervisorExitCode = exit.code
    if (cancelled) result.error = { code: 'CANCELLED' }
    if (exit.code !== 0 && !result.error) result.error = { code: 'SUPERVISOR_FAILED' }
    save(options.evidencePath, result)
    return result
  } finally { for (const fd of logs) closeSync(fd) }
}

function processBootstrap() {
  // No descendants before a complete release message. A lost owner or missing release closes this process.
  const startup = setTimeout(() => process.exit(1), 10_000)
  const input = createInterface({ input: process.stdin })
  input.once('close', () => process.exit(1))
  input.once('line', line => {
    try {
      const config = JSON.parse(line)
      assert(config.command === process.execPath && Array.isArray(config.args)
        && config.args.every(arg => typeof arg === 'string'), 'INVALID_BOOTSTRAP_PAYLOAD')
      clearTimeout(startup)
      const child = spawn(process.execPath, config.args, {
        cwd: config.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'inherit', 'inherit'],
      })
      child.once('error', () => process.exit(1))
      child.once('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
    } catch { process.exit(1) }
  })
}

export async function executeTests(root, inventory, output, receipt, run = runOwnedWindowsProcess, cli = npmCli()) {
  assert(inventory.discovered.length > 0 && inventory.selected.length > 0, 'EMPTY_CORE_DISCOVERY')
  const server = path.join(root, 'apps/server')
  const list = path.join(output, 'selected-tests.txt')
  writeFileSync(list, inventory.selected.join('\n') + '\n')
  const env = { ...process.env }
  delete env.GITHUB_TOKEN
  delete env.DATABASE_URL
  delete env.ZURI_RELATED_TESTS_FILE
  const reportPath = path.join(server, 'node_modules/.cache/zuri-test-proof/vitest.json')
  receipt.engines = { sqlite: { status: 'NOT_RUN' }, postgres: { status: 'NOT_RUN' } }
  const record = () => save(path.join(output, 'receipt.json'), receipt)
  record()
  for (const [engine, args, expected] of [
    ['sqlite', ['test', '--', '--config', 'vitest.related.config.js'], inventory.selected],
    ['postgres', ['run', 'test:postgres'], POSTGRES],
  ]) {
    const startedAt = new Date().toISOString()
    receipt.engines[engine] = { status: 'RUNNING', startedAt, command: ['npm', ...args] }
    record()
    rmSync(reportPath, { force: true })
    const start = performance.now()
    let result
    try { result = await run(process.execPath, [cli, ...args], {
      cwd: server, encoding: 'utf8', windowsHide: true, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
      shell: false, env: { ...env, ...(engine === 'sqlite' ? { ZURI_RELATED_TESTS_FILE: list } : {}) },
      evidencePath: path.join(output, engine + '.process.json'), logPath: path.join(output, engine + '.log'),
    }) } catch {
      result = { status: null, error: { code: 'SUPERVISOR_FAILED' }, lifecycle: { cleanup: 'UNVERIFIED' } }
    }
    if (result.stdout !== undefined || result.stderr !== undefined) {
      writeFileSync(path.join(output, engine + '.log'), (result.stdout ?? '') + (result.stderr ?? ''))
    }
    const entry = { ...receipt.engines[engine], status: 'FAIL', exitCode: result.status,
      signal: result.signal ?? null, errorCode: result.error?.code ?? null,
      lifecycle: result.lifecycle, supervisorExitCode: result.supervisorExitCode ?? null,
      completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - start) }
    receipt.engines[engine] = entry
    try {
      if (existsSync(reportPath)) {
        const raw = readFileSync(reportPath)
        writeFileSync(path.join(output, engine + '.report.json'), raw)
        const report = JSON.parse(raw)
        entry.counts = { passed: report.numPassedTests ?? null, failed: report.numFailedTests ?? null,
          pending: report.numPendingTests ?? null, files: report.testResults?.length ?? null }
        entry.counts = validateTestReport(report, expected, server)
      }
      assert(result.status === 0 && !result.error && !result.signal, 'TEST_COMMAND_FAILED:' + engine)
      assert(result.lifecycle?.containment === 'BOUND' && result.lifecycle?.cleanup === 'VERIFIED'
        && result.lifecycle.remainingActive === 0, 'PROCESS_CLEANUP_UNVERIFIED:' + engine)
      assert(entry.counts, 'MISSING_TEST_REPORT:' + engine)
      entry.status = 'PASS'
    } finally { record() }
    console.log(engine + ': PASS (' + entry.counts.passed + ' tests, ' + entry.durationMs + ' ms)')
  }
}

export async function main(args, root = ROOT) {
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    assert(['--control-run-id', '--output'].includes(args[i]) && args[i + 1]
      && !Object.hasOwn(options, args[i]), 'INVALID_ARGUMENTS')
    options[args[i]] = args[i + 1]
  }
  assert(options['--output'] && positiveInteger(options['--control-run-id']), 'INVALID_ARGUMENTS')
  const output = path.resolve(options['--output'])
  mkdirSync(output, { recursive: true })
  const receiptPath = path.join(output, 'receipt.json')
  assert(!existsSync(receiptPath), 'RECEIPT_ALREADY_EXISTS')
  const receipt = { schemaVersion: 1, mode: 'qualification', executionProfile: 'runtime-consumers',
    status: 'IN_PROGRESS', startedAt: new Date().toISOString(), omissionsAllowed: false,
    scopeAdoptionQualified: false, timingComparison: 'INCONCLUSIVE: control cache/actual Node facts unavailable',
    requestedControl: { repository: REPOSITORY, workflow: '.github/workflows/governance.yml',
      runId: Number(options['--control-run-id']) },
    observedControl: { validation: 'UNVALIDATED', requests: [], runs: [], pages: [], jobs: [] } }
  save(receiptPath, receipt)
  try {
    assert(process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.GITHUB_REF === 'refs/heads/main'
      && process.env.GITHUB_REPOSITORY === REPOSITORY, 'MANUAL_MAIN_ONLY')
    const head = git(root, ['rev-parse', 'HEAD'])
    const tree = git(root, ['rev-parse', 'HEAD^{tree}'])
    assert(head === process.env.GITHUB_SHA, 'CHECKOUT_HEAD_MISMATCH')
    assert(!git(root, ['status', '--porcelain', '--untracked-files=no']), 'DIRTY_CHECKOUT')
    receipt.source = { commit: head, tree }
    receipt.run = { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
      url: 'https://github.com/' + REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID }
    receipt.environment = { platform: process.platform, node: process.version,
      runnerOS: process.env.RUNNER_OS ?? null, runnerArch: process.env.RUNNER_ARCH ?? null,
      runnerImage: process.env.ImageOS ?? null, runnerImageVersion: process.env.ImageVersion ?? null,
      edgeNode: process.env.Q1_EDGE_NODE_VERSION ?? null,
      edgeCacheHit: process.env.Q1_EDGE_CACHE_HIT ?? 'unknown', serverCacheHit: process.env.Q1_SERVER_CACHE_HIT ?? 'unknown' }
    const control = await fetchControl(options['--control-run-id'], head, process.env.GITHUB_TOKEN, fetch, receipt.observedControl)
    assert(control.tree === tree, 'CONTROL_TREE_MISMATCH')
    receipt.control = control
    const base = git(root, ['rev-parse', 'HEAD^1'])
    receipt.plan = createVerificationPlan(root, collectChanges(root, { base, head, event: 'workflow_dispatch' }))
    receipt.consumerInventory = receipt.plan.consumerInventory
    receipt.files = [WORKFLOW, '.github/workflows/governance.yml', 'scripts/verification-plan.mjs',
      'scripts/verification-qualify.mjs', 'scripts/verification-process-win.ps1', 'services/conversation-runtime/verification.json',
      'apps/server/package-lock.json', 'apps/edge/package-lock.json', 'apps/server/prisma/schema.prisma',
      'apps/server/scripts/generate-prisma-clients.mjs', 'apps/server/scripts/gen-postgres-schema.mjs',
      'apps/server/vitest.related.config.js', 'apps/server/vitest.postgres.config.js']
      .map(file => ({ path: file, sha256: sha256(path.join(root, file)) }))
    await executeTests(root, receipt.consumerInventory, output, receipt)
    assert(!git(root, ['status', '--porcelain', '--untracked-files=no']), 'CHECKOUT_CHANGED_DURING_TESTS')
    receipt.status = 'PROFILE_EXECUTION_PASS'
  } catch (error) {
    receipt.status = 'FAIL'
    receipt.error = error.message
    throw error
  } finally {
    receipt.completedAt = new Date().toISOString()
    save(receiptPath, receipt)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--process-bootstrap') processBootstrap()
  else main(process.argv.slice(2)).catch(error => { console.error('verification-qualify: ' + error.message); process.exitCode = 1 })
}

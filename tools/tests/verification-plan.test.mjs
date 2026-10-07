import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { collectChanges, createVerificationPlan, loadPilot, main, renderServiceMap } from '../../scripts/verification-plan.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const META = 'services/conversation-runtime/verification.json'
const SOURCE = 'services/conversation-runtime/src/context.js'
const DOCUMENT = 'docs/services/conversation-runtime/TESTING.md'
const CONSUMER = 'tests/unit/runtime-consumer.test.js'
const template = JSON.parse(readFileSync(path.join(REPO, META), 'utf8'))
const additional = template.additionalCoreTests.map(file => file.slice('apps/server/'.length))
const selected = (...files) => [...new Set([...additional, ...files])].sort()

function fixture(t) {
  const parent = path.resolve(tmpdir())
  const container = mkdtempSync(path.join(parent, 'zuri-verification-'))
  const root = path.join(container, 'repo')
  function put(file, text) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  for (const id of ['server', 'conversation-runtime', 'market-intelligence', 'scm']) {
    const project = id === 'server' ? 'apps/server' : `services/${id}`
    put(`${project}/package.json`, JSON.stringify({ scripts: { test: 'node --test', build: 'node build.mjs' } }))
    put(`docs/services/${id}/SERVICE.md`, '# Service\n')
    put(`docs/services/${id}/TESTING.md`, '# Testing\n')
  }
  for (const ref of template.domainRefs) put(ref, '# Charter\n')
  put(template.contract, '{}\n')
  put(META, JSON.stringify(template))
  put(SOURCE, 'export const value = 1\n')
  put(`apps/server/${CONSUMER}`, `// observes ${SOURCE}\n`)
  for (const file of template.additionalCoreTests) put(file, '// Core-only semantic consumer\n')
  put('.gitignore', 'scratch/\n')
  mkdirSync(path.join(root, 'docs/architecture'), { recursive: true })
  t.after(() => {
    assert.equal(path.dirname(container), parent)
    assert.ok(path.basename(container).startsWith('zuri-verification-'))
    rmSync(container, { recursive: true, force: true })
  })
  return { root, put, container }
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function gitFixture(t) {
  const f = fixture(t)
  git(f.root, 'init', '-q')
  git(f.root, 'add', '.')
  git(f.root, '-c', 'user.name=Verification fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline')
  return { ...f, base: git(f.root, 'rev-parse', 'HEAD') }
}

test('Runtime plus declared explanation preserves all current Core consumer tests in a shadow candidate', t => {
  const { root, put } = fixture(t)
  put('apps/server/tests/integration/runtime-second.test.js', `// ${SOURCE}`)
  const plan = createVerificationPlan(root, { changed: [SOURCE, DOCUMENT], event: 'pull_request' })
  assert.equal(plan.mode, 'shadow')
  assert.equal(plan.omissionsAllowed, false)
  assert.equal(plan.active.serverBuild, true)
  assert.equal(plan.candidate.eligible, true)
  assert.equal(plan.candidate.serverBuild, false)
  assert.deepEqual(plan.candidate.serviceJobs, ['conversation-runtime'])
  assert.deepEqual(plan.candidate.coreContractTests, selected('tests/integration/runtime-second.test.js', CONSUMER))
  assert.deepEqual(plan.active.serviceJobs, ['conversation-runtime', 'market-intelligence', 'scm'])
})

test('service-only active selection is reused without authorizing additional omissions', t => {
  const { root } = fixture(t)
  const plan = createVerificationPlan(root, { changed: [SOURCE], event: 'pull_request' })
  assert.equal(plan.active.serverBuild, false)
  assert.deepEqual(plan.active.coreContractTests, [CONSUMER])
  assert.deepEqual(plan.candidate.coreContractTests, selected(CONSUMER))
  assert.equal(plan.omissionsAllowed, false)
})

for (const changed of [
  [DOCUMENT], [SOURCE, META], [SOURCE, 'apps/server/src/lib/authority.js'],
  [SOURCE, 'docs/requirements/FR-001.md'], [SOURCE, 'services/scm/src/kernel/commerce/pricing-engine.js'],
  [SOURCE, 'services/new-service/src/main.js'], [SOURCE, '.github/workflows/governance.yml'],
  [SOURCE, 'services/conversation-runtime/package.json'], [SOURCE, 'services/conversation-runtime/scripts/build.mjs'],
]) {
  test(`outside pilot keeps conservative active work: ${changed.at(-1)}`, t => {
    const { root } = fixture(t)
    const plan = createVerificationPlan(root, { changed, event: 'pull_request' })
    assert.equal(plan.candidate.eligible, false)
    assert.deepEqual(plan.candidate.serviceJobs, plan.active.serviceJobs)
    assert.equal(plan.candidate.serverBuild, plan.active.serverBuild)
  })
}

for (const event of ['push', 'schedule', 'workflow_dispatch']) {
  test(`${event} does not enter the Runtime candidate`, t => {
    const { root } = fixture(t)
    const plan = createVerificationPlan(root, { changed: [SOURCE], event })
    assert.equal(plan.candidate.eligible, false)
    assert.equal(plan.active.serverBuild, event !== 'schedule')
    assert.equal(plan.active.governance, event !== 'schedule')
    assert.equal(plan.active.e2e, event !== 'push')
    assert.deepEqual(plan.active.serviceJobs, event === 'schedule' ? [] : ['conversation-runtime', 'market-intelligence', 'scm'])
  })
}

test('deleted/renamed Runtime source refuses a narrow candidate', t => {
  const { root, put } = fixture(t)
  rmSync(path.join(root, SOURCE))
  put('services/conversation-runtime/src/new.js', 'export const value = 1')
  const plan = createVerificationPlan(root, { changed: [SOURCE, 'services/conversation-runtime/src/new.js'] })
  assert.equal(plan.candidate.eligible, false)
  assert.match(plan.candidate.reason, /deleted or renamed/)
})

test('contract edits require wider qualification while inventory remains available', t => {
  const { root } = fixture(t)
  const plan = createVerificationPlan(root, { changed: [template.contract] })
  assert.equal(plan.candidate.eligible, false)
  assert.match(plan.candidate.reason, /contract requires wider qualification/)
  assert.deepEqual(plan.consumerInventory.selected, selected(CONSUMER))
  assert.equal(plan.omissionsAllowed, false)
})

test('empty consumer discovery cannot become a successful narrow plan', t => {
  const { root, put } = fixture(t)
  put(`apps/server/${CONSUMER}`, '// no service reference')
  const plan = createVerificationPlan(root, { changed: [SOURCE] })
  assert.equal(plan.candidate.eligible, false)
  assert.match(plan.candidate.reason, /no Core contract evidence/)
})

for (const change of [
  value => { value.schemaVersion = 1 }, value => { value.mode = 'enforce' },
  value => { value.id = 'scm' }, value => { value.root = '../elsewhere' },
  value => { value.extra = true }, value => { value.documents.push('docs/requirements/FR-001.md') },
  value => { value.domainRefs = ['../outside.md'] }, value => { value.contract = '../secret' },
  value => { value.tasks.test = 'arbitrary-command' }, value => { value.tasks.extra = 'build' },
  value => { value.additionalCoreTests = [] }, value => { value.additionalCoreTests = null },
  value => { value.additionalCoreTests.push(value.additionalCoreTests[0]) },
  value => { value.additionalCoreTests = ['apps/server/tests/unit/*.test.js'] },
  value => { value.additionalCoreTests = ['apps/server/tests/unit/has space.test.js'] },
  value => { value.additionalCoreTests = ['apps/server/tests/unit/../escaped.test.js'] },
  value => { value.additionalCoreTests = ['services/conversation-runtime/test/private.test.js'] },
  value => { value.additionalCoreTests = ['apps/server/tests/unit/options?.test.js'] },
]) {
  test(`metadata rejects mutation ${change.toString()}`, t => {
    const { root, put } = fixture(t)
    const value = structuredClone(template); change(value)
    put(META, JSON.stringify(value))
    assert.throws(() => loadPilot(root))
  })
}

test('missing reference and missing package script fail validation', t => {
  const { root, put } = fixture(t)
  put('services/conversation-runtime/package.json', JSON.stringify({ scripts: { test: 'node --test' } }))
  assert.throws(() => loadPilot(root), /MISSING_PACKAGE_SCRIPT/)
  rmSync(path.join(root, template.contract))
  assert.throws(() => loadPilot(root), /MISSING_FILE/)
})

test('reference junction/symlink escape is rejected using real paths', t => {
  const { root, container } = fixture(t)
  const docs = path.join(root, 'docs/services/conversation-runtime')
  const outside = path.join(container, 'outside')
  renameSync(docs, outside)
  try { symlinkSync(outside, docs, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) {
    renameSync(outside, docs)
    t.skip(`platform link creation unavailable: ${error.code}`)
    return
  }
  assert.throws(() => loadPilot(root), /PATH_ESCAPE/)
})

test('empty paths, traversal and unknown event fail rather than select nothing', t => {
  const { root } = fixture(t)
  for (const changed of [[], ['../outside'], ['/absolute'], ['C:/file'], ['bad\npath']]) {
    assert.throws(() => createVerificationPlan(root, { changed }))
  }
  assert.throws(() => createVerificationPlan(root, { changed: [SOURCE], event: 'unknown' }))
})

test('plan is deterministic and changed-content edits invalidate its digest', t => {
  const { root, put } = fixture(t)
  const a = createVerificationPlan(root, { changed: [DOCUMENT, SOURCE, SOURCE] })
  assert.deepEqual(a, createVerificationPlan(root, { changed: [SOURCE, DOCUMENT] }))
  put(SOURCE, 'export const value = 2')
  assert.notEqual(a.changedInputDigest, createVerificationPlan(root, { changed: [SOURCE, DOCUMENT] }).changedInputDigest)
})

test('v2 consumer inventory retains provenance and deduplicates discovered additions', t => {
  const { root, put } = fixture(t)
  put(template.additionalCoreTests[0], `// also imports ${SOURCE}`)
  const plan = createVerificationPlan(root, { changed: [DOCUMENT], revisions: { testedHead: 'a'.repeat(40) } })
  assert.equal(plan.schemaVersion, 2)
  assert.equal(plan.candidate.eligible, false)
  assert.equal(plan.consumerInventory.sourceRevision, 'a'.repeat(40))
  assert.equal(plan.consumerInventory.completeness, 'known-bounded-set')
  assert.deepEqual(plan.consumerInventory.selected, selected(CONSUMER))
  assert.equal(plan.consumerInventory.files.length, selected(CONSUMER).length)
  const before = plan.consumerInventory.files.find(file => file.path === template.additionalCoreTests[0]).sha256
  put(template.additionalCoreTests[0], '// changed Core-only semantic consumer')
  const after = createVerificationPlan(root, { changed: [DOCUMENT] }).consumerInventory
  assert.notEqual(after.files.find(file => file.path === template.additionalCoreTests[0]).sha256, before)
})

test('a missing explicitly declared consumer fails validation', t => {
  const { root } = fixture(t)
  rmSync(path.join(root, template.additionalCoreTests[0]))
  assert.throws(() => loadPilot(root), /MISSING_FILE/)
})

test('explicit consumer junction escape is rejected', t => {
  const { root, container } = fixture(t)
  const tests = path.join(root, 'apps/server/tests/integration')
  const outside = path.join(container, 'outside-consumers')
  renameSync(tests, outside)
  try { symlinkSync(outside, tests, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) {
    renameSync(outside, tests)
    t.skip(`platform link creation unavailable: ${error.code}`)
    return
  }
  assert.throws(() => loadPilot(root), /PATH_ESCAPE/)
})

test('deletion digest cannot equal a real file containing the deletion marker', t => {
  const { root, put } = fixture(t)
  put(SOURCE, 'DELETED')
  const existing = createVerificationPlan(root, { changed: [SOURCE] })
  rmSync(path.join(root, SOURCE))
  const deleted = createVerificationPlan(root, { changed: [SOURCE] })
  assert.notEqual(existing.changedInputDigest, deleted.changedInputDigest)
})

test('generated map cannot be written through an escaped parent directory', t => {
  const { root, container } = fixture(t)
  const target = path.join(root, 'docs/architecture')
  const outside = path.join(container, 'outside-map')
  renameSync(target, outside)
  try { symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) {
    renameSync(outside, target)
    t.skip(`platform link creation unavailable: ${error.code}`)
    return
  }
  assert.throws(() => main(['--map'], root), /PATH_ESCAPE/)
})

test('local collection includes staged, unstaged, untracked and rename/deletion evidence', t => {
  const { root, put, base } = gitFixture(t)
  put(SOURCE, 'export const value = 2'); git(root, 'add', SOURCE)
  put(DOCUMENT, '# Updated')
  put('services/conversation-runtime/test/new.test.js', '// new')
  git(root, 'mv', template.contract, 'services/conversation-runtime/contracts/v1/renamed.json')
  const result = collectChanges(root, { base })
  for (const file of [SOURCE, DOCUMENT, 'services/conversation-runtime/test/new.test.js', template.contract, 'services/conversation-runtime/contracts/v1/renamed.json']) assert.ok(result.changed.includes(file), file)
  assert.equal(result.revisions.workingTreeIncluded, true)
})

test('local collection keeps staged Core changes reversed in the working copy', t => {
  const { root, put } = gitFixture(t)
  const authority = 'apps/server/src/lib/authority.js'
  const original = 'export const authority = 1\n'
  put(authority, original); git(root, 'add', authority)
  git(root, '-c', 'user.name=Verification fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Core baseline')
  const base = git(root, 'rev-parse', 'HEAD')
  put(authority, 'export const authority = 2\n'); git(root, 'add', authority)
  put(authority, original)
  put(SOURCE, 'export const value = 2\n')
  const changes = collectChanges(root, { base })
  assert.ok(changes.changed.includes(authority), 'staged Core input must survive an opposing working-copy edit')
  assert.ok(changes.changed.includes(SOURCE))
  const plan = createVerificationPlan(root, changes)
  assert.equal(plan.candidate.eligible, false)
  assert.equal(plan.candidate.serverBuild, true)
  assert.match(plan.candidate.reason, /outside bounded pilot/)
  assert.equal(plan.omissionsAllowed, false)
})

test('unavailable base, option-like revision, unknown CLI flag and hosted dirty tree fail', t => {
  const { root, put, base } = gitFixture(t)
  assert.throws(() => collectChanges(root, { base: 'not-a-real-ref' }), /GIT_READ_FAILED/)
  assert.throws(() => collectChanges(root, { base: '--help' }), /INVALID_REVISION/)
  assert.throws(() => main(['--base', base, '--run'], root), /INVALID_ARGUMENTS/)
  put(SOURCE, '// dirty')
  assert.throws(() => collectChanges(root, { base, event: 'pull_request' }), /DIRTY_HOSTED_CHECKOUT/)
})

test('actual tested revision changes are included even when requested head is older', t => {
  const { root, put, base } = gitFixture(t)
  put(SOURCE, '// next commit'); git(root, 'add', SOURCE)
  git(root, '-c', 'user.name=Verification fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'change')
  const result = collectChanges(root, { base, head: base, event: 'pull_request' })
  assert.ok(result.changed.includes(SOURCE))
  assert.notEqual(result.revisions.head, result.revisions.testedHead)
})

test('Git deletion wins over an existing untracked replacement at the same path', t => {
  const { root, base } = gitFixture(t)
  git(root, 'rm', '--cached', SOURCE)
  const changes = collectChanges(root, { base })
  assert.ok(changes.deleted?.includes(SOURCE))
  assert.equal(createVerificationPlan(root, changes).candidate.eligible, false)
})

test('case-only rename preserves the deleted Git spelling on case-insensitive filesystems', t => {
  const { root, base } = gitFixture(t)
  const renamed = SOURCE.replace('context.js', 'Context.js')
  renameSync(path.join(root, SOURCE), path.join(root, renamed))
  git(root, 'rm', '--cached', SOURCE)
  git(root, 'add', renamed)
  const changes = collectChanges(root, { base })
  assert.ok(changes.deleted?.includes(SOURCE))
  assert.ok(changes.changed.includes(renamed))
  assert.equal(createVerificationPlan(root, changes).candidate.eligible, false)
})

test('generated service map is deterministic, links actual projects and rejects drift', t => {
  const { root, put } = fixture(t)
  const map = renderServiceMap(root)
  assert.equal(map, renderServiceMap(root))
  for (const id of ['server', 'conversation-runtime', 'market-intelligence', 'scm']) assert.ok(map.includes(`../services/${id}/SERVICE.md`))
  main(['--map'], root); main(['--check-map'], root)
  put('docs/architecture/SERVICE-MAP.md', 'stale')
  assert.throws(() => main(['--check-map'], root), /STALE_SERVICE_MAP/)
})

test('CI integration remains shadow-only and active scope output is not replaced', () => {
  const workflow = readFileSync(path.join(REPO, '.github/workflows/governance.yml'), 'utf8')
  assert.match(workflow, /verification-plan\.mjs/)
  assert.match(workflow, /name: verification-shadow-plan/)
  const shadowSteps = workflow.slice(workflow.indexOf('      - name: Verify shadow planner'), workflow.indexOf('      - id: filter'))
  assert.ok(shadowSteps.includes('verification-plan.mjs'))
  assert.doesNotMatch(shadowSteps, /\bid:|GITHUB_OUTPUT|continue-on-error/)
  assert.doesNotMatch(workflow, /steps\.(?:verification-shadow|shadow-plan|shadow)\.outputs/)
  assert.match(workflow, /node scripts\/ci-change-scope\.mjs/)
})

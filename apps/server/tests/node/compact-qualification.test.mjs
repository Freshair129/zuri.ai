// @spec ADR-115 — exact artifact inspection is not install/recovery qualification.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile, lstat } from 'node:fs/promises'
import { implementation, ociLayout, refreshEvidence, hash } from './compact-fixtures.mjs'
import { executorFixture, emptyObservation, ownedObservation } from './compact-task2-fixtures.mjs'

async function fixture() {
  const packageApi = await implementation('../../scripts/compact-package.mjs'), baselineApi = await implementation('../../scripts/lib/compact/baseline.mjs')
  const f = await executorFixture(packageApi, baselineApi)
  const observed = ownedObservation(f.m, f.t)
  const imageMetadata = Object.fromEntries(['web', 'tools'].map(k => [k, { reference: f.m.images[k], id: observed.images[k].id, platform: f.m.platform, sourceRevision: f.m.sourceRevision }]))
  let mutations = 0
  const driver = { inspect: async () => structuredClone(observed), inspectCandidateImages: async () => structuredClone(imageMetadata), create: () => { mutations++ }, apply: () => { mutations++ } }
  return { ...f, observed, imageMetadata, driver, mutations: () => mutations }
}
const api = () => implementation('../../scripts/lib/compact/qualify.mjs')
test('artifact inspection binds the hashed candidate to actual web/tools source labels without qualifying it', async () => {
  const a = await api(), f = await fixture(), result = await a.inspectCompactQualificationCandidate({ packageDirectory: f.packageDirectory, target: f.t, driver: f.driver })
  assert.equal(result.status, 'ARTIFACT_INSPECTED_NOT_QUALIFIED')
  assert.equal(result.sourceRevision, f.m.sourceRevision); assert.equal(result.hostCliSha256, f.m.files['compact-self-host.mjs'])
  assert.equal(result.targetId, f.t.targetId); assert.equal(f.mutations(), 0)
  assert.deepEqual(result.images.web, f.imageMetadata.web)
})
for (const [name, mutate, code] of [
  ['old app source', f => { f.imageMetadata.web.sourceRevision = 'f'.repeat(40) }, 'COMPACT_IMAGE_SOURCE_MISMATCH'],
  ['missing tools source label', f => { delete f.imageMetadata.tools.sourceRevision }, 'COMPACT_IMAGE_SOURCE_MISMATCH'],
  ['wrong image ID', f => { f.imageMetadata.web.id = `sha256:${'f'.repeat(64)}` }, 'COMPACT_IMAGE_SOURCE_MISMATCH'],
  ['wrong platform', f => { f.imageMetadata.web.platform = 'linux/arm64' }, 'COMPACT_IMAGE_SOURCE_MISMATCH'],
  ['foreign target', f => { f.observed.container.labels = {} }, 'COMPACT_FOREIGN_RESOURCE'],
]) test(`refuses ${name} before any test target mutation`, async () => {
  const a = await api(), f = await fixture(); mutate(f)
  await assert.rejects(a.inspectCompactQualificationCandidate({ packageDirectory: f.packageDirectory, target: f.t, driver: f.driver }), { code }); assert.equal(f.mutations(), 0)
})
test('corrupt candidate is refused before daemon/image inspection', async () => {
  const a = await api(), f = await fixture(); await writeFile(path.join(f.packageDirectory, 'docs/PRODUCT.md'), 'corrupt')
  let inspected = false; f.driver.inspect = async () => { inspected = true; throw new Error('must not inspect') }
  await assert.rejects(a.inspectCompactQualificationCandidate({ packageDirectory: f.packageDirectory, target: f.t, driver: f.driver }), { code: 'COMPACT_PAYLOAD_HASH_MISMATCH' }); assert.equal(inspected, false)
})
test('an absent or partial target remains not installed and never upgrades inspection to PASS', async () => {
  const a = await api(), f = await fixture(); f.driver.inspect = async () => emptyObservation(f.m, f.t)
  const result = await a.inspectCompactQualificationCandidate({ packageDirectory: f.packageDirectory, target: f.t, driver: f.driver })
  assert.equal(result.installation, 'NOT_INSTALLED'); assert.equal(result.status, 'ARTIFACT_INSPECTED_NOT_QUALIFIED')
})
test('a partially populated unmarked target is refused without repair or replacement', async () => {
  const a = await api(), f = await fixture(); f.observed.database.objectCount = 1
  await assert.rejects(a.inspectCompactQualificationCandidate({ packageDirectory: f.packageDirectory, target: f.t, driver: f.driver }), { code: 'COMPACT_DATABASE_NOT_EMPTY' })
  assert.equal(f.mutations(), 0)
})
test('unavailable image inspection cannot emit its raw private error', async () => {
  const a = await api(), f = await fixture(), secret = 'private-image-inspection-error'
  f.driver.inspectCandidateImages = async () => { throw new Error(secret) }
  await assert.rejects(a.inspectCompactQualificationCandidate({ packageDirectory: f.packageDirectory, target: f.t, driver: f.driver }), e => e.code === 'COMPACT_CANDIDATE_INSPECTION_FAILED' && !String(e).includes(secret) && e.cause === undefined)
})
test('a selected optional profile cannot silently pass a core-only artifact inspection', async () => {
  const a = await api(), f = await fixture(), p = await implementation('../../scripts/compact-package.mjs')
  f.m.profiles.push('line'); f.m.capabilities.line = 'NOT_QUALIFIED'; f.m.images.lineWorker = f.m.images.web
  const { hash } = await implementation('./compact-fixtures.mjs')
  for (const [file, bytes] of Object.entries(await p.renderCompactRuntimeFiles(f.m))) f.m.files[file] = hash(bytes)
  const filename = path.join(f.root, 'input', 'release-manifest.json'); await writeFile(filename, JSON.stringify(f.m))
  const packageDirectory = path.join(f.root, 'line-release'); await p.packageCompactRelease({ manifest: filename, outputDirectory: packageDirectory })
  f.driver.inspect = async () => ownedObservation(f.m, f.t)
  await assert.rejects(a.inspectCompactQualificationCandidate({ packageDirectory, target: f.t, driver: f.driver }), { code: 'COMPACT_PROFILE_QUALIFICATION_REQUIRED' })
  assert.equal(f.mutations(), 0)
})
test('owned fixture loads the supplied immutable package and refuses a foreign source/image selection', async () => {
  const f = await fixture(), helper = await implementation('../helpers/compact-postgres-target.mjs')
  assert.equal(typeof helper.readCompactFixturePackage, 'function')
  const args = { packageDirectory: f.packageDirectory, sourceRevision: f.m.sourceRevision, componentImages: f.m.images }
  const loaded = await helper.readCompactFixturePackage(args)
  assert.deepEqual(loaded.manifest, f.m); assert.equal(loaded.root, f.packageDirectory)
  await assert.rejects(helper.readCompactFixturePackage({ ...args, sourceRevision: 'f'.repeat(40) }), { code: 'COMPACT_FIXTURE_PACKAGE_MISMATCH' })
  await assert.rejects(helper.readCompactFixturePackage({ ...args, componentImages: { ...f.m.images, web: f.m.images.web.replace('test/web', 'foreign/web') } }), { code: 'COMPACT_FIXTURE_PACKAGE_MISMATCH' })
})
test('fixture package loading rejects corruption without creating or inspecting Docker resources', async () => {
  const f = await fixture(), helper = await implementation('../helpers/compact-postgres-target.mjs')
  assert.equal(typeof helper.readCompactFixturePackage, 'function')
  await writeFile(path.join(f.packageDirectory, 'docs/PRODUCT.md'), 'corrupted fixture package')
  await assert.rejects(helper.readCompactFixturePackage({ packageDirectory: f.packageDirectory }), { code: 'COMPACT_PAYLOAD_HASH_MISMATCH' })
})
test('retained candidate preserves the verified inventory and never replaces existing output', async () => {
  const a = await api(), f = await fixture(), destination = path.join(f.root, 'retained')
  assert.equal(typeof a.retainCompactQualificationPackage, 'function')
  const result = await a.retainCompactQualificationPackage({ packageDirectory: f.packageDirectory, destination })
  assert.equal(result.status, 'ARTIFACT_COPIED_NOT_QUALIFIED')
  const executor = await implementation('../../scripts/lib/compact/executor.mjs'), loaded = await executor.loadCompactPackage(destination)
  assert.deepEqual(loaded.manifest, f.m)
  await assert.rejects(a.retainCompactQualificationPackage({ packageDirectory: f.packageDirectory, destination }), { code: 'COMPACT_RETENTION_DESTINATION_INVALID' })
  assert.deepEqual((await executor.loadCompactPackage(destination)).manifest, f.m)
})
test('fixture cleanup distinguishes absent resources from daemon failure without exposing diagnostics', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs')
  assert.equal(typeof helper.inspectCompactFixtureResource, 'function')
  assert.equal(await helper.inspectCompactFixtureResource('default', 'container', 'test', async () => ({ status: 1, stderr: 'Error: No such container: test' })), null)
  await assert.rejects(helper.inspectCompactFixtureResource('default', 'container', 'test', async () => ({ status: 1, stderr: 'private-daemon-error' })), e => e.code === 'COMPACT_FIXTURE_CLEANUP_UNVERIFIED' && !String(e).includes('private-daemon-error'))
  await assert.rejects(helper.inspectCompactFixtureResource('default', 'container', 'test', async () => ({ status: 0, stdout: 'not-json' })), { code: 'COMPACT_FIXTURE_CLEANUP_UNVERIFIED' })
})
test('cleanup refuses any missing owner label, including project and environment', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs'), f = await fixture()
  assert.equal(typeof helper.assertCompactFixtureOwnership, 'function')
  const labels = f.observed.container.labels
  for (const key of Object.keys(labels)) {
    const changed = { ...labels }; delete changed[key]
    assert.throws(() => helper.assertCompactFixtureOwnership('container', { Config: { Labels: changed } }, f.t), { code: 'COMPACT_FIXTURE_FOREIGN_RESOURCE' })
  }
  assert.doesNotThrow(() => helper.assertCompactFixtureOwnership('container', { Config: { Labels: labels } }, f.t))
})

test('cleanup retains the first refusal while still attempting other independently owned resources', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs'), completed = []
  assert.equal(typeof helper.completeCompactFixtureCleanup, 'function')
  const first = Object.assign(new Error('COMPACT_FIXTURE_FOREIGN_RESOURCE'), { code: 'COMPACT_FIXTURE_FOREIGN_RESOURCE' })
  await assert.rejects(helper.completeCompactFixtureCleanup([
    async () => { completed.push('foreign-refused'); throw first },
    async () => { completed.push('owned-volume-removed') },
    async () => { completed.push('daemon-refused'); throw new Error('COMPACT_FIXTURE_CLEANUP_UNVERIFIED') },
    async () => { completed.push('owned-network-attempted') },
  ]), error => error === first)
  assert.deepEqual(completed, ['foreign-refused', 'owned-volume-removed', 'daemon-refused', 'owned-network-attempted'])
})

test('fixture finalization records identity only after every owned cleanup action', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs'), calls = [], identity = { targetId: 'synthetic' }
  const result = await helper.observeAndCleanCompactFixture({ observe: async () => identity,
    cleanup: [async () => { calls.push('disconnect') }, async () => { calls.push('close') }],
    record: async view => { calls.push('record'); assert.deepEqual(view, { identity, observation: 'PASS', cleanup: 'PASS', cleanupChecks: ['PASS', 'PASS'] }) },
  })
  assert.deepEqual(calls, ['disconnect', 'close', 'record'])
  assert.equal(result.error, null); assert.equal(result.record, 'PASS')
})

test('an uncreated fixture is not reported as observed or successfully cleaned', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs')
  const result = await helper.observeAndCleanCompactFixture({ observe: async () => undefined, cleanup: [], record: async view => {
    assert.equal(view.observation, 'NOT_RUN'); assert.equal(view.cleanup, 'NOT_REQUIRED')
    assert.deepEqual(view.cleanupChecks, [])
  } })
  assert.equal(result.observation, 'NOT_RUN'); assert.equal(result.cleanup, 'NOT_REQUIRED')
  assert.equal(result.error, null); assert.equal(result.record, 'PASS')
})

test('failed observation still disconnects and closes the owned target before recording FAIL', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs'), calls = [], first = new Error('SYNTHETIC_OBSERVATION_FAILURE')
  const result = await helper.observeAndCleanCompactFixture({ observe: async () => { throw first },
    cleanup: [async () => { calls.push('disconnect') }, async () => { calls.push('close') }],
    record: async view => { calls.push('record'); assert.equal(view.observation, 'FAIL'); assert.equal(view.cleanup, 'PASS') },
  })
  assert.deepEqual(calls, ['disconnect', 'close', 'record'])
  assert.equal(result.error, first); assert.equal(result.record, 'PASS')
})

test('failed disconnect cannot skip later disconnects or owned target closure', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs'), calls = [], first = new Error('SYNTHETIC_DISCONNECT_FAILURE')
  const result = await helper.observeAndCleanCompactFixture({ observe: async () => ({}),
    cleanup: [async () => { calls.push('first'); throw first }, async () => { calls.push('second') }, async () => { calls.push('close') }],
    record: async view => { calls.push('record'); assert.equal(view.cleanup, 'FAIL'); assert.deepEqual(view.cleanupChecks, ['FAIL', 'PASS', 'PASS']) },
  })
  assert.deepEqual(calls, ['first', 'second', 'close', 'record'])
  assert.equal(result.error, first); assert.equal(result.record, 'PASS')
})

test('combined observation, cleanup and record errors survive without entering the safe evidence view', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs'), errors = ['observation', 'cleanup', 'record'].map(stage => new Error(`DO_NOT_ECHO_${stage}`))
  let closed = false
  const result = await helper.observeAndCleanCompactFixture({ observe: async () => { throw errors[0] },
    cleanup: [async () => { throw errors[1] }, async () => { closed = true }],
    record: async view => { assert.equal(closed, true); assert.equal(view.observation, 'FAIL'); assert.equal(view.cleanup, 'FAIL'); assert(!JSON.stringify(view).includes('DO_NOT_ECHO')); throw errors[2] },
  })
  assert.equal(result.record, 'FAIL'); assert(result.error instanceof AggregateError)
  assert.deepEqual(result.error.errors, errors)
})

test('failed fixture setup removes its verified private temp root and preserves the setup failure', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs')
  assert.equal(typeof helper.withCompactFixtureRoot, 'function')
  let createdRoot
  const first = new Error('COMPACT_TEST_SETUP_FAILURE')
  await assert.rejects(helper.withCompactFixtureRoot(async root => {
    createdRoot = root
    await writeFile(path.join(root, 'private runtime.env'), 'SYNTHETIC_TEST_ONLY', { mode: 0o600 })
    throw first
  }), error => error === first)
  await assert.rejects(lstat(createdRoot), { code: 'ENOENT' })
})

test('failed setup cannot call an unregistered private-temp cleanup failure PASS or expose raw diagnostics', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs')
  const error = Object.assign(new Error('private-password-diagnostic'), { cleanupFailed: true })
  const observed = helper.compactFixtureSetupFailure(error)
  assert.equal(observed.status, 'FAIL'); assert.equal(observed.cleanup, 'FAIL'); assert.equal(observed.failureCode, 'COMPACT_FIXTURE_SETUP_FAILED')
  assert(!JSON.stringify(observed).includes(error.message))
  assert.equal(helper.compactFixtureSetupFailure(new Error('setup failed before resource creation')).cleanup, 'PASS')
})

test('owned fixtures select the explicit CI Docker context while preserving local defaults and refusing endpoint strings', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs')
  assert.equal(typeof helper.compactFixtureDockerContext, 'function')
  assert.equal(helper.compactFixtureDockerContext({}, 'win32'), 'desktop-linux')
  assert.equal(helper.compactFixtureDockerContext({}, 'linux'), 'default')
  assert.equal(helper.compactFixtureDockerContext({ COMPACT_TEST_DOCKER_CONTEXT: 'compact-core-ci' }, 'linux'), 'compact-core-ci')
  for (const value of ['', 'tcp://remote:2375', 'unix:///socket', 'bad context', '--host']) assert.throws(() => helper.compactFixtureDockerContext({ COMPACT_TEST_DOCKER_CONTEXT: value }, 'linux'), { code: 'COMPACT_FIXTURE_CONTEXT_INVALID' })
})

test('selected context endpoints must be local before any engine network inventory is requested', async () => {
  const helper = await implementation('../helpers/compact-postgres-target.mjs')
  assert.equal(typeof helper.assertCompactFixtureLocalEndpoint, 'function')
  for (const endpoint of ['unix:///var/run/docker.sock', 'unix:///home/runner/setup-docker-action/docker.sock', 'npipe:////./pipe/dockerDesktopLinuxEngine']) assert.doesNotThrow(() => helper.assertCompactFixtureLocalEndpoint(endpoint))
  for (const endpoint of ['tcp://remote:2375', 'ssh://production', 'unix://remote/path', 'npipe:////server/pipe/dockerDesktopLinuxEngine', undefined]) assert.throws(() => helper.assertCompactFixtureLocalEndpoint(endpoint), { code: 'COMPACT_FIXTURE_REMOTE_REFUSED' })
})

test('core acceptance refuses an omitted artifact before creating any target', async () => {
  const helper = await implementation('../helpers/compact-core-target.mjs')
  const previous = process.env.COMPACT_PACKAGE_DIRECTORY
  delete process.env.COMPACT_PACKAGE_DIRECTORY
  try { await assert.rejects(helper.startCompactCoreTarget(), /COMPACT_CORE_EXPLICIT_ARTIFACT_REQUIRED/) }
  finally { if (previous !== undefined) process.env.COMPACT_PACKAGE_DIRECTORY = previous }
})

test('cold CI input requires an exact-source core OCI artifact and preserves the selected image mapping', async () => {
  const a = await api(), f = await fixture(), packageApi = await implementation('../../scripts/compact-package.mjs')
  assert.equal(typeof a.readCompactCoreCiInput, 'function')
  await assert.rejects(a.readCompactCoreCiInput({ packageDirectory: f.packageDirectory, expectedRevision: f.m.sourceRevision }), { code: 'COMPACT_CI_OCI_REQUIRED' })
  const input = path.join(f.root, 'input'), layoutDirectory = path.join(f.root, 'oci')
  await ociLayout(layoutDirectory, f.m); await refreshEvidence(input, f.m)
  for (const [file, value] of Object.entries(await packageApi.renderCompactRuntimeFiles(f.m))) f.m.files[file] = hash(value)
  const manifest = path.join(input, 'release-manifest.json'); await writeFile(manifest, JSON.stringify(f.m))
  const packageDirectory = path.join(f.root, 'oci-package'); await packageApi.packageCompactRelease({ manifest, outputDirectory: packageDirectory, imageExporter: async () => ({ layoutDirectory }) })
  const result = await a.readCompactCoreCiInput({ packageDirectory, expectedRevision: f.m.sourceRevision })
  assert.equal(result.status, 'ARTIFACT_VERIFIED_NOT_QUALIFIED'); assert.deepEqual(result.images, f.m.images)
  await assert.rejects(a.readCompactCoreCiInput({ packageDirectory, expectedRevision: 'f'.repeat(40) }), { code: 'COMPACT_SOURCE_REVISION_MISMATCH' })
  await writeFile(path.join(packageDirectory, 'images.oci.tar'), 'CORRUPT')
  await assert.rejects(a.readCompactCoreCiInput({ packageDirectory, expectedRevision: f.m.sourceRevision }), { code: 'COMPACT_PAYLOAD_HASH_MISMATCH' })
})

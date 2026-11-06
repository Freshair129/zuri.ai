// @spec ADR-115 — explicit selected artifact/TEST baseline acceptance; never AI readiness.
// @tested tests/integration/compact-knowledge-package.test.js
import { beforeAll, afterAll, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, realpath, lstat } from 'node:fs/promises'
import path from 'node:path'
import * as packageApi from '../../scripts/compact-package.mjs'
import * as baselineApi from '../../scripts/lib/compact/baseline.mjs'
import * as executorApi from '../../scripts/lib/compact/executor.mjs'
import { inspectCompactKnowledgeCandidate, readCompactCoreCiInput, retainCompactQualificationPackage } from '../../scripts/lib/compact/qualify.mjs'
import { renderCompactKnowledgeProbeProgram } from '../helpers/compact-knowledge-probe.mjs'
import { compactOwnerLabels } from '../../scripts/lib/compact/target.mjs'
import { compactProcessEnvironment } from '../../scripts/lib/compact/docker.mjs'
import { digest, bytes, stableJson } from '../../scripts/lib/compact/files.mjs'
import { compactFixture, fixtureDocker, assertCompactFixtureOwnership, inspectCompactFixtureResource, observeAndCleanCompactFixture, assertCompactKnowledgeEvidencePath } from '../helpers/compact-postgres-target.mjs'

const input = process.env.COMPACT_KNOWLEDGE_PACKAGE, retained = process.env.COMPACT_KNOWLEDGE_RETAIN
const revision = process.env.COMPACT_KNOWLEDGE_REVISION, evidence = process.env.COMPACT_KNOWLEDGE_OBSERVATION
let images
try { images = JSON.parse(process.env.COMPACT_KNOWLEDGE_IMAGES) } catch { throw new Error('COMPACT_KNOWLEDGE_TEST_INPUT_REQUIRED') }
if (!input || !retained || !path.isAbsolute(retained) || !/^[a-f0-9]{40}$/.test(revision || '') || !evidence || !path.isAbsolute(evidence)) throw new Error('COMPACT_KNOWLEDGE_TEST_INPUT_REQUIRED')
const expected = ['relocated', 'inspected', 'core-refused', 'bundled-inspect', 'installed', 'idempotent', 'no-grant', 'runtime-files', 'real-embedding', 'corrupt-refused']
const completed = new Set(), probes = new Set(), runtime = {}
let f, loaded, retainedRoot, initial, evidenceValidated = false
const docker = args => fixtureDocker(f.target.dockerContext, args)
const inspect = () => inspectCompactKnowledgeCandidate({ packageDirectory: retained, expectedRevision: revision, target: f.target, driver: f.driver })
const cli = verb => JSON.parse(execFileSync(process.execPath, [path.join(retained, 'compact-self-host.mjs'), verb, '--package', retained, '--target', f.targetFile,
  ...(verb === 'knowledge-inspect' ? ['--expected-revision', revision] : [])], { cwd: f.root, env: compactProcessEnvironment(), encoding: 'utf8', windowsHide: true,
  timeout: 120000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }))
async function removeProbe(id) {
  const resource = await inspectCompactFixtureResource(f.target.dockerContext, 'container', id)
  if (resource) { assertCompactFixtureOwnership('container', resource, f.target); docker(['container', 'rm', '--force', id]) }
  probes.delete(id)
}

beforeAll(async () => {
  await assertCompactKnowledgeEvidencePath({ packageDirectory: input, retainedDirectory: retained, evidenceFile: evidence })
  evidenceValidated = true
  await retainCompactQualificationPackage({ packageDirectory: input, destination: retained })
  retainedRoot = await realpath(retained); loaded = await executorApi.loadCompactPackage(retained)
  expect(retainedRoot).not.toBe(await realpath(input)); completed.add('relocated')
  f = await compactFixture({ packageApi, baselineApi, executorApi, knowledgePackageDirectory: retained, sourceRevision: revision, componentImages: images })
  initial = await f.driver.inspect({ manifest: f.manifest, target: f.target })
})
afterAll(async () => {
  if (!evidenceValidated) return // A refused output must never be written by finalization.
  const result = await observeAndCleanCompactFixture({
    observe: async () => {
      if (!f) return undefined
      const report = await inspect()
      return { targetId: f.target.targetId, project: f.target.project, final: report.databaseInstallation,
        packageInventorySha256: report.packageInventorySha256, images: report.images }
    },
    cleanup: [...probes].map(id => () => removeProbe(id)).concat(f ? [() => f.close()] : []),
    record: async view => writeFile(evidence, JSON.stringify({ environment: 'TEST', sourceRevision: revision, status: expected.every(key => completed.has(key)) && view.observation === 'PASS' && view.cleanup === 'PASS' ? 'PASS' : 'FAIL',
      observation: view.observation, cleanup: view.cleanup, cleanupChecks: view.cleanupChecks, identity: view.identity,
      profiles: { line: 'NOT_SELECTED', knowledge: 'NOT_QUALIFIED' }, databaseBaselineOnly: true, runtime, checks: Object.fromEntries(expected.map(key => [key, completed.has(key)])),
      manifestSha256: loaded && digest(stableJson(loaded.manifest)), packageInventorySha256: view.identity?.packageInventorySha256, images: view.identity?.images,
      task6Closed: false, nativeStage9Restore: 'NOT_PROVEN', liveLineUat: 'NOT_RUN' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }),
  })
  if (result.error) throw result.error
})

it('inspects a relocated Knowledge artifact and preserves the core-only guard', async () => {
  const report = await inspect()
  expect(report).toMatchObject({ status: 'ARTIFACT_INSPECTED_NOT_QUALIFIED', sourceRevision: revision, databaseInstallation: 'NOT_INSTALLED',
    imageEvidence: 'REFERENCE_PLATFORM_AND_ASSEMBLY_LABELS_ONLY', capabilities: { knowledge: 'NOT_QUALIFIED', line: 'NOT_SELECTED' } })
  expect(Object.keys(report.images).sort()).toEqual(Object.keys(images).sort())
  completed.add('inspected')
  await expect(readCompactCoreCiInput({ packageDirectory: retained, expectedRevision: revision })).rejects.toMatchObject({ code: 'COMPACT_PROFILE_QUALIFICATION_REQUIRED' })
  completed.add('core-refused')
  expect(cli('knowledge-inspect').manifestSha256).toBe(report.manifestSha256); completed.add('bundled-inspect')
})

it('installs the packaged fresh baseline through the bundled CLI without a checkout or automatic grants', async () => {
  expect(cli('install')).toMatchObject({ status: 'INSTALLED', initialized: true }); completed.add('installed')
  expect((await inspect()).databaseInstallation).toBe('INSTALLED')
  expect(cli('install')).toMatchObject({ status: 'INSTALLED', initialized: false }); completed.add('idempotent')
  for (const table of ['Business', 'Tenant', 'IntegrationCredential', 'KnowledgeIngestion']) expect((await f.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n).toBe(0)
  const final = await f.driver.inspect({ manifest: f.manifest, target: f.target })
  expect(initial.container).toBeNull(); expect(final.database.installation).toBeTruthy()
  completed.add('no-grant')
})

async function probe(role) {
  const image = images[role], metadata = JSON.parse(docker(['image', 'inspect', image]))[0]
  expect(Object.keys(metadata.Config.Volumes || {}).length).toBe(0) // No anonymous volumes may be created.
  const worker = role === 'genesisWorker'
  const program = renderCompactKnowledgeProbeProgram({role,expectedPins:f.manifest.componentPins})
  const labels = Object.entries(compactOwnerLabels(f.target)).flatMap(([key, value]) => ['--label', `${key}=${value}`])
  const id = docker(['container', 'create', '--pull', 'never', '--name', `${f.target.project}-probe-${randomUUID()}`, ...labels,
    '--network', 'none', '--read-only', '--user', 'node', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--log-driver', 'none',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--workdir', '/tmp',
    ...(worker ? ['--mount', `type=bind,source=${path.join(retainedRoot, 'models', f.manifest.modelArtifacts[0].id)},target=/opt/ki17/model,readonly`] : []),
    '--entrypoint', worker ? '/opt/ki17/node/bin/node' : 'node', image, '--input-type=module', '-e', program])
  probes.add(id)
  try {
    const container = await inspectCompactFixtureResource(f.target.dockerContext, 'container', id)
    assertCompactFixtureOwnership('container', container, f.target)
    expect(container.Image).toBe(metadata.Id)
    if (worker) expect(container.Mounts.find(mount => mount.Destination === '/opt/ki17/model')?.RW).toBe(false)
    const output = docker(['container', 'start', '--attach', id])
    const stopped = await inspectCompactFixtureResource(f.target.dockerContext, 'container', id)
    expect(stopped.State.ExitCode).toBe(0); expect(stopped.State.OOMKilled).toBe(false)
    return { ...JSON.parse(output), imageId: container.Image, imageReference: image }
  } finally { await removeProbe(id) }
}

it('checks actual packaged runtime files and performs offline inference from the readonly packaged model', async () => {
  for (const role of ['web', 'tools', 'genesisWorker']) runtime[role] = await probe(role)
  expect(runtime.genesisWorker).toMatchObject({ pinsMatch: true, modelFiles: 5, embeddingDimensions: 384, nativeAddonLoaded: true })
  completed.add('runtime-files'); completed.add('real-embedding')
})

it('refuses altered model bytes before Docker and restores only its run-created retained TEST copy', async () => {
  expect(await realpath(retained)).toBe(retainedRoot); expect((await lstat(retained)).isSymbolicLink()).toBe(false)
  const file = path.join(retainedRoot, 'models', f.manifest.modelArtifacts[0].id, 'config.json'), original = await readFile(file)
  let reads = 0
  try {
    await writeFile(file, Buffer.concat([original, Buffer.from('\n')]))
    await expect(inspectCompactKnowledgeCandidate({ packageDirectory: retainedRoot, expectedRevision: revision, target: f.target,
      driver: { inspect: async () => { reads++; throw new Error('DOCKER_MUST_NOT_BE_READ') } } })).rejects.toMatchObject({ code: 'COMPACT_PAYLOAD_HASH_MISMATCH' })
    expect(reads).toBe(0)
  } finally { await writeFile(file, original) }
  expect(digest(await bytes(retainedRoot, 'SHA256SUMS', 32 * 1024 * 1024))).toBe(digest(await bytes(input, 'SHA256SUMS', 32 * 1024 * 1024)))
  await executorApi.loadCompactPackage(retainedRoot); completed.add('corrupt-refused')
})

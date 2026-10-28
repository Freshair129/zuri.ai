// @spec ADR-115 — actual idle Compose replacement, not active-work or AI qualification.
// @tested tests/integration/compact-knowledge-cohort.test.js
import { beforeAll, afterAll, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile, realpath } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import * as packageApi from '../../scripts/compact-package.mjs'
import * as baselineApi from '../../scripts/lib/compact/baseline.mjs'
import * as executorApi from '../../scripts/lib/compact/executor.mjs'
import { compactProcessEnvironment, runCompactDocker } from '../../scripts/lib/compact/docker.mjs'
import { inspectCompactKnowledgeCandidate, retainCompactQualificationPackage } from '../../scripts/lib/compact/qualify.mjs'
import { inspectCompactCohort } from '../../scripts/lib/compact/profiles.mjs'
import { compactOwnerLabels } from '../../scripts/lib/compact/target.mjs'
import { compactFixture, assertCompactKnowledgeEvidencePath, assertCompactFixtureOwnership, inspectCompactFixtureResource, observeAndCleanCompactFixture } from '../helpers/compact-postgres-target.mjs'
import { compactKnowledgeCohortConfiguration, assertCompactKnowledgeCohortContainer, assertCompactKnowledgeProjectInventory, assertCompactKnowledgeNegativeProbe } from '../helpers/compact-knowledge-cohort.mjs'

const input = process.env.COMPACT_KNOWLEDGE_PACKAGE, retained = process.env.COMPACT_KNOWLEDGE_RETAIN
const revision = process.env.COMPACT_KNOWLEDGE_REVISION, evidence = process.env.COMPACT_KNOWLEDGE_OBSERVATION
let images
try { images = JSON.parse(process.env.COMPACT_KNOWLEDGE_IMAGES) } catch { throw new Error('COMPACT_COHORT_TEST_INPUT_REQUIRED') }
if (!input || !retained || !evidence || !/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('COMPACT_COHORT_TEST_INPUT_REQUIRED')
const git = args => execFileSync('git', args, { env: compactProcessEnvironment(), encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('COMPACT_COHORT_CLEAN_HARNESS_REQUIRED')
const harnessRevision = git(['rev-parse', 'HEAD'])
const completed = new Set(), expected = ['package', 'baseline', 'startup', 'missing-token', 'idle-stop', 'stale-namespace', 'rebind', 'retained-state', 'no-application-authority']
const snapshots = {}, intended = new Set(), uncertainRoles = new Set(), probes = new Set(), uncertainProbes = new Set(), marker = `COMPACT_IDLE_TEST_${randomUUID()}`
let f, config, retainedRoot, composeArgs, webPort, evidenceValidated = false, nativeVolumeIntent = false, admissionObserved = false
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const name = role => `${f.target.project}-${role}-1`
const resource = (kind, id) => inspectCompactFixtureResource(f.target.dockerContext, kind, id)
async function docker(args, allowFailure = false) {
  const result = await runCompactDocker(['--context', f.target.dockerContext, ...args], { timeoutMs: 60000 })
  if (result.status !== 0 && !allowFailure) throw new Error('COMPACT_COHORT_DOCKER_FAILED')
  return allowFailure ? result : result.stdout.trim()
}
async function owned(role) {
  const container = await resource('container', name(role))
  const key = role === 'web' ? 'web' : 'genesisWorker'
  assertCompactKnowledgeCohortContainer({ container, role, target: f.target, manifest: f.manifest, expectedImageId: snapshots.artifact.images[key].id })
  return container
}
async function exec(role, program) {
  const c = await owned(role)
  return docker(['container', 'exec', c.Id, role === 'web' ? 'node' : '/opt/ki17/node/bin/node', '--input-type=module', '-e', program])
}
async function currentCohort() {
  const raw = await f.driver.inspectCohort({ manifest: f.manifest, target: f.target, modelDirectory: path.join(retainedRoot, 'models', f.manifest.modelArtifacts[0].id) })
  const result = inspectCompactCohort({ ...raw, manifest: f.manifest, target: f.target })
  const web = raw.containers.find(c => c.service === 'web'), native = raw.containers.find(c => c.service === 'genesis-worker')
  const webContainer = await owned('web'), nativeContainer = await owned('genesis-worker')
  return { ...result, webId: web?.id, nativeId: native?.id, nativeNetworkMode: native?.networkMode,
    images: { web: web?.reference, genesisWorker: native?.reference },
    imageIds: { web: webContainer.Image, genesisWorker: nativeContainer.Image },
    volumes: raw.volumes.map(v => ({ name: v.name, driver: v.driver })),
    readonlyModelMatchesPackage: !result.missing.includes('PINNED_MODEL_MOUNT_UNAVAILABLE') }
}
async function ready() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const web = await owned('web'), native = await owned('genesis-worker')
      if (!web.State.Running || !native.State.Running) throw new Error('COMPACT_COHORT_NOT_RUNNING')
      const health = await fetch(`http://127.0.0.1:${webPort}/api/health`, { signal: AbortSignal.timeout(1000) })
      const refusal = await exec('web', `try{const r=await fetch('http://127.0.0.1:19417/query',{method:'POST',headers:{authorization:'Bearer WRONG_TEST_ONLY'},body:'{}',signal:AbortSignal.timeout(1000)});process.stdout.write(String(r.status))}catch{process.stdout.write('UNAVAILABLE')}`)
      if (health.status === 200 && refusal === '401') return { webHealthStatus: 200, unauthenticatedNativeStatus: 401 }
    } catch { /* Fixed deadline; process exit/missing scope never becomes readiness. */ }
    await pause(200)
  }
  throw new Error('COMPACT_COHORT_STARTUP_UNAVAILABLE')
}
async function up(role, recreate = false) {
  if (!intended.has(role)) {
    if (await resource('container', name(role))) throw new Error('COMPACT_COHORT_EXISTING_CONTAINER_REFUSED')
    intended.add(role)
  } else await owned(role)
  for (const volumeRole of ['genesis', 'knowledge-state']) {
    const volume = await resource('volume', `${f.target.project}-${volumeRole}`)
    if (volume) {
      if (!nativeVolumeIntent) throw new Error('COMPACT_COHORT_EXISTING_VOLUME_REFUSED')
      assertCompactFixtureOwnership('volume', volume, f.target)
    }
  }
  nativeVolumeIntent = true
  uncertainRoles.add(role)
  await docker([...composeArgs, 'up', '--detach', '--no-deps', '--pull', 'never', ...(recreate ? ['--force-recreate'] : []), role])
  const container = await owned(role); uncertainRoles.delete(role)
  return container
}
async function removeRole(role) {
  const c = await resource('container', name(role))
  if (c) { assertCompactKnowledgeCohortContainer({ container: c, role, target: f.target, manifest: f.manifest, expectedImageId: snapshots.artifact.images[role === 'web' ? 'web' : 'genesisWorker'].id }); await docker(['container', 'rm', '--force', c.Id]) }
  if (uncertainRoles.has(role)) throw new Error('COMPACT_COHORT_COMPOSE_RESULT_UNVERIFIED')
}
async function removeProbe(probeName) {
  const c = await resource('container', probeName)
  if (c) {
    assertCompactKnowledgeNegativeProbe({ container: c, probeName, target: f.target, manifest: f.manifest, expectedImageId: snapshots.artifact.images.genesisWorker.id })
    await docker(['container', 'rm', '--force', c.Id])
  } else if (uncertainProbes.has(probeName)) throw new Error('COMPACT_COHORT_PROBE_CREATION_UNVERIFIED')
  probes.delete(probeName); uncertainProbes.delete(probeName)
}

beforeAll(async () => {
  await assertCompactKnowledgeEvidencePath({ packageDirectory: input, retainedDirectory: retained, evidenceFile: evidence }); evidenceValidated = true
  await retainCompactQualificationPackage({ packageDirectory: input, destination: retained }); retainedRoot = await realpath(retained)
  f = await compactFixture({ packageApi, baselineApi, executorApi, knowledgePackageDirectory: retained, sourceRevision: revision, componentImages: images })
  if (f.manifest.storageQualification.licenseRequired) throw new Error('COMPACT_COHORT_EXTERNAL_LICENSE_NOT_SELECTED')
  const candidate = await inspectCompactKnowledgeCandidate({ packageDirectory: retained, expectedRevision: revision, target: f.target, driver: f.driver })
  snapshots.artifact = { manifestSha256: candidate.manifestSha256, packageInventorySha256: candidate.packageInventorySha256, images: candidate.images }; completed.add('package')
  expect((await f.install()).initialized).toBe(true); completed.add('baseline')
  webPort = await new Promise((resolve, reject) => { const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
  config = compactKnowledgeCohortConfiguration({ target: f.target, root: f.root, webPort })
  for (const key of ['app', 'knowledge', 'storage']) await writeFile(config.files[key], config[key], { flag: 'wx', mode: 0o600 })
  const selectors = path.join(f.root, 'private selectors.env')
  await writeFile(selectors, Object.entries(config.selectors).map(([key, value]) => `${key}='${String(value).replaceAll('\\', '/')}'`).join('\n') + '\n', { flag: 'wx', mode: 0o600 })
  composeArgs = ['compose', '--project-name', f.target.project, '--env-file', selectors, '--file', path.join(retainedRoot, 'compose.yml')]
  const projectIds = (await docker(['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', `label=com.docker.compose.project=${f.target.project}`])).split(/\r?\n/).filter(Boolean)
  assertCompactKnowledgeProjectInventory({ ids: projectIds, database: await resource('container', f.target.database.container), target: f.target, manifest: f.manifest })
  for (const role of ['genesis', 'knowledge-state']) if (await resource('volume', `${f.target.project}-${role}`)) throw new Error('COMPACT_COHORT_EXISTING_VOLUME_REFUSED')
  await docker([...composeArgs, '--profile', 'knowledge', 'config', '--quiet'])
})

afterAll(async () => {
  if (!evidenceValidated) return
  const cleanup = f ? [
    ...[...probes].map(id => () => removeProbe(id)),
    ...[...intended].reverse().map(role => () => removeRole(role)),
    ...(nativeVolumeIntent ? ['genesis', 'knowledge-state'].map(role => async () => { const volume = await resource('volume', `${f.target.project}-${role}`); if (volume) { assertCompactFixtureOwnership('volume', volume, f.target); await docker(['volume', 'rm', volume.Name]) } }) : []),
    () => f.close(),
  ] : []
  const result = await observeAndCleanCompactFixture({ observe: async () => {
    if (!f) return undefined
    const final = await inspectCompactKnowledgeCandidate({ packageDirectory: retained, expectedRevision: revision, target: f.target, driver: f.driver })
    expect(final.manifestSha256).toBe(snapshots.artifact.manifestSha256)
    expect(final.packageInventorySha256).toBe(snapshots.artifact.packageInventorySha256)
    return { targetId: f.target.targetId, project: f.target.project, manifestSha256: final.manifestSha256, packageInventorySha256: final.packageInventorySha256 }
  }, cleanup,
    record: view => writeFile(evidence, JSON.stringify({ environment: 'TEST', packageSource: revision, harnessRevision,
      status: expected.every(key => completed.has(key)) && view.observation === 'PASS' && view.cleanup === 'PASS' ? 'PASS' : 'FAIL',
      observation: view.observation, cleanup: view.cleanup, cleanupChecks: view.cleanupChecks, identity: view.identity, snapshots,
      checks: Object.fromEntries(expected.map(key => [key, completed.has(key)])), applicationAdmission: admissionObserved ? 'DISABLED' : 'NOT_VERIFIED', applicationAuthority: 'NOT_QUALIFIED', unresolvedProbeIntents: [...probes], unresolvedComposeIntents: [...uncertainRoles],
      knowledge: 'NOT_QUALIFIED', line: 'NOT_SELECTED', activeWorkDrainReplayDedup: 'NOT_PROVEN', nativeStage9: 'NOT_PROVEN', liveLineUat: 'NOT_RUN', task6Closed: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }) })
  if (result.error) throw result.error
})

it('starts the actual packaged web/native cohort with disabled admission and readonly model', async () => {
  const web = await up('web')
  expect(web.Config.Env.includes('ZURI_KNOWLEDGE_ENABLED=0')).toBe(true)
  expect(web.Config.Env.includes('ZURI_KNOWLEDGE_STORAGE_ENABLED=0')).toBe(true)
  expect(web.Config.Env.some(value => /^(?:ZURI_LINE_|ZURI_MSP_THREAD_|MSP_THREAD_|OLLAMA_)/.test(value))).toBe(false)
  admissionObserved = true
  const native = await up('genesis-worker')
  expect(native.Config.Env.some(value => /^(?:DATABASE_URL=|POSTGRES_|ZURI_SESSION_SECRET=|ZURI_SECRET_KEK=|ZURI_LINE_|ZURI_MSP_THREAD_|MSP_THREAD_|OLLAMA_)/.test(value))).toBe(false)
  snapshots.initialReadiness = await ready()
  snapshots.initial = await currentCohort()
  expect(snapshots.initial).toMatchObject({ status: 'COHORT_PRESENT_NOT_QUALIFIED', missing: [], readonlyModelMatchesPackage: true })
  expect(snapshots.initial.nativeNetworkMode).toBe(`container:${snapshots.initial.webId}`)
  await exec('genesis-worker', `import fs from 'node:fs';for(const p of ['/var/lib/zuri-ki17/genesis/compact-idle-marker','/var/lib/zuri-ki17/state/compact-idle-marker'])fs.writeFileSync(p,${JSON.stringify(marker)},{flag:'wx'});if(!fs.existsSync('/var/lib/zuri-ki17/genesis/genesisrag17/lexical.sqlite'))throw Error('NATIVE_STORE_UNAVAILABLE')`)
  completed.add('startup')
})

it('refuses a missing native query token without opening the shared native store', async () => {
  const metadata = JSON.parse(await docker(['image', 'inspect', images.genesisWorker]))[0]
  expect(Object.keys(metadata.Config.Volumes || {})).toHaveLength(0)
  const file = path.join(f.root, 'private missing query token.env')
  await writeFile(file, config.knowledge.split('\n').filter(line => !line.startsWith('GENESIS_WORKER_QUERY_TOKEN=')).join('\n'), { flag: 'wx', mode: 0o600 })
  const probeName = `${f.target.project}-missing-token-${randomUUID()}`
  if (await resource('container', probeName)) throw new Error('COMPACT_COHORT_EXISTING_PROBE_REFUSED')
  probes.add(probeName); uncertainProbes.add(probeName)
  const id = await docker(['container', 'create', '--pull', 'never', '--name', probeName, ...Object.entries(compactOwnerLabels(f.target)).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
    '--network', 'none', '--read-only', '--user', 'node', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--log-driver', 'none', '--env-file', file, images.genesisWorker])
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('COMPACT_COHORT_PROBE_CREATE_UNVERIFIED')
  uncertainProbes.delete(probeName)
  try {
    const c = await resource('container', id)
    assertCompactKnowledgeNegativeProbe({ container: c, probeName, target: f.target, manifest: f.manifest, expectedImageId: snapshots.artifact.images.genesisWorker.id })
    expect(c.Image).toBe(metadata.Id); expect(c.Mounts.filter(m => m.Type === 'volume')).toHaveLength(0)
    expect(c.Config.Env.some(value => value.startsWith('GENESIS_WORKER_QUERY_TOKEN='))).toBe(false)
    const result = await docker(['container', 'start', '--attach', id], true), stopped = await resource('container', id)
    expect(stopped.State.ExitCode).toBe(1); expect(stopped.State.OOMKilled).toBe(false)
    expect(result.stderr.includes('GENESIS_WORKER_QUERY_TOKEN_REQUIRED')).toBe(true)
    completed.add('missing-token')
  } finally { await removeProbe(probeName) }
})

it('manually recreates the idle cohort and retains native/shared stores on the current web namespace', async () => {
  const before = await currentCohort(); expect(before.status).toBe('COHORT_PRESENT_NOT_QUALIFIED')
  const native = await owned('genesis-worker')
  await docker(['container', 'stop', native.Id])
  const stopped = await owned('genesis-worker'); expect(stopped.State.ExitCode).toBe(0); expect(stopped.State.OOMKilled).toBe(false); completed.add('idle-stop')
  snapshots.idleStop = { nativeId: native.Id, exitCode: stopped.State.ExitCode, oomKilled: stopped.State.OOMKilled }
  await up('web', true)
  snapshots.stale = await currentCohort()
  expect(snapshots.stale.webId).not.toBe(before.webId); expect(snapshots.stale.missing).toContain('STALE_WORKER_NAMESPACE'); completed.add('stale-namespace')
  await up('genesis-worker', true)
  snapshots.reboundReadiness = await ready()
  snapshots.rebound = await currentCohort()
  expect(snapshots.rebound).toMatchObject({ status: 'COHORT_PRESENT_NOT_QUALIFIED', missing: [], readonlyModelMatchesPackage: true, images: { web: images.web, genesisWorker: images.genesisWorker } })
  expect(snapshots.rebound.nativeNetworkMode).toBe(`container:${snapshots.rebound.webId}`); expect(snapshots.rebound.nativeId).not.toBe(before.nativeId); completed.add('rebind')
  expect(await exec('genesis-worker', `import fs from 'node:fs';for(const p of ['/var/lib/zuri-ki17/genesis/compact-idle-marker','/var/lib/zuri-ki17/state/compact-idle-marker'])if(fs.readFileSync(p,'utf8')!==${JSON.stringify(marker)})throw Error('RETAINED_STATE_MISMATCH');process.stdout.write('RETAINED')`)).toBe('RETAINED')
  expect(snapshots.rebound.volumes).toEqual(before.volumes); completed.add('retained-state')
  for (const table of ['Tenant', 'Business', 'Membership', 'IntegrationCredential', 'KnowledgeIngestion']) expect((await f.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n).toBe(0)
  completed.add('no-application-authority')
})

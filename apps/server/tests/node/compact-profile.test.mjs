// @spec ADR-115 — profile prerequisites never confer qualification or authority.
import test from 'node:test'
import assert from 'node:assert/strict'
import { manifest, implementation } from './compact-fixtures.mjs'
import { targetFixture } from './compact-task2-fixtures.mjs'

const api = () => implementation('../../scripts/lib/compact/profiles.mjs')
function selected() {
  const m = manifest()
  m.profiles.push('knowledge'); m.capabilities.knowledge = 'NOT_QUALIFIED'
  m.images.genesisWorker = m.images.web
  m.componentPins = { msp: 'd0d48c1a8e833478525d9a6ce5ee16af2c85444d', gks: 'ecf1e4de269e949406a6a5f791f9ff8fe30c9578', genesisblock: '5156f412da73905a23d74775a82cc14d1f6d04d0' }
  m.files['pins/ki17.json'] = 'd'.repeat(64)
  return m
}
test('selected Knowledge rejects an absent model instead of accepting pinned metadata alone', async () => {
  const a = await api()
  assert.throws(() => a.assertCompactKnowledgeProfile(selected()), { code: 'COMPACT_KNOWLEDGE_PROFILE_INVALID' })
})
test('current KI17 contract requires the complete immutable E5 model file set', async () => {
  const a = await api(), m = selected()
  m.modelArtifacts = [{ id: 'e5-small', repository: a.COMPACT_KI17_MODEL.repository, revision: a.COMPACT_KI17_MODEL.revision, files: Object.fromEntries(Object.entries(a.COMPACT_KI17_MODEL.files).map(([p, v]) => [`models/e5-small/${p}`, v.sha256])) }]
  Object.assign(m.files, m.modelArtifacts[0].files)
  assert.doesNotThrow(() => a.assertCompactKnowledgeProfile(m))
  for (const mutate of [
    v => { delete v.modelArtifacts[0].files['models/e5-small/tokenizer.json'] },
    v => { v.modelArtifacts[0].revision = 'f'.repeat(40) },
    v => { v.modelArtifacts[0].files['models/e5-small/config.json'] = 'e'.repeat(64) },
    v => { v.componentPins.msp = 'a'.repeat(40) },
    v => { v.modelArtifacts[0].files['models/e5-small/unreviewed.bin'] = 'e'.repeat(64) },
  ]) assert.throws(() => a.assertCompactKnowledgeProfile(mutateClone(m, mutate)), { code: 'COMPACT_KNOWLEDGE_PROFILE_INVALID' })
})
function mutateClone(value, mutate) { const copy = structuredClone(value); mutate(copy); return copy }
test('disabled profiles stay unselected even with all private secrets present', async () => {
  const a = await api(), result = a.inspectCompactProfilePrerequisites({ manifest: manifest(), databaseInstalled: true, configuration: { ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: 'a'.repeat(64), ZURI_LINE_WORKER_TOKEN: 'private'.repeat(12), ZURI_KNOWLEDGE_ENABLED: '1' } })
  assert.equal(result.line.status, 'NOT_SELECTED'); assert.equal(result.knowledge.status, 'NOT_SELECTED')
  assert.equal(JSON.stringify(result).includes('private'), false)
})
test('LINE prerequisites distinguish installation, key and token without asserting live delivery', async () => {
  const a = await api(), m = manifest()
  m.profiles.push('line'); m.capabilities.line = 'NOT_QUALIFIED'; m.images.lineWorker = m.images.web
  const configuration = { ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: '1234567890abcdef'.repeat(4), ZURI_LINE_WORKER_TOKEN: 'secret-token'.repeat(5) }
  const unavailable = a.inspectCompactProfilePrerequisites({ manifest: m, databaseInstalled: false, configuration: {} })
  assert.deepEqual(unavailable.line.missing, ['DATABASE_INSTALLATION', 'ENVELOPE_KEY', 'LINE_WORKER_TOKEN'])
  const result = a.inspectCompactProfilePrerequisites({ manifest: m, databaseInstalled: true, configuration })
  assert.equal(result.line.status, 'NOT_QUALIFIED')
  assert.equal(result.line.prerequisites, 'CONFIGURATION_PRESENT')
  assert.deepEqual(result.line.remainingGates, ['BOOTSTRAP_AND_CURRENT_AUTHORITY', 'WORKER_COHORT', 'RESTART_REPLAY', 'LIVE_LINE_UAT'])
  assert.equal(JSON.stringify(result).includes(configuration.ZURI_SECRET_KEK), false)
  assert.equal(JSON.stringify(result).includes(configuration.ZURI_LINE_WORKER_TOKEN), false)
})
test('Knowledge configuration never substitutes for model, current authority or native-state recovery', async () => {
  const a = await api(), m = selected()
  const result = a.inspectCompactProfilePrerequisites({ manifest: m, databaseInstalled: true, configuration: { ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: 'a'.repeat(64), ZURI_KNOWLEDGE_ENABLED: '1', ZURI_KNOWLEDGE_STORAGE_ENABLED: '1' } })
  assert.equal(result.knowledge.status, 'NOT_QUALIFIED')
  assert(result.knowledge.missing.includes('PINNED_MODEL_CONTRACT'))
  assert(result.knowledge.remainingGates.includes('EXACT_IMAGE_KI17'))
  assert(result.knowledge.remainingGates.includes('NATIVE_STAGE9_RECOVERY'))
})
test('prerequisite reports bind public release identities without hashing or returning secrets', async () => {
  const a = await api(), m = manifest(), inspect = configuration => a.inspectCompactProfilePrerequisites({ manifest: m, databaseInstalled: true, configuration })
  const result = inspect({ ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: 'a'.repeat(64) })
  assert.deepEqual(result.binding, { sourceRevision: m.sourceRevision, images: m.images, componentPins: m.componentPins, models: m.modelArtifacts })
  assert.deepEqual(inspect({ ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: 'b'.repeat(64) }), result)
})
test('Compose marks the selected dependent workers and state volumes with TEST ownership', async () => {
  const m = manifest(); m.profiles.push('line', 'knowledge'); m.capabilities.line = m.capabilities.knowledge = 'NOT_QUALIFIED'
  m.images.lineWorker = m.images.web; m.images.genesisWorker = m.images.web
  m.componentPins = selected().componentPins; m.modelArtifacts = [{ id: 'model', repository: 'test/model', revision: 'd'.repeat(40), files: { 'models/model/test.bin': 'b'.repeat(64) } }]
  m.files['pins/ki17.json'] = m.files['models/model/test.bin'] = 'b'.repeat(64)
  const { renderCompactRuntimeFiles } = await implementation('../../scripts/compact-package.mjs'), { parse } = await import('yaml')
  const compose = parse((await renderCompactRuntimeFiles(m))['compose.yml'])
  for (const name of ['line-worker', 'genesis-worker']) assert.equal(compose.services[name].labels?.['com.zuri-ai.compact.environment'], 'TEST')
  for (const name of ['genesis', 'knowledge-state']) assert.equal(compose.volumes[name].labels?.['com.zuri-ai.compact.environment'], 'TEST')
  assert.equal(compose.services['genesis-worker'].environment?.GENESIS_WORKER_MODEL_DIR, '/opt/ki17/model')
})
function cohortFixture() {
  const m = selected(), t = targetFixture(), labels = { 'com.zuri-ai.compact.target': t.targetId, 'com.zuri-ai.compact.project': t.project, 'com.zuri-ai.compact.environment': 'TEST' }
  const web = { id: '1'.repeat(64), service: 'web', labels, reference: m.images.web, running: true, safeConfiguration: true, network: t.network, mounts: [] }
  const worker = { id: '2'.repeat(64), service: 'genesis-worker', labels, reference: m.images.genesisWorker, running: true, safeConfiguration: true, networkMode: `container:${web.id}`, mounts: [{ type: 'volume', name: `${t.project}-genesis`, destination: '/var/lib/zuri-ki17/genesis', readOnly: false }, { type: 'volume', name: `${t.project}-knowledge-state`, destination: '/var/lib/zuri-ki17/state', readOnly: false }, { type: 'bind', source: '/release/models/e5', destination: '/opt/ki17/model', readOnly: true }] }
  web.mounts.push({ type: 'volume', name: `${t.project}-knowledge-state`, destination: '/var/lib/zuri-ki17/state', readOnly: false })
  return { manifest: m, target: t, modelDirectory: '/release/models/e5', containers: [web, worker], volumes: ['genesis', 'knowledge-state'].map(k => ({ name: `${t.project}-${k}`, driver: 'local', labels })) }
}
test('cohort inspection detects a stale namespace after web recreation without granting qualification', async () => {
  const a = await api(), f = cohortFixture()
  assert.deepEqual(a.inspectCompactCohort(f), { status: 'COHORT_PRESENT_NOT_QUALIFIED', missing: [] })
  f.containers[0].id = '3'.repeat(64)
  assert(a.inspectCompactCohort(f).missing.includes('STALE_WORKER_NAMESPACE'))
})
test('Docker Desktop bind source translation preserves the exact Windows release directory', async () => {
  const a = await api(), f = cohortFixture()
  f.modelDirectory = 'C:\\Users\\fixture\\release models\\e5'
  f.containers[1].mounts[2].source = '/run/desktop/mnt/host/c/Users/fixture/release models/e5'
  assert.equal(a.inspectCompactCohort(f).status, 'COHORT_PRESENT_NOT_QUALIFIED')
  f.containers[1].mounts[2].source += '-foreign'
  assert(a.inspectCompactCohort(f).missing.includes('PINNED_MODEL_MOUNT_UNAVAILABLE'))
})
for (const [name, mutate, expected] of [
  ['unowned worker', f => { f.containers[1].labels = {} }, 'COHORT_OWNER_MISMATCH'],
  ['duplicate worker', f => { f.containers.push(structuredClone(f.containers[1])) }, 'WORKER_COHORT_UNAVAILABLE'],
  ['lost native state', f => { f.volumes.pop() }, 'KNOWLEDGE_STATE_UNAVAILABLE'],
  ['foreign native state', f => { f.volumes[0].labels = {} }, 'KNOWLEDGE_STATE_UNAVAILABLE'],
  ['read-write model', f => { f.containers[1].mounts[2].readOnly = false }, 'PINNED_MODEL_MOUNT_UNAVAILABLE'],
  ['wrong model root', f => { f.containers[1].mounts[2].source = '/foreign-models' }, 'PINNED_MODEL_MOUNT_UNAVAILABLE'],
  ['web lost shared credential state', f => { f.containers[0].mounts = [] }, 'KNOWLEDGE_STATE_MOUNT_UNAVAILABLE'],
]) test(`cohort refuses ${name} without mutation or live send`, async () => {
  const a = await api(), f = cohortFixture(); mutate(f); const before = structuredClone(f)
  assert(a.inspectCompactCohort(f).missing.includes(expected)); assert.deepEqual(f, before)
})

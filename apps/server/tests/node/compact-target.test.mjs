// @spec ADR-115 — pure fresh-target decisions; observed facts never authorize foreign data changes.
// @tested tests/node/compact-target.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { manifest, implementation } from './compact-fixtures.mjs'
import { targetFixture, emptyObservation, ownedObservation } from './compact-task2-fixtures.mjs'
const api = () => implementation('../../scripts/lib/compact/target.mjs')
for (const [field, value] of [['project', { toString: 'DO_NOT_ECHO' }], ['dockerContext', ['desktop-linux']], ['targetId', ['11111111-1111-4111-8111-111111111111']]]) test(`rejects non-string ${field} with a safe typed error`, async () => {
  const { validateCompactTarget } = await api(), t = targetFixture(); t[field] = value
  assert.throws(() => validateCompactTarget(t), e => e.code === 'COMPACT_TARGET_INVALID' && !String(e).includes('DO_NOT_ECHO'))
})
test('a fresh absent target yields an immutable redacted plan without AI prerequisites', async () => {
  const { planCompactInstall } = await api(), t = targetFixture(), m = manifest()
  const p = planCompactInstall({ manifest: m, target: t, observed: emptyObservation(m, t) })
  assert.equal(p.action, 'CREATE_AND_INITIALIZE'); assert.equal(p.environment, 'TEST'); assert.equal(p.project, t.project)
  assert.equal(Object.isFrozen(p), true); assert.equal(JSON.stringify(p).includes(t.secretFiles.bootstrapEnvironment), false)
  assert.match(p.observationSha256, /^[a-f0-9]{64}$/)
  assert.equal(planCompactInstall({ manifest: m, target: t, observed: ownedObservation(m, t) }).action, 'INITIALIZE')
})
for (const [name, mutate] of Object.entries({
  'remote host': t => { t.database.host = 'db.example.org' },
  'existing main-dev namespace': t => { t.project = 'zuri-main-dev-20261020' },
  'UAT environment': t => { t.environment = 'UAT' },
  'production environment': t => { t.environment = 'PRODUCTION' },
  'privileged runtime role': t => { t.database.runtimeRole = 'postgres' },
  'shared bootstrap/runtime secret': t => { t.secretFiles.runtimeEnvironment = t.secretFiles.bootstrapEnvironment },
  'volume alias': t => { t.volumes.database = 'zuri-main-dev-20261020_db-data' },
  'public subnet': t => { t.networkSubnet = '8.8.8.0/24' },
  'non-network CIDR': t => { t.networkSubnet = '10.252.16.3/28' },
  'unknown credential field': t => { t.password = 'DO_NOT_ECHO' },
  'relative private path': t => { t.secretFiles.runtimeEnvironment = 'runtime.env' },
})) test(`refuses target ${name} without reflecting private inputs`, async () => {
  const { planCompactInstall } = await api(), t = targetFixture(), m = manifest(); mutate(t)
  assert.throws(() => planCompactInstall({ manifest: m, target: t, observed: emptyObservation(m, t) }), e => e.code === 'COMPACT_TARGET_INVALID' && !e.message.includes('DO_NOT_ECHO'))
})
for (const [name, mutate] of Object.entries({
  'remote Docker daemon': o => { o.daemon.endpoint = 'tcp://remote:2376' },
  'missing selected image': o => { delete o.images.web },
  'wrong image identity': o => { o.images.postgres.reference = 'postgres:latest' },
  'populated database': o => { o.database.objectCount = 1 },
  'foreign volume': o => { o.volumes.database.labels = {} },
  'unproven existing volume': o => { o.container = null; o.database = null },
  'foreign network': o => { o.network.labels = {} },
  'foreign container': o => { o.container.labels = {} },
  'bind-mounted data': o => { o.container.mounts[0].type = 'bind' },
  'public database port': o => { o.container.host = '0.0.0.0' },
  'unexpected runtime role': o => { o.database.runtimeRoles = ['zuri_web_login'] },
  'wrong database': o => { o.database.name = 'main_dev' },
  'unknown observation': o => { o.secret = 'DO_NOT_ECHO' },
})) test(`refuses ${name} observations`, async () => {
  const { planCompactInstall } = await api(), t = targetFixture(), m = manifest(), observed = ownedObservation(m, t); mutate(observed)
  assert.throws(() => planCompactInstall({ manifest: m, target: t, observed }), e => e.code.startsWith('COMPACT_') && !e.message.includes('DO_NOT_ECHO'))
})

// @spec ADR-115 — reject target/observation/package changes before mutation; safe CLI errors.
// @tested tests/node/compact-executor.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rename, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { manifest, implementation } from './compact-fixtures.mjs'
import { targetFixture, ownedObservation, executorFixture } from './compact-task2-fixtures.mjs'
const api = () => implementation('../../scripts/lib/compact/executor.mjs')
const setup = async () => executorFixture(await implementation('../../scripts/compact-package.mjs'), await implementation('../../scripts/lib/compact/baseline.mjs'))

test('changed observation refuses installation without DDL, stop or resource removal', async () => {
  const { executeCompactInstall } = await api(), { planCompactInstall } = await implementation('../../scripts/lib/compact/target.mjs')
  const { m, t, packageDirectory } = await setup(), observed = ownedObservation(m, t), plan = planCompactInstall({ manifest: m, target: t, observed })
  let writes = 0
  const driver = { inspect: async () => ({ ...observed, database: { ...observed.database, oid: 99 } }), create: async () => { writes++ }, apply: async () => { writes++ }, stop: async () => { writes++ } }
  await assert.rejects(executeCompactInstall({ packageDirectory, target: t, plan, driver }), { code: 'COMPACT_OBSERVATION_CHANGED' })
  assert.equal(writes, 0)
})

test('foreign target refusal precedes all executor side effects', async () => {
  const { executeCompactInstall } = await api(), { m, t, packageDirectory } = await setup(), observed = ownedObservation(m, t)
  observed.volumes.database.labels = {}; let writes = 0
  const driver = { inspect: async () => observed, create: async () => { writes++ }, apply: async () => { writes++ }, stop: async () => { writes++ } }
  await assert.rejects(executeCompactInstall({ packageDirectory, target: t, driver }), e => e.code.startsWith('COMPACT_'))
  assert.equal(writes, 0)
})

test('package inspection rejects missing/changed baseline before any Docker access', async () => {
  const { loadCompactPackage } = await api(), root = await mkdtemp(path.join(os.tmpdir(), 'compact-loader-'))
  await writeFile(path.join(root, 'release-manifest.json'), JSON.stringify(manifest()))
  await assert.rejects(loadCompactPackage(root), e => e.code.startsWith('COMPACT_'))
  await assert.rejects(access(path.join(root, 'created-by-installer')))
})

test('private database files are distinct, validated and never reflected in a parse failure', async () => {
  const { readCompactCredentials } = await api(), root = await mkdtemp(path.join(os.tmpdir(), 'compact secrets ; $() ')), t = targetFixture()
  t.secretFiles = { bootstrapEnvironment: path.join(root, 'bootstrap.env'), runtimeEnvironment: path.join(root, 'runtime.env') }
  await writeFile(t.secretFiles.bootstrapEnvironment, 'POSTGRES_USER=compact_bootstrap\nPOSTGRES_PASSWORD=DO_NOT_ECHO\nPOSTGRES_DB=compact_test_a1\n')
  await writeFile(t.secretFiles.runtimeEnvironment, 'DATABASE_URL=postgresql://postgres:DO_NOT_ECHO@remote.invalid/other\n')
  await assert.rejects(readCompactCredentials(t), e => e.code.startsWith('COMPACT_') && !String(e).includes('DO_NOT_ECHO') && e.cause === undefined)
})

test('CLI rejects unknown verbs/options before invoking a driver', async () => {
  const { runCompactSelfHost } = await implementation('../../scripts/compact-self-host.mjs')
  let reads = 0; const driver = { inspect: async () => { reads++ } }
  for (const args of [['destroy'], ['install', '--password', 'DO_NOT_ECHO'], ['plan', '--package']]) await assert.rejects(runCompactSelfHost(args, { driver }), e => e.code === 'COMPACT_ARGUMENTS_INVALID' && !String(e).includes('DO_NOT_ECHO'))
  assert.equal(reads, 0)
})

test('read-only status remains available after private credential-file loss', async () => {
  const { runCompactSelfHost } = await implementation('../../scripts/compact-self-host.mjs'), { m, t, packageDirectory, root } = await setup()
  const targetFile = path.join(root, 'target.json'); await writeFile(targetFile, JSON.stringify(t))
  await rename(t.secretFiles.bootstrapEnvironment, path.join(root, 'moved bootstrap.env'))
  await rename(t.secretFiles.runtimeEnvironment, path.join(root, 'moved runtime.env'))
  const result = await runCompactSelfHost(['status', '--package', packageDirectory, '--target', targetFile], { driver: { inspect: async () => ownedObservation(m, t) } })
  assert.equal(result.status, 'NOT_INSTALLED')
})

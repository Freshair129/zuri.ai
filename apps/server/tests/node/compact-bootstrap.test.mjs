// @req FR-107 — private wrapping preserves first-operator authority.
// @spec ADR-115 — TEST-only bootstrap and honest configuration diagnostics.
// @tested tests/node/compact-bootstrap.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { implementation } from './compact-fixtures.mjs'
import { executorFixture, ownedObservation } from './compact-task2-fixtures.mjs'
import { digest, stableJson } from '../../scripts/lib/compact/files.mjs'
import { createCompactDockerDriver } from '../../scripts/lib/compact/docker.mjs'

async function api() {
  const value = await implementation('../../scripts/lib/compact/bootstrap.mjs')
  assert.equal(typeof value.bootstrapCompactOperator, 'function', 'Task3 private bootstrap is missing')
  assert.equal(typeof value.inspectCompactCapabilities, 'function', 'Task3 diagnostics are missing')
  return value
}
async function fixture() {
  const f = await executorFixture(await implementation('../../scripts/compact-package.mjs'), await implementation('../../scripts/lib/compact/baseline.mjs'))
  const observed = ownedObservation(f.m, f.t), db = observed.database
  db.objectCount = 2
  db.runtimeRoles = ['zuri_app_runtime', 'zuri_web_login'].map(name => ({ name, login: name === 'zuri_web_login', inherit: name === 'zuri_web_login', inheritsRuntime: name === 'zuri_web_login', owner: false, bypass: false, createDb: false, superuser: false, createRole: false, replication: false, privilegedMembership: false }))
  db.installation = { targetId: f.t.targetId, manifestSha256: digest(stableJson(f.m)), baselineSha256: f.m.schemaBaseline.sha256, releaseId: f.m.releaseId, sourceRevision: f.m.sourceRevision, systemIdentifier: db.systemIdentifier, databaseOid: db.oid, catalogSha256: db.catalogSha256 }
  const password = randomBytes(12).toString('base64url')
  let mutations = 0
  const driver = { inspect: async () => structuredClone(observed), bootstrap: async () => { mutations++; return { personId: 'person-test', personCode: 'PSN-TEST', displayName: 'Test Operator', grantId: 'grant-test', initialPassword: password } } }
  const args = { packageDirectory: f.packageDirectory, target: f.t, privateOutput: path.join(f.root, 'private operator ; $().json'), operator: { email: 'operator@example.invalid', displayName: 'Test Operator' }, driver }
  return { ...f, observed, password, args, driver, mutations: () => mutations }
}

test('bootstrap writes the one-time password exclusively to the explicit private file', async () => {
  const { bootstrapCompactOperator } = await api(), f = await fixture()
  const result = await bootstrapCompactOperator(f.args)
  const privateResult = JSON.parse(await readFile(f.args.privateOutput, 'utf8'))
  assert.equal(privateResult.initialPassword, f.password)
  assert.equal(privateResult.personId, 'person-test')
  assert.equal(result.status, 'BOOTSTRAPPED')
  assert.equal(JSON.stringify(result).includes(f.password), false)
  assert.equal('initialPassword' in result, false)
  assert.equal(f.mutations(), 1)
})
for (const kind of ['existing', 'inside-package', 'credential-file', 'relative']) test(`private output ${kind} refuses before bootstrap mutation`, async () => {
  const { bootstrapCompactOperator } = await api(), f = await fixture()
  if (kind === 'existing') await writeFile(f.args.privateOutput, 'retained')
  if (kind === 'inside-package') f.args.privateOutput = path.join(f.packageDirectory, 'new private.json')
  if (kind === 'credential-file') f.args.privateOutput = f.t.secretFiles.runtimeEnvironment
  if (kind === 'relative') f.args.privateOutput = 'operator-private.json'
  await assert.rejects(bootstrapCompactOperator(f.args), { code: 'COMPACT_PRIVATE_OUTPUT_INVALID' })
  assert.equal(f.mutations(), 0)
  if (kind === 'existing') assert.equal(await readFile(f.args.privateOutput, 'utf8'), 'retained')
})
test('bootstrap refuses an uninitialized owned database without issuing a grant', async () => {
  const { bootstrapCompactOperator } = await api(), f = await fixture()
  f.observed.database.installation = null; f.observed.database.objectCount = 0; f.observed.database.runtimeRoles = []
  await assert.rejects(bootstrapCompactOperator(f.args), { code: 'COMPACT_INSTALLATION_REQUIRED' })
  assert.equal(f.mutations(), 0)
  await assert.rejects(access(f.args.privateOutput))
})
test('a dot-dot-prefixed child directory is still inside the release, never a private output', async () => {
  const { bootstrapCompactOperator } = await api(), f = await fixture()
  const child = path.join(f.packageDirectory, '..private'); await mkdir(child)
  f.args.privateOutput = path.join(child, 'operator.json')
  await assert.rejects(bootstrapCompactOperator(f.args), { code: 'COMPACT_PRIVATE_OUTPUT_INVALID' })
  assert.equal(f.mutations(), 0)
})
test('bootstrap rechecks the observed target before issuing any grant', async () => {
  const { bootstrapCompactOperator } = await api(), f = await fixture(); let reads = 0
  f.driver.inspect = async () => { const o = structuredClone(f.observed); if (++reads > 1) o.container.id = 'a'.repeat(64); return o }
  await assert.rejects(bootstrapCompactOperator(f.args), { code: 'COMPACT_OBSERVATION_CHANGED' })
  assert.equal(f.mutations(), 0)
})
test('bootstrap refusal exposes a fixed code and never underlying secret material', async () => {
  const { bootstrapCompactOperator } = await api(), f = await fixture()
  f.driver.bootstrap = async () => { throw new Error(f.password) }
  await assert.rejects(bootstrapCompactOperator(f.args), e => e.code === 'COMPACT_BOOTSTRAP_FAILED' && !String(e).includes(f.password))
  assert.equal((await readFile(f.args.privateOutput, 'utf8')).includes(f.password), false)
})
test('bootstrap does not expose grant-only or accept arbitrary operator input', async () => {
  const { bootstrapCompactOperator } = await api(), f = await fixture()
  f.args.operator.grantOnly = true
  await assert.rejects(bootstrapCompactOperator(f.args), { code: 'COMPACT_OPERATOR_INVALID' })
  assert.equal(f.mutations(), 0)
})
test('missing private configuration reports unavailable without inferring readiness', async () => {
  const { inspectCompactCapabilities } = await api(), f = await fixture()
  const result = await inspectCompactCapabilities({ manifest: f.m, target: f.t, observed: f.observed, configuration: {} })
  assert.equal(result.database, 'INSTALLED')
  assert.equal(result.core, 'NOT_QUALIFIED')
  assert.equal(result.secretStore, 'UNAVAILABLE')
  assert.equal(result.storage, 'UNAVAILABLE')
  assert.equal(result.line, 'NOT_SELECTED'); assert.equal(result.knowledge, 'NOT_SELECTED')
})
test('supplied envelope configuration remains unqualified and never appears in diagnostics', async () => {
  const { inspectCompactCapabilities } = await api(), f = await fixture(), key = randomBytes(32).toString('hex')
  const result = await inspectCompactCapabilities({ manifest: f.m, target: f.t, observed: f.observed, configuration: { ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: key, ZURI_SECRET_KEK_VERSION: '1' } })
  assert.equal(result.secretStore, 'CONFIGURED_NOT_QUALIFIED')
  assert.equal(result.core, 'NOT_QUALIFIED')
  assert.equal(JSON.stringify(result).includes(key), false)
})
test('missing or development envelope key never becomes a configured production secret store', async () => {
  const { inspectCompactCapabilities } = await api(), f = await fixture()
  for (const configuration of [{ ZURI_SECRET_STORE: 'envelope' }, { ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: 'a'.repeat(64), ZURI_SECRET_KEK_VERSION: '0' }, { ZURI_SECRET_STORE: 'supabase-vault' }]) {
    const result = await inspectCompactCapabilities({ manifest: f.m, target: f.t, observed: f.observed, configuration })
    assert.equal(result.secretStore, 'UNAVAILABLE')
  }
})
test('native bootstrap transport uses the tools digest, contained stdin/environment and no Docker log', async () => {
  const f = await fixture(), bootstrapPassword = randomBytes(32).toString('hex'), runtimePassword = randomBytes(32).toString('hex')
  let calls = 0
  const driver = createCompactDockerDriver({ run: async (args, options) => {
    calls++
    assert.equal(args.some(arg => arg.includes(bootstrapPassword) || arg.includes(runtimePassword)), false)
    assert.equal(args[0], '--host'); assert.equal(args[1], f.observed.daemon.endpoint)
    assert.equal(args[args.indexOf('--log-driver') + 1], 'none')
    assert.equal(args[args.indexOf('--network') + 1], f.t.network)
    assert(args.includes(f.m.images.tools)); assert(args.includes('--read-only')); assert(args.includes('--rm'))
    const input = JSON.parse(options.input)
    assert.deepEqual(input.operator, f.args.operator)
    assert.equal(options.environment.DATABASE_URL.includes(bootstrapPassword), true)
    assert.equal(options.environment.DATABASE_URL.includes(runtimePassword), false)
    return { status: 0, stdout: JSON.stringify({ personId: 'person-test', personCode: 'PSN-TEST', displayName: 'Test Operator', grantId: 'grant-test', initialPassword: f.password }), stderr: '' }
  } })
  driver.inspect = async () => structuredClone(f.observed)
  assert.equal(typeof driver.bootstrap, 'function', 'native tools bootstrap transport is missing')
  await driver.bootstrap({ manifest: f.m, target: f.t, observed: f.observed, operator: f.args.operator, credentials: { bootstrapPassword, runtimePassword } })
  assert.equal(calls, 1)
})
test('native bootstrap rechecks target observation before launching the tools image', async () => {
  const f = await fixture(); let launched = false
  const driver = createCompactDockerDriver({ run: async () => { launched = true; throw new Error('must not launch') } })
  driver.inspect = async () => ({ ...f.observed, container: { ...f.observed.container, id: 'f'.repeat(64) } })
  assert.equal(typeof driver.bootstrap, 'function', 'native tools bootstrap transport is missing')
  await assert.rejects(driver.bootstrap({ manifest: f.m, target: f.t, observed: f.observed, operator: f.args.operator, credentials: {} }), { code: 'COMPACT_OBSERVATION_CHANGED' })
  assert.equal(launched, false)
})
test('packaged CLI bootstrap writes its password only to the selected private destination', async () => {
  const f = await fixture(), { runCompactSelfHost } = await implementation('../../scripts/compact-self-host.mjs')
  const targetFile = path.join(f.root, 'target.json'), operatorFile = path.join(f.root, 'operator.json')
  await writeFile(targetFile, JSON.stringify(f.t)); await writeFile(operatorFile, JSON.stringify(f.args.operator))
  const result = await runCompactSelfHost(['bootstrap', '--package', f.packageDirectory, '--target', targetFile, '--operator', operatorFile, '--private-output', f.args.privateOutput], { driver: f.driver })
  assert.equal(result.status, 'BOOTSTRAPPED')
  assert.equal(JSON.stringify(result).includes(f.password), false)
  assert.equal(JSON.parse(await readFile(f.args.privateOutput, 'utf8')).initialPassword, f.password)
})
test('CLI diagnostics reads supplied private envelope configuration without returning key material', async () => {
  const f = await fixture(), { runCompactSelfHost } = await implementation('../../scripts/compact-self-host.mjs'), key = randomBytes(32).toString('hex')
  const targetFile = path.join(f.root, 'target.json'), configFile = path.join(f.root, 'app.env')
  await writeFile(targetFile, JSON.stringify(f.t)); await writeFile(configFile, `ZURI_SECRET_STORE=envelope\nZURI_SECRET_KEK=${key}\nZURI_SECRET_KEK_VERSION=1\n`)
  const result = await runCompactSelfHost(['diagnostics', '--package', f.packageDirectory, '--target', targetFile, '--configuration', configFile], { driver: f.driver })
  assert.equal(result.secretStore, 'CONFIGURED_NOT_QUALIFIED'); assert.equal(JSON.stringify(result).includes(key), false)
})
test('Compose selects the existing envelope store without embedding a KEK or bootstrap authority', async () => {
  const f = await fixture(), packager = await implementation('../../scripts/compact-package.mjs'), { parse } = await import('yaml')
  const rendered = await packager.renderCompactRuntimeFiles(f.m), compose = parse(rendered['compose.yml'])
  assert.equal(compose.services.web.environment.ZURI_SECRET_STORE, 'envelope')
  assert.equal(compose.services.web.labels?.['com.zuri-ai.compact.target'], '${COMPACT_TARGET_ID:?Set the owned TEST target ID}')
  assert.equal('ZURI_SECRET_KEK' in compose.services.web.environment, false)
  assert.equal(compose.services.web.env_file.some(item => item.path.includes('DATABASE_ENV_FILE')), false)
})

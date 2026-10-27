// @spec ADR-115 — verified package snapshots and TEST-only fresh execution; no repair/reset path.
// @tested tests/node/compact-executor.test.mjs, tests/postgres/compact-fresh-install.test.js
import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { CompactError, validateCompactManifest } from './manifest.mjs'
import { bytes, digest, hashFile, listFiles, stableJson } from './files.mjs'
import { validateCompactTarget, planCompactInstall, assertCompactResources, exactKeys, assertCompactJson } from './target.mjs'
import { validateCompactBaseline } from './baseline.mjs'
export { createCompactDockerDriver } from './docker.mjs'
const fail = code => { throw new CompactError(code) }
const safe = async (code, operation) => { try { return await operation() } catch (e) { if (e instanceof CompactError) throw e; fail(code) } }
export async function readCompactPrivateFile(filename, limit = 65536) {
  return safe('COMPACT_PRIVATE_FILE_INVALID', async () => {
    const absolute = path.resolve(filename), root = path.parse(absolute).root
    return bytes(root, path.relative(root, absolute).split(path.sep).join('/'), limit)
  })
}
export async function readCompactCredentials(target, { packageDirectory } = {}) {
  return safe('COMPACT_PRIVATE_FILE_INVALID', async () => {
    const t = validateCompactTarget(target), paths = await Promise.all(Object.values(t.secretFiles).map(p => realpath(p)))
    if (paths[0] === paths[1]) fail('COMPACT_PRIVATE_FILE_INVALID')
    if (packageDirectory) for (const filename of paths) { const rel = path.relative(await realpath(packageDirectory), filename); if (!rel || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) fail('COMPACT_PRIVATE_FILE_INVALID') }
    const env = buffer => {
      const values = Object.create(null)
      for (const line of buffer.toString('utf8').split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue
        const m = /^([A-Z_]+)=([^\x00\r\n]*)$/.exec(line)
        if (!m || Object.hasOwn(values, m[1])) fail('COMPACT_PRIVATE_FILE_INVALID')
        values[m[1]] = m[2]
      }
      return values
    }
    const bootstrap = env(await readCompactPrivateFile(t.secretFiles.bootstrapEnvironment)), runtime = env(await readCompactPrivateFile(t.secretFiles.runtimeEnvironment))
    const keys = ['DATABASE_URL', 'DIRECT_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL']
    if (!exactKeys(bootstrap, ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) || bootstrap.POSTGRES_USER !== t.database.bootstrapRole || bootstrap.POSTGRES_DB !== t.database.name || !/^[a-f0-9]{64}$/.test(bootstrap.POSTGRES_PASSWORD) || !exactKeys(runtime, keys) || keys.some(k => runtime[k] !== runtime.DATABASE_URL)) fail('COMPACT_PRIVATE_FILE_INVALID')
    const url = new URL(runtime.DATABASE_URL), password = decodeURIComponent(url.password)
    if (url.protocol !== 'postgresql:' || url.hostname !== 'db' || url.port !== '5432' || url.pathname !== `/${t.database.name}` || url.username !== t.database.runtimeRole || url.search || url.hash || !/^[a-f0-9]{64}$/.test(password) || password === bootstrap.POSTGRES_PASSWORD) fail('COMPACT_PRIVATE_FILE_INVALID')
    return Object.freeze({ bootstrapPassword: bootstrap.POSTGRES_PASSWORD, runtimePassword: password })
  })
}
export async function loadCompactPackage(directory) {
  return safe('COMPACT_PACKAGE_INVALID', async () => {
    if (typeof directory !== 'string') fail('COMPACT_ARGUMENTS_INVALID')
    const root = await realpath(directory)
    const rawManifest = await bytes(root, 'release-manifest.json', 4 * 1024 * 1024), manifest = validateCompactManifest(JSON.parse(rawManifest))
    const transportBytes = await bytes(root, 'transport.json', 4 * 1024 * 1024), transport = JSON.parse(transportBytes)
    if (!exactKeys(transport, ['schemaVersion', 'kind', 'images', 'archives']) || transport.schemaVersion !== 'compact-transport.v1' || !['registry', 'oci'].includes(transport.kind) || stableJson(transport.images) !== stableJson(manifest.images) || !exactKeys(transport.archives, transport.kind === 'oci' ? ['images.oci.tar'] : [])) fail('COMPACT_PACKAGE_INVALID')
    const expected = [...Object.keys(manifest.files), 'release-manifest.json', 'transport.json', ...Object.keys(transport.archives)].sort(), snapshots = new Map([['release-manifest.json', rawManifest], ['transport.json', transportBytes]])
    if (stableJson(await listFiles(root)) !== stableJson([...expected, 'SHA256SUMS'].sort())) fail('COMPACT_PACKAGE_INVALID')
    const sums = (await bytes(root, 'SHA256SUMS', 32 * 1024 * 1024)).toString('utf8').trimEnd().split('\n'), recorded = new Map()
    for (const line of sums) { const m = /^([a-f0-9]{64})  (.+)$/.exec(line); if (!m || recorded.has(m[2]) || !expected.includes(m[2])) fail('COMPACT_PACKAGE_INVALID'); recorded.set(m[2], m[1]) }
    if (recorded.size !== expected.length || !manifest.files['schema/baseline.json']) fail('COMPACT_PACKAGE_INVALID')
    for (const file of [manifest.schemaBaseline.file, 'schema/baseline.json']) snapshots.set(file, await bytes(root, file, 32 * 1024 * 1024))
    for (const file of expected) {
      const actual = snapshots.has(file) ? digest(snapshots.get(file)) : await hashFile(root, file)
      if (actual !== recorded.get(file) || manifest.files[file] && actual !== manifest.files[file] || transport.archives[file] && actual !== transport.archives[file]) fail('COMPACT_PAYLOAD_HASH_MISMATCH')
    }
    const baseline = snapshots.get(manifest.schemaBaseline.file).toString('utf8'), metadata = JSON.parse(snapshots.get('schema/baseline.json'))
    validateCompactBaseline(baseline, metadata, manifest)
    return Object.freeze({ root, manifest, baseline })
  })
}
export async function inspectCompactInstall({ packageDirectory, target, driver, verifyCredentials = false }) {
  const t = validateCompactTarget(target), loaded = await loadCompactPackage(packageDirectory)
  if (verifyCredentials) await readCompactCredentials(t, { packageDirectory: loaded.root })
  const observed = await driver.inspect({ manifest: loaded.manifest, target: t })
  assertCompactResources(t, loaded.manifest, observed)
  return { loaded, target: t, observed }
}
export async function executeCompactInstall({ packageDirectory, target, plan, driver }) {
  return safe('COMPACT_INSTALL_FAILED', async () => {
    const t = validateCompactTarget(target), loaded = await loadCompactPackage(packageDirectory), credentials = await readCompactCredentials(t, { packageDirectory: loaded.root })
    const first = await driver.inspect({ manifest: loaded.manifest, target: t }), computed = planCompactInstall({ manifest: loaded.manifest, target: t, observed: first })
    if (plan !== undefined) { assertCompactJson(plan); if (stableJson(plan) !== stableJson(computed)) fail('COMPACT_OBSERVATION_CHANGED') }
    let observed = await driver.inspect({ manifest: loaded.manifest, target: t })
    if (digest(stableJson(observed)) !== computed.observationSha256) fail('COMPACT_OBSERVATION_CHANGED')
    if (computed.action === 'INSPECT_INSTALLED') return { status: 'INSTALLED', initialized: false, project: t.project, targetId: t.targetId, releaseId: loaded.manifest.releaseId }
    if (computed.action === 'CREATE_AND_INITIALIZE') observed = await driver.create({ manifest: loaded.manifest, target: t, credentials })
    if (planCompactInstall({ manifest: loaded.manifest, target: t, observed }).action !== 'INITIALIZE') fail('COMPACT_DATABASE_NOT_EMPTY')
    await driver.apply({ manifest: loaded.manifest, target: t, observed, baseline: loaded.baseline, credentials })
    const installed = await driver.inspect({ manifest: loaded.manifest, target: t })
    if (planCompactInstall({ manifest: loaded.manifest, target: t, observed: installed }).action !== 'INSPECT_INSTALLED') fail('COMPACT_INSTALL_UNVERIFIED')
    return { status: 'INSTALLED', initialized: true, project: t.project, targetId: t.targetId, releaseId: loaded.manifest.releaseId }
  })
}

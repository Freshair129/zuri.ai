// @spec ADR-115 — only run-created TEST resources; never an ambient database URL.
// @tested tests/postgres/compact-fresh-install.test.js
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, readFile, realpath, lstat, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { prepared, hash, refreshEvidence, saveManifest } from '../node/compact-fixtures.mjs'
import { targetFixture } from '../node/compact-task2-fixtures.mjs'
import { compactIpv4Range, compactOwnerLabels } from '../../scripts/lib/compact/target.mjs'
import { runCompactDocker } from '../../scripts/lib/compact/docker.mjs'
import { loadCompactPackage } from '../../scripts/lib/compact/executor.mjs'
import { CompactError } from '../../scripts/lib/compact/manifest.mjs'
import { stableJson, json } from '../../scripts/lib/compact/files.mjs'

export const COMPACT_TEST_IMAGE = 'postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export function fixtureDocker(context, args) {
  try { return execFileSync('docker', ['--context', context, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch { throw new Error('COMPACT_FIXTURE_DOCKER_FAILED') }
}
const port = () => new Promise((resolve, reject) => { const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })

export async function readCompactFixturePackage({ packageDirectory, sourceRevision, componentImages = {} }) {
  if (packageDirectory === undefined) return null
  const loaded = await loadCompactPackage(packageDirectory)
  if (loaded.manifest.profiles.length !== 1 || loaded.manifest.profiles[0] !== 'core' || sourceRevision && loaded.manifest.sourceRevision !== sourceRevision || Object.keys(componentImages).length && stableJson(componentImages) !== stableJson(loaded.manifest.images)) throw new CompactError('COMPACT_FIXTURE_PACKAGE_MISMATCH')
  return loaded
}
export function assertCompactFixtureOwnership(kind, resource, target) {
  const labels = kind === 'container' ? resource?.Config?.Labels : resource?.Labels
  if (Object.entries(compactOwnerLabels(target)).some(([k, v]) => labels?.[k] !== v)) throw new CompactError('COMPACT_FIXTURE_FOREIGN_RESOURCE')
}
export async function completeCompactFixtureCleanup(actions) {
  let firstError
  for (const action of actions) try { await action() } catch (error) { firstError ||= error }
  if (firstError) throw firstError
}
async function removeCompactFixtureRoot(root) {
  const physical = await realpath(root), temporary = await realpath(os.tmpdir())
  assert.equal((await lstat(root)).isSymbolicLink(), false)
  assert.equal(path.dirname(physical), temporary); assert(path.basename(physical).startsWith('zuri-compact-test ; $() '))
  await rm(physical, { recursive: true })
}
export async function withCompactFixtureRoot(operation) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zuri-compact-test ; $() '))
  try { return await operation(root) }
  catch (error) { try { await removeCompactFixtureRoot(root) } catch { error.cleanupFailed = true }; throw error }
}
export function compactFixtureSetupFailure(error) {
  return { status: 'FAIL', cleanup: error?.cleanupFailed === true ? 'FAIL' : 'PASS', stage: 'FIXTURE_SETUP', failureCode: /^COMPACT_[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'COMPACT_FIXTURE_SETUP_FAILED' }
}
export function compactFixtureDockerContext(env = process.env, platform = process.platform) {
  const context = env.COMPACT_TEST_DOCKER_CONTEXT ?? (platform === 'win32' ? 'desktop-linux' : 'default')
  if (typeof context !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(context)) throw new CompactError('COMPACT_FIXTURE_CONTEXT_INVALID')
  return context
}
export function assertCompactFixtureLocalEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !/^(?:npipe:\/\/\/\/\.\/pipe\/dockerDesktopLinuxEngine|unix:\/\/\/[^\x00\r\n?#]+)$/i.test(endpoint)) throw new CompactError('COMPACT_FIXTURE_REMOTE_REFUSED')
}
export async function inspectCompactFixtureResource(context, kind, name, run = runCompactDocker) {
  if (!['container', 'volume', 'network'].includes(kind)) throw new CompactError('COMPACT_FIXTURE_CLEANUP_UNVERIFIED')
  const result = await run(['--context', context, kind, 'inspect', name])
  if (result.status !== 0) {
    if (/No such (?:container|object|volume|network)|(?:volume|network).+not found/i.test(result.stderr)) return null
    throw new CompactError('COMPACT_FIXTURE_CLEANUP_UNVERIFIED')
  }
  try { const rows = JSON.parse(result.stdout); if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw 0; return rows[0] } catch { throw new CompactError('COMPACT_FIXTURE_CLEANUP_UNVERIFIED') }
}
export async function compactFixture({ packageApi, baselineApi, executorApi, corruptDdl = false, componentImages = {}, sourceRevision, prepareInput, packageDirectory }) {
  // Verify a supplied artifact before even creating private files or inspecting
  // Docker. Its baseline/manifest are consumed directly, never regenerated.
  const loaded = await readCompactFixturePackage({ packageDirectory, sourceRevision, componentImages })
  if (loaded && corruptDdl) throw new CompactError('COMPACT_FIXTURE_PACKAGE_MISMATCH')
  return withCompactFixtureRoot(async root => {
  const target = targetFixture()
  target.targetId = randomUUID(); target.project = `zuri-compact-${target.targetId.slice(0, 13)}`
  target.network = `${target.project}-private`; target.database.container = `${target.project}-db`; target.database.port = await port()
  target.database.name = `compact_${target.targetId.replaceAll('-', '').slice(0, 16)}`
  target.dockerContext = compactFixtureDockerContext()
  // Context inspection reads local CLI metadata; refuse remote endpoints before
  // the first Docker engine inventory query, not merely before installation.
  let endpoint
  try { endpoint = JSON.parse(fixtureDocker(target.dockerContext, ['context', 'inspect', target.dockerContext]))[0]?.Endpoints?.docker?.Host } catch { throw new CompactError('COMPACT_FIXTURE_CONTEXT_INVALID') }
  assertCompactFixtureLocalEndpoint(endpoint)
  const ids = fixtureDocker(target.dockerContext, ['network', 'ls', '--quiet']).split(/\r?\n/).filter(Boolean)
  const allocated = fixtureDocker(target.dockerContext, ['network', 'inspect', '--format', '{{json .IPAM.Config}}', ...ids]).split(/\r?\n/).flatMap(row => JSON.parse(row) || []).map(item => compactIpv4Range(item.Subnet)).filter(Boolean)
  for (const item of Object.values(os.networkInterfaces()).flat()) {
    if (item?.family !== 'IPv4' || !item.cidr) continue
    const [address, prefix] = item.cidr.split('/'), bits = Number(prefix)
    const host = address.split('.').reduce((n, octet) => n * 256 + Number(octet), 0), size = 2 ** (32 - bits)
    // Interface CIDRs contain a host address; include the whole connected subnet.
    const first = Math.floor(host / size) * size
    allocated.push({ first, last: first + size - 1 })
  }
  target.networkSubnet = ''
  for (let octet = 64; octet < 255; octet++) { const cidr = `10.252.${octet}.0/28`, r = compactIpv4Range(cidr); if (!allocated.some(a => r.first <= a.last && a.first <= r.last)) { target.networkSubnet = cidr; break } }
  assert(target.networkSubnet, 'COMPACT_FIXTURE_NETWORK_POOL_UNAVAILABLE')
  target.volumes = { database: `${target.project}-database`, objects: `${target.project}-objects` }
  const bootstrapPassword = randomBytes(32).toString('hex'), runtimePassword = randomBytes(32).toString('hex')
  target.secretFiles = { bootstrapEnvironment: path.join(root, 'private bootstrap.env'), runtimeEnvironment: path.join(root, 'private runtime.env') }
  await writeFile(target.secretFiles.bootstrapEnvironment, `POSTGRES_USER=compact_bootstrap\nPOSTGRES_PASSWORD=${bootstrapPassword}\nPOSTGRES_DB=${target.database.name}\n`, { mode: 0o600 })
  await writeFile(target.secretFiles.runtimeEnvironment, ['DATABASE_URL', 'DIRECT_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL'].map(k => `${k}=postgresql://zuri_web_login:${runtimePassword}@db:5432/${target.database.name}`).join('\n') + '\n', { mode: 0o600 })
  const input = path.join(root, 'input')
  let f, baseline, schemaSourceCommit, release
  if (loaded) {
    f = { m: loaded.manifest }; release = loaded.root; schemaSourceCommit = loaded.manifest.sourceRevision
    baseline = { sql: loaded.baseline, metadata: await json(loaded.root, 'schema/baseline.json') }
  } else {
  f = await prepared(input, packageApi)
  assert.equal(componentImages.postgres ?? COMPACT_TEST_IMAGE, COMPACT_TEST_IMAGE)
  for (const key of Object.keys(f.m.images)) f.m.images[key] = componentImages[key] ?? COMPACT_TEST_IMAGE
  f.m.storageQualification.image = f.m.images.storage
  if (sourceRevision) f.m.sourceRevision = sourceRevision
  await refreshEvidence(input, f.m)
  if (prepareInput) await prepareInput({ input, manifest: f.m })
  const canonicalSchema = await readFile(path.join(SERVER, 'prisma/schema.prisma'), 'utf8')
  const postgresSchema = await readFile(path.join(SERVER, 'prisma/schema.postgres.prisma'), 'utf8')
  schemaSourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SERVER, encoding: 'utf8', windowsHide: true }).trim()
  assert.equal(canonicalSchema.replaceAll('\r\n', '\n').trimEnd(), execFileSync('git', ['show', `${schemaSourceCommit}:apps/server/prisma/schema.prisma`], { cwd: SERVER, encoding: 'utf8', windowsHide: true }).replaceAll('\r\n', '\n').trimEnd())
  let ddl = execFileSync(process.execPath, [path.join(SERVER, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--script'], { cwd: SERVER, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  if (corruptDdl) ddl += '\nCREATE TABLE "MustRollback" (id text); ALTER TABLE "DeliberatelyAbsent" ADD COLUMN x text;\n'
  baseline = baselineApi.buildCompactBaseline({ ddl, canonicalSchema, postgresSchema, sourceRevision: f.m.sourceRevision })
  for (const [file, bytes] of Object.entries({ 'schema/baseline.sql': baseline.sql, 'schema/baseline.json': JSON.stringify(baseline.metadata) })) { await writeFile(path.join(input, file), bytes); f.m.files[file] = hash(bytes) }
  f.m.schemaBaseline.sha256 = f.m.files[f.m.schemaBaseline.file]
  for (const [file, bytes] of Object.entries(await packageApi.renderCompactRuntimeFiles(f.m))) f.m.files[file] = hash(bytes)
  await saveManifest(f)
  release = path.join(root, 'relocated candidate')
  await packageApi.packageCompactRelease({ manifest: f.filename, outputDirectory: release })
  }
  const driver = executorApi.createCompactDockerDriver({ run: async (args, options) => {
    assert.equal(args.some(value => value.includes(bootstrapPassword) || value.includes(runtimePassword)), false, 'private database password entered subprocess argv')
    return runCompactDocker(args, options)
  } })
  const targetFile = path.join(root, 'private target.json'); await writeFile(targetFile, JSON.stringify(target), { mode: 0o600 })
  const clients = [], foreignVolumes = new Set()
  return { root, release, targetFile, target, driver, manifest: f.m, runtimePassword, bootstrapPassword,
    install: plan => executorApi.executeCompactInstall({ packageDirectory: release, target, driver, plan }),
    async recordEvidence(caseName, before, after, checks = {}) {
      if (!process.env.COMPACT_TEST_EVIDENCE_DIRECTORY) return
      assert(/^[a-z0-9-]+$/.test(caseName))
      const view = o => ({ daemonId: o.daemon.id, image: o.images.postgres,
        network: o.network && { id: o.network.id, name: o.network.name, subnet: o.network.subnet },
        volumes: Object.fromEntries(Object.entries(o.volumes).map(([k, v]) => [k, v && { name: v.name, driver: v.driver, created: v.created }])),
        container: o.container && { id: o.container.id, name: o.container.name, imageId: o.container.imageId, running: o.container.running }, database: o.database })
      const output = await realpath(process.env.COMPACT_TEST_EVIDENCE_DIRECTORY)
      await writeFile(path.join(output, `${target.targetId}-${caseName}.json`), JSON.stringify({ schemaVersion: 'compact-test-observation.v1', syntheticPackage: !loaded, caseName, environment: 'TEST', targetId: target.targetId, project: target.project, schemaSourceCommit, baseline: baseline.metadata, before: view(before), after: view(after), checks }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    },
    async query(sql, values = [], runtime = false) {
      // Resource ownership is verified before any host SQL connection is opened.
      const observed = await driver.inspect({ manifest: f.m, target })
      assert.equal(observed.container?.labels['com.zuri-ai.compact.target'], target.targetId)
      const client = new pg.Client({ host: target.database.host, port: target.database.port, database: target.database.name, user: runtime ? target.database.runtimeRole : target.database.bootstrapRole, password: runtime ? runtimePassword : bootstrapPassword, connectionTimeoutMillis: 5000 })
      clients.push(client)
      try { await client.connect(); return await client.query(sql, values) } finally { await client.end(); clients.splice(clients.indexOf(client), 1) }
    },
    async foreignVolume() {
      fixtureDocker(target.dockerContext, ['volume', 'create', '--label', `com.zuri-ai.compact.fixture=${target.targetId}`, target.volumes.database]); foreignVolumes.add(target.volumes.database)
    },
    async close() {
      const inspect = (kind, name) => inspectCompactFixtureResource(target.dockerContext, kind, name)
      await completeCompactFixtureCleanup([
      ...clients.map(c => () => c.end()),
      async () => {
      const c = await inspect('container', target.database.container)
      if (c) { assertCompactFixtureOwnership('container', c, target); assert.equal(c.Name, '/' + target.database.container); assert(/^[a-f0-9]{64}$/.test(c.Id)); fixtureDocker(target.dockerContext, ['container', 'rm', '--force', c.Id]) }
      },
      ...Object.values(target.volumes).map(name => async () => {
        const v = await inspect('volume', name)
        if (v) { assert.equal(v.Name, name); if (foreignVolumes.has(name)) assert.equal(v.Labels['com.zuri-ai.compact.fixture'], target.targetId); else assertCompactFixtureOwnership('volume', v, target); fixtureDocker(target.dockerContext, ['volume', 'rm', name]) }
      }),
      async () => {
      const n = await inspect('network', target.network)
      if (n) { assertCompactFixtureOwnership('network', n, target); assert.equal(n.Name, target.network); assert(/^[a-f0-9]{64}$/.test(n.Id)); fixtureDocker(target.dockerContext, ['network', 'rm', n.Id]) }
      },
      () => removeCompactFixtureRoot(root),
      ])
    },
  }
  })
}

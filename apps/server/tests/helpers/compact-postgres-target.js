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
import { compactIpv4Range } from '../../scripts/lib/compact/target.mjs'
import { runCompactDocker } from '../../scripts/lib/compact/docker.mjs'

export const COMPACT_TEST_IMAGE = 'postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export function fixtureDocker(context, args) {
  try { return execFileSync('docker', ['--context', context, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch { throw new Error('COMPACT_FIXTURE_DOCKER_FAILED') }
}
const port = () => new Promise((resolve, reject) => { const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })

export async function compactFixture({ packageApi, baselineApi, executorApi, corruptDdl = false }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zuri-compact-test ; $() ')), target = targetFixture()
  target.targetId = randomUUID(); target.project = `zuri-compact-${target.targetId.slice(0, 13)}`
  target.network = `${target.project}-private`; target.database.container = `${target.project}-db`; target.database.port = await port()
  target.database.name = `compact_${target.targetId.replaceAll('-', '').slice(0, 16)}`
  target.dockerContext = process.platform === 'win32' ? 'desktop-linux' : 'default'
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
  const input = path.join(root, 'input'), f = await prepared(input, packageApi)
  for (const key of Object.keys(f.m.images)) f.m.images[key] = COMPACT_TEST_IMAGE
  f.m.storageQualification.image = COMPACT_TEST_IMAGE
  await refreshEvidence(input, f.m)
  const canonicalSchema = await readFile(path.join(SERVER, 'prisma/schema.prisma'), 'utf8')
  const postgresSchema = await readFile(path.join(SERVER, 'prisma/schema.postgres.prisma'), 'utf8')
  const schemaSourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SERVER, encoding: 'utf8', windowsHide: true }).trim()
  assert.equal(canonicalSchema.replaceAll('\r\n', '\n').trimEnd(), execFileSync('git', ['show', `${schemaSourceCommit}:apps/server/prisma/schema.prisma`], { cwd: SERVER, encoding: 'utf8', windowsHide: true }).replaceAll('\r\n', '\n').trimEnd())
  let ddl = execFileSync(process.execPath, [path.join(SERVER, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--script'], { cwd: SERVER, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  if (corruptDdl) ddl += '\nCREATE TABLE "MustRollback" (id text); ALTER TABLE "DeliberatelyAbsent" ADD COLUMN x text;\n'
  const baseline = baselineApi.buildCompactBaseline({ ddl, canonicalSchema, postgresSchema, sourceRevision: f.m.sourceRevision })
  for (const [file, bytes] of Object.entries({ 'schema/baseline.sql': baseline.sql, 'schema/baseline.json': JSON.stringify(baseline.metadata) })) { await writeFile(path.join(input, file), bytes); f.m.files[file] = hash(bytes) }
  f.m.schemaBaseline.sha256 = f.m.files[f.m.schemaBaseline.file]
  for (const [file, bytes] of Object.entries(await packageApi.renderCompactRuntimeFiles(f.m))) f.m.files[file] = hash(bytes)
  await saveManifest(f)
  const release = path.join(root, 'relocated candidate'), driver = executorApi.createCompactDockerDriver({ run: async (args, options) => {
    assert.equal(args.some(value => value.includes(bootstrapPassword) || value.includes(runtimePassword)), false, 'private database password entered subprocess argv')
    return runCompactDocker(args, options)
  } })
  await packageApi.packageCompactRelease({ manifest: f.filename, outputDirectory: release })
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
      await writeFile(path.join(output, `${target.targetId}-${caseName}.json`), JSON.stringify({ schemaVersion: 'compact-test-observation.v1', syntheticPackage: true, caseName, environment: 'TEST', targetId: target.targetId, project: target.project, schemaSourceCommit, baseline: baseline.metadata, before: view(before), after: view(after), checks }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
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
      await Promise.all(clients.map(c => c.end()))
      const json = args => { try { return JSON.parse(fixtureDocker(target.dockerContext, args))[0] } catch { return null } }
      const c = json(['container', 'inspect', target.database.container])
      if (c) { assert.equal(c.Config.Labels['com.zuri-ai.compact.target'], target.targetId); fixtureDocker(target.dockerContext, ['container', 'rm', '--force', c.Id]) }
      for (const name of Object.values(target.volumes)) {
        const v = json(['volume', 'inspect', name])
        if (v) { assert.equal(v.Labels[foreignVolumes.has(name) ? 'com.zuri-ai.compact.fixture' : 'com.zuri-ai.compact.target'], target.targetId); fixtureDocker(target.dockerContext, ['volume', 'rm', name]) }
      }
      const n = json(['network', 'inspect', target.network])
      if (n) { assert.equal(n.Labels['com.zuri-ai.compact.target'], target.targetId); fixtureDocker(target.dockerContext, ['network', 'rm', n.Id]) }
      const physical = await realpath(root), temporary = await realpath(os.tmpdir())
      assert.equal((await lstat(root)).isSymbolicLink(), false)
      assert.equal(path.dirname(physical), temporary); assert(path.basename(physical).startsWith('zuri-compact-test ; $() '))
      await rm(physical, { recursive: true })
    },
  }
}

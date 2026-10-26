// @spec ADR-115 — synthetic target observations; never a runtime or production endpoint.
// @tested tests/node/compact-target.test.mjs, tests/node/compact-executor.test.mjs
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { manifest, prepared, hash, saveManifest } from './compact-fixtures.mjs'
export function targetFixture() {
  const project = 'zuri-compact-test-a1'
  return { schemaVersion: 'compact-target.v1', environment: 'TEST', targetId: '11111111-1111-4111-8111-111111111111', project,
    dockerContext: 'desktop-linux', network: `${project}-private`, networkSubnet: '10.252.16.0/28', database: { container: `${project}-db`, host: '127.0.0.1', port: 35432, name: 'compact_test_a1', bootstrapRole: 'compact_bootstrap', runtimeRole: 'zuri_web_login' },
    volumes: { database: `${project}-database`, objects: `${project}-objects` }, secretFiles: { bootstrapEnvironment: path.join(os.tmpdir(), 'compact private ; $() files', 'bootstrap.env'), runtimeEnvironment: path.join(os.tmpdir(), 'compact private ; $() files', 'runtime.env') } }
}
export function emptyObservation(m = manifest(), t = targetFixture()) {
  return { daemon: { id: 'disposable-test-daemon', context: t.dockerContext, endpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine' },
    images: Object.fromEntries(Object.entries(m.images).map(([key, reference]) => [key, { reference, id: `sha256:${'b'.repeat(64)}`, platform: 'linux/amd64' }])), volumes: { database: null, objects: null }, network: null, container: null, database: null }
}
export function ownedObservation(m = manifest(), t = targetFixture()) {
  const o = emptyObservation(m, t), labels = { 'com.zuri-ai.compact.target': t.targetId, 'com.zuri-ai.compact.project': t.project, 'com.zuri-ai.compact.environment': 'TEST' }
  for (const key of Object.keys(t.volumes)) o.volumes[key] = { name: t.volumes[key], driver: 'local', labels, created: '2026-10-27T00:00:00Z' }
  o.network = { id: 'd'.repeat(64), name: t.network, driver: 'bridge', labels, subnet: t.networkSubnet }
  o.container = { id: 'c'.repeat(64), name: t.database.container, reference: m.images.postgres, imageId: o.images.postgres.id, running: true, labels,
    mounts: [{ type: 'volume', name: t.volumes.database, destination: '/var/lib/postgresql/data' }], network: t.network, host: '127.0.0.1', port: t.database.port, created: '2026-10-27T00:00:00Z', safeConfiguration: true }
  o.database = { systemIdentifier: '1234567890123456789', oid: 16384, name: t.database.name, user: t.database.bootstrapRole, objectCount: 0, runtimeRoles: [], installation: null, catalogSha256: 'e'.repeat(64) }
  return o
}
export async function executorFixture(packageApi, baselineApi) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compact executor ; $() ')), t = targetFixture()
  t.secretFiles = { bootstrapEnvironment: path.join(root, 'bootstrap.env'), runtimeEnvironment: path.join(root, 'runtime.env') }
  await writeFile(t.secretFiles.bootstrapEnvironment, `POSTGRES_USER=compact_bootstrap\nPOSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nPOSTGRES_DB=${t.database.name}\n`)
  const runtime = `postgresql://zuri_web_login:${randomBytes(32).toString('hex')}@db:5432/${t.database.name}`
  await writeFile(t.secretFiles.runtimeEnvironment, ['DATABASE_URL', 'DIRECT_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL'].map(k => `${k}=${runtime}`).join('\n') + '\n')
  const f = await prepared(path.join(root, 'input'), packageApi), canonicalSchema = 'model TestOnly {\n id String @id\n}\n'
  const baseline = baselineApi.buildCompactBaseline({ ddl: 'CREATE TABLE "TestOnly" (id text PRIMARY KEY);\n', canonicalSchema, postgresSchema: 'datasource db {\n provider = "postgresql"\n}\n' + canonicalSchema, sourceRevision: f.m.sourceRevision })
  for (const [file, value] of Object.entries({ 'schema/baseline.sql': baseline.sql, 'schema/baseline.json': JSON.stringify(baseline.metadata) })) { await writeFile(path.join(root, 'input', file), value); f.m.files[file] = hash(value) }
  f.m.schemaBaseline.sha256 = f.m.files[f.m.schemaBaseline.file]; await saveManifest(f)
  const packageDirectory = path.join(root, 'release'); await packageApi.packageCompactRelease({ manifest: f.filename, outputDirectory: packageDirectory })
  return { root, packageDirectory, t, m: f.m }
}

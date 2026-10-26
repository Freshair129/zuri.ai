// @req FR-173 — object restore provider qualification stays in an owned,
//   loopback-only MinIO container and a fresh child database of injected TEST PostgreSQL.
// @spec TASK-ZAI-049 §8.1, ADR-057 (no production database is a test target)
// @tested tests/storage/knowledge-object-restore.test.js

import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { parse } from 'pg-connection-string'
import { PrismaClient as PostgresPrismaClient } from '@zuri/prisma-postgres'
import { createS3ObjectStoragePort } from '@/platform/storage/s3-object-storage'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PRISMA_CLI = path.join(SERVER_ROOT, 'node_modules', 'prisma', 'build', 'index.js')
const POSTGRES_SCHEMA = path.join(SERVER_ROOT, 'prisma', 'schema.postgres.prisma')
const MINIO_LOCAL_IMAGE_ID = 'sha256:ca499c729f62921367079f685d29e03e262b2d1be31e0af9fa6f6b564dc8850f'
const MINIO_LABEL = 'zuri.scope=isolated-knowledge-restore-test'
const DATABASE_PREFIX = 'zuri_knowledge_restore_test_'
const BUCKET_PREFIX = 'zuri-restore-test-'
const CONTAINER_PREFIX = 'zuri-restore-test-'
const MINIO_READY_TIMEOUT_MS = 30_000
const MINIO_READY_POLL_MS = 200

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function safeChildEnvironment() {
  // Only inherit variables needed to locate local executables, Docker's local
  // context metadata, and the OS temp/home paths. No ambient cloud, app,
  // database or provider credentials are inherited. The Prisma DDL call below
  // explicitly receives only the injected disposable TEST database URL.
  const allowed = [
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
    'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'COMSPEC',
    'DOCKER_CONFIG', 'HOME', 'XDG_RUNTIME_DIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  ]
  return Object.fromEntries(allowed.filter((key) => typeof process.env[key] === 'string').map((key) => [key, process.env[key]]))
}

function child(command, args, { input, timeout = 15_000, cwd = SERVER_ROOT, env, stage = 'local-tool' } = {}) {
  try {
    return execFileSync(command, args, {
      cwd,
      env: env || safeChildEnvironment(),
      input,
      encoding: 'utf8',
      windowsHide: true,
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    // Child errors may contain command details or provider output. Keep any
    // generated credentials and database authority out of Vitest diagnostics.
    const exitCode = Number.isInteger(error?.status) ? error.status : 'unknown'
    throw new Error(`KNOWLEDGE_RESTORE_TEST_LOCAL_TOOL_FAILED:${stage}:EXIT_${exitCode}`)
  }
}

function docker(args, options = {}) {
  return child('docker.exe', ['--context', 'desktop-linux', ...args], { ...options, stage: options.stage || args[0] || 'command' })
}

function assertLocalDockerContext() {
  const host = docker(['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}', 'desktop-linux'], { stage: 'context-inspect' }).trim()
  const localWindowsPipe = /^npipe:\/\/\/\/\.\/pipe\/dockerDesktopLinuxEngine$/i.test(host)
  const localUnixSocket = process.platform !== 'win32' && /^unix:\/\//i.test(host)
  if (!(localWindowsPipe || localUnixSocket)) throw new Error('KNOWLEDGE_RESTORE_TEST_DOCKER_CONTEXT_NOT_LOCAL')
}

function assertOwnedContainer(containerId, containerName) {
  if (!/^[a-f0-9]{64}$/i.test(containerId)) throw new Error('KNOWLEDGE_RESTORE_TEST_CONTAINER_ID_INVALID')
  const format = '{{.Id}}|{{.Name}}|{{.Config.Image}}|{{.Image}}|{{index .Config.Labels "zuri.scope"}}'
  const [id, name, configuredImage, imageId, label] = docker(['inspect', '--format', format, containerId], { stage: 'container-inspect' }).trim().split('|')
  if (id !== containerId || name !== `/${containerName}` || configuredImage !== MINIO_LOCAL_IMAGE_ID
    || imageId !== MINIO_LOCAL_IMAGE_ID || label !== 'isolated-knowledge-restore-test') {
    throw new Error('KNOWLEDGE_RESTORE_TEST_CONTAINER_OWNERSHIP_MISMATCH')
  }
}

function assertOwnedVolume(volumeName, runId) {
  if (volumeName !== `${CONTAINER_PREFIX}${runId}-data`) throw new Error('KNOWLEDGE_RESTORE_TEST_VOLUME_NAME_INVALID')
  const fields = docker(['volume', 'inspect', '--format', '{{.Name}}|{{.Driver}}|{{index .Labels "zuri.scope"}}|{{index .Labels "zuri.restore.run"}}', volumeName]).trim().split('|')
  if (fields[0] !== volumeName || fields[1] !== 'local' || fields[2] !== 'isolated-knowledge-restore-test' || fields[3] !== runId) {
    throw new Error('KNOWLEDGE_RESTORE_TEST_VOLUME_OWNERSHIP_MISMATCH')
  }
}

function createOwnedVolume(volumeName, runId) {
  const names = docker(['volume', 'ls', '--format', '{{.Name}}']).trim().split(/\r?\n/)
  if (names.includes(volumeName)) throw new Error('KNOWLEDGE_RESTORE_TEST_VOLUME_COLLISION')
  const created = docker(['volume', 'create', '--driver', 'local', '--label', MINIO_LABEL,
    '--label', `zuri.restore.run=${runId}`, volumeName]).trim()
  if (created !== volumeName) throw new Error('KNOWLEDGE_RESTORE_TEST_VOLUME_CREATE_MISMATCH')
  assertOwnedVolume(volumeName, runId)
}

function removeOwnedVolume(volumeName, runId) {
  assertOwnedVolume(volumeName, runId)
  docker(['volume', 'rm', volumeName], { stage: 'volume-remove' })
}

async function initializeOwnedVolume(volumeName, runId) {
  assertOwnedVolume(volumeName, runId)
  const initName = `${CONTAINER_PREFIX}${runId}-init`
  const initId = docker(['create', '--pull=never', '--name', initName, '--label', MINIO_LABEL,
    '--user', '0:0', '--mount', `type=volume,source=${volumeName},target=/data`,
    '--entrypoint', '/bin/sh', MINIO_LOCAL_IMAGE_ID,
    '-c', 'chown 1000:1000 /data && chmod 0700 /data'], { stage: 'volume-initializer-create' }).trim()
  try {
    assertOwnedContainer(initId, initName)
    docker(['start', '--attach', initId], { stage: 'volume-initializer-start' })
    const exit = docker(['inspect', '--format', '{{.State.ExitCode}}', initId]).trim()
    if (exit !== '0') throw new Error('KNOWLEDGE_RESTORE_TEST_VOLUME_INITIALIZATION_FAILED')
  } finally { await stopOwnedContainer(initId, initName) }
}

function assertOwnedDataMount(containerId, volumeName) {
  const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', containerId]))
  if (mounts.length !== 1 || mounts[0].Type !== 'volume' || mounts[0].Name !== volumeName
    || mounts[0].Destination !== '/data' || mounts[0].RW !== true) throw new Error('KNOWLEDGE_RESTORE_TEST_DATA_MOUNT_INVALID')
  return { type: 'volume', name: volumeName, destination: '/data', readWrite: true }
}

async function stopOwnedContainer(containerId, containerName) {
  // Never stop by name, label, or a broad selector. Verify the captured ID's
  // name, local image ID and ownership label immediately before stopping it.
  assertOwnedContainer(containerId, containerName)
  const running = docker(['inspect', '--format', '{{.State.Running}}', containerId]).trim()
  if (running === 'true') docker(['stop', '--time', '5', containerId], { timeout: 15_000, stage: 'container-stop' })
  assertOwnedContainer(containerId, containerName)
  docker(['rm', containerId], { stage: 'container-remove' })
}

function startupDiagnostics(containerId, containerName, secrets, health = null) {
  assertOwnedContainer(containerId, containerName)
  const state = docker(['inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}', containerId]).trim()
  const output = spawnSync('docker.exe', ['--context', 'desktop-linux', 'logs', '--tail', '60', containerId], {
    cwd: SERVER_ROOT, env: safeChildEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 5000,
    maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = `${output.stdout || ''}\n${output.stderr || ''}`
  for (const secret of secrets) logs = logs.replaceAll(secret, '[TEST_REDACTED]')
  return { containerId, containerName, imageId: MINIO_LOCAL_IMAGE_ID, state, health,
    logs: logs.replace(/\u001b\[[0-9;]*m/g, '').slice(-6000), logExitCode: output.status }
}

function removeEnvFile(directory, file) {
  let failure = null
  try { unlinkSync(file) } catch (error) { if (error?.code !== 'ENOENT') failure = error }
  try { rmdirSync(directory) } catch (error) { if (error?.code !== 'ENOENT' && !failure) failure = error }
  if (failure) throw new Error('KNOWLEDGE_RESTORE_TEST_SECRET_FILE_CLEANUP_FAILED')
}

function curlS3({ endpoint, method, accessKeyId, secretAccessKey, query = '', body = '' }) {
  const config = [
    'silent',
    'show-error',
    'fail',
    `request = "${method}"`,
    `user = "${accessKeyId}:${secretAccessKey}"`,
    `url = "${endpoint}${query}"`,
    ...(body ? [`header = "Content-Type: application/xml"`, `data-binary = "${body}"`] : []),
    '',
  ].join('\n')
  const args = [
    '--disable',
    '--noproxy', '*',
    '--aws-sigv4', 'aws:amz:us-east-1:s3',
    '--write-out', '\nHTTP_STATUS=%{http_code}',
    '--config', '-',
  ]
  let output
  try {
    output = execFileSync('curl.exe', args, {
      cwd: SERVER_ROOT,
      env: safeChildEnvironment(),
      input: config,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    const captured = Buffer.isBuffer(error?.stdout) ? error.stdout.toString('utf8') : String(error?.stdout || '')
    const httpStatus = /HTTP_STATUS=(\d{3})/.exec(captured)?.[1] || 'unknown'
    const exitCode = Number.isInteger(error?.status) ? error.status : 'unknown'
    throw new Error(`KNOWLEDGE_RESTORE_TEST_CURL_FAILED:HTTP_${httpStatus}:EXIT_${exitCode}`)
  }
  const statusMatch = /\nHTTP_STATUS=(\d{3})\s*$/.exec(output)
  if (!statusMatch) throw new Error('KNOWLEDGE_RESTORE_TEST_CURL_FAILED:HTTP_unknown:EXIT_unknown')
  const status = Number(statusMatch[1])
  if (status < 200 || status >= 300) throw new Error(`KNOWLEDGE_RESTORE_TEST_CURL_FAILED:HTTP_${status}:EXIT_unknown`)
  return output.slice(0, statusMatch.index).trim()
}

async function waitForMinio(endpoint) {
  const deadline = Date.now() + MINIO_READY_TIMEOUT_MS
  const observations = { polls: 0, lastStatus: null, lastError: null }
  while (Date.now() < deadline) {
    observations.polls++
    try {
      const response = await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(750) })
      observations.lastStatus = response.status
      if (response.ok) return observations
    } catch (error) {
      const code = error?.cause?.code || error?.name || 'FETCH_FAILED'
      observations.lastError = /^[A-Za-z0-9_]+$/.test(code) ? code : 'FETCH_FAILED'
    }
    await pause(MINIO_READY_POLL_MS)
  }
  throw Object.assign(new Error('KNOWLEDGE_RESTORE_TEST_MINIO_HEALTH_TIMEOUT'), { healthObservations: observations })
}

function mappedLoopbackPort(containerId) {
  const mapping = docker(['port', containerId, '9000/tcp']).trim()
  const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping)
  const port = Number(match?.[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('KNOWLEDGE_RESTORE_TEST_MINIO_PORT_INVALID')
  return port
}

function createBucket({ endpoint, bucket, accessKeyId, secretAccessKey }) {
  const bucketUrl = `${endpoint}/${bucket}`
  curlS3({ endpoint: bucketUrl, method: 'PUT', accessKeyId, secretAccessKey })
  const versioningXml = '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'
  curlS3({ endpoint: bucketUrl, method: 'PUT', query: '?versioning', body: versioningXml, accessKeyId, secretAccessKey })
  const statusXml = curlS3({ endpoint: bucketUrl, method: 'GET', query: '?versioning', accessKeyId, secretAccessKey })
  if (!/<Status>\s*Enabled\s*<\/Status>/.test(statusXml)) throw new Error('KNOWLEDGE_RESTORE_TEST_BUCKET_VERSIONING_NOT_ENABLED')
}

function storageBinding({ id, revision = 1, endpoint, bucket, accessKeyId, secretAccessKey }) {
  // Observe requests at the transport seam; keep the genuine factory port
  // intact so recovery can validate its non-forgeable configured identity.
  const calls = []
  const observedFetch = (url, init) => {
    const parsed = new URL(url)
    const key = parsed.pathname.split('/').slice(2).map(decodeURIComponent).join('/')
    const versionId = parsed.searchParams.get('versionId')
    const operation = init.method === 'PUT' ? 'PUT' : init.method === 'GET' ? 'READ_EXACT'
      : init.method === 'DELETE' ? 'ERASE_EXACT' : versionId ? 'STAT_EXACT' : 'RECOVER'
    calls.push({ operation, key, ...(versionId ? { versionId } : {}) })
    return fetch(url, init)
  }
  return Object.freeze({
    id,
    revision,
    endpoint,
    bucket,
    port: createS3ObjectStoragePort({ endpoint, accessKeyId, secretAccessKey, bucket, fetchFn: observedFetch }),
    calls,
  })
}

/**
 * Starts a fresh, local MinIO container using the already cached pinned image ID.
 * Only three versioned loopback buckets are made; `close()` verifies ownership
 * by the captured container ID before stopping/removing that one container.
 */
export async function startIsolatedKnowledgeRestoreStorage({ healthProbeOnly = false } = {}) {
  const suffix = randomUUID().toLowerCase()
  const containerName = `${CONTAINER_PREFIX}${suffix}`
  const volumeName = `${CONTAINER_PREFIX}${suffix}-data`
  const tempDirectory = mkdtempSync(path.join(tmpdir(), 'zuri-restore-test-'))
  const envFile = path.join(tempDirectory, 'minio.env')
  const accessKeyId = `zuri${randomBytes(24).toString('base64url')}`
  const secretAccessKey = randomBytes(36).toString('base64url')
  const bucketSuffix = suffix.replaceAll('-', '')
  const buckets = {
    source: `${BUCKET_PREFIX}${bucketSuffix}-source`,
    backup: `${BUCKET_PREFIX}${bucketSuffix}-backup`,
    target: `${BUCKET_PREFIX}${bucketSuffix}-target`,
  }
  let containerId = null
  let secretFileRemoved = false
  let closed = false
  let volumeCreated = false

  try {
    assertLocalDockerContext()
    createOwnedVolume(volumeName, suffix)
    volumeCreated = true
    await initializeOwnedVolume(volumeName, suffix)
    writeFileSync(envFile, `MINIO_ROOT_USER=${accessKeyId}\nMINIO_ROOT_PASSWORD=${secretAccessKey}\n`, { mode: 0o600, flag: 'wx' })
    const runOutput = docker([
      'run', '--pull=never', '--detach',
      '--name', containerName,
      '--label', MINIO_LABEL,
      '--memory=512m', '--cpus=1',
      '--mount', `type=volume,source=${volumeName},target=/data`,
      '--publish', '127.0.0.1::9000',
      '--env-file', envFile,
      MINIO_LOCAL_IMAGE_ID,
      'server', '/data', '--address', ':9000',
    ], { timeout: 30_000, env: safeChildEnvironment(), stage: 'container-run' }).trim()
    containerId = runOutput.split(/\r?\n/)[0]
    if (!/^[a-f0-9]{64}$/i.test(containerId || '')) throw new Error('KNOWLEDGE_RESTORE_TEST_CONTAINER_ID_MISSING')

    // The daemon has the credentials in its container environment now. Remove
    // the short-lived env file before doing health checks or creating buckets.
    removeEnvFile(tempDirectory, envFile)
    secretFileRemoved = true

    assertOwnedContainer(containerId, containerName)
    const dataMount = assertOwnedDataMount(containerId, volumeName)
    const port = mappedLoopbackPort(containerId)
    const endpoint = `http://127.0.0.1:${port}`
    const health = await waitForMinio(endpoint)
    if (healthProbeOnly) return {
      containerId, containerName, volumeName, dataMount, localImageId: MINIO_LOCAL_IMAGE_ID, endpoint, healthReady: true, health,
      async close() { if (!closed) { await stopOwnedContainer(containerId, containerName); removeOwnedVolume(volumeName, suffix); closed = true } },
    }

    for (const bucket of Object.values(buckets)) {
      createBucket({ endpoint, bucket, accessKeyId, secretAccessKey })
    }

    const bindings = Object.fromEntries(Object.entries(buckets).map(([role, bucket]) => [role, storageBinding({
      id: `knowledge-restore-test-${role}-${suffix}`,
      revision: 1,
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
    })]))

    return {
      ...bindings,
      containerId,
      containerName,
      volumeName,
      dataMount,
      localImageId: MINIO_LOCAL_IMAGE_ID,
      endpoint,
      buckets: Object.freeze({ ...buckets }),
      async close() {
        if (closed) return
        await stopOwnedContainer(containerId, containerName)
        removeOwnedVolume(volumeName, suffix)
        closed = true
      },
    }
  } catch (error) {
    if (containerId) {
      try {
        console.info('KNOWLEDGE_RESTORE_TEST_STARTUP_DIAGNOSTICS', JSON.stringify(
          { ...startupDiagnostics(containerId, containerName, [accessKeyId, secretAccessKey], error.healthObservations || null), volumeName },
        ))
      } catch { console.info('KNOWLEDGE_RESTORE_TEST_STARTUP_DIAGNOSTICS_UNAVAILABLE') }
      try { await stopOwnedContainer(containerId, containerName) } catch { /* ownership or daemon uncertainty: leave it untouched */ }
    }
    if (volumeCreated) {
      try { removeOwnedVolume(volumeName, suffix) } catch { console.info('KNOWLEDGE_RESTORE_TEST_VOLUME_CLEANUP_UNVERIFIED', volumeName) }
    }
    throw error
  } finally {
    if (!secretFileRemoved) removeEnvFile(tempDirectory, envFile)
  }
}

function injectedClusterUrl(databaseUrl) {
  let parsedUrl
  let driverParts
  try {
    parsedUrl = new URL(databaseUrl)
    driverParts = parse(databaseUrl)
  } catch {
    throw new Error('KNOWLEDGE_RESTORE_TEST_POSTGRES_URL_INVALID')
  }
  const host = parsedUrl.hostname.replace(/^\[|\]$/g, '')
  const port = parsedUrl.port || '5432'
  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)
    || databaseUrl.includes('?') || databaseUrl.includes('#')
    || host !== '127.0.0.1' || driverParts.host !== host || String(driverParts.port || '5432') !== port
    || parsedUrl.pathname !== '/zuri_server_test' || driverParts.database !== 'zuri_server_test'
    || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('KNOWLEDGE_RESTORE_TEST_REQUIRES_INJECTED_DISPOSABLE_POSTGRES')
  }
  return { baseUrl: parsedUrl.toString() }
}

function childDatabaseUrl(baseUrl, databaseName) {
  const result = new URL(baseUrl)
  result.pathname = `/${databaseName}`
  return result.toString()
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function assertEmptyPublicTables(client) {
  const { rows } = await client.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)
  for (const { table_name: tableName } of rows) {
    const result = await client.query(`SELECT EXISTS (SELECT 1 FROM public.${quoteIdentifier(tableName)} LIMIT 1) AS has_rows`)
    if (result.rows[0]?.has_rows) throw new Error('KNOWLEDGE_RESTORE_TEST_TARGET_DATABASE_NOT_EMPTY')
  }
}

async function dropChildDatabase(admin, databaseName) {
  if (!new RegExp(`^${DATABASE_PREFIX}[0-9a-f]{32}$`).test(databaseName)) {
    throw new Error('KNOWLEDGE_RESTORE_TEST_DATABASE_OWNERSHIP_MISMATCH')
  }
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName])
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`)
}

/**
 * Creates and returns a clean child database on the disposable PostgreSQL
 * cluster provided by the Vitest global setup. It rejects ambient or nonlocal
 * URLs, applies current generated Postgres DDL, verifies every public table is
 * empty, and drops only this run's UUID-named child database on close.
 */
export async function createCleanKnowledgeRestoreDatabase({ testDatabaseUrl } = {}) {
  const { baseUrl } = injectedClusterUrl(testDatabaseUrl)
  const databaseName = `${DATABASE_PREFIX}${randomUUID().replaceAll('-', '').toLowerCase()}`
  const targetUrl = childDatabaseUrl(baseUrl, databaseName)
  const admin = new pg.Client({ connectionString: baseUrl })
  let databaseCreated = false
  let db = null
  let closed = false
  try {
    await admin.connect()
    const existing = await admin.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1', [databaseName])
    if (existing.rowCount !== 0) throw new Error('KNOWLEDGE_RESTORE_TEST_DATABASE_COLLISION')
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)} ENCODING 'UTF8' TEMPLATE template0`)
    databaseCreated = true

    const ddl = child(process.execPath, [
      PRISMA_CLI,
      'migrate', 'diff', '--from-empty', '--to-schema-datamodel', POSTGRES_SCHEMA, '--script',
    ], {
      timeout: 60_000,
      env: { ...safeChildEnvironment(), DATABASE_URL: baseUrl },
    })
    if (!ddl.trim()) throw new Error('KNOWLEDGE_RESTORE_TEST_POSTGRES_DDL_EMPTY')
    const targetAdmin = new pg.Client({ connectionString: targetUrl })
    await targetAdmin.connect()
    try {
      await targetAdmin.query(ddl)
      await assertEmptyPublicTables(targetAdmin)
    } finally {
      await targetAdmin.end()
    }

    db = new PostgresPrismaClient({ datasources: { db: { url: targetUrl } } })
    if (db._engineConfig?.activeProvider !== 'postgresql') throw new Error('KNOWLEDGE_RESTORE_TEST_PRISMA_PROVIDER_MISMATCH')
    await db.$connect()

    return {
      db,
      databaseName,
      async close() {
        if (closed) return
        let cleanupError = null
        try { await db.$disconnect() } catch (error) { cleanupError = error }
        if (databaseCreated) {
          try { await dropChildDatabase(admin, databaseName) } catch (error) { cleanupError ||= error }
        }
        try { await admin.end() } catch (error) { cleanupError ||= error }
        closed = true
        if (cleanupError) throw cleanupError
      },
    }
  } catch (error) {
    try { await db?.$disconnect() } catch { /* preserve the original setup error */ }
    if (databaseCreated) {
      try { await dropChildDatabase(admin, databaseName) } catch { /* no broad cleanup if target ownership cannot be confirmed */ }
    }
    try { await admin.end() } catch { /* setup error remains primary */ }
    throw error
  }
}

// @req FR-107, FR-120 — owned disposable core qualification; no existing identity or data.
// @spec ADR-115 — real package images, PostgreSQL, TEST storage and certificate-pinned HTTPS.
// @tested tests/e2e/compact-core.spec.js
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID, createHash, X509Certificate } from 'node:crypto'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { createServer as tcpServer } from 'node:net'
import { createServer as tlsServer } from 'node:https'
import { request as httpRequest } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createS3ObjectStoragePort } from '../../src/platform/storage/s3-object-storage.js'
import { compactFixture } from './compact-postgres-target.mjs'
import * as packageApi from '../../scripts/compact-package.mjs'
import * as baselineApi from '../../scripts/lib/compact/baseline.mjs'
import * as executorApi from '../../scripts/lib/compact/executor.mjs'
import { compactProcessEnvironment, runCompactDocker } from '../../scripts/lib/compact/docker.mjs'
import { readCompactPrivateFile } from '../../scripts/lib/compact/executor.mjs'
import { digest } from '../../scripts/lib/compact/files.mjs'
import { isPortablePayloadPath } from '../../scripts/lib/compact/manifest.mjs'

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), REPO = path.resolve(SERVER, '../..')
const freePort = () => new Promise((resolve, reject) => { const server = tcpServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) }) })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function bucketRequest(url, method, accessKeyId, secretAccessKey, body = '') {
  // Match the existing isolated storage fixture: secret-bearing curl config is
  // stdin only, with no ambient proxy or ~/.curlrc and no credential argv.
  const config = ['silent', 'show-error', 'fail', `request = "${method}"`, `user = "${accessKeyId}:${secretAccessKey}"`, `url = "${url}"`,
    ...(body ? ['header = "Content-Type: application/xml"', `data-binary = "${body}"`] : []), ''].join('\n')
  try {
    return execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--disable', '--noproxy', '*', '--aws-sigv4', 'aws:amz:us-east-1:s3', '--config', '-'], { input: config, env: compactProcessEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch { throw new Error('COMPACT_CORE_BUCKET_FAILED') }
}
async function canonicalInput({ input, manifest }) {
  const files = execFileSync('git', ['ls-files', '--', 'docs', 'registry/document-registry/index.json'], { cwd: REPO, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
  files.push('docs/.doc-graph.json')
  for (const relative of files.filter(isPortablePayloadPath)) {
    const bytes = await readFile(path.join(REPO, relative))
    await mkdir(path.dirname(path.join(input, relative)), { recursive: true })
    await writeFile(path.join(input, relative), bytes); manifest.files[relative] = digest(bytes)
  }
  // These are TEST-candidate assertions. The actual engine is checked before
  // bootstrap/web below; neither this fixture nor the packager approves a release.
  const review = 'Existing repository MinIO TEST fixture only; no external server license key supplied; no production provider or legal release approval.'
  const license = JSON.stringify({ status: 'PASS', environment: 'TEST', image: manifest.images.storage, licenseRequired: false, reviewSha256: digest(review) })
  await writeFile(path.join(input, 'qualifications/license.json'), license)
  manifest.files['qualifications/license.json'] = digest(license); manifest.storageQualification.licenseEvidence.sha256 = digest(license)
}
async function browserExecutable() {
  if (process.env.ZURI_E2E_BROWSER) return process.env.ZURI_E2E_BROWSER
  if (process.platform !== 'win32') return undefined
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
    for (const relative of ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe']) {
      const filename = path.join(root, relative); try { await access(filename); return filename } catch {}
    }
  }
  return undefined
}
export async function startCompactCoreTarget() {
  assert(process.env.COMPACT_CORE_IMAGE_FILE, 'COMPACT_CORE_IMAGE_FILE must select explicit local immutable TEST images')
  const images = JSON.parse(await readCompactPrivateFile(process.env.COMPACT_CORE_IMAGE_FILE))
  assert.deepEqual(Object.keys(images).sort(), ['postgres', 'storage', 'tools', 'web'])
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', windowsHide: true }).trim()
  const f = await compactFixture({ packageApi, baselineApi, executorApi, componentImages: images, sourceRevision, prepareInput: canonicalInput })
  const owned = new Map(); let proxy
  const run = async (args, options) => {
    const result = await runCompactDocker(['--host', endpoint, ...args], options)
    if (result.status !== 0) throw new Error('COMPACT_CORE_DOCKER_FAILED')
    return result.stdout.trim()
  }
  let endpoint
  const assertOwned = async id => {
    const info = JSON.parse(await run(['container', 'inspect', id]))[0]
    assert(id === info.Id || info.Name === '/' + id); assert.equal(info.Config.Labels['com.zuri-ai.compact.target'], f.target.targetId)
    assert.equal(info.Config.Labels['com.zuri-ai.compact.environment'], 'TEST')
    return info
  }
  const close = async () => {
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)) }
    for (const id of [...owned.keys()].reverse()) {
      const result = await runCompactDocker(['--host', endpoint, 'container', 'inspect', id])
      if (result.status !== 0 && /No such (?:container|object)/i.test(result.stderr)) continue
      assert.equal(result.status, 0, 'COMPACT_CORE_CLEANUP_UNVERIFIED')
      const info = await assertOwned(id); await run(['container', 'rm', '--force', info.Id])
    }
    await f.close()
  }
  try {
    await f.install()
    endpoint = (await f.driver.inspect({ manifest: f.manifest, target: f.target })).daemon.endpoint
    const labels = ['--label', `com.zuri-ai.compact.target=${f.target.targetId}`, '--label', `com.zuri-ai.compact.project=${f.target.project}`, '--label', 'com.zuri-ai.compact.environment=TEST']
    const storagePort = await freePort(), accessKeyId = randomBytes(16).toString('hex'), secretAccessKey = randomBytes(32).toString('hex')
    const storageName = `${f.target.project}-storage-1`; owned.set(storageName, 'storage')
    const storageId = await run(['container', 'create', '--name', storageName, '--pull', 'never', ...labels, '--network', f.target.network, '--network-alias', 'storage', '--log-driver', 'none', '--publish', `127.0.0.1:${storagePort}:9000`, '--mount', `type=volume,source=${f.target.volumes.objects},target=/data`, '--env', 'MINIO_ROOT_USER', '--env', 'MINIO_ROOT_PASSWORD', images.storage, ...f.manifest.storageQualification.command], { environment: { MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey } })
    await assertOwned(storageId); await run(['container', 'start', storageId])
    let storageReady = false
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${storagePort}/minio/health/ready`, { signal: AbortSignal.timeout(1500) })).ok) { storageReady = true; break } } catch {} await pause(200) }
    assert(storageReady, 'COMPACT_CORE_STORAGE_UNAVAILABLE')
    const storageEndpoint = `http://127.0.0.1:${storagePort}`, bucket = `compact-${randomUUID()}`, objectKey = 'exact-test-object', content = Buffer.from(randomUUID())
    bucketRequest(`${storageEndpoint}/${bucket}`, 'PUT', accessKeyId, secretAccessKey)
    bucketRequest(`${storageEndpoint}/${bucket}?versioning`, 'PUT', accessKeyId, secretAccessKey, '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>')
    assert.match(bucketRequest(`${storageEndpoint}/${bucket}?versioning`, 'GET', accessKeyId, secretAccessKey), /<Status>Enabled<\/Status>/)
    const s3 = createS3ObjectStoragePort({ endpoint: storageEndpoint, bucket, accessKeyId, secretAccessKey })
    const stored = await s3.putImmutable({ key: objectKey, content }); assert(stored.versionId)
    await assert.rejects(s3.putImmutable({ key: objectKey, content: Buffer.from('refused overwrite') }), { code: 'KNOWLEDGE_STORAGE_OBJECT_EXISTS' })
    const exact = await s3.readExact({ key: objectKey, versionId: stored.versionId }); assert.deepEqual(exact.bytes, content)
    await s3.eraseExactVersions({ key: objectKey, versionIds: [stored.versionId] })
    await assert.rejects(s3.readExact({ key: objectKey, versionId: stored.versionId }), { code: 'KNOWLEDGE_STORAGE_OBJECT_NOT_FOUND' })
    const providerChecks = { versioning: true, conditionalWrite: true, exactRead: true, exactErase: true }
    const operator = { email: `operator-${f.target.targetId}@example.invalid`, displayName: 'Compact Test Operator' }, operatorFile = path.join(f.root, 'private operator.json'), privateOutput = path.join(f.root, 'private initial login.json')
    await writeFile(operatorFile, JSON.stringify(operator), { flag: 'wx', mode: 0o600 })
    const cli = (verb, extra = []) => {
      try { return JSON.parse(execFileSync(process.execPath, [path.join(f.release, 'compact-self-host.mjs'), verb, '--package', f.release, '--target', f.targetFile, ...extra], { cwd: f.root, env: compactProcessEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] })) }
      catch (error) { const refused = String(error.stderr || '').trim() === 'COMPACT_BOOTSTRAP_REFUSED'; const safe = new Error(refused ? 'COMPACT_BOOTSTRAP_REFUSED' : 'COMPACT_CORE_CLI_FAILED'); safe.code = safe.message; throw safe }
    }
    const bootstrapResult = cli('bootstrap', ['--operator', operatorFile, '--private-output', privateOutput])
    const { initialPassword } = JSON.parse(await readCompactPrivateFile(privateOutput))
    const cert = path.join(f.root, 'test certificate.pem'), key = path.join(f.root, 'test private key.pem'), config = path.join(f.root, 'openssl.cnf')
    await writeFile(config, '[req]\ndistinguished_name=dn\n[dn]\n', { mode: 0o600 })
    const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-config', config], { env: compactProcessEnvironment(), windowsHide: true, timeout: 30000, stdio: 'ignore' })
    const certBytes = await readFile(cert), spkiPin = createHash('sha256').update(new X509Certificate(certBytes).publicKey.export({ type: 'spki', format: 'der' })).digest('base64')
    const webPort = await freePort(), tlsPort = await freePort(), baseURL = `https://127.0.0.1:${tlsPort}`
    proxy = tlsServer({ cert: certBytes, key: await readFile(key) }, (request, response) => {
      if (request.headers.host !== `127.0.0.1:${tlsPort}`) { response.writeHead(421); response.end(); return }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: webPort, path: request.url, method: request.method, headers: { ...request.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': request.headers.host } }, incoming => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response) })
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end() }); request.pipe(upstream)
    })
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(tlsPort, '127.0.0.1', resolve) })
    const appFile = path.join(f.root, 'private app.env'), storageFile = path.join(f.root, 'private storage.env'), selectorsFile = path.join(f.root, 'private selectors.env')
    await writeFile(appFile, `ZURI_SESSION_SECRET=${randomBytes(32).toString('hex')}\nZURI_SECRET_STORE=envelope\nZURI_SECRET_KEK=${randomBytes(32).toString('hex')}\nZURI_SECRET_KEK_VERSION=1\n`, { flag: 'wx', mode: 0o600 })
    await writeFile(storageFile, `MINIO_ROOT_USER=${accessKeyId}\nMINIO_ROOT_PASSWORD=${secretAccessKey}\n`, { flag: 'wx', mode: 0o600 })
    const selectors = { COMPACT_PROJECT_NAME: f.target.project, COMPACT_TARGET_ID: f.target.targetId, COMPACT_WEB_PORT: webPort, COMPACT_PUBLIC_BASE_URL: baseURL, COMPACT_APP_ENV_FILE: appFile, COMPACT_DATABASE_ENV_FILE: f.target.secretFiles.bootstrapEnvironment, COMPACT_DATABASE_RUNTIME_ENV_FILE: f.target.secretFiles.runtimeEnvironment, COMPACT_DATABASE_CONTAINER: f.target.database.container, COMPACT_DATABASE_PORT: f.target.database.port, COMPACT_DATABASE_VOLUME: f.target.volumes.database, COMPACT_OBJECTS_VOLUME: f.target.volumes.objects, COMPACT_PRIVATE_NETWORK: f.target.network, COMPACT_STORAGE_ADMIN_ENV_FILE: storageFile }
    await writeFile(selectorsFile, Object.entries(selectors).map(([name, value]) => `${name}='${String(value).replaceAll('\\', '/')}'`).join('\n') + '\n', { flag: 'wx', mode: 0o600 })
    const composeArgs = ['compose', '--project-name', f.target.project, '--env-file', selectorsFile, '--file', path.join(f.release, 'compose.yml')]
    await run([...composeArgs, 'config', '--quiet'])
    const existing = await runCompactDocker(['--host', endpoint, 'container', 'inspect', `${f.target.project}-web-1`]); assert.notEqual(existing.status, 0, 'COMPACT_CORE_TARGET_EXISTS')
    owned.set(`${f.target.project}-web-1`, 'web')
    await run([...composeArgs, 'up', '--detach', '--no-deps', '--pull', 'never', 'web'], { timeoutMs: 90000 })
    const web = JSON.parse(await run(['container', 'inspect', `${f.target.project}-web-1`]))[0], webId = web.Id
    await assertOwned(webId); assert.equal(web.Config.Image, images.web)
    const ready = async () => { for (let i = 0; i < 150; i++) { try { if ((await fetch(`http://127.0.0.1:${webPort}/api/health`, { signal: AbortSignal.timeout(1500) })).status === 200) return } catch {} await pause(200) } throw new Error('COMPACT_CORE_HEALTH_FAILED') }
    await ready()
    // Real operator/signup sessions drive all browser authorization; no viewer is manufactured.
    return { baseURL, spkiPin, executablePath: await browserExecutable(), operator, initialPassword, bootstrapResult, providerChecks,
      signupEmail: `stranger-${f.target.targetId}@example.invalid`, signupPassword: randomBytes(18).toString('base64url'),
      ownerEmail: `owner-${f.target.targetId}@example.invalid`, ownerPassword: randomBytes(18).toString('base64url'),
      repeatBootstrap: async () => cli('bootstrap', ['--operator', operatorFile, '--private-output', path.join(f.root, 'private refused repeat.json')]),
      authorityCounts: async personId => { const rows = (await f.query('SELECT (SELECT count(*)::int FROM "PlatformGrant" WHERE "personId"=$1) AS grants,(SELECT count(*)::int FROM "Membership" WHERE "personId"=$1) AS memberships', [personId])).rows; return rows[0] },
      operatorCount: async () => (await f.query('SELECT count(*)::int AS n FROM "PlatformGrant" WHERE capability=\'OPERATOR\' AND status=\'ACTIVE\'')).rows[0].n,
      modelTableCount: async () => (await f.query('SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=\'public\'')).rows[0].n,
      restartWeb: async () => { await assertOwned(webId); await run(['container', 'restart', '--time', '15', webId]); await ready() },
      recordEvidence: async checks => { if (process.env.COMPACT_CORE_EVIDENCE_DIRECTORY) { const observed = await f.driver.inspect({ manifest: f.manifest, target: f.target }); await writeFile(path.join(process.env.COMPACT_CORE_EVIDENCE_DIRECTORY, `${f.target.targetId}-core.json`), JSON.stringify({ environment: 'TEST', sourceBase: sourceRevision, targetId: f.target.targetId, project: f.target.project, images, manifestSha256: observed.database.installation.manifestSha256, hostCliSha256: f.manifest.files['compact-self-host.mjs'], baselineSha256: f.manifest.schemaBaseline.sha256, databaseIdentity: { systemIdentifier: observed.database.systemIdentifier, oid: observed.database.oid, catalogSha256: observed.database.catalogSha256 }, webContainerId: webId, providerChecks, checks, limits: ['TEST candidate with a working host-tool patch, not a production release', 'Asset/catalog parity, LINE/Knowledge and complete recovery remain separate'] }, null, 2) + '\n', { flag: 'wx' }) } }, close,
    }
  } catch (error) { await close(); throw error }
}

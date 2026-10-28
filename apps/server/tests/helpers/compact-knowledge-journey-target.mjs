// @spec ADR-115 — owned TEST HTTPS/Business/native journey; no production or live LINE.
// @tested tests/integration/compact-knowledge-journey.test.js
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFile, readFile, realpath, lstat } from 'node:fs/promises'
import { createServer as tcpServer } from 'node:net'
import { createServer as httpsServer } from 'node:https'
import { request as httpRequest } from 'node:http'
import path from 'node:path'
import * as packageApi from '../../scripts/compact-package.mjs'
import * as baselineApi from '../../scripts/lib/compact/baseline.mjs'
import * as executorApi from '../../scripts/lib/compact/executor.mjs'
import { compactProcessEnvironment, runCompactDocker } from '../../scripts/lib/compact/docker.mjs'
import { inspectCompactKnowledgeCandidate, retainCompactQualificationPackage } from '../../scripts/lib/compact/qualify.mjs'
import { inspectCompactCohort } from '../../scripts/lib/compact/profiles.mjs'
import { compactFixture, assertCompactKnowledgeEvidencePath, assertCompactFixtureOwnership, inspectCompactFixtureResource, observeAndCleanCompactFixture } from './compact-postgres-target.mjs'
import { compactKnowledgeCohortConfiguration, assertCompactKnowledgeCohortContainer, assertCompactKnowledgeProjectInventory } from './compact-knowledge-cohort.mjs'
import { bindCompactKnowledgeBusiness, readCompactJourneyCorpus } from './compact-knowledge-journey.mjs'
import { compactJourneyHttpsClient } from './compact-journey-https.mjs'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const port = () => new Promise((resolve, reject) => { const s = tcpServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
export function checkedJourneyResponse(result) {
  if (!result.ok) {
    const candidate = result.body?.code || result.body?.error?.code || result.body?.error
    const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/.test(candidate) ? candidate : 'UNCLASSIFIED'
    throw new Error(`COMPACT_JOURNEY_HTTP_${result.status}_${code}`)
  }
  return result.body
}
export async function createCompactKnowledgeJourney({ packageDirectory, retainedDirectory, expectedRevision, componentImages, evidenceFile, harnessRevision }) {
  await assertCompactKnowledgeEvidencePath({ packageDirectory, retainedDirectory, evidenceFile })
  await retainCompactQualificationPackage({ packageDirectory, destination: retainedDirectory })
  const retainedRoot = await realpath(retainedDirectory)
  const f = await compactFixture({ packageApi, baselineApi, executorApi, knowledgePackageDirectory: retainedRoot, sourceRevision: expectedRevision, componentImages })
  const snapshots = {}, checks = {}, roles = new Set(), uncertain = new Set()
  let artifact, config, proxy, certificate, baseURL, compose, volumeIntent = false, admissionObserved = false
  const resource = (kind, id) => inspectCompactFixtureResource(f.target.dockerContext, kind, id)
  const name = role => `${f.target.project}-${role}-1`
  async function docker(args) {
    const result = await runCompactDocker(['--context', f.target.dockerContext, ...args], { timeoutMs: 60000 })
    if (result.status !== 0) throw new Error('COMPACT_JOURNEY_DOCKER_FAILED')
    return result.stdout.trim()
  }
  const imageKey = role => role === 'web' ? 'web' : 'genesisWorker'
  async function owned(role) {
    const c = await resource('container', name(role))
    assertCompactKnowledgeCohortContainer({ container: c, role, target: f.target, manifest: f.manifest, expectedImageId: artifact.images[imageKey(role)].id })
    return c
  }
  async function up(role, recreate = false) {
    if (!roles.has(role)) { if (await resource('container', name(role))) throw new Error('COMPACT_JOURNEY_EXISTING_ROLE'); roles.add(role) } else await owned(role)
    for (const suffix of ['genesis', 'knowledge-state']) {
      const v = await resource('volume', `${f.target.project}-${suffix}`)
      if (v) { if (!volumeIntent) throw new Error('COMPACT_JOURNEY_EXISTING_VOLUME'); assertCompactFixtureOwnership('volume', v, f.target) }
    }
    volumeIntent = true; uncertain.add(role)
    await docker([...compose, 'up', '--detach', '--no-deps', '--pull', 'never', ...(recreate ? ['--force-recreate'] : []), role])
    const c = await owned(role); uncertain.delete(role); return c
  }
  async function exec(role, program) { const c = await owned(role); return docker(['container', 'exec', c.Id, role === 'web' ? 'node' : '/opt/ki17/node/bin/node', '--input-type=module', '-e', program]) }
  function client(ca = certificate) { return compactJourneyHttpsClient({ baseURL, ca }) }
  async function webReady() {
    const deadline = Date.now() + 30000, anonymous = client()
    while (Date.now() < deadline) {
      try { if ((await anonymous.request('GET', '/api/health')).status === 200) return } catch { /* same fixed startup deadline */ }
      await pause(200)
    }
    throw new Error('COMPACT_JOURNEY_WEB_NOT_READY')
  }
  async function rewritePrivate(file, data) {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || path.dirname(await realpath(file)) !== await realpath(f.root)) throw new Error('COMPACT_JOURNEY_PRIVATE_FILE_REFUSED')
    await writeFile(file, data, { mode: 0o600 })
  }
  async function cohort() {
    const raw = await f.driver.inspectCohort({ manifest: f.manifest, target: f.target, modelDirectory: path.join(retainedRoot, 'models', f.manifest.modelArtifacts[0].id) })
    const view = inspectCompactCohort({ ...raw, manifest: f.manifest, target: f.target }), web = await owned('web'), native = await owned('genesis-worker')
    return { ...view, webId: web.Id, nativeId: native.Id, networkMode: native.HostConfig.NetworkMode,
      imageIds: { web: web.Image, genesisWorker: native.Image }, references: { web: web.Config.Image, genesisWorker: native.Config.Image } }
  }
  const api = {
    checks, snapshots,
    get baseURL() { return baseURL },
    client,
    query: (...args) => f.query(...args),
    async setup() {
      if (f.manifest.storageQualification.licenseRequired) throw new Error('COMPACT_JOURNEY_EXTERNAL_LICENSE_NOT_SELECTED')
      artifact = await inspectCompactKnowledgeCandidate({ packageDirectory: retainedRoot, expectedRevision, target: f.target, driver: f.driver })
      snapshots.artifact = { manifestSha256: artifact.manifestSha256, packageInventorySha256: artifact.packageInventorySha256, images: artifact.images }; checks.package = true
      assert.equal((await f.install()).initialized, true); checks.baseline = true
      const operator = path.join(f.root, 'private operator.json'), output = path.join(f.root, 'private operator output.json')
      await writeFile(operator, JSON.stringify({ email: `operator-${f.target.targetId}@example.invalid`, displayName: 'Compact TEST Operator' }), { flag: 'wx', mode: 0o600 })
      const bootstrap = JSON.parse(execFileSync(process.execPath, [path.join(retainedRoot, 'compact-self-host.mjs'), 'bootstrap', '--package', retainedRoot, '--target', f.targetFile, '--operator', operator, '--private-output', output],
        { cwd: f.root, env: compactProcessEnvironment(), windowsHide: true, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }))
      assert.equal(bootstrap.status, 'BOOTSTRAPPED'); checks.bootstrap = true
      snapshots.bootstrap = { status: bootstrap.status, personId: bootstrap.personId, grantId: bootstrap.grantId }
      const cert = path.join(f.root, 'public certificate.pem'), key = path.join(f.root, 'private TLS key.pem'), opensslConfig = path.join(f.root, 'private openssl.cnf')
      await writeFile(opensslConfig, '[req]\ndistinguished_name=dn\n[dn]\n', { flag: 'wx', mode: 0o600 })
      execFileSync(process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-config', opensslConfig],
        { env: compactProcessEnvironment(), windowsHide: true, timeout: 30000, stdio: 'ignore' })
      certificate = await readFile(cert)
      let tlsPort, webPort
      proxy = httpsServer({ cert: certificate, key: await readFile(key) }, (request, response) => {
        if (request.headers.host !== `127.0.0.1:${tlsPort}`) { response.writeHead(421); response.end(); return }
        const upstream = httpRequest({ hostname: '127.0.0.1', port: webPort, path: request.url, method: request.method,
          headers: { ...request.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': request.headers.host } }, incoming => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response) })
        upstream.on('error', () => { if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' }); response.end('{"error":"UPSTREAM_UNAVAILABLE"}') }); request.pipe(upstream)
      })
      // Keep TLS bound while selecting web's port, so the OS cannot reuse it.
      await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve) })
      tlsPort = proxy.address().port; webPort = await port()
      assert.notEqual(tlsPort, webPort); assert.notEqual(tlsPort, f.target.database.port)
      config = compactKnowledgeCohortConfiguration({ target: f.target, root: f.root, webPort }); baseURL = `https://127.0.0.1:${tlsPort}`
      config.selectors.COMPACT_PUBLIC_BASE_URL = baseURL
      for (const key of ['app', 'knowledge', 'storage']) await writeFile(config.files[key], config[key], { flag: 'wx', mode: 0o600 })
      const selectors = path.join(f.root, 'private selectors.env')
      await writeFile(selectors, Object.entries(config.selectors).map(([k, v]) => `${k}='${String(v).replaceAll('\\', '/')}'`).join('\n') + '\n', { flag: 'wx', mode: 0o600 })
      compose = ['compose', '--project-name', f.target.project, '--env-file', selectors, '--file', path.join(retainedRoot, 'compose.yml')]
      const ids = (await docker(['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', `label=com.docker.compose.project=${f.target.project}`])).split(/\r?\n/).filter(Boolean)
      assertCompactKnowledgeProjectInventory({ ids, database: await resource('container', f.target.database.container), target: f.target, manifest: f.manifest })
      for (const suffix of ['genesis', 'knowledge-state']) if (await resource('volume', `${f.target.project}-${suffix}`)) throw new Error('COMPACT_JOURNEY_EXISTING_VOLUME')
      await docker([...compose, '--profile', 'knowledge', 'config', '--quiet']); await up('web'); await webReady()
      const web = await owned('web'); assert(web.Config.Env.includes('ZURI_KNOWLEDGE_ENABLED=0')); checks.startup = true
    },
    async actor(label) {
      const http = client(), password = randomBytes(24).toString('base64url'), email = `${label}-${randomUUID()}@example.invalid`
      const response = await http.request('POST', '/api/auth/signup', { displayName: `Compact ${label}`, email, password })
      assert.equal(response.status, 201); assert(response.sessionCookie.secure && response.sessionCookie.httpOnly)
      const personId = response.body.user.id
      const counts = async () => (await f.query('SELECT (SELECT count(*)::int FROM "PlatformGrant" WHERE "personId"=$1) AS grants,(SELECT count(*)::int FROM "Membership" WHERE "personId"=$1) AS memberships', [personId])).rows[0]
      assert.deepEqual(await counts(), { grants: 0, memberships: 0 })
      const initialScope = checkedJourneyResponse(await http.request('GET', '/api/scope')); assert.equal(initialScope.businesses.length, 0)
      checkedJourneyResponse(await http.request('POST', '/api/onboarding/profile', { firstName: 'Compact', lastName: label, phone: '0000000000' }))
      const provisioned = checkedJourneyResponse(await http.request('POST', '/api/scope', { entity: 'businessInGroup', data: { name: `Compact ${label}` } }))
      const businessId = provisioned.business.id
      const ids = (await f.query('SELECT b.id AS "businessId",b."tenantId",t."portfolioId" FROM "Business" b JOIN "Tenant" t ON t.id=b."tenantId" WHERE b.id=$1', [businessId])).rows[0]
      assert(ids?.portfolioId); assert.deepEqual(await counts(), { grants: 0, memberships: 1 })
      const membership = (await f.query('SELECT "tenantId","businessId","scopeType",role,"grantSource" FROM "Membership" WHERE "personId"=$1', [personId])).rows
      assert.deepEqual(membership, [{ tenantId: ids.tenantId, businessId: null, scopeType: 'TENANT', role: 'OWNER', grantSource: 'SELF_PROVISION' }])
      return { http, personId, ids, counts, membership }
    },
    async activate(identities) {
      config = bindCompactKnowledgeBusiness(config, identities)
      await rewritePrivate(config.files.app, config.app); await rewritePrivate(config.files.knowledge, config.knowledge)
      await up('web', true); await webReady()
      const web = await owned('web'); assert(web.Config.Env.includes('ZURI_KNOWLEDGE_ENABLED=1')); assert(web.Config.Env.includes('ZURI_KNOWLEDGE_STORAGE_ENABLED=0'))
      assert(!web.Config.Env.some(v => /^(?:ZURI_LINE_|ZURI_MSP_THREAD_|MSP_THREAD_|OLLAMA_)/.test(v)))
      admissionObserved = true; checks.binding = true
    },
    async fixture() {
      const result = readCompactJourneyCorpus({ sourceRevision: expectedRevision })
      snapshots.corpus = { sourceRevision: expectedRevision, sha256: result.sha256 }
      return result.fixture
    },
    async replaceWeb() {
      assert.equal(await resource('container', name('genesis-worker')), null)
      const before = await owned('web'); await up('web', true); await webReady(); const after = await owned('web')
      assert.notEqual(after.Id, before.Id); assert.equal(await resource('container', name('genesis-worker')), null)
      snapshots.webReplacement = { beforeId: before.Id, afterId: after.Id, actualImageId: after.Image, nativeAbsent: true }
    },
    async startNative() {
      await up('genesis-worker')
      const bakedHash = await exec('genesis-worker', "import fs from 'node:fs';import {createHash} from 'node:crypto';process.stdout.write(createHash('sha256').update(fs.readFileSync('/opt/ki17/fixtures/genesisrag17-corpus-v1.json')).digest('hex'))")
      assert.equal(bakedHash, snapshots.corpus.sha256); snapshots.corpus.nativeBakedSha256 = bakedHash
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        const status = await exec('web', "try{const r=await fetch('http://127.0.0.1:19417/query',{method:'POST',headers:{authorization:'Bearer WRONG_TEST_ONLY'},body:'{}',signal:AbortSignal.timeout(1000)});process.stdout.write(String(r.status))}catch{process.stdout.write('UNAVAILABLE')}")
        if (status === '401') { snapshots.cohort = await cohort(); assert.equal(snapshots.cohort.status, 'COHORT_PRESENT_NOT_QUALIFIED'); assert.equal(snapshots.cohort.networkMode, `container:${snapshots.cohort.webId}`); checks.native = true; return }
        await pause(200)
      }
      throw new Error('COMPACT_JOURNEY_NATIVE_NOT_READY')
    },
    async diagnostics() {
      return JSON.parse(execFileSync(process.execPath, [path.join(retainedRoot, 'compact-self-host.mjs'), 'diagnostics', '--package', retainedRoot, '--target', f.targetFile, '--configuration', config.files.app],
        { cwd: f.root, env: compactProcessEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }))
    },
    async close() {
      const cleanup = [
        async () => { if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)) } },
        ...[...roles].reverse().map(role => async () => { const c = await resource('container', name(role)); if (c) { assertCompactKnowledgeCohortContainer({ container: c, role, target: f.target, manifest: f.manifest, expectedImageId: artifact.images[imageKey(role)].id }); await docker(['container', 'rm', '--force', c.Id]) } if (uncertain.has(role)) throw new Error('COMPACT_JOURNEY_CREATE_UNVERIFIED') }),
        ...(volumeIntent ? ['genesis', 'knowledge-state'].map(suffix => async () => { const v = await resource('volume', `${f.target.project}-${suffix}`); if (v) { assertCompactFixtureOwnership('volume', v, f.target); await docker(['volume', 'rm', v.Name]) } }) : []),
        () => f.close(),
      ]
      const result = await observeAndCleanCompactFixture({ observe: async () => {
        const last = await inspectCompactKnowledgeCandidate({ packageDirectory: retainedRoot, expectedRevision, target: f.target, driver: f.driver })
        if (artifact) { assert.equal(last.manifestSha256, artifact.manifestSha256); assert.equal(last.packageInventorySha256, artifact.packageInventorySha256) }
        return { targetId: f.target.targetId, project: f.target.project }
      }, cleanup, record: view => writeFile(evidenceFile, JSON.stringify({ environment: 'TEST', packageSource: expectedRevision, harnessRevision,
        status: ['package', 'baseline', 'bootstrap', 'startup', 'authority', 'binding', 'durable', 'idempotent', 'replacement', 'native', 'published', 'serving', 'withdrawn'].every(k => checks[k]) && view.observation === 'PASS' && view.cleanup === 'PASS' ? 'PASS' : 'FAIL',
        observation: view.observation, cleanup: view.cleanup, cleanupChecks: view.cleanupChecks, identity: view.identity, checks, snapshots, unresolvedComposeIntents: [...uncertain],
        applicationAdmission: admissionObserved ? 'ENABLED_FOR_SCOPED_TEST' : 'NOT_VERIFIED', objectStorage: 'DISABLED_INLINE_TEXT_ONLY', knowledge: 'NOT_QUALIFIED', line: 'NOT_SELECTED',
        nativeStage9Recovery: 'NOT_PROVEN', liveLineUat: 'NOT_RUN', task6Closed: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }) })
      if (result.error) throw result.error
    },
  }
  return api
}

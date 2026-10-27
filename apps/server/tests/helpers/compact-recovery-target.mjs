// @req FR-045, FR-223, FR-282 — owned synthetic restore/authorization and retained-custody probes.
// @spec ADR-115, SEC-030 — TEST harness only, never an operator restore implementation.
// @tested tests/postgres/compact-recovery.test.js
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@zuri/prisma-postgres'
import { compactFixture } from './compact-postgres-target.mjs'
import { canonicalInput } from './compact-core-target.mjs'
import { startCompactBusinessStorage } from './compact-business-storage.mjs'
import * as packageApi from '../../scripts/compact-package.mjs'
import * as baselineApi from '../../scripts/lib/compact/baseline.mjs'
import * as executorApi from '../../scripts/lib/compact/executor.mjs'
import { runCompactDocker } from '../../scripts/lib/compact/docker.mjs'
import { inspectCompactQualificationCandidate } from '../../scripts/lib/compact/qualify.mjs'
import { stableJson, digest } from '../../scripts/lib/compact/files.mjs'
import { SNAPSHOT_MODELS, SNAPSHOT_EXCLUDED_MODELS } from '../../src/modules/project-manager/application/backup-service.js'
import { sealSecretEnvelope, openSecretEnvelope } from '../../src/platform/integrations/core/secret-store/envelope-secret-store.js'
import { markCredentialsReentryRequired } from '../../src/platform/integrations/core/secret-store/credential-lifecycle.js'
import { createManagedBlobFileAsset, resolveFileAssetContent } from '../../src/modules/project-manager/application/file-asset-service.js'
import { createPrivateBusinessObjectStoragePort } from '../../src/platform/storage/private-business-object-storage.js'
import { recordAudit } from '../../src/modules/project-manager/application/audit.js'
import { makeViewer, makeOperatorViewer } from '../factories/viewer.js'
import { setMarketingReportPolicy, createMarketingReportBinding } from '../../src/modules/marketing/application/marketing-report-operator.js'
import { receiveMarketingReport } from '../../src/modules/marketing/application/marketing-report-receiver.js'
import { canonicalReportText, reportHash } from '../../src/modules/marketing/application/marketing-report-wire.js'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const upper = value => value[0].toUpperCase() + value.slice(1)
const protectedTables = ['MarketingReportPolicy', 'MarketingReportBinding', 'MarketingExternalReport']
const requiredChecks = ['sourceSecretRestart', 'foreignAndCorruptRefused', 'databaseRowsAndCatalog', 'credentialReentry', 'metadataOnlyRefused', 'exactObjectAndFixtureRemap', 'currentFileAuthorization', 'retryRefused']
const hash = value => createHash('sha256').update(value).digest('hex')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function sanitized(error, operation) {
  const code = /^COMPACT_[A-Z0-9_]+$/.test(error?.code || '') ? error.code : `COMPACT_RECOVERY_${operation.toUpperCase()}_FAILED${/^P\d{4}$/.test(error?.code || '') ? '_' + error.code : ''}`
  return Object.assign(new Error(code), { code, stage: operation.toUpperCase(), cleanupFailed: error?.cleanupFailed === true })
}

export async function startCompactRecoveryTarget() {
  if (!process.env.COMPACT_CORE_IMAGE_FILE || !process.env.COMPACT_RECOVERY_PRIVATE_DIRECTORY || !process.env.COMPACT_PACKAGE_DIRECTORY) fail('COMPACT_RECOVERY_EXPLICIT_INPUT_REQUIRED')
  const images = JSON.parse(await executorApi.readCompactPrivateFile(process.env.COMPACT_CORE_IMAGE_FILE))
  assert.deepEqual(Object.keys(images).sort(), ['postgres', 'storage', 'tools', 'web'])
  const privateRoot = await realpath(process.env.COMPACT_RECOVERY_PRIVATE_DIRECTORY), runId = randomUUID(), backupDirectory = path.join(privateRoot, runId)
  await mkdir(backupDirectory)
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
  const closers = new Map(), register = (name, fn) => closers.set(name, { fn, done: false })
  const closeOne = async name => { const c = closers.get(name); if (c && !c.done) { await c.fn(); c.done = true } }
  let pendingEvidence, source, target, sourceDb, targetDb, sourceStorage, targetStorage, sourceCandidate, targetCandidate, sourceIdentity, targetIdentity, setupStage = 'START', setupCleanupFailed = false
  const close = async completed => {
    let error
    for (const name of [...closers.keys()].reverse()) try { await closeOne(name) } catch (e) { error ||= e }
    const cleanup = error || setupCleanupFailed ? 'FAIL' : 'PASS', checks = Object.fromEntries(requiredChecks.map(k => [k, completed?.has(k) === true]))
    const evidence = { environment: 'TEST', sourceRevision, runId, status: Object.values(checks).every(Boolean) && cleanup === 'PASS' ? 'PASS' : 'FAIL', cleanup, checks,
      ...pendingEvidence, limits: ['Harness-only synthetic restore, not backup-service or operator recovery qualification', 'No envelope ciphertext or KEK exported/restored', 'Same-host resources do not qualify an off-host backup failure domain', 'No AI/native Stage9/live/hosted/production acceptance'] }
    await writeFile(path.join(backupDirectory, 'sanitized-observation.json'), stableJson(evidence), { flag: 'wx', mode: 0o600 })
    if (error) throw error
  }
  try {
    for (const side of ['source', 'target']) {
      setupStage = `${side}_PACKAGE`
      const f = await compactFixture({ packageApi, baselineApi, executorApi, componentImages: images, sourceRevision, prepareInput: canonicalInput, packageDirectory: process.env.COMPACT_PACKAGE_DIRECTORY })
      register(`${side}Fixture`, () => f.close())
      setupStage = `${side}_CANDIDATE`
      const candidate = await inspectCompactQualificationCandidate({ packageDirectory: f.release, target: f.target, driver: f.driver })
      setupStage = `${side}_INSTALL`
      await f.install()
      const observed = await f.driver.inspect({ manifest: f.manifest, target: f.target })
      const identity = { systemIdentifier: observed.database.systemIdentifier, oid: observed.database.oid, catalogSha256: observed.database.catalogSha256, marker: observed.database.installation, containerId: observed.container.id, targetId: f.target.targetId }
      const url = new URL(`postgresql://localhost/${f.target.database.name}`); url.hostname = f.target.database.host; url.port = String(f.target.database.port); url.username = f.target.database.runtimeRole; url.password = f.runtimePassword
      const db = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] }); await db.$connect(); register(`${side}Db`, () => db.$disconnect())
      if (side === 'source') { source = f; sourceDb = db; sourceCandidate = candidate; sourceIdentity = identity } else { target = f; targetDb = db; targetCandidate = candidate; targetIdentity = identity }
    }
    assert.equal(sourceCandidate.manifestSha256, targetCandidate.manifestSha256)
    for (const key of ['packageInventorySha256', 'hostCliSha256', 'baselineSha256']) assert.equal(sourceCandidate[key], targetCandidate[key])
    for (const side of ['source', 'target']) {
      setupStage = `${side}_STORAGE`
      const storage = await startCompactBusinessStorage({ image: images.storage, command: source.manifest.storageQualification.command }); register(`${side}Storage`, () => storage.close())
      assert.equal(storage.evidence.reference, images.storage)
      if (side === 'source') sourceStorage = storage; else targetStorage = storage
    }
    const counts = async f => Object.fromEntries(Object.entries((await f.query(`SELECT jsonb_object_agg(tablename,query_to_xml(format('SELECT count(*) AS n FROM public.%I',tablename),false,true,'')::text) AS counts FROM pg_tables WHERE schemaname='public'`)).rows[0].counts).map(([name, xml]) => [name, Number(/<n>(\d+)<\/n>/.exec(xml)?.[1] ?? NaN)]))
    const excludedTables = Object.keys(SNAPSHOT_EXCLUDED_MODELS).map(upper).filter(k => !protectedTables.includes(k))
    const rowHashes = async f => (await f.query(`SELECT jsonb_object_agg(tablename,encode(sha256(convert_to(query_to_xml(format('SELECT to_jsonb(t) AS row FROM public.%I t ORDER BY to_jsonb(t)::text',tablename),false,true,'')::text,'UTF8')),'hex')) AS hashes FROM pg_tables WHERE schemaname='public' AND tablename<>ALL($1::text[])`, [excludedTables])).rows[0].hashes
    const command = async (f, args, input = '') => {
      const observed = await f.driver.inspect({ manifest: f.manifest, target: f.target }); assert.equal(observed.container.id, f === source ? sourceIdentity.containerId : targetIdentity.containerId)
      const result = await runCompactDocker(['--host', observed.daemon.endpoint, 'container', 'exec', '--interactive', observed.container.id, ...args], { input, timeoutMs: 120000 })
      if (result.status !== 0) fail('COMPACT_RECOVERY_DATABASE_COMMAND_FAILED')
      return result.stdout
    }
    const objects = [], kekEnv = { NODE_ENV: 'production', ZURI_SECRET_KEK: randomBytes(32).toString('hex'), ZURI_SECRET_KEK_VERSION: '1' }
    let business, owner, credential, envelope, envelopeScope, plaintext, heldBackup
    const sourcePorts = Object.fromEntries(['asset', 'catalog'].map(p => [p, createPrivateBusinessObjectStoragePort(p, sourceStorage.env)]))
    const targetPorts = Object.fromEntries(['asset', 'catalog'].map(p => [p, createPrivateBusinessObjectStoragePort(p, targetStorage.env)]))
    const targetReader = { get: args => targetPorts[/^s3-business:\/\/(asset|catalog)\//.exec(args.ref)?.[1]]?.get(args) ?? fail('COMPACT_RECOVERY_REF_INVALID') }
    const targetState = async () => {
      const current = await target.driver.inspect({ manifest: target.manifest, target: target.target })
      assert.equal(current.database.systemIdentifier, targetIdentity.systemIdentifier); assert.equal(current.database.oid, targetIdentity.oid)
      assert.equal(current.database.catalogSha256, targetIdentity.catalogSha256); assert.deepEqual(current.database.installation, targetIdentity.marker)
      return current
    }
    const fixture = { sourceCandidate, targetCandidate, sourceIdentity, targetIdentity,
      async seedSynthetic() {
        const portfolio = await sourceDb.portfolio.create({ data: { code: randomUUID(), name: 'Synthetic recovery' } })
        const tenant = await sourceDb.tenant.create({ data: { code: randomUUID(), name: 'Synthetic recovery', portfolioId: portfolio.id } })
        business = await sourceDb.business.create({ data: { code: randomUUID(), name: 'Synthetic recovery', tenantId: tenant.id } })
        owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
        const provider = await sourceDb.integrationProvider.create({ data: { code: randomUUID(), name: 'Synthetic offline provider' } })
        const connection = await sourceDb.integrationConnection.create({ data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'Synthetic offline connection' } })
        envelopeScope = { tenantId: tenant.id, businessId: business.id, connectionId: connection.id, versionNumber: 1 }
        plaintext = randomBytes(32).toString('hex')
        envelope = sealSecretEnvelope({ id: randomUUID(), ...envelopeScope, plaintext }, kekEnv)
        await sourceDb.integrationSecretEnvelope.create({ data: envelope })
        credential = await sourceDb.integrationCredential.create({ data: { connectionId: connection.id, secretRef: `envelope:${envelope.id}`, secretStore: 'ENVELOPE', secretKind: 'API_KEY', status: 'ACTIVE' } })
        for (const purpose of ['asset', 'catalog']) {
          const content = Buffer.from(`Synthetic ${purpose} recovery bytes`), key = `${purpose === 'asset' ? 'asset-evidence' : 'business-catalog'}/${tenant.id}/${business.id}/test/${randomUUID()}.json`
          const stored = await sourcePorts[purpose].put({ key, content }), file = await createManagedBlobFileAsset({ businessId: business.id, name: `${purpose}.json`, mime: 'application/json', size: content.length, sha256: hash(content), blobRef: stored.ref }, { db: sourceDb, viewer: owner })
          objects.push({ purpose, fileId: file.id, fileVersion: file.version, tenantId: tenant.id, businessId: business.id, ref: stored.ref, key, sha256: hash(content), size: content.length })
        }
        const operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
        await setMarketingReportPolicy({ db: sourceDb, provider: 'postgresql', viewer: operator, businessId: business.id, expectedVersion: 0, ingestEnabled: false })
        const golden = JSON.parse(await readFile(new URL('../fixtures/marketing-report/go-v01.json', import.meta.url)))
        const binding = await createMarketingReportBinding({ db: sourceDb, provider: 'postgresql', viewer: operator, businessId: business.id, sourceDeploymentId: golden.source.deploymentId, sourceBusinessId: golden.source.sourceBusinessId })
        await setMarketingReportPolicy({ db: sourceDb, provider: 'postgresql', viewer: operator, businessId: business.id, expectedVersion: 1, ingestEnabled: true })
        const plan = await sourceDb.marketingPlan.create({ data: { code: randomUUID(), title: 'Synthetic recovery', tenantId: tenant.id, businessId: business.id, createdBy: 'TEST' } })
        const initiative = await sourceDb.marketingInitiative.create({ data: { code: randomUUID(), tenantId: tenant.id, businessId: business.id, planId: plan.id, createdBy: 'TEST' } })
        const { payloadHash, ...body } = golden; body.target = { bindingId: binding.binding.id, initiativeId: initiative.id }
        const result = await receiveMarketingReport({ db: sourceDb, provider: 'postgresql', authorization: `Bearer ${binding.credential}`, raw: canonicalReportText({ ...body, payloadHash: reportHash(body) }) }); assert.equal(result.status, 201)
      },
      async proveSourceSecretRestartAndMissingKeyRefusal() {
        await sourceDb.$disconnect()
        const observed = await source.driver.inspect({ manifest: source.manifest, target: source.target })
        const restarted = await runCompactDocker(['--host', observed.daemon.endpoint, 'container', 'restart', '--time', '10', sourceIdentity.containerId]); assert.equal(restarted.status, 0)
        let ready = false
        for (let i = 0; i < 80; i++) { try { await source.driver.inspect({ manifest: source.manifest, target: source.target }); ready = true; break } catch {} await pause(250) }
        assert(ready); await sourceDb.$connect()
        const row = await sourceDb.integrationSecretEnvelope.findUnique({ where: { id: envelope.id } })
        assert.equal(hash(openSecretEnvelope(row, envelopeScope, kekEnv)), hash(plaintext))
        assert.throws(() => openSecretEnvelope(row, envelopeScope, { NODE_ENV: 'production' }), e => e.code === 'CHANNEL_SECRET_STORE_UNAVAILABLE')
        assert.throws(() => openSecretEnvelope(row, envelopeScope, { ...kekEnv, ZURI_SECRET_KEK: randomBytes(32).toString('hex') }), e => e.code === 'CHANNEL_SECRET_SCOPE_MISMATCH')
      },
      async backup() {
        const inventory = await counts(source); assert.equal(Object.keys(inventory).length, 210); assert(Object.values(inventory).every(Number.isSafeInteger))
        const known = new Set([...SNAPSHOT_MODELS.map(upper), ...Object.keys(SNAPSHOT_EXCLUDED_MODELS).map(upper)])
        for (const [name, count] of Object.entries(inventory)) {
          if (count && !known.has(name) && !protectedTables.includes(name)) fail('COMPACT_RECOVERY_UNCLASSIFIED_STATE')
          if (count && excludedTables.includes(name) && name !== 'IntegrationSecretEnvelope') fail('COMPACT_RECOVERY_SECURITY_STATE_UNSUPPORTED')
        }
        const portableHashes = await rowHashes(source)
        const args = ['pg_dump', '--no-password', '--username', source.target.database.bootstrapRole, '--dbname', source.target.database.name, '--schema=public', '--data-only', '--disable-triggers', '--no-owner', '--no-privileges', ...excludedTables.filter(name => Object.hasOwn(inventory, name)).map(name => `--exclude-table-data=public."${name}"`)]
        const dump = await command(source, args)
        if (dump.includes(envelope.ciphertext) || dump.includes(kekEnv.ZURI_SECRET_KEK) || dump.includes(plaintext)) fail('COMPACT_RECOVERY_SECRET_EXPORT_REFUSED')
        const databaseFile = path.join(backupDirectory, 'portable-data.sql'); await writeFile(databaseFile, dump, { flag: 'wx', mode: 0o600 })
        for (const object of objects) { const content = await sourcePorts[object.purpose].get(object); assert.equal(hash(content), object.sha256); object.filename = path.join(backupDirectory, `${object.purpose}-${object.sha256}.bin`); await writeFile(object.filename, content, { flag: 'wx', mode: 0o600 }) }
        heldBackup = { databaseFile, databaseSha256: hash(dump), manifestSha256: sourceCandidate.manifestSha256, portableHashes, tableCount: 210, envelopeRowsExcluded: inventory.IntegrationSecretEnvelope }
        await writeFile(path.join(backupDirectory, 'backup-manifest.json'), stableJson({ ...heldBackup, objects }), { flag: 'wx', mode: 0o600 })
        return structuredClone(heldBackup)
      },
      async proveCorruptAndForeignBackupRefusal(backup) {
        const before = await counts(target), corrupt = path.join(backupDirectory, 'corrupt-copy.sql'); await writeFile(corrupt, 'CORRUPT TEST COPY', { flag: 'wx', mode: 0o600 })
        await assert.rejects(this.restore({ ...backup, databaseFile: corrupt }), { code: 'COMPACT_RECOVERY_BACKUP_INVALID' })
        await assert.rejects(this.restore({ ...backup, manifestSha256: '0'.repeat(64) }), { code: 'COMPACT_RECOVERY_BACKUP_INVALID' })
        assert.deepEqual(await counts(target), before)
      },
      async closeSource() { await closeOne('sourceDb'); await closeOne('sourceStorage'); await closeOne('sourceFixture') },
      async restore(backup) {
        await targetState()
        if (Object.values(await counts(target)).some(n => n !== 0)) fail('COMPACT_RECOVERY_TARGET_NOT_EMPTY')
        if (!heldBackup || backup.manifestSha256 !== targetCandidate.manifestSha256 || path.dirname(path.resolve(backup.databaseFile)) !== backupDirectory) fail('COMPACT_RECOVERY_BACKUP_INVALID')
        const bytes = await executorApi.readCompactPrivateFile(backup.databaseFile, 16 * 1024 * 1024)
        if (hash(bytes) !== heldBackup.databaseSha256 || backup.databaseSha256 !== heldBackup.databaseSha256) fail('COMPACT_RECOVERY_BACKUP_INVALID')
        await command(target, ['psql', '-X', '--no-password', '--quiet', '--set', 'ON_ERROR_STOP=1', '--single-transaction', '--username', target.target.database.bootstrapRole, '--dbname', target.target.database.name, '--file', '-'], bytes)
        assert.deepEqual(await rowHashes(target), heldBackup.portableHashes); await targetState()
        assert.equal(await targetDb.marketingExternalReport.count(), 1)
        await assert.rejects(targetDb.marketingExternalReport.updateMany({ data: { payloadHash: '0'.repeat(64) } }))
        await markCredentialsReentryRequired(targetDb)
      },
      targetEnvelopeCount: () => targetDb.integrationSecretEnvelope.count(),
      targetCredentialStatus: async () => (await targetDb.integrationCredential.findUnique({ where: { id: credential.id } })).status,
      async proveMetadataOnlyObjectLoss() { for (const object of objects) await assert.rejects(resolveFileAssetContent(object.fileId, { db: targetDb, visibleBusinessIds: owner.visibleBusinessIds, objectStoragePort: targetReader })) },
      async copyExactObjectAndRemapFixture() {
        for (const object of objects) {
          const content = await executorApi.readCompactPrivateFile(object.filename); assert.equal(hash(content), object.sha256); assert.equal(content.length, object.size)
          const stored = await targetPorts[object.purpose].put({ key: object.key, content }); assert.notEqual(stored.ref, object.ref)
          // Deliberately TEST-only administrative fixture mapping. This is not
          // an owner-authorized managed-blob restore operation or public API.
          await targetDb.$transaction(async tx => {
            const changed = await tx.fileAsset.updateMany({ where: { id: object.fileId, tenantId: object.tenantId, businessId: object.businessId, version: object.fileVersion, blobRef: object.ref }, data: { blobRef: stored.ref, version: { increment: 1 } } }); assert.equal(changed.count, 1)
            await recordAudit(tx, { tenantId: object.tenantId, businessId: object.businessId, entityType: 'FILE_ASSET', entityId: object.fileId, action: 'COMPACT_TEST_ONLY_REF_REMAP', payload: { environment: 'TEST', fromRefSha256: digest(object.ref), toRefSha256: digest(stored.ref) } })
          })
        }
      },
      async proveCurrentFileAuthorization() {
        for (const object of objects) {
          let read = false
          await assert.rejects(resolveFileAssetContent(object.fileId, { db: targetDb, visibleBusinessIds: [], objectStoragePort: { get: async () => { read = true; fail('UNAUTHORIZED_PROVIDER_IO') } } }))
          assert.equal(read, false)
          const resolved = await resolveFileAssetContent(object.fileId, { db: targetDb, visibleBusinessIds: owner.visibleBusinessIds, objectStoragePort: targetReader }); assert.equal(hash(resolved.content), object.sha256)
          assert.equal(resolved.asset.tenantId, object.tenantId); assert.equal(resolved.asset.businessId, object.businessId); assert.equal(resolved.asset.version, object.fileVersion + 1)
        }
      },
      async recordEvidence(completed) { pendingEvidence = { candidate: sourceCandidate, sourceIdentity, targetIdentity, portableTableHashCount: Object.keys(heldBackup.portableHashes).length, databaseBackupSha256: heldBackup.databaseSha256, envelopeRowsExcluded: heldBackup.envelopeRowsExcluded, operatorRecovery: 'NOT_QUALIFIED', objectPurposes: objects.map(o => o.purpose) }; assert(requiredChecks.every(k => completed.has(k))) },
      close,
    }
    return Object.fromEntries(Object.entries(fixture).map(([name, value]) => [name, typeof value !== 'function' ? value : async (...args) => {
      try { return await value.apply(fixture, args) } catch (error) { throw sanitized(error, name) }
    }]))
  } catch (error) { setupCleanupFailed ||= error?.cleanupFailed === true; try { await close() } catch { error.cleanupFailed = true }; throw sanitized(error, `setup_${setupStage}`) }
}

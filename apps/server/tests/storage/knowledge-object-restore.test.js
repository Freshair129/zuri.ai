// @req FR-173 — actual-provider TEST evidence proves exact-version copy and
//   audited mapping while leaving application serving disabled.
// @spec TASK-ZAI-049 §8.1, ADR-057
// @tested src/modules/knowledge/knowledge-object-recovery-service.js

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createCleanKnowledgeRestoreDatabase, startIsolatedKnowledgeRestoreStorage } from '../helpers/knowledge-restore-storage'

const databaseUrl = inject('testDatabaseUrl')
const healthProbeOnly = process.env.ZURI_KNOWLEDGE_RESTORE_HEALTH_PROBE_ONLY === '1'
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl || '')) {
  throw new Error('KNOWLEDGE_RESTORE_TEST_REQUIRES_INJECTED_POSTGRES')
}

const STAGE_1_TO_8 = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8])
const REASON = 'synthetic TASK-ZAI-049 §8.1 actual-provider qualification'
let prisma
let createPortfolio
let createTenant
let createBusiness
let makeOperatorViewer
let ingestGenesisRag17Raw
let resolveGenesisRag17RawLineage
let GENESIS_RAG17_SCHEMA_VERSION
let createKnowledgeObjectBackup
let restoreKnowledgeObjectBackup
let verifyRestoredKnowledgeObject
let exportSnapshot
let importSnapshot

function sourceInput({ suffix, scope, connectionId, ordinal, content }) {
  return {
    scope,
    sourceId: `synthetic://knowledge-restore/${suffix}/${ordinal}`,
    documentId: `knowledge-restore-${suffix}-${ordinal}`,
    version: 'source-v1',
    content,
    connectionId,
    sourceType: 'TEXT',
    sourceUri: 'synthetic-restore-test',
    policy: { allowEmbedding: true, allowPublication: true },
  }
}

function syntheticErasureLedger({ backupId, watermark, withheldStorageIds }) {
  return {
    schemaVersion: 'knowledge-test-erasure-ledger.v1',
    authority: 'SYNTHETIC_TEST',
    backupId,
    watermark,
    withheldStorageIds,
  }
}

describe('TASK-ZAI-049 §8.1 isolated actual-provider object restore', () => {
  let storage
  let targetDatabase

  beforeAll(async () => {
    // The general Postgres resolver also recognizes deployment-specific URL
    // aliases. Clear them before dynamically importing any module that binds
    // the application Prisma singleton; only the injected disposable URL is
    // permitted to select its data source in this isolated profile.
    for (const key of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL']) delete process.env[key]
    process.env.DATABASE_URL = databaseUrl
    const [dbModule, scopeFactory, viewerFactory, genesis, contract, recovery, backup] = await Promise.all([
      import('@/lib/db'),
      import('../factories/scope'),
      import('../factories/viewer'),
      import('@/platform/integrations/core/genesisrag17-executor'),
      import('@/modules/knowledge/genesisrag17-contract'),
      import('@/modules/knowledge/knowledge-object-recovery-service'),
      import('@/modules/project-manager/application/backup-service'),
    ])
    prisma = dbModule.default
    ;({ createPortfolio, createTenant, createBusiness } = scopeFactory)
    ;({ makeOperatorViewer } = viewerFactory)
    ;({ ingestGenesisRag17Raw, resolveGenesisRag17RawLineage } = genesis)
    ;({ GENESIS_RAG17_SCHEMA_VERSION } = contract)
    ;({ createKnowledgeObjectBackup, restoreKnowledgeObjectBackup, verifyRestoredKnowledgeObject } = recovery)
    ;({ exportSnapshot, importSnapshot } = backup)
    storage = await startIsolatedKnowledgeRestoreStorage({ healthProbeOnly })
    if (!healthProbeOnly) targetDatabase = await createCleanKnowledgeRestoreDatabase({ testDatabaseUrl: databaseUrl })
  }, 120_000)

  afterAll(async () => {
    let cleanupError = null
    try { await targetDatabase?.close() } catch (error) { cleanupError = error }
    try { await storage?.close() } catch (error) { cleanupError ||= error }
    if (cleanupError) throw cleanupError
  }, 30_000)

  it('copies real exact versions, imports into a clean TEST database, and keeps current erasure decisions non-serving', async () => {
    if (healthProbeOnly) {
      expect(storage.healthReady).toBe(true)
      console.info('KNOWLEDGE_RESTORE_TEST_HEALTH_ONLY', JSON.stringify({ mode: 'HEALTH_ONLY',
        imageId: storage.localImageId, containerId: storage.containerId, health: storage.health,
        volumeName: storage.volumeName, dataMount: storage.dataMount,
        bucketCreation: false, databaseRestore: false, objectCopy: false }))
      return
    }
    expect(targetDatabase.db._engineConfig.activeProvider).toBe('postgresql')
    expect(targetDatabase.databaseName).toMatch(/^zuri_knowledge_restore_test_[0-9a-f]{32}$/)
    expect(storage.localImageId).toBe('sha256:ca499c729f62921367079f685d29e03e262b2d1be31e0af9fa6f6b564dc8850f')
    expect(storage.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(Object.values(storage.buckets)).toHaveLength(3)
    expect(new Set(Object.values(storage.buckets)).size).toBe(3)
    expect(Object.values(storage.buckets).every((bucket) => bucket.startsWith('zuri-restore-test-'))).toBe(true)

    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `Knowledge restore TEST ${suffix}`, code: `KRS-PF-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Knowledge restore TEST ${suffix}`, code: `KRS-TN-${suffix}` })
    const business = await createBusiness({ tenantId: tenant.id, name: `Knowledge restore TEST ${suffix}`, code: `KRS-BU-${suffix}` })
    const provider = await prisma.integrationProvider.create({ data: { code: `KRS-${suffix}`, name: 'Synthetic restore source', status: 'ACTIVE' } })
    const connection = await prisma.integrationConnection.create({ data: {
      tenantId: tenant.id,
      businessId: business.id,
      providerId: provider.id,
      name: `Synthetic restore source ${suffix}`,
      status: 'ACTIVE',
    } })
    const scope = {
      portfolioId: portfolio.id,
      tenantId: tenant.id,
      businessId: business.id,
      workspaceId: `knowledge-restore-workspace-${suffix}`,
      agentId: `knowledge-restore-agent-${suffix}`,
      visibility: 'private',
    }
    const viewer = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    const payloads = [
      `Synthetic source alpha ${suffix}.\nKeep exact UTF-8 source bytes.`,
      `Synthetic source beta ${suffix}.\nThis object will be withheld by a newer test decision.`,
    ]
    const stage9Transports = []
    const transport = async (name, request) => {
      stage9Transports.push({ name, batchId: request.batch.batchId })
      return {
        schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
        scope: request.scope,
        batchId: request.batch.batchId,
        decisionId: null,
        status: 'PENDING',
      }
    }
    const ingestions = []
    for (let index = 0; index < payloads.length; index += 1) {
      ingestions.push(await ingestGenesisRag17Raw(sourceInput({
        suffix,
        scope,
        connectionId: connection.id,
        ordinal: index + 1,
        content: payloads[index],
      }), {
        db: prisma,
        viewer,
        transport,
        credential: 'synthetic-test-only',
        storagePort: storage.source.port,
        storageBinding: { id: storage.source.id, revision: storage.source.revision, bucket: storage.source.bucket },
      }))
    }

    const sourceStorageRows = await prisma.knowledgeArtifactStorage.findMany({
      where: { businessId: business.id },
      orderBy: { id: 'asc' },
    })
    expect(sourceStorageRows).toHaveLength(2)
    expect(sourceStorageRows.every((row) => row.status === 'READY' && row.objectVersionId)).toBe(true)
    expect(sourceStorageRows.every((row) => row.bucket === storage.source.bucket)).toBe(true)
    const firstSourceRow = sourceStorageRows.find((row) => row.rawArtifactId === ingestions[0].source.rawArtifactId)
    const secondSourceRow = sourceStorageRows.find((row) => row.rawArtifactId === ingestions[1].source.rawArtifactId)
    expect(firstSourceRow).toBeTruthy()
    expect(secondSourceRow).toBeTruthy()
    expect(ingestions.map((result) => result.batch.status)).toEqual(['PENDING', 'PENDING'])
    expect(ingestions.every((result) => result.batch.decisionId === null)).toBe(true)
    expect(stage9Transports).toHaveLength(2)
    expect(stage9Transports.every(({ name }) => name === 'msp_pipeline_submit')).toBe(true)

    const tier1Evidence = []
    for (const ingestion of ingestions) {
      const evidence = await prisma.genesisRag17StageEvidence.findMany({
        where: { executionRunId: ingestion.run.executionRunId },
        orderBy: { stageNumber: 'asc' },
      })
      expect(evidence.map((row) => row.stageNumber)).toEqual(STAGE_1_TO_8)
      expect(evidence.every((row) => row.outcome === 'SUCCEEDED' && row.errorCount === 0)).toBe(true)
      tier1Evidence.push(...evidence)
    }

    const snapshot = await exportSnapshot({ db: prisma, includeBinaryContent: false })
    const backupId = randomUUID()
    const sourceRevision = execFileSync('git.exe', ['rev-parse', 'HEAD'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    }).trim()
    expect(sourceRevision).toMatch(/^[a-f0-9]{40}$/i)

    const { manifest, manifestSha256 } = await createKnowledgeObjectBackup({
      snapshot,
      backupId,
      sourceRevision,
      source: storage.source,
      backup: storage.backup,
      erasureWatermark: 1,
    })
    expect(manifest.entries).toHaveLength(2)
    expect(manifest.entries.every((entry) => entry.status === 'COPIED')).toBe(true)
    expect(JSON.stringify(manifest)).not.toContain(payloads[0])
    expect(JSON.stringify(manifest)).not.toContain(payloads[1])
    expect(manifestSha256).toMatch(/^[a-f0-9]{64}$/)

    // Remove only the two exact source versions created above. The backup is
    // the only remaining physical copy before the target database is restored.
    for (const row of sourceStorageRows) {
      await storage.source.port.eraseExactVersions({ key: row.objectKey, versionIds: [row.objectVersionId] })
      await expect(storage.source.port.readExact({ key: row.objectKey, versionId: row.objectVersionId }))
        .rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_OBJECT_NOT_FOUND' })
    }

    const targetDb = targetDatabase.db
    await expect(targetDb.knowledgeArtifactStorage.count()).resolves.toBe(0)
    await expect(targetDb.auditEvent.count()).resolves.toBe(0)
    const importResult = await importSnapshot(snapshot, { db: targetDb, confirm: true, viewer })
    expect(importResult.restored).toBe(true)

    const importedStorageRows = await targetDb.knowledgeArtifactStorage.findMany({
      where: { businessId: business.id },
      orderBy: { id: 'asc' },
    })
    expect(importedStorageRows).toHaveLength(2)
    expect(importedStorageRows.map((row) => row.objectVersionId)).toEqual(sourceStorageRows.map((row) => row.objectVersionId))
    expect(importedStorageRows.every((row) => row.status === 'READY')).toBe(true)
    const importedRaw = await targetDb.knowledgeRawArtifact.findUnique({ where: { id: ingestions[0].source.rawArtifactId } })
    expect(importedRaw.content).toBe(payloads[0])

    const targetCalls = storage.target.calls
    const target = storage.target
    const withheldStorageId = secondSourceRow.id
    const erasureDecision = syntheticErasureLedger({ backupId, watermark: 2, withheldStorageIds: [withheldStorageId] })
    const restoreId = randomUUID()
    const { receipt, auditId } = await restoreKnowledgeObjectBackup({
      snapshot,
      manifest,
      manifestSha256,
      backup: storage.backup,
      target,
      db: targetDb,
      restoreId,
      actorId: `synthetic-operator-${suffix}`,
      reason: REASON,
      testErasureLedger: erasureDecision,
    })

    expect(receipt).toMatchObject({
      schemaVersion: 'knowledge-object-restore.v1',
      backupId,
      manifestSha256,
      erasureWatermark: 2,
      fullAcceptance: false,
      runtimeActivated: false,
      servingEnabled: false,
      target: { bucket: storage.target.bucket, revision: 1 },
    })
    const copiedStorageId = firstSourceRow.id
    const copiedEntry = receipt.entries.find((entry) => entry.storageId === copiedStorageId)
    const withheldEntry = receipt.entries.find((entry) => entry.storageId === withheldStorageId)
    expect(copiedEntry).toMatchObject({ status: 'VERIFIED', sha256: firstSourceRow.sha256, byteLength: firstSourceRow.byteLength })
    expect(withheldEntry).toMatchObject({ status: 'WITHHELD', restored: null })
    expect(copiedEntry.restored.versionId).not.toBe(copiedEntry.original.versionId)
    expect(copiedEntry.backup.bucket).toBe(storage.backup.bucket)
    expect(copiedEntry.restored.bucket).toBe(storage.target.bucket)
    expect(targetCalls.filter((call) => call.operation === 'PUT')).toHaveLength(1)
    expect(targetCalls.filter((call) => call.operation === 'READ_EXACT')).toHaveLength(1)
    expect(targetCalls.filter((call) => call.operation === 'READ_EXACT')).toMatchObject([{
      operation: 'READ_EXACT',
      key: copiedEntry.restored.key,
      versionId: copiedEntry.restored.versionId,
    }])
    expect(targetCalls.some((call) => call.key === secondSourceRow.objectKey)).toBe(false)
    expect(JSON.stringify(receipt)).not.toContain(payloads[0])
    expect(JSON.stringify(receipt)).not.toContain(payloads[1])

    const unchangedStorageRows = await targetDb.knowledgeArtifactStorage.findMany({
      where: { businessId: business.id },
      orderBy: { id: 'asc' },
    })
    expect(unchangedStorageRows.map((row) => ({ id: row.id, status: row.status, objectVersionId: row.objectVersionId })))
      .toEqual(importedStorageRows.map((row) => ({ id: row.id, status: row.status, objectVersionId: row.objectVersionId })))
    const restoreOperation = await targetDb.knowledgeArtifactOperation.findFirst({
      where: { operation: 'RESTORE', storageId: copiedStorageId },
      orderBy: { createdAt: 'desc' },
    })
    expect(restoreOperation).toMatchObject({ status: 'VERIFIED', evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const audit = await targetDb.auditEvent.findUnique({ where: { id: auditId } })
    expect(audit).toBeTruthy()
    expect(JSON.stringify(audit)).toContain(copiedEntry.original.versionId)
    expect(JSON.stringify(audit)).toContain(copiedEntry.backup.versionId)
    expect(JSON.stringify(audit)).toContain(copiedEntry.restored.versionId)
    expect(JSON.stringify(audit)).not.toContain(payloads[0])
    expect(JSON.stringify(audit)).not.toContain(payloads[1])

    const citationResult = await resolveGenesisRag17RawLineage({
      scope,
      sourceId: ingestions[0].source.sourceId,
      documentId: ingestions[0].source.documentId,
      version: ingestions[0].source.version,
      rawArtifactId: ingestions[0].source.rawArtifactId,
      parsedArtifactId: ingestions[0].source.parsedArtifactId,
      chunkId: ingestions[0].chunks[0].chunkId,
    }, { db: targetDb })
    expect(citationResult).toMatchObject({
      rawArtifactId: ingestions[0].source.rawArtifactId,
      parsedArtifactId: ingestions[0].source.parsedArtifactId,
      chunkId: ingestions[0].chunks[0].chunkId,
    })
    const importedBatch = await targetDb.genesisRag17Batch.findUnique({ where: { batchId: ingestions[0].batch.batchId } })
    expect(importedBatch).toMatchObject({ status: 'PENDING', decisionId: null })

    const readsBeforeDiagnostic = targetCalls.filter((call) => call.operation === 'READ_EXACT').length
    const diagnostic = await verifyRestoredKnowledgeObject({
      receipt,
      auditId,
      storageId: copiedStorageId,
      db: targetDb,
      target,
      testErasureLedger: erasureDecision,
    })
    expect(diagnostic).toMatchObject({ verified: true, storageId: copiedStorageId, sha256: firstSourceRow.sha256, byteLength: firstSourceRow.byteLength })
    expect(targetCalls.filter((call) => call.operation === 'READ_EXACT')).toHaveLength(readsBeforeDiagnostic + 1)

    // A later synthetic decision that withholds the already-copied object
    // blocks diagnostic reads before the destination provider is touched.
    const newerWithhold = syntheticErasureLedger({ backupId, watermark: 3, withheldStorageIds: [copiedStorageId, withheldStorageId] })
    const readsBeforeNewerWithhold = targetCalls.filter((call) => call.operation === 'READ_EXACT').length
    await expect(verifyRestoredKnowledgeObject({
      receipt,
      auditId,
      storageId: copiedStorageId,
      db: targetDb,
      target,
      testErasureLedger: newerWithhold,
    })).rejects.toThrow()
    expect(targetCalls.filter((call) => call.operation === 'READ_EXACT')).toHaveLength(readsBeforeNewerWithhold)

    const evidenceSha256 = restoreOperation.evidenceHash
    console.info(JSON.stringify({
      qualification: 'TASK-ZAI-049 §8.1 isolated actual-provider TEST',
      provider: { name: 'MinIO', localImageId: storage.localImageId, containerId: storage.containerId, containerName: storage.containerName,
        volumeName: storage.volumeName, dataMount: storage.dataMount },
      buckets: storage.buckets,
      targetDatabase: targetDatabase.databaseName,
      syntheticCounts: { rawSources: 2, tier1StagesSucceeded: tier1Evidence.length, restoredObjects: 1, withheldObjects: 1 },
      copiedVersionIdentities: [{
        storageId: copiedEntry.storageId,
        originalVersionId: copiedEntry.original.versionId,
        backupVersionId: copiedEntry.backup.versionId,
        restoredVersionId: copiedEntry.restored.versionId,
      }],
      manifestSha256,
      mapReceiptSha256: evidenceSha256,
      tier1: { stageNumbers: STAGE_1_TO_8, lineageResolvedOnTarget: true },
      stage9: { status: importedBatch.status, decisionId: importedBatch.decisionId, syntheticTransport: true },
      nativeFactCheckpoint: 'NOT_PROVEN',
      rawInlinePurgeSupported: false,
      fullAcceptance: receipt.fullAcceptance,
      runtimeActivated: receipt.runtimeActivated,
      servingEnabled: receipt.servingEnabled,
      sameEphemeralMinioInstance: true,
      separateHostDisasterRecovery: false,
      erasureLedgerAuthority: erasureDecision.authority,
    }))
  }, 120_000)
})

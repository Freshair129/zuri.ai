import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import path from 'node:path'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import { pullGenesisRag17Evidence } from '@/platform/integrations/core/genesisrag17-importer'
import { finishKnowledgeIngestionRun, readKnowledgeIngestionJob } from '@/platform/integrations/core/knowledge-ingestion-executor'
import { KNOWLEDGE_INGESTION_STAGE_CATALOG, KNOWLEDGE_INGESTION_DEFINITION_ID, KNOWLEDGE_INGESTION_CONTRACT_ID } from '@/platform/integrations/core/pipeline-tracking-contract'
import { isolatedEnvironment, mspTransport, runSourceUntilCrash, startWorkerProcess, temporaryPipeline } from './harness'
import { exportSnapshot, importSnapshot } from '@/modules/project-manager/application/backup-service'
import { requestPipelineReplay } from '@/platform/integrations/core/pipeline-tracking-service'
import { createGenesisRag17SourceWorker } from '@/platform/integrations/core/genesisrag17-worker'
import { normalizeOrganizationName } from '@/modules/knowledge/normalization'

// @req FR-109 — actual raw acquisition, durable lineage, all17 exact attempts.
// @req FR-110 — real native embeddings, gated publication, citations and restart.
// @spec ADR-073, NFR-020
// @tested tests/acceptance/genesisrag17-e2e.test.js

const fixture = JSON.parse(readFileSync(path.resolve('tests/fixtures/genesisrag17-corpus-v1.json'), 'utf8'))
const nativeRequire = createRequire(path.resolve('package.json'))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const version = 'genesisrag17.v1'
let temp, scope, env, transport, viewer, connection, worker, firstRun, firstSnapshot, firstGeneration

function rawInput(over = {}) {
  return { scope, sourceId: fixture.sourceId, documentId: 'ki17-corpus-document', version: fixture.sourceVersion, content: fixture.text, connectionId: connection.id, provider: 'KI17_TEST', policy: { allowEmbedding: true, allowPublication: true }, ...over }
}

async function bootWorker(extra = {}) {
  worker = await startWorkerProcess(env, {
    dbPath: path.join(temp.dir, 'genesis-store'), scope,
    credential: 'ki17-test-worker', workerToken: 'ki17-test-query',
    modelDir: env.KI17_MODEL_DIR, benchmarkFixture: fixture,
    ...extra,
  })
  env.MSP_PIPELINE_WORKER_URL = worker.url
  transport = mspTransport(env)
}

const ingest = (input, customTransport = transport) => ingestGenesisRag17Raw(input, { viewer, transport: customTransport, credential: 'ki17-test-source' })
const finish = (executionRunId) => finishKnowledgeIngestionRun({ dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID, executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID, executionRunId, scope: { tenantId: scope.tenantId, businessId: scope.businessId }, finishedAt: new Date().toISOString() }, { viewer })
const pull = (runId) => pullGenesisRag17Evidence({ schemaVersion: version, scope, runId }, { viewer, transport, credential: 'ki17-test-source' })
const query = (text, snapshotId) => transport('msp_pipeline_query', { schemaVersion: version, scope, credential: 'ki17-test-source', query: text, topK: 5, ...(snapshotId ? { snapshotId } : {}) })

async function verifyCitation(result) {
  const citation = result.citation
  const chunk = await prisma.knowledgeChunk.findUnique({ where: { id: citation.chunkId } })
  expect(chunk, 'retrieved citation must resolve to a durable chunk').toBeTruthy()
  expect(chunk.tenantId).toBe(scope.tenantId)
  expect(chunk.text).toBe(result.text)
  expect(chunk.contentHash).toBe(citation.contentHash)
  expect(sha256(chunk.text)).toBe(citation.contentHash)
  const parsed = await prisma.knowledgeParsedArtifact.findUnique({ where: { id: chunk.parsedArtifactId } })
  expect(parsed.id).toBe(citation.parsedArtifactId)
  const raw = await prisma.knowledgeRawArtifact.findUnique({ where: { id: parsed.rawArtifactId } })
  expect(raw.id).toBe(citation.rawArtifactId)
  expect(raw.sourceId).toBe(citation.sourceId)
  const canonicalRaw = await prisma.rawExternalRecord.findUnique({ where: { id: raw.rawExternalRecordId } })
  expect(canonicalRaw.tenantId).toBe(scope.tenantId)
  expect(canonicalRaw.artifactId).toBe(raw.id)
  expect(JSON.parse(canonicalRaw.payloadJson).content).toBe(raw.content)
  expect(raw.content.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text)
  return { factChunk: chunk.id, parsedArtifact: parsed.id, rawArtifact: raw.id, rawExternalRecord: canonicalRaw.id, source: raw.sourceId }
}

describe('GenesisRAG17 actual four-process acceptance (no skips)', () => {
  beforeAll(async () => {
    for (const key of ['KI17_MSP_ROOT', 'KI17_GKS_ROOT', 'KI17_GENESIS_ROOT', 'KI17_MODEL_DIR']) expect(process.env[key], `${key} is required`).toBeTruthy()
    temp = temporaryPipeline()
    const portfolio = await createPortfolio({ name: 'KI17 acceptance group', code: 'PF-KI17-ACCEPT' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'KI17 acceptance tenant', code: 'TNT-KI17-ACCEPT' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'KI17 acceptance business', code: 'BUS-KI17-ACCEPT' })
    scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' }
    viewer = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    const provider = await prisma.integrationProvider.create({ data: { code: 'KI17_TEST', name: 'Synthetic GenesisRAG17 source', status: 'ACTIVE' } })
    connection = await prisma.integrationConnection.create({ data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'Synthetic source only', authorizationType: 'NONE', status: 'ACTIVE' } })
    env = isolatedEnvironment(temp.dir, scope)
    await bootWorker()
  })

  afterAll(async () => {
    await worker?.close()
    temp?.cleanup()
  })

  it('starts from raw, preserves lost-reply identity, publishes all17 and resolves actual citations', async () => {
    let loseReply = true
    const lostReplyTransport = async (name, input) => {
      const result = await transport(name, input)
      if (name === 'msp_pipeline_submit' && loseReply) { loseReply = false; throw new Error('ACCEPTANCE_LOST_SUBMIT_REPLY') }
      return result
    }
    const deliveryError = await ingest(rawInput(), lostReplyTransport).then(() => null, (error) => error)
    if (deliveryError?.message !== 'ACCEPTANCE_LOST_SUBMIT_REPLY') throw deliveryError || new Error('Lost reply was not exercised')
    const received = await ingest(rawInput())
    firstRun = received.run.executionRunId
    expect(received.chunks.length).toBeGreaterThan(5)
    expect(received.mentions.filter((mention) => mention.name === 'Alice')).toHaveLength(2)
    expect(new Set(received.mentions.map((mention) => mention.sourceMentionId)).size).toBe(received.mentions.length)
    await expect(finish(firstRun)).rejects.toMatchObject({ status: 409 })
    const work = await worker.call('runOnce')
    expect(work.status, JSON.stringify(work)).toBe('published')
    firstSnapshot = work.snapshotId
    firstGeneration = work.generation
    expect(work.benchmark).toMatchObject({ queryCount: 5, citationCorrectness: 1, crossTenantLeaks: 0 })
    expect(work.benchmark.recallAt5).toBeGreaterThanOrEqual(0.8)
    expect(work.benchmark.mrr).toBeGreaterThanOrEqual(0.65)
    await pull(firstRun)
    expect((await finish(firstRun)).terminal).toBe('SUCCEEDED')
    const job = await readKnowledgeIngestionJob(firstRun, { viewer })
    expect(job.job.state).toBe('PUBLISHED')
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: firstRun } })
    const steps = await prisma.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })
    expect(steps.map((step) => step.pipelineStageId)).toEqual(KNOWLEDGE_INGESTION_STAGE_CATALOG.map((stage) => stage.pipelineStageId))
    expect(steps.every((step) => step.status === 'SUCCEEDED')).toBe(true)
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: firstRun }, orderBy: { stageNumber: 'asc' } })
    expect(evidence).toHaveLength(17)
    for (const row of evidence) for (const field of ['recordsIn', 'recordsOut', 'recordsQuarantined', 'errorCount', 'retryCount', 'durationMs']) expect(row[field]).toBeGreaterThanOrEqual(0)
    expect(evidence.filter((row) => row.stageNumber === 9)).toHaveLength(1)
    for (let index = 1; index < evidence.length; index++) expect(evidence[index].startedAt.valueOf(), `stage ${index + 1} starts after preceding stage`).toBeGreaterThanOrEqual(evidence[index - 1].finishedAt.valueOf())
    const chains = []
    for (const gold of fixture.queries) {
      const response = await query(gold.query)
      expect(response.snapshotId).toBe(firstSnapshot)
      expect(response.generation).toBe(firstGeneration)
      expect(response.results.some((row) => gold.relevantTexts.includes(row.text))).toBe(true)
      for (const row of response.results) chains.push(await verifyCitation(row))
    }
    // Read-only inspection of GKS's own immutable fact evidence, never a stage producer.
    const { DatabaseSync } = nativeRequire('node:sqlite')
    const gks = new DatabaseSync(path.join(temp.dir, 'gks.sqlite'), { readOnly: true })
    let decision
    try { decision = JSON.parse(gks.prepare('SELECT decision_json FROM pipeline_batches WHERE run_id = ?').get(firstRun).decision_json) } finally { gks.close() }
    expect(decision.facts).toHaveLength(8)
    const measured = new Map(evidence.map((row) => [row.stageNumber, row]))
    for (let stage = 1; stage <= 6; stage++) expect(measured.get(stage)).toMatchObject({ recordsIn: 1, recordsOut: 1 })
    expect(measured.get(7)).toMatchObject({ recordsIn: 1, recordsOut: received.chunks.length })
    expect(measured.get(8)).toMatchObject({ recordsIn: received.chunks.length, recordsOut: received.mentions.length })
    expect(measured.get(9)).toMatchObject({ recordsIn: received.mentions.length, recordsOut: decision.entities.length })
    expect(measured.get(10)).toMatchObject({ recordsOut: decision.facts.length })
    for (const stage of [11, 12]) expect(measured.get(stage)).toMatchObject({ recordsIn: decision.facts.length, recordsOut: decision.facts.length })
    expect(measured.get(15)).toMatchObject({ recordsIn: received.chunks.length, recordsOut: received.chunks.length })
    expect(measured.get(17)).toMatchObject({ recordsOut: 1 })
    for (const row of evidence) expect(row).toMatchObject({ errorCount: 0, recordsQuarantined: 0 })
    for (const fact of decision.facts) {
      const refs = fact.sourceReferences
      expect(await prisma.knowledgeChunk.findUnique({ where: { id: refs.chunkId } })).toBeTruthy()
      expect(refs.sourceMentionIds.length).toBeGreaterThan(0)
    }
    const reportDir = path.resolve('../../.brain/reports')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(path.join(reportDir, 'genesisrag17-repaired-native-chain.json'), JSON.stringify({ phase: 'raw-to-published-after-audit', schemaVersion: version, fixtureVersion: fixture.fixtureVersion, nodeVersion: process.version, runId: firstRun, snapshotId: firstSnapshot, generation: firstGeneration, benchmark: work.benchmark, evidence, chains, facts: decision.facts }, null, 2))
  })

  it('restarts the actual native process and keeps old snapshot citations after correction', async () => {
    expect(firstSnapshot).toBeTruthy()
    await worker.close()
    await prisma.$disconnect()
    await bootWorker()
    const before = await query(fixture.queries[0].query, firstSnapshot)
    expect(before.results.some((row) => row.text === fixture.queries[0].relevantTexts[0])).toBe(true)
    for (const result of before.results) await verifyCitation(result)
    await worker.close()
    await bootWorker({ benchmarkFixture: { fixtureVersion: 'ki17-corpus-v2', queries: fixture.correction.queries }, dropBeforeTool: 'msp_pipeline_publication_receipt' })
    const correction = await ingest(rawInput({ version: fixture.correction.sourceVersion, content: fixture.text.replace(...fixture.correction.replace) }))
    await expect(worker.call('runOnce')).rejects.toThrow('KI17_SIMULATED_UNDELIVERED_REQUEST')
    await pull(correction.run.executionRunId)
    await expect(finish(correction.run.executionRunId)).rejects.toThrow()
    await worker.close()
    await bootWorker({ benchmarkFixture: { fixtureVersion: 'ki17-corpus-v2', queries: fixture.correction.queries } })
    await worker.call('runOnce')
    await pull(correction.run.executionRunId)
    expect((await finish(correction.run.executionRunId)).terminal).toBe('SUCCEEDED')
    const after = await query(fixture.correction.queries[0].query)
    expect(after.snapshotId).not.toBe(firstSnapshot)
    expect(after.results.some((row) => row.text === fixture.correction.queries[0].relevantTexts[0])).toBe(true)
    const old = await query(fixture.queries[0].query, firstSnapshot)
    expect(old.snapshotId).toBe(firstSnapshot)
    expect(old.results.some((row) => row.text === fixture.queries[0].relevantTexts[0])).toBe(true)
    for (const row of [...after.results, ...old.results]) await verifyCitation(row)
  })

  it('rejects wrong scope and forged reporters', async () => {
    await expect(transport('msp_pipeline_query', { schemaVersion: version, scope: { ...scope, tenantId: 'foreign-tenant' }, credential: 'ki17-test-source', query: 'Alice', topK: 5 })).rejects.toThrow(/scope/)
    await expect(transport('msp_pipeline_publication_receipt', { schemaVersion: version, scope, credential: 'ki17-test-source', actor: 'worker', receipt: {} })).rejects.toThrow(/scope/)
    await expect(ingest(rawInput({ scope: { ...scope, portfolioId: 'foreign-portfolio' } }))).rejects.toThrow(/scope/)
  })

  it('blocks malformed attempt evidence without advancing the cursor, then resumes actual evidence', async () => {
    const run = await ingest(rawInput({ version: 'cursor-v3' }))
    const runId = run.run.executionRunId
    const corruptTransport = async (name, request) => {
      const page = await transport(name, request)
      if (name === 'msp_pipeline_evidence' && page.rows.length) page.rows[0].attemptId = 'old-or-foreign-attempt'
      return page
    }
    await expect(pullGenesisRag17Evidence({ schemaVersion: version, scope, runId }, { viewer, credential: 'ki17-test-source', transport: corruptTransport })).rejects.toThrow(/attempt/)
    expect(await prisma.genesisRag17EvidenceCursor.findFirst({ where: { runId } })).toBeNull()
    expect(await prisma.genesisRag17StageEvidence.count({ where: { executionRunId: runId, stageNumber: 9 } })).toBe(0)
    await pull(runId)
    expect(await prisma.genesisRag17StageEvidence.count({ where: { executionRunId: runId, stageNumber: 9 } })).toBe(1)
    await pull(runId)
    expect(await prisma.genesisRag17StageEvidence.count({ where: { executionRunId: runId, stageNumber: 9 } })).toBe(1)
    await worker.close()
    await bootWorker()
    const published = await worker.call('runOnce')
    expect(published.status, JSON.stringify(published)).toBe('published')
    await pull(runId)
    expect((await finish(runId)).terminal).toBe('SUCCEEDED')
  })

  it('records embedding policy denial as a failed actual stage and retains the published snapshot', async () => {
    const before = await query(fixture.queries[0].query)
    const run = await ingest(rawInput({ version: 'policy-v4', policy: { allowEmbedding: false, allowPublication: true } }))
    const result = await worker.call('runOnce').catch((error) => {
      const { DatabaseSync } = nativeRequire('node:sqlite')
      const gks = new DatabaseSync(path.join(temp.dir, 'gks.sqlite'), { readOnly: true })
      let rows
      try { rows = gks.prepare('SELECT stage_number, outcome, details_json FROM pipeline_evidence WHERE run_id = ? ORDER BY stage_number').all(run.run.executionRunId) } finally { gks.close() }
      throw new Error(`${error.message}; actual policy-run evidence: ${JSON.stringify(rows)}`)
    })
    expect(result.status).toBe('failed')
    await pull(run.run.executionRunId)
    expect((await finish(run.run.executionRunId)).terminal).toBe('FAILED')
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: run.run.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.find((row) => row.stageNumber === 15)?.outcome).toBe('FAILED')
    expect(evidence.filter((row) => row.stageNumber > 15)).toHaveLength(0)
    expect(await prisma.genesisRag17PublicationReceipt.count({ where: { executionRunId: run.run.executionRunId } })).toBe(0)
    expect((await query(fixture.queries[0].query)).snapshotId).toBe(before.snapshotId)
  })

  for (const { point, phase } of [
    { point: 'after-native-commit-before-receipt', phase: 'graph' },
    { point: 'after-native-commit-before-receipt', phase: 'final' },
    { point: 'after-graph-receipt-accepted-before-local-state' },
    { point: 'before-pointer-replacement' },
    { point: 'after-pointer-replacement-before-publication-outbox' },
  ]) {
    it(`recovers an actual process crash at ${point}${phase ? ` (${phase})` : ''} without losing historical citations`, async () => {
      const before = await query(fixture.queries[0].query)
      const run = await ingest(rawInput({ version: `crash-${point}-${phase || 'publication'}` }))
      await worker.close()
      await bootWorker({ crashAt: point, crashPhase: phase })
      await expect(worker.call('runOnce')).rejects.toThrow(/Worker exited 86/)
      await bootWorker()
      if (point === 'before-pointer-replacement') {
        const { DatabaseSync } = nativeRequire('node:sqlite')
        const gks = new DatabaseSync(path.join(temp.dir, 'gks.sqlite'), { readOnly: true })
        let candidate
        try { candidate = JSON.parse(gks.prepare('SELECT receipt_json FROM pipeline_receipts WHERE run_id = ?').get(run.run.executionRunId).receipt_json) } finally { gks.close() }
        await expect(query(fixture.queries[0].query, candidate.snapshotId)).rejects.toThrow()
      }
      const old = await query(fixture.queries[0].query, before.snapshotId)
      expect(old.snapshotId).toBe(before.snapshotId)
      for (const result of old.results) await verifyCitation(result)
      if (point !== 'after-pointer-replacement-before-publication-outbox') expect((await query(fixture.queries[0].query)).snapshotId).toBe(before.snapshotId)
      const recovered = await worker.call('runOnce')
      await pull(run.run.executionRunId)
      const failures = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: run.run.executionRunId, outcome: 'FAILED' } })
      expect((await finish(run.run.executionRunId)).terminal, JSON.stringify({ recovered, failures })).toBe('SUCCEEDED')
      const published = await query(fixture.queries[0].query)
      expect(published.snapshotId).not.toBe(before.snapshotId)
      for (const result of published.results) await verifyCitation(result)
    })
  }

  it('executes a real FR-071 replay with new attempts and refuses late evidence from the old run', async () => {
    const original = await prisma.genesisRag17Batch.findFirst({ where: { executionRunId: firstRun } })
    const batch = JSON.parse(original.requestJson)
    const replay = await requestPipelineReplay(firstRun, { scope: 'FULL_RUN', correlationId: 'ki17-actual-replay', idempotencyKey: 'ki17-actual-replay', sourceSha256: batch.source.contentHash, artifactSha256: batch.source.contentHash }, { viewer })
    const run = await ingest(rawInput({ replayRunId: replay.run.executionRunId }))
    expect(run.source.rawArtifactId).toBe(batch.source.rawArtifactId)
    expect(run.batch.stage9.attemptId).not.toBe(batch.stages[0].attemptId)
    const lateTransport = async (name, request) => {
      const page = await transport(name, name === 'msp_pipeline_evidence' ? { ...request, runId: firstRun } : request)
      if (name === 'msp_pipeline_evidence') for (const row of page.rows) row.runId = run.run.executionRunId
      return page
    }
    await expect(pullGenesisRag17Evidence({ schemaVersion: version, scope, runId: run.run.executionRunId }, { viewer, transport: lateTransport, credential: 'ki17-test-source' })).rejects.toThrow(/attempt/)
    expect(await prisma.genesisRag17EvidenceCursor.findFirst({ where: { runId: run.run.executionRunId } })).toBeNull()
    expect((await worker.call('runOnce')).status).toBe('published')
    await pull(run.run.executionRunId)
    expect((await finish(run.run.executionRunId)).terminal).toBe('SUCCEEDED')
    expect(await prisma.genesisRag17StageEvidence.count({ where: { executionRunId: firstRun, stageNumber: 9 } })).toBe(1)
    expect(await prisma.genesisRag17StageEvidence.count({ where: { executionRunId: run.run.executionRunId, stageNumber: 9 } })).toBe(1)
  })

  for (const tool of ['msp_pipeline_graph_receipt', 'msp_pipeline_write_receipt']) {
    it(`resends the identical ${tool} after an actual accepted reply is lost`, async () => {
      const run = await ingest(rawInput({ version: `reply-loss-${tool}` }))
      await worker.close()
      await bootWorker({ dropReplyTool: tool })
      await expect(worker.call('runOnce')).rejects.toThrow('KI17_SIMULATED_LOST_REPLY')
      await worker.close()
      await bootWorker()
      await worker.call('runOnce')
      await pull(run.run.executionRunId)
      expect((await finish(run.run.executionRunId)).terminal).toBe('SUCCEEDED')
      const rows = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: run.run.executionRunId } })
      expect(rows).toHaveLength(17)
      expect(new Set(rows.map((row) => `${row.pipelineStageId}/${row.attemptId}`)).size).toBe(17)
    })
  }

  it('runs source and native worker loops through automatic receipt-backed finish and stops both', async () => {
    const run = await ingest(rawInput({ version: 'worker-loops' }))
    const errors = []
    const sourceWorker = createGenesisRag17SourceWorker({ scope, runId: run.run.executionRunId, viewer, transport, credential: 'ki17-test-source', intervalMs: 250, onError: (error) => errors.push(error.message) })
    try {
      sourceWorker.start()
      await worker.call('start')
      const deadline = Date.now() + 25000
      let stored
      do {
        stored = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.run.executionRunId } })
        if (!['QUEUED', 'RUNNING'].includes(stored.status)) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      } while (Date.now() < deadline)
      expect(stored.status, JSON.stringify(errors)).toBe('SUCCEEDED')
    } finally {
      await worker.call('stop')
      await sourceWorker.stop()
    }
    expect((await readKnowledgeIngestionJob(run.run.executionRunId, { viewer })).job.state).toBe('PUBLISHED')
  })

  for (const fault of ['index', 'provenance', 'security']) {
    it(`refuses publication when the actual candidate reports ${fault} failure`, async () => {
      const before = await query(fixture.queries[0].query)
      const run = await ingest(rawInput({ version: `gate-failure-${fault}` }))
      await worker.close()
      await bootWorker({ corruptReceipt: fault })
      expect((await worker.call('runOnce')).status).toBe('held')
      await pull(run.run.executionRunId)
      const rows = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: run.run.executionRunId } })
      const gate = rows.find((row) => row.stageNumber === 17)
      expect(gate?.outcome).toBe('FAILED')
      expect(JSON.parse(gate.detailsJson).verdict.verdict).toBe('FAIL')
      expect(await prisma.genesisRag17PublicationReceipt.count({ where: { executionRunId: run.run.executionRunId } })).toBe(0)
      expect((await finish(run.run.executionRunId)).terminal).toBe('FAILED')
      expect((await query(fixture.queries[0].query)).snapshotId).toBe(before.snapshotId)
      await worker.close()
      await bootWorker()
    })
  }

  it('honors publication policy after real embedding and gate evaluation', async () => {
    const before = await query(fixture.queries[0].query)
    const run = await ingest(rawInput({ version: 'publication-denied', policy: { allowEmbedding: true, allowPublication: false } }))
    await worker.call('runOnce')
    await pull(run.run.executionRunId)
    expect(await prisma.genesisRag17PublicationReceipt.count({ where: { executionRunId: run.run.executionRunId } })).toBe(0)
    expect((await finish(run.run.executionRunId)).terminal).toBe('FAILED')
    expect((await query(fixture.queries[0].query)).snapshotId).toBe(before.snapshotId)
  })

  it('rolls back run creation when the source process dies before its durable intent', async () => {
    const previousRuns = (await prisma.pipelineRun.findMany({ select: { executionRunId: true }, orderBy: { executionRunId: 'asc' } }))
    const input = rawInput({ version: 'source-before-intent-crash' })
    await runSourceUntilCrash(env, input, 'after-run-created-before-intent')
    expect(await prisma.pipelineRun.findMany({ select: { executionRunId: true }, orderBy: { executionRunId: 'asc' } })).toEqual(previousRuns)
    expect(await prisma.genesisRag17IngestionIntent.count({ where: { version: input.version } })).toBe(0)
    const resumed = await ingest(input)
    expect((await worker.call('runOnce')).status).toBe('published')
    await pull(resumed.run.executionRunId)
    expect((await finish(resumed.run.executionRunId)).terminal).toBe('SUCCEEDED')
  })

  for (const stageNumber of [3, 8]) {
    it(`resumes the actual source process after Stage${stageNumber} without caller resubmission`, async () => {
      const previousRuns = new Set((await prisma.pipelineRun.findMany({ select: { executionRunId: true } })).map((run) => run.executionRunId))
      await runSourceUntilCrash(env, rawInput({ version: `source-crash-${stageNumber}` }), `after-local-stage-${stageNumber}`)
      const created = (await prisma.pipelineRun.findMany({ select: { executionRunId: true } })).filter((run) => !previousRuns.has(run.executionRunId))
      expect(created).toHaveLength(1)
      const runId = created[0].executionRunId
      expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: runId } })).toBe(0)
      const before = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: runId }, orderBy: { stageNumber: 'asc' } })
      expect(before).toHaveLength(stageNumber)
      const sourceWorker = createGenesisRag17SourceWorker({ scope, runId, viewer, transport, credential: 'ki17-test-source' })
      await sourceWorker.runOnce()
      expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: runId } })).toBe(1)
      expect((await worker.call('runOnce')).status).toBe('published')
      await sourceWorker.runOnce()
      expect((await readKnowledgeIngestionJob(runId, { viewer })).job.state).toBe('PUBLISHED')
      const after = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: runId }, orderBy: { stageNumber: 'asc' } })
      expect(after).toHaveLength(17)
      expect(after.slice(0, stageNumber)).toEqual(before)
      expect(new Set(after.map((row) => `${row.pipelineStageId}/${row.attemptId}`)).size).toBe(17)
    })
  }

  it('finishes a failed local source attempt without a Stage9 batch or invented downstream evidence', async () => {
    await expect(ingest(rawInput({ version: 'local-stage1-failure', connectionId: 'ki17-missing-connection' }))).rejects.toThrow()
    const intent = await prisma.genesisRag17IngestionIntent.findFirst({ where: { tenantId: scope.tenantId, version: 'local-stage1-failure' } })
    expect(intent?.status).toBe('FAILED')
    expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: intent.executionRunId } })).toBe(0)
    const sourceWorker = createGenesisRag17SourceWorker({ scope, runId: intent.executionRunId, viewer, transport, credential: 'ki17-test-source' })
    await sourceWorker.runOnce()
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: intent.executionRunId } })
    expect(run.status).toBe('FAILED')
    const rows = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: intent.executionRunId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ stageNumber: 1, outcome: 'FAILED', recordsIn: 1, recordsOut: 0, errorCount: 1 })
  })

  it('routes ambiguous, negated and invalid temporal raw text through actual source and GKS stages', async () => {
    const before = await query(fixture.queries[0].query)
    const clauses = [
      'Alice works for neither Acme Limited nor Beacon Limited.',
      'Alice works for Acme Limited and purchased Atlas.',
      'Atlas purchased Atlas.',
      'Alice purchased Atlas from 2026-09-08 to 2026-09-01.',
      'Alice purchased Atlas on 7 September 2026.',
    ]
    const content = fixture.text + clauses.map((text, index) => `\n\n# Audit ${index}\n${text}`).join('')
    const received = await ingest(rawInput({ version: 'audit-semantic-temporal', content }))
    const { DatabaseSync } = nativeRequire('node:sqlite')
    const gks = new DatabaseSync(path.join(temp.dir, 'gks.sqlite'), { readOnly: true })
    let decision
    try { decision = JSON.parse(gks.prepare('SELECT decision_json FROM pipeline_batches WHERE run_id = ?').get(received.run.executionRunId).decision_json) } finally { gks.close() }
    const byChunk = (text) => decision.chunks.find((chunk) => chunk.text.includes(text)).chunkId
    const names = new Map(decision.entities.map((entity) => [entity.id, entity.name]))
    expect(decision.facts.filter((fact) => fact.sourceReferences.chunkId === byChunk(clauses[0]))).toHaveLength(0)
    const compound = decision.facts.filter((fact) => fact.sourceReferences.chunkId === byChunk(clauses[1]))
    expect(compound).toHaveLength(2)
    // Canonical Acme Ltd. from the earlier fixture and source Acme Limited
    // intentionally resolve to the same organization identity.
    expect(compound.map((fact) => [names.get(fact.subjectId), fact.predicate, fact.predicate === 'WORKS_FOR' ? normalizeOrganizationName(names.get(fact.objectId)) : names.get(fact.objectId)])).toEqual(expect.arrayContaining([
      ['Alice', 'WORKS_FOR', normalizeOrganizationName('Acme Limited')], ['Alice', 'PURCHASED', 'Atlas'],
    ]))
    expect(decision.entities.some((entity) => entity.name === 'Acme Limited and')).toBe(false)
    expect(new Set(decision.entities.filter((entity) => entity.name === 'Atlas').map((entity) => entity.semanticType))).toEqual(new Set(['Person', 'Product']))
    const sameName = decision.facts.filter((fact) => fact.sourceReferences.chunkId === byChunk(clauses[2]))
    expect(sameName).toHaveLength(1)
    expect(sameName[0].subjectId).not.toBe(sameName[0].objectId)
    expect(decision.facts.filter((fact) => fact.sourceReferences.chunkId === byChunk(clauses[3]))).toHaveLength(0)
    expect(decision.held.some((item) => item.sourceReferences.chunkId === byChunk(clauses[3]) && item.reason === 'invalid_temporal_order')).toBe(true)
    const datedFacts = decision.facts.filter((fact) => fact.sourceReferences.chunkId === byChunk(clauses[4]))
    expect(datedFacts).toHaveLength(0)
    expect(decision.held.some((item) => item.sourceReferences.chunkId === byChunk(clauses[4]) && item.reason === 'temporal_unmapped')).toBe(true)
    expect((await worker.call('runOnce')).status).toBe('held')
    await pull(received.run.executionRunId)
    expect((await finish(received.run.executionRunId)).terminal).toBe('FAILED')
    const rows = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: received.run.executionRunId } })
    expect(rows.find((row) => row.stageNumber === 12)?.outcome).toBe('SUCCEEDED')
    expect(rows.find((row) => row.stageNumber === 17)?.outcome).toBe('FAILED')
    expect((await query(fixture.queries[0].query)).snapshotId).toBe(before.snapshotId)
  })

  it('isolates retrieval with two populated tenants, shared GKS and scope-owned native stores', async () => {
    const primary = { scope, env, viewer, connection }
    const primarySnapshot = (await query(fixture.queries[0].query)).snapshotId
    const secondaryFixture = JSON.parse(JSON.stringify(fixture).replaceAll('Alice', 'Zelda'))
    const tenant = await createTenant({ portfolioId: scope.portfolioId, name: 'KI17 second populated tenant', code: 'TNT-KI17-SECOND' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'KI17 second business', code: 'BUS-KI17-SECOND' })
    let foreignSnapshot, foreignChunks
    await worker.close()
    try {
      scope = { ...scope, tenantId: tenant.id, businessId: business.id }
      viewer = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
      connection = await prisma.integrationConnection.create({ data: { tenantId: tenant.id, businessId: business.id, providerId: primary.connection.providerId, name: 'Second synthetic source', authorizationType: 'NONE', status: 'ACTIVE' } })
      env = isolatedEnvironment(temp.dir, scope)
      await bootWorker({ benchmarkFixture: secondaryFixture, dbPath: path.join(temp.dir, 'genesis-store-secondary') })
      const received = await ingest(rawInput({ version: 'populated-second-tenant', content: secondaryFixture.text }))
      const result = await worker.call('runOnce')
      expect(result.status, JSON.stringify(result)).toBe('published')
      foreignSnapshot = result.snapshotId
      await pull(received.run.executionRunId)
      expect((await finish(received.run.executionRunId)).terminal).toBe('SUCCEEDED')
      const response = await query(secondaryFixture.queries[0].query)
      expect(response.results.length).toBeGreaterThan(0)
      for (const row of response.results) await verifyCitation(row)
      foreignChunks = new Set((await prisma.knowledgeChunk.findMany({ where: { tenantId: scope.tenantId } })).map((chunk) => chunk.id))
      await expect(query(fixture.queries[0].query, primarySnapshot)).rejects.toThrow()
    } finally {
      await worker.close()
      scope = primary.scope; env = primary.env; viewer = primary.viewer; connection = primary.connection
      await bootWorker()
    }
    const own = await query(secondaryFixture.queries[0].query)
    expect(own.results.length).toBeGreaterThan(0)
    expect(own.results.some((row) => foreignChunks.has(row.citation.chunkId))).toBe(false)
    expect(own.snapshotId).toBe(primarySnapshot)
    for (const row of own.results) await verifyCitation(row)
    await expect(query(secondaryFixture.queries[0].query, foreignSnapshot)).rejects.toThrow()
  })

  it('restores the isolated Tier 1 backup with immutable lineage and publication proof intact', async () => {
    const snapshot = await exportSnapshot()
    for (const model of ['knowledgeRawArtifact', 'knowledgeParsedArtifact', 'knowledgeChunk', 'genesisRag17IngestionIntent', 'genesisRag17SourceMention', 'genesisRag17Batch', 'genesisRag17StageEvidence', 'genesisRag17PublicationReceipt', 'genesisRag17EvidenceCursor']) expect(snapshot.tables[model].length).toBeGreaterThan(0)
    // This Prisma client is the per-run test database injected by globalSetup.
    expect((await importSnapshot(snapshot, { confirm: true, viewer })).restored).toBe(true)
    const old = await query(fixture.queries[0].query, firstSnapshot)
    for (const result of old.results) await verifyCitation(result)
    expect((await readKnowledgeIngestionJob(firstRun, { viewer })).job.state).toBe('PUBLISHED')
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { admitKnowledge } from '@/modules/knowledge/knowledge-admission-service'
import { createKnowledgeAdmissionRuntime } from '@/modules/knowledge/knowledge-runtime'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import { readKnowledgeIngestionJob } from '@/platform/integrations/core/knowledge-ingestion-executor'
import { KNOWLEDGE_INGESTION_STAGE_CATALOG } from '@/platform/integrations/core/pipeline-tracking-contract'
import { canonicalGenesisRag17Json } from '@/modules/knowledge/genesisrag17-contract'
import {
  SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_PROVIDER,
} from '@/modules/knowledge/smartgift-catalog-adapter'
import {
  GENESIS_RAG17_PARSER_VERSION_2,
  GENESIS_RAG17_STRUCTURED_RECOGNIZER_VERSION,
} from '@/modules/knowledge/genesisrag17-structured-record'
import { isolatedEnvironment, mspTransport, startWorkerProcess, temporaryPipeline } from './harness'

// @req FR-188 — the SmartGift catalog admitted through FR-187 is parsed by
// genesisrag17-parser-2 and genesisrag17-structured-recognizer-1, travels the
// real four processes (Tier 1 executor, MSP, GKS, GenesisBlock worker), reaches
// an ontology_v2 Stage 17 PASS with publication, and every retrieved citation
// resolves back through the durable Tier 1 lineage.
// @spec ADR-075, ADR-073, .brain/proposals/2026-09-11-genesisrag17-structured-record-profile.md
// @tested tests/acceptance/genesisrag17-smartgift.test.js

const corpus = JSON.parse(readFileSync(path.resolve('tests/fixtures/genesisrag17-smartgift-corpus-v1.json'), 'utf8'))
const nativeRequire = createRequire(path.resolve('package.json'))
const sha256 = (value) => createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex')
const version = 'genesisrag17.v1'
const THRESHOLDS = { recallAt5: 0.8, mrr: 0.65, citationCorrectness: 1, crossTenantLeaks: 0 }

let temp, scope, env, transport, worker, owner, operator, runtime
let corpusAsset, sourceIdByExternalId, allowedSourceId
const published = []

/**
 * The GenesisBlock worker benchmarks each candidate against one fixture, and a
 * generation holds exactly the chunks of the decision that produced it. FR-187
 * admits one immutable source per catalog record, so each record publishes its
 * own generation and needs its own fixture. This gate lets exactly one admitted
 * record reach Stage 1 at a time; it sequences the queue and changes nothing
 * about what the four processes then do with that record.
 */
function sequencedIngest(input, options) {
  if (allowedSourceId && input?.source?.sourceId !== allowedSourceId) {
    throw Object.assign(new Error('KI17_ACCEPTANCE_SEQUENCED'), { status: 503, retryable: true })
  }
  return ingestGenesisRag17Raw(input, options)
}

async function bootWorker(benchmarkFixture) {
  await worker?.close()
  worker = await startWorkerProcess(env, {
    dbPath: path.join(temp.dir, 'genesis-store'),
    scope,
    credential: 'ki17-test-worker',
    workerToken: 'ki17-test-query',
    modelDir: env.KI17_MODEL_DIR,
    benchmarkFixture,
  })
  env.MSP_PIPELINE_WORKER_URL = worker.url
  transport = mspTransport(env)
}

const query = (text, snapshotId) => transport('msp_pipeline_query', {
  schemaVersion: version, scope, credential: 'ki17-test-source', query: text, topK: 5,
  ...(snapshotId ? { snapshotId } : {}),
})

/** The observed evidence is written as it is produced, never only at the end. */
function writeReport(extra = {}) {
  const reportDir = path.resolve('../../.brain/reports')
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(path.join(reportDir, 'genesisrag17-smartgift-four-process.json'), `${JSON.stringify({
    phase: 'ADR-075 Phase 2 acceptance — SmartGift structured records (contract revision 2, C-8)',
    schemaVersion: version,
    fixtureVersion: corpus.fixtureVersion,
    nodeVersion: process.version,
    thresholds: THRESHOLDS,
    published,
    ...extra,
  }, null, 2)}\n`)
}

function readDecision(executionRunId) {
  const { DatabaseSync } = nativeRequire('node:sqlite')
  const gks = new DatabaseSync(path.join(temp.dir, 'gks.sqlite'), { readOnly: true })
  try {
    const row = gks.prepare('SELECT decision_json FROM pipeline_batches WHERE run_id = ?').get(executionRunId)
    return row ? JSON.parse(row.decision_json) : null
  } finally {
    gks.close()
  }
}

async function createCatalogAsset(text, name) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  return prisma.fileAsset.create({
    data: {
      code: `FA-KI17SG-${suffix}`,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      projectId: null,
      storageKind: 'MANAGED_BLOB',
      blobRef: `memory://${suffix}`,
      name,
      mime: SMARTGIFT_CATALOG_CONTENT_TYPE,
      size: Buffer.byteLength(text, 'utf8'),
      sha256: sha256(text),
      status: 'ACTIVE',
    },
  })
}

function admit(asset, text) {
  return admitKnowledge({
    businessId: scope.businessId,
    idempotencyKey: `ki17-smartgift-${randomUUID().slice(0, 8)}`,
    source: { kind: 'FILE', fileAssetId: asset.id, format: SMARTGIFT_CATALOG_FORMAT },
  }, { viewer: owner, env, fileContentResolver: async () => ({ content: Buffer.from(text, 'utf8') }) })
}

/** Mirrors the prose suite: a retrieved citation must resolve to durable Tier 1 rows. */
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
  expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION_2)
  const raw = await prisma.knowledgeRawArtifact.findUnique({ where: { id: parsed.rawArtifactId } })
  expect(raw.id).toBe(citation.rawArtifactId)
  expect(raw.sourceId).toBe(citation.sourceId)
  expect(raw.contentType).toBe(SMARTGIFT_CATALOG_CONTENT_TYPE)
  const canonicalRaw = await prisma.rawExternalRecord.findUnique({ where: { id: raw.rawExternalRecordId } })
  expect(canonicalRaw.tenantId).toBe(scope.tenantId)
  expect(canonicalRaw.artifactId).toBe(raw.id)
  expect(canonicalRaw.provider).toBe(SMARTGIFT_CATALOG_PROVIDER)
  expect(JSON.parse(canonicalRaw.payloadJson).content).toBe(raw.content)
  // Parser-2 renders the record, so the chunk is a substring of the parsed
  // content rather than of the raw record bytes.
  expect(parsed.content.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text)
  return { chunk: chunk.id, parsedArtifact: parsed.id, rawArtifact: raw.id, rawExternalRecord: canonicalRaw.id, source: raw.sourceId }
}

describe('SmartGift structured-record four-process acceptance (no skips)', () => {
  beforeAll(async () => {
    for (const key of ['KI17_MSP_ROOT', 'KI17_GKS_ROOT', 'KI17_GENESIS_ROOT', 'KI17_MODEL_DIR']) expect(process.env[key], `${key} is required`).toBeTruthy()
    temp = temporaryPipeline()
    const portfolio = await createPortfolio({ name: 'SmartGift acceptance group', code: 'PF-KI17-SG' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'SmartGift acceptance tenant', code: 'TNT-KI17-SG' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'SmartGift acceptance business', code: 'BUS-KI17-SG' })
    scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' }
    owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    operator = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    env = isolatedEnvironment(temp.dir, scope)
    // The admission runtime resolves its own binding, credential and MSP
    // transport from this environment; nothing ambient is read.
    env.ZURI_KNOWLEDGE_ENABLED = '1'
    env.ZURI_KNOWLEDGE_BINDINGS = JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }])
    env.ZURI_MSP_COMMAND = process.execPath
    env.ZURI_MSP_ARGS = JSON.stringify([path.join(env.KI17_MSP_ROOT, 'apps/msp-server/bin/msp-server.mjs')])
    env.ZURI_MSP_CWD = env.KI17_MSP_ROOT
    env.ZURI_MSP_TIMEOUT_MS = '120000'
    await bootWorker(corpus.benchmarks[0])
    runtime = createKnowledgeAdmissionRuntime({
      env,
      transport: (name, input) => transport(name, input),
      ingest: sequencedIngest,
      intervalMs: 1000,
    })
  })

  afterAll(async () => {
    await worker?.close()
    temp?.cleanup()
  })

  it('fans one SmartGift projection into immutable per-record FILE sources', async () => {
    const text = `${JSON.stringify(corpus.records, null, 2)}\n`
    corpusAsset = await createCatalogAsset(text, corpus.catalogFileName)
    const result = await admit(corpusAsset, text)
    expect(result).toMatchObject({
      format: SMARTGIFT_CATALOG_FORMAT,
      fileAssetId: corpusAsset.id,
      fileSha256: sha256(text),
      recordCount: corpus.records.length,
      admittedCount: corpus.records.length,
      deniedCount: 0,
    })
    const sources = await prisma.knowledgeSource.findMany({ where: { fileAssetId: corpusAsset.id } })
    expect(sources).toHaveLength(corpus.records.length)
    expect(sources.every((source) => source.kind === 'FILE' && source.fileAssetId === corpusAsset.id)).toBe(true)
    sourceIdByExternalId = new Map(sources.map((source) => [source.sourceKey.split('#').at(-1), source.id]))
    expect([...sourceIdByExternalId.keys()].sort()).toEqual(corpus.records.map((record) => record.externalId).sort())
    const ingestions = await prisma.knowledgeIngestion.findMany({ where: { sourceId: { in: sources.map((source) => source.id) } } })
    expect(ingestions).toHaveLength(corpus.records.length)
    expect(ingestions.every((row) => row.status === 'QUEUED' && row.executionRunId === null)).toBe(true)
    for (const row of ingestions) {
      expect(JSON.parse(row.sourceMetaJson).structured).toMatchObject({
        format: SMARTGIFT_CATALOG_FORMAT,
        provider: SMARTGIFT_CATALOG_PROVIDER,
        contentType: SMARTGIFT_CATALOG_CONTENT_TYPE,
      })
    }
  })

  for (const benchmark of corpus.benchmarks) {
    it(`publishes ${benchmark.externalId} through the actual four processes at ontology_v2 Stage 17 PASS`, async () => {
      expect(sourceIdByExternalId, 'admission must have run first').toBeTruthy()
      allowedSourceId = sourceIdByExternalId.get(benchmark.externalId)
      expect(allowedSourceId).toBeTruthy()
      await bootWorker(benchmark)

      // Pass 1 creates the durable run and delivers the Stage 9 batch.
      await runtime.runOnce()
      const ingestion = await prisma.knowledgeIngestion.findFirst({ where: { sourceId: allowedSourceId } })
      expect(ingestion.executionRunId, JSON.stringify({ failureCode: ingestion.failureCode })).toBeTruthy()
      const runId = ingestion.executionRunId

      const parsed = await prisma.knowledgeParsedArtifact.findUnique({ where: { id: ingestion.parsedArtifactId } })
      expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION_2)
      const sections = parsed.content.split('\n\n')
      expect(sections).toEqual(benchmark.expectedChunks.map((chunk) => chunk.text))
      const mentions = await prisma.genesisRag17SourceMention.findMany({ where: { executionRunId: runId } })
      expect(new Set(mentions.map((row) => row.recognizerVersion))).toEqual(new Set([GENESIS_RAG17_STRUCTURED_RECOGNIZER_VERSION]))

      // The actual Tier 4 process claims the batch, embeds natively and gates it.
      const work = await worker.call('runOnce')
      expect(work.status, JSON.stringify(work)).toBe('published')
      expect(work.benchmark.fixtureVersion, 'each record is benchmarked against its own fixture').toBe(benchmark.fixtureVersion)
      expect(work.benchmark.queryCount).toBe(benchmark.queries.length)
      expect(work.benchmark.recallAt5).toBeGreaterThanOrEqual(THRESHOLDS.recallAt5)
      expect(work.benchmark.mrr).toBeGreaterThanOrEqual(THRESHOLDS.mrr)
      expect(work.benchmark.citationCorrectness).toBe(THRESHOLDS.citationCorrectness)
      expect(work.benchmark.crossTenantLeaks).toBe(THRESHOLDS.crossTenantLeaks)

      // Pass 2 pulls the actual stage evidence and closes the run on its receipt.
      await runtime.runOnce()
      const closed = await prisma.knowledgeIngestion.findFirst({ where: { sourceId: allowedSourceId } })
      expect(closed.status, JSON.stringify({ failureCode: closed.failureCode })).toBe('PUBLISHED')
      expect((await readKnowledgeIngestionJob(runId, { viewer: operator })).job.state).toBe('PUBLISHED')

      const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: runId } })
      expect(run.status).toBe('SUCCEEDED')
      const steps = await prisma.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })
      expect(steps.map((step) => step.pipelineStageId)).toEqual(KNOWLEDGE_INGESTION_STAGE_CATALOG.map((stage) => stage.pipelineStageId))
      expect(steps.every((step) => step.status === 'SUCCEEDED')).toBe(true)
      const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: runId }, orderBy: { stageNumber: 'asc' } })
      expect(evidence).toHaveLength(17)
      expect(evidence.every((row) => row.outcome === 'SUCCEEDED' && row.errorCount === 0 && row.recordsQuarantined === 0)).toBe(true)
      expect(await prisma.genesisRag17PublicationReceipt.count({ where: { executionRunId: runId } })).toBe(1)

      // Tier 3's own immutable decision, read only as evidence.
      const decision = readDecision(runId)
      expect(decision.ontologyVersion).toBe(corpus.ontologyVersion)
      expect(decision.held).toEqual([])
      expect(decision.chunks.map((chunk) => chunk.text)).toEqual(benchmark.expectedChunks.map((chunk) => chunk.text))
      expect([...new Set(decision.facts.map((fact) => fact.predicate))].sort()).toEqual([...benchmark.expectedPredicates].sort())
      expect(decision.facts.every((fact) => fact.basis === 'structured')).toBe(true)
      published.push({
        externalId: benchmark.externalId,
        runId,
        snapshotId: work.snapshotId,
        generation: work.generation,
        benchmark: work.benchmark,
        ontologyVersion: decision.ontologyVersion,
        predicates: [...new Set(decision.facts.map((fact) => fact.predicate))],
        semanticTypes: [...new Set(decision.entities.map((entity) => entity.semanticType))],
      })
      writeReport()
      allowedSourceId = null
    })
  }

  it('carries every ontology_v2 predicate and semantic type the profile introduces', async () => {
    expect(published).toHaveLength(corpus.benchmarks.length)
    const predicates = new Set(published.flatMap((row) => row.predicates))
    const semanticTypes = new Set(published.flatMap((row) => row.semanticTypes))
    expect([...predicates].sort()).toEqual([...corpus.expectedPredicates].sort())
    expect([...semanticTypes].sort()).toEqual([...corpus.expectedSemanticTypes].sort())
    expect(new Set(published.map((row) => row.ontologyVersion))).toEqual(new Set(['ontology_v2']))
    expect(new Set(published.map((row) => row.snapshotId)).size).toBe(published.length)
  })

  it('answers a catalog query from the published snapshot with citations that resolve through Tier 1', async () => {
    const last = published.at(-1)
    const benchmark = corpus.benchmarks.at(-1)
    const chains = []
    for (const gold of benchmark.queries) {
      const response = await query(gold.query)
      expect(response.snapshotId).toBe(last.snapshotId)
      expect(response.generation).toBe(last.generation)
      expect(response.results.some((row) => gold.relevantTexts.includes(row.text))).toBe(true)
      for (const row of response.results) chains.push(await verifyCitation(row))
    }
    expect(chains.length).toBeGreaterThan(0)
    writeReport({ chains })
  })

  it('refuses a cross-tenant snapshot and a forged reporter on the SmartGift scope', async () => {
    await expect(transport('msp_pipeline_query', { schemaVersion: version, scope: { ...scope, tenantId: 'foreign-tenant' }, credential: 'ki17-test-source', query: 'PM-TMB', topK: 5 })).rejects.toThrow(/scope/)
    await expect(transport('msp_pipeline_publication_receipt', { schemaVersion: version, scope, credential: 'ki17-test-source', actor: 'worker', receipt: {} })).rejects.toThrow(/scope/)
  })

  // C-7: the deliberately unmappable record gets its own run so the passing
  // runs above can still publish. Its IN_CATEGORY relation names a category
  // whose norm_v1 key is the record's own code, which GKS resolves to one
  // entity and holds as `invalid_endpoint`. genesisrag17-parser-2 mirrors that
  // guard at Stage 2, so the real chain refuses it there: the documented
  // outcome is a terminal Stage 2 failure with no batch and no publication —
  // never a false PASS, and never a silently published record.
  it('ends the deliberately unmappable record as a documented no-publish without disturbing the published snapshot', async () => {
    const before = await query(corpus.benchmarks.at(-1).queries[0].query)
    const text = `${JSON.stringify([corpus.held.record], null, 2)}\n`
    const asset = await createCatalogAsset(text, corpus.heldCatalogFileName)
    const admitted = await admit(asset, text)
    // Admission accepts it: the record is a structurally valid, Zero-PII-clean
    // SmartGift projection. Only the relation it implies is unmappable.
    expect(admitted).toMatchObject({ recordCount: 1, admittedCount: 1, deniedCount: 0 })
    const source = await prisma.knowledgeSource.findFirst({ where: { fileAssetId: asset.id } })
    allowedSourceId = source.id

    await runtime.runOnce()
    allowedSourceId = null

    const job = await prisma.knowledgeIngestion.findFirst({ where: { sourceId: source.id } })
    expect(job.status).toBe('FAILED')
    expect(job.failureCode).toBe('KNOWLEDGE_INGESTION_REJECTED')
    const intent = await prisma.genesisRag17IngestionIntent.findFirst({ where: { sourceId: source.id } })
    expect(intent).toMatchObject({ status: 'FAILED', nextStageNumber: 2 })
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: intent.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.map((row) => [row.stageNumber, row.outcome])).toEqual([[1, 'SUCCEEDED'], [2, 'FAILED']])
    expect(JSON.parse(evidence.at(-1).detailsJson)).toMatchObject({ errorCode: corpus.held.expected.code })
    // No Stage 9 batch means Tier 3 never decided and Tier 4 never published.
    expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: intent.executionRunId } })).toBe(0)
    expect(await prisma.knowledgeChunk.count({ where: { documentId: intent.documentId } })).toBe(0)
    expect(await prisma.genesisRag17PublicationReceipt.count({ where: { executionRunId: intent.executionRunId } })).toBe(0)
    expect(readDecision(intent.executionRunId)).toBeNull()
    expect((await prisma.pipelineRun.findUnique({ where: { executionRunId: intent.executionRunId } })).status).toBe('FAILED')
    await expect(readKnowledgeIngestionJob(intent.executionRunId, { viewer: operator }).then((row) => row.job.state)).resolves.not.toBe('PUBLISHED')

    // The already published catalog snapshot is untouched by the refusal.
    const after = await query(corpus.benchmarks.at(-1).queries[0].query)
    expect(after.snapshotId).toBe(before.snapshotId)
    expect(after.generation).toBe(before.generation)
    for (const row of after.results) await verifyCitation(row)
  })

  it('refuses a caller-chosen parser profile for the same SmartGift record', async () => {
    const content = canonicalGenesisRag17Json(corpus.records[0])
    const connection = await prisma.integrationConnection.findFirst({ where: { businessId: scope.businessId, provider: { code: 'KNOWLEDGE_ADMISSION' } } })
    expect(connection).toBeTruthy()
    await expect(ingestGenesisRag17Raw({
      scope,
      sourceId: 'smartgift-catalog:acceptance#parser-config',
      documentId: 'doc-ki17-sg-parser-config',
      version: sha256(content),
      content,
      connectionId: connection.id,
      provider: SMARTGIFT_CATALOG_PROVIDER,
      entityType: corpus.records[0].entityType,
      contentType: SMARTGIFT_CATALOG_CONTENT_TYPE,
      parserVersion: 'genesisrag17-parser-1',
      policy: { allowEmbedding: true, allowPublication: true },
    }, { viewer: operator, transport, credential: 'ki17-test-source' })).rejects.toMatchObject({ code: 'GENESISRAG17_PARSER_CONFIG_UNSUPPORTED' })
  })
})

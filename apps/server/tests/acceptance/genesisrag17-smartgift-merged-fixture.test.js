import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { admitKnowledge } from '@/modules/knowledge/knowledge-admission-service'
import { createKnowledgeAdmissionRuntime } from '@/modules/knowledge/knowledge-runtime'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import { GENESIS_RAG17_PARSER_VERSION_2 } from '@/modules/knowledge/genesisrag17-structured-record'
import { SMARTGIFT_CATALOG_CONTENT_TYPE, SMARTGIFT_CATALOG_FORMAT } from '@/modules/knowledge/smartgift-catalog-adapter'
import { isolatedEnvironment, ki17NodeExecutable, mspTransport, startWorkerProcess, temporaryPipeline } from './harness'
import { deriveRealCorpus, checkCoverage } from '../../deploy/ki17/build-smartgift-real-corpus.mjs'
import { deriveSmartgiftBenchmark } from '../../deploy/ki17/build-smartgift-benchmark.mjs'

// @req FR-188 — the operator step in GENESISRAG17-EDGE-DEPLOYMENT.md §10.1
// (ADR-073 amendment 2026-09-24, remediation lanes B1/B2) merges a new catalog
// record onto the fixture the worker already boots with via `--base`, so the
// worker's own file stays the one cumulative multi-record shape production
// uses. Every existing acceptance test in this suite boots the worker with a
// SINGLE isolated benchmark entry per record — that never exercises the
// worker's own `scopedBenchmarkFixture` scoping logic across MULTIPLE
// co-resident records, which is exactly what production's real fixture file
// does every time it benchmarks one candidate. This test is that missing
// full-stack proof (board item B4, "the 'added' path... exercised in B4
// first"): a merged, multi-record fixture — 4 pre-existing benchmarks plus
// one genuinely new record added through `--base` — booted into the REAL
// native worker ONCE, with a NEW record admitted and published against it.
// @spec ADR-073, ADR-075, GENESISRAG17-EDGE-DEPLOYMENT.md §10.1
// @tested tests/acceptance/genesisrag17-smartgift-merged-fixture.test.js

const corpus = JSON.parse(readFileSync(path.resolve('tests/fixtures/genesisrag17-smartgift-corpus-v1.json'), 'utf8'))
const sha256 = (value) => createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex')
const version = 'genesisrag17.v1'
const THRESHOLDS = { recallAt5: 0.8, mrr: 0.65, citationCorrectness: 1, crossTenantLeaks: 0 }

// A record the fixture's own 4 existing benchmarks have never seen — a fifth
// SKU, same shape as the acceptance corpus's real ProductMaster rows, minimal
// fields the adapter requires plus enough that its rendered claims are
// non-trivial (category + a price tier).
const NEW_RECORD = {
  entityType: 'ProductMaster',
  externalId: 'PM-B4-MERGED-FIXTURE',
  code: 'PM-B4-MERGED-FIXTURE',
  nameTh: 'สินค้าใหม่สำหรับทดสอบ fixture รวม',
  nameEn: 'B4 merged-fixture acceptance product',
  category: 'eco-friendly',
  productFamily: 'PF-B4-ACCEPTANCE',
  priceTiersThb: [{ minQty: 1, unitPriceThb: 199 }],
  provenance: { upstreamFile: 'tests/acceptance/genesisrag17-smartgift-merged-fixture.test.js', upstreamRecordId: 'b4:PM-B4-MERGED-FIXTURE' },
}

describe('B4 — a new record publishes against a --base-merged, multi-record production fixture', () => {
  let temp, scope, env, transport, worker, owner
  let mergedFixture, corpusAsset, sourceId

  beforeAll(async () => {
    for (const key of ['KI17_MSP_ROOT', 'KI17_GKS_ROOT', 'KI17_GENESIS_ROOT', 'KI17_MODEL_DIR']) expect(process.env[key], `${key} is required`).toBeTruthy()

    // Build the merge exactly as an operator would under §10.1: write the one
    // new record to a catalog file, then --base-merge it onto the deployed
    // fixture (here, the 4-record acceptance corpus standing in for "what the
    // worker already boots with").
    const dir = mkdtempSync(path.join(tmpdir(), 'ki17-b4-merge-'))
    const catalogFile = path.join(dir, 'new-record.json')
    writeFileSync(catalogFile, JSON.stringify([NEW_RECORD]))
    const deployed = { fixtureVersion: corpus.fixtureVersion, benchmarks: corpus.benchmarks }
    const merged = deriveRealCorpus([catalogFile], { fixtureVersion: 'b4-merged-fixture-v1', base: deployed })
    // `unchanged` only lists records re-derived from THIS call's own input
    // files and found identical — the 4 pre-existing records were not passed
    // again here, so they are simply carried over untouched, not reported.
    expect(merged.merge).toMatchObject({ added: [NEW_RECORD.externalId], replaced: [], unchanged: [] })
    expect(merged.benchmarks.map((b) => b.externalId)).toEqual([...corpus.benchmarks.map((b) => b.externalId), NEW_RECORD.externalId])
    mergedFixture = deriveSmartgiftBenchmark(merged, { sourceFile: 'new-record.json', sourceSha256: sha256(JSON.stringify([NEW_RECORD])) })
    expect(mergedFixture.benchmarks).toHaveLength(corpus.benchmarks.length + 1)
    // Pre-upload check: exactly the operator step before an upload.
    const coverage = checkCoverage(mergedFixture, [catalogFile])
    expect(coverage.covered, JSON.stringify(coverage.records)).toBe(true)

    temp = temporaryPipeline()
    const portfolio = await createPortfolio({ name: 'B4 merged-fixture acceptance group', code: 'PF-KI17-B4M' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'B4 merged-fixture tenant', code: 'TNT-KI17-B4M' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'B4 merged-fixture business', code: 'BUS-KI17-B4M' })
    scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' }
    owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    env = isolatedEnvironment(temp.dir, scope)
    env.ZURI_KNOWLEDGE_ENABLED = '1'
    env.ZURI_KNOWLEDGE_BINDINGS = JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }])
    // The admission runtime spawns MSP itself; MSP is a ki17 child, not Tier 1.
    env.ZURI_MSP_COMMAND = ki17NodeExecutable(env)
    env.ZURI_MSP_ARGS = JSON.stringify([path.join(env.KI17_MSP_ROOT, 'apps/msp-server/bin/msp-server.mjs')])
    env.ZURI_MSP_CWD = env.KI17_MSP_ROOT
    env.ZURI_MSP_TIMEOUT_MS = '120000'

    // The worker boots ONCE with the full merged, multi-record fixture — not a
    // single isolated benchmark, which is what every other test in this suite
    // uses. This is the one difference that actually exercises production's
    // own scoping path (`scopedBenchmarkFixture`, worker.mjs).
    worker = await startWorkerProcess(env, {
      dbPath: path.join(temp.dir, 'genesis-store'), scope,
      credential: 'ki17-test-worker', workerToken: 'ki17-test-query',
      modelDir: env.KI17_MODEL_DIR, benchmarkFixture: mergedFixture,
    })
    env.MSP_PIPELINE_WORKER_URL = worker.url
    transport = mspTransport(env)
  })

  afterAll(async () => {
    await worker?.close()
    temp?.cleanup()
  })

  it('admits the one new record as a FILE SmartGift source', async () => {
    const text = `${JSON.stringify([NEW_RECORD], null, 2)}\n`
    corpusAsset = await prisma.fileAsset.create({ data: {
      code: `FA-KI17B4M-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      tenantId: scope.tenantId, businessId: scope.businessId, projectId: null,
      storageKind: 'MANAGED_BLOB', blobRef: `memory://${randomUUID()}`,
      name: 'new-record.json', mime: SMARTGIFT_CATALOG_CONTENT_TYPE,
      size: Buffer.byteLength(text, 'utf8'), sha256: sha256(text), status: 'ACTIVE',
    } })
    const result = await admitKnowledge({
      businessId: scope.businessId, idempotencyKey: `ki17-b4-merge-${randomUUID().slice(0, 8)}`,
      source: { kind: 'FILE', fileAssetId: corpusAsset.id, format: SMARTGIFT_CATALOG_FORMAT },
    }, { viewer: owner, env, fileContentResolver: async () => ({ content: Buffer.from(text, 'utf8') }) })
    expect(result).toMatchObject({ recordCount: 1, admittedCount: 1, deniedCount: 0 })
    const source = await prisma.knowledgeSource.findFirst({ where: { fileAssetId: corpusAsset.id } })
    expect(source.sourceKey.split('#').at(-1)).toBe(NEW_RECORD.externalId)
    sourceId = source.id
  })

  it('publishes the new record through the real four processes, scoped correctly out of the other 4 co-resident benchmarks', async () => {
    expect(sourceId, 'admission must have run first').toBeTruthy()
    const runtime = createKnowledgeAdmissionRuntime({ env, transport: (name, input) => transport(name, input), ingest: ingestGenesisRag17Raw, intervalMs: 1000 })

    await runtime.runOnce()
    const ingestion = await prisma.knowledgeIngestion.findFirst({ where: { sourceId } })
    expect(ingestion.executionRunId, JSON.stringify({ failureCode: ingestion.failureCode })).toBeTruthy()
    const runId = ingestion.executionRunId

    const parsed = await prisma.knowledgeParsedArtifact.findUnique({ where: { id: ingestion.parsedArtifactId } })
    expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION_2)

    // The actual Tier 4 process claims the batch, embeds natively, and gates
    // it against ALL 5 benchmarks in the merged fixture — proving the worker
    // finds and scores only the new record's own queries among them, exactly
    // as `scopedBenchmarkFixture` is supposed to.
    const work = await worker.call('runOnce')
    expect(work.status, JSON.stringify(work)).toBe('published')
    expect(work.benchmark.fixtureVersion).toBe(`b4-merged-fixture-v1:${NEW_RECORD.externalId}`)
    expect(work.benchmark.recallAt5).toBeGreaterThanOrEqual(THRESHOLDS.recallAt5)
    expect(work.benchmark.mrr).toBeGreaterThanOrEqual(THRESHOLDS.mrr)
    expect(work.benchmark.citationCorrectness).toBe(THRESHOLDS.citationCorrectness)
    expect(work.benchmark.crossTenantLeaks).toBe(THRESHOLDS.crossTenantLeaks)

    await runtime.runOnce()
    const closed = await prisma.knowledgeIngestion.findFirst({ where: { sourceId } })
    expect(closed.status, JSON.stringify({ failureCode: closed.failureCode })).toBe('PUBLISHED')

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: runId } })
    expect(run.status).toBe('SUCCEEDED')
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: runId } })
    expect(evidence).toHaveLength(17)
    expect(evidence.every((row) => row.outcome === 'SUCCEEDED' && row.errorCount === 0)).toBe(true)
    expect(await prisma.genesisRag17PublicationReceipt.count({ where: { executionRunId: runId } })).toBe(1)

    // The record's own gold query resolves through the real Tier 1 lineage,
    // scoped to THIS record's own snapshot — not one of the other 4.
    const answer = await transport('msp_pipeline_query', {
      schemaVersion: version, scope, credential: 'ki17-test-source',
      query: mergedFixture.benchmarks.find((b) => b.externalId === NEW_RECORD.externalId).queries[0].query,
      topK: 5, snapshotId: work.snapshotId,
    })
    expect(answer.results.length).toBeGreaterThan(0)
    const citation = answer.results[0].citation
    const chunk = await prisma.knowledgeChunk.findUnique({ where: { id: citation.chunkId } })
    expect(chunk.tenantId).toBe(scope.tenantId)
    expect(chunk.text).toBe(answer.results[0].text)

    mkdirSync(path.resolve('../../.brain/reports'), { recursive: true })
    writeFileSync(path.resolve('../../.brain/reports/genesisrag17-b4-merged-fixture.json'), `${JSON.stringify({
      phase: 'B4 remediation — added-path full-stack proof (ADR-073 amendment 2026-09-24, EDGE-DEPLOYMENT §10.1)',
      schemaVersion: version,
      mergedFixtureVersion: mergedFixture.fixtureVersion,
      recordCount: mergedFixture.benchmarks.length,
      newRecordExternalId: NEW_RECORD.externalId,
      thresholds: THRESHOLDS,
      published: { runId, snapshotId: work.snapshotId, generation: work.generation, benchmark: work.benchmark },
    }, null, 2)}\n`)
  })
})

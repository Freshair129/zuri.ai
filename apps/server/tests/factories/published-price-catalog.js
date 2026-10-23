import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createCorpusKnowledgeReader } from '@/modules/knowledge/corpus-knowledge-reader'
import { createKnowledgeRepository } from '@/modules/knowledge/knowledge-repository'
import { createKnowledgeExecutionAuthority } from '@/modules/knowledge/knowledge-execution-authority'
import { publishVerifiedKnowledgeIngestion } from '@/modules/knowledge/knowledge-corpus-service'
import { GENESIS_RAG17_SCHEMA_VERSION, stageIdForNumber } from '@/modules/knowledge/genesisrag17-contract'
import { createPricingRuleSet, applyPricingRuleAction, getActivePricingRuleSet } from '@/modules/commerce/application/pricing-rules-service'
import { admitPricingCatalog } from '@/modules/commerce/application/pricing-catalog-service'
import { defaultPricingRules } from '@/modules/commerce/domain/pricing-engine'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { KNOWLEDGE_INGESTION_CONTRACT_ID, KNOWLEDGE_INGESTION_DEFINITION_ID } from '@/platform/integrations/core/pipeline-tracking-contract'

// Test-only fixture: real FR-253 admission and Knowledge receipt publication;
// only the object-storage and external publication-receipt ports are controlled.
// @req FR-291 — provides an actual published source for exact LINE price-read tests.
// @spec ADR-075, ADR-098, ADR-090
// @tested tests/integration/line-published-price-reader.test.js

function token() {
  return randomUUID().replaceAll('-', '').slice(0, 16)
}

function knowledgeScope({ portfolioId, tenantId, businessId }) {
  return {
    portfolioId,
    tenantId,
    businessId,
    workspaceId: `workspace-${businessId}`,
    agentId: 'line-price-publication-test',
    visibility: 'private',
  }
}

function receiptFor(ingestion, scope, decisionId) {
  return {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    scope,
    runId: ingestion.executionRunId,
    decisionId,
    decisionHash: 'a'.repeat(64),
    snapshotId: ingestion.snapshotId,
    generation: ingestion.snapshotGeneration,
    receiptHash: ingestion.receiptHash,
    publishedAt: new Date().toISOString(),
    pointerHash: 'c'.repeat(64),
    modelRevision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
    transactionFrontier: `frontier-${ingestion.id}`,
    readback: { ok: true },
  }
}

function requestFor(ingestion, source, scope, stage9StepId, stage9AttemptId) {
  return {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    runId: ingestion.executionRunId,
    scope,
    stages: [{
      runId: ingestion.executionRunId,
      pipelineStageId: stageIdForNumber(9),
      executionStepId: stage9StepId,
      attemptId: stage9AttemptId,
      stageNumber: 9,
    }],
    source: {
      sourceId: source.id,
      rawArtifactId: ingestion.rawArtifactId,
      parsedArtifactId: ingestion.parsedArtifactId,
      documentId: source.id,
      version: ingestion.sourceVersion,
      contentHash: ingestion.contentHash,
    },
  }
}

function repositoryWithReceipts(db, receipts) {
  const wrap = (delegate) => ({
    ...delegate,
    verifyPublication: async (executionRunId) => receipts.get(executionRunId) || null,
    transaction: (callback, options) => delegate.transaction((tx) => callback(wrap(tx)), options),
  })
  return wrap(createKnowledgeRepository(db))
}

function memoryStorage() {
  const blobs = new Map()
  return {
    blobs,
    objectStoragePort: {
      async put({ key, content }) {
        const ref = `memory://line-published-price/${key}`
        blobs.set(ref, Buffer.from(content))
        return { ref }
      },
      async get({ ref }) {
        if (!blobs.has(ref)) throw new Error('test blob not found')
        return Buffer.from(blobs.get(ref))
      },
      async remove({ ref }) { blobs.delete(ref) },
    },
  }
}

/**
 * Build a real exact-price source for an existing isolated test Business and
 * Product. `quantity` must be a supported corporate pricing tier. The helper
 * returns a production Knowledge reader factory that accepts the resolver's
 * transaction client, so a caller can prove the default source path at send.
 */
export async function createPublishedPriceCatalogFixture({
  business,
  product,
  viewer,
  quantity = 100,
  quantities = [quantity],
  publicationExternalId,
  publishImmediately = true,
  db = prisma,
  now = new Date(),
  environment = process.env,
  objectStoragePort: suppliedStorage,
} = {}) {
  if (!business?.id || !business?.tenantId || !product?.id || product.businessId !== business.id || !viewer) {
    throw new Error('PUBLISHED_PRICE_FIXTURE_SCOPE_REQUIRED')
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !quantities.includes(quantity)) {
    throw new Error('PUBLISHED_PRICE_FIXTURE_QUANTITY_INVALID')
  }
  const tenant = await db.tenant.findUnique({ where: { id: business.tenantId }, select: { portfolioId: true } })
  if (!tenant?.portfolioId || product.tenantId !== business.tenantId) throw new Error('PUBLISHED_PRICE_FIXTURE_SCOPE_INVALID')
  const scope = knowledgeScope({ portfolioId: tenant.portfolioId, tenantId: business.tenantId, businessId: business.id })
  const suffix = token()
  const env = {
    ...environment,
    ZURI_KNOWLEDGE_ENABLED: '1',
    ZURI_KNOWLEDGE_BINDINGS: JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }]),
    MSP_PIPELINE_PRINCIPALS: JSON.stringify([{ role: 'source', credential: `fixture-${suffix}`, scope }]),
    ZURI_MSP_COMMAND: process.execPath,
  }
  const storage = suppliedStorage ? { objectStoragePort: suppliedStorage, blobs: null } : memoryStorage()
  let currentRule
  try {
    currentRule = await getActivePricingRuleSet(business.id, { db, viewer, now })
  } catch (error) {
    if (error?.message !== 'PRICING_RULE_NOT_ACTIVE') throw error
    const draft = await createPricingRuleSet({ businessId: business.id, name: `LINE published price fixture ${suffix}`, rules: defaultPricingRules() }, { viewer, db, now })
    currentRule = await applyPricingRuleAction(draft.id, {
      businessId: business.id, version: draft.version, action: 'APPROVE',
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), reason: 'LINE published price test fixture',
    }, { viewer, db, now })
  }
  const receiptMovements = await db.stockMovement.findMany({
    where: { tenantId: business.tenantId, businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: { gt: 0 } },
    select: { id: true, costSatang: true },
  })
  if (receiptMovements.some((movement) => !Number.isSafeInteger(movement.costSatang) || movement.costSatang < 0)) {
    throw new Error('PUBLISHED_PRICE_FIXTURE_LEDGER_COST_INVALID')
  }
  if (!receiptMovements.length) {
    await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 1000, costSatang: 10000 }, { viewer, db, now })
  }

  const pricingInput = {
    businessId: business.id,
    productId: product.id,
    expectedRuleSetId: currentRule.id,
    expectedRuleVersion: currentRule.version,
    quantities: [...new Set(quantities)].sort((a, b) => a - b),
    reason: 'LINE exact published-price fixture',
    idempotencyKey: `line-price-${suffix}`,
  }
  const preview = await admitPricingCatalog({ ...pricingInput, previewOnly: true }, {
    viewer, db, now, env, objectStoragePort: storage.objectStoragePort,
  })
  const admission = await admitPricingCatalog({ ...pricingInput, previewHash: preview.previewHash }, {
    viewer, db, now, env, objectStoragePort: storage.objectStoragePort,
  })
  if (admission.publicationStatus !== 'NOT_VERIFIED') throw new Error('PUBLISHED_PRICE_FIXTURE_ADMISSION_STATE_INVALID')

  // Select which record in the same immutable PCAT file this fixture publishes.
  // Existing callers retain the exact-price default; the TEST ONLY RAG delivery
  // case can publish its sibling ProductMaster through this same receipt-backed path.
  const expectedExternalId = publicationExternalId ?? `commerce-price:${product.id}:${quantity}`
  let item = null
  for (const candidateItem of admission.admission.items) {
    const candidate = await db.knowledgeIngestion.findUnique({ where: { id: candidateItem.id } })
    if (JSON.parse(candidate.sourceMetaJson).structured?.externalId === expectedExternalId) {
      item = candidateItem
      break
    }
  }
  if (!item) throw new Error('PUBLISHED_PRICE_FIXTURE_ITEM_NOT_FOUND')
  let ingestion = await db.knowledgeIngestion.findUnique({ where: { id: item.id } })
  const source = await db.knowledgeSource.findUnique({ where: { id: item.source.id } })
  const executionRunId = `line-price-execution-${suffix}`
  const rawArtifactId = `line-price-raw-${suffix}`
  const parsedArtifactId = `line-price-parsed-${suffix}`
  const snapshotId = `line-price-snapshot-${suffix}`
  const snapshotGeneration = `line-price-generation-${suffix}`
  const receiptHash = 'd'.repeat(64)
  ingestion = await db.knowledgeIngestion.update({ where: { id: ingestion.id }, data: {
    executionRunId, rawArtifactId, parsedArtifactId, snapshotId, snapshotGeneration, receiptHash, attempts: 1,
  } })
  const run = await db.pipelineRun.create({ data: {
    id: `pipeline-${suffix}`, executionRunId,
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    tenantId: business.tenantId, businessId: business.id, status: 'SUCCEEDED',
    sourceSha256: ingestion.contentHash, artifactRef: rawArtifactId,
    correlationId: `correlation-${suffix}`, idempotencyKey: `pipeline-idempotency-${suffix}`,
    requestHash: ingestion.requestHash,
  } })
  const stage9StepId = `stage9-step-${suffix}`
  const stage9AttemptId = `stage9-attempt-${suffix}`
  const request = requestFor(ingestion, source, scope, stage9StepId, stage9AttemptId)
  const decisionId = `decision-${suffix}`
  await db.genesisRag17IngestionIntent.create({ data: {
    id: `intent-${suffix}`, intentKey: `intent-key-${suffix}`, runId: run.id, executionRunId,
    scopeJson: JSON.stringify(scope), requestJson: JSON.stringify(request), derivationJson: '{}',
    rawArtifactId, sourceId: source.id, documentId: source.id,
    version: ingestion.sourceVersion, contentHash: ingestion.contentHash,
    portfolioId: scope.portfolioId, tenantId: scope.tenantId, businessId: scope.businessId,
    workspaceId: scope.workspaceId, agentId: scope.agentId, visibility: scope.visibility,
    status: 'SUCCEEDED', nextStageNumber: 10,
  } })
  await db.genesisRag17Batch.create({ data: {
    id: `batch-${suffix}`, batchId: `batch-key-${suffix}`, idempotencyKey: `batch-idempotency-${suffix}`,
    runId: run.id, executionRunId, stage9StepId, stage9AttemptId,
    scopeJson: JSON.stringify(scope), requestJson: JSON.stringify(request), status: 'SUCCEEDED',
    decisionId, responseJson: JSON.stringify({ decisionId }),
  } })
  const receipts = new Map([[executionRunId, receiptFor(ingestion, scope, decisionId)]])
  let published = null
  let publishing = null
  const publish = async () => {
    if (published) return published
    if (!publishing) {
      publishing = publishVerifiedKnowledgeIngestion(ingestion.id, {
        repository: repositoryWithReceipts(db, receipts),
        db,
        authority: createKnowledgeExecutionAuthority(scope, 'execute', executionRunId),
      }).then((result) => {
        if (result.status !== 'PUBLISHED') throw new Error('PUBLISHED_PRICE_FIXTURE_RECEIPT_NOT_PUBLISHED')
        published = result
        return result
      }).finally(() => { publishing = null })
    }
    return publishing
  }
  if (publishImmediately) await publish()

  const knowledgeReaderFactory = ({ tenantId, businessId, db: scopedDb } = {}) => {
    if (tenantId !== business.tenantId || businessId !== business.id) throw new Error('PUBLISHED_PRICE_FIXTURE_SCOPE_MISMATCH')
    return createCorpusKnowledgeReader({
      tenantId,
      businessId,
      db: scopedDb || db,
      env,
      objectStoragePort: storage.objectStoragePort,
    })
  }
  const knowledgeReader = knowledgeReaderFactory({ tenantId: business.tenantId, businessId: business.id, db })
  const expectedUnitAmountMinor = preview.prices.find((price) => price.quantity === quantity)?.unitPriceSatang
  if (!Number.isSafeInteger(expectedUnitAmountMinor)) throw new Error('PUBLISHED_PRICE_FIXTURE_EXPECTED_PRICE_MISSING')
  const calculations = await db.pricingCalculation.findMany({ where: { id: { in: admission.calculationIds } } })
  const calculationIdsByQuantity = Object.fromEntries(calculations.map((calculation) => {
    const input = JSON.parse(calculation.inputJson)
    return [input.quantity, calculation.id]
  }))
  const asset = await db.fileAsset.findUnique({ where: { id: admission.fileAssetId } })

  return {
    scope,
    env,
    storage: storage.objectStoragePort,
    blobs: storage.blobs,
    reader: knowledgeReader,
    knowledgeReaderFactory,
    publish,
    admission,
    published,
    quantity,
    expectedUnitAmountMinor,
    fileAssetId: admission.fileAssetId,
    fileAssetCode: asset?.code,
    fileAsset: asset,
    calculationIds: admission.calculationIds,
    calculationIdsByQuantity,
    product,
    sourceId: source.id,
    ingestionId: ingestion.id,
    executionRunId,
    currentRuleSetId: currentRule.id,
  }
}

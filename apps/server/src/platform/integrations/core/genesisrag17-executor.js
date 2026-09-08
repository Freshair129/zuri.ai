import { hasKnowledgeScopeAuthority } from '@/modules/knowledge/knowledge-execution-authority'
import { isDeepStrictEqual } from 'node:util'
import prisma from '@/lib/db'
import { createMspTransportFromEnvironment } from '@/modules/agent/msp-stdio-transport'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import { ingestRawExternalRecord } from './raw-ingest-service'
import { createPrismaRawRecordRepository } from './raw-record-repository'
import { buildSourceProvenance } from '@/modules/knowledge/provenance'
import { normalizeValue } from '@/modules/knowledge/normalization'
import { classifyAgainst } from '@/modules/knowledge/dedup'
import { createGenesisRag17LineageRepository } from '@/modules/knowledge/genesisrag17-lineage-repository'
import {
  IDENTITY_REFS_EMPTY,
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
} from './pipeline-tracking-contract'
import { createPipelineRun, recordPipelineEvent } from './pipeline-tracking-service'
import {
  assertGenesisRag17BatchIntegrity,
  buildGenesisRag17StageIdentities,
  GENESIS_RAG17_PIPELINE_TOOLS,
  GENESIS_RAG17_PIPELINE_VERSION,
  GENESIS_RAG17_SCHEMA_VERSION,
  hashGenesisRag17Json,
  hashGenesisRag17Text,
  parseGenesisRag17Scope,
  stageNumberForId,
} from '@/modules/knowledge/genesisrag17-contract'
import {
  extractGenesisRag17Mentions,
  GENESIS_RAG17_CHUNKER_VERSION,
  GENESIS_RAG17_DEFAULT_MAX_TOKENS,
  GENESIS_RAG17_PARSER_VERSION,
  GENESIS_RAG17_RECOGNIZER_PROVENANCE,
  GENESIS_RAG17_RECOGNIZER_VERSION,
  genesisRag17ParserIdentity,
  parseGenesisRag17Document,
  parsedArtifactContentHash,
} from '@/modules/knowledge/genesisrag17-source'

// @req FR-172 — only the exact admitted knowledge run accepts private runtime authority.
// @req FR-109 — one real raw entry produces one document/run, immutable raw
// -> parsed -> chunk lineage, exact Stage 1 evidence and one Stage 9 batch per
// materialized attempt.
// @req FR-110 — external evidence remains bounded and a successful close is
// receipt-backed; Tier 1 never writes a GKS or GenesisBlockDB store.
// @spec ADR-050, ADR-063, ADR-067, ADR-068, NFR-020, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/integration/genesisrag17-tier1.test.js

const RAW_SOURCE_TYPE = 'TEXT'
const RAW_CONTENT_TYPE = 'text/plain'

function serviceError(status, message, code = null) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

function atDate(now) {
  const value = typeof now === 'function' ? now() : now || new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) throw new Error('GenesisRAG17 now must resolve to a valid Date')
  return date
}

function json(value) {
  return JSON.stringify(value)
}

function scopeJson(scope) {
  return json(scope)
}

function inputValue(input) {
  const source = input?.source || input
  const content = source?.content ?? source?.text
  const sourceId = source?.sourceId ?? source?.source_id
  const documentId = source?.documentId ?? source?.document_id
  const version = source?.version ?? source?.sourceVersion ?? source?.source_version
  const scope = parseGenesisRag17Scope(input?.scope || source?.scope)
  if (!sourceId || !documentId || !version || typeof content !== 'string' || !content.length) {
    throw serviceError(400, 'GenesisRAG17 raw entry requires sourceId, documentId, version and text content', 'GENESISRAG17_RAW_INPUT_INVALID')
  }
  const contentHash = hashGenesisRag17Text(content)
  if (source?.contentHash && source.contentHash !== contentHash) {
    throw serviceError(400, 'GenesisRAG17 source contentHash does not match exact UTF-8 content', 'GENESISRAG17_CONTENT_HASH_MISMATCH')
  }
  const policy = input?.policy || source?.policy
  if (!policy || typeof policy.allowEmbedding !== 'boolean' || typeof policy.allowPublication !== 'boolean') {
    throw serviceError(400, 'GenesisRAG17 raw entry requires explicit allowEmbedding and allowPublication policy', 'GENESISRAG17_POLICY_REQUIRED')
  }
  const recognizerVersionValues = [input?.recognizerVersion, input?.recognizer_version, source?.recognizerVersion, source?.recognizer_version]
    .filter((value) => value !== undefined)
  const recognizerProvenanceValues = [input?.recognizerProvenance, input?.recognizer_provenance, source?.recognizerProvenance, source?.recognizer_provenance]
    .filter((value) => value !== undefined)
  if (new Set(recognizerVersionValues).size > 1 || recognizerVersionValues.some((value) => value !== GENESIS_RAG17_RECOGNIZER_VERSION)) {
    throw serviceError(400, 'GenesisRAG17 recognizer version is unsupported or inconsistent', 'GENESISRAG17_RECOGNIZER_CONFIG_UNSUPPORTED')
  }
  if (new Set(recognizerProvenanceValues).size > 1 || recognizerProvenanceValues.some((value) => value !== GENESIS_RAG17_RECOGNIZER_PROVENANCE)) {
    throw serviceError(400, 'GenesisRAG17 recognizer provenance is unsupported or inconsistent', 'GENESISRAG17_RECOGNIZER_CONFIG_UNSUPPORTED')
  }
  const replayRunId = input?.replayRunId ?? source?.replayRunId ?? null
  if (replayRunId !== null && (typeof replayRunId !== 'string' || !replayRunId.trim())) {
    throw serviceError(400, 'GenesisRAG17 replayRunId must be a non-empty executionRunId', 'GENESISRAG17_REPLAY_RUN_ID_INVALID')
  }
  if (input?.maxTokens !== undefined && source?.maxTokens !== undefined && input.maxTokens !== source.maxTokens) {
    throw serviceError(400, 'GenesisRAG17 parser maxTokens is inconsistent between input and source', 'GENESISRAG17_PARSER_CONFIG_UNSUPPORTED')
  }
  const requestedMaxTokens = input?.maxTokens ?? source?.maxTokens
  const maxTokens = Number.isFinite(requestedMaxTokens) ? Math.max(1, Math.floor(requestedMaxTokens)) : GENESIS_RAG17_DEFAULT_MAX_TOKENS
  if (input?.parserVersion !== undefined && source?.parserVersion !== undefined && input.parserVersion !== source.parserVersion) {
    throw serviceError(400, 'GenesisRAG17 parser configuration identity is inconsistent between input and source', 'GENESISRAG17_PARSER_CONFIG_UNSUPPORTED')
  }
  const parserVersion = input?.parserVersion ?? source?.parserVersion
  const expectedParserVersion = genesisRag17ParserIdentity({ maxTokens })
  if (parserVersion !== undefined && parserVersion !== expectedParserVersion) {
    throw serviceError(400, 'GenesisRAG17 parser configuration identity is unsupported', 'GENESISRAG17_PARSER_CONFIG_UNSUPPORTED')
  }
  if (input?.chunkerVersion !== undefined && source?.chunkerVersion !== undefined && input.chunkerVersion !== source.chunkerVersion) {
    throw serviceError(400, 'GenesisRAG17 chunker configuration identity is inconsistent between input and source', 'GENESISRAG17_CHUNKER_CONFIG_UNSUPPORTED')
  }
  const chunkerVersion = input?.chunkerVersion ?? source?.chunkerVersion
  if (chunkerVersion !== undefined && chunkerVersion !== GENESIS_RAG17_CHUNKER_VERSION) {
    throw serviceError(400, 'GenesisRAG17 chunker configuration identity is unsupported', 'GENESISRAG17_CHUNKER_CONFIG_UNSUPPORTED')
  }
  const temporalFields = ['temporal', 'temporalMetadata', 'temporal_metadata', 'validFrom', 'validTo', 'valid_from', 'valid_to']
  if (temporalFields.some((key) => input?.[key] !== undefined || source?.[key] !== undefined)) {
    throw serviceError(400, 'GenesisRAG17 structured temporal metadata requires a separately versioned mapping contract', 'GENESISRAG17_TEMPORAL_METADATA_UNSUPPORTED')
  }
  return {
    scope,
    sourceId: String(sourceId),
    documentId: String(documentId),
    version: String(version),
    content,
    contentHash,
    sourceType: source?.sourceType ?? source?.source_type ?? RAW_SOURCE_TYPE,
    sourceUri: source?.sourceUri ?? source?.source_uri ?? sourceId,
    contentType: source?.contentType ?? source?.content_type ?? RAW_CONTENT_TYPE,
    policy: { allowEmbedding: policy.allowEmbedding, allowPublication: policy.allowPublication },
    maxTokens,
    parserVersion: expectedParserVersion,
    chunkerVersion: GENESIS_RAG17_CHUNKER_VERSION,
    recognizerVersion: GENESIS_RAG17_RECOGNIZER_VERSION,
    recognizerProvenance: GENESIS_RAG17_RECOGNIZER_PROVENANCE,
    rawExternalRecordId: source?.rawExternalRecordId ?? null,
    replayRunId,
    connectionId: source?.connectionId ?? null,
    provider: source?.provider ?? 'genesisrag17',
    lane: source?.lane ?? 'BUSINESS',
    externalId: source?.externalId ?? `${sourceId}:${version}`,
  }
}

function sourceIdentity(value) {
  return hashGenesisRag17Json({
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    pipelineVersion: GENESIS_RAG17_PIPELINE_VERSION,
    scope: value.scope,
    sourceId: value.sourceId,
    documentId: value.documentId,
    version: value.version,
    contentHash: value.contentHash,
  })
}

function genesisIdentity(value) {
  return hashGenesisRag17Json({
    sourceIdentity: sourceIdentity(value),
    parserVersion: genesisRag17ParserIdentity({ maxTokens: value.maxTokens }),
  })
}

function deterministicId(prefix, identity) {
  return `${prefix}_${identity.slice(0, 48)}`
}

function intentDerivation(value) {
  return {
    parserVersion: genesisRag17ParserIdentity({ maxTokens: value.maxTokens }),
    chunkerVersion: GENESIS_RAG17_CHUNKER_VERSION,
    maxTokens: value.maxTokens,
    recognizerVersion: GENESIS_RAG17_RECOGNIZER_VERSION,
    recognizerProvenance: GENESIS_RAG17_RECOGNIZER_PROVENANCE,
  }
}

function intentRequest(value) {
  return {
    scope: value.scope,
    sourceId: value.sourceId,
    documentId: value.documentId,
    version: value.version,
    content: value.content,
    contentHash: value.contentHash,
    sourceType: value.sourceType,
    sourceUri: value.sourceUri,
    contentType: value.contentType,
    policy: value.policy,
    maxTokens: value.maxTokens,
    parserVersion: value.parserVersion,
    chunkerVersion: value.chunkerVersion,
    recognizerVersion: value.recognizerVersion,
    recognizerProvenance: value.recognizerProvenance,
    rawExternalRecordId: value.rawExternalRecordId,
    replayRunId: value.replayRunId,
    connectionId: value.connectionId,
    provider: value.provider,
    lane: value.lane,
    externalId: value.externalId,
  }
}

function intentJson(value) {
  return JSON.stringify(intentRequest(value))
}

function derivationJson(value) {
  return JSON.stringify(intentDerivation(value))
}

async function assertBusinessScope(db, scope) {
  const business = await db.business.findUnique({
    where: { id: scope.businessId },
    select: { id: true, tenantId: true, status: true, tenant: { select: { portfolioId: true } } },
  })
  if (!business || business.status !== 'ACTIVE') throw serviceError(404, 'GenesisRAG17 Business not found')
  if (business.tenantId !== scope.tenantId || business.tenant?.portfolioId !== scope.portfolioId) {
    throw serviceError(403, 'GenesisRAG17 scope does not match the Business tenant and portfolio')
  }
  return business
}

function runInput(value, identity, rawArtifactId) {
  return {
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    businessId: value.scope.businessId,
    sourceRef: value.sourceUri || value.documentId,
    sourceSha256: value.contentHash,
    artifactRef: rawArtifactId,
    artifactSha256: value.contentHash,
    expectedCount: 1,
    bootstrapBatchId: null,
    correlationId: `ki17:${identity}`,
    idempotencyKey: `ki17:${identity}`,
    identityRefs: { ...IDENTITY_REFS_EMPTY, artifactIds: [rawArtifactId] },
    tagIds: [],
  }
}

function eventDefaults({
  runInputValue,
  run,
  identity,
  stage,
  status,
  at,
  inputHash = null,
  outputHash = null,
  actualCount = null,
  insertedCount = null,
  failedCount = null,
}) {
  return {
    eventType: status === 'RUNNING' ? 'STEP_STARTED' : status === 'SUCCEEDED' ? 'STEP_SUCCEEDED' : 'STEP_FAILED',
    dataPipelineDefinitionId: runInputValue.dataPipelineDefinitionId,
    executionContractId: runInputValue.executionContractId,
    executionRunId: run.executionRunId,
    pipelineStageId: stage.pipelineStageId,
    executionStepId: stage.executionStepId,
    attemptId: stage.attemptId,
    pipelineRecordId: null,
    sourceRecordKey: null,
    sourceRowNumber: null,
    sourceSha256: run.sourceSha256,
    docId: null,
    picId: null,
    factId: null,
    sourceDocIds: [],
    sourcePicIds: [],
    destinationRecordId: null,
    sequence: stage.sequence,
    status,
    correlationId: `ki17:${identity}`,
    idempotencyKey: `ki17:${identity}:${stage.pipelineStageId}:${stage.attemptId}:${status.toLowerCase()}`,
    inputHash,
    outputHash,
    ...(typeof actualCount === 'number' ? { actualCount } : {}),
    ...(typeof insertedCount === 'number' ? { insertedCount } : {}),
    ...(typeof failedCount === 'number' ? { failedCount } : {}),
    tagIds: [],
    identityRefs: runInputValue.identityRefs,
    failureCode: null,
    errorRef: null,
    retryable: null,
    reconciliation: null,
    gate: null,
  }
}

async function writeStageEvidence(db, {
  run,
  identity,
  stage,
  stageNumber,
  startedAt,
  finishedAt,
  metrics,
  details,
  outcome = 'SUCCEEDED',
  cursor = null,
  idFactory,
}) {
  const rowHash = hashGenesisRag17Json({
    runId: run.executionRunId,
    pipelineStageId: stage.pipelineStageId,
    executionStepId: stage.executionStepId,
    attemptId: stage.attemptId,
    stageNumber,
    outcome,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    metrics,
    details,
    cursor,
  })
  const existing = await db.genesisRag17StageEvidence.findFirst({
    where: {
      executionRunId: run.executionRunId,
      pipelineStageId: stage.pipelineStageId,
      executionStepId: stage.executionStepId,
      attemptId: stage.attemptId,
    },
  })
  if (existing) {
    if (existing.rowHash !== rowHash) throw serviceError(409, 'GenesisRAG17 stage evidence identity was reused with different evidence')
    return existing
  }
  return db.genesisRag17StageEvidence.create({
    data: {
      id: deterministicId('gre', rowHash),
      cursor,
      runId: run.id,
      executionRunId: run.executionRunId,
      pipelineStageId: stage.pipelineStageId,
      executionStepId: stage.executionStepId,
      attemptId: stage.attemptId,
      stageNumber,
      outcome,
      startedAt,
      finishedAt,
      recordsIn: metrics.records_in,
      recordsOut: metrics.records_out,
      recordsQuarantined: metrics.records_quarantined,
      errorCount: metrics.error_count,
      retryCount: metrics.retry_count,
      durationMs: metrics.duration_ms,
      detailsJson: json(details),
      rowHash,
      createdAt: finishedAt,
    },
  })
}

async function runLocalStage({ db, run, runInputValue, identity, stage, stageNumber, action, recordsIn = 0, now, idFactory }) {
  const existingEvidence = await db.genesisRag17StageEvidence.findFirst({
    where: {
      executionRunId: run.executionRunId,
      pipelineStageId: stage.pipelineStageId,
      executionStepId: stage.executionStepId,
      attemptId: stage.attemptId,
    },
  })
  if (existingEvidence) {
    const details = JSON.parse(existingEvidence.detailsJson || '{}')
    if (existingEvidence.outcome === 'FAILED') throw serviceError(409, `GenesisRAG17 Stage ${stageNumber} already failed for this attempt`)
    return {
      status: 'SUCCEEDED',
      metrics: {
        records_in: existingEvidence.recordsIn,
        records_out: existingEvidence.recordsOut,
        records_quarantined: existingEvidence.recordsQuarantined,
        error_count: existingEvidence.errorCount,
        retry_count: existingEvidence.retryCount,
        duration_ms: existingEvidence.durationMs,
      },
      details,
      evidence: existingEvidence,
      replayed: true,
    }
  }
  const requestedStart = atDate(now)
  await recordPipelineEvent(eventDefaults({ runInputValue, run, identity, stage, status: 'RUNNING', at: requestedStart }), { db, viewer: runInputValue.viewer, now: () => requestedStart, ...(idFactory ? { idFactory } : {}) })
  const persistedStep = await db.pipelineStep.findUnique({ where: { executionStepId: stage.executionStepId } })
  const startedAt = persistedStep?.startedAt || requestedStart
  let result
  try {
    result = await action()
  } catch (error) {
    const finishedAt = atDate(now)
    const failureCode = error.code || `GENESISRAG17_STAGE_${stageNumber}_FAILED`
    const errorRef = `ki17://${identity}/${stage.pipelineStageId}`
    const measuredRecordsIn = typeof recordsIn === 'function' ? recordsIn() : recordsIn
    const failureMetrics = { records_in: Number.isSafeInteger(measuredRecordsIn) && measuredRecordsIn >= 0 ? measuredRecordsIn : 0, records_out: 0, records_quarantined: 0, error_count: 1, retry_count: 0, duration_ms: Math.max(0, finishedAt.valueOf() - startedAt.valueOf()) }
    const failureDetails = { errorCode: failureCode }
    const failedTerminal = async (tx) => {
      const event = await recordPipelineEvent({
        ...eventDefaults({
          runInputValue,
          run,
          identity,
          stage,
          status: 'FAILED',
          at: finishedAt,
          outputHash: hashGenesisRag17Json({ metrics: failureMetrics, details: failureDetails }),
          actualCount: failureMetrics.records_in,
          insertedCount: failureMetrics.records_out,
          failedCount: failureMetrics.error_count,
        }),
        failureCode,
        errorRef,
        retryable: false,
      }, { db: tx, viewer: runInputValue.viewer, now: () => finishedAt, ...(idFactory ? { idFactory } : {}) })
      const evidence = await writeStageEvidence(tx, {
        run,
        identity,
        stage,
        stageNumber,
        startedAt,
        finishedAt,
        outcome: 'FAILED',
        metrics: failureMetrics,
        details: failureDetails,
        idFactory,
      })
      return { event, evidence }
    }
    if (typeof db.$transaction === 'function') await db.$transaction(failedTerminal)
    else await failedTerminal(db)
    throw error
  }

  const finishedAt = persistedStep?.status === 'SUCCEEDED' && persistedStep.finishedAt ? persistedStep.finishedAt : atDate(now)
  const metrics = {
    records_in: result.recordsIn,
    records_out: result.recordsOut,
    records_quarantined: result.recordsQuarantined ?? 0,
    error_count: result.errorCount ?? 0,
    retry_count: result.retryCount ?? 0,
    duration_ms: Math.max(0, finishedAt.valueOf() - startedAt.valueOf()),
  }
  const details = result.details ?? {}
  const outputHash = hashGenesisRag17Json({ metrics, details })
  try {
    // The terminal ledger event and the six-metric evidence row commit as one
    // unit. A crash cannot leave STEP_SUCCEEDED without its durable metrics,
    // and a receipt-write error is never misclassified as a stage failure.
    const terminal = async (tx) => {
      const event = await recordPipelineEvent(eventDefaults({
        runInputValue,
        run,
        identity,
        stage,
        status: 'SUCCEEDED',
        at: finishedAt,
        outputHash,
        actualCount: metrics.records_in,
        insertedCount: metrics.records_out,
        failedCount: metrics.error_count,
      }), { db: tx, viewer: runInputValue.viewer, now: () => finishedAt, ...(idFactory ? { idFactory } : {}) })
      const evidence = await writeStageEvidence(tx, { run, identity, stage, stageNumber, startedAt, finishedAt, metrics, details, idFactory })
      return { event, evidence }
    }
    const committed = typeof db.$transaction === 'function' ? await db.$transaction(terminal) : await terminal(db)
    const event = committed.event
    const evidence = committed.evidence
    return { status: 'SUCCEEDED', metrics, details, event, evidence }
  } catch (error) {
    throw error
  }
}

function payloadText(rawRecord) {
  try {
    const payload = JSON.parse(rawRecord.payloadJson)
    if (typeof payload === 'string') return payload
    return payload?.content ?? payload?.text ?? null
  } catch {
    return null
  }
}

async function ensureCanonicalRawRecord(db, value, rawArtifactId, now) {
  if (value.rawExternalRecordId) {
    const existing = await db.rawExternalRecord.findFirst({
      where: {
        id: value.rawExternalRecordId,
        tenantId: value.scope.tenantId,
        businessId: value.scope.businessId,
        ...(value.connectionId ? { connectionId: value.connectionId } : {}),
      },
    })
    if (!existing) throw serviceError(404, 'GenesisRAG17 RawExternalRecord is outside the requested scope', 'GENESISRAG17_RAW_SCOPE_DENIED')
    if (existing.artifactId !== rawArtifactId || payloadText(existing) !== value.content) throw serviceError(409, 'GenesisRAG17 RawExternalRecord does not match the immutable source content', 'GENESISRAG17_RAW_MISMATCH')
    return existing
  }
  if (!value.connectionId) throw serviceError(400, 'GenesisRAG17 raw entry requires a canonical RawExternalRecord id or connectionId', 'GENESISRAG17_RAW_EXTERNAL_RECORD_REQUIRED')
  const connection = await db.integrationConnection.findUnique({
    where: { id: value.connectionId },
    select: { id: true, tenantId: true, businessId: true, status: true },
  })
  if (!connection || connection.status === 'DISABLED' || connection.tenantId !== value.scope.tenantId || (connection.businessId ?? null) !== value.scope.businessId) {
    throw serviceError(403, 'GenesisRAG17 connection is outside the requested Business scope', 'GENESISRAG17_CONNECTION_SCOPE_DENIED')
  }
  const repository = createPrismaRawRecordRepository(db, {
    tenantId: value.scope.tenantId,
    businessId: value.scope.businessId,
    connectionId: value.connectionId,
  })
  const result = await ingestRawExternalRecord({
    tenantId: value.scope.tenantId,
    businessId: value.scope.businessId,
    connectionId: value.connectionId,
    provider: value.provider,
    lane: value.lane,
    entityType: 'KNOWLEDGE_DOCUMENT',
    externalId: value.externalId,
    sourceType: ['PULL', 'WEBHOOK', 'FILE', 'MANUAL'].includes(value.sourceType) ? value.sourceType : 'MANUAL',
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    payload: { documentId: value.documentId, version: value.version, content: value.content, contentHash: value.contentHash },
    sourceUri: value.sourceUri,
    artifactId: rawArtifactId,
  }, { repository, now })
  if (!result.rawRecord || result.rawRecord.artifactId !== rawArtifactId || payloadText(result.rawRecord) !== value.content) {
    throw serviceError(409, 'GenesisRAG17 canonical RawExternalRecord does not carry the requested immutable artifact', 'GENESISRAG17_RAW_MISMATCH')
  }
  return result.rawRecord
}

async function ensureRaw(repository, value, rawArtifactId, canonicalRawRecord, now) {
  const existing = await repository.findRawByIdentity({ sourceId: value.sourceId, version: value.version, contentHash: value.contentHash, pipelineVersion: GENESIS_RAG17_PIPELINE_VERSION })
  if (existing) {
    if (existing.id !== rawArtifactId || existing.rawExternalRecordId !== canonicalRawRecord.id || existing.content !== value.content || existing.documentId !== value.documentId || existing.visibility !== value.scope.visibility) throw serviceError(409, 'GenesisRAG17 raw identity was reused with different immutable content')
    return existing
  }
  return repository.createRaw({
    id: rawArtifactId,
    rawExternalRecordId: canonicalRawRecord.id,
    sourceId: value.sourceId,
    documentId: value.documentId,
    version: value.version,
    contentHash: value.contentHash,
    content: value.content,
    sourceType: value.sourceType,
    sourceUri: value.sourceUri,
    contentType: value.contentType,
    pipelineVersion: GENESIS_RAG17_PIPELINE_VERSION,
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    ...value.scope,
    receivedAt: atDate(now),
    createdAt: atDate(now),
  })
}

async function ensureParsedArtifact(repository, value, rawArtifactId, parsedArtifactId, now) {
  const parserVersion = genesisRag17ParserIdentity({ maxTokens: value.maxTokens })
  const parsedAndChunks = parseGenesisRag17Document({ documentId: value.documentId, rawArtifactId, parsedArtifactId, content: value.content, maxTokens: value.maxTokens, parserVersion })
  const parsedHash = parsedArtifactContentHash(parsedAndChunks.parsed)
  let parsed = await repository.findParsedByRawAndParser(rawArtifactId, parserVersion)
  if (parsed) {
    let legacyDefaultMetadata = false
    if (parserVersion === GENESIS_RAG17_PARSER_VERSION) {
      try {
        const metadata = JSON.parse(parsed.metadataJson || '{}')
        legacyDefaultMetadata = metadata.chunkerVersion === undefined && metadata.maxTokens === undefined
      } catch {
        legacyDefaultMetadata = false
      }
    }
    if (parsed.id !== parsedArtifactId || parsed.content !== value.content || (parsed.contentHash !== parsedHash && !legacyDefaultMetadata)) throw serviceError(409, 'GenesisRAG17 parsed identity was reused with different immutable content')
  } else {
    parsed = await repository.createParsed({
      id: parsedArtifactId,
      rawArtifactId,
      documentId: value.documentId,
      parserVersion,
      contentHash: parsedHash,
      content: value.content,
      structureJson: json(parsedAndChunks.parsed.structure),
      textBlocksJson: json(parsedAndChunks.parsed.textBlocks),
      tablesJson: json(parsedAndChunks.parsed.tables),
      metadataJson: json(parsedAndChunks.parsed.metadata),
      ...value.scope,
      createdAt: atDate(now),
    })
  }
  return { parsed, parsedDocument: parsedAndChunks.parsed, candidateChunks: parsedAndChunks.chunks }
}

async function ensureChunks(repository, value, rawArtifactId, parsedArtifactId, now) {
  const parserVersion = genesisRag17ParserIdentity({ maxTokens: value.maxTokens })
  const parsedAndChunks = parseGenesisRag17Document({ documentId: value.documentId, rawArtifactId, parsedArtifactId, content: value.content, maxTokens: value.maxTokens, parserVersion })
  const parsed = await repository.findParsedByRawAndParser(rawArtifactId, parserVersion)
  if (!parsed || parsed.id !== parsedArtifactId) throw serviceError(409, 'GenesisRAG17 chunking requires the matching parsed artifact')
  const chunks = []
  for (const candidate of parsedAndChunks.chunks) {
    const chunk = { ...candidate, parsedArtifactId }
    const existing = await repository.findChunkByOrdinal(parsedArtifactId, chunk.ordinal)
    if (existing) {
      if (!isDeepStrictEqual({ text: existing.text, contentHash: existing.contentHash, startOffset: existing.startOffset, endOffset: existing.endOffset }, { text: chunk.text, contentHash: chunk.contentHash, startOffset: chunk.startOffset, endOffset: chunk.endOffset })) throw serviceError(409, 'GenesisRAG17 chunk identity was reused with different immutable content')
      chunks.push(existing)
    } else {
      const created = await repository.createChunk({
        id: chunk.chunkId,
        parsedArtifactId,
        documentId: value.documentId,
        ordinal: chunk.ordinal,
        text: chunk.text,
        contentHash: chunk.contentHash,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        headingPathJson: json(chunk.headingPath),
        tokenCount: chunk.tokenCount,
        ...value.scope,
        createdAt: atDate(now),
      })
      chunks.push(created)
    }
  }
  const persisted = await repository.listChunks(parsedArtifactId)
  if (persisted.length !== parsedAndChunks.chunks.length || persisted.some((chunk, index) => chunk.id !== chunks[index]?.id)) {
    throw serviceError(409, 'GenesisRAG17 persisted chunks do not match the immutable parser output', 'GENESISRAG17_CHUNK_LINEAGE_MISMATCH')
  }
  return { parsed, chunks, parsedDocument: parsedAndChunks.parsed }
}

async function ensureIngestionIntent(repository, value, identity, run, rawArtifactId, now) {
  const requestJson = intentJson(value)
  const derivationJsonValue = derivationJson(value)
  const intentKey = hashGenesisRag17Json({ identity, executionRunId: run.executionRunId })
  const existing = await repository.findIntentByExecutionRunId(run.executionRunId)
    || await repository.findIntentByKey(intentKey)
  if (existing) {
    if (
      existing.intentKey !== intentKey
      || existing.executionRunId !== run.executionRunId
      || existing.requestJson !== requestJson
      || existing.derivationJson !== derivationJsonValue
      || existing.rawArtifactId !== rawArtifactId
      || existing.contentHash !== value.contentHash
    ) {
      throw serviceError(409, 'GenesisRAG17 ingestion intent was reused with different input or derivation configuration', 'GENESISRAG17_INTENT_CONFLICT')
    }
    return existing
  }
  const at = atDate(now)
  return repository.createIntent({
    id: deterministicId('gii', intentKey),
    intentKey,
    runId: run.id,
    executionRunId: run.executionRunId,
    scopeJson: scopeJson(value.scope),
    requestJson,
    derivationJson: derivationJsonValue,
    rawArtifactId,
    sourceId: value.sourceId,
    documentId: value.documentId,
    version: value.version,
    contentHash: value.contentHash,
    ...value.scope,
    status: 'PENDING',
    nextStageNumber: 1,
    lastErrorJson: null,
    createdAt: at,
    updatedAt: at,
  })
}

function mentionContract(row) {
  return {
    sourceMentionId: row.sourceMentionId,
    resolutionKey: row.resolutionKey,
    semanticType: row.semanticType,
    name: row.name,
    chunkId: row.chunkId,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
  }
}

async function ensureSourceMentions(repository, value, run, stage8, raw, parsed, chunks, now) {
  const derivation = intentDerivation(value)
  const derivationHash = hashGenesisRag17Json(derivation)
  const expected = extractGenesisRag17Mentions(chunks.map((chunk) => ({ chunkId: chunk.id, chunk_id: chunk.id, text: chunk.text })))
  const existing = await repository.listMentions({ executionRunId: run.executionRunId, attemptId: stage8.attemptId, parsedArtifactId: parsed.id })
  const existingById = new Map(existing.map((row) => [row.sourceMentionId, row]))
  if (existingById.size !== existing.length || existing.some((row) => !expected.some((hit) => hit.sourceMentionId === row.sourceMentionId))) {
    throw serviceError(409, 'GenesisRAG17 durable source mentions do not match the extractor output', 'GENESISRAG17_MENTION_DERIVATION_MISMATCH')
  }
  const durable = []
  for (const hit of expected) {
    const current = existingById.get(hit.sourceMentionId)
    if (current) {
      if (
        current.runId !== run.id
        || current.executionRunId !== run.executionRunId
        || current.attemptId !== stage8.attemptId
        || current.sourceId !== value.sourceId
        || current.documentId !== value.documentId
        || current.version !== value.version
        || current.rawArtifactId !== raw.id
        || current.parsedArtifactId !== parsed.id
        || current.contentHash !== value.contentHash
        || current.resolutionKey !== hit.resolutionKey
        || current.semanticType !== hit.semanticType
        || current.name !== hit.name
        || current.chunkId !== hit.chunkId
        || current.startOffset !== hit.startOffset
        || current.endOffset !== hit.endOffset
        || current.recognizerVersion !== GENESIS_RAG17_RECOGNIZER_VERSION
        || current.recognizerProvenance !== GENESIS_RAG17_RECOGNIZER_PROVENANCE
        || current.derivationHash !== derivationHash
      ) {
        throw serviceError(409, 'GenesisRAG17 durable source mention derivation identity does not match the requested replay', 'GENESISRAG17_MENTION_DERIVATION_MISMATCH')
      }
      durable.push(current)
      continue
    }
    const row = await repository.createMention({
      id: deterministicId('gsm', hashGenesisRag17Json({ executionRunId: run.executionRunId, attemptId: stage8.attemptId, sourceMentionId: hit.sourceMentionId, derivationHash })),
      sourceMentionId: hit.sourceMentionId,
      runId: run.id,
      executionRunId: run.executionRunId,
      attemptId: stage8.attemptId,
      sourceId: value.sourceId,
      documentId: value.documentId,
      version: value.version,
      rawArtifactId: raw.id,
      parsedArtifactId: parsed.id,
      chunkId: hit.chunkId,
      resolutionKey: hit.resolutionKey,
      semanticType: hit.semanticType,
      name: hit.name,
      startOffset: hit.startOffset,
      endOffset: hit.endOffset,
      recognizerVersion: GENESIS_RAG17_RECOGNIZER_VERSION,
      recognizerProvenance: GENESIS_RAG17_RECOGNIZER_PROVENANCE,
      derivationHash,
      contentHash: value.contentHash,
      ...value.scope,
      createdAt: atDate(now),
    })
    existingById.set(hit.sourceMentionId, row)
    durable.push(row)
  }
  return durable.map(mentionContract)
}

async function loadRunAndSteps(db, executionRunId) {
  const run = await db.pipelineRun.findUnique({ where: { executionRunId } })
  if (!run) throw serviceError(404, 'GenesisRAG17 pipeline run not found')
  const steps = await db.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })
  return { run, steps, byStage: Object.fromEntries(steps.map((step) => [step.pipelineStageId, step])) }
}

async function loadReplayRun(db, value, rawArtifactId, lineageRepository) {
  if (!value.replayRunId) return null
  const replay = await db.pipelineRun.findUnique({ where: { executionRunId: value.replayRunId } })
  if (!replay) throw serviceError(404, 'GenesisRAG17 replay execution run not found', 'GENESISRAG17_REPLAY_RUN_NOT_FOUND')
  if (!['QUEUED', 'RUNNING'].includes(replay.status)) {
    throw serviceError(409, 'GenesisRAG17 replay run is not resumable in its current state', 'GENESISRAG17_REPLAY_RUN_NOT_RESUMABLE')
  }
  const expectedSourceRef = value.sourceUri || value.documentId
  if (
    replay.dataPipelineDefinitionId !== KNOWLEDGE_INGESTION_DEFINITION_ID
    || replay.executionContractId !== KNOWLEDGE_INGESTION_CONTRACT_ID
    || replay.tenantId !== value.scope.tenantId
    || replay.businessId !== value.scope.businessId
    || replay.sourceRef !== expectedSourceRef
    || replay.sourceSha256 !== value.contentHash
    || replay.artifactRef !== rawArtifactId
    || replay.artifactSha256 !== value.contentHash
    || replay.replayOfExecutionRunId === replay.executionRunId
  ) {
    throw serviceError(409, 'GenesisRAG17 replay run does not match the requested scoped source lineage', 'GENESISRAG17_REPLAY_LINEAGE_MISMATCH')
  }
  const source = replay.replayOfExecutionRunId
    ? await db.pipelineRun.findUnique({ where: { executionRunId: replay.replayOfExecutionRunId } })
    : null
  if (
    !source
    || source.tenantId !== value.scope.tenantId
    || source.businessId !== value.scope.businessId
    || source.sourceSha256 !== value.contentHash
    || source.artifactRef !== rawArtifactId
    || source.artifactSha256 !== value.contentHash
  ) {
    throw serviceError(409, 'GenesisRAG17 replay source lineage is missing or outside the requested scope', 'GENESISRAG17_REPLAY_LINEAGE_MISMATCH')
  }
  const sourceIntent = await lineageRepository.findIntentByExecutionRunId(source.executionRunId)
  if (sourceIntent) {
    let sourceRequest = null
    try { sourceRequest = JSON.parse(sourceIntent.requestJson) } catch { sourceRequest = null }
    const requestedReplay = { ...intentRequest(value), replayRunId: null }
    if (!sourceRequest || hashGenesisRag17Json({ ...sourceRequest, replayRunId: null }) !== hashGenesisRag17Json(requestedReplay) || sourceIntent.derivationJson !== derivationJson(value)) {
      throw serviceError(409, 'GenesisRAG17 replay derivation does not match the original source intent', 'GENESISRAG17_REPLAY_DERIVATION_MISMATCH')
    }
  }
  return replay
}

/**
 * Resolve one immutable Tier 1 citation back through RawExternalRecord,
 * KnowledgeRawArtifact, KnowledgeParsedArtifact and KnowledgeChunk. Every
 * lookup carries the six-field scope and every link is checked before the
 * citation leaves this boundary.
 */
export async function resolveGenesisRag17RawLineage({
  scope,
  sourceId,
  documentId,
  version,
  rawArtifactId,
  parsedArtifactId,
  chunkId,
} = {}, { db = prisma } = {}) {
  const normalizedScope = parseGenesisRag17Scope(scope)
  if (!rawArtifactId || !parsedArtifactId || !chunkId) throw serviceError(400, 'GenesisRAG17 lineage resolver requires rawArtifactId, parsedArtifactId and chunkId', 'GENESISRAG17_LINEAGE_INPUT_INVALID')
  const lineageRepository = createGenesisRag17LineageRepository(db, normalizedScope)
  const raw = await lineageRepository.findRawById(rawArtifactId)
  if (!raw) throw serviceError(404, 'GenesisRAG17 raw artifact is outside the requested scope or missing', 'GENESISRAG17_LINEAGE_NOT_FOUND')
  if (raw.contentHash !== hashGenesisRag17Text(raw.content)) throw serviceError(409, 'GenesisRAG17 raw artifact content hash is invalid', 'GENESISRAG17_LINEAGE_BROKEN')
  if ((sourceId && raw.sourceId !== sourceId) || (documentId && raw.documentId !== documentId) || (version && raw.version !== version)) {
    throw serviceError(404, 'GenesisRAG17 raw artifact does not match the requested source version', 'GENESISRAG17_LINEAGE_NOT_FOUND')
  }
  const canonicalRaw = await db.rawExternalRecord.findFirst({
    where: { id: raw.rawExternalRecordId, tenantId: normalizedScope.tenantId, businessId: normalizedScope.businessId },
  })
  if (!canonicalRaw || canonicalRaw.artifactId !== raw.id || payloadText(canonicalRaw) !== raw.content) throw serviceError(409, 'GenesisRAG17 canonical RawExternalRecord link is invalid', 'GENESISRAG17_LINEAGE_BROKEN')
  const parsed = await lineageRepository.findParsedById(parsedArtifactId)
  if (!parsed || parsed.content !== raw.content || parsed.documentId !== raw.documentId) throw serviceError(409, 'GenesisRAG17 parsed artifact does not match its raw parent', 'GENESISRAG17_LINEAGE_BROKEN')
  let expectedParsedHash
  try {
    expectedParsedHash = parsedArtifactContentHash({
      parserVersion: parsed.parserVersion, documentId: parsed.documentId, rawArtifactId: parsed.rawArtifactId,
      contentHash: hashGenesisRag17Text(parsed.content), structure: JSON.parse(parsed.structureJson),
      textBlocks: JSON.parse(parsed.textBlocksJson), tables: JSON.parse(parsed.tablesJson), metadata: JSON.parse(parsed.metadataJson),
    })
  } catch { throw serviceError(409, 'GenesisRAG17 parsed artifact metadata is invalid', 'GENESISRAG17_LINEAGE_BROKEN') }
  if (parsed.contentHash !== expectedParsedHash) throw serviceError(409, 'GenesisRAG17 parsed artifact content hash is invalid', 'GENESISRAG17_LINEAGE_BROKEN')
  if (parsed.rawArtifactId !== raw.id) throw serviceError(409, 'GenesisRAG17 parsed artifact does not match its raw parent', 'GENESISRAG17_LINEAGE_BROKEN')
  const chunk = await lineageRepository.findChunkById(chunkId)
  if (!chunk || chunk.endOffset < chunk.startOffset || raw.content.slice(chunk.startOffset, chunk.endOffset) !== chunk.text || chunk.contentHash !== hashGenesisRag17Text(chunk.text)) throw serviceError(409, 'GenesisRAG17 chunk does not match its immutable source substring', 'GENESISRAG17_LINEAGE_BROKEN')
  if (chunk.parsedArtifactId !== parsed.id) throw serviceError(409, 'GenesisRAG17 chunk does not match its parsed parent', 'GENESISRAG17_LINEAGE_BROKEN')
  return {
    sourceId: raw.sourceId,
    rawArtifactId: raw.id,
    parsedArtifactId: parsed.id,
    documentId: raw.documentId,
    version: raw.version,
    contentHash: raw.contentHash,
    chunkId: chunk.id,
    text: chunk.text,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    rawExternalRecordId: raw.rawExternalRecordId,
  }
}

function buildBatch({ value, identity, run, steps, rawArtifactId, parsedArtifactId, chunks, mentions }) {
  const stages = buildGenesisRag17StageIdentities(run.executionRunId, steps)
  const stage9 = stages.find((stage) => stage.stageNumber === 9)
  const batchId = deterministicId('grb', hashGenesisRag17Json({ executionRunId: run.executionRunId, attemptId: stage9.attemptId }))
  const source = {
    sourceId: value.sourceId,
    rawArtifactId,
    parsedArtifactId,
    documentId: value.documentId,
    version: value.version,
    contentHash: value.contentHash,
    content: value.content,
  }
  const contractChunks = chunks.map((chunk) => ({
    chunkId: chunk.id,
    parsedArtifactId,
    ordinal: chunk.ordinal,
    text: chunk.text,
    contentHash: chunk.contentHash,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
  }))
  const batch = {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    batchId,
    idempotencyKey: `ki17:batch:${run.executionRunId}:${stage9.attemptId}`,
    scope: value.scope,
    runId: run.executionRunId,
    stages,
    source,
    policy: value.policy,
    chunks: contractChunks,
    mentions,
  }
  return { batch, stage9 }
}

function resolveRuntimeCredential({ scope, env = process.env, credential = null }) {
  if (credential) return credential
  let principals
  try {
    principals = env.MSP_PIPELINE_PRINCIPALS ? JSON.parse(env.MSP_PIPELINE_PRINCIPALS) : []
  } catch {
    throw serviceError(503, 'MSP_PIPELINE_PRINCIPALS is invalid JSON', 'MSP_PIPELINE_CONFIG_INVALID')
  }
  if (!Array.isArray(principals)) throw serviceError(503, 'MSP_PIPELINE_PRINCIPALS must be an array', 'MSP_PIPELINE_CONFIG_INVALID')
  const matches = principals.filter((entry) => entry?.role === 'source' && entry?.credential && entry?.scope && isDeepStrictEqual(entry.scope, scope))
  if (matches.length !== 1) throw serviceError(503, 'GenesisRAG17 source credential is unavailable for this scope', 'MSP_PIPELINE_CREDENTIAL_UNAVAILABLE')
  return matches[0].credential
}

async function deliverBatch({ batch, transport, credential }) {
  if (typeof transport !== 'function') throw serviceError(503, 'MSP pipeline transport is unavailable', 'MSP_TRANSPORT_UNAVAILABLE')
  const response = await transport(GENESIS_RAG17_PIPELINE_TOOLS.submit, {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    scope: batch.scope,
    credential,
    batch,
  })
  if (!response || response.schemaVersion !== GENESIS_RAG17_SCHEMA_VERSION || !isDeepStrictEqual(response.scope, batch.scope) || response.batchId !== batch.batchId || typeof response.status !== 'string' || (response.decisionId !== null && (typeof response.decisionId !== 'string' || response.decisionId.length === 0))) {
    throw serviceError(502, 'MSP returned an invalid GenesisRAG17 submit response', 'GENESISRAG17_MSP_RESPONSE_INVALID')
  }
  return response
}

async function persistBatch(db, { batch, run, stage9, now, idFactory }) {
  const existing = await db.genesisRag17Batch.findFirst({ where: { idempotencyKey: batch.idempotencyKey } })
  const requestJson = json(batch)
  if (existing) {
    if (existing.requestJson !== requestJson || existing.batchId !== batch.batchId || existing.stage9AttemptId !== stage9.attemptId) throw serviceError(409, 'GenesisRAG17 batch idempotency key was reused with different input')
    return existing
  }
  return db.genesisRag17Batch.create({
    data: {
      id: batch.batchId,
      batchId: batch.batchId,
      idempotencyKey: batch.idempotencyKey,
      runId: run.id,
      executionRunId: run.executionRunId,
      stage9StepId: stage9.executionStepId,
      stage9AttemptId: stage9.attemptId,
      scopeJson: scopeJson(batch.scope),
      requestJson,
      status: 'PENDING',
      createdAt: atDate(now),
      updatedAt: atDate(now),
    },
  })
}

async function updateBatchResponse(db, row, response, now) {
  const decisionId = typeof response.decisionId === 'string' && response.decisionId.length > 0 ? response.decisionId : null
  return db.genesisRag17Batch.update({
    where: { id: row.id },
    data: {
      // A null decision is a valid wire response, but it is not an
      // acknowledgement. Keep the outbox pending until MSP returns the
      // decision that authorizes downstream evidence and publication.
      status: decisionId ? 'ACKNOWLEDGED' : 'PENDING',
      decisionId,
      responseJson: json(response),
      updatedAt: atDate(now),
    },
  })
}

/** Real raw entrypoint for GenesisRAG17 TEST; returns a resumable Stage 9 handoff. */
export async function ingestGenesisRag17Raw(input, {
  db = prisma,
  viewer,
  now = () => new Date(),
  idFactory,
  transport = null,
  env = process.env,
  credential = null,
  recognizer,
  faultInjector,
  afterLocalStage,
  onRunCreated,
} = {}) {
  if (!isInstallationOperator(viewer) && !hasKnowledgeScopeAuthority(viewer, input?.scope)) throw serviceError(403, 'GenesisRAG17 raw ingestion requires scoped runtime authority')
  if (recognizer !== undefined && recognizer !== null) {
    throw serviceError(400, 'GenesisRAG17 custom recognizers require a separately versioned durable extension', 'GENESISRAG17_CUSTOM_RECOGNIZER_UNSUPPORTED')
  }
  const value = inputValue(input)
  await assertBusinessScope(db, value.scope)
  const lineageRepository = createGenesisRag17LineageRepository(db, value.scope)
  const identity = genesisIdentity(value)
  const rawArtifactId = deterministicId('kra', sourceIdentity(value))
  const parsedArtifactId = deterministicId('kpa', identity)
  const runInputValue = runInput(value, identity, rawArtifactId)
  const replayRun = await loadReplayRun(db, value, rawArtifactId, lineageRepository)
  const runResult = replayRun
    ? { status: 'REPLAYED', run: replayRun }
    : await createPipelineRun(runInputValue, {
      db,
      viewer,
      now,
      ...(idFactory ? { idFactory } : {}),
      onRunCreated: async ({ db: transactionDb, run }) => {
        await faultInjector?.('after-run-created-before-intent', {
          point: 'after-run-created-before-intent',
          runId: run.id,
          executionRunId: run.executionRunId,
          identity,
        })
        await ensureIngestionIntent(createGenesisRag17LineageRepository(transactionDb, value.scope), value, identity, run, rawArtifactId, now)
        await onRunCreated?.({ db: transactionDb, run, rawArtifactId, parsedArtifactId })
      },
    })
  const { run, steps, byStage } = await loadRunAndSteps(db, runResult.run.executionRunId)
  let intent = await ensureIngestionIntent(lineageRepository, value, identity, run, rawArtifactId, now)
  if (!['FAILED', 'SUCCEEDED'].includes(intent.status)) {
    intent = await lineageRepository.updateIntent(intent.id, { status: 'RUNNING', nextStageNumber: Math.max(1, intent.nextStageNumber || 1), lastErrorJson: null })
  }
  const runInputForEvents = { ...runInputValue, viewer }
  // These values are filled by the stage actions below. Existing successful
  // attempts reconstruct their immutable inputs from the stored lineage so a
  // replay does not execute a second parse/chunk pass or invent new timestamps.
  let raw = await lineageRepository.findRawById(rawArtifactId)
  let parsed = raw ? await lineageRepository.findParsedById(parsedArtifactId) : null
  let chunks = parsed ? await lineageRepository.listChunks(parsedArtifactId) : []
  let mentions = []
  let classification = null
  let dedup = null
  if (raw?.rawExternalRecordId) value.rawExternalRecordId = raw.rawExternalRecordId
  const localResults = []
  const stage8ForMentions = byStage['DPS-KI-ENTITY-EXTRACT']
  if (!stage8ForMentions) throw serviceError(500, 'GenesisRAG17 run is missing DPS-KI-ENTITY-EXTRACT')
  const local = [
    {
      stageNumber: 1,
      stageId: 'DPS-KI-INGEST',
      recordsIn: 1,
      action: async () => {
        const canonicalRawRecord = await ensureCanonicalRawRecord(db, value, rawArtifactId, now)
        raw = await ensureRaw(lineageRepository, value, rawArtifactId, canonicalRawRecord, now)
        return { recordsIn: 1, recordsOut: 1, details: { artifactId: raw.id, rawExternalRecordId: raw.rawExternalRecordId, contentHash: raw.contentHash, receivedAt: raw.receivedAt.toISOString() } }
      },
    },
    {
      stageNumber: 2,
      stageId: 'DPS-KI-PARSE',
      recordsIn: 1,
      action: async () => {
        if (!raw) throw serviceError(409, 'GenesisRAG17 parsing requires the persisted raw artifact')
        const result = await ensureParsedArtifact(lineageRepository, value, raw.id, parsedArtifactId, now)
        parsed = result.parsed
        return { recordsIn: 1, recordsOut: 1, details: { documentId: value.documentId, parsedArtifactId: parsed.id, structureCount: result.parsedDocument.structure.length, textBlockCount: result.parsedDocument.textBlocks.length, parserVersion: parsed.parserVersion, chunkerVersion: result.parsedDocument.metadata.chunkerVersion, maxTokens: result.parsedDocument.metadata.maxTokens } }
      },
    },
    {
      stageNumber: 3,
      stageId: 'DPS-KI-PROVENANCE',
      recordsIn: 1,
      action: async () => {
        if (!raw || !parsed) throw serviceError(409, 'GenesisRAG17 provenance requires raw and parsed artifacts')
        const parsedAt = atDate(now)
        const provenance = buildSourceProvenance({
          source_id: value.sourceId,
          source_type: value.sourceType,
          source_uri: value.sourceUri,
          source_version: value.version,
          artifact_id: raw.id,
          ingested_at: raw.receivedAt.toISOString(),
          parsed_at: parsedAt.toISOString(),
          pipeline_version: GENESIS_RAG17_PIPELINE_VERSION,
          extractor_version: parsed.parserVersion,
          checksum: raw.contentHash,
        })
        return { recordsIn: 1, recordsOut: 1, details: { provenanceHash: hashGenesisRag17Json(provenance), sourceId: value.sourceId, rawArtifactId: raw.id, parsedArtifactId: parsed.id } }
      },
    },
    {
      stageNumber: 4,
      stageId: 'DPS-KI-NORMALIZE',
      recordsIn: 1,
      action: async () => {
        const normalized = normalizeValue({ value: value.content, kind: 'text' })
        const output = normalized.canonical === null ? value.content : normalized.canonical
        return { recordsIn: 1, recordsOut: 1, details: { normalization: 'rule_v1', canonicalHash: hashGenesisRag17Text(output), rawHash: value.contentHash } }
      },
    },
    {
      stageNumber: 5,
      stageId: 'DPS-KI-CLASSIFY',
      recordsIn: 1,
      action: async () => {
        // The frozen v1 policy carries only the two processing permissions; the
        // six-field scope is still explicit and is validated before indexing.
        classification = { scope: value.scope, policy: value.policy, indexable: value.policy.allowEmbedding, publishable: value.policy.allowPublication }
        return { recordsIn: 1, recordsOut: 1, details: { scope: value.scope, policy: value.policy, indexable: classification.indexable, publishable: classification.publishable } }
      },
    },
    {
      stageNumber: 6,
      stageId: 'DPS-KI-DEDUPE',
      recordsIn: 1,
      action: async () => {
        if (!raw) throw serviceError(409, 'GenesisRAG17 deduplication requires the persisted raw artifact')
        const previous = await lineageRepository.listRawBySource(value.sourceId)
        const candidates = previous.filter((candidate) => candidate.id !== raw.id).map((candidate) => ({
          scope: { tenantId: candidate.tenantId },
          source_id: candidate.sourceId,
          source_version: candidate.version,
          content_hash: candidate.contentHash,
          pipeline_version: candidate.pipelineVersion,
        }))
        dedup = classifyAgainst({ scope: { tenantId: value.scope.tenantId }, source_id: value.sourceId, source_version: value.version, content_hash: value.contentHash, pipeline_version: GENESIS_RAG17_PIPELINE_VERSION }, candidates)
        return { recordsIn: 1, recordsOut: 1, details: { identity, relationship: dedup.relationship, comparedCount: dedup.compared.length, supersededCount: dedup.supersedes ? 1 : 0, warningCount: dedup.warnings.length } }
      },
    },
    {
      stageNumber: 7,
      stageId: 'DPS-KI-CHUNK',
      recordsIn: 1,
      action: async () => {
        if (!raw || !parsed) throw serviceError(409, 'GenesisRAG17 chunking requires raw and parsed artifacts')
        const result = await ensureChunks(lineageRepository, value, raw.id, parsedArtifactId, now)
        chunks = result.chunks
        return { recordsIn: 1, recordsOut: chunks.length, details: { chunkCount: chunks.length, chunkIds: chunks.map((chunk) => chunk.id), exactSourceOffsets: true } }
      },
    },
    {
      stageNumber: 8,
      stageId: 'DPS-KI-ENTITY-EXTRACT',
      recordsIn: () => chunks.length,
      action: async () => {
        if (!chunks.length) throw serviceError(409, 'GenesisRAG17 entity extraction requires persisted chunks')
        mentions = await ensureSourceMentions(lineageRepository, value, run, stage8ForMentions, raw, parsed, chunks, now)
        return { recordsIn: chunks.length, recordsOut: mentions.length, details: { mentionCount: mentions.length, semanticTypes: [...new Set(mentions.map((mention) => mention.semanticType))], recognizer: GENESIS_RAG17_RECOGNIZER_VERSION, recognizerVersion: GENESIS_RAG17_RECOGNIZER_VERSION, recognizerProvenance: GENESIS_RAG17_RECOGNIZER_PROVENANCE, derivationHash: hashGenesisRag17Json(intentDerivation(value)) } }
      },
    },
  ]
  for (const item of local) {
    const stage = byStage[item.stageId]
    if (!stage) throw serviceError(500, `GenesisRAG17 run is missing ${item.stageId}`)
    let result
    try {
      result = await runLocalStage({ db, run, runInputValue: runInputForEvents, identity, stage, stageNumber: item.stageNumber, action: item.action, recordsIn: item.recordsIn, now, idFactory })
    } catch (error) {
      // Stage evidence is already terminal at this point. The intent records
      // the durable stop so a failed local attempt is never mistaken for an
      // interrupted resumable pass.
      await lineageRepository.updateIntent(intent.id, {
        status: 'FAILED',
        nextStageNumber: item.stageNumber,
        lastErrorJson: json({ code: error.code || `GENESISRAG17_STAGE_${item.stageNumber}_FAILED`, message: error.message }),
      })
      throw error
    }
    localResults.push({ stageNumber: item.stageNumber, pipelineStageId: item.stageId, ...result })
    const point = `after-local-stage-${item.stageNumber}`
    const hookDetails = {
      point,
      stageNumber: item.stageNumber,
      pipelineStageId: item.stageId,
      executionRunId: run.executionRunId,
      executionStepId: stage.executionStepId,
      attemptId: stage.attemptId,
    }
    // This is deliberately after runLocalStage's terminal transaction. A
    // process death here leaves both evidence and source artifacts durable;
    // the next source-worker pass can continue with the same attempt ids.
    await faultInjector?.(point, hookDetails)
    await afterLocalStage?.(hookDetails)
    intent = await lineageRepository.updateIntent(intent.id, { status: 'RUNNING', nextStageNumber: item.stageNumber + 1, lastErrorJson: null })
  }

  if (!raw) raw = await lineageRepository.findRawById(rawArtifactId)
  if (!parsed) parsed = await lineageRepository.findParsedById(parsedArtifactId)
  if (!chunks.length) chunks = await lineageRepository.listChunks(parsedArtifactId)
  if (!mentions.length && raw && parsed && chunks.length) mentions = await ensureSourceMentions(lineageRepository, value, run, stage8ForMentions, raw, parsed, chunks, now)
  if (!raw || !parsed || !chunks.length) throw serviceError(409, 'GenesisRAG17 local lineage is incomplete; cannot create the Stage 9 batch')
  intent = await lineageRepository.updateIntent(intent.id, { status: 'RUNNING', nextStageNumber: 9, lastErrorJson: null })
  const { batch, stage9 } = buildBatch({ value, identity, run, steps, rawArtifactId: raw.id, parsedArtifactId: parsed.id, chunks, mentions })
  assertGenesisRag17BatchIntegrity(batch)
  let batchRow = await persistBatch(db, { batch, run, stage9, now, idFactory })
  let response = batchRow.responseJson ? JSON.parse(batchRow.responseJson) : null
  if (!response || batchRow.status === 'PENDING') {
    const runtimeTransport = transport || createMspTransportFromEnvironment(env)
    const runtimeCredential = resolveRuntimeCredential({ scope: value.scope, env, credential })
    response = await deliverBatch({ batch, transport: runtimeTransport, credential: runtimeCredential })
    batchRow = await updateBatchResponse(db, batchRow, response, now)
  }
  intent = await lineageRepository.updateIntent(intent.id, {
    status: batchRow.status === 'PENDING' ? 'RUNNING' : 'SUCCEEDED',
    nextStageNumber: batchRow.status === 'PENDING' ? 9 : 10,
    lastErrorJson: null,
  })
  return {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    status: runResult.status === 'REPLAYED' ? 'REPLAYED' : runResult.status === 'UNCHANGED' && batchRow.status !== 'PENDING' ? 'UNCHANGED' : 'CREATED',
    replayed: runResult.status === 'REPLAYED',
    run: { executionRunId: run.executionRunId, dataPipelineDefinitionId: run.dataPipelineDefinitionId, executionContractId: run.executionContractId, status: run.status, tenantId: run.tenantId, businessId: run.businessId },
    identity,
    source: { ...batch.source },
    chunks: batch.chunks,
    mentions,
    localStages: localResults,
    batch: { batchId: batch.batchId, idempotencyKey: batch.idempotencyKey, stage9, decisionId: batchRow.decisionId, status: batchRow.status },
  }
}

export const ingestGenesisRag17Text = ingestGenesisRag17Raw
export const ingestGenesisRag17Document = ingestGenesisRag17Raw

export { writeStageEvidence, resolveRuntimeCredential }

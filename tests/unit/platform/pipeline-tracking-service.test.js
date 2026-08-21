import { beforeEach, describe, expect, it } from 'vitest'
import { makeOperatorViewer, makeViewer } from '../../factories/viewer'
import {
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  IDENTITY_REFS_EMPTY,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import {
  createPipelineRun,
  createPipelineRunFromWorker,
  getPipelineMonitor,
  listPipelineRuns,
  recordPipelineEvent,
  requestPipelineReplay,
} from '@/platform/integrations/core/pipeline-tracking-service'

// @req FR-071 — the pipeline monitor is a server-owned scope-filtered ledger,
// not a progress percentage or a client-side task projection.
// @spec ADR-030 D3-D6, SDD-042, SEC-003, SEC-008
// @tested tests/unit/platform/pipeline-tracking-service.test.js

const HASH = 'b'.repeat(64)
const BUSINESS = { id: 'b-1', tenantId: 't-1', status: 'ACTIVE' }

function model(rows) {
  const key = (where) => Object.entries(where || {}).find(([name]) => name !== 'AND' && name !== 'OR')
  return {
    rows,
    create: async ({ data }) => {
      const row = { ...data }
      rows.push(row)
      return row
    },
    findUnique: async ({ where }) => {
      const entry = key(where)
      return rows.find((row) => entry && row[entry[0]] === entry[1]) || null
    },
    findFirst: async ({ where } = {}) => {
      const entries = Object.entries(where || {}).filter(([name]) => name !== 'AND' && name !== 'OR')
      return rows.find((row) => entries.every(([name, value]) => {
        if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[name])
        return row[name] === value
      })) || null
    },
    findMany: async ({ where = {}, take } = {}) => {
      const entries = Object.entries(where).filter(([name]) => name !== 'AND' && name !== 'OR')
      const result = rows.filter((row) => entries.every(([name, value]) => {
        if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[name])
        return row[name] === value
      }))
      return typeof take === 'number' ? result.slice(0, take) : result
    },
    update: async ({ where, data }) => {
      const entry = key(where)
      const row = rows.find((candidate) => entry && candidate[entry[0]] === entry[1])
      if (!row) throw new Error('row not found')
      Object.assign(row, data)
      return row
    },
  }
}

function makeDb() {
  const db = {
    business: { findUnique: async ({ where }) => (
      where.id === BUSINESS.id || where.code === 'BUS-SMARTGIFT' ? BUSINESS : null
    ) },
    pipelineRun: model([]),
    pipelineStep: model([]),
    pipelineRecordEvent: model([]),
    pipelineReconciliation: model([]),
    pipelineGateDecision: model([]),
    pipelineEventReceipt: model([]),
    auditEvent: model([]),
  }
  db.$transaction = async (callback) => callback(db)
  return db
}

function runInput(over = {}) {
  return {
    dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
    executionContractId: EXECUTION_CONTRACT_ID,
    businessId: BUSINESS.id,
    sourceRef: 'duckdb://smartgift/business-01',
    sourceSha256: HASH,
    artifactRef: 'artifact://smartgift/export.jsonl',
    artifactSha256: HASH,
    expectedCount: 3,
    bootstrapBatchId: 'batch-1',
    correlationId: 'corr-1',
    idempotencyKey: 'run-key-1',
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    tagIds: [],
    ...over,
  }
}

function event(run, step, over = {}) {
  return {
    eventType: 'STEP_FAILED',
    dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
    executionContractId: EXECUTION_CONTRACT_ID,
    executionRunId: run.executionRunId,
    pipelineStageId: step.pipelineStageId,
    executionStepId: step.executionStepId,
    attemptId: step.attemptId,
    pipelineRecordId: null,
    sourceRecordKey: null,
    sourceRowNumber: null,
    sourceSha256: HASH,
    docId: null,
    picId: null,
    factId: null,
    sourceDocIds: [],
    sourcePicIds: [],
    destinationRecordId: null,
    sequence: step.sequence,
    status: 'FAILED',
    correlationId: 'corr-event-1',
    idempotencyKey: 'event-key-1',
    inputHash: HASH,
    outputHash: null,
    tagIds: [],
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    failureCode: 'SOURCE_ROW_DUPLICATE',
    errorRef: 'err://event-1',
    retryable: false,
    reconciliation: null,
    gate: null,
    ...over,
  }
}

describe('FR-071 pipeline tracking service', () => {
  let db
  let viewer
  let id
  beforeEach(() => {
    db = makeDb()
    viewer = makeOperatorViewer({ visibleBusinessIds: [BUSINESS.id], ownedBusinessIds: [BUSINESS.id] })
    id = 0
  })

  const ids = () => `id-${++id}`

  it('creates all canonical stage occurrences and exact-key idempotent run receipts', async () => {
    const first = await createPipelineRun(runInput(), { db, viewer, idFactory: ids, now: () => new Date('2026-08-21T01:00:00Z') })
    const second = await createPipelineRun(runInput(), { db, viewer, idFactory: ids, now: () => new Date('2026-08-21T01:00:01Z') })

    expect(first.status).toBe('CREATED')
    expect(first.run.status).toBe('QUEUED')
    expect(db.pipelineStep.rows).toHaveLength(10)
    expect(second.status).toBe('UNCHANGED')
    expect(second.run.executionRunId).toBe(first.run.executionRunId)
  })

  it('resolves the SmartGift source namespace to the server-owned Business before creating a run', async () => {
    const input = runInput()
    delete input.businessId
    const result = await createPipelineRunFromWorker({ ...input, businessCode: 'smartgift' }, {
      db,
      viewer,
      idFactory: ids,
    })

    expect(result.status).toBe('CREATED')
    expect(result.run.businessId).toBe(BUSINESS.id)
  })

  it('rejects an unsupported worker source namespace before writing a run', async () => {
    const input = runInput()
    delete input.businessId
    await expect(createPipelineRunFromWorker({ ...input, businessCode: 'other-business' }, { db, viewer }))
      .rejects.toThrow(/unsupported worker businessCode/i)
    expect(db.pipelineRun.rows).toHaveLength(0)
  })

  it('records a failure once, rejects invalid transitions and makes duplicate delivery unchanged', async () => {
    const created = await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const step = db.pipelineStep.rows.find((row) => row.pipelineStageId === 'DPS-SOURCE-SNAPSHOT')
    const failed = await recordPipelineEvent(event(created.run, step), { db, viewer, now: () => new Date('2026-08-21T01:02:00Z') })
    const duplicate = await recordPipelineEvent(event(created.run, step), { db, viewer })

    expect(failed.status).toBe('CREATED')
    expect(failed.step.status).toBe('FAILED')
    expect(duplicate.status).toBe('UNCHANGED')
    expect(db.pipelineRecordEvent.rows).toHaveLength(0)
    expect(db.auditEvent.rows.length).toBeGreaterThan(0)
    await expect(recordPipelineEvent(event(created.run, step, {
      eventType: 'STEP_SUCCEEDED',
      status: 'SUCCEEDED',
      idempotencyKey: 'event-key-2',
      failureCode: null,
      errorRef: null,
      retryable: null,
    }), { db, viewer })).rejects.toThrow(/transition/i)
  })

  it('accepts the Codex bridge start-then-success lifecycle for a schema stage', async () => {
    const created = await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const step = db.pipelineStep.rows.find((row) => row.pipelineStageId === 'DPS-SCHEMA-VALIDATE')
    const started = event(created.run, step, {
      eventType: 'STEP_STARTED',
      status: 'RUNNING',
      idempotencyKey: 'event-start-1',
      failureCode: null,
      errorRef: null,
      retryable: null,
    })
    const succeeded = event(created.run, step, {
      eventType: 'STEP_SUCCEEDED',
      status: 'SUCCEEDED',
      idempotencyKey: 'event-success-1',
      failureCode: null,
      errorRef: null,
      retryable: null,
      outputHash: HASH,
    })

    await recordPipelineEvent(started, { db, viewer })
    const result = await recordPipelineEvent(succeeded, { db, viewer })
    expect(result.step.status).toBe('SUCCEEDED')
    expect(result.run.status).toBe('RUNNING')
  })

  it('returns a redacted monitor with first failure and stale unknown evidence', async () => {
    const created = await createPipelineRun(runInput(), { db, viewer, idFactory: ids, now: () => new Date('2026-08-21T01:00:00Z') })
    const step = db.pipelineStep.rows.find((row) => row.pipelineStageId === 'DPS-SOURCE-SNAPSHOT')
    await recordPipelineEvent(event(created.run, step), { db, viewer, now: () => new Date('2026-08-21T01:01:00Z') })
    const monitor = await getPipelineMonitor(created.run.executionRunId, {
      db,
      viewer,
      now: new Date('2026-08-21T02:00:00Z'),
      staleAfterMs: 5 * 60 * 1000,
    })

    expect(monitor.status).toBe('UNKNOWN')
    expect(monitor.firstFailure).toMatchObject({ pipelineStageId: 'DPS-SOURCE-SNAPSHOT', failureCode: 'SOURCE_ROW_DUPLICATE' })
    expect(monitor.stageTimeline).toHaveLength(10)
    expect(monitor).not.toHaveProperty('payloadJson')
    expect(JSON.stringify(monitor)).not.toContain('sourceRef')
  })

  it('creates a new queued replay with immutable lineage and no worker-success claim', async () => {
    const source = await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const replay = await requestPipelineReplay(source.run.executionRunId, {
      scope: 'FULL_RUN',
      correlationId: 'corr-replay-1',
      idempotencyKey: 'replay-key-1',
      sourceSha256: HASH,
      artifactSha256: HASH,
    }, { db, viewer, idFactory: ids })
    const duplicate = await requestPipelineReplay(source.run.executionRunId, {
      scope: 'FULL_RUN',
      correlationId: 'corr-replay-1',
      idempotencyKey: 'replay-key-1',
      sourceSha256: HASH,
      artifactSha256: HASH,
    }, { db, viewer, idFactory: ids })

    expect(replay.status).toBe('CREATED')
    expect(replay.run.status).toBe('QUEUED')
    expect(replay.run.replayOfExecutionRunId).toBe(source.run.executionRunId)
    expect(replay.workerExecution).toBe('PENDING')
    expect(duplicate.status).toBe('UNCHANGED')
    expect(replay.run.executionRunId).not.toBe(source.run.executionRunId)
  })

  it('lists only visible Business runs', async () => {
    await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const readViewer = makeViewer({ visibleBusinessIds: [BUSINESS.id], ownedBusinessIds: [] })
    await expect(listPipelineRuns({ businessId: 'b-other', db, viewer: readViewer })).rejects.toThrow(/scope|visible|not found/i)
    const result = await listPipelineRuns({ businessId: BUSINESS.id, db, viewer: readViewer })
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).not.toHaveProperty('identityRefs')
  })
})

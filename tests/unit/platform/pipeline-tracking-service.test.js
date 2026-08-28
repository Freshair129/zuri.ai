import { beforeEach, describe, expect, it } from 'vitest'
import { makeOperatorViewer, makeViewer } from '../../factories/viewer'
import {
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  IDENTITY_REFS_EMPTY,
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  KNOWLEDGE_INGESTION_STAGE_CATALOG,
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

  // @req FR-109 — a knowledge ingestion run materializes its own seventeen
  // stages, and the ten-stage Supabase run above is unaffected (SDD-066).
  it('materializes the seventeen knowledge stages for a knowledge ingestion run', async () => {
    const created = await createPipelineRun(runInput({
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      idempotencyKey: 'ki-run-1',
    }), { db, viewer, idFactory: ids, now: () => new Date('2026-08-28T01:00:00Z') })

    expect(created.stageCount).toBe(17)
    expect(db.pipelineStep.rows.map((row) => row.pipelineStageId))
      .toEqual(KNOWLEDGE_INGESTION_STAGE_CATALOG.map((stage) => stage.pipelineStageId))
    // Sequence is persisted and the step board sorts on it (ADR-050 D1); a
    // catalog materialized from the wrong definition would put every step at
    // the wrong number rather than fail visibly.
    expect(db.pipelineStep.rows.map((row) => row.sequence))
      .toEqual(KNOWLEDGE_INGESTION_STAGE_CATALOG.map((stage) => stage.sequence))
  })

  it('refuses a knowledge definition claimed under the FR-071 execution contract', async () => {
    await expect(createPipelineRun(runInput({
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      idempotencyKey: 'ki-run-2',
    }), { db, viewer, idFactory: ids })).rejects.toThrow()
    expect(db.pipelineRun.rows).toHaveLength(0)
  })

  // @req FR-109 — the envelope is internally consistent on its own; this is the
  // half it cannot see. Before SDD-066 both z.literal pins made every event and
  // every run the same definition, so they always matched trivially. Once a
  // second definition exists, an event can be a valid knowledge envelope and
  // still be aimed at a Supabase run, and the stage refinement — which reads the
  // event's OWN definition — would have approved DPS-KI-EMBED on it.
  it('refuses an event whose definition is not the definition of the run it names', async () => {
    const created = await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const stepsBefore = db.pipelineStep.rows.length

    await expect(recordPipelineEvent(event(created.run, { pipelineStageId: 'DPS-KI-EMBED', executionStepId: 'step-x', attemptId: 'attempt-x', sequence: 150 }, {
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    }), { db, viewer, idFactory: ids })).rejects.toThrow()

    expect(db.pipelineStep.rows).toHaveLength(stepsBefore)
    expect(db.pipelineEventReceipt.rows).toHaveLength(0)
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

  // @req NFR-020 — per-stage counts (SDD-070): actualCount is records_in,
  // insertedCount is records_out, failedCount is records_failed. Columns that
  // have existed on PipelineStep since FR-071 and that nothing wrote until now.
  it('persists NFR-020 per-stage counts only when the event supplies them', async () => {
    const created = await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const step = db.pipelineStep.rows.find((row) => row.pipelineStageId === 'DPS-SCHEMA-VALIDATE')
    await recordPipelineEvent(event(created.run, step, {
      eventType: 'STEP_STARTED', status: 'RUNNING', idempotencyKey: 'event-start-counts',
      failureCode: null, errorRef: null, retryable: null,
    }), { db, viewer })
    const succeeded = await recordPipelineEvent(event(created.run, step, {
      eventType: 'STEP_SUCCEEDED', status: 'SUCCEEDED', idempotencyKey: 'event-success-counts',
      failureCode: null, errorRef: null, retryable: null,
      actualCount: 7, insertedCount: 5, failedCount: 2,
    }), { db, viewer })

    expect(succeeded.step.actualCount).toBe(7)
    expect(succeeded.step.insertedCount).toBe(5)
    expect(succeeded.step.failedCount).toBe(2)

    // The execution monitor reads `run.actualCount` / `run.failedCount`
    // directly (mode-bodies.jsx) — @default(0), never aggregated from steps
    // until this change. A step-only fix leaves the board showing
    // Expected 17 / Actual 0 / Failed 0 regardless of what happened.
    expect(succeeded.run.actualCount).toBe(7)
    expect(succeeded.run.insertedCount).toBe(5)
    expect(succeeded.run.failedCount).toBe(2)
  })

  it('aggregates the run’s counts across every step that has reported one, not just the latest', async () => {
    const created = await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const schemaStep = db.pipelineStep.rows.find((row) => row.pipelineStageId === 'DPS-SCHEMA-VALIDATE')
    const reconcileStep = db.pipelineStep.rows.find((row) => row.pipelineStageId === 'DPS-RECONCILE')

    await recordPipelineEvent(event(created.run, schemaStep, {
      eventType: 'STEP_STARTED', status: 'RUNNING', idempotencyKey: 'agg-start-1',
      failureCode: null, errorRef: null, retryable: null,
    }), { db, viewer })
    await recordPipelineEvent(event(created.run, schemaStep, {
      eventType: 'STEP_SUCCEEDED', status: 'SUCCEEDED', idempotencyKey: 'agg-success-1',
      failureCode: null, errorRef: null, retryable: null,
      actualCount: 3, insertedCount: 3, failedCount: 0,
    }), { db, viewer })
    await recordPipelineEvent(event(created.run, reconcileStep, {
      eventType: 'STEP_STARTED', status: 'RUNNING', idempotencyKey: 'agg-start-2',
      failureCode: null, errorRef: null, retryable: null,
    }), { db, viewer })
    const secondSucceeded = await recordPipelineEvent(event(created.run, reconcileStep, {
      eventType: 'STEP_SUCCEEDED', status: 'SUCCEEDED', idempotencyKey: 'agg-success-2',
      failureCode: null, errorRef: null, retryable: null,
      actualCount: 4, insertedCount: 2, failedCount: 1,
    }), { db, viewer })

    // 3+4=7, 3+2=5, 0+1=1 — the sum across both steps, not the second
    // event's own numbers standing alone.
    expect(secondSucceeded.run.actualCount).toBe(7)
    expect(secondSucceeded.run.insertedCount).toBe(5)
    expect(secondSucceeded.run.failedCount).toBe(1)
  })

  it('leaves the run’s counts untouched by an event that reports none', async () => {
    const created = await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const step = db.pipelineStep.rows.find((row) => row.pipelineStageId === 'DPS-SCHEMA-VALIDATE')
    await recordPipelineEvent(event(created.run, step, {
      eventType: 'STEP_STARTED', status: 'RUNNING', idempotencyKey: 'noagg-start',
      failureCode: null, errorRef: null, retryable: null,
    }), { db, viewer })
    const succeeded = await recordPipelineEvent(event(created.run, step, {
      eventType: 'STEP_SUCCEEDED', status: 'SUCCEEDED', idempotencyKey: 'noagg-success',
      failureCode: null, errorRef: null, retryable: null,
      // no counts — a plain success from the Supabase migration path, as
      // every existing caller sends it today
    }), { db, viewer })

    expect(succeeded.run.actualCount).toBe(0)
    expect(succeeded.run.failedCount).toBe(0)
  })

  it('never overwrites an already-recorded count with a later event that omits it', async () => {
    const created = await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const step = db.pipelineStep.rows.find((row) => row.pipelineStageId === 'DPS-SCHEMA-VALIDATE')
    await recordPipelineEvent(event(created.run, step, {
      eventType: 'STEP_STARTED', status: 'RUNNING', idempotencyKey: 'event-start-2',
      failureCode: null, errorRef: null, retryable: null,
      actualCount: 4, // an unusual but valid shape: counts known at start
    }), { db, viewer })
    const succeeded = await recordPipelineEvent(event(created.run, step, {
      eventType: 'STEP_SUCCEEDED', status: 'SUCCEEDED', idempotencyKey: 'event-success-2',
      failureCode: null, errorRef: null, retryable: null,
      // No counts on this event — heartbeats and plain success events from
      // every existing caller (the Supabase migration path) never supply
      // them, and writing `undefined` here must not clobber the 4 already
      // recorded. Omission is not zero.
    }), { db, viewer })

    expect(succeeded.step.actualCount).toBe(4)
  })

  // NFR-020's run-level aggregate sums every `PipelineStep` row sharing the
  // run's id — it assumes ONE step row per stage per run. Nothing that
  // creates steps today violates that (SDD-069 materializes exactly one at
  // run creation and reuses it; replay creates steps under a NEW run id, so
  // they are never summed into the original). But `(runId, pipelineStageId)`
  // carries no uniqueness constraint, only a non-unique index — so a second
  // `executionStepId` for a stage already run in this run IS constructible,
  // and today's aggregation would sum both rows: a stage retried in place
  // would double its own records_in rather than reporting the true count.
  // Pinned here, not fixed: retry-within-run does not exist for any caller
  // yet, and building retry-aware aggregation ahead of a real one would be
  // guessing at a shape nothing has asked for. The day it does, this test
  // fails and says why, instead of a wrong number reaching the monitor.
  it('sums every step row sharing a stage — an intentional gap, not a guarantee, until retry-within-run exists', async () => {
    const created = await createPipelineRun(runInput(), { db, viewer, idFactory: ids })
    const step = db.pipelineStep.rows.find((row) => row.pipelineStageId === 'DPS-SCHEMA-VALIDATE')
    await recordPipelineEvent(event(created.run, step, {
      eventType: 'STEP_STARTED', status: 'RUNNING', idempotencyKey: 'retry-attempt-1-start',
      failureCode: null, errorRef: null, retryable: null,
    }), { db, viewer })
    await recordPipelineEvent(event(created.run, step, {
      eventType: 'STEP_SUCCEEDED', status: 'SUCCEEDED', idempotencyKey: 'retry-attempt-1',
      failureCode: null, errorRef: null, retryable: null,
      actualCount: 5, insertedCount: 5, failedCount: 0,
    }), { db, viewer })

    // A second attempt at the SAME stage, under a fresh executionStepId --
    // nothing in this repo constructs this today, but nothing prevents it. A
    // freshly auto-created step starts NOT_STARTED, so it needs the same
    // STARTED -> SUCCEEDED lifecycle any step does.
    const retryStep = { pipelineStageId: step.pipelineStageId, executionStepId: 'step-retry-2', attemptId: 'attempt-retry-2', sequence: step.sequence }
    await recordPipelineEvent(event(created.run, retryStep, {
      eventType: 'STEP_STARTED', status: 'RUNNING', idempotencyKey: 'retry-attempt-2-start',
      failureCode: null, errorRef: null, retryable: null,
    }), { db, viewer })
    const secondAttempt = await recordPipelineEvent(event(created.run, retryStep, {
      eventType: 'STEP_SUCCEEDED', status: 'SUCCEEDED', idempotencyKey: 'retry-attempt-2',
      failureCode: null, errorRef: null, retryable: null,
      actualCount: 5, insertedCount: 5, failedCount: 0,
    }), { db, viewer })

    // Documented current behaviour: 10, not 5 -- the sum of both attempts'
    // records_in, not the true count of 5 records the stage actually saw.
    expect(secondAttempt.run.actualCount).toBe(10)
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

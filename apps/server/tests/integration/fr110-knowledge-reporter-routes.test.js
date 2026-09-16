import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import { mintSotDataPlaneKey } from '@/modules/identity/sot-data-plane-auth'
import { ingestKnowledgeDocument } from '@/platform/integrations/core/knowledge-ingestion-executor'
import {
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import { GET as GET_JOB } from '@/app/api/pipelines/knowledge/[executionRunId]/route'
import { POST as POST_STAGE } from '@/app/api/pipelines/knowledge/[executionRunId]/stages/route'
import { POST as POST_GATE } from '@/app/api/pipelines/knowledge/[executionRunId]/gate/route'
import { POST as POST_FINISH } from '@/app/api/pipelines/knowledge/[executionRunId]/finish/route'

// @req FR-110 — the four reporter verbs authenticate a bearer `sdpk_` key
// end-to-end through the actual route handlers; a call with no credential
// still 401s exactly as every other route does.
// @spec ADR-067 D1, ADR-047 D3
// @tested tests/integration/fr110-knowledge-reporter-routes.test.js

let key
let tenantId
let businessId
let run

const T0 = '2026-09-07T11:00:00.000Z'
const T1 = '2026-09-07T11:00:20.000Z'

const call = (handler, executionRunId, body, headers = {}, method = 'POST') => handler(
  new Request(`http://local/api/pipelines/knowledge/${executionRunId}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }),
  { params: { executionRunId } },
)

const bearer = () => ({ authorization: `Bearer ${key}` })

async function stepFor(stageId) {
  const row = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })
  return prisma.pipelineStep.findFirst({ where: { runId: row.id, pipelineStageId: stageId } })
}

async function stageBody(stageId) {
  const step = await stepFor(stageId)
  return {
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    executionRunId: run.executionRunId,
    pipelineStageId: stageId,
    executionStepId: step.executionStepId,
    attemptId: step.attemptId,
    scope: { tenantId, businessId },
    outcome: 'SUCCEEDED',
    failure: null,
    startedAt: T0,
    finishedAt: T1,
    metrics: { records_in: 5, records_out: 5, records_failed: 0, records_quarantined: 0, processing_time: 20, retry_count: 0 },
  }
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'KI Reporter Route Group', code: 'PF-KIRR' })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: 'KI Reporter Route Tenant', code: 'TNT-KIRR' })
  const business = await createBusiness({ tenantId: tenant.id, name: 'KI Reporter Route Business', code: 'BUS-KIRR' })
  tenantId = tenant.id
  businessId = business.id
  key = (await mintSotDataPlaneKey({ label: 'route-reporter', tenantId: tenant.id })).key
  const operator = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  run = (await ingestKnowledgeDocument({
    documentId: 'doc-fr110-route',
    text: '# Scope\n\nบริษัท เอบีซี จำกัด delivers the console.',
    artifact: {
      scope: { tenantId, businessId }, artifact_id: 'art-fr110-route', source_id: 'src://drive/fr110-route.md',
      source_type: 'FILE', source_uri: 'https://drive.example/fr110-route.md', source_version: 'route-1',
      content_hash: 'b'.repeat(64), pipeline_version: 'ki-1.0.0', ingested_at: '2026-09-07T09:00:00Z',
      parsed_at: '2026-09-07T09:00:05Z', extractor_version: 'ki-parse-1',
    },
    policy: { sensitivity: 'INTERNAL', retention_policy: 'RETAIN_7Y', export_policy: 'NO_EXPORT', cloud_processing_allowed: true, embedding_allowed: true },
  }, { viewer: operator })).run
})

describe('/api/pipelines/knowledge/{executionRunId} (FR-110, ADR-067)', () => {
  it('GET with the Tenant’s data-plane key reads the job, its state and the step identities to echo', async () => {
    const res = await call(GET_JOB, run.executionRunId, null, bearer(), 'GET')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.pipelineJobId).toBe(run.executionRunId)
    expect(json.job.state).toBe('PROCESSING')
    expect(json.stages).toHaveLength(17)
    expect(json.stages.find((s) => s.pipelineStageId === 'DPS-KI-ENTITY-RESOLVE')).toMatchObject({ status: 'NOT_STARTED' })
  })

  it('POST stages and gate succeed, while legacy finish remains refused without publication evidence', async () => {
    for (const stageId of KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS) {
      const res = await call(POST_STAGE, run.executionRunId, await stageBody(stageId), bearer())
      expect(res.status, stageId).toBe(200)
      expect((await res.json()).outcome).toBe('SUCCEEDED')
    }

    const gateStep = await stepFor(KNOWLEDGE_QUALITY_GATE_STAGE_ID)
    const gateRes = await call(POST_GATE, run.executionRunId, {
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      executionRunId: run.executionRunId,
      pipelineStageId: KNOWLEDGE_QUALITY_GATE_STAGE_ID,
      executionStepId: gateStep.executionStepId,
      attemptId: gateStep.attemptId,
      scope: { tenantId, businessId },
      ledgerStatus: 'APPROVED',
      verdict: 'PASS',
      snapshot: {
        knowledge_snapshot_id: 'ks_route_1', tenant_id: tenantId, business_id: businessId,
        ontology_version: 'onto-1', pipeline_version: 'ki-1.0.0', published_at: T1,
        statistics: { documents: 1, chunks: 3, entities: 2, facts: 4, relations: 1 },
      },
      dimensions: Object.fromEntries(['data', 'graph', 'knowledge', 'security', 'retrieval'].map((d) => [d, { result: 'PASS', critical: false }])),
      startedAt: T0,
      finishedAt: T1,
    }, bearer())
    expect(gateRes.status).toBe(200)
    expect((await gateRes.json()).gate.evidence.verdict).toBe('PASS')

    const finishRes = await call(POST_FINISH, run.executionRunId, {
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      executionRunId: run.executionRunId,
      scope: { tenantId, businessId },
      finishedAt: T1,
    }, bearer())
    expect(finishRes.status).toBe(409)
    expect(await finishRes.json()).toMatchObject({ error: 'Successful finish requires an attempt-bound publication receipt; legacy evidence remains readable' })

    const read = await (await call(GET_JOB, run.executionRunId, null, bearer(), 'GET')).json()
    expect(read.job.state).toBe('READY_TO_PUBLISH')
  })

  it('a body naming another run than the route is refused (400)', async () => {
    const mismatch = await call(POST_STAGE, 'some-other-run', await stageBody('DPS-KI-ENRICH'), bearer())
    expect(mismatch.status).toBe(400)
  })

  it('no credential at all is refused on every verb (unchanged 401 behaviour)', async () => {
    expect((await call(GET_JOB, run.executionRunId, null, {}, 'GET')).status).toBe(401)
    expect((await call(POST_STAGE, run.executionRunId, await stageBody('DPS-KI-ENRICH'))).status).toBe(401)
    expect((await call(POST_GATE, run.executionRunId, { executionRunId: run.executionRunId })).status).toBe(401)
    expect((await call(POST_FINISH, run.executionRunId, { executionRunId: run.executionRunId })).status).toBe(401)
  })
})

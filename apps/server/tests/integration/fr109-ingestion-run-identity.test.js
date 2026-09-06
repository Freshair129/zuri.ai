import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import { createPipelineRun } from '@/platform/integrations/core/pipeline-tracking-service'
import { KNOWLEDGE_INGESTION_STAGE_CATALOG } from '@/platform/integrations/core/pipeline-tracking-contract'
import { knowledgeIngestionRunInput } from '@/modules/knowledge/ingestion-job'
import { ingestionIdentity } from '@/modules/knowledge/dedup'

// @req FR-109 — BR-021's ingestion identity is persisted as the run key, so a
// re-ingested artifact returns the run that already exists.
// @spec BR-021, SEC-021, SDD-067, SDD-066, ADR-050 D4
// @tested tests/integration/fr109-ingestion-run-identity.test.js
//
// This suite runs against the real database on purpose. The unit suite proves
// the SERVICE returns UNCHANGED, using an in-memory fake whose `create` does not
// implement `@unique` at all — so it can never fail the way a duplicate key
// fails, and a passing green there says nothing about the constraint. The claim
// under test here is that the guarantee is held by the database, and only the
// database can be asked.

const HASH = 'd'.repeat(64)

let viewer
let businessId
let tenantId

function artifact(over = {}) {
  return {
    scope: { tenantId, businessId },
    artifact_id: 'art-fr109-1',
    source_id: 'src://drive/policy.md',
    source_uri: 'https://drive.example/policy.md',
    source_version: '1',
    content_hash: HASH,
    pipeline_version: 'ki-1.0.0',
    ...over,
  }
}

const ingest = (a) => createPipelineRun(knowledgeIngestionRunInput(a), { viewer })

describe('FR-109 ingestion identity is the run key', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'KI Group', code: 'PF-KI109' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'KI Tenant', code: 'TNT-KI109' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'KI Business', code: 'BUS-KI109' })
    businessId = business.id
    tenantId = tenant.id
    viewer = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  it('registers one run under the artifact’s ingestion identity', async () => {
    const created = await ingest(artifact())

    expect(created.status).toBe('CREATED')
    expect(created.stageCount).toBe(17)
    const run = await prisma.pipelineRun.findUnique({ where: { idempotencyKey: ingestionIdentity(artifact()) } })
    expect(run).not.toBeNull()
    expect(run.dataPipelineDefinitionId).toBe('DPL-KNOWLEDGE-INGEST-V1')
    expect(run.tenantId).toBe(tenantId)
  })

  it('materializes exactly the seventeen knowledge stages, in sequence', async () => {
    const run = await prisma.pipelineRun.findUnique({ where: { idempotencyKey: ingestionIdentity(artifact()) } })
    const steps = await prisma.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })

    expect(steps.map((step) => step.pipelineStageId))
      .toEqual(KNOWLEDGE_INGESTION_STAGE_CATALOG.map((stage) => stage.pipelineStageId))
  })

  it('re-ingesting the same artifact returns the existing run and writes nothing', async () => {
    // Not merely "no second run": no second step either. A run created and then
    // rolled back would still satisfy a count of one at the end.
    const before = await prisma.pipelineStep.count()
    const again = await ingest(artifact())

    expect(again.status).toBe('UNCHANGED')
    expect(await prisma.pipelineRun.count({ where: { idempotencyKey: ingestionIdentity(artifact()) } })).toBe(1)
    expect(await prisma.pipelineStep.count()).toBe(before)
  })

  it('re-ingests without a 409, which a caller-supplied correlation id would have caused', async () => {
    // SDD-067. `createPipelineRun` compares requestHash and not only the key, so
    // this passes only because every field of the input is derived. It is the
    // regression test for the trap, not a restatement of the case above.
    await expect(ingest(artifact())).resolves.toMatchObject({ status: 'UNCHANGED' })
    await expect(ingest({ ...artifact(), correlationId: 'req-9999' })).resolves.toMatchObject({ status: 'UNCHANGED' })
  })

  it('treats a new source version as new knowledge rather than a duplicate', async () => {
    const created = await ingest(artifact({ source_version: '2' }))
    expect(created.status).toBe('CREATED')
    // Scoped to this test's own Business, not to the definition globally --
    // other suites now register DPL-KNOWLEDGE-INGEST-V1 runs of their own
    // (tests/integration/fr109-knowledge-ingestion-executor.test.js) in the
    // same shared test database, and an unscoped count would fail depending
    // on file execution order rather than on what this test actually did.
    expect(await prisma.pipelineRun.count({ where: { dataPipelineDefinitionId: 'DPL-KNOWLEDGE-INGEST-V1', businessId } })).toBe(2)
  })

  it('treats a reparse under a new pipeline version as new knowledge', async () => {
    const created = await ingest(artifact({ pipeline_version: 'ki-1.1.0' }))
    expect(created.status).toBe('CREATED')
  })

  it('lets the database, not the service, be the thing that cannot hold two', async () => {
    // The constraint itself. If PipelineRun.idempotencyKey ever stopped being
    // @unique, every test above would still pass — the service checks first and
    // returns UNCHANGED before it would ever insert. This is the only assertion
    // in the suite that fails when the guarantee moves out of the database.
    const existing = await prisma.pipelineRun.findUnique({
      where: { idempotencyKey: ingestionIdentity(artifact()) },
    })

    const row = (over) => ({
      data: {
        executionRunId: `exec-fr109-${over.idempotencyKey}`,
        dataPipelineDefinitionId: existing.dataPipelineDefinitionId,
        executionContractId: existing.executionContractId,
        tenantId: existing.tenantId,
        businessId: existing.businessId,
        correlationId: 'corr-fr109-duplicate',
        requestHash: 'deliberately-different',
        ...over,
      },
    })

    // The control: the identical row with a fresh key inserts. Without it, this
    // test would pass just as well if the insert were failing on a missing
    // column — proving nothing about uniqueness.
    await expect(prisma.pipelineRun.create(row({ idempotencyKey: 'fr109-control-key' }))).resolves.toBeTruthy()

    await expect(prisma.pipelineRun.create(row({ idempotencyKey: existing.idempotencyKey })))
      .rejects.toThrow(/unique/i)
  })

  it('refuses a second tenant’s byte-identical document as a separate run, never a duplicate', async () => {
    // SEC-021 at the persistence boundary: the tenant is inside the hash
    // (SDD-065), so the two cannot collide even if a later reader wanted them to.
    const other = await createTenant({
      portfolioId: (await prisma.tenant.findUnique({ where: { id: tenantId } })).portfolioId,
      name: 'KI Tenant B',
      code: 'TNT-KI109B',
    })
    const otherBusiness = await createBusiness({ tenantId: other.id, name: 'KI Business B', code: 'BUS-KI109B' })
    const otherViewer = makeOperatorViewer({
      visibleBusinessIds: [otherBusiness.id],
      ownedBusinessIds: [otherBusiness.id],
    })

    const created = await createPipelineRun(
      knowledgeIngestionRunInput(artifact({ scope: { tenantId: other.id, businessId: otherBusiness.id } })),
      { viewer: otherViewer },
    )

    expect(created.status).toBe('CREATED')
    expect(created.run.executionRunId).toBeTruthy()
  })
})

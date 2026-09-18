import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import {
  listConsoleSources,
  readConsoleSource,
  listConsoleRuns,
  readConsoleRun,
  listConsoleCorpora,
} from '@/modules/knowledge/knowledge-console-service'
import { makeViewer } from '../factories/viewer'
import { createKnowledgeConsoleRepository } from '@/modules/knowledge/knowledge-console-repository'
import { KNOWLEDGE_INGESTION_DEFINITION_ID, KNOWLEDGE_INGESTION_CONTRACT_ID } from '@/platform/integrations/core/pipeline-tracking-contract'

// @req FR-254 — the console pages real persisted history with current authority,
// including legacy runs, without disclosing hidden sources or ingestion bodies.
// @spec SEC-001, SEC-008, ADR-072
// @tested tests/integration/fr254-knowledge-console.test.js

const unique = (prefix) => `${prefix}-${randomUUID()}`
const equalTime = new Date('2026-09-17T01:00:00.000Z')

async function fixture() {
  const portfolioId = unique('portfolio')
  const tenantId = unique('tenant')
  await prisma.portfolio.create({ data: { id: portfolioId, code: unique('PF'), name: 'Console portfolio' } })
  await prisma.tenant.create({ data: { id: tenantId, portfolioId, code: unique('TEN'), name: 'Console tenant' } })

  async function business() {
    const businessId = unique('business')
    await prisma.business.create({ data: { id: businessId, tenantId, code: unique('BUS'), name: 'Console business' } })
    const workspaceId = unique('workspace')
    await prisma.workspace.create({ data: { id: workspaceId, code: unique('WS'), name: 'Console workspace', scopeType: 'BUSINESS', portfolioId, tenantId, businessId } })
    return { portfolioId, tenantId, businessId, workspaceId }
  }

  async function project(scope) {
    return prisma.project.create({ data: { id: unique('project'), code: unique('PRJ'), name: 'Console project', businessId: scope.businessId, workspaceId: scope.workspaceId } })
  }

  async function corpus(scope, projectId = null) {
    return prisma.knowledgeCorpus.create({ data: {
      ...scope, id: unique('corpus'), corpusKey: unique('corpus-key'), projectId,
      scopeJson: JSON.stringify({ ...scope, agentId: 'console-test-agent', visibility: 'private' }),
      policyJson: JSON.stringify({ allowEmbedding: true, allowPublication: true }),
    } })
  }

  async function source(corpusRow, over = {}) {
    return prisma.knowledgeSource.create({ data: {
      id: unique('source'), corpusId: corpusRow.id, sourceKey: unique('source-key'),
      kind: 'TEXT', title: 'Visible source', createdAt: equalTime, ...over,
    } })
  }

  async function ingestion(corpusRow, sourceRow, revision, over = {}) {
    return prisma.knowledgeIngestion.create({ data: {
      id: unique('ingestion'), corpusId: corpusRow.id, sourceId: sourceRow.id, revision,
      sourceVersion: `v${revision}`, contentHash: 'a'.repeat(64),
      content: 'PRIVATE INGESTION BODY', sourceMetaJson: '{"secret":"PRIVATE SOURCE META"}',
      claimToken: 'PRIVATE WORKER CLAIM', idempotencyKey: unique('admission-key'),
      requestHash: 'b'.repeat(64), createdAt: new Date(equalTime.valueOf() + revision), ...over,
    } })
  }

  async function run(scope, over = {}) {
    return prisma.pipelineRun.create({ data: {
      id: unique('pipeline'), executionRunId: unique('execution'), tenantId: scope.tenantId,
      businessId: scope.businessId, dataPipelineDefinitionId: 'legacy-import-v1',
      executionContractId: 'legacy-import-contract-v1', status: 'SUCCEEDED',
      correlationId: unique('correlation'), idempotencyKey: unique('pipeline-key'),
      requestHash: 'c'.repeat(64), ...over,
    } })
  }

  const a = await business()
  const b = await business()
  const aCorpus = await corpus(a)
  const bCorpus = await corpus(b)
  const viewer = makeViewer({ visibleBusinessIds: [a.businessId], visibleDomains: ['knowledge', 'projects'] })
  // Historical browsing must not depend on execution being configured/enabled.
  const options = { db: prisma, viewer, env: { ZURI_KNOWLEDGE_ENABLED: '0' } }
  return { a, b, aCorpus, bCorpus, project, corpus, source, ingestion, run, options }
}

async function sameNotFound(actual, missing) {
  const results = await Promise.allSettled([actual, missing])
  for (const result of results) expect(result.status).toBe('rejected')
  const errors = results.map(({ reason }) => ({ status: reason.status, message: reason.message, code: reason.code }))
  expect(errors[0].status).toBe(404)
  expect(errors[0]).toEqual(errors[1])
}

describe('FR-254 knowledge console real Prisma read boundary', () => {
  let f
  beforeEach(async () => { f = await fixture() })
  afterEach(async () => {
    await prisma.knowledgeIngestion.deleteMany({ where: { corpus: { businessId: { in: [f.a.businessId, f.b.businessId] } } } })
  })

  it.each(['missing-receipt', 'missing-artifact-reference'])('keeps a claimed published run readable with %s and withholds unverified snapshot metadata', async (missing) => {
    const source = await f.source(f.aCorpus)
    const run = await f.run(f.a, {
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    })
    const ingestion = await f.ingestion(f.aCorpus, source, 1, {
      status: 'PUBLISHED', executionRunId: run.executionRunId,
      rawArtifactId: missing === 'missing-artifact-reference' ? null : unique('raw'),
      parsedArtifactId: unique('parsed'), snapshotId: unique('unverified-snapshot'),
      snapshotGeneration: 'UNVERIFIED GENERATION', receiptHash: 'd'.repeat(64),
    })
    const detail = await readConsoleRun(run.executionRunId, f.options)
    expect(detail.run).toMatchObject({ executionRunId: run.executionRunId, sourceId: source.id, admissionId: ingestion.id })
    expect(detail.publication).toMatchObject({ state: 'UNAVAILABLE', verified: false })
    expect(detail.publication).not.toHaveProperty('snapshotId')
    expect(detail.publication).not.toHaveProperty('generation')
    expect(detail.publication).not.toHaveProperty('receiptHash')
    expect(JSON.stringify(detail)).not.toContain(ingestion.snapshotId)
    expect(JSON.stringify(detail)).not.toContain(ingestion.snapshotGeneration)
  })

  it('rejects the response when a later current-viewer refresh observes revoked access', async () => {
    const source = await f.source(f.aCorpus, { title: 'PRIVATE FINAL REFRESH TITLE' })
    let refreshes = 0
    const denied = makeViewer({ visibleBusinessIds: [], visibleDomains: [] })
    const result = await listConsoleSources({ businessId: f.a.businessId }, {
      ...f.options,
      resolveCurrentViewer: async () => ++refreshes === 1 ? f.options.viewer : denied,
    }).then((value) => ({ value }), (error) => ({ error: { status: error.status, message: error.message } }))
    expect(refreshes).toBeGreaterThan(1)
    expect(result).toMatchObject({ error: { status: 404 } })
    expect(result).not.toHaveProperty('value')
    expect(JSON.stringify(result)).not.toContain(source.title)
  })

  it('does not expose an ingestion from another corpus through a corrupt source association', async () => {
    const source = await f.source(f.aCorpus)
    const ingestion = await f.ingestion(f.bCorpus, source, 1, {
      sourceVersion: 'PRIVATE FOREIGN SOURCE VERSION', executionRunId: unique('private-foreign-run'),
    })
    const page = await listConsoleSources({ businessId: f.a.businessId }, f.options)
    expect(page.items).toEqual([])
    expect(JSON.stringify(page)).not.toContain(ingestion.sourceVersion)
    expect(JSON.stringify(page)).not.toContain(ingestion.executionRunId)
  })

  it('preserves every terminal attempt for a legacy stage without exposing internal error payloads', async () => {
    const run = await f.run(f.a)
    const attempts = []
    for (const [index, status] of ['FAILED', 'SUCCEEDED'].entries()) {
      attempts.push(await prisma.pipelineStep.create({ data: {
        executionStepId: unique('step'), attemptId: unique('attempt'), runId: run.id,
        pipelineStageId: 'legacy-parse', sequence: 1, status,
        createdAt: new Date(equalTime.valueOf() + index), finishedAt: new Date(equalTime.valueOf() + index + 1),
        errorRef: index === 0 ? 'PRIVATE INTERNAL ERROR PAYLOAD' : null,
        identityRefsJson: '{"internal":"PRIVATE INTERNAL IDENTITY"}',
      } }))
    }
    const detail = await readConsoleRun(run.executionRunId, f.options)
    expect(detail.steps.map((step) => step.attemptId)).toEqual(attempts.map((step) => step.attemptId))
    expect(detail.steps.map((step) => step.status)).toEqual(['FAILED', 'SUCCEEDED'])
    expect(JSON.stringify(detail)).not.toContain('PRIVATE INTERNAL')
  })

  it('withholds loaded source titles when the current viewer loses access during a slow read', async () => {
    const source = await f.source(f.aCorpus, { title: 'PRIVATE TITLE AFTER REVOCATION' })
    let currentViewer = makeViewer({ visibleBusinessIds: [f.a.businessId], ownedBusinessIds: [f.a.businessId], visibleDomains: ['knowledge', 'projects'] })
    const repository = createKnowledgeConsoleRepository(prisma)
    let markLoaded, releaseRead
    const loaded = new Promise((resolve) => { markLoaded = resolve })
    const paused = new Promise((resolve) => { releaseRead = resolve })
    const outcome = listConsoleSources({ businessId: f.a.businessId }, {
      ...f.options, viewer: currentViewer, resolveCurrentViewer: async () => currentViewer,
      repository: { ...repository, sources: async (...args) => {
        const rows = await repository.sources(...args)
        markLoaded()
        await paused
        return rows
      } },
    }).then((value) => ({ value }), (error) => ({ error: { status: error.status, message: error.message } }))
    expect(await Promise.race([loaded.then(() => true), outcome.then(() => false)])).toBe(true)
    currentViewer = makeViewer({ visibleBusinessIds: [], visibleDomains: [] })
    releaseRead()
    const result = await outcome
    expect(result).toMatchObject({ error: { status: 404 } })
    expect(result).not.toHaveProperty('value')
    expect(JSON.stringify(result)).not.toContain(source.title)
  })

  it('reaches every one of 121 sources exactly once when timestamps tie, with execution disabled', async () => {
    const prefix = unique('source')
    const ids = Array.from({ length: 121 }, (_, index) => `${prefix}-${String(index).padStart(3, '0')}`)
    await prisma.knowledgeSource.createMany({ data: ids.map((id) => ({
      id, corpusId: f.aCorpus.id, sourceKey: id, kind: 'TEXT', title: `Pageable ${id}`, createdAt: equalTime,
    })) })
    const seen = []
    const cursors = new Set()
    let cursor
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      const page = await listConsoleSources({ businessId: f.a.businessId, limit: 17, ...(cursor ? { cursor } : {}) }, f.options)
      expect(page.items.length).toBeLessThanOrEqual(17)
      seen.push(...page.items.map((item) => item.id))
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull()
        break
      }
      expect(typeof page.nextCursor).toBe('string')
      expect(cursors.has(page.nextCursor)).toBe(false)
      cursors.add(page.nextCursor)
      cursor = page.nextCursor
    }
    expect(seen).toEqual(ids.toReversed())
    expect(new Set(seen).size).toBe(121)
  })

  it('binds continuation to business and filters without granting access to a foreign source', async () => {
    await f.source(f.aCorpus, { title: 'Match one' })
    await f.source(f.aCorpus, { title: 'Match two' })
    const foreign = await f.source(f.bCorpus, { title: 'PRIVATE FOREIGN TITLE' })
    const first = await listConsoleSources({ businessId: f.a.businessId, q: 'Match', limit: 1 }, f.options)
    expect(first.hasMore).toBe(true)
    const both = { ...f.options, viewer: makeViewer({ visibleBusinessIds: [f.a.businessId, f.b.businessId], visibleDomains: ['knowledge', 'projects'] }) }
    await expect(listConsoleSources({ businessId: f.b.businessId, q: 'Match', limit: 1, cursor: first.nextCursor }, both)).rejects.toMatchObject({ status: 400 })
    await expect(listConsoleSources({ businessId: f.a.businessId, q: 'different', limit: 1, cursor: first.nextCursor }, f.options)).rejects.toMatchObject({ status: 400 })
    const forged = Buffer.from(JSON.stringify({ businessId: f.b.businessId, id: foreign.id, createdAt: equalTime.toISOString() })).toString('base64url')
    await expect(listConsoleSources({ businessId: f.a.businessId, cursor: forged }, f.options)).rejects.toMatchObject({ status: 400 })
    await expect(listConsoleSources({ businessId: f.b.businessId }, f.options)).rejects.toMatchObject({ status: 404 })
    await sameNotFound(readConsoleSource(foreign.id, {}, f.options), readConsoleSource(unique('absent'), {}, f.options))
    const local = await listConsoleSources({ businessId: f.a.businessId }, f.options)
    expect(JSON.stringify(local)).not.toContain(foreign.title)
    expect(local.items.map((item) => item.id)).not.toContain(foreign.id)
  })

  it('enforces the knowledge grant on this business rather than its union across businesses', async () => {
    const source = await f.source(f.bCorpus)
    const run = await f.run(f.b)
    const options = { ...f.options, viewer: makeViewer({
      visibleBusinessIds: [f.a.businessId, f.b.businessId], visibleDomains: ['knowledge', 'projects'],
      domainsByBusinessId: { [f.a.businessId]: ['knowledge', 'projects'], [f.b.businessId]: ['projects'] },
    }) }
    await expect(listConsoleSources({ businessId: f.a.businessId }, options)).resolves.toMatchObject({ items: [] })
    for (const list of [listConsoleSources, listConsoleRuns, listConsoleCorpora]) {
      await expect(list({ businessId: f.b.businessId }, options)).rejects.toMatchObject({ status: 404 })
    }
    await sameNotFound(readConsoleSource(source.id, {}, options), readConsoleSource(unique('absent'), {}, options))
    await sameNotFound(readConsoleRun(run.executionRunId, options), readConsoleRun(unique('absent'), options))
  })

  it('withholds revoked, deleted and inaccessible file titles before filtering and pagination', async () => {
    const file = await prisma.fileAsset.create({ data: {
      id: unique('file'), code: unique('FILE'), tenantId: f.a.tenantId, businessId: f.a.businessId,
      storageKind: 'LOCAL', name: 'PRIVATE FILE NAME', relativePath: 'private.txt',
      mime: 'text/plain', size: 10, deletedAt: new Date(),
    } })
    const foreignFile = await prisma.fileAsset.create({ data: {
      id: unique('file'), code: unique('FILE'), tenantId: f.b.tenantId, businessId: f.b.businessId,
      storageKind: 'LOCAL', name: 'PRIVATE FOREIGN FILE', relativePath: 'foreign.txt',
      mime: 'text/plain', size: 10,
    } })
    const hidden = await Promise.all([
      f.source(f.aCorpus, { title: 'PRIVATE REVOKED TITLE', revokedAt: new Date() }),
      f.source(f.aCorpus, { title: 'PRIVATE DELETED TITLE', deletedAt: new Date() }),
      f.source(f.aCorpus, { title: 'PRIVATE FILE TITLE', kind: 'FILE', fileAssetId: file.id }),
      f.source(f.aCorpus, { title: 'PRIVATE FOREIGN FILE TITLE', kind: 'FILE', fileAssetId: foreignFile.id }),
    ])
    const visible = await f.source(f.aCorpus, { title: 'Allowed source' })
    const page = await listConsoleSources({ businessId: f.a.businessId, limit: 1 }, f.options)
    expect(page.items.map((item) => item.id)).toEqual([visible.id])
    expect(page.hasMore).toBe(false)
    expect(JSON.stringify(page)).not.toContain('PRIVATE')
    const searched = await listConsoleSources({ businessId: f.a.businessId, q: 'PRIVATE' }, f.options)
    expect(searched).toMatchObject({ items: [], hasMore: false, nextCursor: null })
    for (const source of hidden) {
      await sameNotFound(readConsoleSource(source.id, {}, f.options), readConsoleSource(unique('absent'), {}, f.options))
    }
  })

  it('pages immutable source versions and excludes bodies, source metadata and worker claims', async () => {
    const source = await f.source(f.aCorpus)
    const first = await f.ingestion(f.aCorpus, source, 1)
    const second = await f.ingestion(f.aCorpus, source, 2, { status: 'FAILED', failureCode: 'PARSER_FAILED' })
    await prisma.knowledgeSource.update({ where: { id: source.id }, data: { desiredRevision: 2 } })
    const page = await readConsoleSource(source.id, { limit: 1 }, f.options)
    expect(page.source).toMatchObject({ id: source.id, title: source.title, businessId: f.a.businessId })
    expect(page.items).toEqual([expect.objectContaining({ id: second.id, sourceVersion: 'v2', status: 'FAILED' })])
    expect(page.hasMore).toBe(true)
    const next = await readConsoleSource(source.id, { limit: 1, cursor: page.nextCursor }, f.options)
    expect(next.items).toEqual([expect.objectContaining({ id: first.id, sourceVersion: 'v1', status: 'QUEUED', executionRunId: null })])
    expect(next.hasMore).toBe(false)
    expect(next.nextCursor).toBeNull()
    for (const result of [page, next]) {
      expect(JSON.stringify(result)).not.toContain('PRIVATE')
      for (const row of result.items) {
        expect(row).not.toHaveProperty('content')
        expect(row).not.toHaveProperty('claimToken')
        expect(row).not.toHaveProperty('sourceMetaJson')
      }
    }
  })

  it('aggregates business and two project corpora, then removes a deleted project from visibility', async () => {
    const p1 = await f.project(f.a)
    const p2 = await f.project(f.a)
    const c1 = await f.corpus(f.a, p1.id)
    const c2 = await f.corpus(f.a, p2.id)
    const s1 = await f.source(c1)
    const s2 = await f.source(c2, { title: 'PRIVATE DELETED PROJECT SOURCE' })
    const all = await listConsoleCorpora({ businessId: f.a.businessId }, f.options)
    expect(new Set(all.items.map((row) => row.id))).toEqual(new Set([f.aCorpus.id, c1.id, c2.id]))
    const selected = await listConsoleSources({ businessId: f.a.businessId, projectId: p1.id }, f.options)
    expect(selected.items.map((row) => row.id)).toEqual([s1.id])
    await prisma.project.update({ where: { id: p2.id }, data: { deletedAt: new Date() } })
    const remaining = await listConsoleCorpora({ businessId: f.a.businessId }, f.options)
    expect(new Set(remaining.items.map((row) => row.id))).toEqual(new Set([f.aCorpus.id, c1.id]))
    expect(JSON.stringify(await listConsoleSources({ businessId: f.a.businessId }, f.options))).not.toContain(s2.title)
    await sameNotFound(readConsoleSource(s2.id, {}, f.options), readConsoleSource(unique('absent'), {}, f.options))
  })

  it('includes an authorized unlinked legacy ledger run but never guesses its project', async () => {
    const project = await f.project(f.a)
    const corpus = await f.corpus(f.a, project.id)
    const source = await f.source(corpus)
    const legacy = await f.run(f.a, { sourceRef: project.id })
    const linked = await f.run(f.a)
    await f.ingestion(corpus, source, 1, { executionRunId: linked.executionRunId })
    const foreign = await f.run(f.b)
    const all = await listConsoleRuns({ businessId: f.a.businessId }, f.options)
    expect(new Set(all.items.map((row) => row.executionRunId))).toEqual(new Set([legacy.executionRunId, linked.executionRunId]))
    expect(JSON.stringify(all)).not.toContain(foreign.executionRunId)
    const selected = await listConsoleRuns({ businessId: f.a.businessId, projectId: project.id }, f.options)
    expect(selected.items.map((row) => row.executionRunId)).toEqual([linked.executionRunId])
    await expect(readConsoleRun(legacy.executionRunId, f.options)).resolves.toBeTruthy()
    await sameNotFound(readConsoleRun(foreign.executionRunId, f.options), readConsoleRun(unique('absent'), f.options))
    await prisma.knowledgeSource.update({ where: { id: source.id }, data: { revokedAt: new Date() } })
    const afterRevocation = await listConsoleRuns({ businessId: f.a.businessId }, f.options)
    expect(afterRevocation.items.map((row) => row.executionRunId)).toEqual([legacy.executionRunId])
    await sameNotFound(readConsoleRun(linked.executionRunId, f.options), readConsoleRun(unique('absent'), f.options))
  })
})

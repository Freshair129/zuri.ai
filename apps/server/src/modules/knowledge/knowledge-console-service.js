import { createHash } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { resolveKnowledgeScope, assertKnowledgeFileReadable } from './knowledge-authorization'
import { createKnowledgeConsoleRepository } from './knowledge-console-repository'
import { createPipelineConsoleReadPort } from '@/platform/integrations/core/pipeline-console-read'
import { RUN_STATUSES } from '@/platform/integrations/core/pipeline-tracking-contract'
import { resolveKnowledgeRuntimeBinding } from './knowledge-runtime'
import { resolveKnowledgeCitation, validateStoredManifest, scopeFromCorpus, verifyPublicationEvidence } from './knowledge-corpus-service'
import { hashGenesisRag17Text } from './genesisrag17-contract'
import { createKnowledgeRepository } from './knowledge-repository'

// @req FR-253 — source, run and publication metadata never bypass live source authority.
// @spec ADR-072, ADR-085, SEC-001, SEC-008
// @tested tests/integration/fr253-knowledge-console.test.js, tests/integration/fr253-citation-artifact.test.js
const id = z.string().trim().min(1).max(200)
const paging = { cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }
const scopeInput = { businessId: id, projectId: id.optional(), ...paging }
const sourceQuery = z.object({ ...scopeInput, q: z.string().trim().max(200).optional(), status: z.enum(['QUEUED', 'RUNNING', 'PUBLISHED', 'FAILED', 'SUPERSEDED', 'WITHDRAWN']).optional() }).strict()
const runQuery = z.object({ ...scopeInput, status: z.enum(RUN_STATUSES).optional() }).strict()
const detailQuery = z.object(paging).strict()
const notFound = () => Object.assign(new Error('Knowledge resource not found'), { status: 404 })
const invalid = (message) => Object.assign(new Error(message), { status: 400 })
const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null]))
const corpusDto = (row) => pick(row, ['id', 'businessId', 'projectId', 'generation', 'status', 'createdAt'])
const versionDto = (row) => pick(row, ['id', 'revision', 'sourceVersion', 'contentHash', 'status', 'executionRunId', 'rawArtifactId', 'parsedArtifactId', 'snapshotId', 'snapshotGeneration', 'createdAt', 'updatedAt'])
const runDto = (row) => pick(row, ['executionRunId', 'dataPipelineDefinitionId', 'status', 'currentStageId', 'createdAt', 'updatedAt', 'startedAt', 'finishedAt'])

function dependencies(options) {
  const db = options.db || prisma
  return { ...options, db, env: options.env || process.env,
    repository: options.repository || createKnowledgeConsoleRepository(db),
    pipeline: options.pipeline || createPipelineConsoleReadPort(db) }
}

async function authorizeScope(businessId, projectId, d) {
  const domains = d.viewer?.domainsByBusinessId?.[businessId] ?? d.viewer?.visibleDomains
  if (!d.viewer?.isApiAccess && (!Array.isArray(domains) || !domains.includes('knowledge'))) throw notFound()
  try { return await resolveKnowledgeScope({ ...d, businessId, projectId, action: 'read' }) }
  catch (error) { if ([403, 404].includes(error.status)) throw notFound(); throw error }
}

async function authorizeCorpus(corpus, d) {
  if (!corpus || corpus.deletedAt || corpus.status !== 'ACTIVE') throw notFound()
  const access = await authorizeScope(corpus.businessId, corpus.projectId, d)
  if (corpus.tenantId !== access.business.tenantId || corpus.portfolioId !== access.business.tenant?.portfolioId) throw notFound()
  return access
}

async function authorizeSource(source, d) {
  if (!source || source.deletedAt || source.revokedAt || source.corpusId !== source.corpus?.id) throw notFound()
  if (source.ingestions?.some((row) => row.sourceId !== source.id || row.corpusId !== source.corpusId)) throw notFound()
  await authorizeCorpus(source.corpus, d)
  if (source.fileAssetId) {
    try { await assertKnowledgeFileReadable(d.viewer, source.fileAssetId, { ...d, businessId: source.corpus.businessId, projectId: source.corpus.projectId }) }
    catch (error) { if ([403, 404].includes(error.status)) throw notFound(); throw error }
  }
  return source
}

async function visible(check) {
  try { await check(); return true } catch (error) { if (error.status === 404) return false; throw error }
}

async function refreshed(d) {
  return d.resolveCurrentViewer ? { ...d, viewer: await d.resolveCurrentViewer() } : d
}

function sourceDto(source) {
  const latest = source.ingestions?.[0]
  return { ...pick(source, ['id', 'title', 'kind', 'fileAssetId', 'corpusId', 'createdAt', 'updatedAt']),
    businessId: source.corpus.businessId, projectId: source.corpus.projectId,
    status: latest?.status || 'QUEUED', sourceVersion: latest?.sourceVersion || null }
}

function binding(resource, input, viewer) {
  const { cursor, limit, ...filters } = input
  return createHash('sha256').update(JSON.stringify([resource, filters, viewer?.principal?.id])).digest('hex')
}

function decodeCursor(cursor, key) {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (value.key !== key || typeof value.id !== 'string' || value.id.length > 200 || !value.id || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error()
    return { id: value.id, createdAt: value.createdAt }
  } catch { throw invalid('Page cursor is invalid for this scope or filter; reload the list') }
}

// A cursor names the last AUTHORIZED returned row, never a hidden scan position.
// Each DB batch is bounded; scan until one further authorized row proves hasMore.
async function authorizedPage(resource, input, d, fetchRows, mapRow) {
  const key = binding(resource, input, d.viewer)
  let after = decodeCursor(input.cursor, key)
  const found = []
  while (found.length <= input.limit) {
    const rows = await fetchRows(after, 100)
    if (!rows.length) break
    for (const row of rows) {
      const value = await mapRow(row, d)
      if (value) found.push({ row, value })
      if (found.length > input.limit) break
    }
    if (rows.length < 100) break
    const last = rows[rows.length - 1]
    after = { id: last.id, createdAt: last.createdAt }
  }
  const current = await refreshed(d)
  // Repeat authorization after slow reads, including the extra row used by hasMore.
  for (const entry of found) {
    const value = await mapRow(entry.row, current, true)
    if (!value) throw notFound()
    entry.value = value
  }
  const hasMore = found.length > input.limit
  const page = found.slice(0, input.limit)
  const last = page[page.length - 1]?.row
  return { items: page.map((entry) => entry.value), hasMore,
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ key, id: last.id, createdAt: new Date(last.createdAt).toISOString() })).toString('base64url') : null }
}

async function capabilities(input, d) {
  let canWrite = false
  try { await resolveKnowledgeScope({ ...d, businessId: input.businessId, projectId: input.projectId, action: 'write' }); canWrite = true }
  catch (error) { if (![403, 404].includes(error.status)) throw error }
  try {
    await resolveKnowledgeRuntimeBinding(input, d)
    return { admit: canWrite, query: true, reason: canWrite ? null : 'Read-only knowledge authority' }
  } catch (error) {
    if (error.status !== 503) throw error
    return { admit: false, query: false, reason: 'Knowledge processing and query runtime is unavailable for this Business' }
  }
}

export async function listConsoleSources(input, options = {}) {
  const value = sourceQuery.parse(input), d = dependencies(options)
  await authorizeScope(value.businessId, value.projectId, d)
  const result = await authorizedPage('sources', value, d, (after, take) => d.repository.sources(value, after, take), async (row, auth, fresh) => {
    const source = fresh ? await d.repository.source(row.id) : row
    if (!await visible(() => authorizeSource(source, auth))) return null
    const dto = sourceDto(source)
    return value.status && dto.status !== value.status ? null : dto
  })
  const capability = await capabilities(value, d)
  const current = await refreshed(d)
  await authorizeScope(value.businessId, value.projectId, current)
  for (const row of result.items) await authorizeSource(await d.repository.source(row.id), current)
  return { ...result, capabilities: capability }
}

export async function readConsoleSource(sourceId, input = {}, options = {}) {
  id.parse(sourceId)
  const value = detailQuery.parse(input), d = dependencies(options)
  const source = await authorizeSource(await d.repository.source(sourceId), d)
  const result = await authorizedPage(`versions:${sourceId}`, { ...value, businessId: source.corpus.businessId }, d,
    (after, take) => d.repository.versions(sourceId, after, take), async (row, auth, fresh) => {
      if (fresh) await authorizeSource(await d.repository.source(sourceId), auth)
      if (row.sourceId !== sourceId || row.corpusId !== source.corpusId) throw notFound()
      return versionDto(row)
    })
  await authorizeSource(await d.repository.source(sourceId), await refreshed(d))
  return { source: sourceDto(source), ...result }
}

export async function listConsoleCorpora(input, options = {}) {
  const value = z.object(scopeInput).strict().parse(input), d = dependencies(options)
  await authorizeScope(value.businessId, value.projectId, d)
  const result = await authorizedPage('corpora', value, d, (after, take) => d.repository.corpora(value, after, take), async (row, auth, fresh) => {
    const corpus = fresh ? await d.repository.corpus(row.id) : row
    return await visible(() => authorizeCorpus(corpus, auth)) ? corpusDto(corpus) : null
  })
  const capability = await capabilities(value, d)
  const current = await refreshed(d)
  await authorizeScope(value.businessId, value.projectId, current)
  for (const row of result.items) await authorizeCorpus(await d.repository.corpus(row.id), current)
  return { ...result, capabilities: capability }
}

async function authorizedRun(row, input, d) {
  if (!row?.businessId) throw notFound()
  const access = await authorizeScope(row.businessId, input.projectId, d)
  if (row.tenantId !== access.business.tenantId || input.businessId && input.businessId !== row.businessId) throw notFound()
  const admission = await d.repository.admissionForRun(row.executionRunId)
  if (admission) {
    const source = await authorizeSource(await d.repository.source(admission.sourceId), d)
    if (source.corpusId !== admission.corpusId || source.corpus.businessId !== row.businessId || input.projectId && source.corpus.projectId !== input.projectId) throw notFound()
    return { sourceId: source.id, admissionId: admission.id }
  }
  // A legacy ledger row has no verified Project relation; keep it Business-only.
  if (input.projectId) throw notFound()
  return { sourceId: null, admissionId: null }
}

export async function listConsoleRuns(input, options = {}) {
  const value = runQuery.parse(input), d = dependencies(options)
  const access = await authorizeScope(value.businessId, value.projectId, d)
  return authorizedPage('runs', value, d, (after, take) => d.pipeline.page({ ...value, tenantId: access.business.tenantId }, after, take), async (row, auth, fresh) => {
    const run = fresh ? await d.pipeline.run(row.executionRunId) : row
    let link
    if (!await visible(async () => { link = await authorizedRun(run, value, auth) })) return null
    return { ...runDto(run), ...link }
  })
}

export async function readConsoleRun(executionRunId, options = {}) {
  id.parse(executionRunId)
  const d = dependencies(options), row = await d.pipeline.run(executionRunId)
  const link = await authorizedRun(row, {}, d)
  const monitor = await d.pipeline.monitor(executionRunId, d.viewer)
  const steps = await d.pipeline.steps(row.id)
  let publication = null
  if (link.admissionId) {
    const owner = createKnowledgeRepository(d.db)
    const admission = await owner.getIngestion(link.admissionId)
    if (admission?.status === 'PUBLISHED') {
      const source = await d.repository.source(admission.sourceId)
      try {
        const { receipt } = await verifyPublicationEvidence(owner, admission, source, source.corpus)
        publication = { state: 'PUBLISHED', snapshotId: receipt.snapshotId, generation: receipt.generation, receiptHash: receipt.receiptHash, verified: true }
      } catch (error) {
        if (![400, 409].includes(error.status)) throw error
        publication = { state: 'UNAVAILABLE', verified: false, reason: 'Retained publication evidence is incomplete or inconsistent' }
      }
    }
  }
  await authorizedRun(await d.pipeline.run(executionRunId), {}, await refreshed(d))
  return {
    run: { ...runDto(row), ...link },
    steps,
    gates: (monitor.gates || []).map((gate) => pick(gate, ['id', 'gateId', 'decision', 'status', 'createdAt'])),
    publication,
    freshness: monitor.freshness,
  }
}

export async function listConsoleGenerations(corpusId, input = {}, options = {}) {
  id.parse(corpusId)
  const value = detailQuery.parse(input), d = dependencies(options)
  const corpus = await d.repository.corpus(corpusId)
  await authorizeCorpus(corpus, d)
  const result = await authorizedPage(`generations:${corpusId}`, { ...value, businessId: corpus.businessId }, d,
    (after, take) => d.repository.generations(corpusId, after, take), async (row, auth) => {
      const current = await d.repository.corpus(corpusId)
      await authorizeCorpus(current, auth)
      if (row.corpusId !== corpusId) throw notFound()
      const { manifest } = validateStoredManifest(row.manifestJson, current, scopeFromCorpus(current), row.number, row.manifestHash)
      const entries = []
      for (const entry of manifest.entries) {
        const source = await d.repository.source(entry.sourceId)
        if (!await visible(() => authorizeSource(source, auth))) continue
        if (source.corpusId !== corpusId || (source.fileAssetId || null) !== (entry.fileAssetId || null)) throw notFound()
        entries.push(pick(entry, ['sourceId', 'title', 'sourceVersion', 'snapshotId', 'generation']))
      }
      return { id: row.id, number: row.number, published: row.number === current.generation,
        createdAt: row.createdAt, entries }
    })
  const current = await d.repository.corpus(corpusId)
  await authorizeCorpus(current, await refreshed(d))
  return { corpus: corpusDto(current), ...result, items: result.items.map((row) => ({ ...row, published: row.number === current.generation })) }
}

export async function readConsoleCitationArtifact(citationId, input = {}, options = {}) {
  const value = z.object({ kind: z.enum(['chunk', 'parsed', 'raw']).default('chunk'), download: z.boolean().default(false) }).strict().parse(input)
  const d = dependencies(options)
  const citationRepository = createKnowledgeRepository(d.db)
  const citation = await resolveKnowledgeCitation(citationId, { ...d, repository: citationRepository })
  const source = await authorizeSource(await d.repository.source(citation.sourceId), d)
  let content = citation.text
  if (value.kind !== 'chunk') {
    const artifact = await d.repository.artifact(value.kind, value.kind === 'raw' ? citation.rawArtifactId : citation.parsedArtifactId)
    const scope = scopeFromCorpus(source.corpus)
    if (!artifact) throw Object.assign(new Error('Historical source content is unavailable'), { status: 409 })
    for (const key of ['portfolioId', 'tenantId', 'businessId', 'workspaceId', 'agentId', 'visibility']) if (artifact[key] !== scope[key]) throw notFound()
    if (artifact.documentId !== source.id || value.kind === 'raw' && (artifact.sourceId !== source.id || artifact.version !== citation.sourceVersion || artifact.contentHash !== citation.contentHash || hashGenesisRag17Text(artifact.content) !== artifact.contentHash) || value.kind === 'parsed' && artifact.rawArtifactId !== citation.rawArtifactId) throw notFound()
    content = artifact.content
  }
  // The resolver re-verifies raw/parsed/chunk hashes and live authority after the
  // additional content read, not just before it. No mutable FileAsset path is read.
  const current = await refreshed(d)
  await resolveKnowledgeCitation(citationId, { ...current, repository: citationRepository })
  await authorizeSource(await d.repository.source(citation.sourceId), current)
  const bytes = Buffer.byteLength(content, 'utf8')
  return { kind: value.kind, title: citation.title, content: value.download ? content : content.slice(0, 65536),
    contentHash: hashGenesisRag17Text(content), bytes, truncated: !value.download && content.length > 65536,
    rawArtifactId: citation.rawArtifactId, parsedArtifactId: citation.parsedArtifactId, chunkId: citation.chunkId }
}

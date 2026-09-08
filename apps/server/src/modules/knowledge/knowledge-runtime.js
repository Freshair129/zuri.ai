import { randomUUID, createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import prisma from '@/lib/db'
import { parseGenesisRag17Scope } from './genesisrag17-contract'
import { createKnowledgeRepository } from './knowledge-repository'
import { createKnowledgeExecutionAuthority } from './knowledge-execution-authority'
import { ingestGenesisRag17Raw, resolveRuntimeCredential } from '@/platform/integrations/core/genesisrag17-executor'
import { createGenesisRag17SourceWorker, queryGenesisRag17 } from '@/platform/integrations/core/genesisrag17-worker'
import { createMspTransportFromEnvironment } from '@/modules/agent/msp-stdio-transport'

// @req FR-173 — process-owned admission queue resumes immutable jobs after restart.
// @spec ADR-072, ADR-073
// @tested tests/unit/knowledge-runtime.test.js, tests/acceptance/knowledge-admission-native.test.js
const unavailable = () => Object.assign(new Error('Knowledge runtime is unavailable for this Business'), { status: 503, code: 'KNOWLEDGE_RUNTIME_UNAVAILABLE' })
const date = (now) => typeof now === 'function' ? now() : now || new Date()

/** No credentials escape this resolver. Public callers must authorize the target first. */
export async function resolveKnowledgeRuntimeBinding({ businessId, projectId }, { db = prisma, env = process.env } = {}) {
  if (env.ZURI_KNOWLEDGE_ENABLED !== '1') throw unavailable()
  let entries
  try { entries = JSON.parse(env.ZURI_KNOWLEDGE_BINDINGS || '[]') } catch { throw unavailable() }
  // This profile has one MSP query endpoint backed by one native scope/store.
  // Additional stores need an explicit routing contract, not another accepted binding that cannot be queried.
  if (!Array.isArray(entries) || entries.length !== 1) throw unavailable()
  const matches = entries.filter((entry) => entry?.scope?.businessId === businessId)
  if (matches.length !== 1) throw unavailable()
  let scope
  try { scope = parseGenesisRag17Scope(matches[0].scope) } catch { throw unavailable() }
  const policy = matches[0].policy
  if (!policy || policy.allowEmbedding !== true || policy.allowPublication !== true || Object.keys(policy).some((key) => !['allowEmbedding', 'allowPublication'].includes(key))) throw unavailable()
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, status: true, tenantId: true, tenant: { select: { portfolioId: true } } } })
  if (!business || business.status !== 'ACTIVE' || business.tenantId !== scope.tenantId || business.tenant?.portfolioId !== scope.portfolioId) throw unavailable()
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { businessId: true, deletedAt: true } })
    if (!project || project.deletedAt || project.businessId !== businessId) throw unavailable()
  }
  try {
    resolveRuntimeCredential({ scope, env })
    if (!createMspTransportFromEnvironment(env)) throw unavailable()
  } catch { throw unavailable() }
  return { scope, policy: { allowEmbedding: true, allowPublication: true } }
}

export async function queryKnowledgeSnapshot({ scope, query, topK, snapshotId }, { db = prisma, env = process.env, transport } = {}) {
  const binding = await resolveKnowledgeRuntimeBinding({ businessId: scope.businessId }, { db, env })
  if (!isDeepStrictEqual(binding.scope, scope)) throw unavailable()
  return queryGenesisRag17({ scope, query, topK, snapshotId, env, transport, viewer: createKnowledgeExecutionAuthority(scope, 'query') })
}

/** The canonical MANUAL/FILE adapter has no external credentials or URL fetching. */
async function ensureAdmissionConnection(db, scope) {
  const provider = await db.integrationProvider.upsert({ where: { code: 'KNOWLEDGE_ADMISSION' }, create: { code: 'KNOWLEDGE_ADMISSION', name: 'Knowledge admission', capabilitiesJson: '{"text":true,"markdown":true}' }, update: {} })
  const externalAccountId = `knowledge-admission:${scope.businessId}`
  const connection = await db.integrationConnection.upsert({ where: { tenantId_providerId_externalAccountId: { tenantId: scope.tenantId, providerId: provider.id, externalAccountId } }, create: { tenantId: scope.tenantId, businessId: scope.businessId, providerId: provider.id, externalAccountId, name: 'Knowledge admission', authorizationType: 'NONE', purpose: 'KNOWLEDGE', status: 'ACTIVE' }, update: {} })
  if (connection.tenantId !== scope.tenantId || connection.businessId !== scope.businessId || connection.providerId !== provider.id || connection.status !== 'ACTIVE') throw unavailable()
  return connection.id
}

export function createKnowledgeAdmissionRuntime({ db = prisma, env = process.env, now = () => new Date(), intervalMs = 1000, leaseMs = 120000, transport, ingest = ingestGenesisRag17Raw, sourceWorkerFactory = createGenesisRag17SourceWorker, publish, onError } = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 10 || !Number.isSafeInteger(leaseMs) || leaseMs < 1000) throw new Error('Invalid knowledge runtime interval')
  const repository = createKnowledgeRepository(db)
  let active = false, timer = null, inFlight = null
  async function processJob(row) {
    const token = randomUUID()
    let job = await repository.claimIngestion(row.id, { claimToken: token, now: date(now), leaseMs })
    if (!job) return
    let executionOptions = null
    // Keep ownership during a slow native pass. A competing process still uses the same durable pipeline identity after a crash.
    const heartbeat = setInterval(() => { void repository.updateIngestion(job.id, { leaseExpiresAt: new Date(date(now).getTime() + leaseMs) }, { claimToken: token }).catch(() => {}) }, Math.max(250, Math.floor(leaseMs / 3)))
    heartbeat.unref?.()
    try {
      const corpus = await repository.getCorpus(job.corpusId)
      const source = await repository.getSource(job.sourceId)
      if (!corpus || !source || corpus.deletedAt || corpus.status !== 'ACTIVE' || source.revokedAt || source.deletedAt) {
        await repository.updateIngestion(job.id, { status: 'WITHDRAWN', claimToken: null, leaseExpiresAt: null }, { claimToken: token }); return
      }
      if (source.desiredRevision !== job.revision) {
        await repository.updateIngestion(job.id, { status: 'SUPERSEDED', claimToken: null, leaseExpiresAt: null }, { claimToken: token }); return
      }
      const binding = await resolveKnowledgeRuntimeBinding(corpus, { db, env })
      if (!isDeepStrictEqual(JSON.parse(corpus.scopeJson), binding.scope) || !isDeepStrictEqual(JSON.parse(corpus.policyJson), binding.policy)) throw unavailable()
      if (createHash('sha256').update(job.content, 'utf8').digest('hex') !== job.contentHash) throw Object.assign(new Error('Immutable admission content hash mismatch'), { code: 'KNOWLEDGE_CONTENT_HASH_MISMATCH', status: 409 })
      const connectionId = await ensureAdmissionConnection(db, binding.scope)
      const viewer = createKnowledgeExecutionAuthority(binding.scope, 'execute', job.executionRunId)
      executionOptions = { db, viewer, env, transport, now, scope: binding.scope }
      if (!job.executionRunId) {
        const result = await ingest({ scope: binding.scope, policy: binding.policy, source: { sourceId: source.id, documentId: source.id, version: job.sourceVersion, content: job.content, connectionId, provider: 'KNOWLEDGE_ADMISSION', sourceType: source.kind === 'FILE' ? 'FILE' : 'MANUAL', sourceUri: `knowledge-source:${source.id}`, externalId: `${source.id}:${job.sourceVersion}` } }, { db, viewer, env, transport, now,
          onRunCreated: async ({ db: tx, run: createdRun, rawArtifactId, parsedArtifactId }) => {
            const linked = await createKnowledgeRepository(tx).updateIngestion(job.id, { executionRunId: createdRun.executionRunId, rawArtifactId, parsedArtifactId }, { claimToken: token })
            if (!linked) throw Object.assign(new Error('Knowledge admission lease was lost'), { status: 409 })
          },
        })
        job = await repository.updateIngestion(job.id, { executionRunId: result.run.executionRunId, rawArtifactId: result.source.rawArtifactId, parsedArtifactId: result.source.parsedArtifactId }, { claimToken: token })
        if (!job) return
      }
      await sourceWorkerFactory({ db, viewer, env, transport, now, scope: binding.scope, runId: job.executionRunId }).runOnce()
      const run = await repository.getPipelineRun(job.executionRunId)
      if (run?.status === 'SUCCEEDED') {
        const publisher = publish || (await import('./knowledge-corpus-service')).publishVerifiedKnowledgeIngestion
        await publisher(job.id, { db, env, now, authority: viewer, claimToken: token })
      } else if (['FAILED', 'CANCELLED'].includes(run?.status)) {
        await repository.updateIngestion(job.id, { status: 'FAILED', failureCode: 'KNOWLEDGE_PIPELINE_FAILED' }, { claimToken: token })
      }
    } catch (error) {
      // Retrying a transport loss re-enters the exact immutable source request; it never creates a replay attempt.
      let permanent = error?.retryable !== true && [400, 403, 404, 409, 422].includes(error?.status)
      const interrupted = await repository.getIngestion(row.id)
      if (executionOptions && interrupted?.executionRunId) {
        const intent = await repository.getIntentForRun(interrupted.executionRunId)
        if (intent?.status === 'FAILED') {
          // The raw executor committed failure evidence. Close that real run before marking the admission failed.
          try {
            await sourceWorkerFactory({ ...executionOptions, runId: interrupted.executionRunId }).runOnce()
            permanent = true
          } catch { permanent = false }
        }
      }
      await repository.updateIngestion(row.id, { ...(permanent ? { status: 'FAILED' } : {}), failureCode: permanent ? 'KNOWLEDGE_INGESTION_REJECTED' : 'KNOWLEDGE_RUNTIME_RETRY' }, { claimToken: token })
      onError?.({ ingestionId: row.id, code: permanent ? 'KNOWLEDGE_INGESTION_REJECTED' : 'KNOWLEDGE_RUNTIME_RETRY' })
    } finally {
      clearInterval(heartbeat)
      await repository.updateIngestion(row.id, { claimToken: null, leaseExpiresAt: null }, { claimToken: token })
    }
  }
  async function runOnce() {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const rows = await repository.listPending({ now: date(now), limit: 20 })
      for (const row of rows) await processJob(row)
      return { examined: rows.length }
    })()
    try { return await inFlight } finally { inFlight = null }
  }
  async function tick() {
    try { await runOnce() } catch { onError?.({ code: 'KNOWLEDGE_QUEUE_UNAVAILABLE' }) }
    if (active) { timer = setTimeout(tick, intervalMs); timer.unref?.() }
  }
  return { runOnce, start() { if (!active) { active = true; void tick() } }, async stop() { active = false; clearTimeout(timer); await inFlight } }
}

const runtimeKey = Symbol.for('zuri.knowledge.admission.runtime')
export function startKnowledgeAdmissionRuntime(options = {}) {
  const env = options.env || process.env
  if (env.ZURI_KNOWLEDGE_ENABLED !== '1') return null
  if (!globalThis[runtimeKey]) {
    globalThis[runtimeKey] = createKnowledgeAdmissionRuntime(options)
    globalThis[runtimeKey].start()
  }
  return globalThis[runtimeKey]
}

import { randomUUID, createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import prisma from '@/lib/db'
import { parseGenesisRag17Scope } from './genesisrag17-contract'
import { createKnowledgeRepository, ORPHAN_RETRY_BACKOFF_MS } from './knowledge-repository'
import { createKnowledgeExecutionAuthority } from './knowledge-execution-authority'
import { createGenesisRag17LineageRepository } from './genesisrag17-lineage-repository'
import { ingestGenesisRag17Raw, resolveRuntimeCredential } from '@/platform/integrations/core/genesisrag17-executor'
import { createGenesisRag17SourceWorker, queryGenesisRag17 } from '@/platform/integrations/core/genesisrag17-worker'
import { finishKnowledgeIngestionRun, recordKnowledgeStageReport } from '@/platform/integrations/core/knowledge-ingestion-executor'
import { KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS } from '@/platform/integrations/core/pipeline-tracking-contract'
import { createMspTransportFromEnvironment } from '@/modules/agent/msp-stdio-transport'

// @req FR-173 — process-owned admission queue resumes immutable jobs after restart.
// @req FR-187 — a structured record carries its provider, entity type and
// content type from the admitted row, so the Stage 5 Zero-PII gate can see it.
// @spec ADR-072, ADR-073, ADR-075
// @tested tests/unit/knowledge-runtime.test.js, tests/acceptance/knowledge-admission-native.test.js, tests/integration/smartgift-catalog-admission.test.js
const unavailable = () => Object.assign(new Error('Knowledge runtime is unavailable for this Business'), { status: 503, code: 'KNOWLEDGE_RUNTIME_UNAVAILABLE' })
const date = (now) => typeof now === 'function' ? now() : now || new Date()

/**
 * Read the structured descriptor the admission service recorded in
 * `sourceMetaJson`. Absent or malformed metadata means the job is an ordinary
 * Text/FILE document and every pre-FR-187 default applies unchanged.
 */
export function structuredSourceDescriptor(sourceMetaJson) {
  try {
    const meta = JSON.parse(sourceMetaJson || '{}')
    const structured = meta?.structured
    if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return null
    if (typeof structured.provider !== 'string' || !structured.provider) return null
    return structured
  } catch {
    return null
  }
}

function admittedSourceMetadata(sourceMetaJson) {
  try {
    const meta = JSON.parse(sourceMetaJson || '{}')
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
  } catch {
    return {}
  }
}

function admittedSourceContentType(sourceMetaJson, structured) {
  if (typeof structured?.contentType === 'string' && structured.contentType.trim()) {
    return structured.contentType.trim().toLowerCase()
  }
  const metadata = admittedSourceMetadata(sourceMetaJson)
  const mime = typeof metadata.mime === 'string' ? metadata.mime.split(';', 1)[0].trim().toLowerCase() : ''
  return mime || 'text/plain'
}

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

/**
 * Whether a claimed job's admission is still valid, checked fresh against the
 * corpus/source rows every time it matters (both at claim time and again if
 * an unrelated error interrupts processing — the source can move on while a
 * job is mid-flight). Pure: callers own the read.
 */
function admissionVerdict(corpus, source, job) {
  if (!corpus || !source || corpus.deletedAt || corpus.status !== 'ACTIVE' || source.revokedAt || source.deletedAt) {
    return { status: 'WITHDRAWN', code: 'KNOWLEDGE_SOURCE_WITHDRAWN' }
  }
  if (source.desiredRevision !== job.revision) {
    return { status: 'SUPERSEDED', code: 'KNOWLEDGE_SOURCE_SUPERSEDED' }
  }
  return null
}

/**
 * A job discovered SUPERSEDED or WITHDRAWN may already own a real FR-071
 * PipelineRun (FR-173: the durable admission queue resumes immutable jobs
 * after restart, so a crash between "run created" and "run finished" is
 * ordinary). Nothing else ever revisits that run once this admission stops
 * claiming its job, so leaving it QUEUED/RUNNING orphans it forever — the
 * exact shape production found (a PipelineRun stuck RUNNING with a PENDING
 * batch and a RUNNING intent, its KnowledgeIngestion already SUPERSEDED).
 *
 * This closes the run honestly. The intent's own recovery field records why
 * (KNOWLEDGE_SOURCE_SUPERSEDED / KNOWLEDGE_SOURCE_WITHDRAWN); if Tier 1 has
 * already finished and the run is only waiting on an external Stage 9-16
 * report, the one stage it is waiting on is told — through the same reporter
 * interface GKS/GenesisBlockDB use — that it will never complete, so
 * `finishKnowledgeIngestionRun` can derive FAILED from real ledger evidence
 * rather than a status invented here. It never fabricates a SUCCEEDED stage
 * and it never acknowledges or replaces the outstanding GenesisRag17Batch
 * request — that row is left exactly as it was. When no stage evidence can
 * yet be derived (the run is still inside Tier 1), closing is refused by
 * `finishKnowledgeIngestionRun` itself and this function leaves the run
 * exactly as it found it for a later pass or an operator to resolve.
 */
async function closeOrphanedExecutionRun({ db, now, corpus, executionRunId, failureCode }) {
  if (!executionRunId || !corpus?.scopeJson) return
  let scope
  try { scope = parseGenesisRag17Scope(JSON.parse(corpus.scopeJson)) } catch { return }
  const lineageRepository = createGenesisRag17LineageRepository(db, scope)
  let intent = null
  try { intent = await lineageRepository.findIntentByExecutionRunId(executionRunId) } catch { intent = null }
  if (intent && !['FAILED', 'SUCCEEDED'].includes(intent.status)) {
    try {
      await lineageRepository.updateIntent(intent.id, {
        status: 'FAILED',
        lastErrorJson: JSON.stringify({ code: failureCode, message: `Knowledge admission stopped resuming this run: ${failureCode}` }),
      })
    } catch { /* best effort — the ingestion's own status still moves on below */ }
  }
  const run = await db.pipelineRun.findUnique({ where: { executionRunId } })
  if (!run || !['QUEUED', 'RUNNING'].includes(run.status)) return
  const viewer = createKnowledgeExecutionAuthority(scope, 'execute', executionRunId)
  const at = date(now)
  try {
    const steps = await db.pipelineStep.findMany({ where: { runId: run.id } })
    const target = steps
      .filter((step) => KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS.includes(step.pipelineStageId) && !['SUCCEEDED', 'FAILED'].includes(step.status))
      .sort((left, right) => left.sequence - right.sequence)[0]
    if (target) {
      const startedAt = target.startedAt && target.startedAt < at ? target.startedAt : at
      await recordKnowledgeStageReport({
        dataPipelineDefinitionId: run.dataPipelineDefinitionId,
        executionContractId: run.executionContractId,
        executionRunId,
        pipelineStageId: target.pipelineStageId,
        executionStepId: target.executionStepId,
        attemptId: target.attemptId,
        scope: { tenantId: run.tenantId, businessId: run.businessId },
        outcome: 'FAILED',
        failure: { failureCode, errorRef: `ki-knowledge-runtime://${executionRunId}/${target.pipelineStageId}`, retryable: false },
        startedAt: startedAt.toISOString(),
        finishedAt: at.toISOString(),
        metrics: { records_in: 0, records_out: 0, records_failed: 1, records_quarantined: 0, processing_time: Math.max(0, at.getTime() - startedAt.getTime()), retry_count: 0 },
      }, { db, viewer })
    }
    await finishKnowledgeIngestionRun({
      dataPipelineDefinitionId: run.dataPipelineDefinitionId,
      executionContractId: run.executionContractId,
      executionRunId,
      scope: { tenantId: run.tenantId, businessId: run.businessId },
      finishedAt: at.toISOString(),
    }, { db, viewer })
  } catch { /* best effort — without derivable stage evidence the run stays honestly open */ }
}

/**
 * Runtime-side reconciliation (FR-173): closes any KnowledgeIngestion that is
 * already SUPERSEDED/WITHDRAWN, carries an executionRunId, and whose
 * PipelineRun is still QUEUED/RUNNING.
 *
 * `processJob`'s own close (above) only fires for a job this admission still
 * claims — but three other places write SUPERSEDED/WITHDRAWN straight onto
 * the KnowledgeIngestion row without ever going through `processJob` again:
 * `withdrawKnowledgeSource`/`withdrawInTransaction` (the user-facing withdraw
 * route), and `publishInTransaction`'s own stale-revision/revoked-source
 * branches (knowledge-corpus-service.js). None of them own a PipelineRun
 * close, and once a row leaves QUEUED/RUNNING, `listPending` never selects it
 * again — so nothing else ever revisits the run those callers may have left
 * attached. This sweep is that "something else": it is the one place that
 * looks at every such row, not only the ones this process happens to still be
 * claiming, which is exactly what closes production's already-SUPERSEDED run
 * 1db6810c-eb86-4e96-9f4c-e9c89c8ba0d3.
 *
 * It starts from the *run* side, not the ingestion side, in two bounded
 * queries and no cursor. `listOpenKnowledgeRunIds` takes every still-open
 * (QUEUED/RUNNING) knowledge-ingestion PipelineRun id — a generous ceiling
 * (500), since the open-run set is small in practice; a hit against that
 * ceiling is reported once via `onError` with `KNOWLEDGE_ORPHAN_SWEEP_TRUNCATED`
 * rather than silently dropping candidates. `listOrphanedIngestionsForRuns`
 * then takes the oldest-`updatedAt` page of KnowledgeIngestion rows that are
 * SUPERSEDED/WITHDRAWN *and* whose executionRunId is one of those open ids
 * *and* whose lease is expired-or-absent — i.e. every row it returns is
 * already known actionable, so this bounded page can never be filled by rows
 * the sweep goes on to skip (no KnowledgeIngestion at all, an ingestion still
 * QUEUED/RUNNING, or a live lease). Querying from KnowledgeIngestion first,
 * unfiltered by its run's status (the original approach), took the oldest
 * SUPERSEDED/WITHDRAWN rows regardless — every published-then-withdrawn
 * source leaves a run that finished normally (SUCCEEDED), so those rows never
 * age out of a bounded "oldest first" window and a genuine orphan behind them
 * was never reached; a first cut that instead paged the open runs directly
 * had the same flaw one level up, since most open runs have no matching
 * orphan at all (FR-071 replay runs, FR-109 reporter runs, or an ingestion
 * legitimately still QUEUED/RUNNING) and could fill the page with runs the
 * sweep then had to skip one by one.
 *
 * Idempotent across calls: closing a run moves it out of QUEUED/RUNNING, so a
 * row a previous call already closed no longer matches `listOpenKnowledgeRunIds`
 * on the next one (closeOrphanedExecutionRun also re-checks the run's live
 * status before doing anything). That does NOT cover a later page of the SAME
 * call, though: `executionRunIds` above is fixed for all `MAX_SWEEP_PAGES`
 * pages, closing a row touches neither its `status` nor its lease, and
 * `listOrphanedIngestionsForRuns` filters on exactly those two fields — so a
 * row closed on page 1 can still come back on page 2. `processedIngestionIds`
 * below is what keeps that from re-closing (harmless; `closeOrphanedExecutionRun`
 * itself is idempotent) and re-counting it into `closed` a second time. Each
 * row is closed with its own corpus's scope — never a cross-tenant/business
 * bypass — exactly as `processJob`'s own call does.
 *
 * `closeOrphanedExecutionRun` can decline or fail to close a run (it is still
 * inside Tier 1, its corpus is gone, or a stage report is rejected) and
 * leaves the run open on purpose rather than fabricate evidence. Nothing else
 * ever writes to that KnowledgeIngestion row, so without a mark of its own its
 * `updatedAt` would never move — it would sit at the front of the
 * oldest-`updatedAt` page (`listOrphanedIngestionsForRuns`) on every single
 * pass forever, and 20+ of them ahead of a genuine orphan would starve it
 * permanently (round 4's exact gap). So a refused close writes a retry time
 * onto the ingestion row itself — status and `failureCode` unchanged,
 * `leaseExpiresAt` set to now + `ORPHAN_RETRY_BACKOFF_MS` (an hour) via the
 * repository's ordinary update method, which also advances `updatedAt` as a
 * side effect. `listOrphanedIngestionsForRuns` already excludes any row whose
 * lease is live, so a refused row is retried hourly, never on every pass, and
 * can never again hold a page slot indefinitely. The lease is the right slot
 * for this and `failureCode` was the wrong one: an earlier cut wrote
 * `KNOWLEDGE_ORPHAN_RUN_OPEN` over the row's `failureCode`, which destroyed
 * the reason the ingestion actually ended (KNOWLEDGE_SOURCE_REVOKED,
 * KNOWLEDGE_SOURCE_REVISION_SUPERSEDED, …) — the admission projection kept
 * saying "orphan run open" after the retry had closed the run, and the retry
 * itself could only fall back to a status-derived code (REVOKED became
 * WITHDRAWN in the intent's lastErrorJson). A terminal row's lease is read by
 * nothing else (`listPending`/`claimIngestion` filter on QUEUED/RUNNING
 * first), so nothing is lost by using it, and `failureCode` stays exactly
 * what the withdraw/supersede path wrote.
 *
 * Because a single page can now be fully "drained" (every row on it either
 * closed or backed off) without the underlying candidate set becoming empty,
 * one call re-queries up to `MAX_SWEEP_PAGES` (3) pages, stopping early the
 * moment a page returns fewer than `limit` rows (nothing left to page
 * through). This bounds one `runOnce()`'s sweep work at 3 × `limit` rows
 * rather than looping until the actionable set is empty, while still letting
 * a real orphan sitting behind 20+ already-backed-off refused rows be reached
 * within the same pass that marks them.
 *
 * A flood of one `KNOWLEDGE_ORPHAN_RUN_OPEN` `onError` per stuck row per pass
 * is a separate problem from the starvation above: `reportedOpenRunIds` (a
 * Set living for this runtime instance's lifetime) reports each
 * executionRunId through `onError` once rather than once per pass. A run
 * cannot close then reopen, so "once per instance lifetime" and "once until
 * it closes" coincide.
 */
const MAX_SWEEP_PAGES = 3

async function sweepOrphanedExecutionRuns({ db, now, limit = 20, onError, reportedOpenRunIds = new Set(), truncatedReported = { value: false } } = {}) {
  const repository = createKnowledgeRepository(db)
  const openRuns = await repository.listOpenKnowledgeRunIds({ limit: 500 })
  if (openRuns.length >= 500 && !truncatedReported.value) {
    truncatedReported.value = true
    onError?.({ code: 'KNOWLEDGE_ORPHAN_SWEEP_TRUNCATED' })
  }
  const executionRunIds = openRuns.map((run) => run.executionRunId)
  let examined = 0, closed = 0, open = 0
  // A row this same call already closed keeps whatever `leaseExpiresAt` it
  // had before closing — only a refused row's lease moves, below — and its
  // own `status` (SUPERSEDED/WITHDRAWN) never changes either, so it can still
  // match `listOrphanedIngestionsForRuns`'s status+lease filter on a later
  // page of this same call even though its PipelineRun is no longer
  // QUEUED/RUNNING. `closeOrphanedExecutionRun`'s own re-check and the next
  // *call*'s `listOpenKnowledgeRunIds` no longer naming it (see the docblock
  // above) only cover cross-call idempotency; this set is what keeps one
  // call's own later page from re-closing and re-counting the same row.
  const processedIngestionIds = new Set()
  if (executionRunIds.length) {
    for (let page = 0; page < MAX_SWEEP_PAGES; page += 1) {
      const fetched = await repository.listOrphanedIngestionsForRuns({ executionRunIds, now: date(now), limit })
      if (fetched.length === 0) break
      const orphans = fetched.filter((ingestion) => !processedIngestionIds.has(ingestion.id))
      examined += orphans.length
      for (const ingestion of orphans) {
        processedIngestionIds.add(ingestion.id)
        const corpus = await repository.getCorpus(ingestion.corpusId)
        if (!corpus) continue
        // The row's own failureCode is the reason the ingestion ended (what
        // withdraw/supersede wrote) and is the close reason too — a refused
        // close never touches it, so a retry after the backoff carries the
        // same code as a first attempt would. Only a row written by a
        // pre-sweep runtime with no code at all falls back to its status.
        const failureCode = ingestion.failureCode
          || (ingestion.status === 'WITHDRAWN' ? 'KNOWLEDGE_SOURCE_WITHDRAWN' : 'KNOWLEDGE_SOURCE_SUPERSEDED')
        await closeOrphanedExecutionRun({ db, now, corpus, executionRunId: ingestion.executionRunId, failureCode })
        const after = await repository.getPipelineRun(ingestion.executionRunId)
        if (after && ['QUEUED', 'RUNNING'].includes(after.status)) {
          open += 1
          await repository.updateIngestion(ingestion.id, { leaseExpiresAt: new Date(date(now).getTime() + ORPHAN_RETRY_BACKOFF_MS) })
          if (!reportedOpenRunIds.has(ingestion.executionRunId)) {
            reportedOpenRunIds.add(ingestion.executionRunId)
            onError?.({ code: 'KNOWLEDGE_ORPHAN_RUN_OPEN', executionRunId: ingestion.executionRunId })
          }
        } else {
          closed += 1
        }
      }
      if (fetched.length < limit) break
    }
  }
  return { examined, closed, open }
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
  // Live for this runtime instance, not per pass: a refused-close report is
  // only ever surfaced once for a given executionRunId, and a truncated-sweep
  // report only once for this instance's whole lifetime (see
  // sweepOrphanedExecutionRuns above).
  const reportedOpenRunIds = new Set()
  const truncatedReported = { value: false }
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
      const verdict = admissionVerdict(corpus, source, job)
      if (verdict) {
        // FR-173: a job resumed after restart may already own a real
        // PipelineRun. Close it before this admission stops claiming the
        // job, or nothing else ever revisits it (see closeOrphanedExecutionRun).
        if (job.executionRunId) await closeOrphanedExecutionRun({ db, now, corpus, executionRunId: job.executionRunId, failureCode: verdict.code })
        await repository.updateIngestion(job.id, { status: verdict.status, failureCode: verdict.code, claimToken: null, leaseExpiresAt: null }, { claimToken: token }); return
      }
      const binding = await resolveKnowledgeRuntimeBinding(corpus, { db, env })
      if (!isDeepStrictEqual(JSON.parse(corpus.scopeJson), binding.scope) || !isDeepStrictEqual(JSON.parse(corpus.policyJson), binding.policy)) throw unavailable()
      if (createHash('sha256').update(job.content, 'utf8').digest('hex') !== job.contentHash) throw Object.assign(new Error('Immutable admission content hash mismatch'), { code: 'KNOWLEDGE_CONTENT_HASH_MISMATCH', status: 409 })
      const connectionId = await ensureAdmissionConnection(db, binding.scope)
      const viewer = createKnowledgeExecutionAuthority(binding.scope, 'execute', job.executionRunId)
      executionOptions = { db, viewer, env, transport, now, scope: binding.scope }
      if (!job.executionRunId) {
        // FR-238 studio descriptions keep their own provider (absent from
        // Stage 5's Zero-PII map, ADR-090 D7). The admission service writes
        // that descriptor into sourceMetaJson, but an ingestion admitted
        // before it did so has none, so the source kind is the fallback key.
        const structured = structuredSourceDescriptor(job.sourceMetaJson)
          || (source.kind === 'LINE_STUDIO_DESCRIPTION' ? { provider: 'LINE_STUDIO_DESCRIPTION', entityType: 'KNOWLEDGE_DOCUMENT', contentType: 'text/plain' } : null)
        const contentType = admittedSourceContentType(job.sourceMetaJson, structured)
        const result = await ingest({ scope: binding.scope, policy: binding.policy, source: { sourceId: source.id, documentId: source.id, version: job.sourceVersion, content: job.content, connectionId, provider: structured?.provider || 'KNOWLEDGE_ADMISSION', entityType: structured?.entityType || 'KNOWLEDGE_DOCUMENT', contentType, sourceType: source.kind === 'FILE' ? 'FILE' : 'MANUAL', sourceUri: `knowledge-source:${source.id}`, externalId: `${source.id}:${job.sourceVersion}` } }, { db, viewer, env, transport, now,
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
      const interrupted = await repository.getIngestion(row.id)
      // The source can move on while this job is mid-flight, independent of
      // whatever error above interrupted it. That takes precedence over the
      // error: retrying — or permanently failing — a job whose source has
      // already been superseded or withdrawn would be wrong either way.
      const laterCorpus = await repository.getCorpus(job.corpusId)
      const laterSource = await repository.getSource(job.sourceId)
      const laterVerdict = admissionVerdict(laterCorpus, laterSource, job)
      if (laterVerdict) {
        if (interrupted?.executionRunId) await closeOrphanedExecutionRun({ db, now, corpus: laterCorpus, executionRunId: interrupted.executionRunId, failureCode: laterVerdict.code })
        await repository.updateIngestion(row.id, { status: laterVerdict.status, failureCode: laterVerdict.code }, { claimToken: token })
        onError?.({ ingestionId: row.id, code: laterVerdict.code })
        return
      }
      // Retrying a transport loss re-enters the exact immutable source request; it never creates a replay attempt.
      let permanent = error?.retryable !== true && [400, 403, 404, 409, 422].includes(error?.status)
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
      // Reconcile orphaned runs first: a row a sweep pass closes this tick
      // can never again be one `listPending` would have claimed anyway
      // (SUPERSEDED/WITHDRAWN is not QUEUED/RUNNING), so the order between
      // the two never changes which jobs get processed.
      const sweep = await sweepOrphanedExecutionRuns({ db, now, limit: 20, onError, reportedOpenRunIds, truncatedReported }).catch(() => { onError?.({ code: 'KNOWLEDGE_SWEEP_FAILED' }); return { examined: 0, closed: 0, open: 0 } })
      const rows = await repository.listPending({ now: date(now), limit: 20 })
      for (const row of rows) await processJob(row)
      return { examined: rows.length, sweep }
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

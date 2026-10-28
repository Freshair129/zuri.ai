// @req FR-173 — actual scoped HTTP sessions and durable admission under the existing contract.
// @spec ADR-115 — isolated packaged TEXT journey; no LINE/FILE/native-store loss claim.
// @tested tests/integration/compact-knowledge-journey.test.js
import { beforeAll, afterAll, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { rootCertificates } from 'node:tls'
import { compactProcessEnvironment } from '../../scripts/lib/compact/docker.mjs'
import { zGenesisRag17PublicationReceipt } from '../../src/modules/knowledge/genesisrag17-contract'
import { createCompactKnowledgeJourney, checkedJourneyResponse } from '../helpers/compact-knowledge-journey-target.mjs'

const packageDirectory = process.env.COMPACT_KNOWLEDGE_PACKAGE, retainedDirectory = process.env.COMPACT_KNOWLEDGE_RETAIN
const expectedRevision = process.env.COMPACT_KNOWLEDGE_REVISION, evidenceFile = process.env.COMPACT_KNOWLEDGE_OBSERVATION
let componentImages
try { componentImages = JSON.parse(process.env.COMPACT_KNOWLEDGE_IMAGES) } catch { throw new Error('COMPACT_JOURNEY_INPUT_REQUIRED') }
if (!packageDirectory || !retainedDirectory || !evidenceFile || !/^[a-f0-9]{40}$/.test(expectedRevision || '')) throw new Error('COMPACT_JOURNEY_INPUT_REQUIRED')
const git = args => execFileSync('git', args, { env: compactProcessEnvironment(), encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('COMPACT_JOURNEY_CLEAN_HARNESS_REQUIRED')
const harnessRevision = git(['rev-parse', 'HEAD'])
let f, owner, stranger, fixture, requestBody, admission, beforeReplacement, published, citationId
const ok = checkedJourneyResponse, pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const job = body => ({ ...(body.ingestion || body.job || body), source: body.source || body.ingestion?.source || body.job?.source })
beforeAll(async () => {
  f = await createCompactKnowledgeJourney({ packageDirectory, retainedDirectory, expectedRevision, componentImages, evidenceFile, harnessRevision })
  await f.setup()
})
afterAll(async () => { await f?.close() })

it('uses certificate-verified HTTP and actual unprivileged signup/self-provisioned Business authority', async () => {
  await expect(f.client(rootCertificates[0]).request('GET', '/api/health')).rejects.toThrow('COMPACT_JOURNEY_HTTPS_FAILED')
  owner = await f.actor('owner'); stranger = await f.actor('stranger')
  expect(owner.ids.businessId).not.toBe(stranger.ids.businessId); expect(owner.ids.tenantId).not.toBe(stranger.ids.tenantId)
  fixture = await f.fixture()
  requestBody = { businessId: owner.ids.businessId, idempotencyKey: 'compact-scoped-text-v1', source: { kind: 'TEXT', sourceKey: 'compact-scoped-text', version: '1', title: 'Compact synthetic text', content: fixture.text } }
  expect((await f.client().request('POST', '/api/knowledge/ingestions', requestBody)).status).toBe(401)
  expect((await stranger.http.request('POST', '/api/knowledge/ingestions', requestBody)).status).toBe(404)
  expect((await owner.http.request('POST', '/api/knowledge/ingestions', { ...requestBody, businessId: stranger.ids.businessId })).status).toBe(404)
  expect((await owner.http.request('POST', '/api/knowledge/ingestions', requestBody)).status).toBe(503)
  f.snapshots.authority = { ownerPersonId: owner.personId, strangerPersonId: stranger.personId, ownerScope: owner.ids, strangerScope: stranger.ids,
    owner: await owner.counts(), stranger: await stranger.counts(), ownerMembership: owner.membership, strangerMembership: stranger.membership,
    wrongCertificateDenied: true, anonymousStatus: 401, crossBusinessStatus: 404, disabledStatus: 503 }
  f.checks.authority = true
})

it('preserves the exact durable TEXT job and observed run across web replacement before native starts', async () => {
  await f.activate(owner.ids)
  const response = await owner.http.request('POST', '/api/knowledge/ingestions', requestBody)
  expect(response.status).toBe(200); admission = job(ok(response)); expect(typeof admission.id).toBe('string')
  const retry = ok(await owner.http.request('POST', '/api/knowledge/ingestions', requestBody))
  expect(job(retry).id).toBe(admission.id); expect(retry.unchanged ?? retry.ingestion?.unchanged).toBe(true); f.checks.idempotent = true
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const row = (await f.query('SELECT id,"sourceId","sourceVersion","contentHash",status,attempts,"claimToken" IS NOT NULL AS "claimPresent","leaseExpiresAt","executionRunId","rawArtifactId","parsedArtifactId" FROM "KnowledgeIngestion" WHERE id=$1', [admission.id])).rows[0]
    if (row.status === 'FAILED') throw new Error('COMPACT_JOURNEY_ADMISSION_FAILED_BEFORE_REPLACEMENT')
    if (row.executionRunId) {
      const batches = (await f.query('SELECT id,"stage9AttemptId" FROM "GenesisRag17Batch" WHERE "executionRunId"=$1', [row.executionRunId])).rows
      if (batches.length === 1) { beforeReplacement = { ...row, batch: batches[0], observedAt: new Date().toISOString() }; break }
    }
    await pause(500)
  }
  expect(beforeReplacement?.executionRunId).toBeTruthy(); expect(['QUEUED', 'RUNNING']).toContain(beforeReplacement.status)
  f.snapshots.beforeReplacement = beforeReplacement; f.checks.durable = true
  expect((await stranger.http.request('GET', `/api/knowledge/ingestions/${encodeURIComponent(admission.id)}`)).status).toBe(404)
  await f.replaceWeb()
  const retained = job(ok(await owner.http.request('GET', `/api/knowledge/ingestions/${encodeURIComponent(admission.id)}`)))
  expect(retained.id).toBe(admission.id); expect(retained.executionRunId).toBe(beforeReplacement.executionRunId); expect(retained.status).not.toBe('PUBLISHED')
  const after = (await f.query('SELECT id,"sourceId","sourceVersion","contentHash",status,attempts,"claimToken" IS NOT NULL AS "claimPresent","leaseExpiresAt","executionRunId","rawArtifactId","parsedArtifactId" FROM "KnowledgeIngestion" WHERE id=$1', [admission.id])).rows[0]
  for (const key of ['id', 'sourceId', 'sourceVersion', 'contentHash', 'executionRunId', 'rawArtifactId', 'parsedArtifactId']) expect(after[key]).toBe(beforeReplacement[key])
  expect(['QUEUED', 'RUNNING']).toContain(after.status)
  f.snapshots.afterReplacement = { ...after, observedAt: new Date().toISOString() }
  f.checks.replacement = true
})

it('resumes the same run through real all-17 publication and scope-authorized query/citation', async () => {
  await f.startNative()
  const deadline = Date.now() + 12 * 60 * 1000
  while (Date.now() < deadline) {
    const current = job(ok(await owner.http.request('GET', `/api/knowledge/ingestions/${encodeURIComponent(admission.id)}`)))
    if (current.status === 'PUBLISHED') { published = current; break }
    if (['FAILED', 'SUPERSEDED', 'WITHDRAWN'].includes(current.status)) throw new Error(`COMPACT_JOURNEY_TERMINAL_${current.status}`)
    await pause(1000)
  }
  expect(published?.status).toBe('PUBLISHED'); expect(published.executionRunId).toBe(beforeReplacement.executionRunId)
  const run = (await f.query('SELECT id,status FROM "PipelineRun" WHERE "executionRunId"=$1', [published.executionRunId])).rows[0]
  expect(run.status).toBe('SUCCEEDED')
  const steps = (await f.query('SELECT sequence,status FROM "PipelineStep" WHERE "runId"=$1 ORDER BY sequence', [run.id])).rows
  expect(steps).toHaveLength(17); expect(steps.every(s => s.status === 'SUCCEEDED')).toBe(true)
  const evidence = (await f.query('SELECT "stageNumber",outcome,"attemptId" FROM "GenesisRag17StageEvidence" WHERE "executionRunId"=$1 ORDER BY "stageNumber"', [published.executionRunId])).rows
  expect(evidence).toHaveLength(17); expect(evidence.every((e, index) => e.stageNumber === index + 1 && e.outcome === 'SUCCEEDED')).toBe(true)
  expect(evidence[8].attemptId).toBe(beforeReplacement.batch.stage9AttemptId)
  const receipts = (await f.query('SELECT "snapshotId","receiptHash","modelRevision","receiptJson" FROM "GenesisRag17PublicationReceipt" WHERE "executionRunId"=$1', [published.executionRunId])).rows
  expect(receipts).toHaveLength(1)
  const receipt = zGenesisRag17PublicationReceipt.parse(JSON.parse(receipts[0].receiptJson))
  expect(receipt.runId).toBe(published.executionRunId); expect(receipt.scope.businessId).toBe(owner.ids.businessId); expect(receipt.snapshotId).toBe(published.snapshotId)
  expect(receipts[0].modelRevision).toBe('614241f622f53c4eeff9890bdc4f31cfecc418b3')
  const rows = (await f.query('SELECT id,"sourceId","sourceVersion","contentHash","executionRunId","rawArtifactId","parsedArtifactId",attempts FROM "KnowledgeIngestion" WHERE "sourceId"=$1', [beforeReplacement.sourceId])).rows
  expect(rows).toHaveLength(1); expect(rows[0].id).toBe(admission.id); expect(rows[0].contentHash).toBe(beforeReplacement.contentHash); expect(rows[0].sourceVersion).toBe(beforeReplacement.sourceVersion)
  const batch = (await f.query('SELECT id,"stage9AttemptId" FROM "GenesisRag17Batch" WHERE "executionRunId"=$1', [published.executionRunId])).rows
  expect(batch).toEqual([beforeReplacement.batch])
  f.snapshots.publication = { admissionId: admission.id, runId: published.executionRunId, snapshotId: published.snapshotId, sourceId: rows[0].sourceId,
    rawArtifactId: rows[0].rawArtifactId, parsedArtifactId: rows[0].parsedArtifactId, attempts: rows[0].attempts, receiptHash: receipts[0].receiptHash, modelRevision: receipts[0].modelRevision, steps, evidence }
  f.checks.published = true
  const result = ok(await owner.http.request('POST', '/api/knowledge/queries', { businessId: owner.ids.businessId, query: 'Which company employs Alice?', topK: 10 }))
  const fact = result.results.find(row => row.sourceId === beforeReplacement.sourceId && row.text === 'Alice works for Acme Ltd.')
  expect(fact).toBeTruthy(); citationId = fact.citationId; expect(citationId).toMatch(/^kc1\./)
  expect((await owner.http.request('GET', `/api/knowledge/citations/${encodeURIComponent(citationId)}`)).status).toBe(200)
  expect((await stranger.http.request('POST', '/api/knowledge/queries', { businessId: owner.ids.businessId, query: 'Alice', topK: 5 })).status).toBe(404)
  expect((await stranger.http.request('GET', `/api/knowledge/citations/${encodeURIComponent(citationId)}`)).status).toBe(404)
  f.checks.serving = true
})

it('withdraws current serving/citation membership while leaving native-loss and profile gates open', async () => {
  const source = (await f.query('SELECT id,version FROM "KnowledgeSource" WHERE id=$1', [beforeReplacement.sourceId])).rows[0]
  const withdrawn = ok(await owner.http.request('DELETE', `/api/knowledge/sources/${encodeURIComponent(source.id)}`, { expectedVersion: source.version }))
  expect(withdrawn.status).toBe('WITHDRAWN')
  const result = ok(await owner.http.request('POST', '/api/knowledge/queries', { businessId: owner.ids.businessId, query: 'Which company employs Alice?', topK: 10 }))
  expect(result.results.some(row => row.sourceId === source.id)).toBe(false)
  expect((await owner.http.request('GET', `/api/knowledge/citations/${encodeURIComponent(citationId)}`)).status).toBe(404)
  const diagnostics = await f.diagnostics()
  expect(diagnostics.knowledge).toBe('NOT_QUALIFIED')
  expect(diagnostics.profilePrerequisites.knowledge.missing).toContain('KNOWLEDGE_STORAGE_ENABLED')
  f.snapshots.withdrawal = { sourceId: source.id, status: 'WITHDRAWN', priorCitationStatus: 404, currentQueryExcluded: true }
  f.snapshots.profile = { knowledge: diagnostics.knowledge, prerequisites: diagnostics.profilePrerequisites.knowledge.prerequisites, missing: diagnostics.profilePrerequisites.knowledge.missing }
  f.checks.withdrawn = true
})

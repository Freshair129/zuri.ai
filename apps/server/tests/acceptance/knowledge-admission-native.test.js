import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import path from 'node:path'
import prisma from '@/lib/db'
import { zGenesisRag17PublicationReceipt } from '@/modules/knowledge/genesisrag17-contract'
import fixture from '../fixtures/genesisrag17-corpus-v1.json'
import {
  createKnowledgeAdmissionHarness,
  E2E_PASSWORD,
  E2E_USERNAME,
  seedKnowledgeOwner,
} from './knowledge-admission-harness'

// @req FR-172 — the owner-facing UI and HTTP API admit immutable source
// versions into one durable corpus, resume after a real Next restart, and
// serve only receipt-backed native snapshots and current-authorized citations.
// @spec ADR-072, ADR-071
// @tested tests/acceptance/knowledge-admission-native.test.js

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(testDirectory, '../..')
const reportPath = path.resolve(serverRoot, '../../.brain/reports/knowledge-admission-native.json')
const reportSchemaVersion = 'knowledge-admission-native.v1'
const fixtureHash = createHash('sha256').update(JSON.stringify(fixture)).digest('hex')
let mainTestSucceeded = false
let fileTestSucceeded = false
let publishedJobs = []
let invalidFileAdmissionStatus
let acceptanceScope
let reportHarness

function parseBody(response, label) {
  return response.text().then((text) => {
    try { return JSON.parse(text) } catch { throw new Error(`${label} returned non-JSON: ${text.slice(0, 1000)}`) }
  })
}

async function requireOk(response, label) {
  const body = await parseBody(response, label)
  if (!response.ok()) throw new Error(`${label} returned HTTP ${response.status()}: ${JSON.stringify(body)}`)
  return body
}

function admissionId(body) {
  const value = body?.admissionId || body?.id || body?.ingestion?.id
  if (typeof value !== 'string' || !value) throw new Error(`Admission response has no durable id: ${JSON.stringify(body)}`)
  return value
}

function statusOf(body) {
  return body?.status || body?.ingestion?.status || body?.job?.status || null
}

function reportJson(value, label) {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

function reportScope(value) {
  return Object.fromEntries(['portfolioId', 'tenantId', 'businessId', 'workspaceId', 'agentId', 'visibility']
    .map((key) => [key, value?.[key] ?? null]))
}

function reportDate(value) {
  return value instanceof Date ? value.toISOString() : value
}

function rememberPublishedJob({ label, ingress, published }) {
  if (typeof published.executionRunId !== 'string' || !published.executionRunId) throw new Error(`${label} did not return a durable executionRunId`)
  publishedJobs.push({
    label,
    ingress,
    admissionId: published.id,
    executionRunId: published.executionRunId,
    snapshotId: published.snapshotId,
    sourceId: published.source?.id,
    sourceVersion: published.sourceVersion,
  })
}

function nativeStoreRoot() {
  if (!reportHarness?.tempDir) throw new Error('Native acceptance report requires the live disposable worker store')
  return path.join(reportHarness.tempDir, 'genesis-store', 'genesisrag17')
}

function readNativeFile(filename, label) {
  if (!existsSync(filename)) throw new Error(`${label} is missing: ${filename}`)
  return reportJson(readFileSync(filename, 'utf8'), label)
}

function nativePointer(pointer) {
  return {
    schemaVersion: pointer.schemaVersion,
    scope: reportScope(pointer.scope),
    snapshotId: pointer.snapshotId,
    generation: pointer.generation,
    decisionId: pointer.decisionId,
    decisionHash: pointer.decisionHash,
    receiptHash: pointer.receiptHash,
    pointerHash: pointer.pointerHash,
    publishedSnapshotIds: pointer.publishedSnapshotIds,
  }
}

function nativeSnapshot(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    scope: reportScope(snapshot.scope),
    snapshotId: snapshot.snapshotId,
    generation: snapshot.generation,
    vectorCollection: snapshot.vectorCollection,
    decisionId: snapshot.decisionId,
    decisionHash: snapshot.decisionHash,
    receiptHash: snapshot.receiptHash,
    createdAt: reportDate(snapshot.createdAt),
    sourceIds: snapshot.sourceIds,
    chunkIds: snapshot.chunkIds,
  }
}

function nativeBenchmark(receipt) {
  if (!receipt?.benchmark) return null
  return {
    fixtureVersion: receipt.benchmark.fixtureVersion,
    queryCount: receipt.benchmark.queryCount,
    recallAt5: receipt.benchmark.recallAt5,
    mrr: receipt.benchmark.mrr,
    citationCorrectness: receipt.benchmark.citationCorrectness,
    crossTenantLeaks: receipt.benchmark.crossTenantLeaks,
  }
}

async function publishedJobEvidence(job, pointer, state) {
  const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: job.executionRunId } })
  if (!run || run.status !== 'SUCCEEDED') throw new Error(`Report requires a succeeded run for ${job.executionRunId}`)
  const steps = await prisma.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })
  if (steps.length !== 17 || steps.some((step) => step.status !== 'SUCCEEDED')) throw new Error(`Report requires all 17 succeeded steps for ${job.executionRunId}`)
  const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: job.executionRunId }, orderBy: { stageNumber: 'asc' } })
  if (evidence.length !== 17 || evidence.some((row, index) => row.stageNumber !== index + 1 || row.outcome !== 'SUCCEEDED')) throw new Error(`Report requires ordered all-17 evidence for ${job.executionRunId}`)
  const receiptRow = await prisma.genesisRag17PublicationReceipt.findFirst({ where: { executionRunId: job.executionRunId }, orderBy: { createdAt: 'desc' } })
  if (!receiptRow) throw new Error(`Report cannot find publication receipt for ${job.executionRunId}`)
  const receipt = zGenesisRag17PublicationReceipt.parse(reportJson(receiptRow.receiptJson, `publication receipt ${job.executionRunId}`))
  if (receipt.runId !== job.executionRunId || receipt.scope.businessId !== acceptanceScope.businessId || !pointer.publishedSnapshotIds.includes(receipt.snapshotId)) {
    throw new Error(`Report found publication identity mismatch for ${job.executionRunId}`)
  }
  const batch = await prisma.genesisRag17Batch.findUnique({ where: { executionRunId: job.executionRunId } })
  if (!batch) throw new Error(`Report cannot find Stage 9 batch for ${job.executionRunId}`)
  const source = reportJson(batch.requestJson, `Stage 9 batch for ${job.executionRunId}`).source
  if (!source?.rawArtifactId || !source?.parsedArtifactId) throw new Error(`Report found no raw/parsed references for ${job.executionRunId}`)
  const raw = await prisma.knowledgeRawArtifact.findUnique({ where: { id: source?.rawArtifactId } })
  const parsed = await prisma.knowledgeParsedArtifact.findUnique({ where: { id: source?.parsedArtifactId } })
  const chunks = parsed ? await prisma.knowledgeChunk.findMany({ where: { parsedArtifactId: parsed.id }, orderBy: { ordinal: 'asc' } }) : []
  if (!raw || !parsed || parsed.rawArtifactId !== raw.id || !chunks.length || chunks.some((chunk) => chunk.parsedArtifactId !== parsed.id)) {
    throw new Error(`Report found broken raw -> parsed -> chunk lineage for ${job.executionRunId}`)
  }
  const owner = state?.decisions?.[receiptRow.decisionId]
  const ownerReceipt = owner?.receipt
  return {
    ...job,
    lineage: {
      raw: { id: raw.id, sourceId: raw.sourceId, documentId: raw.documentId, version: raw.version, contentHash: raw.contentHash },
      parsed: { id: parsed.id, rawArtifactId: parsed.rawArtifactId, documentId: parsed.documentId, contentHash: parsed.contentHash },
      chunks: chunks.map((chunk) => ({ id: chunk.id, parsedArtifactId: chunk.parsedArtifactId, ordinal: chunk.ordinal, contentHash: chunk.contentHash, startOffset: chunk.startOffset, endOffset: chunk.endOffset })),
    },
    evidence: evidence.map((row) => ({
      id: row.id, cursor: row.cursor, runId: row.runId, executionRunId: row.executionRunId,
      pipelineStageId: row.pipelineStageId, executionStepId: row.executionStepId, attemptId: row.attemptId,
      stageNumber: row.stageNumber, outcome: row.outcome, startedAt: reportDate(row.startedAt), finishedAt: reportDate(row.finishedAt),
      recordsIn: row.recordsIn, recordsOut: row.recordsOut, recordsQuarantined: row.recordsQuarantined,
      errorCount: row.errorCount, retryCount: row.retryCount, durationMs: row.durationMs, rowHash: row.rowHash,
    })),
    publicationReceipt: { storedId: receiptRow.id, receiptHash: receiptRow.receiptHash, parsed: receipt },
    nativeOwnerEvidence: {
      available: Boolean(ownerReceipt),
      model: ownerReceipt?.model ? { id: ownerReceipt.model.id, revision: ownerReceipt.model.revision, dimensions: ownerReceipt.model.dimensions, metric: ownerReceipt.model.metric } : null,
      benchmark: nativeBenchmark(ownerReceipt),
    },
  }
}

async function exportKnowledgeAdmissionReport() {
  if (!mainTestSucceeded || !fileTestSucceeded) return
  if (publishedJobs.length !== 4) throw new Error(`Report expected four published jobs, found ${publishedJobs.length}`)
  const root = nativeStoreRoot()
  const pointer = readNativeFile(path.join(root, 'published-pointer.json'), 'native published pointer')
  const state = readNativeFile(path.join(root, 'state.json'), 'native worker state')
  const jobs = []
  for (const job of publishedJobs) jobs.push(await publishedJobEvidence(job, pointer, state))
  const snapshots = pointer.publishedSnapshotIds.map((snapshotId) => nativeSnapshot(readNativeFile(path.join(root, 'snapshots', `${snapshotId}.json`), `native snapshot ${snapshotId}`)))
  const modelRevisions = new Set(jobs.map((job) => job.publicationReceipt.parsed.modelRevision))
  if (modelRevisions.size !== 1) throw new Error('Report found multiple model revisions')
  const report = {
    reportSchemaVersion, status: 'PASSED', artifact: '.brain/reports/knowledge-admission-native.json',
    schemaVersion: jobs[0].publicationReceipt.parsed.schemaVersion,
    fixtureVersion: fixture.fixtureVersion, fixtureSourceVersion: fixture.sourceVersion, fixtureSha256: fixtureHash,
    nodeVersion: process.version, platform: process.platform, architecture: process.arch,
    modelRevision: [...modelRevisions][0], scope: reportScope(acceptanceScope),
    scenariosPassed: ['browser-text', 'mcp-text', 'http-correction', 'browser-managed-file', 'binary-file-rejected'],
    manifests: { pointer: nativePointer(pointer), snapshots }, jobs,
  }
  const reportDirectory = path.dirname(reportPath)
  mkdirSync(reportDirectory, { recursive: true })
  const temporaryReportPath = `${reportPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporaryReportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    if (existsSync(reportPath)) rmSync(reportPath, { force: true })
    renameSync(temporaryReportPath, reportPath)
  } catch (error) {
    try { rmSync(temporaryReportPath, { force: true }) } catch {}
    throw error
  }
}

async function waitForAdmission(api, id, { terminal = 'PUBLISHED', timeoutMs = 12 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    const response = await api.get(`/api/knowledge/ingestions/${encodeURIComponent(id)}`)
    last = await parseBody(response, `GET ingestion ${id}`)
    if (!response.ok()) throw new Error(`GET ingestion ${id} returned HTTP ${response.status()}: ${JSON.stringify(last)}`)
    const status = statusOf(last)
    if (status === terminal) return last
    if (['FAILED', 'SUPERSEDED', 'WITHDRAWN'].includes(status)) {
      throw new Error(`Ingestion ${id} reached ${status}: ${JSON.stringify(last)}`)
    }
    await sleep(1000)
  }
  throw new Error(`Timed out waiting for ingestion ${id}: ${JSON.stringify(last)}`)
}

async function readAdmission(api, id) {
  const response = await api.get(`/api/knowledge/ingestions/${encodeURIComponent(id)}`)
  return { response, body: await parseBody(response, `GET ingestion ${id}`) }
}

async function admitHttp(api, input, label) {
  const response = await api.post('/api/knowledge/ingestions', { data: input })
  return { response, body: await requireOk(response, label), id: null }
}

async function queryHttp(api, input) {
  const response = await api.post('/api/knowledge/queries', { data: input })
  return { response, body: await requireOk(response, 'knowledge query') }
}

async function openMcpSession(api) {
  const initialized = await api.post('/api/mcp', {
    data: { jsonrpc: '2.0', id: 'knowledge-initialize', method: 'initialize', params: { protocolVersion: '2024-11-05' } },
  })
  const initializedBody = await requireOk(initialized, 'MCP initialize')
  const sessionId = initialized.headers()['mcp-session-id']
  expect(sessionId, 'MCP initialize must return a session id').toBeTruthy()
  const ready = await api.post('/api/mcp', {
    headers: { 'mcp-session-id': sessionId },
    data: { jsonrpc: '2.0', method: 'notifications/initialized' },
  })
  expect(ready.status(), 'MCP initialized notification must be accepted').toBe(204)
  expect(initializedBody.result?.protocolVersion).toBe('2024-11-05')
  return sessionId
}

async function callMcp(api, sessionId, name, arguments_, id = `knowledge-${name}`) {
  const response = await api.post('/api/mcp', {
    headers: { 'mcp-session-id': sessionId },
    data: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: arguments_ },
    },
  })
  const body = await parseBody(response, `MCP ${name}`)
  if (!response.ok()) throw new Error(`MCP ${name} returned HTTP ${response.status()}: ${JSON.stringify(body)}`)
  if (body.error) throw new Error(`MCP ${name} returned an RPC error: ${JSON.stringify(body.error)}`)
  return body.result?.structuredContent ?? body.result
}

async function assertNativeRun(runId, label) {
  expect(typeof runId, `${label} must expose executionRunId`).toBe('string')
  const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: runId } })
  expect(run, `${label} pipeline run must be durable`).toBeTruthy()
  expect(run.status, `${label} pipeline status`).toBe('SUCCEEDED')
  const steps = await prisma.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })
  expect(steps, `${label} must persist all 17 pipeline steps`).toHaveLength(17)
  expect(steps.every((step) => step.status === 'SUCCEEDED'), `${label} must not synthesize successful stages`).toBe(true)
  const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: runId }, orderBy: { stageNumber: 'asc' } })
  expect(evidence, `${label} must persist all 17 native evidence rows`).toHaveLength(17)
  expect(evidence.map((row) => row.stageNumber)).toEqual([...Array(17)].map((_, index) => index + 1))
  expect(evidence.every((row) => row.outcome === 'SUCCEEDED'), `${label} native stage evidence must be successful`).toBe(true)
  for (const row of evidence) {
    expect(row.recordsIn).toBeGreaterThanOrEqual(0)
    expect(row.recordsOut).toBeGreaterThanOrEqual(0)
    expect(row.recordsQuarantined).toBeGreaterThanOrEqual(0)
    expect(row.errorCount).toBe(0)
    expect(row.retryCount).toBeGreaterThanOrEqual(0)
    expect(row.durationMs).toBeGreaterThanOrEqual(0)
  }
  const receiptRow = await prisma.genesisRag17PublicationReceipt.findFirst({ where: { executionRunId: runId }, orderBy: { createdAt: 'desc' } })
  expect(receiptRow, `${label} must have a native publication receipt`).toBeTruthy()
  expect(receiptRow.modelRevision, `${label} receipt must identify the pinned model`).toBeTruthy()
  const receipt = JSON.parse(receiptRow.receiptJson)
  const parsedReceipt = zGenesisRag17PublicationReceipt.parse(receipt)
  expect(parsedReceipt.runId).toBe(runId)
  expect(parsedReceipt.transactionFrontier).toBeTruthy()
  expect(parsedReceipt.readback.ok).toBe(true)
  return { run, evidence, receiptRow, receipt }
}

async function enterBusiness(page) {
  await page.goto('/login')
  await page.getByLabel('Email or account code').fill(E2E_USERNAME)
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Open Business Business 01', exact: true }).click()
  await playwrightExpect(page).toHaveURL(/overview/)
}

async function admitFromFilesPage(harness, { businessId, content }) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ baseURL: harness.baseURL })
  const page = await context.newPage()
  try {
    await enterBusiness(page)
    await page.goto('/files')
    await page.getByRole('button', { name: /Add text/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Admit text or Markdown' })
    await playwrightExpect(dialog).toBeVisible()
    await dialog.getByLabel('Source key').fill('ui-doc-a')
    await dialog.getByLabel('Version').fill('1')
    await dialog.getByLabel('Title').fill('UI knowledge document A')
    await dialog.getByLabel('Text or Markdown').fill(content)
    const submitted = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/knowledge/ingestions')
    await dialog.getByRole('button', { name: 'Queue admission', exact: true }).click()
    const response = await submitted
    const body = await parseBody(response, 'browser knowledge admission')
    if (!response.ok()) throw new Error(`Browser admission returned HTTP ${response.status()}: ${JSON.stringify(body)}`)
    await playwrightExpect(dialog).not.toBeVisible()
    return { body, id: admissionId(body) }
  } finally {
    await context.close()
    await browser.close()
  }
}

async function createManagedFileFromFilesPage(harness, { deviceKey, name, content }) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ baseURL: harness.baseURL })
  const page = await context.newPage()
  try {
    await enterBusiness(page)
    const mountsResponse = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/files/mounts')
    await page.goto('/files')
    await mountsResponse
    await playwrightExpect(page.getByText(new RegExp(deviceKey))).toBeVisible()
    await page.getByRole('button', { name: 'Add file', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add managed file' })
    await playwrightExpect(dialog).toBeVisible()
    const bytes = Buffer.from(content, 'utf8')
    await dialog.getByLabel('File', { exact: true }).setInputFiles({ name, mimeType: 'text/markdown', buffer: bytes })
    const submitted = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/files')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    const response = await submitted
    const body = await parseBody(response, 'browser managed file upload')
    if (!response.ok()) throw new Error(`Browser managed file upload returned HTTP ${response.status()}: ${JSON.stringify(body)}`)
    await playwrightExpect(dialog).not.toBeVisible()
    return body
  } finally {
    await context.close()
    await browser.close()
  }
}

describe('Knowledge admission over actual Next HTTP/browser and native recovery', () => {
  let harness
  let business
  let scope
  let api
  let browserAdmission
  let documentB
  let correctionA
  let modelRevision

  beforeAll(async () => {
    for (const key of ['KI17_MSP_ROOT', 'KI17_GKS_ROOT', 'KI17_GENESIS_ROOT', 'KI17_MODEL_DIR']) {
      if (!process.env[key]) throw new Error(`${key} is required for native knowledge admission acceptance; no skip/fake mode is allowed`)
    }
    seedKnowledgeOwner({ password: E2E_PASSWORD })
    business = await prisma.business.findUnique({ where: { code: 'BUS-001' }, include: { tenant: { select: { id: true, portfolioId: true } } } })
    if (!business?.tenant?.portfolioId) throw new Error('Seeded owner Business 01 scope is unavailable')
    scope = {
      portfolioId: business.tenant.portfolioId,
      tenantId: business.tenantId,
      businessId: business.id,
      workspaceId: '',
      agentId: '',
      visibility: 'private',
    }
    harness = await createKnowledgeAdmissionHarness({ scope, fixture })
    acceptanceScope = scope
    reportHarness = harness
    api = harness.request
    const unauthenticated = await api.post('/api/knowledge/ingestions', { data: { businessId: business.id, idempotencyKey: 'unauthenticated', source: { kind: 'TEXT', sourceKey: 'unauthenticated', version: '1', content: 'must not be admitted' } } })
    expect(unauthenticated.status(), 'unauthenticated admission must fail before body authorization').toBe(401)
    await unauthenticated.dispose()
    const login = await api.post('/api/auth/login', { data: { username: E2E_USERNAME, password: E2E_PASSWORD } })
    expect(login.ok(), `owner login failed: HTTP ${login.status()}`).toBe(true)
    await login.dispose()
  }, 300000)

  afterAll(async () => {
    try {
      await exportKnowledgeAdmissionReport()
    } finally {
      await harness?.close()
      await prisma.$disconnect()
    }
  }, 300000)

  it('admits from browser, MCP and HTTP, survives restart, publishes two independent native snapshots, corrects one, and withdraws one', async () => {
    browserAdmission = await admitFromFilesPage(harness, { businessId: business.id, content: fixture.text })
    const browserId = browserAdmission.id
    const browserAdmissionResponse = browserAdmission.body
    expect(browserAdmissionResponse.source?.sourceKey).toBe('ui-doc-a')
    expect(browserAdmissionResponse.status).toBe('QUEUED')

    const bodyB = {
      businessId: business.id,
      idempotencyKey: 'http-doc-b-v1',
      source: { kind: 'TEXT', sourceKey: 'http-doc-b', version: '1', title: 'HTTP knowledge document B', content: fixture.text },
    }
    const admissionMcpSession = await openMcpSession(api)
    documentB = { body: await callMcp(api, admissionMcpSession, 'knowledge.ingestion_create', bodyB, 'knowledge-document-b'), response: null }
    documentB.id = admissionId(documentB.body)
    expect(documentB.body.source?.sourceKey).toBe('http-doc-b')
    expect(documentB.body.status).toBe('QUEUED')

    const duplicateBody = await callMcp(api, admissionMcpSession, 'knowledge.ingestion_create', bodyB, 'knowledge-document-b-retry')
    expect(admissionId(duplicateBody)).toBe(documentB.id)
    expect(duplicateBody.unchanged).toBe(true)

    const queuedA = await readAdmission(api, browserId)
    const queuedB = await readAdmission(api, documentB.id)
    expect(queuedA.response.ok()).toBe(true)
    expect(queuedB.response.ok()).toBe(true)
    expect(['QUEUED', 'RUNNING']).toContain(statusOf(queuedA.body))
    expect(['QUEUED', 'RUNNING']).toContain(statusOf(queuedB.body))
    expect(statusOf(queuedA.body)).not.toBe('PUBLISHED')
    expect(statusOf(queuedB.body)).not.toBe('PUBLISHED')

    // The Next process was running with the native URL withheld. Both rows are
    // durable before this real process restart; the resumed process receives
    // the native URL and claims the same immutable jobs.
    await harness.restart({ activateNative: true })
    const publishedA = await waitForAdmission(api, browserId)
    const publishedB = await waitForAdmission(api, documentB.id)
    const mcpSession = await openMcpSession(api)
    expect(publishedA.status).toBe('PUBLISHED')
    expect(publishedB.status).toBe('PUBLISHED')
    expect(publishedA.executionRunId).toBeTruthy()
    expect(publishedB.executionRunId).toBeTruthy()
    expect(publishedA.snapshotId).toBeTruthy()
    expect(publishedB.snapshotId).toBeTruthy()
    expect(publishedA.snapshotId).not.toBe(publishedB.snapshotId)

    const nativeA = await assertNativeRun(publishedA.executionRunId, 'browser document A')
    const nativeB = await assertNativeRun(publishedB.executionRunId, 'HTTP document B')
    modelRevision = nativeA.receiptRow.modelRevision
    expect(nativeB.receiptRow.modelRevision).toBe(modelRevision)

    const initialQuery = await queryHttp(api, { businessId: business.id, query: 'Which company employs Alice?', topK: 10 })
    const initialMcpQuery = await callMcp(api, mcpSession, 'knowledge.query', { businessId: business.id, query: 'Which company employs Alice?', topK: 10 }, 'knowledge-query-initial')
    expect(initialQuery.body.ranking).toBe('rrf-k60')
    expect(initialMcpQuery.ranking).toBe('rrf-k60')
    expect(initialQuery.body.corpusId).toBe(publishedA.corpus.id)
    expect(initialQuery.body.results.some((row) => row.sourceId === publishedA.source.id && row.text === 'Alice works for Acme Ltd.')).toBe(true)
    expect(initialQuery.body.results.some((row) => row.sourceId === publishedB.source.id && row.text === 'Alice works for Acme Ltd.')).toBe(true)
    expect(initialMcpQuery.results.some((row) => row.sourceId === publishedA.source.id && row.text === 'Alice works for Acme Ltd.')).toBe(true)
    expect(initialMcpQuery.results.some((row) => row.sourceId === publishedB.source.id && row.text === 'Alice works for Acme Ltd.')).toBe(true)
    const oldCitation = initialMcpQuery.results.find((row) => row.sourceId === publishedA.source.id && row.text === 'Alice works for Acme Ltd.')?.citationId
    expect(oldCitation).toMatch(/^kc1\./)
    const oldCitationResponse = await api.get(`/api/knowledge/citations/${encodeURIComponent(oldCitation)}`)
    const oldCitationBody = await requireOk(oldCitationResponse, 'old citation before correction')
    const oldCitationMcpBody = await callMcp(api, mcpSession, 'knowledge.citation', { citationId: oldCitation }, 'knowledge-citation-initial')
    expect(oldCitationBody.sourceVersion).toBe('1')
    expect(oldCitationBody.text).toBe('Alice works for Acme Ltd.')
    expect(oldCitationMcpBody.sourceVersion).toBe('1')
    expect(oldCitationMcpBody.text).toBe('Alice works for Acme Ltd.')

    await harness.deactivateNativeWorker()
    const correctedText = fixture.text.replace(...fixture.correction.replace)
    const correctionPayload = {
      businessId: business.id,
      idempotencyKey: 'ui-doc-a-v2-correction',
      source: { kind: 'TEXT', sourceKey: 'ui-doc-a', version: '2', title: 'UI knowledge document A corrected', content: correctedText },
    }
    correctionA = await admitHttp(api, correctionPayload, 'correction admission')
    correctionA.id = admissionId(correctionA.body)
    expect(correctionA.body.source?.desiredRevision).toBeGreaterThan(publishedA.source.desiredRevision)
    const correctionFixture = {
      ...fixture,
      fixtureVersion: 'ki17-corpus-v2',
      queries: fixture.correction.queries,
    }
    await harness.restartNative({ benchmarkFixture: correctionFixture })
    // A boot tick wakes the durable correction queue; the native process is
    // restarted with the correction benchmark while its store stays intact,
    // so this tests queue execution separately from initial recovery.
    await harness.restart({ activateNative: true })
    const publishedCorrection = await waitForAdmission(api, correctionA.id)
    const correctedMcpSession = await openMcpSession(api)
    expect(publishedCorrection.status).toBe('PUBLISHED')
    expect(publishedCorrection.source.sourceKey).toBe('ui-doc-a')
    expect(publishedCorrection.sourceVersion).toBe('2')
    expect(publishedCorrection.snapshotId).not.toBe(publishedA.snapshotId)
    expect(publishedCorrection.snapshotId).toBeTruthy()
    const nativeCorrection = await assertNativeRun(publishedCorrection.executionRunId, 'corrected document A')
    expect(nativeCorrection.receiptRow.modelRevision).toBe(modelRevision)
    expect(publishedB.snapshotId).toBe((await readAdmission(api, documentB.id)).body.snapshotId)

    const correctedQuery = await queryHttp(api, { businessId: business.id, query: 'Which company employs Alice?', topK: 10 })
    const correctedMcpQuery = await callMcp(api, correctedMcpSession, 'knowledge.query', { businessId: business.id, query: 'Which company employs Alice?', topK: 10 }, 'knowledge-query-corrected')
    expect(correctedQuery.body.corpusGeneration).toBeGreaterThan(initialQuery.body.corpusGeneration)
    expect(correctedMcpQuery.corpusGeneration).toBe(correctedQuery.body.corpusGeneration)
    expect(correctedQuery.body.results.some((row) => row.sourceId === publishedCorrection.source.id && row.text === 'Alice works for Beacon Ltd.')).toBe(true)
    expect(correctedQuery.body.results.some((row) => row.sourceId === publishedB.source.id && row.text === 'Alice works for Acme Ltd.')).toBe(true)
    expect(correctedMcpQuery.results.some((row) => row.sourceId === publishedCorrection.source.id && row.text === 'Alice works for Beacon Ltd.')).toBe(true)
    expect(correctedMcpQuery.results.some((row) => row.sourceId === publishedB.source.id && row.text === 'Alice works for Acme Ltd.')).toBe(true)
    const correctedA = correctedQuery.body.results.find((row) => row.sourceId === publishedCorrection.source.id)
    expect(correctedA?.sourceVersion || publishedCorrection.sourceVersion).toBe('2')

    const oldCitationAfterCorrection = await api.get(`/api/knowledge/citations/${encodeURIComponent(oldCitation)}`)
    const oldCitationAfterBody = await requireOk(oldCitationAfterCorrection, 'historical citation after correction')
    const oldCitationAfterMcpBody = await callMcp(api, correctedMcpSession, 'knowledge.citation', { citationId: oldCitation }, 'knowledge-citation-historical')
    expect(oldCitationAfterBody.sourceVersion).toBe('1')
    expect(oldCitationAfterBody.text).toBe('Alice works for Acme Ltd.')
    expect(oldCitationAfterMcpBody.sourceVersion).toBe('1')
    expect(oldCitationAfterMcpBody.text).toBe('Alice works for Acme Ltd.')

    const sourceVersionBeforeWithdraw = publishedB.source.version
    const withdrawn = await api.delete(`/api/knowledge/sources/${encodeURIComponent(publishedB.source.id)}`, { data: { expectedVersion: sourceVersionBeforeWithdraw } })
    const withdrawnBody = await requireOk(withdrawn, 'source withdrawal')
    expect(withdrawnBody.status).toBe('WITHDRAWN')
    expect(withdrawnBody.source.revokedAt).toBeTruthy()
    const withdrawnQuery = await queryHttp(api, { businessId: business.id, query: 'Which company employs Alice?', topK: 10 })
    const withdrawnMcpQuery = await callMcp(api, correctedMcpSession, 'knowledge.query', { businessId: business.id, query: 'Which company employs Alice?', topK: 10 }, 'knowledge-query-withdrawn')
    expect(withdrawnQuery.body.results.some((row) => row.sourceId === publishedB.source.id)).toBe(false)
    expect(withdrawnQuery.body.results.some((row) => row.sourceId === publishedCorrection.source.id && row.text === 'Alice works for Beacon Ltd.')).toBe(true)
    expect(withdrawnMcpQuery.results.some((row) => row.sourceId === publishedB.source.id)).toBe(false)
    expect(withdrawnMcpQuery.results.some((row) => row.sourceId === publishedCorrection.source.id && row.text === 'Alice works for Beacon Ltd.')).toBe(true)
    const withdrawnCitation = initialQuery.body.results.find((row) => row.sourceId === publishedB.source.id)?.citationId
    expect(withdrawnCitation).toMatch(/^kc1\./)
    const withdrawnCitationResponse = await api.get(`/api/knowledge/citations/${encodeURIComponent(withdrawnCitation)}`)
    expect(withdrawnCitationResponse.status(), 'withdrawn source citation must be inaccessible').toBe(404)

    const listResponse = await api.get(`/api/knowledge/ingestions?businessId=${encodeURIComponent(business.id)}`)
    const listBody = await requireOk(listResponse, 'knowledge ingestion list')
    expect(listBody.items.map((item) => item.id)).toEqual(expect.arrayContaining([browserId, documentB.id, correctionA.id]))
    expect(listBody.items.find((item) => item.id === browserId).status).toBe('PUBLISHED')
    expect(listBody.items.find((item) => item.id === correctionA.id).status).toBe('PUBLISHED')
    expect(listBody.items.find((item) => item.id === documentB.id).status).toBe('WITHDRAWN')
    rememberPublishedJob({ label: 'browser-text-a-v1', ingress: 'browser-files-text', published: publishedA })
    rememberPublishedJob({ label: 'mcp-text-b-v1', ingress: 'mcp-knowledge.ingestion_create', published: publishedB })
    rememberPublishedJob({ label: 'http-text-a-v2-correction', ingress: 'http-knowledge-ingestions', published: publishedCorrection })
    mainTestSucceeded = true
  }, 15 * 60 * 1000)

  it('uploads a managed text FileAsset through Files, admits it as FILE, and rejects a binary FILE', async () => {
    if (!mainTestSucceeded) {
      throw new Error('Managed FileAsset acceptance requires the preceding browser/MCP/HTTP native recovery test to pass; benchmark state is not independently established')
    }
    // Rebind the native worker to the baseline fixture before the second test.
    // This removes any dependence on the first test's correction benchmark and
    // fails explicitly if the preceding test did not establish its state.
    await harness.deactivateNativeWorker()
    await harness.restartNative({ benchmarkFixture: fixture })
    await harness.restart({ activateNative: true })
    const deviceKey = `ki17-native-${Date.now().toString(36)}`
    const mountRoot = path.join(harness.tempDir, 'managed-file-mount')
    const mountResponse = await api.post('/api/files/mounts', {
      data: { businessId: business.id, deviceKey, rootPath: mountRoot },
    })
    const mount = await requireOk(mountResponse, 'managed file mount')
    expect(mount.status).toBe('ACTIVE')

    const fileContent = fixture.text.replace(...fixture.correction.replace)
    const asset = await createManagedFileFromFilesPage(harness, {
      deviceKey,
      name: 'knowledge-file.md',
      content: fileContent,
    })
    expect(asset.status).toBe('ACTIVE')
    expect(asset.mime).toBe('text/markdown')
    expect(asset.size).toBe(Buffer.byteLength(fileContent, 'utf8'))

    const fileAdmission = await admitHttp(api, {
      businessId: business.id,
      idempotencyKey: 'managed-file-text-v1',
      source: { kind: 'FILE', fileAssetId: asset.id, sourceKey: 'managed-file', version: '1', title: 'Managed knowledge file' },
    }, 'managed text FILE admission')
    fileAdmission.id = admissionId(fileAdmission.body)
    expect(fileAdmission.body.status).toBe('QUEUED')
    const publishedFile = await waitForAdmission(api, fileAdmission.id)
    expect(publishedFile.status).toBe('PUBLISHED')
    expect(publishedFile.source?.kind).toBe('FILE')
    await assertNativeRun(publishedFile.executionRunId, 'managed text file')
    rememberPublishedJob({ label: 'browser-file-v1', ingress: 'browser-files-managed-file', published: publishedFile })

    const binary = Buffer.from([0, 159, 146, 150, 255])
    const binaryResponse = await api.post('/api/files', {
      data: {
        businessId: business.id,
        storageKind: 'LOCAL_FILE',
        mountId: mount.id,
        relativePath: 'Documents/unsupported.bin',
        contentBase64: binary.toString('base64'),
        name: 'unsupported.bin',
        mime: 'application/octet-stream',
        size: binary.length,
      },
    })
    const binaryAsset = await requireOk(binaryResponse, 'managed binary FileAsset')
    expect(binaryAsset.status).toBe('ACTIVE')
    const invalidAdmission = await api.post('/api/knowledge/ingestions', {
      data: {
        businessId: business.id,
        idempotencyKey: 'managed-file-binary-v1',
        source: { kind: 'FILE', fileAssetId: binaryAsset.id, sourceKey: 'unsupported-binary', version: '1' },
      },
    })
    const invalidBody = await parseBody(invalidAdmission, 'binary FILE admission')
    expect(invalidAdmission.status(), JSON.stringify(invalidBody)).toBe(415)
    expect(invalidBody.error).toMatch(/plain text|Markdown/i)
    invalidFileAdmissionStatus = invalidAdmission.status()
    fileTestSucceeded = true
  }, 15 * 60 * 1000)
})

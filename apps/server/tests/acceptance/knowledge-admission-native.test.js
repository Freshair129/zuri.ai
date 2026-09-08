import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, expect as playwrightExpect } from '@playwright/test'
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
    api = harness.request
    const unauthenticated = await api.post('/api/knowledge/ingestions', { data: { businessId: business.id, idempotencyKey: 'unauthenticated', source: { kind: 'TEXT', sourceKey: 'unauthenticated', version: '1', content: 'must not be admitted' } } })
    expect(unauthenticated.status(), 'unauthenticated admission must fail before body authorization').toBe(401)
    await unauthenticated.dispose()
    const login = await api.post('/api/auth/login', { data: { username: E2E_USERNAME, password: E2E_PASSWORD } })
    expect(login.ok(), `owner login failed: HTTP ${login.status()}`).toBe(true)
    await login.dispose()
  }, 300000)

  afterAll(async () => {
    await harness?.close()
    await prisma.$disconnect()
  }, 300000)

  it('admits from browser and HTTP, survives restart, publishes two independent native snapshots, corrects one, and withdraws one', async () => {
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
    documentB = await admitHttp(api, bodyB, 'HTTP document B admission')
    documentB.id = admissionId(documentB.body)
    expect(documentB.body.source?.sourceKey).toBe('http-doc-b')
    expect(documentB.body.status).toBe('QUEUED')

    const duplicate = await api.post('/api/knowledge/ingestions', { data: bodyB })
    const duplicateBody = await requireOk(duplicate, 'idempotent HTTP admission retry')
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
    expect(initialQuery.body.ranking).toBe('rrf-k60')
    expect(initialQuery.body.corpusId).toBe(publishedA.corpus.id)
    expect(initialQuery.body.results.some((row) => row.sourceId === publishedA.source.id && row.text === 'Alice works for Acme Ltd.')).toBe(true)
    expect(initialQuery.body.results.some((row) => row.sourceId === publishedB.source.id && row.text === 'Alice works for Acme Ltd.')).toBe(true)
    const oldCitation = initialQuery.body.results.find((row) => row.sourceId === publishedA.source.id && row.text === 'Alice works for Acme Ltd.')?.citationId
    expect(oldCitation).toMatch(/^kc1\./)
    const oldCitationResponse = await api.get(`/api/knowledge/citations/${encodeURIComponent(oldCitation)}`)
    const oldCitationBody = await requireOk(oldCitationResponse, 'old citation before correction')
    expect(oldCitationBody.sourceVersion).toBe('1')
    expect(oldCitationBody.text).toBe('Alice works for Acme Ltd.')

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
    expect(publishedCorrection.status).toBe('PUBLISHED')
    expect(publishedCorrection.source.sourceKey).toBe('ui-doc-a')
    expect(publishedCorrection.sourceVersion).toBe('2')
    expect(publishedCorrection.snapshotId).not.toBe(publishedA.snapshotId)
    expect(publishedCorrection.snapshotId).toBeTruthy()
    const nativeCorrection = await assertNativeRun(publishedCorrection.executionRunId, 'corrected document A')
    expect(nativeCorrection.receiptRow.modelRevision).toBe(modelRevision)
    expect(nativeCorrection.receipt.model?.revision || nativeCorrection.receiptRow.modelRevision).toBeTruthy()
    expect(publishedB.snapshotId).toBe((await readAdmission(api, documentB.id)).body.snapshotId)

    const correctedQuery = await queryHttp(api, { businessId: business.id, query: 'Which company employs Alice?', topK: 10 })
    expect(correctedQuery.body.corpusGeneration).toBeGreaterThan(initialQuery.body.corpusGeneration)
    expect(correctedQuery.body.results.some((row) => row.sourceId === publishedCorrection.source.id && row.text === 'Alice works for Beacon Ltd.')).toBe(true)
    expect(correctedQuery.body.results.some((row) => row.sourceId === publishedB.source.id && row.text === 'Alice works for Acme Ltd.')).toBe(true)
    const correctedA = correctedQuery.body.results.find((row) => row.sourceId === publishedCorrection.source.id)
    expect(correctedA?.sourceVersion || publishedCorrection.sourceVersion).toBe('2')

    const oldCitationAfterCorrection = await api.get(`/api/knowledge/citations/${encodeURIComponent(oldCitation)}`)
    const oldCitationAfterBody = await requireOk(oldCitationAfterCorrection, 'historical citation after correction')
    expect(oldCitationAfterBody.sourceVersion).toBe('1')
    expect(oldCitationAfterBody.text).toBe('Alice works for Acme Ltd.')

    const sourceVersionBeforeWithdraw = publishedB.source.version
    const withdrawn = await api.delete(`/api/knowledge/sources/${encodeURIComponent(publishedB.source.id)}`, { data: { expectedVersion: sourceVersionBeforeWithdraw } })
    const withdrawnBody = await requireOk(withdrawn, 'source withdrawal')
    expect(withdrawnBody.status).toBe('WITHDRAWN')
    expect(withdrawnBody.source.revokedAt).toBeTruthy()
    const withdrawnQuery = await queryHttp(api, { businessId: business.id, query: 'Which company employs Alice?', topK: 10 })
    expect(withdrawnQuery.body.results.some((row) => row.sourceId === publishedB.source.id)).toBe(false)
    expect(withdrawnQuery.body.results.some((row) => row.sourceId === publishedCorrection.source.id && row.text === 'Alice works for Beacon Ltd.')).toBe(true)
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
  }, 15 * 60 * 1000)
})

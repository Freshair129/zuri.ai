// @req FR-143 — the reference poller walks claim -> download -> extract -> complete|fail
// without ever logging the device credential.
// @spec SDD-085, SEC-025, ADR-059 D6
// @tested tests/unit/edge-extraction-poller.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  buildAuthHeaders,
  buildClaimPayload,
  buildCompletePayload,
  buildFailPayload,
  computeBackoffMs,
  defaultExtractCandidate,
  runPoller,
} from '../../scripts/edge-extraction-poller.mjs'

const DEVICE_KEY = 'edgk_super-secret-do-not-log-me'

function jsonResponse(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('FR-143 edge extraction poller — pure helpers', () => {
  it('computes exponential backoff with a hard cap', () => {
    expect(computeBackoffMs(1)).toBe(1000)
    expect(computeBackoffMs(2)).toBe(2000)
    expect(computeBackoffMs(3)).toBe(4000)
    expect(computeBackoffMs(4)).toBe(8000)
    expect(computeBackoffMs(20)).toBe(30000) // capped, never grows unbounded
  })

  it('builds the Authorization header from the raw device key, and nothing else', () => {
    expect(buildAuthHeaders(DEVICE_KEY)).toEqual({ Authorization: `Bearer ${DEVICE_KEY}` })
  })

  it('the claim payload is empty by design — identity comes from the credential, never the body', () => {
    expect(buildClaimPayload()).toEqual({})
  })

  it('builds the complete payload with exactly candidate and model', () => {
    const candidate = { schemaVersion: '1.0', status: 'CANDIDATE', documentType: 'RECEIPT', fields: [] }
    expect(buildCompletePayload(candidate, 'qwen2.5-vl-7b')).toEqual({ candidate, model: 'qwen2.5-vl-7b' })
  })

  it('builds the fail payload with a bounded reason string', () => {
    expect(buildFailPayload('local model timed out')).toEqual({ reason: 'local model timed out' })
    expect(buildFailPayload('x'.repeat(2000)).reason).toHaveLength(1000)
  })

  it('the default extractCandidate stub returns a schema-shaped, zero-field candidate at model edge-stub', async () => {
    const { candidate, model } = await defaultExtractCandidate({
      job: { evidence: { documentType: 'INVOICE' } },
    })
    expect(candidate).toEqual({ schemaVersion: '1.0', status: 'CANDIDATE', documentType: 'INVOICE', fields: [] })
    expect(model).toBe('edge-stub')
  })

  it('the default extractCandidate stub falls back to OTHER when the job carries no documentType', async () => {
    const { candidate } = await defaultExtractCandidate({ job: { evidence: {} } })
    expect(candidate.documentType).toBe('OTHER')
  })
})

describe('FR-143 edge extraction poller — loop behavior against a mocked fetch', () => {
  it('claims, downloads, extracts and completes a job, then stops after one iteration', async () => {
    const evidenceBytes = new Uint8Array([1, 2, 3, 4])
    const job = {
      id: 'job-1', businessId: 'biz-1', evidenceId: 'ev-1', status: 'CLAIMED',
      evidence: { mime: 'image/jpeg', documentType: 'RECEIPT' }, attempts: 1, version: 2,
    }
    const calls = []
    const fetchImpl = vi.fn(async (url, init) => {
      const href = url.toString()
      calls.push({ href, method: init?.method, headers: init?.headers, body: init?.body })
      if (href.endsWith('/api/edge/extraction-jobs/claim')) return jsonResponse(200, { job })
      if (href.endsWith('/api/edge/extraction-jobs/job-1/evidence')) {
        return new Response(evidenceBytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
      }
      if (href.endsWith('/api/edge/extraction-jobs/job-1/complete')) {
        return jsonResponse(200, { job: { ...job, status: 'COMPLETED' } })
      }
      throw new Error(`unexpected fetch: ${href}`)
    })

    let iterations = 0
    await runPoller({
      baseUrl: 'https://cloud.example',
      deviceKey: DEVICE_KEY,
      fetchImpl,
      sleepImpl: vi.fn(async () => {}),
      logger: { log: vi.fn(), error: vi.fn() },
      shouldStop: () => {
        iterations += 1
        return iterations > 1
      },
    })

    expect(calls).toHaveLength(3)
    expect(calls.every((call) => call.headers.Authorization === `Bearer ${DEVICE_KEY}`)).toBe(true)
    const completeCall = calls.find((call) => call.href.endsWith('/complete'))
    const completeBody = JSON.parse(completeCall.body)
    expect(completeBody).toEqual({
      candidate: { schemaVersion: '1.0', status: 'CANDIDATE', documentType: 'RECEIPT', fields: [] },
      model: 'edge-stub',
    })
    // The device key must never appear anywhere but the Authorization header value.
    expect(JSON.stringify(calls.map((call) => ({ ...call, headers: undefined })))).not.toContain(DEVICE_KEY)
  })

  it('sleeps the poll interval on 204 (nothing queued) without calling download/complete', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    const sleepImpl = vi.fn(async () => {})
    let iterations = 0
    await runPoller({
      baseUrl: 'https://cloud.example',
      deviceKey: DEVICE_KEY,
      fetchImpl,
      sleepImpl,
      pollMs: 5000,
      logger: { log: vi.fn(), error: vi.fn() },
      shouldStop: () => {
        iterations += 1
        return iterations > 1
      },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).toHaveBeenCalledWith(5000)
  })

  it('reports extraction failures to the fail endpoint with a redacted reason, never a raw error object', async () => {
    const job = { id: 'job-2', evidence: { mime: 'application/pdf', documentType: 'INVOICE' } }
    const failCalls = []
    const fetchImpl = vi.fn(async (url, init) => {
      const href = url.toString()
      if (href.endsWith('/claim')) return jsonResponse(200, { job })
      if (href.endsWith('/evidence')) return new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'application/pdf' } })
      if (href.endsWith('/fail')) { failCalls.push(JSON.parse(init.body)); return jsonResponse(200, { job: { ...job, status: 'FAILED' } }) }
      throw new Error(`unexpected fetch: ${href}`)
    })
    let iterations = 0
    await runPoller({
      baseUrl: 'https://cloud.example',
      deviceKey: DEVICE_KEY,
      fetchImpl,
      extractCandidate: async () => { throw new Error('local vision daemon crashed at /var/lib/models/secret-path') },
      sleepImpl: vi.fn(async () => {}),
      logger: { log: vi.fn(), error: vi.fn() },
      shouldStop: () => { iterations += 1; return iterations > 1 },
    })
    expect(failCalls).toEqual([{ reason: 'local vision daemon crashed at /var/lib/models/secret-path' }])
  })

  it('backs off exponentially on repeated claim failures (5xx) instead of hammering the cloud', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 }))
    const sleepImpl = vi.fn(async () => {})
    let iterations = 0
    await runPoller({
      baseUrl: 'https://cloud.example',
      deviceKey: DEVICE_KEY,
      fetchImpl,
      sleepImpl,
      logger: { log: vi.fn(), error: vi.fn() },
      shouldStop: () => { iterations += 1; return iterations > 3 },
    })
    expect(sleepImpl.mock.calls.map((call) => call[0])).toEqual([1000, 2000, 4000])
  })
})

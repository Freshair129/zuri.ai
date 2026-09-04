#!/usr/bin/env node
// @req FR-143 — reference poller for edge-executed asset evidence extraction (pull model).
// @spec SDD-085, SEC-025, ADR-059 D6 — the edge runtime itself lives in the
// zuri-edge-device repository; this file is the contract's reference implementation,
// dependency-free, so that repository's team has a working starting point and this
// repository has one place proving the wire contract is actually walkable end to end.
//
// Loop: claim -> download evidence bytes -> extractCandidate(bytes, mime, job) -> complete | fail.
// The device credential (FR-144, `edgk_...`) is read once from the environment and is
// NEVER logged, printed, or included in any error message this script produces —
// SEC-025 treats a leaked device key the same as a leaked platform key.
//
// Env:
//   ZURI_CLOUD_BASE_URL   required — e.g. https://myshop.example.ngrok.app
//   ZURI_EDGE_DEVICE_KEY  required — the raw `edgk_...` key minted at /platform/integrations
//   ZURI_EDGE_POLL_MS     optional — delay between claim attempts when the queue is empty
//                          (default 5000). Ignored while a claimed job is being worked.
//
// Usage: node scripts/edge-extraction-poller.mjs
// Or, from the zuri-edge-device repository, pass a custom extractCandidate hook by
// importing { runPoller, defaultExtractCandidate } and supplying your own hook that
// calls the local vision/LLM daemon instead of the stub below.

import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const DEFAULT_POLL_MS = 5000
const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000
const MAX_BACKOFF_ATTEMPTS_TRACKED = 10 // beyond this, backoff is flat at MAX_BACKOFF_MS

/**
 * Exponential backoff with a hard cap, used only for 5xx / network failures against
 * the cloud (never for an ordinary "nothing queued" 204, which uses the plain poll
 * interval instead). attempt is 1-based: the first failure backs off BASE_BACKOFF_MS.
 */
export function computeBackoffMs(attempt, baseMs = BASE_BACKOFF_MS, maxMs = MAX_BACKOFF_MS) {
  const bounded = Math.min(Math.max(attempt, 1), MAX_BACKOFF_ATTEMPTS_TRACKED)
  return Math.min(baseMs * 2 ** (bounded - 1), maxMs)
}

/** Authorization header for every device-authenticated call. Never log the return value. */
export function buildAuthHeaders(deviceKey) {
  return { Authorization: `Bearer ${deviceKey}` }
}

/** POST /api/edge/extraction-jobs/claim body — empty by design (SDD-085: identity comes from the credential). */
export function buildClaimPayload() {
  return {}
}

/** POST /api/edge/extraction-jobs/{id}/complete body. */
export function buildCompletePayload(candidate, model) {
  return { candidate, model }
}

/** POST /api/edge/extraction-jobs/{id}/fail body. `reason` must never carry a stack trace, host, or credential. */
export function buildFailPayload(reason) {
  return { reason: String(reason).slice(0, 1000) }
}

/**
 * The pluggable extraction hook. Replace this with a call into your local vision/LLM
 * daemon. Must return { candidate, model } where `candidate` validates against the
 * same zCandidate schema the OpenAI adapter uses (contracts/edge-extraction-job.schema.json
 * `definitions.candidate` mirrors it exactly). The default stub below makes no claim
 * about document contents — it returns a schema-valid, zero-confidence, empty candidate
 * so the pull-model round trip is provable without a real local model installed.
 */
export async function defaultExtractCandidate({ job }) {
  const documentType = job?.evidence?.documentType || 'OTHER'
  return {
    candidate: { schemaVersion: '1.0', status: 'CANDIDATE', documentType, fields: [] },
    model: 'edge-stub',
  }
}

function redactError(error) {
  // Never let a raw error object (which could echo back request internals) reach a log line.
  return error?.message ? String(error.message) : 'unknown error'
}

async function claimJob({ baseUrl, deviceKey, fetchImpl }) {
  const response = await fetchImpl(new URL('/api/edge/extraction-jobs/claim', baseUrl), {
    method: 'POST',
    headers: { ...buildAuthHeaders(deviceKey), 'content-type': 'application/json' },
    body: JSON.stringify(buildClaimPayload()),
  })
  if (response.status === 204) return null
  if (!response.ok) {
    const error = new Error(`claim failed with status ${response.status}`)
    error.status = response.status
    throw error
  }
  const body = await response.json()
  return body.job
}

async function downloadEvidence({ baseUrl, deviceKey, fetchImpl, jobId }) {
  const response = await fetchImpl(new URL(`/api/edge/extraction-jobs/${jobId}/evidence`, baseUrl), {
    method: 'GET',
    headers: buildAuthHeaders(deviceKey),
  })
  if (!response.ok) {
    const error = new Error(`evidence download failed with status ${response.status}`)
    error.status = response.status
    throw error
  }
  const mime = response.headers.get('content-type') || 'application/octet-stream'
  const arrayBuffer = await response.arrayBuffer()
  return { bytes: Buffer.from(arrayBuffer), mime }
}

async function completeJob({ baseUrl, deviceKey, fetchImpl, jobId, candidate, model }) {
  const response = await fetchImpl(new URL(`/api/edge/extraction-jobs/${jobId}/complete`, baseUrl), {
    method: 'POST',
    headers: { ...buildAuthHeaders(deviceKey), 'content-type': 'application/json' },
    body: JSON.stringify(buildCompletePayload(candidate, model)),
  })
  if (!response.ok) {
    const error = new Error(`complete failed with status ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

async function failJob({ baseUrl, deviceKey, fetchImpl, jobId, reason }) {
  const response = await fetchImpl(new URL(`/api/edge/extraction-jobs/${jobId}/fail`, baseUrl), {
    method: 'POST',
    headers: { ...buildAuthHeaders(deviceKey), 'content-type': 'application/json' },
    body: JSON.stringify(buildFailPayload(reason)),
  })
  if (!response.ok) {
    const error = new Error(`fail failed with status ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

/**
 * Runs the claim -> download -> extract -> complete|fail loop until `shouldStop()`
 * returns true. Every collaborator is injectable so this can be unit-tested with a
 * mocked fetch and a fake clock, and so the zuri-edge-device repository can swap in
 * its own logger or extraction hook without forking this file.
 */
export async function runPoller({
  baseUrl,
  deviceKey,
  fetchImpl = fetch,
  extractCandidate = defaultExtractCandidate,
  pollMs = DEFAULT_POLL_MS,
  sleepImpl = delay,
  logger = console,
  shouldStop = () => false,
} = {}) {
  if (!baseUrl) throw new Error('ZURI_CLOUD_BASE_URL is required')
  if (!deviceKey) throw new Error('ZURI_EDGE_DEVICE_KEY is required')

  let consecutiveFailures = 0

  while (!shouldStop()) {
    let job
    try {
      job = await claimJob({ baseUrl, deviceKey, fetchImpl })
      consecutiveFailures = 0
    } catch (error) {
      consecutiveFailures += 1
      const backoff = computeBackoffMs(consecutiveFailures)
      logger.error?.(`[edge-poller] claim failed (${redactError(error)}); retrying in ${backoff}ms`)
      await sleepImpl(backoff)
      continue
    }

    if (!job) {
      await sleepImpl(pollMs)
      continue
    }

    logger.log?.(`[edge-poller] claimed job ${job.id} (evidence ${job.evidenceId})`)

    try {
      const { bytes, mime } = await downloadEvidence({ baseUrl, deviceKey, fetchImpl, jobId: job.id })
      const { candidate, model } = await extractCandidate({ bytes, mime, job })
      await completeJob({ baseUrl, deviceKey, fetchImpl, jobId: job.id, candidate, model })
      logger.log?.(`[edge-poller] completed job ${job.id}`)
    } catch (error) {
      logger.error?.(`[edge-poller] job ${job.id} failed: ${redactError(error)}`)
      try {
        await failJob({ baseUrl, deviceKey, fetchImpl, jobId: job.id, reason: redactError(error) })
      } catch (failError) {
        logger.error?.(`[edge-poller] could not report failure for job ${job.id}: ${redactError(failError)}`)
      }
    }
  }
}

function parsePollMs(env) {
  const raw = env.ZURI_EDGE_POLL_MS
  if (!raw) return DEFAULT_POLL_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_MS
}

async function main() {
  const baseUrl = process.env.ZURI_CLOUD_BASE_URL
  const deviceKey = process.env.ZURI_EDGE_DEVICE_KEY
  if (!baseUrl || !deviceKey) {
    console.error('edge-extraction-poller: set ZURI_CLOUD_BASE_URL and ZURI_EDGE_DEVICE_KEY')
    process.exitCode = 1
    return
  }

  let stopping = false
  process.on('SIGINT', () => {
    stopping = true
    console.log('\n[edge-poller] stopping (SIGINT)...')
  })

  await runPoller({
    baseUrl,
    deviceKey,
    pollMs: parsePollMs(process.env),
    shouldStop: () => stopping,
  })
  console.log('[edge-poller] stopped')
}

// Only run when invoked directly (`node scripts/edge-extraction-poller.mjs`), not when
// imported by a test or by the zuri-edge-device repository's own entrypoint.
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMainModule) {
  main().catch((error) => {
    console.error(`[edge-poller] fatal: ${redactError(error)}`)
    process.exitCode = 1
  })
}

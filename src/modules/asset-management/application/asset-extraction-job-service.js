import { z } from 'zod'
import prisma from '@/lib/db'
import { zCandidate } from '../infrastructure/asset-evidence-candidate-schema'
import { assertAssetIntakeWrite } from './asset-authority'
import { resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { refreshAssetIntakeStatus } from './asset-intake-service'

// @req FR-143 — the cloud queues one unit of extraction work, a Zuri Edge Device
//   claims it under a time-boxed lease, downloads the evidence bytes through the
//   cloud, and posts a candidate back. Pull, not push, because the cloud cannot
//   reach a device behind a customer's NAT (ADR-059 D1); a lease rather than a
//   lock because a device can lose power mid-job and nothing must be stuck
//   forever (D3). The bytes are served by this application from its own object
//   storage — a bucket URL or storage credential never leaves the cloud, which is
//   ADR-041 D3 restated as code.
// @spec SDD-085, SEC-025, BR-025, ADR-059, ADR-041 D3
// @tested tests/unit/asset-extraction-job-view.test.js,
//   tests/integration/fr143-asset-extraction-job.test.js

export const EXTRACTION_JOB_STATUSES = Object.freeze(['QUEUED', 'CLAIMED', 'COMPLETED', 'FAILED', 'CANCELLED'])
export const EXTRACTION_JOB_TERMINAL = Object.freeze(['COMPLETED', 'FAILED', 'CANCELLED'])
/** Ten minutes: long enough for a slow local model on a large PDF, short enough
 *  that a dead device's job is picked up again within one operator coffee. */
export const EXTRACTION_LEASE_MS = 10 * 60 * 1000
/** After three failed attempts the job stops being retried and stays FAILED. */
export const EXTRACTION_MAX_ATTEMPTS = 3
export const EXTRACTION_JOB_ENTITY = 'ASSET_EXTRACTION_JOB'
export const EDGE_PROVIDER = 'edge'

const zComplete = z.object({
  candidate: zCandidate,
  model: z.string().min(1).max(200),
}).strict()

const zFail = z.object({ reason: z.string().min(1).max(2_000) }).strict()

function jobError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

/** Not found and not yours are the same answer (FR-072(a)). */
const notFound = () => jobError('Asset extraction job not found', 404)

const JOB_FIELDS = {
  id: true, businessId: true, evidenceId: true, status: true, claimedByDeviceId: true,
  claimedAt: true, leaseExpiresAt: true, attempts: true, lastError: true,
  provider: true, model: true, createdAt: true, updatedAt: true, version: true,
}

/** A device context is not a viewer: it must carry the marker and a Business. */
function requireDevice(deviceContext) {
  if (!deviceContext?.isEdgeDevice || !deviceContext.businessId || !deviceContext.deviceId) {
    throw jobError('An edge device credential is required', 401)
  }
  return deviceContext
}

async function loadEvidence(db, evidenceId) {
  return db.assetEvidence.findUnique({
    where: { id: evidenceId },
    include: { fileAsset: true },
  })
}

/**
 * Queue extraction for one evidence row, or return the job already in flight.
 *
 * At most one non-terminal job per evidence: a second queue request is an
 * operator clicking twice, not a second unit of work, and two devices extracting
 * the same bytes would race to write two candidates over each other.
 */
export async function enqueueAssetExtractionJob(evidenceId, { db = prisma, businessId = null, viewer } = {}) {
  const evidence = await loadEvidence(db, evidenceId)
  if (!evidence || evidence.deletedAt || (businessId && evidence.businessId !== businessId)) throw jobError('Asset evidence not found', 404)
  assertAssetIntakeWrite(viewer, evidence.businessId)
  if (evidence.fileAsset?.status !== 'ACTIVE' || evidence.fileAsset?.deletedAt) throw jobError('Asset evidence not found', 404)

  const existing = await db.assetExtractionJob.findFirst({
    where: { evidenceId: evidence.id, status: { in: ['QUEUED', 'CLAIMED'] } },
    orderBy: { createdAt: 'desc' },
    select: JOB_FIELDS,
  })
  if (existing) return { job: existing, created: false }

  const job = await db.assetExtractionJob.create({
    data: {
      tenantId: evidence.tenantId,
      businessId: evidence.businessId,
      evidenceId: evidence.id,
      provider: EDGE_PROVIDER,
    },
    select: JOB_FIELDS,
  })
  await recordAudit(db, {
    entityType: EXTRACTION_JOB_ENTITY,
    entityId: job.id,
    action: 'ASSET_EXTRACTION_JOB_QUEUED',
    payload: { businessId: job.businessId, evidenceId: job.evidenceId },
    actorId: viewer?.principal?.id ?? null,
  })
  return { job, created: true }
}

/** The latest job for one evidence, for the review surface to poll. */
export async function getLatestAssetExtractionJob(evidenceId, { db = prisma, businessId = null, viewer } = {}) {
  const evidence = await loadEvidence(db, evidenceId)
  if (!evidence || evidence.deletedAt || (businessId && evidence.businessId !== businessId)) throw jobError('Asset evidence not found', 404)
  assertAssetIntakeWrite(viewer, evidence.businessId)
  const job = await db.assetExtractionJob.findFirst({
    where: { evidenceId: evidence.id },
    orderBy: { createdAt: 'desc' },
    select: JOB_FIELDS,
  })
  return { job: job ?? null }
}

/**
 * Claim the oldest waiting job of the device's own Business.
 *
 * "Waiting" is QUEUED, or CLAIMED with an expired lease — the second case is how
 * a job survives a device that died holding it. The claim is a conditional
 * update on the row's `version`, so two devices racing for the same job produce
 * one winner and one empty answer rather than two claims.
 */
export async function claimAssetExtractionJob({ deviceContext, db = prisma, now = () => new Date() } = {}) {
  const device = requireDevice(deviceContext)
  const at = now()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidateJob = await db.assetExtractionJob.findFirst({
      where: {
        businessId: device.businessId,
        OR: [
          { status: 'QUEUED' },
          { status: 'CLAIMED', leaseExpiresAt: { lt: at } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, version: true, attempts: true },
    })
    if (!candidateJob) return { job: null }

    const claimed = await db.assetExtractionJob.updateMany({
      where: { id: candidateJob.id, version: candidateJob.version },
      data: {
        status: 'CLAIMED',
        claimedByDeviceId: device.deviceId,
        claimedAt: at,
        leaseExpiresAt: new Date(at.getTime() + EXTRACTION_LEASE_MS),
        attempts: candidateJob.attempts + 1,
        version: { increment: 1 },
      },
    })
    if (claimed.count === 0) continue // lost the race; look again

    const job = await db.assetExtractionJob.findUnique({ where: { id: candidateJob.id }, select: JOB_FIELDS })
    await recordAudit(db, {
      entityType: EXTRACTION_JOB_ENTITY,
      entityId: job.id,
      action: 'ASSET_EXTRACTION_JOB_CLAIMED',
      payload: { businessId: job.businessId, evidenceId: job.evidenceId, deviceId: device.deviceId, attempts: job.attempts },
      actorType: 'EDGE_DEVICE',
    })
    return { job }
  }
  return { job: null }
}

/** The job this device is holding right now, or a 404-shaped refusal. */
async function loadHeldJob(jobId, device, db, at) {
  const job = await db.assetExtractionJob.findUnique({ where: { id: String(jobId || '') }, select: { ...JOB_FIELDS, tenantId: true } })
  if (!job || job.businessId !== device.businessId) throw notFound()
  if (job.status !== 'CLAIMED' || job.claimedByDeviceId !== device.deviceId) throw notFound()
  if (!job.leaseExpiresAt || job.leaseExpiresAt.getTime() <= at.getTime()) throw notFound()
  return job
}

/**
 * The evidence bytes for a job this device holds.
 *
 * Served by the application, never as a storage URL: the device gets exactly the
 * one object it was given work for, for exactly as long as its lease lasts, and
 * the cloud's storage credential stays in the cloud (ADR-041 D3, SEC-025).
 */
export async function readAssetExtractionJobEvidence(jobId, { deviceContext, db = prisma, objectStoragePort, now = () => new Date() } = {}) {
  const device = requireDevice(deviceContext)
  const job = await loadHeldJob(jobId, device, db, now())
  const evidence = await loadEvidence(db, job.evidenceId)
  if (!evidence || evidence.deletedAt || evidence.fileAsset?.status !== 'ACTIVE') throw notFound()
  const { content } = await resolveFileAssetContent(evidence.fileAssetId, {
    db,
    visibleBusinessIds: [job.businessId],
    objectStoragePort,
  })
  return {
    jobId: job.id,
    content,
    mime: evidence.fileAsset.mime,
    name: evidence.fileAsset.name,
    sha256: evidence.fileAsset.sha256,
  }
}

/**
 * Accept a device's candidate.
 *
 * The candidate is validated with the same schema the OpenAI adapter asks its
 * provider for (SDD-085) — a device cannot widen what a candidate may say. A
 * rejected candidate is not a silent no-op: the job goes FAILED with the
 * validation reason, so the operator sees why nothing arrived. The write itself
 * mirrors `extractAssetEvidence` exactly: extractionJson, status EXTRACTED, one
 * audit event. It never touches review or approval state (BR-025).
 */
export async function completeAssetExtractionJob(jobId, input, { deviceContext, db = prisma, now = () => new Date() } = {}) {
  const device = requireDevice(deviceContext)
  const at = now()
  const job = await loadHeldJob(jobId, device, db, at)

  let value
  try {
    value = zComplete.parse(input)
  } catch (error) {
    const reason = `CANDIDATE_SCHEMA_REJECTED: ${error?.issues?.[0]?.message || 'invalid candidate'}`
    await db.$transaction(async (tx) => {
      await tx.assetExtractionJob.updateMany({
        where: { id: job.id, version: job.version },
        data: { status: 'FAILED', lastError: reason, leaseExpiresAt: null, version: { increment: 1 } },
      })
      await recordAudit(tx, {
        entityType: EXTRACTION_JOB_ENTITY, entityId: job.id, action: 'ASSET_EXTRACTION_JOB_FAILED',
        payload: { businessId: job.businessId, evidenceId: job.evidenceId, deviceId: device.deviceId, reason },
        actorType: 'EDGE_DEVICE',
      })
    })
    throw jobError(reason, 400)
  }

  const candidate = { ...value.candidate, provider: EDGE_PROVIDER, model: value.model, deviceId: device.deviceId }
  const result = await db.$transaction(async (tx) => {
    // Conditional on the version we read: a late reply from a device whose lease
    // already expired and was re-claimed cannot overwrite the finisher's result.
    const moved = await tx.assetExtractionJob.updateMany({
      where: { id: job.id, version: job.version, status: 'CLAIMED' },
      data: {
        status: 'COMPLETED',
        provider: EDGE_PROVIDER,
        model: value.model,
        resultJson: JSON.stringify(candidate),
        lastError: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    })
    if (moved.count === 0) throw notFound()

    await tx.assetEvidence.update({
      where: { id: job.evidenceId },
      data: { extractionJson: JSON.stringify(candidate), status: 'EXTRACTED', version: { increment: 1 } },
    })
    await recordAudit(tx, {
      entityType: 'ASSET_EVIDENCE', entityId: job.evidenceId, action: 'ASSET_EVIDENCE_EXTRACTED',
      actorType: 'EDGE_DEVICE',
      payload: {
        businessId: job.businessId, jobId: job.id, provider: EDGE_PROVIDER,
        model: value.model, deviceId: device.deviceId, fieldCount: candidate.fields.length,
      },
    })
    const evidence = await tx.assetEvidence.findUnique({ where: { id: job.evidenceId }, select: { intakeId: true } })
    if (evidence?.intakeId) await refreshAssetIntakeStatus(evidence.intakeId, { db: tx, actorId: null })
    return tx.assetExtractionJob.findUnique({ where: { id: job.id }, select: JOB_FIELDS })
  })
  return { job: result, candidate }
}

/**
 * Record a device-side failure.
 *
 * Below the attempt ceiling the job returns to QUEUED so another device (or the
 * same one after a restart) can try again; at the ceiling it stays FAILED, which
 * is what the operator sees on the review surface.
 */
export async function failAssetExtractionJob(jobId, input, { deviceContext, db = prisma, now = () => new Date() } = {}) {
  const device = requireDevice(deviceContext)
  const at = now()
  const job = await loadHeldJob(jobId, device, db, at)
  const { reason } = zFail.parse(input)
  const exhausted = job.attempts >= EXTRACTION_MAX_ATTEMPTS

  const result = await db.$transaction(async (tx) => {
    const moved = await tx.assetExtractionJob.updateMany({
      where: { id: job.id, version: job.version, status: 'CLAIMED' },
      data: {
        status: exhausted ? 'FAILED' : 'QUEUED',
        lastError: reason,
        claimedByDeviceId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    })
    if (moved.count === 0) throw notFound()
    await recordAudit(tx, {
      entityType: EXTRACTION_JOB_ENTITY, entityId: job.id,
      action: exhausted ? 'ASSET_EXTRACTION_JOB_FAILED' : 'ASSET_EXTRACTION_JOB_REQUEUED',
      payload: { businessId: job.businessId, evidenceId: job.evidenceId, deviceId: device.deviceId, reason, attempts: job.attempts },
      actorType: 'EDGE_DEVICE',
    })
    return tx.assetExtractionJob.findUnique({ where: { id: job.id }, select: JOB_FIELDS })
  })
  return { job: result }
}

// @req FR-137, FR-138 — upload, extract and human-review Asset evidence.
// @spec SDD-081, SDD-082, BR-025, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-storage-contract.test.js, tests/unit/asset-evidence-extractor-contract.test.js
import { z } from 'zod'
import prisma from '@/lib/db'
import { inspectAssetEvidence, buildAssetEvidenceObjectKey } from '../domain/evidence-policy'
import { assertAssetIntakeWrite, assertAssetEvidenceReview, canWriteAssetIntake } from './asset-authority'
import { createManagedBlobFileAsset, resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { refreshAssetIntakeStatus } from './asset-intake-service'

const zReview = z.object({
  decision: z.enum(['ACCEPT', 'CORRECT', 'REJECT']),
  corrections: z.array(z.object({ field: z.string().min(1).max(100), value: z.unknown(), reason: z.string().max(500).nullish() }).strict()).max(200).default([]),
  note: z.string().max(2_000).nullish(),
}).strict()

function evidenceError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

export async function uploadAssetEvidence({ businessId, name, mime, content }, {
  db = prisma,
  viewer,
  objectStoragePort,
} = {}) {
  assertAssetIntakeWrite(viewer, businessId)
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true } })
  if (!business) throw evidenceError('Asset intake not found', 404)
  const inspected = inspectAssetEvidence({ content, declaredMime: mime, name })
  const duplicate = await db.fileAsset.findFirst({
    where: { businessId, sha256: inspected.sha256, storageKind: 'MANAGED_BLOB', status: 'ACTIVE', deletedAt: null },
  })
  if (duplicate) {
    return {
      id: duplicate.id, code: duplicate.code, name: duplicate.name, mime: duplicate.mime,
      size: duplicate.size, sha256: duplicate.sha256, status: duplicate.status,
    }
  }
  const key = buildAssetEvidenceObjectKey({ tenantId: business.tenantId, businessId, sha256: inspected.sha256, name })
  const stored = await objectStoragePort.put({ key, content: inspected.content, mime: inspected.mime })
  try {
    const asset = await createManagedBlobFileAsset({
      businessId,
      name,
      mime: inspected.mime,
      size: inspected.size,
      sha256: inspected.sha256,
      blobRef: stored.ref,
      uploadedBy: viewer?.principal?.id || null,
    }, { db, viewer, authorize: canWriteAssetIntake })
    return {
      id: asset.id,
      code: asset.code,
      name: asset.name,
      mime: asset.mime,
      size: asset.size,
      sha256: asset.sha256,
      status: asset.status,
    }
  } catch (error) {
    await objectStoragePort.remove({ ref: stored.ref }).catch(() => {})
    throw error
  }
}

async function findEvidence(db, evidenceId) {
  return db.assetEvidence.findUnique({
    where: { id: evidenceId },
    include: { fileAsset: true, intake: true },
  })
}

export async function extractAssetEvidence(evidenceId, {
  db = prisma,
  businessId = null,
  viewer,
  extractor,
  objectStoragePort,
} = {}) {
  const evidence = await findEvidence(db, evidenceId)
  if (!evidence || evidence.deletedAt || (businessId && evidence.businessId !== businessId)) throw evidenceError('Asset evidence not found', 404)
  assertAssetIntakeWrite(viewer, evidence.businessId)
  if (evidence.fileAsset?.status !== 'ACTIVE' || evidence.fileAsset?.deletedAt) throw evidenceError('Asset evidence not found', 404)
  const { content } = await resolveFileAssetContent(evidence.fileAssetId, {
    db, visibleBusinessIds: viewer.visibleBusinessIds, objectStoragePort,
  })
  const candidate = await extractor.extract({
    content,
    mime: evidence.fileAsset.mime,
    name: evidence.fileAsset.name,
    fileAssetId: evidence.fileAssetId,
  })
  const actorId = viewer?.principal?.id || null
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.assetEvidence.update({
      where: { id: evidence.id },
      data: { extractionJson: JSON.stringify(candidate), status: 'EXTRACTED', version: { increment: 1 } },
    })
    await recordAudit(tx, {
      entityType: 'ASSET_EVIDENCE', entityId: evidence.id, action: 'ASSET_EVIDENCE_EXTRACTED',
      actorId,
      payload: { businessId: evidence.businessId, intakeId: evidence.intakeId, provider: candidate.provider, model: candidate.model, responseId: candidate.responseId, fieldCount: candidate.fields.length },
    })
    await refreshAssetIntakeStatus(evidence.intakeId, { db: tx, actorId })
    return updated
  })
  return { evidence: result, candidate }
}

export async function reviewAssetEvidence(evidenceId, input, { db = prisma, businessId = null, viewer } = {}) {
  const value = zReview.parse(input)
  const evidence = await findEvidence(db, evidenceId)
  if (!evidence || evidence.deletedAt || (businessId && evidence.businessId !== businessId)) throw evidenceError('Asset evidence not found', 404)
  assertAssetEvidenceReview(viewer, evidence.businessId)
  let history = { entries: [] }
  try {
    const parsed = JSON.parse(evidence.reviewJson || '{}')
    if (Array.isArray(parsed.entries)) history = parsed
  } catch {}
  const reviewedAt = new Date()
  const entry = {
    version: history.entries.length + 1,
    decision: value.decision,
    corrections: value.corrections,
    note: value.note || null,
    reviewerPersonId: viewer?.principal?.id || null,
    reviewedAt: reviewedAt.toISOString(),
  }
  const status = value.decision === 'REJECT' ? 'REJECTED' : 'REVIEWED'
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.assetEvidence.update({
      where: { id: evidence.id },
      data: {
        reviewJson: JSON.stringify({ entries: [...history.entries, entry] }),
        status,
        reviewedByPersonId: entry.reviewerPersonId,
        reviewedAt,
        version: { increment: 1 },
      },
    })
    await recordAudit(tx, {
      entityType: 'ASSET_EVIDENCE', entityId: evidence.id, action: 'ASSET_EVIDENCE_REVIEWED', actorId: entry.reviewerPersonId,
      payload: { businessId: evidence.businessId, intakeId: evidence.intakeId, decision: value.decision, correctionCount: value.corrections.length },
    })
    const intake = await refreshAssetIntakeStatus(evidence.intakeId, { db: tx, actorId: entry.reviewerPersonId })
    return { updated, intake }
  })
  return { evidence: result.updated, review: entry, intakeStatus: result.intake.status }
}

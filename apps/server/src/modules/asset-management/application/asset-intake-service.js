// @req FR-137, FR-138 — one idempotent Asset draft writer and readiness gate.
// @spec SDD-081, SDD-082, BR-025, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-intake-service-contract.test.js
import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { validateAssetIntake } from '../domain/asset-intake'
import { assertAssetIntakeWrite } from './asset-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'

function intakeError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

export function canonicalAssetIntakeJson(envelope) {
  return JSON.stringify(canonicalize(envelope))
}

export function canonicalAssetIntakeHash(envelope) {
  return createHash('sha256').update(canonicalAssetIntakeJson(envelope)).digest('hex')
}

export function decideAssetIntakeReplay(existing, envelope) {
  if (!existing) return { kind: 'CREATE' }
  const payloadSha256 = canonicalAssetIntakeHash(envelope)
  if (existing.payloadSha256 === payloadSha256) return { kind: 'REPLAY', intake: existing }
  throw intakeError('Source correlation is already bound to a different payload', 409)
}

export function deriveAssetIntakeStatus({ validation, evidence = [] }) {
  if (!validation?.ok) return 'DRAFT'
  if (evidence.some((item) => item.status !== 'REVIEWED')) return 'NEEDS_REVIEW'
  return 'READY_FOR_REGISTRATION'
}

async function assertEvidenceReferences(db, envelope, businessId) {
  const ids = [...new Set(envelope.evidence.map((item) => item.fileAssetId))]
  if (!ids.length) return []
  const files = await db.fileAsset.findMany({
    where: { id: { in: ids }, businessId, status: 'ACTIVE', deletedAt: null },
    select: { id: true, tenantId: true, businessId: true, sha256: true, status: true },
  })
  if (files.length !== ids.length) throw intakeError('One or more evidence files are unavailable', 404)
  return files
}

export async function upsertAssetIntake(envelope, { db = prisma, viewer } = {}) {
  const businessId = envelope?.businessId
  assertAssetIntakeWrite(viewer, businessId)
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true } })
  if (!business) throw intakeError('Asset intake not found', 404)

  const validation = validateAssetIntake(envelope, { trustedTenantId: business.tenantId, trustedBusinessId: business.id })
  if (!validation.value) throw intakeError('Asset intake envelope is invalid')
  const normalizedEnvelope = validation.value
  const payloadSha256 = canonicalAssetIntakeHash(normalizedEnvelope)
  const files = await assertEvidenceReferences(db, normalizedEnvelope, business.id)
  const existing = await db.assetIntake.findUnique({
    where: { businessId_sourceChannel_sourceCorrelationId: {
      businessId: business.id,
      sourceChannel: normalizedEnvelope.source.channel,
      sourceCorrelationId: normalizedEnvelope.source.correlationId,
    } },
    include: { evidence: true, procurementRefs: true },
  })
  const replay = decideAssetIntakeReplay(existing, normalizedEnvelope)
  if (replay.kind === 'REPLAY') return { replayed: true, intake: existing, validation }

  const fileById = new Map(files.map((file) => [file.id, file]))
  const initialEvidence = normalizedEnvelope.evidence.map((item) => ({ ...item, status: 'ACTIVE' }))
  const status = deriveAssetIntakeStatus({ validation, evidence: initialEvidence })
  const actorId = viewer?.principal?.id || null
  const intakeCode = `AIT-${payloadSha256.slice(0, 12).toUpperCase()}`
  const now = new Date()

  const intake = await db.$transaction(async (tx) => {
    const created = await tx.assetIntake.create({ data: {
      tenantId: business.tenantId,
      businessId: business.id,
      intakeCode,
      schemaVersion: normalizedEnvelope.schemaVersion,
      sourceChannel: normalizedEnvelope.source.channel,
      sourceCorrelationId: normalizedEnvelope.source.correlationId,
      origin: normalizedEnvelope.origin,
      status,
      payloadSha256,
      normalizedEnvelopeJson: canonicalAssetIntakeJson(normalizedEnvelope),
      validationJson: JSON.stringify(validation),
      validatedAt: now,
      submittedByPersonId: actorId,
      submittedAt: now,
    } })
    for (const item of normalizedEnvelope.evidence) {
      await tx.assetEvidence.create({ data: {
        tenantId: business.tenantId,
        businessId: business.id,
        intakeId: created.id,
        fileAssetId: item.fileAssetId,
        role: item.role,
        status: 'ACTIVE',
        sha256: fileById.get(item.fileAssetId)?.sha256 || null,
        paymentReference: item.paymentReference || null,
      } })
    }
    for (const item of normalizedEnvelope.procurementRefs) {
      await tx.assetProcurementRef.create({ data: {
        tenantId: business.tenantId,
        businessId: business.id,
        intakeId: created.id,
        type: item.type,
        system: item.system,
        value: item.value,
        lineValue: item.lineValue || null,
      } })
    }
    await recordAudit(tx, {
      entityType: 'ASSET_INTAKE', entityId: created.id, action: 'ASSET_INTAKE_CREATED', actorId,
      payload: { businessId: business.id, intakeCode, sourceChannel: created.sourceChannel, status, payloadSha256 },
    })
    return created
  })

  const hydrated = await db.assetIntake.findUnique({
    where: { id: intake.id }, include: { evidence: true, procurementRefs: true },
  })
  return { replayed: false, intake: hydrated || intake, validation }
}

export async function refreshAssetIntakeStatus(intakeId, { db = prisma, actorId = null } = {}) {
  const intake = await db.assetIntake.findUnique({ where: { id: intakeId }, include: { evidence: true } })
  if (!intake || intake.deletedAt) throw intakeError('Asset intake not found', 404)
  let validation
  try { validation = JSON.parse(intake.validationJson) } catch { validation = { ok: false } }
  const status = deriveAssetIntakeStatus({ validation, evidence: intake.evidence.filter((item) => !item.deletedAt) })
  if (status === intake.status) return intake
  const updated = await db.assetIntake.update({
    where: { id: intake.id }, data: { status, version: { increment: 1 } },
  })
  await recordAudit(db, {
    entityType: 'ASSET_INTAKE', entityId: intake.id, action: 'ASSET_INTAKE_STATUS_CHANGED', actorId,
    payload: { businessId: intake.businessId, from: intake.status, to: status },
  })
  return updated
}

export async function listAssetIntakesForExport(businessId, { db = prisma, viewer, limit = 500 } = {}) {
  if (!viewer?.visibleBusinessIds?.includes(businessId)) throw intakeError('Business not found', 404)
  return db.assetIntake.findMany({
    where: { businessId, deletedAt: null },
    include: { evidence: { where: { deletedAt: null } }, procurementRefs: { where: { deletedAt: null } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit) || 500, 500),
  })
}

// @req FR-143 — the queue, the lease, the bytes and the candidate write.
// @spec SDD-085, SEC-025, BR-025, ADR-059, ADR-041 D3
// @tested tests/integration/fr143-asset-extraction-job.test.js
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { uploadAssetEvidence } from '@/modules/asset-management/application/asset-evidence-service'
import { upsertAssetIntake } from '@/modules/asset-management/application/asset-intake-service'
import { mintEdgeDeviceCredential, resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import {
  EXTRACTION_LEASE_MS,
  claimAssetExtractionJob,
  completeAssetExtractionJob,
  enqueueAssetExtractionJob,
  failAssetExtractionJob,
  getLatestAssetExtractionJob,
  readAssetExtractionJobEvidence,
} from '@/modules/asset-management/application/asset-extraction-job-service'

const CONTENT = Buffer.from('%PDF-1.7\nedge receipt')

const objectStoragePort = {
  put: vi.fn(async ({ key }) => ({ ref: `memory://asset-evidence/${key}` })),
  get: vi.fn(async () => CONTENT),
  remove: vi.fn(async () => undefined),
}

const asDevice = (raw) => ({ headers: { get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${raw}` : null) } })

const candidate = {
  schemaVersion: '1.0',
  status: 'CANDIDATE',
  documentType: 'RECEIPT',
  fields: [{ field: 'total', value: 1250.5, confidence: 0.91, page: 1, anchor: null, bounds: null }],
}

let business, otherBusiness, owner, otherOwner
let deviceA, deviceB
let evidenceIds = []

async function seedEvidence(businessOf, ownerOf, suffix) {
  const file = await uploadAssetEvidence({
    businessId: businessOf.id,
    name: `receipt-${suffix}.pdf`,
    mime: 'application/pdf',
    content: Buffer.concat([CONTENT, Buffer.from(suffix)]),
  }, { viewer: ownerOf, objectStoragePort })
  const created = await upsertAssetIntake({
    schemaVersion: '1.0',
    source: { channel: 'WEB', correlationId: `edge-job-${suffix}` },
    businessId: businessOf.id,
    origin: 'PROCUREMENT_PURCHASE',
    item: { name: `Notebook ${suffix}`, categoryCode: 'IT', quantity: 1, expiryControlled: false },
    evidence: [{ fileAssetId: file.id, role: 'PAYMENT_PROOF' }],
    procurementRefs: [{ type: 'PR', system: 'ERP', value: `PR-${suffix}` }, { type: 'PO', system: 'ERP', value: `PO-${suffix}` }],
    lot: null, responsibilities: [], location: null, projectAllocation: null, depreciation: null,
  }, { viewer: ownerOf })
  return created.intake.evidence[0].id
}

describe('FR-143 edge-executed extraction jobs', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-EDGE-JOB', name: 'Edge Job Group' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-EDGE-JOB', name: 'Edge Job Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-EDGE-JOB', name: 'Edge Job Business' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-EDGE-JOB-2', name: 'Neighbour Business' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['assets'] })
    otherOwner = makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: ['assets'] })

    const a = await mintEdgeDeviceCredential({ businessId: business.id, deviceId: 'DEV-EDGE-A', label: 'Node A', viewer: owner })
    const b = await mintEdgeDeviceCredential({ businessId: otherBusiness.id, deviceId: 'DEV-EDGE-B', label: 'Node B', viewer: otherOwner })
    deviceA = await resolveEdgeDeviceContext(asDevice(a.key))
    deviceB = await resolveEdgeDeviceContext(asDevice(b.key))

    evidenceIds = [
      await seedEvidence(business, owner, 'one'),
      await seedEvidence(business, owner, 'two'),
    ]
  })

  it('queues one job per evidence and returns the job already in flight instead of a second', async () => {
    const first = await enqueueAssetExtractionJob(evidenceIds[0], { businessId: business.id, viewer: owner })
    expect(first).toMatchObject({ created: true, job: { status: 'QUEUED', evidenceId: evidenceIds[0], provider: 'edge' } })
    const again = await enqueueAssetExtractionJob(evidenceIds[0], { businessId: business.id, viewer: owner })
    expect(again).toMatchObject({ created: false, job: { id: first.job.id } })
    expect(await prisma.assetExtractionJob.count({ where: { evidenceId: evidenceIds[0] } })).toBe(1)

    const read = await getLatestAssetExtractionJob(evidenceIds[0], { businessId: business.id, viewer: owner })
    expect(read.job.id).toBe(first.job.id)
  })

  it('AC-143.3/.4 — a device takes the oldest job of its own Business and never a neighbour\'s', async () => {
    await enqueueAssetExtractionJob(evidenceIds[1], { businessId: business.id, viewer: owner })
    // Business B has a paired device and no work of its own: an empty queue is not an error.
    expect(await claimAssetExtractionJob({ deviceContext: deviceB })).toEqual({ job: null })

    const firstClaim = await claimAssetExtractionJob({ deviceContext: deviceA })
    expect(firstClaim.job).toMatchObject({ evidenceId: evidenceIds[0], status: 'CLAIMED', claimedByDeviceId: 'DEV-EDGE-A', attempts: 1 })
    const secondClaim = await claimAssetExtractionJob({ deviceContext: deviceA })
    expect(secondClaim.job.evidenceId).toBe(evidenceIds[1])
    // Both are held now, so a third attempt finds nothing rather than handing held work out twice.
    expect(await claimAssetExtractionJob({ deviceContext: deviceA })).toEqual({ job: null })
    // The neighbour still sees nothing, though two jobs exist in the same Tenant.
    expect(await claimAssetExtractionJob({ deviceContext: deviceB })).toEqual({ job: null })
  })

  it('AC-143.5 — the bytes reach the holder under a live lease, and nobody else', async () => {
    const job = await prisma.assetExtractionJob.findFirst({ where: { evidenceId: evidenceIds[0] } })
    const served = await readAssetExtractionJobEvidence(job.id, { deviceContext: deviceA, objectStoragePort })
    expect(served.mime).toBe('application/pdf')
    expect(Buffer.isBuffer(served.content) || served.content instanceof Uint8Array).toBe(true)
    // What comes back is bytes and metadata; nothing here is a storage location.
    expect(JSON.stringify(Object.keys(served))).not.toMatch(/url|bucket|signed/i)

    await expect(readAssetExtractionJobEvidence(job.id, { deviceContext: deviceB, objectStoragePort }))
      .rejects.toMatchObject({ status: 404 })
    await expect(readAssetExtractionJobEvidence('made-up-id', { deviceContext: deviceA, objectStoragePort }))
      .rejects.toMatchObject({ status: 404 })
    // An expired lease answers exactly as never having held the job.
    const expired = new Date(Date.now() + EXTRACTION_LEASE_MS + 60_000)
    await expect(readAssetExtractionJobEvidence(job.id, { deviceContext: deviceA, objectStoragePort, now: () => expired }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('AC-143.7/.9 — a valid candidate is written exactly the way the cloud provider writes one', async () => {
    const job = await prisma.assetExtractionJob.findFirst({ where: { evidenceId: evidenceIds[0] } })
    const result = await completeAssetExtractionJob(job.id, { candidate, model: 'llava-local:13b' }, { deviceContext: deviceA })
    expect(result.job).toMatchObject({ status: 'COMPLETED', provider: 'edge', model: 'llava-local:13b' })

    const evidence = await prisma.assetEvidence.findUnique({ where: { id: evidenceIds[0] } })
    expect(evidence.status).toBe('EXTRACTED')
    const stored = JSON.parse(evidence.extractionJson)
    expect(stored).toMatchObject({ provider: 'edge', model: 'llava-local:13b', deviceId: 'DEV-EDGE-A', documentType: 'RECEIPT' })
    // A candidate is evidence, never a decision: review state is untouched (BR-025).
    expect(JSON.parse(evidence.reviewJson || '{}')).toEqual({})
    expect(evidence.reviewedAt).toBeNull()

    const audits = await prisma.auditEvent.findMany({ where: { entityId: evidenceIds[0], action: 'ASSET_EVIDENCE_EXTRACTED' } })
    expect(audits).toHaveLength(1)

    // A late second reply cannot overwrite a finished job or double the audit trail.
    await expect(completeAssetExtractionJob(job.id, { candidate, model: 'llava-local:13b' }, { deviceContext: deviceA }))
      .rejects.toMatchObject({ status: 404 })
    expect(await prisma.auditEvent.count({ where: { entityId: evidenceIds[0], action: 'ASSET_EVIDENCE_EXTRACTED' } })).toBe(1)
  })

  it('AC-143.8 — a candidate the shared schema rejects fails the job and writes nothing', async () => {
    const evidenceId = await seedEvidence(business, owner, 'bad')
    await enqueueAssetExtractionJob(evidenceId, { businessId: business.id, viewer: owner })
    const { job } = await claimAssetExtractionJob({ deviceContext: deviceA })
    expect(job.evidenceId).toBe(evidenceId)

    await expect(completeAssetExtractionJob(job.id, {
      candidate: { ...candidate, fields: [{ field: 'total', value: 1, confidence: 4 }] },
      model: 'llava-local:13b',
    }, { deviceContext: deviceA })).rejects.toMatchObject({ status: 400 })

    const after = await prisma.assetExtractionJob.findUnique({ where: { id: job.id } })
    expect(after.status).toBe('FAILED')
    expect(after.lastError).toMatch(/CANDIDATE_SCHEMA_REJECTED/)
    const evidence = await prisma.assetEvidence.findUnique({ where: { id: evidenceId } })
    expect(evidence.status).not.toBe('EXTRACTED')
    expect(evidence.extractionJson).toBe('{}')
  })

  it('AC-143.6 — an expired lease returns the job to the queue', async () => {
    const evidenceId = await seedEvidence(business, owner, 'lease')
    await enqueueAssetExtractionJob(evidenceId, { businessId: business.id, viewer: owner })
    const held = await claimAssetExtractionJob({ deviceContext: deviceA })
    expect(held.job.evidenceId).toBe(evidenceId)

    // Past every lease, expired jobs become claimable again — oldest first, so
    // this drains whatever an earlier case left holding before reaching ours.
    const later = new Date(Date.now() + EXTRACTION_LEASE_MS + 60_000)
    let reclaimed = null
    for (let i = 0; i < 10 && !reclaimed; i += 1) {
      const next = await claimAssetExtractionJob({ deviceContext: deviceA, now: () => later })
      expect(next.job).not.toBeNull()
      if (next.job.id === held.job.id) reclaimed = next.job
    }
    expect(reclaimed).toMatchObject({ id: held.job.id, status: 'CLAIMED', attempts: 2 })
    // The re-claim is a new lease, not a resurrection of the old one.
    expect(reclaimed.leaseExpiresAt.getTime()).toBeGreaterThan(held.job.leaseExpiresAt.getTime())
  })

  it('a reported failure requeues below the attempt ceiling and stays FAILED at it', async () => {
    const evidenceId = await seedEvidence(business, owner, 'retry')
    await enqueueAssetExtractionJob(evidenceId, { businessId: business.id, viewer: owner })

    let current = await claimAssetExtractionJob({ deviceContext: deviceA })
    const jobId = current.job.id
    const failed = await failAssetExtractionJob(jobId, { reason: 'model unavailable' }, { deviceContext: deviceA })
    expect(failed.job).toMatchObject({ status: 'QUEUED', lastError: 'model unavailable', claimedByDeviceId: null })

    for (let attempt = 2; attempt <= 3; attempt += 1) {
      current = await claimAssetExtractionJob({ deviceContext: deviceA })
      expect(current.job.id).toBe(jobId)
      await failAssetExtractionJob(jobId, { reason: `attempt ${attempt} failed` }, { deviceContext: deviceA })
    }
    const final = await prisma.assetExtractionJob.findUnique({ where: { id: jobId } })
    expect(final).toMatchObject({ status: 'FAILED', attempts: 3, lastError: 'attempt 3 failed' })
    // Nothing hands out a job that has run out of attempts.
    const nothingLeft = await claimAssetExtractionJob({ deviceContext: deviceA })
    expect(nothingLeft.job?.id).not.toBe(jobId)
  })

  it('refuses every job operation without a device context', async () => {
    const job = await prisma.assetExtractionJob.findFirst({ where: { businessId: business.id } })
    for (const call of [
      () => claimAssetExtractionJob({ deviceContext: null }),
      () => readAssetExtractionJobEvidence(job.id, { deviceContext: undefined, objectStoragePort }),
      () => completeAssetExtractionJob(job.id, { candidate, model: 'm' }, { deviceContext: { businessId: business.id } }),
      () => failAssetExtractionJob(job.id, { reason: 'x' }, { deviceContext: {} }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 401 })
    }
  })

  it('refuses to queue for a Business the viewer does not own', async () => {
    await expect(enqueueAssetExtractionJob(evidenceIds[1], { businessId: business.id, viewer: otherOwner }))
      .rejects.toMatchObject({ status: expect.any(Number) })
  })
})

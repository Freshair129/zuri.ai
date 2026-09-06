import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import {
  archiveMarketingContent,
  createMarketingContent,
  decideMarketingContent,
  getMarketingContent,
  getMarketingContentAsset,
  listMarketingContent,
  reviseMarketingContent,
  reviewMarketingContent,
} from '@/modules/marketing/application/marketing-content-service'
import { createMarketingContentRepository } from '@/modules/marketing/infrastructure/marketing-content-repository'
import { hashMarketingContentContent } from '@/modules/marketing/domain/marketing-content-contract'

// @req FR-157 — real SQLite Content persistence proves Business/Tenant scope,
// immutable revisions, owner reference invalidation, sequence ordering,
// independent review, exact decisions, archive and atomic audit/CAS behavior.
// @spec SDD-088, BR-001, SEC-001, SEC-003
// @tested tests/integration/marketing-content.test.js

const DOMAINS = ['projects', 'people', 'platform', 'growth']
const NOW = new Date('2026-09-06T12:00:00.000Z')

const basePayload = {
  objective: 'Publish an evidence-backed product story',
  audience: 'Thai SME owners',
  message: 'A clear operating system for the next growth step',
  claims: 'Claims must be supported by the evidence reference.',
  shotList: 'Opening product frame, customer proof, closing CTA',
  acceptanceCriteria: 'Readable caption and approved claim wording',
  evidenceReference: 'facts://business/product-brief/v1',
  format: 'IMAGE',
  initiativeId: null,
  channels: ['INSTAGRAM', 'SEO'],
  asset: null,
  rights: null,
  production: null,
}

function suffix() {
  return randomUUID().slice(0, 8).toUpperCase()
}

function deps(viewer, extra = {}) {
  return {
    db: prisma,
    viewer,
    createRepository: createMarketingContentRepository,
    now: () => NOW,
    ...extra,
  }
}

function withAsset(assetId) {
  return {
    ...basePayload,
    asset: { fileId: assetId },
    rights: {
      holder: 'Business A',
      license: 'Owned media',
      channels: ['INSTAGRAM', 'SEO'],
      validFrom: '2026-09-01T00:00:00.000Z',
      validUntil: '2026-10-01T00:00:00.000Z',
      proof: 'rights://business-a/creative-1',
    },
  }
}

async function createContentAsset({ code, name, sha256, status = 'ACTIVE', version = 1 }) {
  return prisma.fileAsset.create({
    data: {
      code,
      tenantId: businessA.tenantId,
      businessId: businessA.id,
      storageKind: 'MANAGED_BLOB',
      name,
      mime: 'image/png',
      size: 10,
      sha256,
      status,
      version,
    },
  })
}

function auditFailureDb() {
  const names = [
    'business',
    'fileAsset',
    'project',
    'marketingContentBrief',
    'marketingContentVersion',
    'marketingContentReview',
    'marketingContentDecision',
  ]
  const db = {
    $transaction: (callback) => prisma.$transaction((tx) => callback(new Proxy(tx, {
      get(target, property, receiver) {
        if (property === 'auditEvent') return { create: async () => { throw new Error('forced audit failure') } }
        return Reflect.get(target, property, receiver)
      },
    }))),
  }
  names.forEach((name) => { db[name] = prisma[name] })
  return db
}

let businessA
let businessB
let ownerA
let reviewerA
let memberA
let assetA

describe('Marketing Content persistence (FR-157)', () => {
  beforeAll(async () => {
    const id = suffix()
    const portfolio = await createPortfolio({ name: `Content ${id}`, code: `PF-CNT-${id}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `Content A ${id}`, code: `TNT-CNT-A-${id}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `Content B ${id}`, code: `TNT-CNT-B-${id}` })
    businessA = await createBusiness({ tenantId: tenantA.id, name: `Content A ${id}`, code: `BUS-CNT-A-${id}` })
    businessB = await createBusiness({ tenantId: tenantB.id, name: `Content B ${id}`, code: `BUS-CNT-B-${id}` })
    ownerA = makeViewer({ principal: { id: `content-owner-${id}` }, visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id], visibleDomains: DOMAINS })
    reviewerA = makeViewer({ principal: { id: `content-reviewer-${id}` }, visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id], visibleDomains: DOMAINS })
    memberA = makeViewer({ role: 'MEMBER', principal: { id: `content-member-${id}` }, visibleBusinessIds: [businessA.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    assetA = await prisma.fileAsset.create({
      data: {
        code: `FIL-CNT-${id}`,
        tenantId: tenantA.id,
        businessId: businessA.id,
        storageKind: 'MANAGED_BLOB',
        name: 'creative.png',
        mime: 'image/png',
        size: 10,
        sha256: 'a'.repeat(64),
        status: 'ACTIVE',
        version: 1,
      },
    })
  })

  it('creates a server-resolved immutable revision and exposes visible members read-only', async () => {
    const created = await createMarketingContent(
      { businessId: businessA.id, title: 'Creative brief', payload: withAsset(assetA.id) },
      deps(ownerA),
    )
    expect(created).toMatchObject({
      businessId: businessA.id,
      status: 'OPEN',
      currentRevision: 1,
      version: 1,
      currentVersion: {
        title: 'Creative brief',
        payload: { asset: { fileId: assetA.id, fileVersion: 1, sha256: 'a'.repeat(64) } },
        payloadHash: hashMarketingContentContent({
          title: 'Creative brief',
          payload: {
            ...withAsset(assetA.id),
            asset: { fileId: assetA.id, fileVersion: 1, sha256: 'a'.repeat(64) },
          },
        }),
      },
    })
    expect(created.phase).toBe('DRAFT')
    expect(created.approval.valid).toBe(false)

    const memberRead = await getMarketingContent(
      { viewer: memberA, businessId: businessA.id, briefId: created.id },
      { db: prisma, createRepository: createMarketingContentRepository, now: () => NOW },
    )
    expect(memberRead.canWrite).toBe(false)
    expect(memberRead.references.asset.file).toMatchObject({ id: assetA.id, version: 1, sha256: 'a'.repeat(64) })
    expect(memberRead.references.asset.file).not.toHaveProperty('storageKind')
  })

  it('refuses member writes and same-tenant/cross-tenant scope disclosure', async () => {
    const brief = await createMarketingContent(
      { businessId: businessA.id, title: 'Scoped brief', payload: basePayload },
      deps(ownerA),
    )
    await expect(createMarketingContent(
      { businessId: businessA.id, title: 'Member write', payload: basePayload },
      deps(memberA),
    )).rejects.toMatchObject({ status: 404 })
    const attacker = ownsElsewhere({ owns: businessA.id, sees: businessB.id, visibleDomains: DOMAINS })
    await expect(getMarketingContent(
      { viewer: attacker, businessId: businessB.id, briefId: brief.id },
      { db: prisma, createRepository: createMarketingContentRepository },
    )).rejects.toMatchObject({ status: 404 })
  })

  it('appends revisions with server file metadata and rejects stale CAS', async () => {
    const brief = await createMarketingContent(
      { businessId: businessA.id, title: 'Revision brief', payload: basePayload },
      deps(ownerA),
    )
    const before = await prisma.marketingContentVersion.findFirst({ where: { briefId: brief.id } })
    const revised = await reviseMarketingContent(
      brief.id,
      { businessId: businessA.id, expectedVersion: 1, title: 'Revision brief v2', payload: withAsset(assetA.id) },
      deps(ownerA),
    )
    expect(revised.currentRevision).toBe(2)
    expect(revised.version).toBe(2)
    expect(await prisma.marketingContentVersion.findUnique({ where: { id: before.id } })).toEqual(before)
    const auditBefore = await prisma.auditEvent.count({ where: { entityType: 'MARKETING_CONTENT_BRIEF', entityId: brief.id } })
    await expect(reviseMarketingContent(
      brief.id,
      { businessId: businessA.id, expectedVersion: 1, title: 'Stale', payload: basePayload },
      deps(ownerA),
    )).rejects.toMatchObject({ status: 409 })
    expect(await prisma.auditEvent.count({ where: { entityType: 'MARKETING_CONTENT_BRIEF', entityId: brief.id } })).toBe(auditBefore)
  })

  it('requires independent review and exact current PASS before approval, then invalidates on changed file', async () => {
    const brief = await createMarketingContent(
      { businessId: businessA.id, title: 'Approval brief', payload: withAsset(assetA.id) },
      deps(ownerA),
    )
    await expect(reviewMarketingContent(brief.id, {
      businessId: businessA.id,
      expectedVersion: 1,
      contentVersionId: brief.currentVersion.id,
      payloadHash: brief.currentVersion.payloadHash,
      verdict: 'PASS',
      rationale: 'Author cannot independently review',
      rightsConfirmed: true,
      brandConfirmed: true,
    }, deps(ownerA))).rejects.toMatchObject({ status: 409 })

    const reviewed = await reviewMarketingContent(brief.id, {
      businessId: businessA.id,
      expectedVersion: 1,
      contentVersionId: brief.currentVersion.id,
      payloadHash: brief.currentVersion.payloadHash,
      verdict: 'PASS',
      rationale: 'Independent review complete',
      rightsConfirmed: true,
      brandConfirmed: true,
    }, deps(reviewerA))
    expect(reviewed.reviews.at(-1)).toMatchObject({ sequence: 2, verdict: 'PASS' })
    const approved = await decideMarketingContent(brief.id, {
      businessId: businessA.id,
      expectedVersion: reviewed.version,
      contentVersionId: reviewed.currentVersion.id,
      payloadHash: reviewed.currentVersion.payloadHash,
      reviewId: reviewed.reviews.at(-1).id,
      verdict: 'APPROVE',
      rationale: 'Approved for internal library',
      expiresAt: '2026-09-30T00:00:00.000Z',
    }, deps(ownerA))
    expect(approved.approval).toMatchObject({ valid: true, decisionId: approved.decisions.at(-1).id })
    expect(approved.phase).toBe('APPROVED')

    const expired = await getMarketingContent(
      { viewer: ownerA, businessId: businessA.id, briefId: brief.id },
      { db: prisma, createRepository: createMarketingContentRepository, now: () => new Date('2026-10-02T00:00:00.000Z') },
    )
    expect(expired.approval).toMatchObject({ valid: false, reasonCode: 'DECISION_EXPIRED' })

    await prisma.fileAsset.update({ where: { id: assetA.id }, data: { version: 2, sha256: 'b'.repeat(64) } })
    const changed = await getMarketingContent(
      { viewer: ownerA, businessId: businessA.id, briefId: brief.id },
      { db: prisma, createRepository: createMarketingContentRepository, now: () => NOW },
    )
    expect(changed.approval).toMatchObject({ valid: false, reasonCode: 'ASSET_SNAPSHOT_MISMATCH' })
    expect(changed.phase).toBe('REVIEW')
  })

  it('binds asset-detail references to the requested revision and fails closed for a hidden or deleted old source', async () => {
    const id = suffix()
    const oldAsset = await createContentAsset({
      code: `FIL-CNT-OLD-${id}`,
      name: 'historic-creative.png',
      sha256: 'c'.repeat(64),
    })
    const newAsset = await createContentAsset({
      code: `FIL-CNT-NEW-${id}`,
      name: 'current-creative.png',
      sha256: 'd'.repeat(64),
    })
    const oldPayload = {
      ...withAsset(oldAsset.id),
      rights: {
        ...withAsset(oldAsset.id).rights,
        holder: 'Historic rights holder',
        proof: `rights://historic/${id}`,
      },
    }
    const newPayload = {
      ...withAsset(newAsset.id),
      rights: {
        ...withAsset(newAsset.id).rights,
        holder: 'Current rights holder',
        proof: `rights://current/${id}`,
      },
    }
    const created = await createMarketingContent(
      { businessId: businessA.id, title: 'Historic creative', payload: oldPayload },
      deps(ownerA),
    )
    const historicVersionId = created.currentVersion.id
    const revised = await reviseMarketingContent(
      created.id,
      { businessId: businessA.id, expectedVersion: 1, title: 'Current creative', payload: newPayload },
      deps(ownerA),
    )

    const currentProjection = await getMarketingContentAsset(
      { viewer: ownerA, businessId: businessA.id, assetId: historicVersionId },
      { db: prisma, createRepository: createMarketingContentRepository, now: () => NOW },
    )
    expect(currentProjection.brief.currentVersion.id).toBe(revised.currentVersion.id)
    expect(currentProjection.brief.references.asset.file).toMatchObject({ id: newAsset.id, sha256: 'd'.repeat(64) })
    expect(currentProjection.assetVersion).toMatchObject({
      id: historicVersionId,
      title: 'Historic creative',
      payload: { asset: { fileId: oldAsset.id }, rights: { holder: 'Historic rights holder', proof: `rights://historic/${id}` } },
    })
    expect(currentProjection.references.asset).toMatchObject({ status: 'READY', file: { id: oldAsset.id, sha256: 'c'.repeat(64) } })
    expect(currentProjection.references.asset.file.id).not.toBe(newAsset.id)
    expect(currentProjection).toMatchObject({ isCurrent: false, usable: false })

    await prisma.fileAsset.update({ where: { id: oldAsset.id }, data: { status: 'QUARANTINED' } })
    const hidden = await getMarketingContentAsset(
      { viewer: ownerA, businessId: businessA.id, assetId: historicVersionId },
      { db: prisma, createRepository: createMarketingContentRepository, now: () => NOW },
    )
    expect(hidden.references.asset).toEqual({ status: 'UNAVAILABLE', reasonCode: 'ASSET_NOT_USABLE', file: null })
    expect(hidden.brief.references.asset.file).toMatchObject({ id: newAsset.id })

    await prisma.fileAsset.update({ where: { id: oldAsset.id }, data: { status: 'ACTIVE', deletedAt: NOW } })
    const deleted = await getMarketingContentAsset(
      { viewer: ownerA, businessId: businessA.id, assetId: historicVersionId },
      { db: prisma, createRepository: createMarketingContentRepository, now: () => NOW },
    )
    expect(deleted.references.asset).toEqual({ status: 'UNAVAILABLE', reasonCode: 'ASSET_REFERENCE_UNAVAILABLE', file: null })
    expect(deleted.brief.references.asset.file).toMatchObject({ id: newAsset.id })
  })

  it('keeps approval and matching review ahead of ready production, then ignores a hash-mismatched review', async () => {
    const id = suffix()
    const source = await createContentAsset({
      code: `FIL-CNT-PHASE-${id}`,
      name: 'phase-creative.png',
      sha256: 'e'.repeat(64),
    })
    const readyReferences = async () => ({
      asset: { status: 'READY', reasonCode: null, file: { id: source.id, version: 1, sha256: 'e'.repeat(64) } },
      production: {
        status: 'READY',
        reasonCode: null,
        project: { id: `project-${id}`, code: `PROJECT-${id}`, name: 'Production project', status: 'ACTIVE' },
        workItem: { id: `work-item-${id}`, projectId: `project-${id}`, code: `WORK-${id}`, title: 'Produce creative', status: 'PLANNED' },
      },
    })
    const dependencies = (viewer) => deps(viewer, { readMarketingContentReferences: readyReferences })
    const phasePayload = {
      ...withAsset(source.id),
      production: { projectId: `project-${id}`, workItemId: `work-item-${id}` },
    }
    const created = await createMarketingContent(
      { businessId: businessA.id, title: 'Phase ordering brief', payload: phasePayload },
      dependencies(ownerA),
    )
    const reviewed = await reviewMarketingContent(created.id, {
      businessId: businessA.id,
      expectedVersion: 1,
      contentVersionId: created.currentVersion.id,
      payloadHash: created.currentVersion.payloadHash,
      verdict: 'PASS',
      rationale: 'Independent phase review',
      rightsConfirmed: true,
      brandConfirmed: true,
    }, dependencies(reviewerA))
    const approved = await decideMarketingContent(created.id, {
      businessId: businessA.id,
      expectedVersion: reviewed.version,
      contentVersionId: reviewed.currentVersion.id,
      payloadHash: reviewed.currentVersion.payloadHash,
      reviewId: reviewed.reviews.at(-1).id,
      verdict: 'APPROVE',
      rationale: 'Approved while production is ready',
      expiresAt: '2026-09-30T00:00:00.000Z',
    }, dependencies(ownerA))
    expect(approved.phase).toBe('APPROVED')

    const changesRequired = await reviewMarketingContent(created.id, {
      businessId: businessA.id,
      expectedVersion: approved.version,
      contentVersionId: approved.currentVersion.id,
      payloadHash: approved.currentVersion.payloadHash,
      verdict: 'CHANGES_REQUIRED',
      rationale: 'Needs a rights note',
      rightsConfirmed: false,
      brandConfirmed: false,
    }, dependencies(reviewerA))
    expect(changesRequired.phase).toBe('REVIEW')

    await prisma.marketingContentReview.update({
      where: { id: changesRequired.reviews.at(-1).id },
      data: { payloadHash: 'f'.repeat(64) },
    })
    const mismatchedReview = await getMarketingContent(
      { viewer: ownerA, businessId: businessA.id, briefId: created.id },
      { db: prisma, createRepository: createMarketingContentRepository, now: () => NOW, readMarketingContentReferences: readyReferences },
    )
    expect(mismatchedReview.phase).toBe('PRODUCTION')
  })

  it('uses sequence rather than timestamps for PASS then CHANGES_REQUIRED and approval then REVOKE', async () => {
    await prisma.fileAsset.update({ where: { id: assetA.id }, data: { version: 3, sha256: 'a'.repeat(64), status: 'ACTIVE' } })
    const brief = await createMarketingContent(
      { businessId: businessA.id, title: 'Sequence brief', payload: withAsset(assetA.id) },
      deps(ownerA),
    )
    const reviewed = await reviewMarketingContent(brief.id, {
      businessId: businessA.id, expectedVersion: 1, contentVersionId: brief.currentVersion.id,
      payloadHash: brief.currentVersion.payloadHash, verdict: 'PASS', rationale: 'Pass', rightsConfirmed: true, brandConfirmed: true,
    }, deps(reviewerA))
    const approved = await decideMarketingContent(brief.id, {
      businessId: businessA.id, expectedVersion: reviewed.version, contentVersionId: reviewed.currentVersion.id,
      payloadHash: reviewed.currentVersion.payloadHash, reviewId: reviewed.reviews.at(-1).id, verdict: 'APPROVE',
      rationale: 'Approve', expiresAt: '2026-09-30T00:00:00.000Z',
    }, deps(ownerA))
    const changed = await reviewMarketingContent(brief.id, {
      businessId: businessA.id, expectedVersion: approved.version, contentVersionId: approved.currentVersion.id,
      payloadHash: approved.currentVersion.payloadHash, verdict: 'CHANGES_REQUIRED', rationale: 'Change needed', rightsConfirmed: false, brandConfirmed: false,
    }, deps(reviewerA))
    expect(changed.reviews.at(-1)).toMatchObject({ sequence: 4, verdict: 'CHANGES_REQUIRED' })
    await expect(decideMarketingContent(brief.id, {
      businessId: businessA.id, expectedVersion: changed.version, contentVersionId: changed.currentVersion.id,
      payloadHash: changed.currentVersion.payloadHash, reviewId: approved.reviews.at(-1).id, verdict: 'APPROVE',
      rationale: 'Old PASS must not be cherry-picked', expiresAt: '2026-09-30T00:00:00.000Z',
    }, deps(ownerA))).rejects.toMatchObject({ status: 409 })
    const repassed = await reviewMarketingContent(brief.id, {
      businessId: businessA.id, expectedVersion: changed.version, contentVersionId: changed.currentVersion.id,
      payloadHash: changed.currentVersion.payloadHash, verdict: 'PASS', rationale: 'Independent correction complete', rightsConfirmed: true, brandConfirmed: true,
    }, deps(reviewerA))
    const reapproved = await decideMarketingContent(brief.id, {
      businessId: businessA.id, expectedVersion: repassed.version, contentVersionId: repassed.currentVersion.id,
      payloadHash: repassed.currentVersion.payloadHash, reviewId: repassed.reviews.at(-1).id, verdict: 'APPROVE',
      rationale: 'Approve corrected version', expiresAt: '2026-09-30T00:00:00.000Z',
    }, deps(ownerA))
    expect(reapproved.approval.valid).toBe(true)
    const revoked = await decideMarketingContent(brief.id, {
      businessId: businessA.id, expectedVersion: reapproved.version, contentVersionId: reapproved.currentVersion.id,
      payloadHash: reapproved.currentVersion.payloadHash, verdict: 'REVOKE', rationale: 'Revoke current approval',
    }, deps(ownerA))
    expect(revoked.decisions.at(-1)).toMatchObject({ sequence: 7, verdict: 'REVOKE' })
    expect(revoked.approval.valid).toBe(false)
  })

  it('rolls back version, child and audit rows when audit persistence fails', async () => {
    const brief = await createMarketingContent(
      { businessId: businessA.id, title: 'Rollback brief', payload: basePayload },
      deps(ownerA),
    )
    const failing = { ...deps(ownerA), db: auditFailureDb() }
    await expect(reviseMarketingContent(
      brief.id,
      { businessId: businessA.id, expectedVersion: 1, title: 'Rollback v2', payload: basePayload },
      failing,
    )).rejects.toThrow('forced audit failure')
    expect(await prisma.marketingContentBrief.findUnique({ where: { id: brief.id } })).toMatchObject({ version: 1, currentRevision: 1, title: 'Rollback brief' })
    expect(await prisma.marketingContentVersion.count({ where: { briefId: brief.id } })).toBe(1)
    expect(await prisma.marketingContentReview.count({ where: { briefId: brief.id } })).toBe(0)
    expect(await prisma.marketingContentDecision.count({ where: { briefId: brief.id } })).toBe(0)
  })

  it('archives without deleting history and refuses further mutations', async () => {
    const brief = await createMarketingContent(
      { businessId: businessA.id, title: 'Archive brief', payload: basePayload },
      deps(ownerA),
    )
    const archived = await archiveMarketingContent(brief.id, {
      businessId: businessA.id, expectedVersion: 1, action: 'archive',
    }, deps(ownerA))
    expect(archived).toMatchObject({ status: 'ARCHIVED', phase: 'ARCHIVED', canWrite: false })
    await expect(reviseMarketingContent(
      brief.id,
      { businessId: businessA.id, expectedVersion: archived.version, title: 'Nope', payload: basePayload },
      deps(ownerA),
    )).rejects.toMatchObject({ status: 409 })
    const asset = await getMarketingContentAsset(
      { viewer: ownerA, businessId: businessA.id, assetId: archived.currentVersion.id },
      { db: prisma, createRepository: createMarketingContentRepository, now: () => NOW },
    )
    expect(asset).toMatchObject({ isCurrent: true, usable: false, brief: { phase: 'ARCHIVED' } })
  })

  it('bounds the collection and excludes archived rows from usable approval', async () => {
    const archived = await prisma.marketingContentBrief.count({ where: { businessId: businessA.id, status: 'ARCHIVED' } })
    const listing = await listMarketingContent(
      { viewer: memberA, businessId: businessA.id },
      { db: prisma, createRepository: createMarketingContentRepository, now: () => NOW },
    )
    expect(listing.briefs.length).toBeGreaterThan(0)
    expect(listing.briefs.filter((row) => row.status === 'ARCHIVED')).toHaveLength(archived)
    expect(listing.briefs.every((row) => row.currentVersion && row.approval)).toBe(true)
  })
})

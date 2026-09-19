// @req FR-252, FR-022 — one caller-owned transaction covers Identity and reviewed PM erasure.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/phase-b-identity-erasure.test.js
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { eraseCustomerPrincipal } from '@/modules/identity/erase-customer-principal'
import { digestReviewedProjectFeatureManifest } from '@/modules/project-manager/application/project-feature-erasure'
import { createProject } from '@/modules/project-manager/application/project-service'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'

const features = []

async function fixture() {
  const code = randomUUID().slice(0, 8).toUpperCase()
  const portfolio = await createPortfolio({ name: 'PM erasure test', code: `PF-PME-${code}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: 'PM erasure tenant', code: `TN-PME-${code}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'PM erasure business', code: `BU-PME-${code}` })
  const workspace = await createWorkspace({ businessId: business.id, scopeType: 'BUSINESS', name: 'PM erasure space', code: `WS-PME-${code}` })
  const owner = await prisma.person.create({ data: { code: `OWNER-PME-${code}`, displayName: 'Reviewer' } })
  const subject = await prisma.person.create({ data: { code: `SUBJECT-PME-${code}`, displayName: 'Private subject' } })
  const viewer = makeViewer({
    principal: { id: owner.id, code: owner.code, displayName: owner.displayName },
    visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: [...VIEWER_DOMAINS],
  })
  const project = await createProject({ workspaceId: workspace.id, businessId: business.id, name: 'PM erasure project', code: `PR-PME-${code}` }, { viewer })
  const customer = await prisma.customer.create({ data: {
    tenantId: tenant.id, businessId: business.id, personId: subject.id,
    code: `CU-PME-${code}`, displayName: 'Private customer',
  } })
  const feature = await prisma.projectFeature.create({ data: {
    tenantId: tenant.id, businessId: business.id, projectId: project.id, code: `FE-${code}`,
    title: 'Shared feature title', problem: 'Keep this shared problem', outcome: 'Keep this shared outcome',
    primaryDomainId: 'DOM-PROJECT-MANAGER', lifecycle: 'DRAFT',
  } })
  features.push(feature.id)
  return { tenant, business, subject, owner, viewer, project, customer, feature }
}

afterEach(async () => {
  if (features.length) await prisma.projectFeature.deleteMany({ where: { id: { in: features.splice(0) } } })
})

function reviewed(f, fields = ['title'], version = 1) {
  const manifest = {
    version: 'pm-erasure.v1', tenantId: f.tenant.id, businessId: f.business.id,
    subjectPersonId: f.subject.id, reviewerPersonId: f.owner.id,
    requestId: randomUUID(), reasonRef: 'CASE-PM-ERASURE-TEST',
    targets: fields.map(field => ({ projectId: f.project.id, recordType: 'ProjectFeature', recordId: f.feature.id, field, expectedVersion: version })),
  }
  manifest.manifestSha256 = digestReviewedProjectFeatureManifest(manifest)
  return { manifest, authority: {
    viewer: f.viewer, tenantId: f.tenant.id, businessId: f.business.id,
    subjectPersonId: f.subject.id, wholeFieldsApproved: true,
    reviewedManifestSha256: manifest.manifestSha256,
  } }
}

const erase = (f, reviewedPmContext, db = prisma) => eraseCustomerPrincipal(
  f.customer.id, { businessId: f.business.id, confirmation: 'ERASE' }, { viewer: f.viewer, db, reviewedPmContext },
)

describe('Identity / PM erasure transaction composition', () => {
  it('clears only reviewed fields, increments the row once, and audits identities without old text', async () => {
    const f = await fixture()
    const context = reviewed(f, ['title', 'outcome'])
    const result = await erase(f, context)
    expect(result.counts.pmErasure).toMatchObject({ status: 'APPLIED', changedRowCount: 1, changedFieldCount: 2, manifestSha256: context.manifest.manifestSha256 })
    expect(await prisma.projectFeature.findUnique({ where: { id: f.feature.id } })).toMatchObject({
      title: '[erased]', outcome: '[erased]', problem: f.feature.problem, version: 2, lifecycle: f.feature.lifecycle, deletedAt: null,
    })
    const events = await prisma.auditEvent.findMany({ where: { entityType: 'PRINCIPAL', entityId: f.subject.id, action: 'ERASED' } })
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0].payloadJson).pmErasure).toMatchObject({ reviewerPersonId: f.owner.id, requestId: context.manifest.requestId, changedRowCount: 1 })
    for (const text of [f.feature.title, f.feature.problem, f.feature.outcome, 'Private subject', 'Private customer']) expect(events[0].payloadJson).not.toContain(text)
  })

  it('refuses stale reviewed targets before Identity effects or a success audit', async () => {
    const f = await fixture()
    await expect(erase(f, reviewed(f, ['title'], 99))).rejects.toThrow('PM_ERASURE_VERSION_CONFLICT')
    expect(await prisma.customer.findUnique({ where: { id: f.customer.id } })).toMatchObject({ deletedAt: null, displayName: 'Private customer' })
    expect(await prisma.person.findUnique({ where: { id: f.subject.id } })).toMatchObject({ displayName: 'Private subject', accessDisabledAt: null })
    expect(await prisma.projectFeature.findUnique({ where: { id: f.feature.id } })).toMatchObject({ title: f.feature.title, version: 1 })
    expect(await prisma.auditEvent.count({ where: { entityType: 'PRINCIPAL', entityId: f.subject.id } })).toBe(0)
  })

  it('rolls back an applied PM change with later Identity changes in the caller transaction', async () => {
    const f = await fixture()
    await expect(prisma.$transaction(async tx => {
      expect((await erase(f, reviewed(f), tx)).counts.pmErasure.status).toBe('APPLIED')
      throw new Error('AFTER_IDENTITY_AUDIT_FAILURE')
    }, { timeout: 30_000 })).rejects.toThrow('AFTER_IDENTITY_AUDIT_FAILURE')
    expect(await prisma.projectFeature.findUnique({ where: { id: f.feature.id } })).toMatchObject({ title: f.feature.title, version: 1 })
    expect(await prisma.customer.findUnique({ where: { id: f.customer.id } })).toMatchObject({ deletedAt: null })
    expect(await prisma.auditEvent.count({ where: { entityType: 'PRINCIPAL', entityId: f.subject.id } })).toBe(0)
  })

  it('keeps pending text and distinguishes exact PM replay from a changed request', async () => {
    const f = await fixture()
    const context = reviewed(f)
    expect((await erase(f, { ...context, authority: { ...context.authority, wholeFieldsApproved: false } })).counts.pmErasure.status).toBe('PENDING')
    expect(await prisma.projectFeature.findUnique({ where: { id: f.feature.id } })).toMatchObject({ title: f.feature.title, version: 1 })
    expect((await erase(f, context)).counts.pmErasure.status).toBe('APPLIED')
    expect((await erase(f, context)).counts.pmErasure.status).toBe('REPLAYED')
    expect(await prisma.projectFeature.findUnique({ where: { id: f.feature.id } })).toMatchObject({ title: '[erased]', version: 2 })
    const changed = structuredClone(context)
    changed.manifest.targets[0].field = 'problem'
    changed.manifest.manifestSha256 = digestReviewedProjectFeatureManifest(changed.manifest)
    changed.authority.reviewedManifestSha256 = changed.manifest.manifestSha256
    await expect(erase(f, changed)).rejects.toThrow('PM_ERASURE_REPLAY_CONFLICT')
    expect(await prisma.projectFeature.findUnique({ where: { id: f.feature.id } })).toMatchObject({ problem: f.feature.problem, version: 2 })
  })

  it('reuses an injected transaction and rolls back customer, person and success audit together', async () => {
    const f = await fixture()
    const beforeAudit = await prisma.auditEvent.count({ where: { entityType: 'PRINCIPAL', entityId: f.subject.id } })
    await expect(prisma.$transaction(async (tx) => {
      const result = await eraseCustomerPrincipal(f.customer.id, { businessId: f.business.id, confirmation: 'ERASE' }, { viewer: f.viewer, db: tx })
      expect(result.counts.pmErasure).toMatchObject({ status: 'UNMAPPED', changedRowCount: 0, changedFieldCount: 0 })
      expect((await tx.customer.findUnique({ where: { id: f.customer.id } })).displayName).toBe('[erased]')
      throw new Error('ROLLBACK_COMPOSED_ERASURE')
    }, { timeout: 30_000 })).rejects.toThrow('ROLLBACK_COMPOSED_ERASURE')
    expect(await prisma.customer.findUnique({ where: { id: f.customer.id } })).toMatchObject({ displayName: 'Private customer', deletedAt: null })
    expect(await prisma.person.findUnique({ where: { id: f.subject.id } })).toMatchObject({ displayName: 'Private subject', accessDisabledAt: null })
    expect(await prisma.projectFeature.findUnique({ where: { id: f.feature.id } })).toMatchObject({ title: f.feature.title, version: 1 })
    expect(await prisma.auditEvent.count({ where: { entityType: 'PRINCIPAL', entityId: f.subject.id } })).toBe(beforeAudit)
  })

  it('uses the supplied root client exactly once and keeps unmapped shared PM text', async () => {
    const f = await fixture()
    const transaction = vi.fn((work, options) => prisma.$transaction(work, options))
    const result = await eraseCustomerPrincipal(f.customer.id, { businessId: f.business.id, confirmation: 'ERASE' }, {
      viewer: f.viewer, db: { $transaction: transaction },
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(result.counts).toMatchObject({ erasedCustomers: 1, personRedacted: true, pmErasure: { status: 'UNMAPPED', changedRowCount: 0 } })
    expect(await prisma.projectFeature.findUnique({ where: { id: f.feature.id } })).toMatchObject({ title: 'Shared feature title', problem: 'Keep this shared problem', version: 1 })
    const events = await prisma.auditEvent.findMany({ where: { entityType: 'PRINCIPAL', entityId: f.subject.id, action: 'ERASED' } })
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0].payloadJson).pmErasure).toMatchObject({ status: 'UNMAPPED' })
    expect(events[0].payloadJson).not.toContain('Private subject')
    expect(events[0].payloadJson).not.toContain(f.feature.title)
  })

  it('rejects a reviewed manifest supplied in the public body before a transaction starts', async () => {
    const transaction = vi.fn()
    await expect(eraseCustomerPrincipal(randomUUID(), {
      businessId: randomUUID(), confirmation: 'ERASE', reviewedPmContext: { status: 'REVIEWED' },
    }, { viewer: makeViewer(), db: { $transaction: transaction } })).rejects.toThrow()
    expect(transaction).not.toHaveBeenCalled()
  })
})

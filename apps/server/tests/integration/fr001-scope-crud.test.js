import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import * as scopeService from '@/modules/project-manager/application/scope-service'
import * as scopeRoute from '@/app/api/scope/route'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import * as scopeFactory from '../factories/scope'

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: vi.fn(),
}))

// @req FR-001 — the declared scope hierarchy is creatable, editable and archivable.
// @req FR-074 — writes remain authorized at their existing Tenant or Business scope.
// @req FR-075 — Portfolio, Tenant and LegalEntity writes require operator authority.
// @spec BR-001, SEC-001, SEC-008
// @tested tests/integration/fr001-scope-crud.test.js

const operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })

async function capture(fn) {
  return Promise.resolve().then(fn)
}

function jsonRequest(method, body) {
  return new Request('http://localhost/api/scope', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

let portfolio
let tenant
let foreignTenant
let legalEntity
let foreignLegalEntity
let business
let foreignBusiness
let branch
let tenantOwner
let businessOwner
let unrelatedViewer

describe('FR-001 scope CRUD', () => {
  beforeAll(async () => {
    portfolio = await scopeFactory.createPortfolio({ name: 'F01 Portfolio', code: 'PF-F01-CRUD' })
    tenant = await scopeFactory.createTenant({ portfolioId: portfolio.id, name: 'F01 Tenant', code: 'TNT-F01-CRUD' })
    foreignTenant = await scopeFactory.createTenant({ portfolioId: portfolio.id, name: 'F01 Foreign Tenant', code: 'TNT-F01-OTHER' })
    legalEntity = await scopeFactory.createLegalEntity({ tenantId: tenant.id, legalName: 'F01 Legal Entity', code: 'LE-F01-CRUD' })
    foreignLegalEntity = await scopeFactory.createLegalEntity({ tenantId: foreignTenant.id, legalName: 'F01 Foreign Entity', code: 'LE-F01-OTHER' })
    business = await scopeFactory.createBusiness({ tenantId: tenant.id, name: 'F01 Business', code: 'BUS-F01-CRUD' })
    foreignBusiness = await scopeFactory.createBusiness({ tenantId: foreignTenant.id, name: 'F01 Foreign Business', code: 'BUS-F01-OTHER' })
    branch = await scopeFactory.createBranch({
      tenantId: tenant.id,
      businessId: business.id,
      name: 'F01 Branch',
      code: 'BR-F01-CRUD',
    })

    tenantOwner = makeViewer({
      role: 'OWNER',
      visibleBusinessIds: [],
      ownedBusinessIds: [],
      ownedTenantIds: [tenant.id],
    })
    businessOwner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    unrelatedViewer = makeViewer({ role: 'MEMBER', visibleBusinessIds: [business.id], ownedBusinessIds: [] })
  })

  it('updates each scope while preserving its parent and recording versioned audit evidence', async () => {
    const updates = [
      ['Portfolio', () => scopeService.updatePortfolio(portfolio.id, { name: 'F01 Portfolio Updated' }, { viewer: operator }), { name: 'F01 Portfolio Updated', status: 'ACTIVE', version: 2 }, operator.principal.id],
      ['Tenant', () => scopeService.updateTenant(tenant.id, { name: 'F01 Tenant Updated' }, { viewer: operator }), { name: 'F01 Tenant Updated', portfolioId: portfolio.id, version: 2 }, operator.principal.id],
      ['LegalEntity', () => scopeService.updateLegalEntity(legalEntity.id, { legalName: 'F01 Entity Updated' }, { viewer: operator }), { legalName: 'F01 Entity Updated', tenantId: tenant.id, version: 2 }, operator.principal.id],
      ['Business', () => scopeService.updateBusiness(business.id, { name: 'F01 Business Updated', legalEntityId: legalEntity.id }, { viewer: tenantOwner }), { name: 'F01 Business Updated', tenantId: tenant.id, legalEntityId: legalEntity.id, version: 2 }, tenantOwner.principal.id],
      ['Branch', () => scopeService.updateBranch(branch.id, { name: 'F01 Branch Updated', address: 'Sukhumvit', kind: 'SITE' }, { viewer: businessOwner }), { name: 'F01 Branch Updated', address: 'Sukhumvit', tenantId: tenant.id, businessId: business.id, version: 2 }, businessOwner.principal.id],
    ]

    for (const [entityType, update, expected, actorId] of updates) {
      const updated = await update()
      expect(updated).toMatchObject(expected)
      const audit = await prisma.auditEvent.findFirst({
        where: { entityType: entityType.toUpperCase() === 'LEGALENTITY' ? 'LEGAL_ENTITY' : entityType.toUpperCase(), entityId: updated.id, action: 'UPDATED' },
      })
      expect(audit).toMatchObject({ actorId })
      expect(JSON.parse(audit.afterJson)).toMatchObject(expected)
    }
  })

  it('refuses hierarchy moves and cross-Tenant LegalEntity references without changing the row', async () => {
    await expect(capture(() => scopeService.updateTenant(tenant.id, { portfolioId: foreignTenant.id }, { viewer: operator }))).rejects.toThrow()
    await expect(capture(() => scopeService.updateBusiness(business.id, { tenantId: foreignTenant.id }, { viewer: tenantOwner }))).rejects.toThrow()
    await expect(capture(() => scopeService.updateBusiness(business.id, { legalEntityId: foreignLegalEntity.id }, { viewer: tenantOwner })))
      .rejects.toMatchObject({ status: 422, message: 'LEGAL_ENTITY_TENANT_MISMATCH' })
    await expect(capture(() => scopeService.updateBranch(branch.id, { businessId: foreignBusiness.id }, { viewer: businessOwner }))).rejects.toThrow()
    await expect(capture(() => scopeService.updateLegalEntity(legalEntity.id, { tenantId: foreignTenant.id }, { viewer: operator }))).rejects.toThrow()

    expect(await prisma.business.findUnique({ where: { id: business.id } })).toMatchObject({ tenantId: tenant.id, legalEntityId: legalEntity.id })
    expect(await prisma.branch.findUnique({ where: { id: branch.id } })).toMatchObject({ tenantId: tenant.id, businessId: business.id })
  })

  it('uses the existing authority boundary for updates and archives', async () => {
    const beforePortfolio = await prisma.portfolio.findUnique({ where: { id: portfolio.id } })
    const beforeBusiness = await prisma.business.findUnique({ where: { id: business.id } })
    const beforeBranch = await prisma.branch.findUnique({ where: { id: branch.id } })

    await expect(capture(() => scopeService.updatePortfolio(portfolio.id, { name: 'forbidden' }, { viewer: tenantOwner })))
      .rejects.toMatchObject({ status: 403 })
    await expect(capture(() => scopeService.updatePortfolio('missing-portfolio-id', { name: 'forbidden' }, { viewer: tenantOwner })))
      .rejects.toMatchObject({ status: 403 })
    await expect(capture(() => scopeService.archiveTenant(tenant.id, { viewer: tenantOwner })))
      .rejects.toMatchObject({ status: 403 })
    await expect(capture(() => scopeService.archiveBusiness(business.id, { viewer: businessOwner })))
      .rejects.toMatchObject({ status: 404 })
    await expect(capture(() => scopeService.archiveBranch(branch.id, { viewer: unrelatedViewer })))
      .rejects.toMatchObject({ status: 404 })

    expect(await prisma.portfolio.findUnique({ where: { id: portfolio.id } })).toMatchObject({ name: beforePortfolio.name, version: beforePortfolio.version })
    expect(await prisma.business.findUnique({ where: { id: business.id } })).toMatchObject({ status: beforeBusiness.status, version: beforeBusiness.version })
    expect(await prisma.branch.findUnique({ where: { id: branch.id } })).toMatchObject({ status: beforeBranch.status, version: beforeBranch.version })
  })

  it('rejects stale update and archive versions without writing or auditing', async () => {
    const stalePortfolio = await scopeFactory.createPortfolio({ name: 'F01 Stale Portfolio', code: 'PF-F01-STALE' })
    const stalePortfolioVersion = stalePortfolio.version
    await prisma.portfolio.update({ where: { id: stalePortfolio.id }, data: { version: { increment: 1 } } })
    const portfolioAuditCount = await prisma.auditEvent.count({ where: { entityType: 'PORTFOLIO', entityId: stalePortfolio.id } })

    await expect(capture(() => scopeService.updatePortfolio(
      stalePortfolio.id,
      { name: 'Must Not Apply' },
      { viewer: operator, expectedVersion: stalePortfolioVersion },
    ))).rejects.toMatchObject({ status: 409, message: 'PORTFOLIO_VERSION_CONFLICT' })
    await expect(capture(() => scopeService.updatePortfolio(
      stalePortfolio.id,
      { name: 'Invalid Version' },
      { viewer: operator, expectedVersion: 0 },
    ))).rejects.toMatchObject({ status: 400 })

    const staleTenant = await scopeFactory.createTenant({ portfolioId: portfolio.id, name: 'F01 Stale Tenant', code: 'TNT-F01-STALE' })
    const staleTenantVersion = staleTenant.version
    await prisma.tenant.update({ where: { id: staleTenant.id }, data: { version: { increment: 1 } } })
    const tenantAuditCount = await prisma.auditEvent.count({ where: { entityType: 'TENANT', entityId: staleTenant.id } })

    await expect(capture(() => scopeService.archiveTenant(
      staleTenant.id,
      { viewer: operator, expectedVersion: staleTenantVersion },
    ))).rejects.toMatchObject({ status: 409, message: 'TENANT_VERSION_CONFLICT' })

    expect(await prisma.portfolio.findUnique({ where: { id: stalePortfolio.id } })).toMatchObject({ name: stalePortfolio.name, version: stalePortfolioVersion + 1 })
    expect(await prisma.tenant.findUnique({ where: { id: staleTenant.id } })).toMatchObject({ status: 'ACTIVE', version: staleTenantVersion + 1 })
    expect(await prisma.auditEvent.count({ where: { entityType: 'PORTFOLIO', entityId: stalePortfolio.id } })).toBe(portfolioAuditCount)
    expect(await prisma.auditEvent.count({ where: { entityType: 'TENANT', entityId: staleTenant.id } })).toBe(tenantAuditCount)
  })

  it('conditions the write on the fetched version and emits no audit when a concurrent writer wins', async () => {
    const target = await scopeFactory.createPortfolio({ name: 'F01 CAS Portfolio', code: 'PF-F01-CAS' })
    const updateMany = vi.fn(async ({ where }) => {
      expect(where).toEqual({ id: target.id, version: target.version })
      await prisma.portfolio.update({ where: { id: target.id }, data: { version: { increment: 1 } } })
      return { count: 0 }
    })
    const auditCreate = vi.fn()
    const tx = {
      portfolio: {
        findUnique: vi.fn().mockResolvedValue(target),
        updateMany,
      },
      auditEvent: { create: auditCreate },
    }
    const transaction = vi.spyOn(prisma, '$transaction').mockImplementation(async (work) => work(tx))

    try {
      await expect(capture(() => scopeService.updatePortfolio(
        target.id,
        { name: 'Lost Concurrent Update' },
        { viewer: operator },
      ))).rejects.toMatchObject({ status: 409, message: 'PORTFOLIO_VERSION_CONFLICT' })
      expect(updateMany).toHaveBeenCalledTimes(1)
      expect(auditCreate).not.toHaveBeenCalled()
    } finally {
      transaction.mockRestore()
    }
    expect(await prisma.portfolio.findUnique({ where: { id: target.id } })).toMatchObject({ name: target.name, version: target.version + 1 })
  })

  it('archives scope rows by status without deleting rows or cascading to children', async () => {
    const archived = []
    archived.push(await scopeService.archivePortfolio(portfolio.id, { viewer: operator }))
    archived.push(await scopeService.archiveTenant(tenant.id, { viewer: operator }))
    expect(await prisma.business.findUnique({ where: { id: business.id } })).toMatchObject({ status: 'ACTIVE' })
    archived.push(await scopeService.archiveLegalEntity(legalEntity.id, { viewer: operator }))
    archived.push(await scopeService.archiveBusiness(business.id, { viewer: tenantOwner }))
    archived.push(await scopeService.archiveBranch(branch.id, { viewer: businessOwner }))

    for (const row of archived) expect(row).toMatchObject({ status: 'ARCHIVED', version: 3 })
    expect(await prisma.portfolio.findUnique({ where: { id: portfolio.id } })).not.toBeNull()
    expect(await prisma.tenant.findUnique({ where: { id: tenant.id } })).not.toBeNull()
    expect(await prisma.legalEntity.findUnique({ where: { id: legalEntity.id } })).not.toBeNull()
    expect(await prisma.business.findUnique({ where: { id: business.id } })).not.toBeNull()
    expect(await prisma.branch.findUnique({ where: { id: branch.id } })).not.toBeNull()
    expect(await prisma.workspace.findFirst({ where: { businessId: business.id, status: 'ACTIVE' } })).not.toBeNull()

    const archiveAudits = await prisma.auditEvent.count({
      where: { entityId: { in: archived.map((row) => row.id) }, action: 'ARCHIVED' },
    })
    expect(archiveAudits).toBe(5)
  })

  it('exposes authenticated PATCH and DELETE scope operations through the existing scope route', async () => {
    const routePortfolio = await scopeFactory.createPortfolio({ name: 'F01 Route Portfolio', code: 'PF-F01-ROUTE' })
    resolveRequestViewer.mockResolvedValue(operator)

    const updatedResponse = await scopeRoute.PATCH(jsonRequest('PATCH', {
      entity: 'portfolio',
      id: routePortfolio.id,
      expectedVersion: routePortfolio.version,
      data: { name: 'F01 Route Portfolio Updated' },
    }))
    expect(updatedResponse.status).toBe(200)
    await expect(updatedResponse.json()).resolves.toMatchObject({ name: 'F01 Route Portfolio Updated', version: 2 })

    const archivedResponse = await scopeRoute.DELETE(jsonRequest('DELETE', { entity: 'portfolio', id: routePortfolio.id, expectedVersion: 2 }))
    expect(archivedResponse.status).toBe(200)
    await expect(archivedResponse.json()).resolves.toMatchObject({ status: 'ARCHIVED', version: 3 })
  })
})

import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import {
  zPortfolioInput,
  zTenantInput,
  zLegalEntityInput,
  zBusinessInput,
  zBusinessInGroupInput,
  zBranchInput,
  zWorkspaceInput,
} from '@/lib/validation/entities'
import { recordAudit } from './audit'
import { activeWorkstream } from './active-filters'

// @req FR-001 — scope hierarchy CRUD (portfolio/tenant/business/branch/workspace)
// @spec BR-001, SEC-001 — tenant = isolation; cross-scope access denied
// @tested tests/integration/scope-and-isolation.test.js
// Scope model: Portfolio → Tenant → Business → Workspace.
// tenant_id = isolation boundary; business_id = operating business; branch_id = location.
// A branch is NEVER modeled as a tenant.

const codeExists = (model) => async (code) =>
  Boolean(await prisma[model].findUnique({ where: { code } }))

export async function listScope() {
  const [portfolios, tenants, businesses, workspaces, projects] = await Promise.all([
    prisma.portfolio.findMany({ orderBy: { code: 'asc' } }),
    prisma.tenant.findMany({ orderBy: { code: 'asc' } }),
    prisma.business.findMany({ orderBy: { code: 'asc' } }),
    prisma.workspace.findMany({ orderBy: { code: 'asc' }, where: { status: { not: 'ARCHIVED' } } }),
    prisma.project.findMany({
      orderBy: { code: 'asc' },
      where: activeWorkstream(),
      select: { id: true, code: true, name: true, businessId: true, workspaceId: true, status: true },
    }),
  ])
  return { portfolios, tenants, businesses, workspaces, projects }
}

export async function createPortfolio(input) {
  const data = zPortfolioInput.parse(input)
  const code = data.code || (await uniqueHumanCode('PF', data.name, codeExists('portfolio')))
  const portfolio = await prisma.portfolio.create({ data: { code, name: data.name } })
  await recordAudit(prisma, { entityType: 'PORTFOLIO', entityId: portfolio.id, action: 'CREATED', payload: { code } })
  return portfolio
}

export async function createTenant(input) {
  const data = zTenantInput.parse(input)
  const code = data.code || (await uniqueHumanCode('TNT', data.name, codeExists('tenant')))
  const tenant = await prisma.tenant.create({
    data: { code, name: data.name, portfolioId: data.portfolioId, status: data.status || 'ACTIVE' },
  })
  await recordAudit(prisma, { entityType: 'TENANT', entityId: tenant.id, action: 'CREATED', payload: { code } })
  return tenant
}

export async function createLegalEntity(input) {
  const data = zLegalEntityInput.parse(input)
  const code = data.code || (await uniqueHumanCode('LE', data.legalName, codeExists('legalEntity')))
  const entity = await prisma.legalEntity.create({
    data: {
      code,
      legalName: data.legalName,
      portfolioId: data.portfolioId,
      identifiers: data.identifiers
        ? { create: data.identifiers.map((i) => ({ country: i.country || 'TH', type: i.type, value: i.value })) }
        : undefined,
    },
    include: { identifiers: true },
  })
  await recordAudit(prisma, { entityType: 'LEGAL_ENTITY', entityId: entity.id, action: 'CREATED', payload: { code } })
  return entity
}

export async function createBusiness(input) {
  const data = zBusinessInput.parse(input)
  const code = data.code || (await uniqueHumanCode('BUS', data.name, codeExists('business')))
  const business = await prisma.business.create({
    data: {
      code,
      name: data.name,
      tenantId: data.tenantId,
      legalEntityId: data.legalEntityId ?? null,
      status: data.status || 'ACTIVE',
    },
  })
  await recordAudit(prisma, { entityType: 'BUSINESS', entityId: business.id, action: 'CREATED', payload: { code } })
  return business
}

/**
 * @req FR-020 — "เพิ่มธุรกิจ": the A → B transition in one step.
 * A new business gets its own tenant (isolation boundary) under the existing
 * portfolio plus a starter workspace, so the objective wizard has somewhere to
 * put its first project. The user is never asked about tenants or portfolios.
 */
export async function createBusinessInGroup(input) {
  const data = zBusinessInGroupInput.parse(input)
  const portfolio =
    (data.portfolioId && (await prisma.portfolio.findUnique({ where: { id: data.portfolioId } }))) ||
    (await prisma.portfolio.findFirst({ orderBy: { code: 'asc' } })) ||
    (await createPortfolio({ name: 'กลุ่มธุรกิจของฉัน' }))

  // Codes are resolved before the transaction: uniqueness probes are reads.
  const businessCode = data.code || (await uniqueHumanCode('BUS', data.name, codeExists('business')))
  const tenantCode = await uniqueHumanCode('TNT', data.name, codeExists('tenant'))
  const workspaceCode = await uniqueHumanCode('WS', data.name, codeExists('workspace'))

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { code: tenantCode, name: data.name, portfolioId: portfolio.id },
    })
    const business = await tx.business.create({
      data: { code: businessCode, name: data.name, tenantId: tenant.id },
    })
    const workspace = await tx.workspace.create({
      data: {
        code: workspaceCode,
        name: data.workspaceName || `งานของ${data.name}`,
        scopeType: 'BUSINESS',
        portfolioId: portfolio.id,
        tenantId: tenant.id,
        businessId: business.id,
      },
    })
    await recordAudit(tx, {
      entityType: 'BUSINESS',
      entityId: business.id,
      action: 'CREATED',
      payload: { code: business.code, tenantCode: tenant.code, workspaceCode: workspace.code, via: 'add-business' },
    })
    return { portfolio, tenant, business, workspace }
  })
}

export async function createBranch(input) {
  const data = zBranchInput.parse(input)
  // Hard rule: a branch requires an existing business inside the SAME tenant.
  const business = await prisma.business.findUnique({ where: { id: data.businessId } })
  if (!business) throw new Error('Branch requires an existing business')
  if (business.tenantId !== data.tenantId) {
    throw new Error('Branch tenant must match its business tenant (tenant != branch)')
  }
  const code = data.code || (await uniqueHumanCode('BR', data.name, codeExists('branch')))
  const branch = await prisma.branch.create({
    data: { code, name: data.name, tenantId: data.tenantId, businessId: data.businessId },
  })
  await recordAudit(prisma, { entityType: 'BRANCH', entityId: branch.id, action: 'CREATED', payload: { code } })
  return branch
}

export async function createWorkspace(input) {
  const data = zWorkspaceInput.parse(input)
  // Workspace must carry an explicit scope matching its scopeType.
  if (data.scopeType === 'PORTFOLIO' && !data.portfolioId) throw new Error('Portfolio-scoped workspace requires portfolioId')
  if (data.scopeType === 'TENANT' && !data.tenantId) throw new Error('Tenant-scoped workspace requires tenantId')
  if (data.scopeType === 'BUSINESS' && !data.businessId) throw new Error('Business-scoped workspace requires businessId')

  // Denormalize ancestors for isolation queries.
  let { portfolioId, tenantId, businessId } = data
  if (businessId) {
    const business = await prisma.business.findUnique({ where: { id: businessId }, include: { tenant: true } })
    if (!business) throw new Error('Unknown business')
    tenantId = business.tenantId
    portfolioId = business.tenant.portfolioId
  } else if (tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new Error('Unknown tenant')
    portfolioId = tenant.portfolioId
  }

  const code = data.code || (await uniqueHumanCode('WS', data.name, codeExists('workspace')))
  const workspace = await prisma.workspace.create({
    data: {
      code,
      name: data.name,
      scopeType: data.scopeType,
      portfolioId: portfolioId ?? null,
      tenantId: tenantId ?? null,
      businessId: businessId ?? null,
    },
  })
  await recordAudit(prisma, { entityType: 'WORKSPACE', entityId: workspace.id, action: 'CREATED', payload: { code } })
  return workspace
}

export async function updateWorkspace(id, patch) {
  const existing = await prisma.workspace.findUnique({ where: { id } })
  if (!existing) throw new Error('Workspace not found')
  const workspace = await prisma.workspace.update({
    where: { id },
    data: {
      name: patch.name ?? existing.name,
      status: patch.status ?? existing.status,
      version: { increment: 1 },
    },
  })
  await recordAudit(prisma, { entityType: 'WORKSPACE', entityId: id, action: 'UPDATED', payload: patch })
  return workspace
}

export async function archiveWorkspace(id) {
  const workspace = await prisma.workspace.update({
    where: { id },
    data: { status: 'ARCHIVED', version: { increment: 1 } },
  })
  await recordAudit(prisma, { entityType: 'WORKSPACE', entityId: id, action: 'ARCHIVED' })
  return workspace
}

/**
 * Isolation guard: verify that a workspace belongs to the given business/tenant scope.
 * Used by domain services before cross-entity mutations.
 */
export async function assertWorkspaceInScope(workspaceId, { tenantId, businessId } = {}) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } })
  if (!ws) throw new Error('Workspace not found')
  if (businessId && ws.businessId && ws.businessId !== businessId) {
    throw new Error('Cross-business access denied')
  }
  if (tenantId && ws.tenantId && ws.tenantId !== tenantId) {
    throw new Error('Cross-tenant access denied')
  }
  return ws
}

/**
 * Scope-filtered workspace listing: a BUSINESS-scoped workspace is only
 * visible inside its own business scope.
 */
export async function listWorkspacesForScope({ tenantId, businessId, portfolioId } = {}) {
  const where = { status: { not: 'ARCHIVED' } }
  if (businessId) {
    where.OR = [{ businessId }, { scopeType: 'PORTFOLIO' }]
  } else if (tenantId) {
    where.OR = [{ tenantId }, { scopeType: 'PORTFOLIO' }]
  } else if (portfolioId) {
    where.portfolioId = portfolioId
  }
  return prisma.workspace.findMany({ where, orderBy: { code: 'asc' } })
}

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
import { assertWorkspaceWritable, requireViewer } from './project-authorization'
import { ownsBusiness, ownsTenant, isInstallationOperator } from '@/modules/identity/viewer-authority'

// @req FR-001 — scope hierarchy CRUD (portfolio/tenant/business/branch/workspace)
// @req FR-072 — updateWorkspace/archiveWorkspace refuse the write unless the
// viewer owns the Business governing the Workspace (BUSINESS-scoped) or, for
// a Workspace scoped above Business (PORTFOLIO/TENANT) or an unrecognised
// scope type, refuse for every principal.
// @req FR-074 — every creator is authorized at the scope it actually writes.
// This is what took `/api/scope` off the route-viewer baseline: the blocker was
// never a missing guard, it was that five of the seven creators write at or
// above the Business boundary and nothing above Business was expressible. Two
// authorities were named to answer it — `ownsTenant` (a tenant-wide OWNER
// Membership that already existed and was only ever read on the way to
// `ownedBusinessIds`) and FR-075's installation-operator capability.
// @req FR-075 — the primitives above any Tenant require operator authority.
// @spec BR-001, SEC-001 — tenant = isolation; cross-scope access denied
// @spec SEC-008
// @tested tests/integration/scope-and-isolation.test.js
// @tested tests/integration/fr072-workspace-mutation-authorization.test.js
// @tested tests/integration/fr074-scope-creation-authorization.test.js
// Scope model: Portfolio → Tenant → Business → Workspace.
// tenant_id = isolation boundary; business_id = operating business; branch_id = location.
// A branch is NEVER modeled as a tenant.

const codeExists = (model) => async (code) =>
  Boolean(await prisma[model].findUnique({ where: { code } }))

function refusal(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Guard for the primitives that sit above any Tenant.
 *
 * 403 rather than 404: unlike a per-Business target, there is no resource id
 * here whose existence a refusal could leak, and naming the capability tells the
 * next reader which authority they lack instead of implying the endpoint is
 * missing.
 */
function assertOperator(viewer, what) {
  requireViewer(viewer, 'assertOperator')
  if (!isInstallationOperator(viewer)) {
    throw refusal(
      403,
      `${what} is an installation-wide operation. It requires operator authority ` +
      '(a platform grant, or the local installation session) — owning Businesses ' +
      'or Tenants does not confer it.'
    )
  }
}

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

/**
 * The insert without the guard.
 *
 * Exists because `createBusinessInGroup` must be able to bootstrap the very
 * first Portfolio of an empty installation on behalf of a self-service caller
 * who is not an operator. Keeping the guard on the exported function and the
 * work here is what lets one path be authorized as self-service and the other as
 * an operator primitive, without either one re-deciding the question.
 */
async function insertPortfolio(name, client = prisma) {
  const code = await uniqueHumanCode('PF', name, codeExists('portfolio'))
  const portfolio = await client.portfolio.create({ data: { code, name } })
  await recordAudit(client, { entityType: 'PORTFOLIO', entityId: portfolio.id, action: 'CREATED', payload: { code } })
  return portfolio
}

export async function createPortfolio(input, { viewer } = {}) {
  const data = zPortfolioInput.parse(input)
  // @req FR-075 — a Portfolio sits above every Tenant, so no Tenant or Business
  // ownership reaches it.
  assertOperator(viewer, 'Creating a Portfolio')
  if (data.code) {
    const portfolio = await prisma.portfolio.create({ data: { code: data.code, name: data.name } })
    await recordAudit(prisma, { entityType: 'PORTFOLIO', entityId: portfolio.id, action: 'CREATED', payload: { code: data.code } })
    return portfolio
  }
  return insertPortfolio(data.name)
}

export async function createTenant(input, { viewer } = {}) {
  const data = zTenantInput.parse(input)
  // @req FR-075 — a Tenant is the isolation boundary itself (BR-001); creating
  // one is an installation act, not something an existing Tenant's owner does.
  assertOperator(viewer, 'Creating a Tenant')
  const code = data.code || (await uniqueHumanCode('TNT', data.name, codeExists('tenant')))
  const tenant = await prisma.tenant.create({
    data: { code, name: data.name, portfolioId: data.portfolioId, status: data.status || 'ACTIVE' },
  })
  await recordAudit(prisma, { entityType: 'TENANT', entityId: tenant.id, action: 'CREATED', payload: { code } })
  return tenant
}

export async function createLegalEntity(input, { viewer } = {}) {
  const data = zLegalEntityInput.parse(input)
  // @req FR-075 — a LegalEntity hangs off a Portfolio, above every Tenant.
  assertOperator(viewer, 'Creating a LegalEntity')
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

export async function createBusiness(input, { viewer } = {}) {
  const data = zBusinessInput.parse(input)
  // @req FR-074(b) — a Business is created *inside* a Tenant, so the Tenant is
  // what must be owned. An unowned Tenant answers exactly as an absent one, so a
  // refusal cannot be used to discover which Tenant ids exist.
  requireViewer(viewer, 'createBusiness')
  if (!ownsTenant(viewer, data.tenantId)) throw refusal(404, 'Tenant not found')
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
 *
 * This transaction is also what satisfies FR-066's AC-066.8..11 (ADR-027 §D8):
 * the FR-066 onboarding owner path deliberately links here instead of growing a
 * second Business-creation write path — the Tenant is created implicitly (never
 * skipped in the data, AC-066.10), the Default Space is BUSINESS-scoped with
 * its businessId set in the same transaction (AC-066.8/9), and no screen asks
 * the user to pick or name a Space (AC-066.11).
 */
export async function createBusinessInGroup(input, { viewer } = {}) {
  const data = zBusinessInGroupInput.parse(input)
  // @req FR-074(c) — self-service provisioning. Any authenticated principal may
  // do this, because a brand-new Tenant has no prior owner to ask. Self-service
  // is not anonymous: the viewer is resolved, the Membership below attributes
  // the scope to them, and the audit event records it.
  requireViewer(viewer, 'createBusinessInGroup')
  const portfolio =
    (data.portfolioId && (await prisma.portfolio.findUnique({ where: { id: data.portfolioId } }))) ||
    (await prisma.portfolio.findFirst({ orderBy: { code: 'asc' } })) ||
    // Bootstrap of an empty installation, through the unguarded insert: the
    // caller is self-service rather than an operator, so the exported
    // createPortfolio would refuse them.
    (await insertPortfolio('กลุ่มธุรกิจของฉัน'))

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
    // @req FR-074(c) — bind the creator as OWNER, in the same transaction that
    // creates the scope.
    //
    // This also repairs a latent defect rather than merely authorizing one.
    // Before FR-074 this call created a Tenant, Business and Workspace and no
    // Membership at all, so the person who pressed "เพิ่มธุรกิจ" owned none of
    // it: `ownedBusinessIds` would not contain the Business they had just made,
    // and every FR-072 guard would refuse them. It went unnoticed because the
    // local development viewer owns every Business in the database, which is
    // exactly the shape that hides an ownership bug.
    //
    // Tenant-wide (`businessId: null`) rather than per-Business: the creator owns
    // the Tenant they just provisioned, which is what lets them go on to add a
    // second Business to it under FR-074(b). `domainKeysJson` stays at its
    // default because an OWNER Membership derives every domain from the role.
    await tx.membership.create({
      data: { personId: viewer.principal.id, tenantId: tenant.id, role: 'OWNER' },
    })
    await recordAudit(tx, {
      entityType: 'BUSINESS',
      entityId: business.id,
      action: 'CREATED',
      payload: {
        code: business.code,
        tenantCode: tenant.code,
        workspaceCode: workspace.code,
        via: 'add-business',
        ownerPersonId: viewer.principal.id,
      },
    })
    return { portfolio, tenant, business, workspace }
  })
}

export async function createBranch(input, { viewer } = {}) {
  const data = zBranchInput.parse(input)
  // Hard rule: a branch requires an existing business inside the SAME tenant.
  const business = await prisma.business.findUnique({ where: { id: data.businessId } })
  if (!business) throw new Error('Branch requires an existing business')
  // @req FR-074(a) — a Branch is a location *of a Business*, so it was always
  // governable by the predicate every other write already used. Refuses with the
  // same message the missing-business path produces, so an unowned Business is
  // indistinguishable from one that is not there.
  requireViewer(viewer, 'createBranch')
  if (!ownsBusiness(viewer, data.businessId)) throw refusal(404, 'Branch requires an existing business')
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

export async function createWorkspace(input, { viewer } = {}) {
  const data = zWorkspaceInput.parse(input)
  // Workspace must carry an explicit scope matching its scopeType.
  if (data.scopeType === 'PORTFOLIO' && !data.portfolioId) throw new Error('Portfolio-scoped workspace requires portfolioId')
  if (data.scopeType === 'TENANT' && !data.tenantId) throw new Error('Tenant-scoped workspace requires tenantId')
  if (data.scopeType === 'BUSINESS' && !data.businessId) throw new Error('Business-scoped workspace requires businessId')

  // @req FR-074 — authorized at the scope the Workspace is actually being
  // created at. A lookup rather than a chain of `if`s, and keyed by scope type,
  // so a value added to WORKSPACE_SCOPE_TYPES is refused until someone declares
  // how it is authorized — the same deny-by-default shape FR-065 established.
  requireViewer(viewer, 'createWorkspace')
  const SCOPE_AUTHORIZERS = {
    BUSINESS: () => {
      if (!ownsBusiness(viewer, data.businessId)) throw refusal(404, 'Unknown business')
    },
    TENANT: () => {
      if (!ownsTenant(viewer, data.tenantId)) throw refusal(404, 'Unknown tenant')
    },
    // A PORTFOLIO Space spans every Tenant beneath it, so it sits above the
    // BR-001 isolation boundary — an installation primitive, not a tenant act.
    PORTFOLIO: () => assertOperator(viewer, 'Creating a portfolio-scoped Space'),
  }
  const authorize = Object.prototype.hasOwnProperty.call(SCOPE_AUTHORIZERS, data.scopeType)
    ? SCOPE_AUTHORIZERS[data.scopeType]
    : null
  if (!authorize) {
    throw refusal(403, `Workspace scope type "${data.scopeType}" has no declared creation authority.`)
  }
  authorize()

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

export async function updateWorkspace(id, patch, { viewer } = {}) {
  const existing = await prisma.workspace.findUnique({ where: { id } })
  if (!existing) throw new Error('Workspace not found')
  await assertWorkspaceWritable(viewer, existing)
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

export async function archiveWorkspace(id, { viewer } = {}) {
  const existing = await prisma.workspace.findUnique({ where: { id } })
  if (!existing) {
    // Today a missing id reaches prisma.update() and crashes on P2025 —
    // effectively a 500. Loading first and failing closed here is the fix;
    // explicit status matches the not-found-refusal shape used for a
    // resolved-but-unauthorized target below.
    const error = new Error('Workspace not found')
    error.status = 404
    throw error
  }
  await assertWorkspaceWritable(viewer, existing)
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

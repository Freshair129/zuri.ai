import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import {
  zPortfolioInput,
  zTenantInput,
  zLegalEntityInput,
  zTaxRegistrationBranchInput,
  zBusinessInput,
  zBusinessInGroupInput,
  zBranchInput,
  zWorkspaceInput,
  zPortfolioUpdate,
  zTenantUpdate,
  zLegalEntityUpdate,
  zBusinessUpdate,
  zBranchUpdate,
} from '@/lib/validation/entities'
import { grantBusinessMembership } from '@/modules/identity/membership-grant-service'
import { provisionBusinessAgentConfig } from '@/modules/agent/business-agent-factory'
import { provisionStandardBusinessTemplate } from './business-provisioning-service'
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
// @tested tests/integration/fr001-scope-crud.test.js
// Scope model: Portfolio → Tenant → Business → Workspace.
// tenant_id = isolation boundary; business_id = operating business; branch_id = location.
// A branch is NEVER modeled as a tenant.

const codeExists = (model, db = prisma) => async (code) =>
  Boolean(await db[model].findUnique({ where: { code } }))

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
  const code = await uniqueHumanCode('PF', name, codeExists('portfolio', client))
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

/**
 * @req FR-194 — a LegalEntity now sits under Tenant, not Portfolio (ADR-078
 * D1). What did NOT change here is who may create one: it stays an operator
 * primitive. ADR-078 only repairs the isolation defect (a LegalEntity used to
 * carry no Tenant at all); it does not decide that Tenant ownership should be
 * enough authority to mint a legal entity, and widening that without an
 * explicit decision is exactly the kind of authority creep this repository's
 * ADRs exist to name rather than slip in quietly.
 */
export async function createLegalEntity(input, { viewer } = {}) {
  const data = zLegalEntityInput.parse(input)
  // @req FR-075 — unchanged: a LegalEntity is installation-controlled master
  // data, not a self-service write.
  assertOperator(viewer, 'Creating a LegalEntity')
  const code = data.code || (await uniqueHumanCode('LE', data.legalName, codeExists('legalEntity')))
  const entity = await prisma.legalEntity.create({
    data: {
      code,
      legalName: data.legalName,
      tenantId: data.tenantId,
      identifiers: data.identifiers
        ? { create: data.identifiers.map((i) => ({ country: i.country || 'TH', type: i.type, value: i.value })) }
        : undefined,
    },
    include: { identifiers: true },
  })
  await recordAudit(prisma, { entityType: 'LEGAL_ENTITY', entityId: entity.id, action: 'CREATED', payload: { code } })
  return entity
}

/**
 * @req FR-194 — one of a LegalEntity's own VAT branch registrations
 * (ประมวลรัษฎากร ม.86, ภ.พ.20). Authorized the same way as the LegalEntity it
 * hangs off: a Tenant-scoped record, so Tenant ownership is what governs it —
 * unlike LegalEntity creation itself (kept operator-only above), registering
 * an *additional* branch of an entity the Tenant's owner already administers
 * is the same authority `createBranch` already grants for an operating site.
 */
export async function createTaxRegistrationBranch(input, { viewer } = {}) {
  const data = zTaxRegistrationBranchInput.parse(input)
  const legalEntity = await prisma.legalEntity.findUnique({
    where: { id: data.legalEntityId },
    select: { id: true, tenantId: true },
  })
  if (!legalEntity) throw refusal(404, 'LegalEntity not found')
  requireViewer(viewer, 'createTaxRegistrationBranch')
  if (!ownsTenant(viewer, legalEntity.tenantId)) throw refusal(404, 'LegalEntity not found')
  const branch = await prisma.taxRegistrationBranch.create({
    data: {
      legalEntityId: data.legalEntityId,
      branchCode: data.branchCode,
      name: data.name,
      address: data.address,
    },
  })
  await recordAudit(prisma, {
    entityType: 'TAX_REGISTRATION_BRANCH',
    entityId: branch.id,
    action: 'CREATED',
    payload: { legalEntityId: data.legalEntityId, branchCode: data.branchCode },
  })
  return branch
}

export async function createBusiness(input, { viewer } = {}) {
  const data = zBusinessInput.parse(input)
  // @req FR-074(b) — a Business is created *inside* a Tenant, so the Tenant is
  // what must be owned. An unowned Tenant answers exactly as an absent one, so a
  // refusal cannot be used to discover which Tenant ids exist.
  requireViewer(viewer, 'createBusiness')
  if (!ownsTenant(viewer, data.tenantId)) throw refusal(404, 'Tenant not found')
  // @req FR-194 — a Business may only reference a LegalEntity in its own
  // Tenant. The Supabase migration holds this as a composite FK for Postgres
  // (ADR-078 D1); SQLite has no compound-FK equivalent for `prisma db push` to
  // enforce, so this check is what makes the invariant real in dev and tests
  // too, not only in production.
  if (data.legalEntityId) {
    const legalEntity = await prisma.legalEntity.findUnique({ where: { id: data.legalEntityId }, select: { tenantId: true } })
    if (!legalEntity || legalEntity.tenantId !== data.tenantId) throw refusal(422, 'LEGAL_ENTITY_TENANT_MISMATCH')
  }
  const code = data.code || (await uniqueHumanCode('BUS', data.name, codeExists('business')))
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        code,
        name: data.name,
        tenantId: data.tenantId,
        legalEntityId: data.legalEntityId ?? null,
        status: data.status || 'ACTIVE',
      },
    })
    // @req FR-286 — template and default Space use the same already-authorized
    // Tenant transaction; the helper accepts no client-provided authority.
    const provisioned = await provisionStandardBusinessTemplate(tx, {
      business,
      actorId: viewer.principal.id,
    })
    // @req FR-285 — keep the persisted agent config separate from catalog
    // metadata. This internal write follows the existing FR-074 owner guard.
    await provisionBusinessAgentConfig(tx, { business: provisioned.business, actorId: viewer.principal.id })
    await recordAudit(tx, { entityType: 'BUSINESS', entityId: business.id, action: 'CREATED', payload: { code } })
    return provisioned.business
  })
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
export async function createBusinessInGroup(input, { viewer, db = prisma } = {}) {
  const data = zBusinessInGroupInput.parse(input)
  // @req FR-074(c) — self-service provisioning. Any authenticated principal may
  // do this, because a brand-new Tenant has no prior owner to ask. Self-service
  // is not anonymous: the viewer is resolved, the Membership below attributes
  // the scope to them, and the audit event records it.
  requireViewer(viewer, 'createBusinessInGroup')
  const selectedPortfolio =
    (data.portfolioId && (await db.portfolio.findUnique({ where: { id: data.portfolioId } }))) ||
    (await db.portfolio.findFirst({ orderBy: { code: 'asc' } }))

  // If this is an empty installation, create the first Portfolio inside the
  // provisioning transaction below. Its audit then rolls back with later scope
  // or agent-config failures.

  // Codes are resolved before the transaction: uniqueness probes are reads.
  const businessCode = data.code || (await uniqueHumanCode('BUS', data.name, codeExists('business', db)))
  const tenantCode = await uniqueHumanCode('TNT', data.name, codeExists('tenant', db))
  const workspaceCode = await uniqueHumanCode('WS', data.name, codeExists('workspace', db))

  return db.$transaction(async (tx) => {
    const portfolio = selectedPortfolio || await insertPortfolio('กลุ่มธุรกิจของฉัน', tx)
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
    // @req FR-191 — identity owns the row (ADR-077 D8). The authority is still
    // decided here, by construction: this principal just created the Tenant.
    // What moves is the writing, so the grant carries provenance
    // (`grantSource: 'SELF_PROVISION'`) and lands under the MEMBERSHIP audit
    // family instead of only inside this BUSINESS/CREATED event.
    await grantBusinessMembership({
      personId: viewer.principal.id,
      tenantId: tenant.id,
      businessId: null,
      scopeType: 'TENANT',
      role: 'OWNER',
      grantSource: 'SELF_PROVISION',
      reason: `founder of ${business.code}`,
      actorId: viewer.principal.id,
    }, { db: tx })
    // @req FR-286 — mark this existing starter Space as STANDARD_DEFAULT and
    // persist the catalog-only snapshot from rows created in this transaction.
    const provisioned = await provisionStandardBusinessTemplate(tx, {
      business,
      actorId: viewer.principal.id,
      workspace,
    })
    // @req FR-285 — the five agent configs remain independent of catalog
    // definitions and use the existing founder transaction.
    await provisionBusinessAgentConfig(tx, { business: provisioned.business, actorId: viewer.principal.id })
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
    return { portfolio, tenant, business: provisioned.business, workspace: provisioned.workspace }
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
    data: {
      code,
      name: data.name,
      tenantId: data.tenantId,
      businessId: data.businessId,
      // @req FR-194 — defaults to SITE at the schema level too; passed through
      // explicitly here only when the caller names one.
      ...(data.kind ? { kind: data.kind } : {}),
    },
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

const MUTABLE_SCOPE_ENTITIES = {
  portfolio: {
    model: 'portfolio',
    entityType: 'PORTFOLIO',
    label: 'Portfolio',
    updateSchema: zPortfolioUpdate,
    authority: 'operator',
  },
  tenant: {
    model: 'tenant',
    entityType: 'TENANT',
    label: 'Tenant',
    updateSchema: zTenantUpdate,
    authority: 'operator',
  },
  legalEntity: {
    model: 'legalEntity',
    entityType: 'LEGAL_ENTITY',
    label: 'LegalEntity',
    updateSchema: zLegalEntityUpdate,
    authority: 'operator',
  },
  business: {
    model: 'business',
    entityType: 'BUSINESS',
    label: 'Business',
    updateSchema: zBusinessUpdate,
    authority: 'tenant',
  },
  branch: {
    model: 'branch',
    entityType: 'BRANCH',
    label: 'Branch',
    updateSchema: zBranchUpdate,
    authority: 'business',
  },
}

function scopeAuditState(entity, record) {
  switch (entity) {
    case 'portfolio':
      return { code: record.code, name: record.name, status: record.status, version: record.version }
    case 'tenant':
      return {
        code: record.code,
        name: record.name,
        status: record.status,
        portfolioId: record.portfolioId,
        version: record.version,
      }
    case 'legalEntity':
      return {
        code: record.code,
        legalName: record.legalName,
        legalAddress: record.legalAddress,
        status: record.status,
        tenantId: record.tenantId,
        version: record.version,
      }
    case 'business':
      return {
        code: record.code,
        name: record.name,
        status: record.status,
        tenantId: record.tenantId,
        legalEntityId: record.legalEntityId,
        version: record.version,
      }
    case 'branch':
      return {
        code: record.code,
        name: record.name,
        address: record.address,
        kind: record.kind,
        status: record.status,
        tenantId: record.tenantId,
        businessId: record.businessId,
        version: record.version,
      }
    default:
      throw new Error(`Unknown scope entity: ${entity}`)
  }
}

function scopeAuditColumns(entity, record) {
  switch (entity) {
    case 'tenant':
      return { tenantId: record.id }
    case 'legalEntity':
      return { tenantId: record.tenantId }
    case 'business':
      return { tenantId: record.tenantId, businessId: record.id }
    case 'branch':
      return { tenantId: record.tenantId, businessId: record.businessId }
    default:
      return {}
  }
}

async function assertScopeMutationAuthority(entity, record, viewer, db) {
  const config = MUTABLE_SCOPE_ENTITIES[entity]
  if (config.authority === 'operator') return

  requireViewer(viewer, `change${config.label}`)
  if (config.authority === 'tenant') {
    if (!ownsTenant(viewer, record.tenantId)) throw refusal(404, `${config.label} not found`)
    return
  }

  if (config.authority === 'business') {
    const business = await db.business.findUnique({
      where: { id: record.businessId },
      select: { id: true, tenantId: true },
    })
    if (!business || business.tenantId !== record.tenantId || !ownsBusiness(viewer, business.id)) {
      throw refusal(404, `${config.label} not found`)
    }
    return
  }

  throw refusal(403, `${config.label} has no declared mutation authority`)
}

async function mutateScopeEntity(entity, id, patch, { viewer, expectedVersion } = {}, action) {
  const config = MUTABLE_SCOPE_ENTITIES[entity]
  if (!config) throw refusal(400, `Unknown scope entity: ${entity}`)
  if (config.authority === 'operator') {
    // Check before looking up the id so non-operators cannot use 403/404 to
    // discover whether an installation-wide scope row exists.
    assertOperator(viewer, `Changing a ${config.label}`)
  } else {
    requireViewer(viewer, `${action}${config.label}`)
  }
  if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
    throw refusal(400, 'SCOPE_VERSION_INVALID')
  }
  const changes = action === 'archive' ? { status: 'ARCHIVED' } : config.updateSchema.parse(patch)

  return prisma.$transaction(async (tx) => {
    const existing = await tx[config.model].findUnique({ where: { id } })
    if (!existing) throw refusal(404, `${config.label} not found`)
    await assertScopeMutationAuthority(entity, existing, viewer, tx)
    const versionConflict = () => refusal(409, `${config.entityType}_VERSION_CONFLICT`)
    if (expectedVersion !== undefined && existing.version !== expectedVersion) throw versionConflict()

    if (changes.code !== undefined && changes.code !== existing.code) {
      const conflicting = await tx[config.model].findUnique({ where: { code: changes.code }, select: { id: true } })
      if (conflicting && conflicting.id !== id) throw refusal(409, `${config.label} code already exists`)
    }

    if (entity === 'business' && changes.legalEntityId) {
      const legalEntity = await tx.legalEntity.findUnique({
        where: { id: changes.legalEntityId },
        select: { tenantId: true },
      })
      if (!legalEntity || legalEntity.tenantId !== existing.tenantId) {
        throw refusal(422, 'LEGAL_ENTITY_TENANT_MISMATCH')
      }
    }

    const before = scopeAuditState(entity, existing)
    const write = await tx[config.model].updateMany({
      where: { id, version: existing.version },
      data: { ...changes, version: { increment: 1 } },
    })
    if (write.count !== 1) throw versionConflict()
    const updated = await tx[config.model].findUnique({ where: { id } })
    await recordAudit(tx, {
      entityType: config.entityType,
      entityId: id,
      action: action === 'archive' ? 'ARCHIVED' : 'UPDATED',
      payload: changes,
      actorId: viewer.principal.id,
      ...scopeAuditColumns(entity, existing),
      beforeJson: before,
      afterJson: scopeAuditState(entity, updated),
    })
    return updated
  })
}

// @req FR-001 — update and archive the remaining scope entities without
// changing their tenant/business ancestry or deleting dependent records.
// @req FR-074 — Business changes require Tenant ownership; Branch changes
// require ownership of the Business they belong to.
// @req FR-075 — Portfolio, Tenant and LegalEntity changes retain their
// existing installation-operator authority.
export const updatePortfolio = (id, patch, options) => mutateScopeEntity('portfolio', id, patch, options, 'update')
export const archivePortfolio = (id, options) => mutateScopeEntity('portfolio', id, null, options, 'archive')
export const updateTenant = (id, patch, options) => mutateScopeEntity('tenant', id, patch, options, 'update')
export const archiveTenant = (id, options) => mutateScopeEntity('tenant', id, null, options, 'archive')
export const updateLegalEntity = (id, patch, options) => mutateScopeEntity('legalEntity', id, patch, options, 'update')
export const archiveLegalEntity = (id, options) => mutateScopeEntity('legalEntity', id, null, options, 'archive')
export const updateBusiness = (id, patch, options) => mutateScopeEntity('business', id, patch, options, 'update')
export const archiveBusiness = (id, options) => mutateScopeEntity('business', id, null, options, 'archive')
export const updateBranch = (id, patch, options) => mutateScopeEntity('branch', id, patch, options, 'update')
export const archiveBranch = (id, options) => mutateScopeEntity('branch', id, null, options, 'archive')

function validateWorkspaceExpectedVersion(expectedVersion) {
  if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
    throw refusal(400, 'WORKSPACE_VERSION_INVALID')
  }
}

function workspaceVersionConflict() {
  return refusal(409, 'WORKSPACE_VERSION_CONFLICT')
}

export async function updateWorkspace(id, patch, { viewer, expectedVersion } = {}) {
  validateWorkspaceExpectedVersion(expectedVersion)
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workspace.findUnique({ where: { id } })
    if (!existing) throw refusal(404, 'Workspace not found')
    await assertWorkspaceWritable(viewer, existing)
    if (expectedVersion !== undefined && existing.version !== expectedVersion) throw workspaceVersionConflict()

    const write = await tx.workspace.updateMany({
      where: { id, version: existing.version },
      data: {
        name: patch.name ?? existing.name,
        status: patch.status ?? existing.status,
        version: { increment: 1 },
      },
    })
    if (write.count !== 1) throw workspaceVersionConflict()
    const workspace = await tx.workspace.findUnique({ where: { id } })
    await recordAudit(tx, { entityType: 'WORKSPACE', entityId: id, action: 'UPDATED', payload: patch })
    return workspace
  })
}

export async function archiveWorkspace(id, { viewer, expectedVersion } = {}) {
  validateWorkspaceExpectedVersion(expectedVersion)
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workspace.findUnique({ where: { id } })
    if (!existing) throw refusal(404, 'Workspace not found')
    await assertWorkspaceWritable(viewer, existing)
    if (expectedVersion !== undefined && existing.version !== expectedVersion) throw workspaceVersionConflict()

    const write = await tx.workspace.updateMany({
      where: { id, version: existing.version },
      data: { status: 'ARCHIVED', version: { increment: 1 } },
    })
    if (write.count !== 1) throw workspaceVersionConflict()
    const workspace = await tx.workspace.findUnique({ where: { id } })
    await recordAudit(tx, { entityType: 'WORKSPACE', entityId: id, action: 'ARCHIVED' })
    return workspace
  })
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

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { beforeEach, describe, expect, inject, it } from 'vitest'
import prisma from '@/lib/db'
import { grantBusinessMembership } from '@/modules/identity/membership-grant-service'
import {
  createBusiness,
  createBusinessInGroup,
} from '@/modules/project-manager/application/scope-service'
import {
  provisionStandardBusinessTemplate,
} from '@/modules/project-manager/application/business-provisioning-service'
import {
  STANDARD_BUSINESS_SPACE_KEY,
  STANDARD_BUSINESS_TEMPLATE_ID,
  STANDARD_BUSINESS_TEMPLATE_VERSION,
  validateStoredBusinessProvisioning,
} from '@/modules/project-manager/application/business-provisioning-template'
import { makeViewer } from '../factories/viewer'

// @req FR-286 — create a pinned catalog snapshot and one default Business Space
// in the existing FR-074 transaction without adding template grants.
// @req FR-285 — retain the independent five-role Agent Factory configuration.
// @spec FR-074, FR-169, FR-191, FR-192, FR-285
// @tested tests/unit/business-provisioning-template.test.js

const engine = inject('testDatabaseEngine') ?? 'sqlite'
const testDatabaseUrl = inject('testDatabaseUrl')
const provisioningMigration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261015010000_standard_business_provisioning.sql',
  import.meta.url,
)), 'utf8')

function suffix() {
  return randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
}

async function existingTenantOwner(label = 'BP') {
  const key = suffix()
  const portfolio = await prisma.portfolio.create({
    data: { code: `PF-${label}-${key}`, name: `${label} ${key}` },
  })
  const tenant = await prisma.tenant.create({
    data: { code: `TN-${label}-${key}`, name: `${label} ${key}`, portfolioId: portfolio.id },
  })
  const person = await prisma.person.create({
    data: { code: `PE-${label}-${key}`, displayName: `Owner ${key}` },
  })
  await grantBusinessMembership({
    personId: person.id,
    tenantId: tenant.id,
    businessId: null,
    scopeType: 'TENANT',
    role: 'OWNER',
    actorId: person.id,
  })
  const viewer = makeViewer({
    role: 'OWNER',
    visibleBusinessIds: [],
    ownedBusinessIds: [],
    ownedTenantIds: [tenant.id],
    principal: { id: person.id, code: person.code, displayName: person.displayName },
  })
  return { portfolio, tenant, person, viewer, key }
}

describe('FR-286 Standard Business provisioning', () => {
  let target

  beforeEach(async () => {
    target = await existingTenantOwner()
  })

  it('provisions the existing-Tenant path with one default Space, separate agent config and no new membership', async () => {
    const membershipsBefore = await prisma.membership.count({ where: { tenantId: target.tenant.id } })
    const business = await createBusiness({
      tenantId: target.tenant.id,
      name: `Business ${target.key}`,
      code: `BU-BP-${target.key}`,
    }, { viewer: target.viewer })

    const spaces = await prisma.workspace.findMany({ where: { businessId: business.id } })
    expect(spaces).toHaveLength(1)
    expect(spaces[0]).toMatchObject({
      scopeType: 'BUSINESS',
      businessId: business.id,
      tenantId: target.tenant.id,
      portfolioId: target.portfolio.id,
      provisioningKey: STANDARD_BUSINESS_SPACE_KEY,
    })
    expect(spaces[0].name).toBe(`งานของ${business.name}`)
    expect(await prisma.membership.count({ where: { tenantId: target.tenant.id } })).toBe(membershipsBefore)
    expect(await prisma.roleBinding.count({ where: { businessId: business.id } })).toBe(0)
    expect(business).toMatchObject({
      provisioningTemplateId: STANDARD_BUSINESS_TEMPLATE_ID,
      provisioningTemplateVersion: STANDARD_BUSINESS_TEMPLATE_VERSION,
      capabilitiesJson: '{}',
      knowledgeCandidatesEnabled: false,
    })
    expect(validateStoredBusinessProvisioning({
      ...business,
      tenant: { id: target.tenant.id, portfolioId: target.portfolio.id },
    }, spaces[0]).status).toBe('VALID')
    expect(await prisma.businessAgentConfig.findUnique({ where: { businessId: business.id } }))
      .toMatchObject({ tenantId: target.tenant.id, businessId: business.id, delegationPolicy: 'DENY' })

    const templateAudit = await prisma.auditEvent.findMany({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'BUSINESS_TEMPLATE_APPLIED' },
    })
    expect(templateAudit).toHaveLength(1)
    expect(templateAudit[0]).toMatchObject({ actorId: target.person.id, tenantId: target.tenant.id, businessId: business.id })
    expect(JSON.parse(templateAudit[0].payloadJson)).toMatchObject({
      templateId: STANDARD_BUSINESS_TEMPLATE_ID,
      templateVersion: STANDARD_BUSINESS_TEMPLATE_VERSION,
    })
  })

  it('reuses the self-service starter Space and retains only its existing founder Tenant OWNER grant', async () => {
    const result = await createBusinessInGroup({
      name: `Self ${target.key}`,
      code: `BU-BPS-${target.key}`,
      portfolioId: target.portfolio.id,
      workspaceName: `User named Space ${target.key}`,
    }, { viewer: target.viewer })

    const spaces = await prisma.workspace.findMany({ where: { businessId: result.business.id } })
    expect(spaces).toHaveLength(1)
    expect(spaces[0]).toMatchObject({
      id: result.workspace.id,
      name: `User named Space ${target.key}`,
      scopeType: 'BUSINESS',
      businessId: result.business.id,
      tenantId: result.tenant.id,
      portfolioId: result.portfolio.id,
      provisioningKey: STANDARD_BUSINESS_SPACE_KEY,
    })
    const memberships = await prisma.membership.findMany({ where: { tenantId: result.tenant.id } })
    expect(memberships).toHaveLength(1)
    expect(memberships[0]).toMatchObject({
      personId: target.person.id,
      scopeType: 'TENANT',
      businessId: null,
      role: 'OWNER',
    })
    expect(await prisma.roleBinding.count({ where: { businessId: result.business.id } })).toBe(0)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'BUSINESS', entityId: result.business.id, action: 'BUSINESS_TEMPLATE_APPLIED' },
    })).toBe(1)
    expect(await prisma.businessAgentConfig.count({ where: { businessId: result.business.id } })).toBe(1)
  })

  it('returns ALREADY_APPLIED without changing post-creation edits or duplicating either APPLIED audit', async () => {
    const business = await createBusiness({
      tenantId: target.tenant.id,
      name: `Repeat ${target.key}`,
      code: `BU-BPR-${target.key}`,
    }, { viewer: target.viewer })
    const workspace = await prisma.workspace.findFirst({ where: { businessId: business.id } })
    await prisma.business.update({
      where: { id: business.id },
      data: { name: 'Edited Business', capabilitiesJson: '{"physicalStock":false}', knowledgeCandidatesEnabled: true, version: 7 },
    })
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { name: 'Edited Space', status: 'ARCHIVED', version: 4 },
    })
    const beforeBusiness = await prisma.business.findUnique({ where: { id: business.id } })
    const beforeWorkspace = await prisma.workspace.findUnique({ where: { id: workspace.id } })

    const repeated = await Promise.all([1, 2].map(() => prisma.$transaction((tx) =>
      provisionStandardBusinessTemplate(tx, { business: beforeBusiness, actorId: target.person.id }),
    )))

    expect(repeated.map(({ status }) => status)).toEqual(['ALREADY_APPLIED', 'ALREADY_APPLIED'])
    expect(await prisma.business.findUnique({ where: { id: business.id } })).toEqual(beforeBusiness)
    expect(await prisma.workspace.findUnique({ where: { id: workspace.id } })).toEqual(beforeWorkspace)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'BUSINESS_TEMPLATE_APPLIED' },
    })).toBe(1)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'AGENT_CONFIG_APPLIED' },
    })).toBe(1)
  })

  it('refuses a corrupted stored snapshot without replacing the marker or adding an audit', async () => {
    const business = await createBusiness({
      tenantId: target.tenant.id,
      name: `Corrupt ${target.key}`,
      code: `BU-BPC-${target.key}`,
    }, { viewer: target.viewer })
    const stored = await prisma.business.findUnique({ where: { id: business.id } })
    const changed = JSON.parse(stored.provisioningSnapshotJson)
    changed.domains.push('unreviewed-domain')
    await prisma.business.update({
      where: { id: business.id },
      data: { provisioningSnapshotJson: JSON.stringify(changed) },
    })
    const before = await prisma.business.findUnique({ where: { id: business.id } })

    await expect(prisma.$transaction((tx) => provisionStandardBusinessTemplate(tx, {
      business: before,
      actorId: target.person.id,
    }))).rejects.toMatchObject({ code: 'BUSINESS_PROVISIONING_CORRUPT' })

    expect(await prisma.business.findUnique({ where: { id: business.id } })).toEqual(before)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'BUSINESS_TEMPLATE_APPLIED' },
    })).toBe(1)
    // The suite shares its isolated DB with recovery regressions. Restore only
    // this intentionally corrupted fixture after proving refusal/no overwrite.
    await prisma.business.update({ where: { id: business.id }, data: {
      provisioningSnapshotJson: stored.provisioningSnapshotJson,
      updatedAt: stored.updatedAt,
    } })
  })

  it('rolls back empty-Portfolio bootstrap and the full scope if the template audit fails', async () => {
    const key = suffix()
    const code = `BU-BP-RB-${key}`
    const captured = {}
    const db = {
      portfolio: { findUnique: async () => null, findFirst: async () => null },
      tenant: prisma.tenant,
      business: prisma.business,
      workspace: prisma.workspace,
      $transaction: (callback) => prisma.$transaction((tx) => callback(new Proxy(tx, {
        get(target, property) {
          const delegate = Reflect.get(target, property, target)
          if (['portfolio', 'tenant', 'business', 'workspace'].includes(property)) {
            return new Proxy(delegate, {
              get(model, method) {
                if (method === 'create') return async (args) => {
                  const row = await model.create(args)
                  captured[`${String(property)}Id`] = row.id
                  return row
                }
                const value = Reflect.get(model, method, model)
                return typeof value === 'function' ? value.bind(model) : value
              },
            })
          }
          if (property === 'auditEvent') {
            return new Proxy(delegate, {
              get(model, method) {
                if (method === 'create') return async (args) => {
                  if (args.data.action === 'BUSINESS_TEMPLATE_APPLIED') throw new Error('INJECTED_TEMPLATE_AUDIT_FAILURE')
                  return model.create(args)
                }
                const value = Reflect.get(model, method, model)
                return typeof value === 'function' ? value.bind(model) : value
              },
            })
          }
          return delegate
        },
      }))),
    }

    await expect(createBusinessInGroup({ name: `Rollback ${key}`, code }, { viewer: target.viewer, db }))
      .rejects.toThrow('INJECTED_TEMPLATE_AUDIT_FAILURE')
    expect(await prisma.portfolio.findUnique({ where: { id: captured.portfolioId } })).toBeNull()
    expect(await prisma.tenant.findUnique({ where: { id: captured.tenantId } })).toBeNull()
    expect(await prisma.business.findUnique({ where: { id: captured.businessId } })).toBeNull()
    expect(await prisma.workspace.findUnique({ where: { id: captured.workspaceId } })).toBeNull()
    expect(await prisma.businessAgentConfig.findUnique({ where: { businessId: captured.businessId } })).toBeNull()
    expect(await prisma.auditEvent.count({ where: { entityType: 'PORTFOLIO', entityId: captured.portfolioId } })).toBe(0)
    expect(await prisma.auditEvent.count({ where: { tenantId: captured.tenantId } })).toBe(0)
    expect(await prisma.auditEvent.count({ where: { businessId: captured.businessId } })).toBe(0)
  })

  it.skipIf(engine !== 'postgresql')('applies the source SQL safely and enforces its markers and Space-key constraints', async () => {
    if (!testDatabaseUrl) throw new Error('DISPOSABLE_POSTGRES_TEST_URL_REQUIRED')
    const schema = `fr286_source_${suffix().toLowerCase()}`
    const quotedSchema = `"${schema}"`
    const client = new pg.Client({ connectionString: testDatabaseUrl })
    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      await client.query(`SET search_path TO ${quotedSchema}`)
      // This is intentionally the pre-feature shape: exercise the checked-in
      // source migration, not generated Prisma DDL or the suite's public schema.
      await client.query(`
        CREATE TABLE "Business" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL);
        CREATE TABLE "Workspace" (
          "id" TEXT PRIMARY KEY, "scopeType" TEXT NOT NULL,
          "portfolioId" TEXT, "tenantId" TEXT, "businessId" TEXT
        );
      `)
      await client.query(provisioningMigration)
      await client.query(`INSERT INTO "Business" ("id", "tenantId") VALUES ('b1', 't1')`)
      await expect(client.query(`INSERT INTO "Business" ("id", "tenantId", "provisioningTemplateId") VALUES ('partial', 't1', 'standard-business')`))
        .rejects.toMatchObject({ code: '23514' })
      await client.query(`INSERT INTO "Business" (
        "id", "tenantId", "provisioningTemplateId", "provisioningTemplateVersion",
        "provisioningTemplateDigest", "provisioningSnapshotJson"
      ) VALUES ('marked', 't1', 'standard-business', '1.0.0', repeat('a', 64), '{}')`)

      await client.query(`INSERT INTO "Workspace" ("id", "scopeType", "portfolioId", "tenantId", "businessId")
        VALUES ('ordinary-1', 'BUSINESS', 'p1', 't1', 'b1'), ('ordinary-2', 'BUSINESS', 'p1', 't1', 'b1')`)
      await client.query(`INSERT INTO "Workspace" (
        "id", "scopeType", "portfolioId", "tenantId", "businessId", "provisioningKey"
      ) VALUES ('default-1', 'BUSINESS', 'p1', 't1', 'b1', 'STANDARD_DEFAULT')`)
      await expect(client.query(`INSERT INTO "Workspace" (
        "id", "scopeType", "portfolioId", "tenantId", "businessId", "provisioningKey"
      ) VALUES ('default-2', 'BUSINESS', 'p1', 't1', 'b1', 'STANDARD_DEFAULT')`))
        .rejects.toMatchObject({ code: '23505' })
      await expect(client.query(`INSERT INTO "Workspace" (
        "id", "scopeType", "portfolioId", "tenantId", "businessId", "provisioningKey"
      ) VALUES ('bad-key', 'TENANT', NULL, 't1', NULL, 'STANDARD_DEFAULT')`))
        .rejects.toMatchObject({ code: '23514' })
    } finally {
      await client.query('ROLLBACK')
      await client.query('RESET search_path')
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
      await client.end()
    }
  })
})

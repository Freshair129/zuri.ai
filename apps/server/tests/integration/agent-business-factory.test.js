import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { grantBusinessMembership } from '@/modules/identity/membership-grant-service'
import {
  applyBusinessAgentTemplate,
  previewBusinessAgentTemplate,
  readBusinessAgentConfig,
} from '@/modules/agent/business-agent-factory'
import { createBusinessInGroup } from '@/modules/project-manager/application/scope-service'
import {
  BUSINESS_AGENT_ROLE_IDS,
  BUSINESS_AGENT_TEMPLATE_ID,
  buildBusinessAgentTemplate,
  businessAgentSnapshotDigest,
  canonicalJson,
} from '@/modules/agent/business-agent-template'
import { makeViewer } from '../factories/viewer'

function suffix() {
  return randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
}

async function fixture() {
  const key = suffix()
  const portfolio = await prisma.portfolio.create({ data: { code: `PF-AF-${key}`, name: `Factory ${key}` } })
  const tenant = await prisma.tenant.create({
    data: { code: `TN-AF-${key}`, name: `Factory ${key}`, portfolioId: portfolio.id },
  })
  const business = await prisma.business.create({
    data: { code: `BU-AF-${key}`, name: `Factory ${key}`, tenantId: tenant.id },
  })
  const owner = await prisma.person.create({ data: { code: `PE-AF-${key}`, displayName: `Owner ${key}` } })
  const tenantOwner = await prisma.person.create({ data: { code: `PT-AF-${key}`, displayName: `Tenant Owner ${key}` } })
  const ownerMembership = await grantBusinessMembership({
    personId: owner.id,
    tenantId: tenant.id,
    businessId: business.id,
    scopeType: 'BUSINESS',
    role: 'OWNER',
    actorId: owner.id,
  })
  const tenantOwnerMembership = await grantBusinessMembership({
    personId: tenantOwner.id,
    tenantId: tenant.id,
    businessId: null,
    scopeType: 'TENANT',
    role: 'OWNER',
    actorId: tenantOwner.id,
  })
  return {
    portfolio,
    tenant,
    business,
    owner,
    ownerMembership,
    tenantOwnerMembership,
    ownerViewer: makeViewer({
      role: 'OWNER',
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      principal: { id: owner.id, code: owner.code, displayName: owner.displayName },
    }),
    tenantOwnerViewer: makeViewer({
      role: 'OWNER',
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [],
      ownedTenantIds: [tenant.id],
      principal: { id: tenantOwner.id, code: tenantOwner.code, displayName: tenantOwner.displayName },
    }),
  }
}

describe('FR-285 Business agent factory persistence', () => {
  let target
  beforeEach(async () => { target = await fixture() })

  it('enforces Tenant/Business pairing and one config per Business in the database', async () => {
    const other = await fixture()
    const wrongScope = buildBusinessAgentTemplate({
      tenantId: other.tenant.id, businessId: target.business.id,
    })
    const data = {
      tenantId: other.tenant.id,
      businessId: target.business.id,
      schemaVersion: wrongScope.schemaVersion,
      templateId: wrongScope.templateId,
      templateVersion: wrongScope.templateVersion,
      version: wrongScope.configVersion,
      delegationPolicy: wrongScope.delegationPolicy,
      snapshotJson: canonicalJson(wrongScope),
      snapshotDigest: businessAgentSnapshotDigest(wrongScope),
      appliedByPersonId: target.owner.id,
    }
    await expect(prisma.businessAgentConfig.create({ data })).rejects.toMatchObject({ code: 'P2003' })
    expect(await prisma.businessAgentConfig.count({ where: { businessId: target.business.id } })).toBe(0)

    await applyBusinessAgentTemplate(target.business.id, { viewer: target.ownerViewer })
    await expect(prisma.businessAgentConfig.create({ data: { ...data, tenantId: target.tenant.id } }))
      .rejects.toMatchObject({ code: 'P2002' })
    expect(await prisma.businessAgentConfig.count({ where: { businessId: target.business.id } })).toBe(1)
  })

  it('previews without writing and authorizes either persisted Business or Tenant OWNER Membership', async () => {
    const beforeConfigs = await prisma.businessAgentConfig.count()
    const beforeAppliedAudits = await prisma.auditEvent.count({
      where: { entityType: 'BUSINESS', action: 'AGENT_CONFIG_APPLIED' },
    })

    const preview = await previewBusinessAgentTemplate(target.business.id, { viewer: target.ownerViewer })
    const tenantPreview = await previewBusinessAgentTemplate(target.business.id, { viewer: target.tenantOwnerViewer })

    expect(preview.status).toBe('READY_TO_APPLY')
    expect(preview.template.scope).toEqual({ tenantId: target.tenant.id, businessId: target.business.id })
    expect(tenantPreview.status).toBe('READY_TO_APPLY')
    expect(await prisma.businessAgentConfig.count()).toBe(beforeConfigs)
    expect(await prisma.auditEvent.count({ where: { entityType: 'BUSINESS', action: 'AGENT_CONFIG_APPLIED' } }))
      .toBe(beforeAppliedAudits)
    await expect(readBusinessAgentConfig({ tenantId: target.tenant.id, businessId: target.business.id }))
      .resolves.toEqual({ status: 'NOT_CONFIGURED', config: null })
  })

  it('applies once under concurrent and repeated calls, with one attributed audit', async () => {
    const results = await Promise.all([
      applyBusinessAgentTemplate(target.business.id, { viewer: target.ownerViewer }),
      applyBusinessAgentTemplate(target.business.id, { viewer: target.ownerViewer }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['ALREADY_APPLIED', 'APPLIED'])

    const row = await prisma.businessAgentConfig.findUnique({ where: { businessId: target.business.id } })
    const snapshot = JSON.parse(row.snapshotJson)
    expect(snapshot.roles.map((role) => role.roleId)).toEqual(BUSINESS_AGENT_ROLE_IDS)
    expect(snapshot.delegationPolicy).toBe('DENY')
    expect(row.snapshotDigest).toBe(businessAgentSnapshotDigest(snapshot))
    expect(row.templateId).toBe(BUSINESS_AGENT_TEMPLATE_ID)
    expect(row.appliedByPersonId).toBe(target.owner.id)
    expect(row.version).toBe(1)
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.updatedAt).toBeInstanceOf(Date)

    const audits = await prisma.auditEvent.findMany({
      where: { entityType: 'BUSINESS', entityId: target.business.id, action: 'AGENT_CONFIG_APPLIED' },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actorId: target.owner.id,
      tenantId: target.tenant.id,
      businessId: target.business.id,
    })
    expect(JSON.parse(audits[0].payloadJson)).toMatchObject({
      templateId: BUSINESS_AGENT_TEMPLATE_ID,
      snapshotDigest: row.snapshotDigest,
    })

    const repeated = await applyBusinessAgentTemplate(target.business.id, { viewer: target.ownerViewer })
    expect(repeated.status).toBe('ALREADY_APPLIED')
    const afterRepeat = await prisma.businessAgentConfig.findUnique({ where: { businessId: target.business.id } })
    expect(afterRepeat.createdAt).toEqual(row.createdAt)
    expect(afterRepeat.updatedAt).toEqual(row.updatedAt)
    expect(afterRepeat.version).toBe(row.version)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'BUSINESS', entityId: target.business.id, action: 'AGENT_CONFIG_APPLIED' },
    })).toBe(1)
    await expect(readBusinessAgentConfig({ tenantId: target.tenant.id, businessId: target.business.id }))
      .resolves.toMatchObject({ status: 'CONFIGURED', config: { roles: snapshot.roles } })
  })

  it('uses persisted membership instead of payload role or owned Business claims', async () => {
    const forgedOwner = makeViewer({
      role: 'OWNER',
      visibleBusinessIds: [target.business.id],
      ownedBusinessIds: [target.business.id],
      principal: { id: `forged-${suffix()}`, code: 'FORGED', displayName: 'Forged Owner' },
    })
    const memberPerson = await prisma.person.create({ data: { code: `PM-AF-${suffix()}`, displayName: 'Member' } })
    const member = makeViewer({
      role: 'MEMBER',
      visibleBusinessIds: [target.business.id],
      ownedBusinessIds: [],
      principal: { id: memberPerson.id, code: memberPerson.code, displayName: memberPerson.displayName },
    })

    await expect(applyBusinessAgentTemplate(target.business.id, { viewer: forgedOwner }))
      .rejects.toMatchObject({ status: 404, code: 'BUSINESS_NOT_FOUND' })
    await expect(previewBusinessAgentTemplate(target.business.id, { viewer: member }))
      .rejects.toMatchObject({ status: 404, code: 'BUSINESS_NOT_FOUND' })
    expect(await prisma.businessAgentConfig.count({ where: { businessId: target.business.id } })).toBe(0)
    await expect(readBusinessAgentConfig({ tenantId: `wrong-${target.tenant.id}`, businessId: target.business.id }))
      .resolves.toEqual({ status: 'NOT_CONFIGURED', config: null })
  })

  it('refuses revoked or expired OWNER Memberships', async () => {
    await prisma.membership.update({
      where: { id: target.ownerMembership.id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedByPersonId: target.owner.id },
    })
    await prisma.membership.update({
      where: { id: target.tenantOwnerMembership.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    await expect(applyBusinessAgentTemplate(target.business.id, { viewer: target.ownerViewer }))
      .rejects.toMatchObject({ status: 404, code: 'BUSINESS_NOT_FOUND' })
    await expect(previewBusinessAgentTemplate(target.business.id, { viewer: target.tenantOwnerViewer }))
      .rejects.toMatchObject({ status: 404, code: 'BUSINESS_NOT_FOUND' })
    expect(await prisma.businessAgentConfig.count({ where: { businessId: target.business.id } })).toBe(0)
  })

  it('refuses valid future-version conflicts without replacing them or adding an audit', async () => {
    const future = {
      ...buildBusinessAgentTemplate({ tenantId: target.tenant.id, businessId: target.business.id }),
      templateVersion: 2,
      configVersion: 2,
    }
    const digest = businessAgentSnapshotDigest(future)
    await prisma.businessAgentConfig.create({
      data: {
        tenantId: target.tenant.id,
        businessId: target.business.id,
        schemaVersion: future.schemaVersion,
        templateId: future.templateId,
        templateVersion: future.templateVersion,
        version: future.configVersion,
        delegationPolicy: future.delegationPolicy,
        snapshotJson: canonicalJson(future),
        snapshotDigest: digest,
        appliedByPersonId: target.owner.id,
      },
    })

    await expect(applyBusinessAgentTemplate(target.business.id, { viewer: target.ownerViewer }))
      .rejects.toMatchObject({ status: 409, code: 'BUSINESS_AGENT_CONFIG_VERSION_CONFLICT' })
    expect(await prisma.businessAgentConfig.findUnique({ where: { businessId: target.business.id } }))
      .toMatchObject({ templateVersion: 2, snapshotDigest: digest })
    expect(await prisma.auditEvent.count({
      where: { entityType: 'BUSINESS', entityId: target.business.id, action: 'AGENT_CONFIG_APPLIED' },
    })).toBe(0)
  })

  it('rejects checksum-consistent edited tools as corrupt and never widens runtime output', async () => {
    const changed = buildBusinessAgentTemplate({ tenantId: target.tenant.id, businessId: target.business.id })
    changed.roles[0].allowedTools.push('unregistered_tool')
    const digest = businessAgentSnapshotDigest(changed)
    await prisma.businessAgentConfig.create({
      data: {
        tenantId: target.tenant.id,
        businessId: target.business.id,
        schemaVersion: changed.schemaVersion,
        templateId: changed.templateId,
        templateVersion: changed.templateVersion,
        version: changed.configVersion,
        delegationPolicy: changed.delegationPolicy,
        snapshotJson: canonicalJson(changed),
        snapshotDigest: digest,
        appliedByPersonId: target.owner.id,
      },
    })

    await expect(readBusinessAgentConfig({ tenantId: target.tenant.id, businessId: target.business.id }))
      .rejects.toMatchObject({ status: 500, code: 'BUSINESS_AGENT_CONFIG_CORRUPT' })
    await expect(previewBusinessAgentTemplate(target.business.id, { viewer: target.ownerViewer }))
      .rejects.toMatchObject({ status: 500, code: 'BUSINESS_AGENT_CONFIG_CORRUPT' })
  })

  it.each(['config', 'audit'])('rolls back newly created scope when %s persistence fails', async (failurePoint) => {
    const key = suffix()
    const businessCode = `BU-RB-${key}`
    const captured = {}
    const db = {
      // Force the empty-installation branch while all writes still use the
      // real isolated database and interactive transaction below.
      portfolio: { findUnique: async () => null, findFirst: async () => null },
      tenant: prisma.tenant,
      business: prisma.business,
      workspace: prisma.workspace,
      $transaction: (callback) => prisma.$transaction((tx) => callback(new Proxy(tx, {
      get(targetTx, property) {
        if (failurePoint === 'config' && property === 'businessAgentConfig') {
          return { create: async () => { throw new Error('INJECTED_CONFIG_WRITE_FAILURE') } }
        }
        if (failurePoint === 'audit' && property === 'auditEvent') {
          return {
            create: async (args) => {
              if (args.data.action === 'AGENT_CONFIG_APPLIED') throw new Error('INJECTED_CONFIG_AUDIT_FAILURE')
              return targetTx.auditEvent.create(args)
            },
          }
        }
        const delegate = Reflect.get(targetTx, property, targetTx)
        if (['portfolio', 'tenant', 'business', 'workspace'].includes(property)) {
          return new Proxy(delegate, {
            get(model, method) {
              if (method === 'create') {
                return async (args) => {
                  const row = await Reflect.get(model, method, model).call(model, args)
                  captured[`${String(property)}Id`] = row.id
                  return row
                }
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

    await expect(createBusinessInGroup({ name: `Rollback ${key}`, code: businessCode }, {
      viewer: target.ownerViewer,
      db,
    })).rejects.toThrow(`INJECTED_CONFIG_${failurePoint === 'config' ? 'WRITE' : 'AUDIT'}_FAILURE`)

    expect(await prisma.portfolio.count({ where: { id: captured.portfolioId } })).toBe(0)
    expect(await prisma.tenant.count({ where: { id: captured.tenantId } })).toBe(0)
    expect(await prisma.business.count({ where: { id: captured.businessId } })).toBe(0)
    expect(await prisma.workspace.count({ where: { businessId: captured.businessId } })).toBe(0)
    expect(await prisma.membership.count({ where: { tenantId: captured.tenantId } })).toBe(0)
    expect(await prisma.businessAgentConfig.count({ where: { businessId: captured.businessId } })).toBe(0)
    expect(await prisma.auditEvent.count({ where: { businessId: captured.businessId, action: 'AGENT_CONFIG_APPLIED' } }))
      .toBe(0)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'MEMBERSHIP', tenantId: captured.tenantId, action: 'MEMBERSHIP_GRANTED' },
    })).toBe(0)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'PORTFOLIO', entityId: captured.portfolioId, action: 'CREATED' },
    })).toBe(0)
  })
})

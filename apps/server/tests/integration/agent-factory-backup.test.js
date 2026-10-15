import { randomUUID } from 'node:crypto'
// @req FR-285 — persisted config and attributed apply audit survive the
// existing operator-authorized installation snapshot round trip.
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { grantBusinessMembership } from '@/modules/identity/membership-grant-service'
import {
  applyBusinessAgentTemplate,
} from '@/modules/agent/business-agent-factory'
import {
  exportSnapshot,
  importSnapshot,
  previewImport,
  SNAPSHOT_MODELS,
} from '@/modules/project-manager/application/backup-service'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'

function suffix() {
  return randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
}

async function createOwnedBusiness() {
  const key = suffix()
  const portfolio = await prisma.portfolio.create({ data: { code: `PBA-${key}`, name: `Agent backup ${key}` } })
  const tenant = await prisma.tenant.create({
    data: { code: `TBA-${key}`, name: `Agent backup ${key}`, portfolioId: portfolio.id },
  })
  const business = await prisma.business.create({
    data: { code: `BBA-${key}`, name: `Agent backup ${key}`, tenantId: tenant.id },
  })
  const owner = await prisma.person.create({ data: { code: `OBA-${key}`, displayName: `Owner ${key}` } })
  await grantBusinessMembership({
    personId: owner.id,
    tenantId: tenant.id,
    businessId: business.id,
    scopeType: 'BUSINESS',
    role: 'OWNER',
    actorId: owner.id,
  })
  const viewer = makeViewer({
    role: 'OWNER',
    visibleBusinessIds: [business.id],
    ownedBusinessIds: [business.id],
    principal: { id: owner.id, code: owner.code, displayName: owner.displayName },
  })
  return { tenant, business, owner, viewer }
}

describe('FR-285 Business agent backup round trip', () => {
  it('restores the scoped config and original attributed audit without applying it again', async () => {
    const { tenant, business, owner, viewer } = await createOwnedBusiness()

    const applied = await applyBusinessAgentTemplate(business.id, { viewer })
    expect(applied.status).toBe('APPLIED')
    const original = await prisma.businessAgentConfig.findUnique({ where: { businessId: business.id } })
    const originalAudit = await prisma.auditEvent.findFirst({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'AGENT_CONFIG_APPLIED' },
    })
    expect(originalAudit).toMatchObject({
      actorId: owner.id,
      tenantId: tenant.id,
      businessId: business.id,
    })

    const snapshot = await exportSnapshot()
    const modelOrder = SNAPSHOT_MODELS.indexOf('businessAgentConfig')
    expect(modelOrder).toBeGreaterThan(SNAPSHOT_MODELS.indexOf('business'))
    expect(snapshot.tables.businessAgentConfig).toContainEqual(original)
    expect(snapshot.tables.auditEvent).toContainEqual(originalAudit)
    expect(original).toMatchObject({ tenantId: tenant.id, businessId: business.id, version: 1 })

    // Remove both source rows so the round trip proves recovery from the
    // artifact, rather than merely observing the still-live configuration.
    await prisma.businessAgentConfig.delete({ where: { id: original.id } })
    await prisma.auditEvent.delete({ where: { id: originalAudit.id } })
    expect(await prisma.businessAgentConfig.findUnique({ where: { businessId: business.id } })).toBeNull()
    expect(await prisma.auditEvent.count({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'AGENT_CONFIG_APPLIED' },
    })).toBe(0)

    const restored = await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })
    expect(restored.restored).toBe(true)

    const restoredConfig = await prisma.businessAgentConfig.findUnique({ where: { businessId: business.id } })
    expect(restoredConfig).toMatchObject({
      id: original.id,
      tenantId: tenant.id,
      businessId: business.id,
      version: original.version,
      schemaVersion: original.schemaVersion,
      templateId: original.templateId,
      templateVersion: original.templateVersion,
      delegationPolicy: original.delegationPolicy,
      snapshotJson: original.snapshotJson,
      snapshotDigest: original.snapshotDigest,
      appliedByPersonId: owner.id,
      appliedAt: original.appliedAt,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    })

    const restoredAudits = await prisma.auditEvent.findMany({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'AGENT_CONFIG_APPLIED' },
    })
    expect(restoredAudits).toHaveLength(1)
    expect(restoredAudits[0]).toEqual(originalAudit)
  })

  it('refuses legacy replacement of live config and records the authorized preview', async () => {
    const { business, owner, viewer } = await createOwnedBusiness()
    const legacySnapshot = await exportSnapshot()
    delete legacySnapshot.tables.businessAgentConfig

    const applied = await applyBusinessAgentTemplate(business.id, { viewer })
    expect(applied.status).toBe('APPLIED')
    const original = await prisma.businessAgentConfig.findUnique({ where: { businessId: business.id } })
    const originalAudit = await prisma.auditEvent.findFirst({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'AGENT_CONFIG_APPLIED' },
    })
    const previewUseBefore = await prisma.auditEvent.count({
      where: { entityType: 'PERSON', action: 'OPERATOR_ACTION', payloadJson: { contains: '"action":"BACKUP_PREVIEW"' } },
    })
    const preview = await previewImport(legacySnapshot, { viewer: makeOperatorViewer() })
    expect(preview).toMatchObject({ valid: false, errorCode: 'BACKUP_BUSINESS_AGENT_CONFIG_RECOVERY_UNAVAILABLE' })
    expect(await prisma.auditEvent.count({
      where: { entityType: 'PERSON', action: 'OPERATOR_ACTION', payloadJson: { contains: '"action":"BACKUP_PREVIEW"' } },
    })).toBe(previewUseBefore + 1)

    const restoreUseBefore = await prisma.auditEvent.count({
      where: { entityType: 'OPERATOR_ACTION', action: 'BACKUP_RESTORE' },
    })
    const result = await importSnapshot(legacySnapshot, { confirm: true, viewer: makeOperatorViewer() })
    expect(result).toMatchObject({ restored: false, errorCode: 'BACKUP_BUSINESS_AGENT_CONFIG_RECOVERY_UNAVAILABLE' })
    expect(await prisma.auditEvent.count({
      where: { entityType: 'OPERATOR_ACTION', action: 'BACKUP_RESTORE' },
    })).toBe(restoreUseBefore)
    expect(await prisma.businessAgentConfig.findUnique({ where: { businessId: business.id } })).toEqual(original)
    expect(await prisma.auditEvent.findUnique({ where: { id: originalAudit.id } })).toEqual(originalAudit)
    expect(original.appliedByPersonId).toBe(owner.id)
  })

  it('rechecks omitted config recovery inside the replacement transaction', async () => {
    const { business, viewer } = await createOwnedBusiness()
    const legacySnapshot = await exportSnapshot()
    delete legacySnapshot.tables.businessAgentConfig

    const originalTransaction = prisma.$transaction.bind(prisma)
    let injected = false
    const guardedDb = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === 'businessAgentConfig') {
          const delegate = Reflect.get(target, property, receiver)
          return new Proxy(delegate, {
            get(model, method, modelReceiver) {
              if (method === 'count' && !injected) return async () => 0
              const value = Reflect.get(model, method, modelReceiver)
              return typeof value === 'function' ? value.bind(model) : value
            },
          })
        }
        if (property === '$transaction') {
          return async (callback, options) => {
            if (options?.timeout === 120_000 && !injected) {
              expect(options.isolationLevel).toBe('Serializable')
              const applied = await applyBusinessAgentTemplate(business.id, { viewer })
              expect(applied.status).toBe('APPLIED')
              injected = true
            }
            return originalTransaction(callback, options)
          }
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const restoreUseBefore = await prisma.auditEvent.count({
      where: { entityType: 'OPERATOR_ACTION', action: 'BACKUP_RESTORE' },
    })

    const result = await importSnapshot(legacySnapshot, {
      confirm: true,
      viewer: makeOperatorViewer(),
      db: guardedDb,
    })
    expect(injected).toBe(true)
    expect(result).toMatchObject({ restored: false, errorCode: 'BACKUP_BUSINESS_AGENT_CONFIG_LIVE_DATA_APPEARED' })
    expect(await prisma.businessAgentConfig.count({ where: { businessId: business.id } })).toBe(1)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'AGENT_CONFIG_APPLIED' },
    })).toBe(1)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'OPERATOR_ACTION', action: 'BACKUP_RESTORE' },
    })).toBe(restoreUseBefore)
  })
})

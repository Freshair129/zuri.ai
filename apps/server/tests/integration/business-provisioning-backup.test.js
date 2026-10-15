// @req FR-286 — template metadata, Space identity and original audit recover
// together; omitted legacy fields never authorize erasure of live evidence.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusinessInGroup } from '@/modules/project-manager/application/scope-service'
import { exportSnapshot, importSnapshot, previewImport, previewSnapshot } from '@/modules/project-manager/application/backup-service'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'

const markerFields = ['provisioningTemplateId', 'provisioningTemplateVersion', 'provisioningTemplateDigest', 'provisioningSnapshotJson']
const previewUse = () => prisma.auditEvent.count({ where: {
  entityType: 'PERSON', action: 'OPERATOR_ACTION', payloadJson: { contains: '"action":"BACKUP_PREVIEW"' },
} })

async function provision() {
  const key = randomUUID().replaceAll('-', '').slice(0, 12)
  const actor = await prisma.person.create({ data: { code: `PB-${key}`, displayName: `Backup ${key}` } })
  return createBusinessInGroup({ name: `Business ${key}`, code: `BB-${key}` }, {
    viewer: makeViewer({ principal: actor }),
  })
}

function legacy(snapshot) {
  const copy = structuredClone(snapshot)
  for (const business of copy.tables.business) for (const field of markerFields) delete business[field]
  for (const workspace of copy.tables.workspace) delete workspace.provisioningKey
  return copy
}

describe('FR-286 standard Business template backup', () => {
  it('round trips edited Business and Space values plus the original template audit without provisioning again', async () => {
    const target = await provision()
    await prisma.business.update({ where: { id: target.business.id }, data: {
      name: 'Edited business', capabilitiesJson: '{"physicalStock":false}', knowledgeCandidatesEnabled: true,
    } })
    await prisma.workspace.update({ where: { id: target.workspace.id }, data: { name: 'Edited Space', status: 'ARCHIVED', version: { increment: 1 } } })
    const originalBusiness = await prisma.business.findUnique({ where: { id: target.business.id } })
    const originalWorkspace = await prisma.workspace.findUnique({ where: { id: target.workspace.id } })
    const originalAudit = await prisma.auditEvent.findFirst({ where: { entityId: target.business.id, action: 'BUSINESS_TEMPLATE_APPLIED' } })
    expect(originalAudit).toMatchObject({ tenantId: target.tenant.id, businessId: target.business.id })
    expect(originalAudit.actorId).toBeTruthy()
    const snapshot = await exportSnapshot()
    expect(previewSnapshot(snapshot)).toMatchObject({ valid: true, businessProvisioningRecovery: { status: 'AVAILABLE' } })
    await prisma.business.update({ where: { id: target.business.id }, data: Object.fromEntries(markerFields.map(field => [field, null])) })
    await prisma.workspace.update({ where: { id: target.workspace.id }, data: { provisioningKey: null } })
    await prisma.auditEvent.delete({ where: { id: originalAudit.id } })
    expect(await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })).toMatchObject({ restored: true })
    expect(await prisma.business.findUnique({ where: { id: target.business.id } })).toEqual(originalBusiness)
    expect(await prisma.workspace.findUnique({ where: { id: target.workspace.id } })).toEqual(originalWorkspace)
    expect(await prisma.auditEvent.findMany({ where: { entityId: target.business.id, action: 'BUSINESS_TEMPLATE_APPLIED' } })).toEqual([originalAudit])
  })

  it('refuses legacy omitted fields and records authorized preview use without erasing live values', async () => {
    const target = await provision()
    const snapshot = legacy(await exportSnapshot())
    const before = await prisma.business.findUnique({ where: { id: target.business.id } })
    const uses = await previewUse()
    const preview = await previewImport(snapshot, { viewer: makeOperatorViewer() })
    expect(preview).toMatchObject({ valid: false, errorCode: 'BACKUP_BUSINESS_PROVISIONING_RECOVERY_UNAVAILABLE' })
    expect(await previewUse()).toBe(uses + 1)
    expect(await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })).toMatchObject({ restored: false, errorCode: 'BACKUP_BUSINESS_PROVISIONING_RECOVERY_UNAVAILABLE' })
    expect(await prisma.business.findUnique({ where: { id: target.business.id } })).toEqual(before)
    expect(await prisma.workspace.findUnique({ where: { id: target.workspace.id } })).toMatchObject({ provisioningKey: 'STANDARD_DEFAULT' })
  })

  it.each(['digest', 'ancestry', 'portfolio', 'key', 'partial'])('refuses corrupt %s in an incoming snapshot before replacement', async (defect) => {
    const target = await provision()
    const snapshot = await exportSnapshot()
    const business = snapshot.tables.business.find(row => row.id === target.business.id)
    const workspace = snapshot.tables.workspace.find(row => row.id === target.workspace.id)
    if (defect === 'digest') business.provisioningTemplateDigest = '0'.repeat(64)
    if (defect === 'ancestry') workspace.tenantId = 'wrong-tenant'
    if (defect === 'portfolio') snapshot.tables.portfolio = snapshot.tables.portfolio.filter(row => row.id !== target.portfolio.id)
    if (defect === 'key') workspace.provisioningKey = 'UNAPPROVED'
    if (defect === 'partial') delete business.provisioningSnapshotJson
    const uses = await previewUse()
    expect(await previewImport(snapshot, { viewer: makeOperatorViewer() })).toMatchObject({ valid: false, errorCode: 'BACKUP_BUSINESS_PROVISIONING_RECOVERY_INVALID' })
    expect(await previewUse()).toBe(uses + 1)
    expect(await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })).toMatchObject({ restored: false, errorCode: 'BACKUP_BUSINESS_PROVISIONING_RECOVERY_INVALID' })
    expect(await prisma.business.findUnique({ where: { id: target.business.id } })).toMatchObject({ provisioningTemplateId: 'standard-business' })
  })

  it('rechecks legacy field omissions inside the Serializable replacement transaction before any delete', async () => {
    const snapshot = legacy(await exportSnapshot())
    const originalTransaction = prisma.$transaction.bind(prisma)
    let injected = null
    let deleteCount = 0
    const db = new Proxy(prisma, { get(target, property, receiver) {
      if (property === 'business' || property === 'workspace') {
        const delegate = Reflect.get(target, property, receiver)
        return new Proxy(delegate, { get(model, method, modelReceiver) {
          if (method === 'count') return async (args) => args?.where ? 0 : model.count(args)
          const value = Reflect.get(model, method, modelReceiver)
          return typeof value === 'function' ? value.bind(model) : value
        } })
      }
      if (property === '$transaction') return async (callback, options) => {
        if (options?.timeout !== 120_000) return originalTransaction(callback, options)
        expect(options.isolationLevel).toBe('Serializable')
        injected = await provision()
        return originalTransaction(tx => callback(new Proxy(tx, { get(transaction, key) {
          const value = Reflect.get(transaction, key, transaction)
          if (!value || typeof value !== 'object') return value
          return new Proxy(value, { get(model, method) {
            const fn = Reflect.get(model, method, model)
            if (method === 'deleteMany' || method === 'delete') return (...args) => { deleteCount++; return fn.apply(model, args) }
            return typeof fn === 'function' ? fn.bind(model) : fn
          } })
        } })), options)
      }
      return Reflect.get(target, property, receiver)
    } })
    expect(await importSnapshot(snapshot, { db, confirm: true, viewer: makeOperatorViewer() })).toMatchObject({ restored: false, errorCode: 'BACKUP_BUSINESS_PROVISIONING_LIVE_DATA_APPEARED' })
    expect(injected).not.toBeNull()
    expect(deleteCount).toBe(0)
    expect(await prisma.business.findUnique({ where: { id: injected.business.id } })).toMatchObject({ provisioningTemplateId: 'standard-business' })
  })

  it('distinguishes explicit null replacement from omitted legacy fields', async () => {
    const snapshot = await exportSnapshot()
    for (const business of snapshot.tables.business) for (const field of markerFields) business[field] = null
    for (const workspace of snapshot.tables.workspace) workspace.provisioningKey = null
    expect(await previewImport(snapshot, { viewer: makeOperatorViewer() })).toMatchObject({ valid: true, wouldReplace: true, businessProvisioningRecovery: { status: 'AVAILABLE' } })
    expect(await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })).toMatchObject({ restored: true })
    expect(await prisma.business.count({ where: { provisioningTemplateId: { not: null } } })).toBe(0)
    expect(await prisma.workspace.count({ where: { provisioningKey: { not: null } } })).toBe(0)
    const older = legacy(await exportSnapshot())
    expect(await previewImport(older, { viewer: makeOperatorViewer() })).toMatchObject({ valid: true, businessProvisioningRecovery: { status: 'UNAVAILABLE' } })
    expect(await importSnapshot(older, { confirm: true, viewer: makeOperatorViewer() })).toMatchObject({ restored: true })
    expect(await prisma.business.count({ where: { provisioningTemplateId: { not: null } } })).toBe(0)
  })

  it('treats explicit empty Business and Workspace arrays as complete replacement evidence', async () => {
    const snapshot = await exportSnapshot()
    snapshot.tables.business = []
    snapshot.tables.workspace = []
    // Other protected-family and FK checks still apply to an actual restore;
    // empty arrays themselves are explicit data, not missing legacy columns.
    expect(previewSnapshot(snapshot)).toMatchObject({ businessProvisioningRecovery: { status: 'AVAILABLE' } })
  })
})

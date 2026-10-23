import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness } from '@/modules/identity/viewer-authority'

// @req FR-291 — Business owners explicitly version a per-account, per-SKU
// LINE availability disclosure policy; absence is disabled and price is separate.
// @tested tests/integration/line-stock-disclosure-policy.test.js

const inputSchema = z.object({
  businessId: z.string().trim().min(1).max(200),
  lineOaAccountId: z.string().trim().min(1).max(200),
  productId: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  expectedVersion: z.number().int().nonnegative().safe(),
  reason: z.string().trim().min(1).max(2000),
}).strict()

const notFound = () => Object.assign(new Error('Business or resource not found'), { status: 404, code: 'LINE_STOCK_POLICY_NOT_FOUND' })
const conflict = () => Object.assign(new Error('Line stock policy changed'), { status: 409, code: 'LINE_STOCK_POLICY_VERSION_CONFLICT' })

/** Set one explicit LINE stock-disclosure grant using owner-only version CAS. */
export async function setLineStockDisclosurePolicy(input, { viewer, db = prisma, now = new Date() } = {}) {
  const value = inputSchema.parse(input)
  if (!ownsBusiness(viewer, value.businessId)) throw notFound()
  const actorPersonId = typeof viewer?.principal?.id === 'string' && viewer.principal.id.trim() ? viewer.principal.id.trim() : null
  if (!actorPersonId) throw notFound()
  const at = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(at.valueOf())) throw Object.assign(new Error('Invalid policy time'), { status: 400, code: 'LINE_STOCK_POLICY_TIME_INVALID' })

  try {
    return await db.$transaction(async (tx) => {
    const business = await tx.business.findUnique({ where: { id: value.businessId }, select: { id: true, tenantId: true, status: true } })
    if (!business) throw notFound()
    const account = await tx.lineOaAccount.findFirst({ where: {
      id: value.lineOaAccountId, tenantId: business.tenantId, businessId: business.id, archivedAt: null,
    }, select: { id: true, tenantId: true, businessId: true, serverEnabled: true, transportMode: true, status: true } })
    const product = await tx.product.findFirst({ where: {
      id: value.productId, tenantId: business.tenantId, businessId: business.id,
    }, select: { id: true, tenantId: true, businessId: true, status: true } })
    if (!account || !product) throw notFound()
    if (value.enabled && (business.status !== 'ACTIVE' || account.serverEnabled !== true
      || account.transportMode !== 'CLOUD' || account.status !== 'CONNECTED' || product.status !== 'ACTIVE')) {
      throw notFound()
    }

    const where = { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: business.tenantId, businessId: business.id,
      lineOaAccountId: account.id, productId: product.id,
    } }
    const current = await tx.lineStockDisclosurePolicy.findUnique({ where })
    if (value.expectedVersion === 0) {
      if (current) throw conflict()
      const row = await tx.lineStockDisclosurePolicy.create({ data: {
        tenantId: business.tenantId, businessId: business.id,
        lineOaAccountId: account.id, productId: product.id, enabled: value.enabled,
        version: 1, reason: value.reason, createdByPersonId: actorPersonId,
        updatedByPersonId: actorPersonId, createdAt: at, updatedAt: at,
      } })
      await auditPolicyChange(tx, row, value, viewer)
      return row
    }
    if (!current || current.version !== value.expectedVersion) throw conflict()
    const updated = await tx.lineStockDisclosurePolicy.updateMany({
      where: { id: current.id, tenantId: business.tenantId, businessId: business.id, version: value.expectedVersion },
      data: { enabled: value.enabled, reason: value.reason, updatedByPersonId: actorPersonId, updatedAt: at, version: { increment: 1 } },
    })
    if (updated.count !== 1) throw conflict()
    const row = await tx.lineStockDisclosurePolicy.findUnique({ where: { id: current.id } })
    await auditPolicyChange(tx, row, value, viewer)
    return row
    })
  } catch (error) {
    // A concurrent first grant can pass the absence check in both transactions;
    // let the unique constraint choose the winner, then translate the loser
    // after Prisma has rolled back the transaction.
    if (value.expectedVersion === 0 && error?.code === 'P2002') throw conflict()
    throw error
  }
}

async function auditPolicyChange(tx, row, value, viewer) {
  await recordAudit(tx, {
    entityType: 'LINE_STOCK_DISCLOSURE_POLICY', entityId: row.id,
    action: row.enabled ? 'LINE_STOCK_DISCLOSURE_ENABLED' : 'LINE_STOCK_DISCLOSURE_DISABLED',
    actorId: viewer.principal?.id ?? null, tenantId: row.tenantId, businessId: row.businessId,
    reason: value.reason,
    payload: { lineOaAccountId: row.lineOaAccountId, productId: row.productId, enabled: row.enabled, version: row.version },
  })
}

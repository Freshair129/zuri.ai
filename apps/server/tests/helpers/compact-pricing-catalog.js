// @req FR-253 — actual domain prerequisites for the owned TEST storage consumer.
// @spec ADR-115, ADR-098
// @tested tests/storage/compact-business-objects.test.js
import { randomUUID } from 'node:crypto'
import { makeViewer } from '../factories/viewer'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { defaultPricingRules } from '@/modules/commerce/domain/pricing-engine'
import { createPricingRuleSet, applyPricingRuleAction } from '@/modules/commerce/application/pricing-rules-service'

export async function compactPricingCatalogFixture({ db, business, storageEnv }) {
  const tag = randomUUID().slice(0, 8), now = new Date(Date.now() - 60000)
  const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['commerce', 'inventory', 'knowledge'] })
  const options = { db, viewer: owner, now }
  const draft = await createPricingRuleSet({ businessId: business.id, name: `Compact TEST ${tag}`, rules: defaultPricingRules() }, options)
  const approved = await applyPricingRuleAction(draft.id, { businessId: business.id, version: draft.version, action: 'APPROVE', expiresAt: new Date(now.getTime() + 3600000).toISOString(), reason: 'TEST owner reviewed prices' }, options)
  const category = await createCategory({ businessId: business.id, code: `C4-CAT-${tag}`, nameTh: 'สินค้าทดสอบ', nameEn: 'Compact TEST' }, options)
  const master = await createProductMaster({ businessId: business.id, categoryId: category.id, code: `C4-PM-${tag}`, nameTh: 'สินค้าทดสอบ', nameEn: 'Compact TEST' }, options)
  const product = await createProduct({ businessId: business.id, productMasterId: master.id, code: `C4-SKU-${tag}`, name: 'Compact TEST' }, options)
  await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 200, costSatang: 10000 }, options)
  const tenant = await db.tenant.findUnique({ where: { id: business.tenantId } })
  const scope = { portfolioId: tenant.portfolioId, tenantId: tenant.id, businessId: business.id, workspaceId: `compact-test-workspace-${tag}`, agentId: `compact-test-agent-${tag}`, visibility: 'private' }
  // This inert binding admits durable jobs only. No worker/model/process runs.
  const env = { ...storageEnv, ZURI_KNOWLEDGE_ENABLED: '1', ZURI_KNOWLEDGE_STORAGE_ENABLED: '1', ZURI_KNOWLEDGE_BINDINGS: JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }]), MSP_PIPELINE_PRINCIPALS: JSON.stringify([{ role: 'source', credential: `synthetic-compact-catalog-${tag}`, scope }]), ZURI_MSP_COMMAND: process.execPath }
  return { owner, now, env, product, request: { businessId: business.id, productId: product.id, expectedRuleSetId: approved.id, expectedRuleVersion: approved.version, quantities: [100, 300], reason: 'TEST owner reviewed computed catalog', idempotencyKey: `compact-catalog-${tag}` } }
}

// Local provider conformance (ADR-108 D4, delegated Q11): seed MARKET_INTELLIGENCE raw
// evidence into a DISPOSABLE SQLite database. Refuses any DATABASE_URL outside
// CONFORMANCE_DIR, so it cannot touch a real database.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const dir = (process.env.CONFORMANCE_DIR || '').replace(/\\/g, '/')
const url = process.env.DATABASE_URL || ''
if (!dir || !url.startsWith('file:') || !url.includes(dir)) {
  throw new Error('refusing: DATABASE_URL must be a sqlite file inside CONFORMANCE_DIR')
}

const require = createRequire(new URL('../../../apps/server/package.json', import.meta.url))
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const business = await prisma.business.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true, name: true } })
if (!business) throw new Error('seed produced no Business')
const provider = await prisma.integrationProvider.upsert({
  where: { code: 'MARKET_TEST' },
  update: {},
  create: { code: 'MARKET_TEST', name: 'Market test provider' },
})
const connection = await prisma.integrationConnection.create({
  data: { tenantId: business.tenantId, businessId: business.id, providerId: provider.id, name: 'Conformance market test', status: 'ACTIVE' },
})
const payloads = [
  { entityType: 'listing', externalId: 'listing-1', body: { title: 'GALAX RTX 3060 12GB', price: 4900, currency: 'THB', sellerName: 'Shop 1' } },
  { entityType: 'retail_price', externalId: 'sku-9', body: { productName: 'Thai Jasmine Rice 5kg', sku: 'RICE-5', unitPrice: 245, currency: 'THB' } },
  { entityType: 'listing', externalId: 'listing-2', body: { name: 'Used GPU', seller: 'someone', condition: 'used' } },
]
let day = 1
for (const item of payloads) {
  const payloadJson = JSON.stringify(item.body)
  await prisma.rawExternalRecord.create({
    data: {
      tenantId: business.tenantId,
      businessId: business.id,
      connectionId: connection.id,
      provider: 'MARKET_TEST',
      lane: 'MARKET_INTELLIGENCE',
      entityType: item.entityType,
      externalId: item.externalId,
      sourceType: 'PULL',
      sourceUri: null,
      schemaVersion: 'market.test.v1',
      payloadJson,
      payloadHash: createHash('sha256').update(payloadJson).digest('hex'),
      idempotencyKey: `conformance:${item.externalId}`,
      receivedAt: new Date(`2026-09-0${day++}T03:00:00.000Z`),
    },
  })
}
process.stdout.write(`${JSON.stringify({ businessId: business.id, tenantId: business.tenantId, raw: payloads.length })}\n`)
await prisma.$disconnect()

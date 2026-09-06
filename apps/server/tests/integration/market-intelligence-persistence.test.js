import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { loadTranslateAndPersistRawMarketRecord } from '@/modules/market-intelligence/application/market-observation-service'
import { createMarketObservationRepository } from '@/modules/market-intelligence/infrastructure/market-observation-repository'
import { createMarketRawRecordRepository } from '@/modules/market-intelligence/infrastructure/market-raw-record-repository'

const suffix = () => randomUUID().slice(0, 8).toUpperCase()

async function createFixture() {
  const token = suffix()
  const portfolio = await createPortfolio({
    name: `Market P1 ${token}`,
    code: `PF-MKT-${token}`,
  })
  const tenant = await createTenant({
    portfolioId: portfolio.id,
    name: `Market Tenant ${token}`,
    code: `TNT-MKT-${token}`,
  })
  const business = await createBusiness({
    tenantId: tenant.id,
    name: `Market Business ${token}`,
    code: `BUS-MKT-${token}`,
  })
  const provider = await prisma.integrationProvider.create({
    data: {
      code: `MARKET_TEST_${token}`,
      name: 'Market test source',
      status: 'ACTIVE',
    },
  })
  const connection = await prisma.integrationConnection.create({
    data: {
      tenantId: tenant.id,
      businessId: business.id,
      providerId: provider.id,
      name: 'Market test connection',
      authorizationType: 'NONE',
      status: 'ACTIVE',
    },
  })
  const payloadHash = 'a'.repeat(64)
  const raw = await prisma.rawExternalRecord.create({
    data: {
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: connection.id,
      provider: provider.code,
      lane: 'MARKET_INTELLIGENCE',
      entityType: 'LISTING',
      externalId: `listing-${token}`,
      sourceType: 'PULL',
      sourceUri: `https://market.example/listing/${token}`,
      schemaVersion: 'market.test.listing.v1',
      payloadJson: JSON.stringify({ title: 'RTX 3060 12GB', price: 4900 }),
      payloadHash,
      idempotencyKey: token.toLowerCase().padEnd(64, '0').slice(0, 64),
      receivedAt: new Date('2026-08-20T00:00:00.000Z'),
    },
  })

  return { tenant, business, provider, connection, raw }
}

const extractCandidate = async ({ payload }) => ({
  observationType: 'EXTERNAL_OFFER',
  candidate: {
    title: payload.title,
    price: payload.price,
    currency: 'THB',
  },
})

describe('Market Intelligence Prisma persistence (#76 / FR-092)', () => {
  it('persists one observation and returns UNCHANGED on replay without mutating raw evidence', async () => {
    const { tenant, business, provider, connection, raw } = await createFixture()
    const beforeRaw = await prisma.rawExternalRecord.findUnique({ where: { id: raw.id } })

    const rawRepository = createMarketRawRecordRepository(prisma, {
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: connection.id,
      provider: provider.code,
    })
    const repository = createMarketObservationRepository(prisma, {
      tenantId: tenant.id,
      businessId: business.id,
    })

    const first = await loadTranslateAndPersistRawMarketRecord(raw.id, {
      rawRepository,
      repository,
      extractCandidate,
      now: () => new Date('2026-08-20T00:01:00.000Z'),
    })
    const replay = await loadTranslateAndPersistRawMarketRecord(raw.id, {
      rawRepository,
      repository,
      extractCandidate,
      now: () => new Date('2026-08-20T00:02:00.000Z'),
    })

    expect(first.status).toBe('CREATED')
    expect(replay.status).toBe('UNCHANGED')
    expect(replay.observation.id).toBe(first.observation.id)
    expect(first.observation).toMatchObject({
      tenantId: tenant.id,
      businessId: business.id,
      rawRecordId: raw.id,
      connectionId: connection.id,
      provider: provider.code,
      observationType: 'EXTERNAL_OFFER',
      resolutionStatus: 'UNRESOLVED',
    })
    expect(await prisma.marketObservation.count({
      where: { lineageKey: first.observation.lineageKey },
    })).toBe(1)

    const afterRaw = await prisma.rawExternalRecord.findUnique({ where: { id: raw.id } })
    expect(afterRaw).toEqual(beforeRaw)
  })

  it('cannot translate a raw record hidden by a different Business scope', async () => {
    const { tenant, business, provider, connection, raw } = await createFixture()
    const otherBusiness = await createBusiness({
      tenantId: tenant.id,
      name: `Other Market Business ${suffix()}`,
      code: `BUS-MKT-O-${suffix()}`,
    })

    const rawRepository = createMarketRawRecordRepository(prisma, {
      tenantId: tenant.id,
      businessId: otherBusiness.id,
      connectionId: connection.id,
      provider: provider.code,
    })
    const repository = createMarketObservationRepository(prisma, {
      tenantId: tenant.id,
      businessId: otherBusiness.id,
    })

    const result = await loadTranslateAndPersistRawMarketRecord(raw.id, {
      rawRepository,
      repository,
      extractCandidate,
    })

    expect(result).toEqual({ status: 'NOT_FOUND', observation: null })
    expect(await prisma.marketObservation.count({ where: { rawRecordId: raw.id } })).toBe(0)
    expect(business.id).not.toBe(otherBusiness.id)
  })
})

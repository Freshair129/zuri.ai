import { describe, expect, it, vi } from 'vitest'

import { createMarketObservationRepository } from '@/modules/market-intelligence/infrastructure/market-observation-repository'

function createPrisma() {
  return {
    marketObservation: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({ id: 'obs-1', ...data })),
    },
  }
}

const draft = {
  tenantId: 'tenant-a',
  businessId: 'business-a',
  lineageKey: 'lineage-1',
}

describe('MarketObservation scoped repository adapter (#76)', () => {
  it('binds lookup to the trusted repository scope', async () => {
    const prisma = createPrisma()
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    await repository.findByLineageKey('lineage-1')

    expect(prisma.marketObservation.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        businessId: 'business-a',
        lineageKey: 'lineage-1',
      },
    })
  })

  it('refuses a draft that tries to widen tenant scope', async () => {
    const prisma = createPrisma()
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    await expect(
      repository.insert({ ...draft, tenantId: 'tenant-evil' }),
    ).rejects.toThrow(/tenant scope mismatch/i)

    expect(prisma.marketObservation.create).not.toHaveBeenCalled()
  })

  it('refuses a draft that tries to widen business scope', async () => {
    const prisma = createPrisma()
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    await expect(
      repository.insert({ ...draft, businessId: 'business-evil' }),
    ).rejects.toThrow(/business scope mismatch/i)

    expect(prisma.marketObservation.create).not.toHaveBeenCalled()
  })

  it('allows an explicitly tenant-scoped observation only when repository scope is also null-business', async () => {
    const prisma = createPrisma()
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: null,
    })

    const result = await repository.insert({
      ...draft,
      businessId: null,
    })

    expect(result.businessId).toBeNull()
  })

  it('fails clearly before runtime when Prisma model is absent', () => {
    expect(() =>
      createMarketObservationRepository({}, {
        tenantId: 'tenant-a',
        businessId: 'business-a',
      }),
    ).toThrow(/model is not available/i)
  })
})

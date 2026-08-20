import { describe, expect, it, vi } from 'vitest'

import { createMarketObservationRepository } from '@/modules/market-intelligence/infrastructure/market-observation-repository'

function createPrisma() {
  return {
    marketObservation: {
      create: vi.fn(async ({ data }) => ({ id: 'obs-1', ...data })),
      findUnique: vi.fn(async ({ where }) => ({
        id: 'obs-existing',
        ...draft,
        lineageKey: where.lineageKey,
      })),
    },
  }
}

const draft = {
  tenantId: 'tenant-a',
  businessId: 'business-a',
  lineageKey: 'lineage-1',
}

describe('MarketObservation scoped repository adapter (#76)', () => {
  it('returns CREATED when this worker wins the unique insert', async () => {
    const prisma = createPrisma()
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    const result = await repository.insertIfAbsent(draft)

    expect(prisma.marketObservation.create).toHaveBeenCalledWith({ data: draft })
    expect(result.status).toBe('CREATED')
    expect(result.observation.id).toBe('obs-1')
    expect(prisma.marketObservation.findUnique).not.toHaveBeenCalled()
  })

  it('returns UNCHANGED after a concurrent unique conflict and loads the winning row', async () => {
    const prisma = createPrisma()
    prisma.marketObservation.create.mockRejectedValueOnce(
      Object.assign(new Error('unique constraint'), { code: 'P2002' }),
    )
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    const result = await repository.insertIfAbsent(draft)

    expect(prisma.marketObservation.findUnique).toHaveBeenCalledWith({
      where: { lineageKey: 'lineage-1' },
    })
    expect(result.status).toBe('UNCHANGED')
    expect(result.observation.id).toBe('obs-existing')
  })

  it('does not swallow a non-unique database error', async () => {
    const prisma = createPrisma()
    prisma.marketObservation.create.mockRejectedValueOnce(new Error('database unavailable'))
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    await expect(repository.insertIfAbsent(draft)).rejects.toThrow('database unavailable')
    expect(prisma.marketObservation.findUnique).not.toHaveBeenCalled()
  })

  it('refuses a draft that tries to widen tenant scope', async () => {
    const prisma = createPrisma()
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    await expect(
      repository.insertIfAbsent({ ...draft, tenantId: 'tenant-evil' }),
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
      repository.insertIfAbsent({ ...draft, businessId: 'business-evil' }),
    ).rejects.toThrow(/business scope mismatch/i)

    expect(prisma.marketObservation.create).not.toHaveBeenCalled()
  })

  it('allows explicitly null Business scope when repository is also null-Business', async () => {
    const prisma = createPrisma()
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: null,
    })

    const result = await repository.insertIfAbsent({
      ...draft,
      businessId: null,
    })

    expect(result.status).toBe('CREATED')
    expect(result.observation.businessId).toBeNull()
  })

  it('refuses a unique-conflict row that resolves outside trusted scope', async () => {
    const prisma = createPrisma()
    prisma.marketObservation.create.mockRejectedValueOnce(
      Object.assign(new Error('unique constraint'), { code: 'P2002' }),
    )
    prisma.marketObservation.findUnique.mockResolvedValueOnce({
      id: 'obs-evil',
      ...draft,
      tenantId: 'tenant-evil',
    })
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    await expect(repository.insertIfAbsent(draft)).rejects.toThrow(/outside repository scope/i)
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

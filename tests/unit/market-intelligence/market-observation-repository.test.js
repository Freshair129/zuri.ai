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

  // --- read side (FR-092 `/market` feed) -------------------------------------

  it('lists newest observation first, inside the constructed scope only', async () => {
    const prisma = createPrisma()
    prisma.marketObservation.findMany = vi.fn(async () => [
      { id: 'obs-2', tenantId: 'tenant-a', businessId: 'business-a' },
      { id: 'obs-1', tenantId: 'tenant-a', businessId: 'business-a' },
    ])
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    const rows = await repository.listRecent({ limit: 10 })

    expect(prisma.marketObservation.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', businessId: 'business-a' },
      orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
      take: 10,
    })
    expect(rows.map((row) => row.id)).toEqual(['obs-2', 'obs-1'])
  })

  it('caps the page size so a caller cannot ask the adapter for the whole table', async () => {
    const prisma = createPrisma()
    prisma.marketObservation.findMany = vi.fn(async () => [])
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    await repository.listRecent({ limit: 100000 })

    expect(prisma.marketObservation.findMany.mock.calls[0][0].take).toBe(200)
    await expect(repository.listRecent({ limit: 0 })).rejects.toThrow(/positive integer/i)
  })

  it('refuses a returned row that resolves outside trusted scope', async () => {
    // The `where` clause is not the only guard. A row whose tenant differs from the
    // one this repository was constructed with is an identity leak whatever produced
    // it, and the read path re-checks for the same reason the write path does.
    const prisma = createPrisma()
    prisma.marketObservation.findMany = vi.fn(async () => [
      { id: 'obs-ok', tenantId: 'tenant-a', businessId: 'business-a' },
      { id: 'obs-evil', tenantId: 'tenant-evil', businessId: 'business-a' },
    ])
    const repository = createMarketObservationRepository(prisma, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    await expect(repository.listRecent({ limit: 10 })).rejects.toThrow(/outside repository scope/i)
  })

  it('says so when the Prisma model cannot answer a list', async () => {
    const repository = createMarketObservationRepository(createPrisma(), {
      tenantId: 'tenant-a',
      businessId: 'business-a',
    })

    await expect(repository.listRecent()).rejects.toThrow(/findMany/i)
  })
})

import { describe, expect, it, vi } from 'vitest'

import { createMarketRawRecordRepository } from '@/modules/market-intelligence/infrastructure/market-raw-record-repository'

function createDb() {
  return {
    rawExternalRecord: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(),
    },
    business: { findUnique: vi.fn() },
    ingestionRun: { findUnique: vi.fn() },
  }
}

describe('Market raw-record repository scope (#76)', () => {
  it('requires Business scope to be explicit', () => {
    expect(() => createMarketRawRecordRepository(createDb(), {
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
    })).toThrow(/businessId must be explicit/i)
  })

  it('binds a Business-scoped market translation read', async () => {
    const db = createDb()
    const repository = createMarketRawRecordRepository(db, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
      connectionId: 'conn-a',
      provider: 'MARKET_TEST',
    })

    await repository.findById('raw-1')

    expect(db.rawExternalRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'raw-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-a',
        businessId: 'business-a',
        provider: 'MARKET_TEST',
      },
    })
  })

  it('allows explicitly tenant-scoped market evidence only when null is intentional', async () => {
    const db = createDb()
    const repository = createMarketRawRecordRepository(db, {
      tenantId: 'tenant-a',
      businessId: null,
      connectionId: 'conn-a',
    })

    await repository.findById('raw-1')

    expect(db.rawExternalRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'raw-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-a',
        businessId: null,
      },
    })
  })
})

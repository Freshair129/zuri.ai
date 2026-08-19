import { describe, expect, it, vi } from 'vitest'

import { createPrismaRawRecordRepository } from '@/platform/integrations/core/raw-record-repository'

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

describe('FR-081 scoped raw record read port', () => {
  it('loads by raw id only inside the repository tenant/connection/business/provider scope', async () => {
    const db = createDb()
    const repository = createPrismaRawRecordRepository(db, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
      connectionId: 'conn-a',
      ingestionRunId: 'run-a',
      provider: 'MARKET_TEST',
    })

    await repository.findById('raw-1')

    expect(db.rawExternalRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'raw-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-a',
        businessId: 'business-a',
        ingestionRunId: 'run-a',
        provider: 'MARKET_TEST',
      },
    })
  })

  it('uses the same scope predicate for idempotency lookup', async () => {
    const db = createDb()
    const repository = createPrismaRawRecordRepository(db, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
      connectionId: 'conn-a',
      provider: 'MARKET_TEST',
    })

    await repository.findByIdempotencyKey('idem-1')

    expect(db.rawExternalRecord.findFirst).toHaveBeenCalledWith({
      where: {
        idempotencyKey: 'idem-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-a',
        businessId: 'business-a',
        provider: 'MARKET_TEST',
      },
    })
  })

  it('does not silently turn null business scope into all-business access', async () => {
    const db = createDb()
    const repository = createPrismaRawRecordRepository(db, {
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
    })

    await repository.findById('raw-1')

    expect(db.rawExternalRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'raw-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-a',
      },
    })
  })

  it('requires a raw id for direct lookup', async () => {
    const db = createDb()
    const repository = createPrismaRawRecordRepository(db, {
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
    })

    await expect(repository.findById()).rejects.toThrow(/rawRecordId/i)
  })
})

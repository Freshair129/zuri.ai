import { describe, expect, it, vi } from 'vitest'

import {
  createMarketRawRecordRepository,
  listMarketLaneRawRecordCandidates,
  MARKET_RAW_RECORD_CANDIDATE_SCAN_LIMIT,
} from '@/modules/market-intelligence/infrastructure/market-raw-record-repository'

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

// --- listMarketLaneRawRecordCandidates (FR-092 production translation trigger) ----

function createRawFindManyDb(rows = []) {
  return { rawExternalRecord: { findMany: vi.fn(async () => rows) } }
}

describe('listMarketLaneRawRecordCandidates (FR-092)', () => {
  it('lists MARKET_INTELLIGENCE-lane raw records for the Business, across every connection, oldest first', async () => {
    const db = createRawFindManyDb([{ id: 'raw-1' }, { id: 'raw-2' }])

    const rows = await listMarketLaneRawRecordCandidates(db, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
      scanLimit: 10,
    })

    expect(db.rawExternalRecord.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', businessId: 'business-a', lane: 'MARKET_INTELLIGENCE' },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      take: 10,
    })
    expect(rows.map((row) => row.id)).toEqual(['raw-1', 'raw-2'])
  })

  it('defaults and caps the scan window so a caller cannot ask for the whole table', async () => {
    const db = createRawFindManyDb([])

    await listMarketLaneRawRecordCandidates(db, { tenantId: 'tenant-a', businessId: 'business-a' })
    expect(db.rawExternalRecord.findMany.mock.calls[0][0].take).toBe(MARKET_RAW_RECORD_CANDIDATE_SCAN_LIMIT)

    await listMarketLaneRawRecordCandidates(db, { tenantId: 'tenant-a', businessId: 'business-a', scanLimit: 1000000 })
    expect(db.rawExternalRecord.findMany.mock.calls[1][0].take).toBe(MARKET_RAW_RECORD_CANDIDATE_SCAN_LIMIT)
  })

  it('requires tenantId and businessId', async () => {
    const db = createRawFindManyDb([])

    await expect(listMarketLaneRawRecordCandidates(db, { businessId: 'business-a' })).rejects.toThrow(/tenantId/i)
    await expect(listMarketLaneRawRecordCandidates(db, { tenantId: 'tenant-a' })).rejects.toThrow(/businessId/i)
  })
})

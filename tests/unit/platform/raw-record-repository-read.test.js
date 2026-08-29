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

  it('preserves the existing tenant/connection-scoped semantics when businessId is omitted', async () => {
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

  it('requires a raw id for direct lookup', () => {
    const db = createDb()
    const repository = createPrismaRawRecordRepository(db, {
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
    })

    expect(() => repository.findById()).toThrow(/rawRecordId/i)
  })

  // FR-109 AC-109.3 — resolving a knowledge-ingestion run's artifact_id back
  // to the raw record FR-081 already stored.
  it('uses the same scope predicate for artifact id lookup', async () => {
    const db = createDb()
    const repository = createPrismaRawRecordRepository(db, {
      tenantId: 'tenant-a',
      businessId: 'business-a',
      connectionId: 'conn-a',
      provider: 'MARKET_TEST',
    })

    await repository.findByArtifactId('art-1')

    expect(db.rawExternalRecord.findFirst).toHaveBeenCalledWith({
      where: {
        artifactId: 'art-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-a',
        businessId: 'business-a',
        provider: 'MARKET_TEST',
      },
    })
  })

  it('requires an artifact id for artifact-id lookup', () => {
    const db = createDb()
    const repository = createPrismaRawRecordRepository(db, {
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
    })

    expect(() => repository.findByArtifactId()).toThrow(/artifactId/i)
  })
})

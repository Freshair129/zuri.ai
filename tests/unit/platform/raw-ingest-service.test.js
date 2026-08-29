import { describe, expect, it, vi } from 'vitest'

import { ingestRawExternalRecord } from '@/platform/integrations/core/raw-ingest-service'

const input = {
  tenantId: 'tenant-1',
  businessId: 'business-1',
  connectionId: 'connection-1',
  provider: 'FLOWACCOUNT',
  lane: 'ACCOUNTING',
  entityType: 'INVOICE',
  externalId: 'INV-1001',
  sourceType: 'PULL',
  schemaVersion: 'flowaccount.invoice.v1',
  payload: { invoiceNo: 'INV-1001', total: 1250 },
}

describe('raw ingestion service', () => {
  it('persists a new raw record and does not call a domain writer', async () => {
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockImplementation(async (row) => ({ id: 'raw-1', ...row })),
    }
    const domainWriter = vi.fn()

    const result = await ingestRawExternalRecord(input, {
      repository,
      domainWriter,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    })

    expect(result.status).toBe('CREATED')
    expect(result.rawRecord).toMatchObject({
      id: 'raw-1',
      tenantId: 'tenant-1',
      businessId: 'business-1',
      connectionId: 'connection-1',
      externalId: 'INV-1001',
      processingStatus: 'RECEIVED',
    })
    expect(repository.insert).toHaveBeenCalledTimes(1)
    expect(domainWriter).not.toHaveBeenCalled()
  })

  it('returns UNCHANGED for an identical replay without inserting twice', async () => {
    const stored = { id: 'raw-1', processingStatus: 'RECEIVED' }
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(stored),
      insert: vi.fn(),
    }

    const result = await ingestRawExternalRecord(input, {
      repository,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    })

    expect(result).toMatchObject({ status: 'UNCHANGED', rawRecord: stored })
    expect(repository.insert).not.toHaveBeenCalled()
  })

  it('fails closed when no repository is supplied', async () => {
    await expect(ingestRawExternalRecord(input)).rejects.toThrow(/repository/i)
  })

  // FR-109 AC-109.3 — a raw record fed into knowledge ingestion carries the
  // run's artifact_id, so the row is written with it.
  it('persists the artifact id when the caller names one', async () => {
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockImplementation(async (row) => ({ id: 'raw-1', ...row })),
    }

    await ingestRawExternalRecord({ ...input, artifactId: 'art-fr109-1' }, { repository })

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: 'art-fr109-1' }),
    )
  })

  it('writes a null artifact id when no caller names one', async () => {
    const repository = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockImplementation(async (row) => ({ id: 'raw-1', ...row })),
    }

    await ingestRawExternalRecord(input, { repository })

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: null }),
    )
  })
})

import { describe, expect, it } from 'vitest'

import {
  DATA_LANES,
  createIngestionEnvelope,
  zIngestionEnvelope,
} from '@/platform/integrations/core/contracts'
import { buildIdempotencyKey, hashPayload } from '@/platform/integrations/core/idempotency'

const baseInput = {
  tenantId: 'tenant-1',
  businessId: 'business-1',
  connectionId: 'connection-1',
  provider: 'FLOWACCOUNT',
  lane: 'ACCOUNTING',
  entityType: 'INVOICE',
  externalId: 'INV-1001',
  sourceType: 'PULL',
  schemaVersion: 'flowaccount.invoice.v1',
  payload: {
    invoiceNo: 'INV-1001',
    total: 1250,
    customer: { code: 'C-1', name: 'Acme' },
  },
  receivedAt: new Date('2026-08-18T00:00:00.000Z'),
}

describe('P1 integration contracts', () => {
  it('keeps business data lanes explicit and rejects an unknown lane', () => {
    expect(DATA_LANES).toEqual([
      'ACCOUNTING',
      'SALES',
      'PRODUCTION_SUPPLY',
      'MARKETING',
      'CUSTOMER',
      'BUSINESS',
      'MARKET_INTELLIGENCE',
    ])

    expect(zIngestionEnvelope.safeParse({ ...baseInput, lane: 'META_API' }).success).toBe(false)
  })

  it('accepts Market Intelligence as a first-class lane without creating a second ingestion contract', () => {
    const result = createIngestionEnvelope({
      ...baseInput,
      provider: 'MARKET_TEST',
      lane: 'MARKET_INTELLIGENCE',
      entityType: 'LISTING',
      externalId: 'LISTING-1',
      schemaVersion: 'market.test.listing.v1',
      payload: { title: 'RTX 3060', price: 4900 },
    })

    expect(result.lane).toBe('MARKET_INTELLIGENCE')
    expect(result.entityType).toBe('LISTING')
    expect(result.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
  })

  it('requires tenant and connection scope on every external record', () => {
    const missingScope = { ...baseInput }
    delete missingScope.tenantId
    expect(zIngestionEnvelope.safeParse(missingScope).success).toBe(false)

    const missingConnection = { ...baseInput }
    delete missingConnection.connectionId
    expect(zIngestionEnvelope.safeParse(missingConnection).success).toBe(false)
  })

  it('derives a stable payload hash and idempotency key from the record identity', () => {
    const first = createIngestionEnvelope(baseInput)
    const second = createIngestionEnvelope({
      ...baseInput,
      payload: {
        customer: { name: 'Acme', code: 'C-1' },
        total: 1250,
        invoiceNo: 'INV-1001',
      },
    })

    expect(first.payloadHash).toBe(hashPayload(baseInput.payload))
    expect(second.payloadHash).toBe(first.payloadHash)
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    expect(first.idempotencyKey).toBe(
      buildIdempotencyKey({
        tenantId: first.tenantId,
        connectionId: first.connectionId,
        entityType: first.entityType,
        externalId: first.externalId,
        payloadHash: first.payloadHash,
      }),
    )
  })

  it('changes the idempotency key when the same external record changes', () => {
    const original = createIngestionEnvelope(baseInput)
    const changed = createIngestionEnvelope({
      ...baseInput,
      payload: { ...baseInput.payload, total: 1500 },
    })

    expect(changed.payloadHash).not.toBe(original.payloadHash)
    expect(changed.idempotencyKey).not.toBe(original.idempotencyKey)
  })

  it('rejects a caller-supplied payload hash that does not match the payload', () => {
    expect(() =>
      createIngestionEnvelope({
        ...baseInput,
        payloadHash: '0'.repeat(64),
      }),
    ).toThrow(/payloadHash/i)
  })
})

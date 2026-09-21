// @req FR-187 — a structured projection is admitted in one transaction that
// is given enough time for every record, and an expired transaction is never
// reported as a concurrent-request conflict.
// @tested tests/unit/knowledge-admission-transaction.test.js
import { describe, expect, it, vi } from 'vitest'
import { isUniqueError, structuredAdmissionTransactionOptions } from '@/modules/knowledge/knowledge-admission-service'
import { createKnowledgeRepository } from '@/modules/knowledge/knowledge-repository'

describe('isUniqueError', () => {
  it('trusts the Prisma code over the message', () => {
    expect(isUniqueError({ code: 'P2002', message: 'Unique constraint failed' })).toBe(true)
    // An expired interactive transaction whose message echoes catalog data.
    expect(isUniqueError({ code: 'P2028', message: 'Transaction API error ... { nameEn: "Unique duplicate-proof tumbler" }' })).toBe(false)
  })

  it('keeps the message fallback for errors without a Prisma code', () => {
    expect(isUniqueError(new Error('duplicate key value violates unique constraint'))).toBe(true)
    expect(isUniqueError(new Error('network down'))).toBe(false)
  })
})

describe('structuredAdmissionTransactionOptions', () => {
  it('outlasts the 5s default for a 16-record catalog and stays bounded', () => {
    expect(structuredAdmissionTransactionOptions(16).timeout).toBeGreaterThanOrEqual(30_000)
    expect(structuredAdmissionTransactionOptions(1).timeout).toBeGreaterThan(5_000)
    expect(structuredAdmissionTransactionOptions(10_000).timeout).toBe(120_000)
    expect(structuredAdmissionTransactionOptions(0).timeout).toBe(structuredAdmissionTransactionOptions(1).timeout)
  })
})

describe('knowledge repository transaction', () => {
  it('passes transaction options to Prisma only when given', async () => {
    const $transaction = vi.fn(async (fn) => fn({}))
    const repository = createKnowledgeRepository({ $transaction })
    await repository.transaction(async () => 'a')
    expect($transaction.mock.calls[0]).toHaveLength(1)
    await repository.transaction(async () => 'b', { timeout: 40_000, maxWait: 10_000 })
    expect($transaction.mock.calls[1][1]).toEqual({ timeout: 40_000, maxWait: 10_000 })
  })
})

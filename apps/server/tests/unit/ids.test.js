import { describe, it, expect } from 'vitest'
import {
  newId,
  codeFragment,
  humanCode,
  uniqueHumanCode,
  isCodeConflict,
  retryOnCodeConflict,
  isInternalId,
} from '@/lib/ids'

// @spec BR-002 — auto-generated human codes must recover from unique-index races
// @tested tests/unit/ids.test.js

describe('ids', () => {
  it('generates uuid internal ids', () => {
    const id = newId()
    expect(isInternalId(id)).toBe(true)
  })

  it('normalizes names into code fragments', () => {
    expect(codeFragment('Customer Data')).toBe('CUSTOMER-DATA')
    expect(codeFragment('  spaced   out  ')).toBe('SPACED-OUT')
    expect(codeFragment('ครัว Thai')).toBe('THAI')
  })

  it('builds human codes', () => {
    expect(humanCode('PRJ', 'Customer Data')).toBe('PRJ-CUSTOMER-DATA')
  })

  it('retries on collision with numeric suffix', async () => {
    const taken = new Set(['WST-ALPHA', 'WST-ALPHA-2'])
    const code = await uniqueHumanCode('WST', 'Alpha', async (c) => taken.has(c))
    expect(code).toBe('WST-ALPHA-3')
  })

  it('recognizes P2002 conflicts whose target names the code column', () => {
    const arrayTarget = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: ['tenantId', 'code'] },
    })
    const stringTarget = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: 'PurchaseOrder_tenantId_CODE_key' },
    })
    const assetColumn = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: ['businessId', 'assetCode'] },
    })
    const assetConstraint = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: 'RegisteredAsset_businessId_assetCode_key' },
    })

    expect(isCodeConflict(arrayTarget)).toBe(true)
    expect(isCodeConflict(stringTarget)).toBe(true)
    expect(isCodeConflict(assetColumn)).toBe(true)
    expect(isCodeConflict(assetConstraint)).toBe(true)
  })

  it('does not retry a P2002 conflict when Prisma omits its target', () => {
    expect(isCodeConflict(Object.assign(new Error('unique constraint'), { code: 'P2002' }))).toBe(false)
  })

  it('does not treat other unique columns or non-P2002 errors as code conflicts', () => {
    const idempotencyConflict = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: ['idempotencyKey'] },
    })
    const otherPrismaError = Object.assign(new Error('record not found'), {
      code: 'P2025',
      meta: { target: ['code'] },
    })
    const ordinaryError = new Error('not a Prisma error')
    const discountCodeConflict = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: ['discountCode'] },
    })
    const barcodeConflict = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: ['barcode'] },
    })
    const barcodeConstraint = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: 'Product_tenantId_barcode_key' },
    })

    expect(isCodeConflict(idempotencyConflict)).toBe(false)
    expect(isCodeConflict(otherPrismaError)).toBe(false)
    expect(isCodeConflict(ordinaryError)).toBe(false)
    expect(isCodeConflict(discountCodeConflict)).toBe(false)
    expect(isCodeConflict(barcodeConflict)).toBe(false)
    expect(isCodeConflict(barcodeConstraint)).toBe(false)
  })

  it('returns the first successful attempt and passes the one-based attempt number', async () => {
    const attemptNumbers = []
    const result = await retryOnCodeConflict(async (attemptNumber) => {
      attemptNumbers.push(attemptNumber)
      return 'created'
    })

    expect(result).toBe('created')
    expect(attemptNumbers).toEqual([1])
  })

  it('retries code conflicts from scratch until an attempt succeeds', async () => {
    const attemptNumbers = []
    const conflict = Object.assign(new Error('duplicate code'), {
      code: 'P2002',
      meta: { target: ['tenantId', 'code'] },
    })
    const result = await retryOnCodeConflict(async (attemptNumber) => {
      attemptNumbers.push(attemptNumber)
      if (attemptNumber < 3) throw conflict
      return 'created after retry'
    })

    expect(result).toBe('created after retry')
    expect(attemptNumbers).toEqual([1, 2, 3])
  })

  it('rethrows a non-code error unchanged without another attempt', async () => {
    const failure = new Error('database unavailable')
    let calls = 0

    await expect(retryOnCodeConflict(async () => {
      calls += 1
      throw failure
    })).rejects.toBe(failure)
    expect(calls).toBe(1)
  })

  it('returns a 409 allocation exhaustion error after the default number of conflicts', async () => {
    const conflict = Object.assign(new Error('duplicate code'), {
      code: 'P2002',
      meta: { target: ['code'] },
    })
    let calls = 0

    await expect(retryOnCodeConflict(async () => {
      calls += 1
      throw conflict
    })).rejects.toMatchObject({ status: 409, message: 'CODE_ALLOCATION_EXHAUSTED' })
    expect(calls).toBe(5)
  })

  it('uses a custom exhaustion error with the last code conflict', async () => {
    const conflicts = [1, 2, 3].map((n) => Object.assign(new Error(`duplicate ${n}`), {
      code: 'P2002',
      meta: { target: ['code'] },
    }))
    const exhaustedError = Object.assign(new Error('PURCHASE_ORDER_CODE_EXHAUSTED'), { status: 409 })
    let calls = 0
    let exhaustedWith

    await expect(retryOnCodeConflict(async () => {
      throw conflicts[calls++]
    }, {
      attempts: 3,
      exhausted: (lastError) => {
        exhaustedWith = lastError
        return exhaustedError
      },
    })).rejects.toBe(exhaustedError)

    expect(calls).toBe(3)
    expect(exhaustedWith).toBe(conflicts[2])
  })

  it('does not retry a P2002 violation on a non-code column', async () => {
    const conflict = Object.assign(new Error('duplicate idempotency key'), {
      code: 'P2002',
      meta: { target: ['idempotencyKey'] },
    })
    let calls = 0

    await expect(retryOnCodeConflict(async () => {
      calls += 1
      throw conflict
    })).rejects.toBe(conflict)
    expect(calls).toBe(1)
  })

  it('rethrows a barcode unique violation instead of converting it to code exhaustion', async () => {
    const conflict = Object.assign(new Error('duplicate barcode'), {
      code: 'P2002',
      meta: { target: 'Product_tenantId_barcode_key' },
    })
    let calls = 0

    await expect(retryOnCodeConflict(async () => {
      calls += 1
      throw conflict
    })).rejects.toBe(conflict)
    expect(calls).toBe(1)
  })

  it('lets a caller preserve an explicit-code unique error without retrying it', async () => {
    const conflict = Object.assign(new Error('duplicate explicit code'), {
      code: 'P2002',
      meta: { target: ['code'] },
    })
    let calls = 0

    await expect(retryOnCodeConflict(async () => {
      calls += 1
      throw conflict
    }, { shouldRetry: () => false })).rejects.toBe(conflict)
    expect(calls).toBe(1)
  })

  it('external identifiers are not internal ids', () => {
    expect(isInternalId('0105500000001')).toBe(false) // TH tax id
    expect(isInternalId('Freshair129/zuri')).toBe(false) // GitHub full name
    expect(isInternalId('U4af4980629...')).toBe(false) // LINE user id
  })
})

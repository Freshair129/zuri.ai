// @req FR-186 — VAT and PromptPay domain calculations use verified configured
// values, deterministic integer-satang rounding and strict Thai target shapes.
// @req FR-183 — POS input keeps the existing line/payment vocabulary and
// refuses silent quantity or price coercion.
// @spec ADR-065; BR-002; SEC-001
// @tested tests/unit/commerce-billing-domain.test.js
import { describe, expect, it } from 'vitest'
import {
  calculateThaiVat,
  generatePromptPayPayload,
  normalizePromptPayTarget,
  promptPayPayloadForProfile,
  PRISMA_INT_MAX,
  zPosCheckout,
} from '@/modules/commerce/domain/billing'

describe('Commerce billing/POS domain', () => {
  it('calculates document-level inclusive and exclusive VAT with integer rounding', () => {
    expect(calculateThaiVat(10700, { vatTreatment: 'INCLUSIVE', rateBps: 700 })).toMatchObject({ netSatang: 10000, vatSatang: 700, grossSatang: 10700, rounding: 'ROUND_HALF_UP' })
    expect(calculateThaiVat(10000, { vatTreatment: 'EXCLUSIVE', rateBps: 700 })).toMatchObject({ netSatang: 10000, vatSatang: 700, grossSatang: 10700 })
    expect(calculateThaiVat(10701, { vatTreatment: 'INCLUSIVE', rateBps: 700 })).toMatchObject({ netSatang: 10001, vatSatang: 700, grossSatang: 10701 })
  })

  it('rejects non-integer money and unsupported VAT rates', () => {
    expect(() => calculateThaiVat(10.5, { rateBps: 700 })).toThrow(/integer/)
    expect(() => calculateThaiVat(-1, { rateBps: 700 })).toThrow(/non-negative/)
    expect(() => calculateThaiVat(100, { rateBps: 10001 })).toThrow(/basis points/)
    expect(() => calculateThaiVat(PRISMA_INT_MAX, { vatTreatment: 'EXCLUSIVE', rateBps: 700 })).toThrow(/persisted integer range/)
  })

  it('normalizes only valid mobile and tax-id PromptPay targets and emits CRC payloads', () => {
    expect(normalizePromptPayTarget('MOBILE', '081-234-5678')).toEqual({ targetType: 'MOBILE', value: '0066812345678' })
    expect(normalizePromptPayTarget('TAX_ID', '0105560000000')).toEqual({ targetType: 'TAX_ID', value: '0105560000000' })
    const mobile = generatePromptPayPayload('0812345678', 500, { targetType: 'MOBILE' })
    expect(mobile).toContain('000201')
    expect(mobile).toContain('0016A000000677010111')
    expect(mobile).toContain('0066812345678')
    expect(mobile).toContain('5303764')
    expect(mobile).toContain('5406500.00')
    expect(mobile).toContain('5802TH6304')
    expect(mobile).toMatch(/[0-9A-F]{4}$/)
    expect(() => normalizePromptPayTarget('MOBILE', '0105560000000')).toThrow('PROMPTPAY_TARGET_INVALID')
    expect(() => generatePromptPayPayload('not-a-recipient', 1)).toThrow()
  })

  it('requires active verified PromptPay configuration before payload generation', () => {
    expect(() => promptPayPayloadForProfile(null, 100)).toThrow('PROMPTPAY_NOT_CONFIGURED')
    expect(() => promptPayPayloadForProfile({ active: true, promptPayProvider: 'PROMPTPAY', promptPayActive: true, promptPayTargetType: 'MOBILE', promptPayTarget: '0812345678' }, 100)).toThrow('PROMPTPAY_NOT_CONFIGURED')
    expect(promptPayPayloadForProfile({ active: true, promptPayProvider: 'PROMPTPAY', promptPayActive: true, promptPayVerifiedAt: new Date(), promptPayTargetType: 'MOBILE', promptPayTarget: '0812345678' }, 100)).toMatchObject({ provider: 'PROMPTPAY', amountSatang: 100, generated: true })
  })

  it('keeps POS input strict instead of defaulting missing prices or quantities', () => {
    expect(() => zPosCheckout.parse({ businessId: 'b', branchId: 'br', warehouseLocationId: 'wh', lines: [{ description: 'x', qty: 0, unitPrice: 10 }], payment: { method: 'CASH' } })).toThrow()
    expect(() => zPosCheckout.parse({ businessId: 'b', branchId: 'br', warehouseLocationId: 'wh', lines: [{ description: 'x', qty: 1, unitPrice: 1.005 }], payment: { method: 'CASH' } })).toThrow()
    expect(() => zPosCheckout.parse({ businessId: 'b', branchId: 'br', warehouseLocationId: 'wh', lines: [{ description: 'x', qty: PRISMA_INT_MAX + 1, unitPrice: 0 }], payment: { method: 'CASH' } })).toThrow()
    expect(() => zPosCheckout.parse({ businessId: 'b', branchId: 'br', warehouseLocationId: 'wh', lines: [{ description: 'x', qty: Number.MAX_SAFE_INTEGER, unitPrice: 10 }], payment: { method: 'CASH', receivedAmount: 1.001 } })).toThrow()
  })
})

// @req FR-187 — the Zero-PII deny policy ported from SmartGift refuses a
// customer/contact/quotation record by construction, at one shared predicate
// both the adapter and Stage 5 classify call.
// @spec ADR-075 D5, FR-111, SEC-021
// @tested tests/unit/knowledge-zero-pii-policy.test.js
import { describe, expect, it } from 'vitest'
import {
  assertZeroPii,
  findZeroPiiViolation,
  isStructuredRecordProvider,
  STRUCTURED_RECORD_DENY_PATTERN,
  STRUCTURED_RECORD_DENY_POLICY,
} from '@/modules/knowledge/structured-record-policy'

describe('structured-record Zero-PII policy', () => {
  it('keeps SmartGift\'s own deny expression verbatim', () => {
    // The point of a port is that the two sides cannot drift. If this literal
    // changes, the producer-side policy has to change with it.
    expect(STRUCTURED_RECORD_DENY_PATTERN.source).toBe('05_crm_customer_data|customer|contact|quotation|ลูกค้า|ใบเสนอราคา')
    expect(STRUCTURED_RECORD_DENY_PATTERN.flags).toContain('i')
  })

  it('arms only for declared structured providers', () => {
    expect(isStructuredRecordProvider('SMARTGIFT_CATALOG')).toBe(true)
    expect(isStructuredRecordProvider('KNOWLEDGE_ADMISSION')).toBe(false)
    expect(isStructuredRecordProvider(undefined)).toBe(false)
  })

  it('passes a clean catalog record', () => {
    const record = { entityType: 'ProductMaster', externalId: 'PM-NB', nameTh: 'สมุดโน้ตหนัง', srpPriceThbQty1: 750 }
    expect(findZeroPiiViolation(record, { sourceId: 'smartgift-catalog:products.json#PM-NB' })).toBeNull()
    expect(() => assertZeroPii(record, { sourceId: 'smartgift-catalog:products.json#PM-NB' })).not.toThrow()
  })

  it.each([
    ['an English customer field', { entityType: 'ProductMaster', customerName: 'A' }, 'record.customerName', 'customer'],
    ['a Thai customer key', { entityType: 'ProductMaster', 'ลูกค้า': 'x' }, 'record.ลูกค้า', 'ลูกค้า'],
    ['a quotation reference key', { entityType: 'BundleOffer', quotationId: 'Q-1' }, 'record.quotationId', 'quotation'],
    ['a contact block', { entityType: 'ProductMaster', contact: 'x' }, 'record.contact', 'contact'],
    ['a nested Thai quotation key', { entityType: 'BundleOffer', refs: [{ 'ใบเสนอราคา': '001' }] }, 'record.refs[0].ใบเสนอราคา', 'ใบเสนอราคา'],
    ['a CRM path in a locator value', { entityType: 'ProductMaster', provenance: { upstreamFile: 'data-pipeline/01_raw/05_crm_customer_data/x.json' } }, 'record.provenance.upstreamFile', '05_crm_customer_data'],
  ])('denies a record carrying %s', (_label, record, field, term) => {
    expect(findZeroPiiViolation(record)).toEqual({ field, term })
  })

  it('does not scan descriptive text — SmartGift applies the rule to locators, not prose', () => {
    // A corporate-gift catalog legitimately describes products for customers.
    const record = { entityType: 'ProductMaster', externalId: 'PM-NB', descriptionTh: 'ของขวัญสำหรับลูกค้าองค์กร', note: 'contact-free NFC tag' }
    expect(findZeroPiiViolation(record, { sourceId: 'smartgift-catalog:products.json#PM-NB' })).toBeNull()
  })

  it('denies the CRM source path even when the record body is clean', () => {
    const record = { entityType: 'ProductMaster', externalId: 'PM-NB' }
    expect(findZeroPiiViolation(record, { sourceUri: 'data-pipeline/01_raw/05_crm_customer_data/export.json' }))
      .toMatchObject({ field: 'sourceUri' })
    expect(findZeroPiiViolation(record, { sourceId: 'smartgift-catalog:customers.json#C-1' }))
      .toMatchObject({ field: 'sourceId' })
  })

  it('throws the terminal 422 the pipeline treats as a permanent rejection', () => {
    let thrown
    try {
      assertZeroPii({ entityType: 'ProductMaster', customerName: 'A' }, { sourceId: 's', sourceUri: 'u' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      status: 422,
      code: 'GENESISRAG17_ZERO_PII_DENIED',
      details: { policy: STRUCTURED_RECORD_DENY_POLICY, field: 'record.customerName', term: 'customer' },
    })
    // The reported term is one of the policy's own literals, never record data.
    expect(thrown.message).not.toContain('A')
  })

  it('denies rather than silently passing a value it cannot serialize', () => {
    const cyclic = { entityType: 'ProductMaster' }
    cyclic.self = cyclic
    expect(findZeroPiiViolation(cyclic)).toMatchObject({ field: 'record', term: 'unserializable' })
  })
})

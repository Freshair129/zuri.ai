// @req FR-173 — the document Zero-PII policy for an OWNER-admitted TEXT/FILE
// source (provider `KNOWLEDGE_ADMISSION`): one entry point,
// `findDocumentProseViolation(content)`, checking only the identifier rules
// (LINE user id, Thai phone, international phone, e-mail address) — never
// the candidate policy's Thai-honorific personal-name heuristic or its
// quoted-wording rule, both deliberately excluded (see the module header).
// @spec ADR-072 (Amendment, 2026-09-24), ADR-090 D6 (revised 2026-09-14)
import { describe, expect, it } from 'vitest'
import {
  assertDocumentProseZeroPii,
  DOCUMENT_ZERO_PII_POLICY,
  findDocumentProseViolation,
} from '@/modules/knowledge/knowledge-document-zero-pii'

describe('knowledge document Zero-PII policy (FR-173, ADR-072 Amendment 2026-09-24)', () => {
  it('carries its own policy identity, distinct from FR-187 and FR-236', () => {
    expect(DOCUMENT_ZERO_PII_POLICY).toBe('knowledge-document-zero-pii-1')
  })

  it('refuses a Thai phone number and names the rule, never the matched value', () => {
    const violation = findDocumentProseViolation('โทรติดต่อได้ที่ 081-234-5678 ทุกวัน')
    expect(violation).toEqual({ term: 'phone_number' })
    expect(JSON.stringify(violation)).not.toContain('081-234-5678')
  })

  it('refuses a +66 international-form Thai phone number', () => {
    expect(findDocumentProseViolation('Call +66 81 234 5678 for support')).toMatchObject({ term: 'phone_number' })
  })

  it('refuses a generic international phone number', () => {
    expect(findDocumentProseViolation('Contact us at +1 415 555 0134 any time')).toMatchObject({ term: 'phone_number' })
  })

  it('refuses a LINE user id', () => {
    const lineId = `U${'a1b2c3d4e5f60718293a4b5c6d7e8f90'}`
    const violation = findDocumentProseViolation(`อ้างอิงจากแชท ${lineId}`)
    expect(violation).toEqual({ term: 'line_user_id' })
    expect(JSON.stringify(violation)).not.toContain(lineId)
  })

  it('refuses an e-mail address', () => {
    const violation = findDocumentProseViolation('ติดต่อฝ่ายขายที่ sales@example.co.th')
    expect(violation).toEqual({ term: 'email_address' })
    expect(JSON.stringify(violation)).not.toContain('sales@example.co.th')
  })

  it('throws a 422 carrying the policy identity and rule name, never the matched value', () => {
    let thrown
    try {
      assertDocumentProseZeroPii('โทร 081-234-5678', { sourceId: 'doc-1', sourceUri: 'knowledge-source:doc-1' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      status: 422,
      code: 'KNOWLEDGE_DOCUMENT_ZERO_PII_DENIED',
      details: { policy: 'knowledge-document-zero-pii-1', term: 'phone_number', sourceId: 'doc-1', sourceUri: 'knowledge-source:doc-1' },
    })
    expect(JSON.stringify(thrown.details)).not.toContain('081-234-5678')
  })

  it('does not throw on clean content', () => {
    expect(() => assertDocumentProseZeroPii('นโยบายการคืนสินค้าภายใน 7 วันหลังจากได้รับสินค้า')).not.toThrow()
  })

  // Ordinary owner-document prose FR-173 / ADR-072 Amendment explicitly
  // allows: quotations, an honorific + a staff/brand name, prices, SKU
  // codes and dates — none of these are identifier shapes, so none of them
  // may be refused by this policy (the candidate policy's name/quote rules
  // are deliberately not applied here).
  const MUST_PASS = [
    'ป้ายเขียนว่า "ไม่รับคืนสินค้าหลัง 7 วัน" ตามนโยบายร้าน',
    'คุณสมชาย ผู้จัดการสาขา เป็นผู้อนุมัติเอกสารนี้',
    'Smart Gift รับสกรีนโลโก้ ราคาเริ่มต้น 120 บาท',
    'รหัสสินค้า SKU-00123 มีจำหน่ายตั้งแต่วันที่ 2026-01-15',
    'John Smith Consulting ให้บริการที่ปรึกษาด้านโลจิสติกส์',
    'ราคาต่อชิ้น 1,250 บาท รวมภาษีมูลค่าเพิ่มแล้ว',
    // Thai EAN-13 barcode: the phone rule's `0\d{1,2}...` branch has no
    // leading boundary of its own, so an embedded "0123456789" run inside a
    // longer digit string used to read as a phone number.
    'บาร์โค้ด 8850123456789',
    'รหัสบาร์โค้ดสินค้า 8851234567890 พิมพ์บนฉลากทุกชิ้น',
    // Markdown retina-image reference, routine in a product manual: the
    // e-mail rule's bare `[a-zA-Z]{2,}` TLD group used to accept `png`.
    '![logo](logo@2x.png)',
    '![ไอคอนสาขา](icon@3x.jpg)',
    // Gate round 2: case and multi-label extensions, and a barcode written
    // with a separator after its first digit group.
    '![logo](logo@2x.PNG)',
    '![x](logo@2x.retina.png)',
    '![x](img@2x.min.jpg)',
    // A valid EAN-13 (GS1 check digit 7) split after its prefix.
    'บาร์โค้ด 885 0123456787',
    'EAN 885-0123456787',
  ]

  // The hardening must not open a hole: real addresses and phone numbers
  // written next to these shapes are still refused.
  it.each([
    ['ติดต่อ sales@smartgift.co.th', 'email_address'],
    ['Contact SALES@EXAMPLE.COM today', 'email_address'],
    ['โทร 081 234 5678', 'phone_number'],
    ['สาขา 2 โทร 0812345678', 'phone_number'],
    // Gate round 3: a phone number written right after an ordinary number
    // must never read as a barcode tail.
    ['สาขา 3 081-234-5678', 'phone_number'],
    ['1 0812345678', 'phone_number'],
    ['10:30 081-234-5678', 'phone_number'],
    ['เปิด 24/7 0812345678', 'phone_number'],
    ['ชั้น 2 02-123-4567', 'phone_number'],
    // 3 + 10 = 13 digits but a wrong check digit: not a barcode, so refused.
    ['ห้อง 885 0123456789', 'phone_number'],
  ])('still refuses %s', (text, term) => {
    expect(findDocumentProseViolation(text)).toEqual({ term })
  })

  it.each(MUST_PASS)('does not refuse realistic owner-document prose: %s', (text) => {
    expect(findDocumentProseViolation(text)).toBeNull()
    expect(() => assertDocumentProseZeroPii(text)).not.toThrow()
  })

  it('is null-safe and empty-safe', () => {
    expect(findDocumentProseViolation('')).toBeNull()
    expect(findDocumentProseViolation(null)).toBeNull()
    expect(findDocumentProseViolation(undefined)).toBeNull()
  })
})

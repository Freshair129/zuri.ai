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
  ]

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

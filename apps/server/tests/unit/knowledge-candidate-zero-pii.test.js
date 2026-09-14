import { describe, expect, it } from 'vitest'
import {
  assertCandidateZeroPii,
  CANDIDATE_ZERO_PII_POLICY,
  findCandidateZeroPiiViolation,
} from '@/modules/knowledge/knowledge-candidate-zero-pii'
import { isStructuredRecordProvider, assertZeroPii } from '@/modules/knowledge/structured-record-policy'

// @req FR-236 — the Zero-PII deny policy a candidate's canonical question/
//   answer must pass, with fixtures for every shape ADR-090 D6 names: a Thai
//   name, a Thai phone number, a LINE user id, and quoted customer wording —
//   and, just as importantly, a wide negative-fixture set of ordinary Thai/
//   English FAQ prose that must NOT be refused. Thai has no spaces between
//   words, so a bare honorific substring ("คุณ", "นาย", "นาง") is not a name
//   signal on its own: "คุณ" is also the everyday second-person pronoun and
//   "คุณภาพ"/"คุณสมบัติ"/"นายหน้า" are ordinary product vocabulary that merely
//   starts with an honorific string. A policy that cannot tell these apart
//   refuses every realistic candidate, which defeats FR-236 entirely.
// @spec ADR-090 D6, FR-187
const CLEAN = { question: 'ค่าจัดส่งไปต่างจังหวัดเท่าไหร่', answer: 'ค่าจัดส่งมาตรฐานคือ 50 บาท ตามนโยบายจัดส่งของร้าน (Product.code: SHIP-STD)' }

describe('knowledge candidate Zero-PII policy (FR-236)', () => {
  it('passes a clean, locator-only Q/A', () => {
    expect(findCandidateZeroPiiViolation(CLEAN)).toBeNull()
    expect(() => assertCandidateZeroPii(CLEAN)).not.toThrow()
  })

  it('refuses a Thai personal name after an honorific, glued or spaced', () => {
    for (const answer of ['คุณสมชาย ใจดี ได้รับของแล้วครับ', 'ติดต่อคุณสมชาย ใจดี ได้เลย', 'คุณ สมหญิง เป็นผู้ติดต่อหลัก']) {
      const violation = findCandidateZeroPiiViolation({ ...CLEAN, answer })
      expect(violation, answer).toMatchObject({ field: 'answer', term: 'personal_name' })
      expect(() => assertCandidateZeroPii({ ...CLEAN, answer })).toThrow(
        expect.objectContaining({ status: 422, code: 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED' }),
      )
    }
  })

  it('refuses a Thai phone number', () => {
    expect(findCandidateZeroPiiViolation({ ...CLEAN, answer: 'โทรกลับที่ 081-234-5678 ได้เลย' })).toMatchObject({ field: 'answer', term: 'phone_number' })
    expect(findCandidateZeroPiiViolation({ ...CLEAN, question: 'ติดต่อที่เบอร์ 0891234567 ใช่ไหม' })).toMatchObject({ field: 'question', term: 'phone_number' })
  })

  it('refuses an international phone number', () => {
    expect(findCandidateZeroPiiViolation({ ...CLEAN, answer: 'Call +66 81 234 5678 for support' })).toMatchObject({ term: 'phone_number' })
  })

  it('refuses a LINE user id', () => {
    const lineId = `U${'a1b2c3d4e5f60718293a4b5c6d7e8f90'}`
    expect(findCandidateZeroPiiViolation({ ...CLEAN, answer: `อ้างอิงจากแชท ${lineId}` })).toMatchObject({ field: 'answer', term: 'line_user_id' })
  })

  it('refuses quoted customer wording', () => {
    expect(findCandidateZeroPiiViolation({ ...CLEAN, answer: 'ลูกค้าบอกว่า "ของเสียหายตอนส่ง" และขอเปลี่ยนใหม่' })).toMatchObject({ term: 'quoted_wording' })
  })

  it('refuses the structural FR-187 deny terms it reuses (never a copy)', () => {
    expect(findCandidateZeroPiiViolation({ ...CLEAN, answer: 'กรุณาติดต่อฝ่าย customer service' })).toMatchObject({ term: 'deny_term' })
  })

  it('names which rule matched, so a reviewer can rephrase rather than guess', () => {
    expect(findCandidateZeroPiiViolation({ ...CLEAN, answer: 'คุณสมชาย ใจดี' })?.term).toBe('personal_name')
    expect(findCandidateZeroPiiViolation({ ...CLEAN, answer: '081-234-5678' })?.term).toBe('phone_number')
  })

  it('carries its own policy identity distinct from FR-187 SmartGift policy', () => {
    expect(CANDIDATE_ZERO_PII_POLICY).toBe('line-faq-candidate-zero-pii-1')
  })

  // Every one of these is realistic FAQ/product prose FR-236 explicitly
  // allows (product locators, policy names, amounts, ordinary Thai "you"
  // phrasing and Title Case brand/product names) and must be approvable.
  // Includes the five sentences a false-positive honorific/Latin-name rule
  // was refusing before this fix.
  const REALISTIC_NEGATIVE_FIXTURES = [
    'กระเป๋าผ้าคุณภาพดี ราคา 120 บาท',
    'คุณสมบัติของแก้วเก็บความเย็น',
    'สั่งผ่านนายหน้าได้ไหม',
    'Smart Gift รับสกรีนโลโก้',
    'ส่งแบบ Express Delivery ภายใน 3 วัน',
    CLEAN.answer,
    'คุณสามารถชำระเงินผ่าน QR code ได้ทันที',
    'คุณจะได้รับสินค้าใน 3-5 วันทำการ',
    'สินค้ามีคุณค่าทางโภชนาการสูง',
    'บริษัทดำเนินธุรกิจด้วยคุณธรรมและความโปร่งใส',
    'กระเป๋าลายนางฟ้าเป็นสินค้าขายดี',
    'เสื้อยืด Cotton 100% ระบายอากาศดี ใส่สบาย',
    'โปรโมชั่น Buy One Get One ถึงสิ้นเดือนนี้',
    'รับประกันสินค้า 1 ปีเต็ม ตามเงื่อนไขบริษัท',
    'คุณต้องกรอกรหัสส่วนลดก่อนชำระเงิน',
    'คุณควรเก็บใบเสร็จไว้เป็นหลักฐาน',
    'คุณอาจได้รับ SMS แจ้งเตือนก่อนจัดส่ง',
  ]

  it('lists at least 15 realistic negative fixtures', () => {
    expect(REALISTIC_NEGATIVE_FIXTURES.length).toBeGreaterThanOrEqual(15)
  })

  it.each(REALISTIC_NEGATIVE_FIXTURES)('does not refuse realistic FAQ prose: %s', (answer) => {
    expect(findCandidateZeroPiiViolation({ ...CLEAN, answer })).toBeNull()
    expect(() => assertCandidateZeroPii({ ...CLEAN, answer })).not.toThrow()
  })
})

describe('Stage 5 classify reuses the exact FR-187 function for LINE_FAQ_CANDIDATE (ADR-090 D6, second check)', () => {
  it('is registered as a structured-record provider', () => {
    expect(isStructuredRecordProvider('LINE_FAQ_CANDIDATE')).toBe(true)
    expect(isStructuredRecordProvider('SMARTGIFT_CATALOG')).toBe(true)
    expect(isStructuredRecordProvider('KNOWLEDGE_ADMISSION')).toBe(false)
  })

  it('the shared FR-187 assertZeroPii denies admitted content carrying a deny term', () => {
    const content = JSON.stringify({ question: 'ติดต่อเรายังไง', answer: 'ติดต่อฝ่าย customer ได้ที่ไลน์' })
    expect(() => assertZeroPii(content, { sourceId: 'knowledge-candidate:kc-1' })).toThrow(
      expect.objectContaining({ status: 422, code: 'GENESISRAG17_ZERO_PII_DENIED' }),
    )
  })

  it('the shared FR-187 assertZeroPii passes clean admitted content', () => {
    const content = JSON.stringify(CLEAN)
    expect(() => assertZeroPii(content, { sourceId: 'knowledge-candidate:kc-2' })).not.toThrow()
  })
})

// @req FR-236 — the one fixture set both the candidate-creation Zero-PII unit
//   test and the Stage-5 agreement integration test scan, so "the verdict at
//   candidate decision equals the verdict at Stage 5" is checked against
//   literally the same sentences rather than two lists that could drift.
// @spec ADR-090 D6 (revised 2026-09-14, owner decision)

export const CLEAN = {
  question: 'ค่าจัดส่งไปต่างจังหวัดเท่าไหร่',
  answer: 'ค่าจัดส่งมาตรฐานคือ 50 บาท ตามนโยบายจัดส่งของร้าน (Product.code: SHIP-STD)',
}

// Realistic FAQ/product prose FR-236 explicitly allows (product locators,
// policy names, amounts, ordinary Thai "you"/polite-address phrasing and
// Title Case brand/product names) — every one of these must be approved, and
// must pass Stage 5 identically once admitted. Includes the sentences named
// across every review round, notably the ones containing "ลูกค้า" and
// "ใบเสนอราคา" — the exact literal words FR-187's structured-record policy
// denies, and exactly why LINE_FAQ_CANDIDATE does not use that policy.
export const MUST_PASS_ANSWERS = [
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
  'คุณลูกค้าต้องการใบกำกับภาษีไหมคะ',
  'คุณแม่ซื้อเป็นของขวัญได้ไหม',
  'คุณลูกค้าสามารถสั่งขั้นต่ำ 50 ชิ้นได้ค่ะ',
  'คุณพ่อคุณแม่สั่งเป็นของขวัญได้',
  'กรุณาติดต่อฝ่าย customer service',
  // The literal case named by the owner decision: FR-187 denies "ใบเสนอราคา"
  // outright; an ordinary customer asking for a quotation must be approvable.
  'ขอใบเสนอราคาได้ไหม',
]

// Every one of these must still be refused — the shapes ADR-090 D6 actually
// names (names, phone numbers, a LINE user id, quoted wording).
export const MUST_REFUSE_ANSWERS = [
  { answer: 'คุณสมชาย ใจดี ได้รับของแล้วครับ', term: 'personal_name' },
  { answer: 'ติดต่อคุณสมชาย ใจดี ได้เลย', term: 'personal_name' },
  { answer: 'คุณ สมหญิง เป็นผู้ติดต่อหลัก', term: 'personal_name' },
  { answer: 'โทรกลับที่ 081-234-5678 ได้เลย', term: 'phone_number' },
  { answer: 'Call +66 81 234 5678 for support', term: 'phone_number' },
  { answer: `อ้างอิงจากแชท U${'a1b2c3d4e5f60718293a4b5c6d7e8f90'}`, term: 'line_user_id' },
  { answer: 'ลูกค้าบอกว่า "ของเสียหายตอนส่ง" และขอเปลี่ยนใหม่', term: 'quoted_wording' },
]

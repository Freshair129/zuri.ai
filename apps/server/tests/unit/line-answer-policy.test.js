import { describe, expect, it } from 'vitest'
import { asciiDigits, checkModelAnswer, ungroupedNumbers, verifyCandidate } from '@/modules/agent/line-answer-policy'

// @req FR-049 — the grounding check cannot be passed by writing an ungrounded
// number in another digit script, by echoing a figure the customer typed as a
// price, by leaning on a different risky claim in the evidence, or by naming a
// code with no digit. Grounded answers, including quantity and budget echoes,
// still pass. The Server and the Conversation Runtime share this module.
// @spec SDD-025, SEC-009
// @tested tests/unit/line-answer-policy.test.js

const product = {
  product_code: 'USB-001', name: 'แฟลชไดรฟ์ไม้', unit: 'ชิ้น', sell_price: 120, currency: 'THB', moq: 100,
  specification: { capacity: '32GB' }, as_of: '2026-08-12T00:00:00.000Z',
}
const evidence = { records: [product] }
const pen = { product_code: 'PM-PEN', name: 'ปากกา', unit: 'ด้าม', sell_price: 25, currency: 'THB', moq: 300,
  specification: {}, as_of: '2026-08-12T00:00:00.000Z' }
const withText = text => ({ records: [{ kind: 'CORPUS_CHUNK', citationId: 'gks:1', text }] })
const question = 'USB-001 ราคาเท่าไร'

describe('verifyCandidate rejects the bypasses', () => {
  it.each([
    ['Thai digits', question, evidence, 'ราคา ๙๙ บาทค่ะ', { unsupportedNumbers: ['99'] }],
    ['fullwidth digits', question, evidence, 'ราคา ９９ บาท', { unsupportedNumbers: ['99'] }],
    ['Arabic-Indic digits', question, evidence, 'ราคา ٩٩ บาท', { unsupportedNumbers: ['99'] }],
    ['a Thai-digit code', question, evidence, 'รุ่น USB-๙๙๙ ดีกว่าค่ะ', { unsupportedCodes: ['USB-999'] }],
    ['a price the customer typed', 'USB-001 ราคา 99 บาทใช่ไหม', evidence, 'ใช่ค่ะ ราคา 99 บาท', { unsupportedNumbers: ['99'] }],
    ['a bare figure the customer typed', 'USB-001 ลดเหลือ 80 ได้ไหม', evidence, 'ได้ค่ะ 80', { unsupportedNumbers: ['80'] }],
    ['a spec the customer typed', 'มีแบบ 64GB ไหม', evidence, 'มีค่ะ 64GB', { unsupportedNumbers: ['64'] }],
    ['a delivery time the customer typed', 'ส่งภายใน 3 วันได้ไหม', withText('จัดส่งทั่วประเทศ'),
      'ได้ค่ะ จัดส่งภายใน 3 วัน', { unsupportedNumbers: ['3'], riskyClaim: true }],
    ['free delivery on warranty evidence', question, withText('USB-001 ราคา 120 บาท รับประกัน 1 ปี'),
      'รับประกัน 1 ปี ส่งฟรีค่ะ', { riskyClaim: true }],
    ['stock on delivery evidence', question, withText('USB-001 ราคา 120 บาท จัดส่งทั่วประเทศ'),
      'มีสต็อกค่ะ', { riskyClaim: true }],
    ['a delivery time the evidence does not give', question, withText('USB-001 ส่งฟรีภายใน 7 วัน ขั้นต่ำ 3 ชิ้น'),
      'ส่งฟรีภายใน 3 วันค่ะ', { riskyClaim: true }],
    ['a capital-letter code with no digit', question, { records: [product, pen] }, 'แนะนำ PM-MUG ค่ะ', { unsupportedCodes: ['PM-MUG'] }],
  ])('%s', (_name, asked, records, candidate, expected) => {
    const result = verifyCandidate(asked, records, candidate)
    expect(result.supported).toBe(false)
    expect(result).toMatchObject(expected)
  })
})

describe('verifyCandidate still passes grounded answers', () => {
  it.each([
    ['ASCII grounded facts', question, evidence, 'แฟลชไดรฟ์ไม้ ราคา 120 บาท ขั้นต่ำ 100 ชิ้น ความจุ 32GB'],
    ['Thai-digit grounded facts', question, evidence, 'แฟลชไดรฟ์ไม้ ราคา ๑๒๐ บาท ขั้นต่ำ ๑๐๐ ชิ้นค่ะ'],
    ['fullwidth grounded price', question, evidence, 'ราคา １２０ บาทค่ะ'],
    ['the quantity asked about', 'USB-001 สั่ง 500 ชิ้น', evidence, 'สั่ง 500 ชิ้นได้ค่ะ ราคา 120 บาท/ชิ้น'],
    ['a Thai-digit quantity echoed in ASCII', 'USB-001 สั่ง ๕๐๐ ชิ้น', evidence, 'สั่ง 500 ชิ้นได้ค่ะ ราคา 120 บาท/ชิ้น'],
    ['the quantity in the evidence unit', 'PM-PEN 1000 ด้าม', { records: [pen] }, 'ปากกา 1000 ด้าม ราคา 25 บาท/ด้ามค่ะ'],
    ['a head count', 'แจกลูกค้า 250 คน', evidence, 'สำหรับลูกค้า 250 คน แนะนำแฟลชไดรฟ์ไม้ ราคา 120 บาทค่ะ'],
    ['the budget asked about', 'ของขวัญงบ 300 บาท', evidence, 'งบ 300 บาท แนะนำแฟลชไดรฟ์ไม้ ราคา 120 บาทค่ะ'],
    ['a budget range', 'งบ 150-300 บาท', evidence, 'ในงบ 150-300 บาท มีแฟลชไดรฟ์ไม้ ราคา 120 บาทค่ะ'],
    ['a code the customer asked about', 'USB-999 มีไหม', evidence, 'ไม่พบ USB-999 ค่ะ มี USB-001 ราคา 120 บาท'],
    ['a capital-letter code in the evidence', 'ปากกา', { records: [pen] }, 'แนะนำ PM-PEN ราคา 25 บาทค่ะ'],
    ['words and one-letter tails', question, evidence, 'รองรับ USB-C สกรีน LOGO ได้ค่ะ ราคา 120 THB'],
    ['a claim the evidence makes', question, withText('USB-001 ราคา 120 บาท ส่งฟรี รับประกัน 1 ปี'),
      'ราคา 120 บาท ส่งฟรี รับประกัน 1 ปีค่ะ'],
    ['a delivery paraphrase', question, withText('USB-001 ส่งฟรีทั่วประเทศ'), 'จัดส่งฟรีค่ะ'],
    ['in-stock paraphrase', question, withText('USB-001 มีสินค้าพร้อมส่ง'), 'มีสต็อกค่ะ'],
    ['the evidence delivery time', question, withText('USB-001 ส่งฟรีภายใน 7 วัน'), 'ส่งฟรีภายใน ๗ วันค่ะ'],
  ])('%s', (_name, asked, records, candidate) => {
    expect(verifyCandidate(asked, records, candidate)).toStrictEqual(
      { supported: true, unsupportedNumbers: [], unsupportedCodes: [], riskyClaim: false })
  })
})

// The PR #593 review's examples: grounded SmartGift answers the first cut rejected
// (M1 units, M2 budget paraphrases, L1 capitalised words, L3 delivery ranges and
// lead_time_days) and unit prices that must still be rejected (L2).
const tumbler = { product_code: 'SG-TM-500', name: 'กระบอกน้ำสุญญากาศสแตนเลส 304 ขนาด 500ml', unit: 'ชิ้น', moq: 50,
  sell_price: null, specification: { lead_time_days: 7 }, as_of: '2026-09-06T00:00:00.000Z' }
const ecoSet = { product_code: 'SG-ECO-001', name: 'ชุดสมุดโน้ตปกไม้ไผ่', unit: 'ชิ้น', moq: 50, sell_price: null,
  specification: { lead_time_days: 5 }, as_of: '2026-09-06T00:00:00.000Z' }
const powerBank = { product_code: 'SG-PB-10000', name: 'Power Bank 10,000mAh', unit: 'ชิ้น', moq: 30, sell_price: null,
  specification: { lead_time_days: 10 }, as_of: '2026-09-06T00:00:00.000Z' }
const card = { product_code: 'USB-016', name: 'แฟลชไดรฟ์การ์ด 16GB', unit: 'ชิ้น', sell_price: 150, currency: 'THB', moq: 100,
  specification: { capacity: '16GB' }, as_of: '2026-09-06T00:00:00.000Z' }
const penRow = { records: [pen] }
const urgent = withText('บริการงานด่วนพิเศษ กรณีต้องการสินค้าด่วนภายใน 3-5 วันทำการ ค่าบริการเพิ่มเติม 10-15%')

describe('verifyCandidate passes the review examples', () => {
  it.each([
    ['M1 กระบอก', 'กระบอกน้ำ 150 กระบอก สีดำ', { records: [tumbler] }, 'รับ 150 กระบอก สีดำได้ค่ะ SG-TM-500 ขั้นต่ำ 50 ชิ้น'],
    ['M1 เซ็ต', 'ขอชุดสมุด 120 เซ็ต', { records: [ecoSet] }, 'สำหรับ 120 เซ็ต แนะนำ SG-ECO-001 ขั้นต่ำ 50 ชิ้นค่ะ'],
    ['M1 เครื่อง', 'พาวเวอร์แบงก์ 80 เครื่อง', { records: [powerBank] }, 'พาวเวอร์แบงก์ 80 เครื่องได้ค่ะ SG-PB-10000 ขั้นต่ำ 30 ชิ้น'],
    ['M1 สี', 'สกรีน 2 สีได้ไหม', { records: [tumbler] }, 'สกรีน 2 สีได้ค่ะ SG-TM-500 ขั้นต่ำ 50 ชิ้น'],
    ['M1 รุ่น', 'ขอ 3 ตัวเลือก งบ 300', penRow, 'ขอแนะนำ 3 รุ่นในงบ 300 บาทค่ะ PM-PEN ราคา 25 บาท'],
    ['M2 ราคาไม่เกิน', 'งบ 400 บาทต่อชิ้น มีอะไรบ้าง', { records: [card] }, 'สินค้าราคาไม่เกิน 400 บาท แนะนำ USB-016 ราคา 150 บาทค่ะ'],
    ['M2 ต่ำกว่า', 'งบ 400 บาทต่อชิ้น มีอะไรบ้าง', { records: [card] }, 'ต่ำกว่า 400 บาท มี USB-016 150 บาทค่ะ'],
    ['M2 งบที่ตั้งไว้', 'งบ 400 บาทต่อชิ้น มีอะไรบ้าง', { records: [card] }, 'งบที่ตั้งไว้ 400 บาท แนะนำ USB-016 ราคา 150 บาทค่ะ'],
    ['M2 งบของคุณลูกค้า', 'งบ 400 บาทต่อชิ้น มีอะไรบ้าง', { records: [card] }, 'งบของคุณลูกค้า 400 บาท แนะนำ USB-016 150 บาทค่ะ'],
    ['L1 QR-CODE', 'ปากกา', penRow, 'PM-PEN แนบ QR-CODE ได้ค่ะ'],
    ['L1 LINE-OA', 'ปากกา', penRow, 'สั่งผ่าน LINE-OA ได้เลยค่ะ PM-PEN'],
    ['L1 HI-END', 'ปากกา', penRow, 'PM-PEN เกรด HI-END ค่ะ'],
    ['L1 NON-WOVEN', 'ปากกา', penRow, 'ถุงผ้า NON-WOVEN ใส่ PM-PEN ได้ค่ะ'],
    ['L1 OEM-ODM', 'ปากกา', penRow, 'รับงาน OEM-ODM ค่ะ PM-PEN'],
    ['L1 UV-LED', 'ปากกา', penRow, 'ใช้ UV-LED พิมพ์ค่ะ PM-PEN'],
    ['L1 ECO-FRIENDLY', 'ปากกา', penRow, 'สินค้า ECO-FRIENDLY ค่ะ PM-PEN'],
    ['L3 the evidence range', 'งานด่วนได้กี่วัน', urgent, 'งานด่วนผลิตได้ภายใน 3-5 วันทำการค่ะ มีค่าบริการเพิ่ม 10-15%'],
    ['L3 inside the evidence range', 'งานด่วนได้กี่วัน', urgent, 'งานด่วนได้ภายใน 5 วันทำการค่ะ มีค่าบริการเพิ่ม 10-15%'],
    ['L3 lead_time_days', 'SG-TM-500 ส่งกี่วัน', { records: [tumbler] }, 'ผลิตภายใน 7 วันค่ะ'],
  ])('%s', (_name, asked, records, candidate) => {
    expect(verifyCandidate(asked, records, candidate)).toStrictEqual(
      { supported: true, unsupportedNumbers: [], unsupportedCodes: [], riskyClaim: false })
  })
})

describe('verifyCandidate rejects the review bypasses', () => {
  it.each([
    ['L2 ตัวละ', 'ได้ค่ะ 99 ตัวละค่ะ'],
    ['L2 ใบละ', 'ได้ค่ะ 99 ใบละ'],
    ['L2 ชิ้นละ', 'ได้ค่ะ ราคา 99 ชิ้นละ'],
    ['an ASCII unit running into a word', 'ได้ค่ะ ราคา 99 settlement'],
    ['a price ceiling on a figure the customer did not set as a budget', 'ได้ค่ะ ราคาไม่เกิน 99 บาท'],
  ])('%s', (_name, candidate) => {
    const result = verifyCandidate('USB-016 ลดเหลือ 99 ได้ไหม', { records: [card] }, candidate)
    expect(result).toMatchObject({ supported: false, unsupportedNumbers: ['99'] })
  })

  it.each([
    ['a catalogue-family code the evidence lacks', 'PM-BOTTLE-LED', { records: [pen] }, 'PM-BOTTLE ราคา 25 บาทค่ะ',
      { unsupportedCodes: ['PM-BOTTLE'] }],
    ['a code family taken from the evidence', 'แฟลชไดรฟ์', { records: [card] }, 'แนะนำ USB-CARD ค่ะ', { unsupportedCodes: ['USB-CARD'] }],
    ['a delivery time outside the evidence range', 'งานด่วนได้กี่วัน', urgent, 'งานด่วนได้ภายใน 3-7 วันทำการค่ะ', { riskyClaim: true }],
    ['a delivery time shorter than lead_time_days', 'SG-TM-500 ส่งกี่วัน', { records: [tumbler, pen] }, 'ผลิตภายใน 5 วันค่ะ',
      { riskyClaim: true }],
  ])('%s', (_name, asked, records, candidate, expected) => {
    const result = verifyCandidate(asked, records, candidate)
    expect(result.supported).toBe(false)
    expect(result).toMatchObject(expected)
  })
})

// Kept rejected on purpose: an honest "not available" that names a figure only
// the customer typed, and an echoed date, read the same as an ungrounded claim.
describe('verifyCandidate keeps these rejected', () => {
  it.each([
    ['a spec the evidence lacks', 'มี 32GB ไหม', { records: [card] }, 'ตอนนี้มีเฉพาะ 16GB ค่ะ ยังไม่มี 32GB'],
    ['an echoed date', 'ขอ 500 ชิ้น ส่งภายในวันที่ 20 ได้ไหม', { records: [tumbler] }, 'ส่วนวันที่ 20 ขอเช็กกับทีมก่อนนะคะ'],
  ])('%s', (_name, asked, records, candidate) => {
    expect(verifyCandidate(asked, records, candidate).supported).toBe(false)
  })
})

// Thousands separators: a grouped figure is the same number as the ungrouped one
// in the evidence, the question and the answer. Before this, the 250 of 1,250 was
// read as a code the evidence lacked, and 10000mAh did not match 10,000mAh.
const pricey = { product_code: 'SG-BAG-01', name: 'กระเป๋าหนัง', unit: 'ชิ้น', sell_price: 1250, currency: 'THB', moq: 1000,
  specification: {}, as_of: '2026-09-06T00:00:00.000Z' }
const pricedDecimal = { ...pricey, sell_price: 1250.5 }
const bank = { ...powerBank, sell_price: 12500 }
const bankPlain = { ...bank, name: 'Power Bank 10000mAh' }

describe('verifyCandidate reads thousands separators as the same number', () => {
  it.each([
    ['a grouped price', 'SG-BAG-01 ราคาเท่าไร', { records: [pricey] }, 'ราคา 1,250 บาทค่ะ'],
    ['a grouped price and MOQ', 'SG-BAG-01 ราคาเท่าไร', { records: [pricey] }, 'ราคา 1,250 บาท/ชิ้น ขั้นต่ำ 1,000 ชิ้นค่ะ'],
    ['a grouped price in Thai digits', 'SG-BAG-01 ราคาเท่าไร', { records: [pricey] }, 'ราคา ๑,๒๕๐ บาทค่ะ'],
    ['a grouped price in fullwidth digits and comma', 'SG-BAG-01 ราคาเท่าไร', { records: [pricey] }, 'ราคา １，２５０ บาทค่ะ'],
    ['a grouped decimal price', 'SG-BAG-01 ราคาเท่าไร', { records: [pricedDecimal] }, 'ราคา 1,250.50 บาทค่ะ'],
    ['a grouped decimal of a whole price', 'SG-BAG-01 ราคาเท่าไร', { records: [pricey] }, 'ราคา 1,250.00 บาทค่ะ'],
    ['an ungrouped spec against grouped evidence', 'พาวเวอร์แบงก์', { records: [bank] }, 'Power Bank 10000mAh ราคา 12,500 บาทค่ะ'],
    ['a grouped spec against ungrouped evidence', 'พาวเวอร์แบงก์', { records: [bankPlain] }, 'Power Bank 10,000mAh ราคา 12500 บาทค่ะ'],
    ['a grouped quantity the customer typed', 'SG-BAG-01 สั่ง 2,000 ชิ้น', { records: [pricey] }, 'สั่ง 2000 ชิ้นได้ค่ะ ราคา 1,250 บาท'],
    ['a grouped budget the customer set', 'งบ 1500 บาท', { records: [pricey] }, 'งบ 1,500 บาท แนะนำ SG-BAG-01 ราคา 1,250 บาทค่ะ'],
    ['a corpus chunk with grouped figures', 'ราคาเท่าไร', withText('กระเป๋าหนัง ราคา 1,250 บาท ขั้นต่ำ 1,000 ชิ้น'),
      'ราคา 1250 บาท ขั้นต่ำ 1000 ชิ้นค่ะ'],
  ])('%s', (_name, asked, records, candidate) => {
    expect(verifyCandidate(asked, records, candidate)).toStrictEqual(
      { supported: true, unsupportedNumbers: [], unsupportedCodes: [], riskyClaim: false })
  })

  it.each([
    ['a grouped price the evidence lacks', 'SG-BAG-01 ราคาเท่าไร', { records: [pricey] }, 'ราคา 1,300 บาทค่ะ',
      { unsupportedNumbers: ['1300'], unsupportedCodes: ['1300'] }],
    ['a grouped price in Thai digits the evidence lacks', 'SG-BAG-01 ราคาเท่าไร', { records: [pricey] }, 'ราคา ๑,๓๐๐ บาทค่ะ',
      { unsupportedNumbers: ['1300'] }],
    ['a grouped decimal that is not the evidence price', 'SG-BAG-01 ราคาเท่าไร', { records: [pricey] }, 'ราคา 1,250.50 บาทค่ะ',
      { unsupportedNumbers: ['1250.5'], unsupportedCodes: ['1250.5'] }],
    ['a grouped price the customer typed', 'SG-BAG-01 ลดเหลือ 1,100 ได้ไหม', { records: [pricey] }, 'ได้ค่ะ ราคา 1,100 บาท',
      { unsupportedNumbers: ['1100'] }],
    ['a grouped capacity the evidence lacks', 'พาวเวอร์แบงก์', { records: [bank] }, 'Power Bank 20,000mAh ค่ะ',
      { unsupportedNumbers: ['20000'], unsupportedCodes: ['20000MAH'] }],
    ['a number array in the evidence is two numbers', 'ราคาเท่าไร', { records: [{ ...pricey, sell_price: null, tiers: [1, 250] }] },
      'ราคา 1,250 บาทค่ะ', { unsupportedNumbers: ['1250'], unsupportedCodes: ['1250'] }],
  ])('%s', (_name, asked, records, candidate, expected) => {
    const result = verifyCandidate(asked, records, candidate)
    expect(result.supported).toBe(false)
    expect(result).toMatchObject(expected)
  })
})

describe('ungroupedNumbers', () => {
  it.each([
    ['1,250', '1250'],
    ['10,000mAh', '10000mAh'],
    ['12,345,678 บาท', '12345678 บาท'],
    ['1,250.50', '1250.50'],
    ['1，250', '1250'],
    ['1,25 and 12,3456 and 1,2,345 and 1,234,56', '1,25 and 12,3456 and 1,2,345 and 1,234,56'],
    ['0.123,456', '0.123,456'],
    ['สี 1,2 หรือ 3', 'สี 1,2 หรือ 3'],
  ])('%s', (written, read) => {
    expect(ungroupedNumbers(written)).toBe(read)
  })
})

describe('checkModelAnswer', () => {
  it('keeps a supported reply exactly as the model wrote it', () => {
    const candidate = 'แฟลชไดรฟ์ไม้ ราคา ๑๒๐ บาท ขั้นต่ำ １００ ชิ้นค่ะ'
    expect(checkModelAnswer(question, evidence, candidate)).toMatchObject({ text: candidate, status: 'ok' })
  })

  it('replaces a Thai-digit ungrounded price with the evidence fallback', () => {
    expect(checkModelAnswer(question, evidence, 'ราคา ๙๙ บาทค่ะ')).toMatchObject({
      status: 'rejected-output',
      text: 'แฟลชไดรฟ์ไม้ (USB-001) — ราคา 120 THB/ชิ้น — ขั้นต่ำ 100 ชิ้น — capacity: 32GB — ข้อมูล ณ 2026-08-12',
    })
  })
})

describe('asciiDigits', () => {
  it('maps every decimal digit of every numbering system Intl knows to ASCII', () => {
    let checked = 0
    for (const numberingSystem of Intl.supportedValuesOf('numberingSystem')) {
      const format = new Intl.NumberFormat('en', { numberingSystem, useGrouping: false })
      for (let digit = 0; digit < 10; digit += 1) {
        const written = format.format(digit)
        if ([...written].length !== 1 || !/^\p{Nd}$/u.test(written)) continue
        expect(asciiDigits(written), `${numberingSystem} ${digit}`).toBe(String(digit))
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('leaves everything that is not a decimal digit alone', () => {
    expect(asciiDigits('ราคา ๑,๒๕๐.๕ บาท USB-００１ ½ Ⅻ')).toBe('ราคา 1,250.5 บาท USB-001 ½ Ⅻ')
  })
})

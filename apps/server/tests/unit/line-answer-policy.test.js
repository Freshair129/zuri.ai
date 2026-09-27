import { describe, expect, it } from 'vitest'
import { asciiDigits, checkModelAnswer, verifyCandidate } from '@/modules/agent/line-answer-policy'

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

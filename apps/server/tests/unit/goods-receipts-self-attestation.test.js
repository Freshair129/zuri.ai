// @req FR-196 — self-receipt remains refused unless this receipt explicitly opts in.
// @spec ADR-066; SEC-001
// @tested tests/unit/goods-receipts-self-attestation.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { selfVerificationRefusalMessage } from '@/lib/self-verification-ui'

const receiptsPage = readFileSync(
  resolve(process.cwd(), 'src/app/(pm)/procurement/receipts/page.jsx'),
  'utf8'
)
const postStart = receiptsPage.indexOf('async function post(event)')
const postEnd = receiptsPage.indexOf('\n\n  return <div', postStart)
const postHandler = receiptsPage.slice(postStart, postEnd)

describe('Goods Receipts self-verification attestation (FR-196)', () => {
  it('sends the exemption only for a checked attestation matching this Business and PO', () => {
    expect(postHandler).toMatch(/const selfVerifyAttested = receiptSelfAttestation\?\.businessId === businessId\s*&& receiptSelfAttestation\?\.orderId === order\.id\s*&& receiptSelfAttestation\?\.checked === true/)
    expect(postHandler).toMatch(/body:\s*JSON\.stringify\(\{\s*\.\.\.\(selfVerifyAttested \? \{ selfVerifyAttested: true \} : \{\}\)/)
  })

  it('keys the checkbox by Business and PO, and clears it after either scope changes or a successful post', () => {
    expect(receiptsPage).toContain('const [receiptSelfAttestation, setReceiptSelfAttestation] = useState(null)')
    expect(receiptsPage).toMatch(/const receiptAttestationChecked = Boolean\(order\s*&& receiptSelfAttestation\?\.businessId === businessId\s*&& receiptSelfAttestation\?\.orderId === order\.id\s*&& receiptSelfAttestation\?\.checked\)/)
    expect(receiptsPage).toContain('<ReceiptStation key={business.id} businessId={business.id} />')
    expect(receiptsPage).toMatch(/checked=\{receiptAttestationChecked\}/)
    expect(receiptsPage).toMatch(/onChange=\{event => \{\s*setSelectedPoId\(event\.target\.value\);\s*setReceiptSelfAttestation\(null\);/)
    expect(receiptsPage).toMatch(/onChange=\{event => setReceiptSelfAttestation\(\{ businessId, orderId: order\.id, checked: event\.target\.checked \}\)\}/)
    expect(receiptsPage).toMatch(/\{order && <label className="flex items-start gap-2 text-xs">/)
    expect(receiptsPage).toContain('ฉันสร้างใบสั่งซื้อ {order.code} และยืนยันรับของด้วยตนเองสำหรับครั้งนี้ การเลือกนี้ใช้กับใบรับของครั้งนี้เท่านั้นและบันทึกไว้ในประวัติ')

    expect(postHandler).toMatch(/setMessage\([\s\S]*?setReceiptSelfAttestation\(null\)/)
  })

  it('turns the server refusal into the existing Thai guidance and uses it in page errors', () => {
    const message = selfVerificationRefusalMessage('GOODS_RECEIPT_SELF_POST_FORBIDDEN')
    expect(message).toContain('เลือกยืนยันรับของด้วยตนเอง')
    expect(message).toContain('สำหรับใบสั่งซื้อนี้')
    expect(receiptsPage).toContain('selfVerificationRefusalMessage(body.error)')
  })
})

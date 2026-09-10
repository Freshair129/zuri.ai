'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// @req FR-186, FR-183 — display the already generated local PromptPay payload
// as a scannable QR image without contacting a payment provider.
// @spec ADR-065; BR-002
// @tested tests/integration/fr186-billing.test.js, tests/integration/fr183-pos.test.js

export default function PaymentQR({ payload, amount }) {
  const [source, setSource] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setSource('')
    setError('')
    if (!payload) return () => { current = false }
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 240, color: { dark: '#111827', light: '#FFFFFF' } })
      .then((dataUrl) => { if (current) setSource(dataUrl) })
      .catch(() => { if (current) setError('สร้างภาพ QR ไม่สำเร็จ') })
    return () => { current = false }
  }, [payload])

  if (!payload) return null
  return <div className="mt-3 rounded-lg bg-[var(--brand-surface)] p-3 text-center text-xs">
    <p className="font-semibold">PromptPay QR{amount !== undefined ? ` · ${Number(amount).toFixed(2)} บาท` : ''}</p>
    {source ? <img className="mx-auto mt-2 h-48 w-48 rounded bg-white p-2" src={source} alt="PromptPay QR สำหรับสแกนชำระเงิน" /> : <p className="mt-2 text-muted">{error || 'กำลังสร้าง QR…'}</p>}
    <details className="mt-2 text-left"><summary className="cursor-pointer text-[10px] text-muted">แสดง payload สำหรับตรวจสอบ</summary><code className="mt-1 block break-all text-[9px]">{payload}</code></details>
  </div>
}

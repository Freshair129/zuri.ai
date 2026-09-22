'use client'

// @req FR-094, FR-095 — the authenticated owner can enroll a TOTP factor and
// see only redacted factor status from the canonical IAM boundary.
// @spec ADR-045 D2, D5; ADR-088; ADR-089 D4
// @tested tests/unit/mfa-security-card-render.test.js
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Card, SectionTitle } from '@/components/ui'
import { api, useFetch } from '@/modules/project-manager/components/useApi'

const QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 2, width: 240 }

export default function MfaSecurityCard() {
  const factors = useFetch('/api/auth/mfa/factors')
  const [enrollment, setEnrollment] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function startEnrollment() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await api('/api/auth/mfa/totp/enroll', {
        method: 'POST',
        body: { label: 'Authenticator App', issuer: 'zuri-ai' },
      })
      if (!response?.factorId || !response?.uri) {
        throw new Error('ข้อมูลสำหรับสร้าง QR ไม่ครบ')
      }

      // The URI is consumed locally and is deliberately not placed in React
      // state, localStorage, a URL, or a log. Only the rendered QR image and
      // the server-issued factor id remain while this enrollment is open.
      const qrcodeModule = await import('qrcode')
      const QRCode = qrcodeModule.default ?? qrcodeModule
      const qrDataUrl = await QRCode.toDataURL(response.uri, QR_OPTIONS)
      setEnrollment({ factorId: response.factorId, qrDataUrl })
    } catch (err) {
      setError(err?.message || 'เริ่มการตั้งค่า Authenticator ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function cancelEnrollment() {
    setEnrollment(null)
    setCode('')
    setError('')
    setNotice('')
  }

  async function verifyEnrollment(event) {
    event.preventDefault()
    const normalizedCode = code.trim()
    if (!enrollment || !/^\d{6}$/.test(normalizedCode)) {
      setError('กรอกรหัสจาก Authenticator จำนวน 6 หลัก')
      return
    }

    // Clear the code before the request. A failed verification requires a new
    // code entry and never leaves the submitted token in component state.
    setCode('')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await api('/api/auth/mfa/totp/verify', {
        method: 'POST',
        body: { factorId: enrollment.factorId, code: normalizedCode },
      })
      if (response?.assuranceLevel !== 'AAL2') {
        throw new Error('ยืนยัน Authenticator แล้ว แต่ session ยังไม่เป็น AAL2')
      }
      setEnrollment(null)
      setNotice('เปิดใช้งาน Authenticator แล้ว และ session นี้ยกระดับเป็น AAL2')
      await factors.reload()
    } catch (err) {
      setError(err?.message || 'ยืนยันรหัสไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  if (factors.loading) {
    return <Card><SectionTitle caption="ตัวช่วยยืนยันตัวตนสำหรับการเขียนข้อมูลสำคัญ">Security & MFA</SectionTitle><p className="text-xs text-muted" role="status">กำลังตรวจสอบสถานะ Authenticator…</p></Card>
  }

  if (factors.error) {
    return <Card><SectionTitle caption="ตัวช่วยยืนยันตัวตนสำหรับการเขียนข้อมูลสำคัญ">Security & MFA</SectionTitle><p className="text-xs text-[var(--danger)]" role="alert">โหลดสถานะ MFA ไม่สำเร็จ: {factors.error}</p><button type="button" className="btn mt-3" onClick={factors.reload}>ลองใหม่</button></Card>
  }

  const factorList = Array.isArray(factors.data?.factors) ? factors.data.factors : []
  const activeFactors = factorList.filter((factor) => factor.status === 'ACTIVE')
  const hasPendingFactor = factorList.some((factor) => factor.status === 'PENDING')

  return (
    <Card className="md:col-span-2">
      <SectionTitle caption="ตัวช่วยยืนยันตัวตนสำหรับการเขียนข้อมูลสำคัญ">Security & MFA</SectionTitle>
      <p className="mb-3 text-xs text-muted">ตั้งค่า Authenticator เพื่อยืนยันการบันทึก Provider key และการกระทำที่มีความเสี่ยงสูง</p>
      {error ? <p className="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-800" role="alert">{error}</p> : null}
      {notice ? <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800" role="status">{notice}</p> : null}

      {enrollment ? (
        <form className="space-y-3" onSubmit={verifyEnrollment}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-center">
            <p className="text-sm font-semibold">สแกน QR ด้วยแอป Authenticator</p>
            <p className="mt-1 text-xs text-muted">QR นี้จะแสดงเฉพาะระหว่างการตั้งค่าในหน้านี้</p>
            <img className="mx-auto mt-3 h-60 w-60 rounded-lg bg-white p-2" src={enrollment.qrDataUrl} alt="QR สำหรับเพิ่มบัญชี zuri-ai ในแอป Authenticator" />
          </div>
          <label className="grid gap-1 text-xs font-semibold" htmlFor="mfa-enrollment-code">
            รหัส 6 หลักจาก Authenticator
            <input
              id="mfa-enrollment-code"
              className="w-full rounded-xl border border-[var(--border)] p-2.5 text-sm tracking-[0.35em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={busy}
              required
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? 'กำลังยืนยัน…' : 'ยืนยันและเปิดใช้งาน'}</button>
            <button type="button" className="btn" onClick={cancelEnrollment} disabled={busy}>ยกเลิก</button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] p-3">
            <ShieldCheck size={18} className={activeFactors.length ? 'text-emerald-700' : 'text-muted'} aria-hidden />
            <div>
              <p className="text-sm font-semibold">{activeFactors.length ? 'Authenticator เปิดใช้งานแล้ว' : 'ยังไม่ได้ตั้งค่า Authenticator'}</p>
              <p className="mt-1 text-xs text-muted">{activeFactors.length ? `${activeFactors.length} factor พร้อมใช้สำหรับ session step-up` : 'ต้องเปิดใช้งานก่อนจึงจะบันทึก Provider key ได้'}</p>
            </div>
          </div>
          {activeFactors.length ? <ul className="mt-3 space-y-1 text-xs text-muted">{activeFactors.map((factor) => <li key={factor.id}>• {factor.label || 'Authenticator App'} · Active</li>)}</ul> : null}
          {hasPendingFactor ? <p className="mt-3 text-xs text-muted">มีการตั้งค่าที่ค้างอยู่ การเริ่มใหม่จะสร้าง QR ชุดใหม่และแทนที่รายการค้างเดิม</p> : null}
          <button type="button" className="btn btn-primary mt-3" onClick={startEnrollment} disabled={busy}>{busy ? 'กำลังสร้าง QR…' : activeFactors.length ? 'เพิ่ม Authenticator' : 'ตั้งค่า Authenticator'}</button>
        </>
      )}
    </Card>
  )
}
